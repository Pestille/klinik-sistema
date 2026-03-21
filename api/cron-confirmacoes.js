// api/cron-confirmacoes.js — Cron job diário para confirmação de agendamentos
// Roda via Vercel Cron: 0 11 * * * (8h BRT / Campo Grande)

var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    // Security: only allow Vercel cron or manual trigger with secret
    var cronSecret = process.env.CRON_SECRET || ''
    var authHeader = req.headers['authorization'] || ''
    if (cronSecret && authHeader !== 'Bearer ' + cronSecret) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
        var client = getClient()

        // Ensure tables exist
        try { await client.execute("CREATE TABLE IF NOT EXISTS campanhas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL, segmento TEXT NOT NULL, filtro_json TEXT, assunto TEXT, template TEXT NOT NULL, status TEXT DEFAULT 'rascunho', agendada_para TEXT, total_destinatarios INTEGER DEFAULT 0, total_enviados INTEGER DEFAULT 0, total_erros INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))") } catch(e) {}
        try { await client.execute("CREATE TABLE IF NOT EXISTS envios (id INTEGER PRIMARY KEY AUTOINCREMENT, campanha_id INTEGER, paciente_id INTEGER, canal TEXT NOT NULL, destinatario TEXT, mensagem_final TEXT, status TEXT DEFAULT 'pendente', erro_msg TEXT, enviado_em TEXT, created_at TEXT DEFAULT (datetime('now')))") } catch(e) {}
        try { await client.execute("CREATE TABLE IF NOT EXISTS templates_mensagem (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL, assunto TEXT, corpo TEXT NOT NULL, ativo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))") } catch(e) {}

        // Load confirmation template
        var tplR = await client.execute("SELECT * FROM templates_mensagem WHERE tipo='confirmacao' AND ativo=1 LIMIT 1")
        if (!tplR.rows.length) {
            return res.status(200).json({ success: true, msg: 'Nenhum template de confirmação ativo', enviados: 0 })
        }
        var tpl = tplR.rows[0]

        // Get tomorrow's appointments
        var amanha = new Date()
        amanha.setDate(amanha.getDate() + 1)
        var dataAmanha = amanha.toISOString().slice(0, 10)

        var agR = await client.execute({
            sql: "SELECT a.id,a.data_hora,a.hora_fim,a.procedimento,a.tipo,a.paciente_id,COALESCE(p.nome,a.paciente_nome) as paciente_nome,p.email,p.telefone,COALESCE(pr.nome,a.profissional_nome) as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND (a.status IS NULL OR a.status NOT IN ('cancelado','realizado'))",
            args: [dataAmanha]
        })

        if (!agR.rows.length) {
            return res.status(200).json({ success: true, msg: 'Nenhum agendamento para amanhã', data: dataAmanha, enviados: 0 })
        }

        var resendKey = process.env.RESEND_API_KEY || ''
        var resendFrom = process.env.RESEND_FROM_EMAIL || 'noreply@klinik.com.br'
        var waToken = process.env.WHATSAPP_TOKEN || ''
        var waPhoneId = process.env.WHATSAPP_PHONE_ID || ''

        var totalEnv = 0, totalErr = 0

        for (var i = 0; i < agR.rows.length; i++) {
            var ag = agR.rows[i]
            var hora = (ag.data_hora || '').slice(11, 16) || '—'
            var dataFmt = dataAmanha.split('-').reverse().join('/')

            // Check if already sent for this appointment
            var alreadySent = await client.execute({
                sql: "SELECT id FROM envios WHERE paciente_id=? AND canal IN ('email','whatsapp') AND mensagem_final LIKE ? AND DATE(enviado_em)>=DATE('now','-1 day')",
                args: [ag.paciente_id || 0, '%' + dataAmanha + '%']
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

            // Send email
            if (resendKey && ag.email) {
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
                    await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em) VALUES(?,?,?,?,?,?,datetime('now'))", args: [ag.paciente_id, 'email', ag.email, msgFinal, envSt, envErr] })
                } catch(e) {
                    totalErr++
                    await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em) VALUES(?,?,?,?,?,?,datetime('now'))", args: [ag.paciente_id, 'email', ag.email, msgFinal, 'erro', e.message] })
                }
            }

            // Send WhatsApp
            if (waToken && waPhoneId && ag.telefone) {
                try {
                    var waPhone = (ag.telefone || '').replace(/\D/g, '')
                    if (waPhone.length <= 11) waPhone = '55' + waPhone
                    var waRes = await fetch('https://graph.facebook.com/v21.0/' + waPhoneId + '/messages', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + waToken, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: msgFinal } })
                    })
                    var waSt = waRes.ok ? 'enviado' : 'erro'
                    var waErr = waRes.ok ? '' : await waRes.text()
                    if (waRes.ok) totalEnv++; else totalErr++
                    await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em) VALUES(?,?,?,?,?,?,datetime('now'))", args: [ag.paciente_id, 'whatsapp', ag.telefone, msgFinal, waSt, waErr] })
                } catch(e) {
                    totalErr++
                    await client.execute({ sql: "INSERT INTO envios(paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em) VALUES(?,?,?,?,?,?,datetime('now'))", args: [ag.paciente_id, 'whatsapp', ag.telefone, msgFinal, 'erro', e.message] })
                }
            }
        }

        return res.status(200).json({
            success: true,
            data: dataAmanha,
            agendamentos: agR.rows.length,
            enviados: totalEnv,
            erros: totalErr
        })
    } catch (error) {
        console.error('[cron-confirmacoes]', error.message)
        return res.status(500).json({ success: false, error: error.message })
    }
}
