// api/whatsapp-webhook.js — Webhook do WhatsApp para receber respostas dos pacientes
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')

    // GET: verificação do webhook (Meta envia challenge)
    if (req.method === 'GET') {
        var mode = (req.query || {})['hub.mode']
        var token = (req.query || {})['hub.verify_token']
        var challenge = (req.query || {})['hub.challenge']
        var verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'klinik_verify_2026'
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('[wa-webhook] Verificacao OK')
            return res.status(200).send(challenge)
        }
        return res.status(403).json({ error: 'Token invalido' })
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    try {
        var client = getClient()
        var body = req.body || {}

        // Meta envia dentro de entry[].changes[].value
        var entries = body.entry || []
        for (var ei = 0; ei < entries.length; ei++) {
            var changes = entries[ei].changes || []
            for (var ci = 0; ci < changes.length; ci++) {
                var value = changes[ci].value || {}
                var messages = value.messages || []

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
                        var agR = await client.execute({
                            sql: "SELECT a.id, a.status, a.data_hora, a.paciente_id, COALESCE(p.nome, a.paciente_nome) as paciente_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id WHERE (p.telefone LIKE ? OR a.paciente_telefone LIKE ?) AND DATE(a.data_hora) >= DATE('now') AND DATE(a.data_hora) <= DATE('now', '+2 days') AND a.status NOT IN ('cancelado','realizado') ORDER BY a.data_hora ASC LIMIT 1",
                            args: [telLike, telLike]
                        })
                        if (agR.rows.length) { agFound = agR.rows[0]; break }
                    }

                    if (!agFound) {
                        console.log('[wa-webhook] Agendamento nao encontrado para tel=' + from)
                        continue
                    }

                    var waToken = process.env.WHATSAPP_TOKEN || ''
                    var waPhoneId = process.env.WHATSAPP_PHONE_ID || ''

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
