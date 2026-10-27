// api/whatsapp-webhook.js — Webhook do WhatsApp para receber respostas dos pacientes
var { getClient } = require('../lib/db')
var followupAgente = require('../lib/followup/agente')
var crypto = require('crypto')

// Assinatura da Meta (X-Hub-Signature-256 = HMAC-SHA256 do corpo com o App
// Secret). Só é exigida quando WHATSAPP_APP_SECRET está configurado. Lê o corpo
// bruto quando ainda disponível; senão reconstrói o JSON nos formatos que a Meta
// usa (unicode escapado, com/sem barra escapada).
async function corpoBruto(req) {
    if (typeof req.body === 'string') return req.body
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
    return null
}
function candidatos(body) {
    var j = JSON.stringify(body)
    var u = j.replace(/[\u007f-\uffff]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4) })
    return [j, u, u.replace(/\//g, '\\/')]
}
function assinaturaOk(segredo, assinatura, textos) {
    var esperado = String(assinatura || '').replace(/^sha256=/, '')
    if (!/^[0-9a-f]{64}$/i.test(esperado)) return false
    return textos.some(function (t) {
        var h = crypto.createHmac('sha256', segredo).update(t, 'utf8').digest('hex')
        return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(esperado.toLowerCase(), 'hex'))
    })
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')

    // GET: verificação do webhook (Meta envia challenge)
    if (req.method === 'GET') {
        var mode = (req.query || {})['hub.mode']
        var token = (req.query || {})['hub.verify_token']
        var challenge = (req.query || {})['hub.challenge']
        var verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'klinov_verify_2026'
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('[wa-webhook] Verificacao OK')
            return res.status(200).send(challenge)
        }
        return res.status(403).json({ error: 'Token invalido' })
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    var segredo = process.env.WHATSAPP_APP_SECRET || ''
    if (segredo) {
        var bruto = await corpoBruto(req)
        var corpoObj = typeof req.body === 'object' && req.body ? req.body : (function () { try { return JSON.parse(bruto || '{}') } catch (e) { return {} } })()
        if (!assinaturaOk(segredo, req.headers['x-hub-signature-256'], bruto ? [bruto].concat(candidatos(corpoObj)) : candidatos(corpoObj))) {
            console.error('[wa-webhook] Assinatura invalida: requisicao ignorada')
            return res.status(401).json({ error: 'Assinatura invalida' })
        }
    }

    try {
        var client = getClient()
        var body = typeof req.body === 'string' ? (function () { try { return JSON.parse(req.body) } catch (e) { return {} } })() : (req.body || {})

        // Meta envia dentro de entry[].changes[].value
        var entries = body.entry || []
        for (var ei = 0; ei < entries.length; ei++) {
            var changes = entries[ei].changes || []
            for (var ci = 0; ci < changes.length; ci++) {
                var value = changes[ci].value || {}
                var messages = value.messages || []

                // Status de entrega das mensagens do follow-up (enviado → entregue → lido)
                var statuses = value.statuses || []
                for (var si = 0; si < statuses.length; si++) {
                    var stx = statuses[si]
                    if (!stx.id || ['delivered', 'read', 'failed'].indexOf(stx.status) < 0) continue
                    try {
                        var stNome = stx.status === 'delivered' ? 'entregue' : stx.status === 'read' ? 'lido' : 'erro'
                        var stErro = stx.status === 'failed' && stx.errors && stx.errors[0] ? String(stx.errors[0].title || stx.errors[0].message || '').slice(0, 300) : null
                        // nunca rebaixa: lido não volta para entregue
                        await client.execute({ sql: "UPDATE followup_mensagens SET status=?, erro=COALESCE(?,erro) WHERE wa_message_id=? AND direcao='saida' AND NOT (status='lido' AND ?='entregue')", args: [stNome, stErro, stx.id, stNome] })
                    } catch(e) {}
                }
                var waPhoneIdRecv = (value.metadata && value.metadata.phone_number_id) || ''

                // Identify clinic by WhatsApp phone_id
                var clinicaWa = null
                if (waPhoneIdRecv) {
                    try {
                        var cliR = await client.execute({ sql: "SELECT id, whatsapp_token, whatsapp_phone_id FROM clinicas WHERE whatsapp_phone_id=? LIMIT 1", args: [waPhoneIdRecv] })
                        if (cliR.rows.length) clinicaWa = cliR.rows[0]
                    } catch(e) {}
                }
                // Fallback to env var phone_id
                if (!clinicaWa && waPhoneIdRecv === (process.env.WHATSAPP_PHONE_ID || '')) {
                    clinicaWa = { id: 1, whatsapp_token: process.env.WHATSAPP_TOKEN || '', whatsapp_phone_id: waPhoneIdRecv }
                }

                for (var mi = 0; mi < messages.length; mi++) {
                    var msg = messages[mi]
                    var from = msg.from || '' // número do paciente (5567999647973)
                    var msgType = msg.type || ''
                    var resposta = ''

                    // Quick Reply button response
                    if (msgType === 'button') {
                        resposta = (msg.button && msg.button.text) || ''
                    }
                    // Interactive button response
                    else if (msgType === 'interactive') {
                        resposta = (msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.title) || ''
                    }
                    // Text response
                    else if (msgType === 'text') {
                        resposta = (msg.text && msg.text.body) || ''
                    }

                    if (!resposta) continue
                    var respostaLower = resposta.toLowerCase().trim()

                    console.log('[wa-webhook] De: ' + from + ' Resposta: ' + resposta + ' Tipo: ' + msgType)

                    // Normaliza telefone para busca (remove 55 se necessário)
                    var telBusca = from.replace(/\D/g, '')
                    var telVariantes = [telBusca]
                    if (telBusca.startsWith('55')) telVariantes.push(telBusca.slice(2))
                    // Adiciona variantes com/sem 9
                    telVariantes.forEach(function(t) {
                        if (t.length === 11 && t[2] === '9') telVariantes.push(t.slice(0, 2) + t.slice(3))
                        if (t.length === 10) telVariantes.push(t.slice(0, 2) + '9' + t.slice(2))
                    })

                    // Busca agendamento pendente do paciente para amanhã ou hoje
                    var agFound = null
                    for (var ti = 0; ti < telVariantes.length; ti++) {
                        var telLike = '%' + telVariantes[ti].slice(-8) + '%' // últimos 8 dígitos
                        var agClinicaId = clinicaWa ? clinicaWa.id : null
                        var agSql = "SELECT a.id, a.status, a.data_hora, a.paciente_id, a.clinica_id, COALESCE(p.nome, a.paciente_nome) as paciente_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id WHERE (p.telefone LIKE ? OR a.paciente_telefone LIKE ?) AND DATE(a.data_hora) >= DATE('now') AND DATE(a.data_hora) <= DATE('now', '+2 days') AND a.status NOT IN ('cancelado','realizado')"
                        var agArgs = [telLike, telLike]
                        if (agClinicaId) { agSql += " AND a.clinica_id=?"; agArgs.push(agClinicaId) }
                        agSql += " ORDER BY a.data_hora ASC LIMIT 1"
                        var agR = await client.execute({ sql: agSql, args: agArgs })
                        if (agR.rows.length) { agFound = agR.rows[0]; break }
                    }

                    // Follow-up de orçamentos (lib/followup/agente.js). "Sim"/"não" soltos
                    // ficam com a confirmação de consulta SÓ quando há consulta pendente
                    // e o paciente não respondeu diretamente a uma mensagem do follow-up.
                    try {
                        var ehConfirmacao = /^(sim|yes|confirmo|quick reply|não|nao|no)$/.test(respostaLower)
                        var tratouFu = await followupAgente.processarEntrada(client, {
                            from: from, msgId: msg.id || null, contextId: (msg.context && msg.context.id) || null,
                            tipo: msgType, texto: resposta, clinicaId: clinicaWa ? clinicaWa.id : null, somenteContexto: ehConfirmacao && !!agFound
                        })
                        if (tratouFu) continue
                    } catch(e) { console.error('[wa-webhook] follow-up:', e.message) }

                    if (!agFound) {
                        console.log('[wa-webhook] Agendamento nao encontrado para tel=' + from)
                        continue
                    }

                    var waToken = (clinicaWa && clinicaWa.whatsapp_token) || process.env.WHATSAPP_TOKEN || ''
                    var waPhoneId = (clinicaWa && clinicaWa.whatsapp_phone_id) || process.env.WHATSAPP_PHONE_ID || ''

                    // Paciente respondeu SIM
                    if (respostaLower === 'sim' || respostaLower === 'yes' || respostaLower === 'confirmo' || respostaLower === 'quick reply') {
                        // Atualiza status do agendamento para confirmado
                        await client.execute({
                            sql: "UPDATE agendamentos SET status='confirmado', atualizado_em=datetime('now') WHERE id=?",
                            args: [agFound.id]
                        })
                        console.log('[wa-webhook] Agendamento #' + agFound.id + ' CONFIRMADO por ' + from)

                        // Envia mensagem de agradecimento
                        if (waToken && waPhoneId) {
                            try {
                                await fetch('https://graph.facebook.com/v23.0/' + waPhoneId + '/messages', {
                                    method: 'POST',
                                    headers: { 'Authorization': 'Bearer ' + waToken, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ messaging_product: 'whatsapp', to: from, type: 'text', text: { body: 'Obrigado pela confirmacao, ' + (agFound.paciente_nome || '').split(' ')[0] + '! Ate breve! ✅' } })
                                })
                            } catch(e) {}
                        }
                    }
                    // Paciente respondeu NÃO
                    else if (respostaLower === 'não' || respostaLower === 'nao' || respostaLower === 'no') {
                        // Atualiza status para "nao_confirmado"
                        await client.execute({
                            sql: "UPDATE agendamentos SET status='nao_confirmado', atualizado_em=datetime('now') WHERE id=?",
                            args: [agFound.id]
                        })
                        console.log('[wa-webhook] Agendamento #' + agFound.id + ' NAO CONFIRMADO por ' + from)

                        // Envia mensagem de reagendamento
                        if (waToken && waPhoneId) {
                            try {
                                await fetch('https://graph.facebook.com/v23.0/' + waPhoneId + '/messages', {
                                    method: 'POST',
                                    headers: { 'Authorization': 'Bearer ' + waToken, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ messaging_product: 'whatsapp', to: from, type: 'text', text: { body: 'Obrigado por avisar, ' + (agFound.paciente_nome || '').split(' ')[0] + '. Nos preparamos para esse momento e um reagendamento esta sujeito a disponibilidade de horarios. Em breve nos entraremos em contato com voce. 📋' } })
                                })
                            } catch(e) {}
                        }
                    }

                    // Registra no log
                    try {
                        await client.execute({
                            sql: "INSERT INTO activity_log(clinica_id, usuario_id, acao, detalhes, created_at) VALUES((SELECT clinica_id FROM agendamentos WHERE id=?), NULL, 'whatsapp_resposta', ?, datetime('now'))",
                            args: [agFound.id, 'Paciente ' + (agFound.paciente_nome || '') + ' respondeu "' + resposta + '" para agendamento #' + agFound.id + ' (tel: ' + from + ')']
                        })
                    } catch(e) {}
                }
            }
        }

        return res.status(200).json({ received: true })
    } catch (error) {
        console.error('[wa-webhook] Error:', error.message)
        return res.status(200).json({ received: true }) // Always return 200 to Meta
    }
}
