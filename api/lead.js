// api/lead.js — Captura de leads do formulário da landing page
// POST /api/lead  { nome, email, whatsapp, clinica?, mensagem? }

var { getClient } = require('./db')
var { setCorsHeaders, checkRateLimit, escapeHtml } = require('./middleware')

async function enviarEmail(para, assunto, html) {
    var resendKey = process.env.RESEND_API_KEY || ''
    var resendFrom = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    if (!resendKey) { console.log('[lead] RESEND_API_KEY ausente — email nao enviado'); return false }
    try {
        var r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: resendFrom, to: [para], subject: assunto, html: html })
        })
        var rd = await r.json()
        console.log('[lead] Resend email to ' + para + ': ' + (r.ok ? 'OK' : JSON.stringify(rd)))
        return r.ok
    } catch(e) {
        console.error('[lead] Resend error:', e.message)
        return false
    }
}

function validarEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'')) }

module.exports = async function handler(req, res) {
    setCorsHeaders(req, res)
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }
    if (req.method !== 'POST') { res.status(405).json({ ok:false, error:'Método não permitido' }); return }

    var ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim()
    if (!checkRateLimit('lead_' + ip, 5, 900000)) {
        res.status(429).json({ ok:false, error:'Muitas tentativas. Tente novamente em alguns minutos.' })
        return
    }

    var body = req.body || {}
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch(e) { body = {} } }

    var nome = String(body.nome || '').trim().slice(0, 120)
    var email = String(body.email || '').trim().toLowerCase().slice(0, 120)
    var whatsapp = String(body.whatsapp || '').trim().slice(0, 20)
    var clinica = String(body.clinica || '').trim().slice(0, 120)
    var mensagem = String(body.mensagem || '').trim().slice(0, 500)

    if (!nome || nome.length < 2) { res.status(400).json({ ok:false, error:'Nome é obrigatório.' }); return }
    if (!validarEmail(email))     { res.status(400).json({ ok:false, error:'Email inválido.' }); return }
    if (!whatsapp || whatsapp.replace(/\D/g,'').length < 10) { res.status(400).json({ ok:false, error:'WhatsApp inválido.' }); return }

    var client = getClient()
    try {
        await client.execute("CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, email TEXT, whatsapp TEXT, clinica TEXT, mensagem TEXT, ip TEXT, origem TEXT, criado_em TEXT DEFAULT (datetime('now')))")
    } catch(e) { console.error('[lead] create table:', e.message) }

    try {
        await client.execute({
            sql: "INSERT INTO leads (nome,email,whatsapp,clinica,mensagem,ip,origem) VALUES (?,?,?,?,?,?,?)",
            args: [nome, email, whatsapp, clinica, mensagem, ip, 'landing']
        })
    } catch(e) {
        console.error('[lead] insert:', e.message)
    }

    var destino = process.env.LEAD_EMAIL_TO || 'contato@klinov.com'
    var html =
        '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1A">' +
        '<h2 style="color:#034030;margin:0 0 16px">Novo lead — Klinov</h2>' +
        '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
        '<tr><td style="padding:8px 0;color:#718096;width:120px">Nome</td><td style="padding:8px 0"><b>' + escapeHtml(nome) + '</b></td></tr>' +
        '<tr><td style="padding:8px 0;color:#718096">Email</td><td style="padding:8px 0"><a href="mailto:' + escapeHtml(email) + '">' + escapeHtml(email) + '</a></td></tr>' +
        '<tr><td style="padding:8px 0;color:#718096">WhatsApp</td><td style="padding:8px 0"><a href="https://wa.me/55' + escapeHtml(whatsapp.replace(/\D/g,'')) + '">' + escapeHtml(whatsapp) + '</a></td></tr>' +
        '<tr><td style="padding:8px 0;color:#718096">Clínica</td><td style="padding:8px 0">' + escapeHtml(clinica || '—') + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#718096;vertical-align:top">Mensagem</td><td style="padding:8px 0;white-space:pre-wrap">' + escapeHtml(mensagem || '—') + '</td></tr>' +
        '<tr><td style="padding:8px 0;color:#718096">IP</td><td style="padding:8px 0;color:#718096">' + escapeHtml(ip) + '</td></tr>' +
        '</table>' +
        '<p style="margin-top:24px;padding-top:16px;border-top:1px solid #E2E8F0;color:#718096;font-size:12px">Recebido via landing page klinov.com</p>' +
        '</div>'

    enviarEmail(destino, 'Novo lead Klinov — ' + nome, html).catch(function(){})

    res.status(200).json({ ok: true })
}
