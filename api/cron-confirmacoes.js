// api/cron-confirmacoes.js — Cron job diário para confirmação de agendamentos
// Roda via Vercel Cron: 0 11 * * * (8h BRT / Campo Grande)
// Multi-tenant: processa TODAS as clínicas

var { getClient } = require('../lib/db')
var { runMigrations } = require('../lib/migrations')

module.exports = async function handler(req, res) {
    // Security: only allow Vercel cron or manual trigger with secret
    var cronSecret = process.env.CRON_SECRET || ''
    var authHeader = req.headers['authorization'] || ''
    if (cronSecret && authHeader !== 'Bearer ' + cronSecret) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
        var client = getClient()
        await runMigrations(client)

        // Follow-up de orçamentos (cron próprio às ~9h de Campo Grande, via
        // rewrite /api/cron-followup → ?tarefa=followup). Roda só ele.
        var tarefa = (req.query || {}).tarefa || (/cron-followup/.test(req.url || '') ? 'followup' : '')

        if (tarefa === 'followup') {
            var fuRes = await require('../lib/followup/motor').executarTodas(client, { sincronizar: (req.query || {}).sync === '1' })
            console.log('[cron] Follow-up de orçamentos:', JSON.stringify(fuRes))
            return res.status(200).json({ success: true, tarefa: 'followup', clinicas: fuRes })
        }

        // Ensure tables exist
        try { await client.execute("CREATE TABLE IF NOT EXISTS campanhas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL, segmento TEXT NOT NULL, filtro_json TEXT, assunto TEXT, template TEXT NOT NULL, status TEXT DEFAULT 'rascunho', agendada_para TEXT, total_destinatarios INTEGER DEFAULT 0, total_enviados INTEGER DEFAULT 0, total_erros INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), clinica_id INTEGER)") } catch(e) {}
        try { await client.execute("CREATE TABLE IF NOT EXISTS envios (id INTEGER PRIMARY KEY AUTOINCREMENT, campanha_id INTEGER, paciente_id INTEGER, canal TEXT NOT NULL, destinatario TEXT, mensagem_final TEXT, status TEXT DEFAULT 'pendente', erro_msg TEXT, enviado_em TEXT, created_at TEXT DEFAULT (datetime('now')), clinica_id INTEGER)") } catch(e) {}
        try { await client.execute("CREATE TABLE IF NOT EXISTS templates_mensagem (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL, assunto TEXT, corpo TEXT NOT NULL, ativo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), clinica_id INTEGER)") } catch(e) {}

        // Get all clinics
        var clinicasR = await client.execute("SELECT id FROM clinicas ORDER BY id")
        if (!clinicasR.rows.length) {
            return res.status(200).json({ success: true, msg: 'Nenhuma clínica cadastrada', enviados: 0 })
        }

        var amanha = new Date()
        amanha.setDate(amanha.getDate() + 1)
        var dataAmanha = amanha.toISOString().slice(0, 10)
        // Cada agendamento escolhe quando receber a confirmação (confirmacao_envio):
        // 'mesmo_dia' | '1_dia' (padrão, também NULL) | '2_dias' | 'nao'
        var dataHoje = new Date().toISOString().slice(0, 10)
        var em2 = new Date(); em2.setDate(em2.getDate() + 2)
        var dataEm2 = em2.toISOString().slice(0, 10)

        var totalGlobalEnv = 0, totalGlobalErr = 0, totalGlobalAg = 0
        var clinicasProcessadas = []

        for (var ci = 0; ci < clinicasR.rows.length; ci++) {
            var clinica_id = clinicasR.rows[ci].id

            // Load per-clinic settings
            var cliCfg = {}
            try {
                var cfgR = await client.execute({ sql: "SELECT nome, cfg_confirmacao_wa, cfg_confirmacao_email, cfg_aniversario, cfg_lembrete_retorno, cfg_cobranca_auto FROM clinicas WHERE id=?", args: [clinica_id] })
                if (cfgR.rows.length) cliCfg = cfgR.rows[0]
            } catch(e) {}

            // Platform credentials (centralized - all clinics use the same)
            var waToken = process.env.WHATSAPP_TOKEN || ''
            var waPhoneId = process.env.WHATSAPP_PHONE_ID || ''
            var resendKey = process.env.RESEND_API_KEY || ''
            var resendFrom = process.env.RESEND_FROM_EMAIL || 'noreply@klinov.com.br'
            var clinicaNome = cliCfg.nome || 'Klinov'

            // Skip if clinic has confirmations disabled
            if (!cliCfg.cfg_confirmacao_wa && !cliCfg.cfg_confirmacao_email) {
                clinicasProcessadas.push({ clinica_id: clinica_id, msg: 'Confirmacoes desativadas', enviados: 0 })
                continue
            }
            var totalEnv = 0, totalErr = 0

            // Load confirmation template for this clinic
            var tplR = await client.execute({ sql: "SELECT * FROM templates_mensagem WHERE tipo='confirmacao' AND ativo=1 AND clinica_id=? LIMIT 1", args: [clinica_id] })
            if (!tplR.rows.length) {
                clinicasProcessadas.push({ clinica_id: clinica_id, msg: 'Sem template de confirmação', enviados: 0 })
                continue
            }
            var tpl = tplR.rows[0]

            // Get tomorrow's appointments for this clinic
            var agR = await client.execute({
                sql: "SELECT a.id,a.data_hora,a.hora_fim,a.procedimento,a.tipo,a.paciente_id,a.canal_envio,COALESCE(p.nome,a.paciente_nome) as paciente_nome,p.email,p.telefone,COALESCE(pr.nome,a.profissional_nome) as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE ((DATE(a.data_hora)=? AND a.confirmacao_envio='mesmo_dia') OR (DATE(a.data_hora)=? AND (a.confirmacao_envio IS NULL OR a.confirmacao_envio='1_dia')) OR (DATE(a.data_hora)=? AND a.confirmacao_envio='2_dias')) AND (a.status IS NULL OR a.status NOT IN ('cancelado','realizado','desmarcado')) AND a.clinica_id=?",
                args: [dataHoje, dataAmanha, dataEm2, clinica_id]
            })

            if (!agR.rows.length) {
                clinicasProcessadas.push({ clinica_id: clinica_id, msg: 'Nenhum agendamento', enviados: 0 })
                continue
            }

            totalGlobalAg += agR.rows.length

            for (var i = 0; i < agR.rows.length; i++) {
                var ag = agR.rows[i]
                var hora = (ag.data_hora || '').slice(11, 16) || '—'
                var dataFmt = String(ag.data_hora || dataAmanha).slice(0, 10).split('-').reverse().join('/')

                // Check if already sent for this appointment
                var alreadySent = await client.execute({
                    sql: "SELECT id FROM envios WHERE paciente_id=? AND canal IN ('email','whatsapp') AND mensagem_final LIKE ? AND DATE(enviado_em)>=DATE('now','-1 day') AND clinica_id=?",
                    args: [ag.paciente_id || 0, '%' + dataFmt + '%', clinica_id]
                })
                if (alreadySent.rows.length) continue

                var vars = {
                    nome: ag.paciente_nome || '',
                    data_consulta: dataFmt,
                    hora: hora,
                    profissional: ag.profissional_nome || '',
                    procedimento: ag.procedimento || ag.tipo || 'Consulta'
                }
                var msgFinal = (tpl.corpo || '').replace(/\{\{(\w+)\}\}/g, function(_, key) { return vars[key] || '' })

                // Send email (only if clinic enabled it)
                if (cliCfg.cfg_confirmacao_email && resendKey && ag.email && (!ag.canal_envio || ag.canal_envio === 'email' || ag.canal_envio === 'ambos')) {
                    try {
                        var emailRes = await fetch('https://api.resend.com/emails', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                from: resendFrom,
                                to: [ag.email],
                                subject: tpl.assunto || 'Confirmação de Consulta',
                                html: msgFinal.replace(/\n/g, '<br>')
                            })
                        })
                        var envSt = emailRes.ok ? 'enviado' : 'erro'
                        var envErr = emailRes.ok ? '' : await emailRes.text()
                        if (emailRes.ok) totalEnv++; else totalErr++
                        await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em,clinica_id) VALUES(?,?,?,?,?,?,datetime('now'),?)", args: [ag.paciente_id, 'email', ag.email, msgFinal, envSt, envErr, clinica_id] })
                    } catch(e) {
                        totalErr++
                        await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em,clinica_id) VALUES(?,?,?,?,?,?,datetime('now'),?)", args: [ag.paciente_id, 'email', ag.email, msgFinal, 'erro', e.message, clinica_id] })
                    }
                }

                // Send WhatsApp (only if clinic enabled it)
                if (cliCfg.cfg_confirmacao_wa && waToken && waPhoneId && ag.telefone && (!ag.canal_envio || ag.canal_envio === 'whatsapp' || ag.canal_envio === 'ambos')) {
                    try {
                        var waPhone = (ag.telefone || '').replace(/\D/g, '')
                        if (waPhone.length <= 11) waPhone = '55' + waPhone
                        // Try template first (required by Meta to initiate conversation)
                        var waTemplateName = process.env.WHATSAPP_TEMPLATE_NAME || 'confirmacao_consulta'
                        var waBody
                        if (waTemplateName) {
                            waBody = {
                                messaging_product: 'whatsapp', to: waPhone, type: 'template',
                                template: {
                                    name: waTemplateName, language: { code: 'pt_BR' },
                                    components: [
                                        { type: 'body', parameters: [
                                            { type: 'text', text: (ag.paciente_nome || '').split(' ')[0] },
                                            { type: 'text', text: dataFmt + ' as ' + hora },
                                            { type: 'text', text: ag.profissional_nome || '' }
                                        ]}
                                    ]
                                }
                            }
                        } else {
                            waBody = { messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: msgFinal } }
                        }
                        var waRes = await fetch('https://graph.facebook.com/v23.0/' + waPhoneId + '/messages', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + waToken, 'Content-Type': 'application/json' },
                            body: JSON.stringify(waBody)
                        })
                        var waSt = waRes.ok ? 'enviado' : 'erro'
                        var waErr = waRes.ok ? '' : await waRes.text()
                        if (waRes.ok) totalEnv++; else { totalErr++; console.error('[cron-wa] Erro:', waErr) }
                        await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em,clinica_id) VALUES(?,?,?,?,?,?,datetime('now'),?)", args: [ag.paciente_id, 'whatsapp', waPhone, msgFinal, waSt, waErr, clinica_id] })
                    } catch(e) {
                        totalErr++
                        await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em,clinica_id) VALUES(?,?,?,?,?,?,datetime('now'),?)", args: [ag.paciente_id, 'whatsapp', ag.telefone, msgFinal, 'erro', e.message, clinica_id] })
                    }
                }
            }

            totalGlobalEnv += totalEnv
            totalGlobalErr += totalErr
            clinicasProcessadas.push({ clinica_id: clinica_id, agendamentos: agR.rows.length, enviados: totalEnv, erros: totalErr })
        }

        // ── ANIVERSÁRIO E LEMBRETE DE RETORNO (por e-mail, se a clínica ativou) ──
        var extraTotal = { aniversario: 0, retorno: 0 }
        var rkExtra = process.env.RESEND_API_KEY || ''
        var hojeCG = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10)
        var em7 = new Date(Date.now() - 4 * 3600 * 1000 + 7 * 86400000).toISOString().slice(0, 10)
        async function emailPaciente(cid, pac, tipo, marca, vars) {
            var ja = await client.execute({ sql: "SELECT id FROM envios WHERE paciente_id=? AND canal='email' AND mensagem_final LIKE ? AND clinica_id=? LIMIT 1", args: [pac.id, '%' + marca + '%', cid] })
            if (ja.rows.length) return 0
            var tp = (await client.execute({ sql: "SELECT assunto, corpo FROM templates_mensagem WHERE tipo=? AND ativo=1 AND clinica_id=? ORDER BY id LIMIT 1", args: [tipo, cid] })).rows[0]
            if (!tp) return 0
            var corpo = String(tp.corpo || '').replace(/\{\{(\w+)\}\}/g, function (_, k) { return vars[k] || '' })
            var er = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + rkExtra, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'noreply@klinov.com.br', to: [pac.email], subject: tp.assunto || 'Klinov', html: corpo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '<span style="display:none">' + marca + '</span>' }) })
            await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em,clinica_id) VALUES(?,?,?,?,?,?,datetime('now'),?)", args: [pac.id, 'email', pac.email, corpo + ' ' + marca, er.ok ? 'enviado' : 'erro', er.ok ? '' : (await er.text()).slice(0, 300), cid] })
            return er.ok ? 1 : 0
        }
        if (rkExtra) {
            for (var exi = 0; exi < clinicasR.rows.length; exi++) {
                var exCid = clinicasR.rows[exi].id
                try {
                    var exCfg = (await client.execute({ sql: "SELECT nome, cfg_aniversario, cfg_lembrete_retorno FROM clinicas WHERE id=?", args: [exCid] })).rows[0] || {}
                    if (exCfg.cfg_aniversario) {
                        var anivs = await client.execute({ sql: "SELECT id, nome, email FROM pacientes WHERE clinica_id=? AND COALESCE(ativo,1)=1 AND COALESCE(email,'')<>'' AND COALESCE(aceita_marketing,1)=1 AND (substr(data_nascimento,6,5)=? OR (data_nascimento LIKE '__/__/____' AND substr(data_nascimento,4,2)||'-'||substr(data_nascimento,1,2)=?)) LIMIT 300", args: [exCid, hojeCG.slice(5), hojeCG.slice(5)] })
                        for (var ai = 0; ai < anivs.rows.length; ai++) extraTotal.aniversario += await emailPaciente(exCid, anivs.rows[ai], 'aniversario', '[aniv-' + hojeCG.slice(0, 4) + ']', { nome: String(anivs.rows[ai].nome || '').split(' ')[0], clinica: exCfg.nome || '' })
                    }
                    if (exCfg.cfg_lembrete_retorno) {
                        var rets = await client.execute({ sql: "SELECT ar.id rid, p.id, p.nome, p.email FROM alertas_retorno ar JOIN pacientes p ON p.id=ar.paciente_id AND p.clinica_id=ar.clinica_id WHERE ar.clinica_id=? AND COALESCE(ar.status,'pendente')='pendente' AND ar.data_retorno=? AND COALESCE(p.email,'')<>'' LIMIT 300", args: [exCid, em7] })
                        for (var ri = 0; ri < rets.rows.length; ri++) extraTotal.retorno += await emailPaciente(exCid, rets.rows[ri], 'retorno', '[retorno-' + rets.rows[ri].rid + ']', { nome: String(rets.rows[ri].nome || '').split(' ')[0], clinica: exCfg.nome || '' })
                    }
                } catch (e) { console.error('[cron] aniversário/retorno clinica ' + exCid + ':', e.message) }
            }
        }
        console.log('[cron] Aniversário/retorno:', JSON.stringify(extraTotal))

        // ── RÉGUA DE COBRANÇA (lembretes antes/depois do vencimento) ──
        var reguaTotal = { enviados: 0, erros: 0, ignorados: 0 }
        var { executarRegua } = require('../lib/rotas/financeiro-controles')
        var rgHoje = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10)
        async function enviarCobranca(canal, destino, texto, v) {
            if (canal === 'email') {
                var rk = process.env.RESEND_API_KEY || ''
                if (!rk) return { ok: false, status: 'sem_canal', erro: 'E-mail não configurado' }
                var er = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + rk, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'noreply@klinov.com.br', to: [destino], subject: 'Lembrete de pagamento' + (v.clinica ? ' — ' + v.clinica : ''), html: texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') }) })
                return er.ok ? { ok: true } : { ok: false, erro: (await er.text()).slice(0, 300) }
            }
            // WhatsApp só sai por template aprovado na Meta (mensagem iniciada pela clínica)
            var tplNome = process.env.WHATSAPP_TEMPLATE_COBRANCA || ''
            if (!tplNome || !process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) return { ok: false, status: 'sem_template', erro: 'Template de cobrança do WhatsApp não configurado' }
            var fone = destino.length <= 11 ? '55' + destino : destino
            var wr = await fetch('https://graph.facebook.com/v23.0/' + process.env.WHATSAPP_PHONE_ID + '/messages', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product: 'whatsapp', to: fone, type: 'template', template: { name: tplNome, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: v.nome || 'paciente' }, { type: 'text', text: v.valor }, { type: 'text', text: v.vencimento }] }] } }) })
            return wr.ok ? { ok: true } : { ok: false, erro: (await wr.text()).slice(0, 300) }
        }
        for (var rgi = 0; rgi < clinicasR.rows.length; rgi++) {
            try {
                var rgR = await executarRegua(client, clinicasR.rows[rgi].id, rgHoje, enviarCobranca)
                reguaTotal.enviados += rgR.enviados; reguaTotal.erros += rgR.erros; reguaTotal.ignorados += rgR.ignorados
            } catch(e) { console.error('[cron] régua clinica ' + clinicasR.rows[rgi].id + ':', e.message) }
        }
        console.log('[cron] Régua de cobrança:', JSON.stringify(reguaTotal))

        // ── GERAÇÃO DE CONTAS RECORRENTES ──
        var grTotal = 0
        for (var gri = 0; gri < clinicasR.rows.length; gri++) {
            var grClinica = clinicasR.rows[gri].id
            try {
                var grProxMes = new Date()
                grProxMes.setMonth(grProxMes.getMonth() + 1)
                var grProxMesStr = grProxMes.toISOString().slice(0, 7)

                var grContas = await client.execute({
                    sql: "SELECT DISTINCT cp.descricao, cp.fornecedor, cp.valor, cp.vencimento, cp.classificacao, cp.categoria, cp.categoria_id, cp.frequencia, cp.total_parcelas, MAX(cp.parcela_atual) as max_parcela FROM contas_pagar cp WHERE cp.recorrente=1 AND cp.clinica_id=? AND NOT EXISTS (SELECT 1 FROM contas_pagar x WHERE x.descricao=cp.descricao AND x.clinica_id=cp.clinica_id AND strftime('%Y-%m',x.vencimento)=?) GROUP BY cp.descricao",
                    args: [grClinica, grProxMesStr]
                })

                for (var grj = 0; grj < grContas.rows.length; grj++) {
                    var grC = grContas.rows[grj]
                    var grNewParcela = (grC.max_parcela || 1) + 1
                    if (grC.total_parcelas && grC.total_parcelas > 0 && grNewParcela > grC.total_parcelas) continue

                    var grUlt = new Date(grC.vencimento + 'T12:00:00')
                    var grNext = new Date(grUlt)
                    var monthsDiff = grNewParcela - 1
                    if (grC.frequencia === 'semanal') grNext.setDate(grUlt.getDate() + 7 * monthsDiff)
                    else if (grC.frequencia === 'quinzenal') grNext.setDate(grUlt.getDate() + 15 * monthsDiff)
                    else grNext.setMonth(grUlt.getMonth() + monthsDiff)

                    await client.execute({
                        sql: "INSERT INTO contas_pagar(clinica_id, descricao, fornecedor, valor, vencimento, classificacao, categoria, categoria_id, recorrente, frequencia, total_parcelas, parcela_atual, status) VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?)",
                        args: [grClinica, grC.descricao, grC.fornecedor || '', grC.valor, grNext.toISOString().slice(0, 10), grC.classificacao || '', grC.categoria || '', grC.categoria_id || null, grC.frequencia || 'mensal', grC.total_parcelas || 0, grNewParcela, 'aberta']
                    })
                    grTotal++
                }
            } catch(e) { console.error('[cron] recorrentes clinica ' + grClinica + ':', e.message) }
        }
        console.log('[cron] Recorrentes geradas: ' + grTotal)

        // ── VERIFICAÇÃO DE VENCIMENTOS (parcelas + contas a pagar) ──
        var vvHoje = new Date().toISOString().slice(0, 10)
        var vvParcTotal = 0, vvCPTotal = 0
        for (var vi = 0; vi < clinicasR.rows.length; vi++) {
            var vClinica = clinicasR.rows[vi].id
            try {
                var vvP = await client.execute({ sql: "UPDATE parcelas_orcamento SET status='vencido', updated_at=datetime('now') WHERE data_vencimento < ? AND status='pendente' AND clinica_id=?", args: [vvHoje, vClinica] })
                vvParcTotal += (vvP.rowsAffected || 0)
                var vvC = await client.execute({ sql: "UPDATE contas_pagar SET status='vencida' WHERE vencimento < ? AND status='aberta' AND clinica_id=?", args: [vvHoje, vClinica] })
                vvCPTotal += (vvC.rowsAffected || 0)
            } catch(e) { console.error('[cron] vencimentos clinica ' + vClinica + ':', e.message) }
        }
        console.log('[cron] Vencimentos: ' + vvParcTotal + ' parcelas, ' + vvCPTotal + ' contas a pagar')

        return res.status(200).json({
            success: true,
            data: dataAmanha,
            clinicas: clinicasProcessadas.length,
            agendamentos: totalGlobalAg,
            enviados: totalGlobalEnv,
            erros: totalGlobalErr,
            recorrentes_geradas: grTotal,
            vencimentos: { parcelas: vvParcTotal, contas_pagar: vvCPTotal },
            detalhes: clinicasProcessadas
        })
    } catch (error) {
        console.error('[cron-confirmacoes]', error.message)
        return res.status(500).json({ success: false, error: error.message })
    }
}
