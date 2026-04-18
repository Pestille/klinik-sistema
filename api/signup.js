// api/signup.js — Endpoints públicos: cadastro de clínicas + captura de leads
// Klinov — Campo Grande, MS
// Actions:
//   ?action=registrar → cadastra clínica + admin (trial 14 dias)
//   ?action=lead      → registra lead do formulário da landing

var bcrypt = require('bcryptjs')
var { getClient } = require('./db')
var { setCorsHeaders, checkRateLimit, escapeHtml } = require('./middleware')

async function enviarEmail(para, assunto, html) {
    var resendKey = process.env.RESEND_API_KEY || ''
    var resendFrom = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    if (!resendKey) { console.log('[signup] RESEND_API_KEY ausente — email nao enviado'); return false }
    try {
        var r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: resendFrom, to: [para], subject: assunto, html: html })
        })
        var rd = await r.json()
        console.log('[signup] Resend email to ' + para + ': ' + (r.ok ? 'OK' : JSON.stringify(rd)))
        return r.ok
    } catch(e) {
        console.error('[signup] Resend error:', e.message)
        return false
    }
}

function validarEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'')) }

async function handleLead(req, res, client) {
    var ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim()
    if (!checkRateLimit('lead_' + ip, 5, 900000)) {
        return res.status(429).json({ ok:false, error:'Muitas tentativas. Tente novamente em alguns minutos.' })
    }

    var body = req.body || {}
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch(e) { body = {} } }

    var nome     = String(body.nome || '').trim().slice(0, 120)
    var email    = String(body.email || '').trim().toLowerCase().slice(0, 120)
    var whatsapp = String(body.whatsapp || '').trim().slice(0, 20)
    var clinica  = String(body.clinica || '').trim().slice(0, 120)
    var mensagem = String(body.mensagem || '').trim().slice(0, 500)

    if (!nome || nome.length < 2) return res.status(400).json({ ok:false, error:'Nome é obrigatório.' })
    if (!validarEmail(email))     return res.status(400).json({ ok:false, error:'Email inválido.' })
    if (!whatsapp || whatsapp.replace(/\D/g,'').length < 10) return res.status(400).json({ ok:false, error:'WhatsApp inválido.' })

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

    return res.status(200).json({ ok: true })
}

module.exports = async function handler(req, res) {
    setCorsHeaders(req, res)
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var q = req.query || {}
    var action = q.action || ''
    var client = getClient()

    // Public lead capture from landing page
    if (action === 'lead') {
        if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'POST required' })
        return await handleLead(req, res, client)
    }

    if (action !== 'registrar') {
        return res.status(400).json({ success: false, error: 'Action inválida', actions: ['registrar','lead'] })
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'POST required' })
    }

    // Garante que tabelas existem
    try {
        await client.execute("CREATE TABLE IF NOT EXISTS clinicas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, plano TEXT DEFAULT 'trial', plano_inicio TEXT, plano_fim TEXT, status_pagamento TEXT DEFAULT 'ativo', criado_em TEXT DEFAULT (datetime('now')))")
        await client.execute("CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT, perfil TEXT DEFAULT 'recepcionista', ativo INTEGER DEFAULT 1, deve_redefinir INTEGER DEFAULT 0, criado_em TEXT DEFAULT (datetime('now')), ultimo_login TEXT)")
        await client.execute("CREATE TABLE IF NOT EXISTS templates_marketing (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, tipo TEXT NOT NULL, nome TEXT NOT NULL, assunto TEXT, conteudo TEXT, ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')))")
    } catch(e) {
        console.error('[signup] Erro ao criar tabelas:', e.message)
    }

    var b = req.body || {}

    // Validação
    if (!b.clinica_nome || !b.nome || !b.email || !b.senha) {
        return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios: clinica_nome, nome, email, senha' })
    }

    var email = b.email.toLowerCase().trim()
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, error: 'E-mail inválido' })
    }

    if (b.senha.length < 8) {
        return res.status(400).json({ success: false, error: 'Senha deve ter no mínimo 8 caracteres' })
    }

    // Verifica unicidade do email
    try {
        var existe = await client.execute({ sql: "SELECT id FROM usuarios WHERE email=?", args: [email] })
        if (existe.rows.length) {
            return res.status(409).json({ success: false, error: 'E-mail já cadastrado. Faça login ou use outro e-mail.' })
        }
    } catch(e) {
        console.error('[signup] Erro ao verificar email:', e.message)
        return res.status(500).json({ success: false, error: 'Erro interno ao verificar e-mail' })
    }

    // Cria clínica
    try {
        var agora = new Date().toISOString()
        var fim = new Date()
        fim.setDate(fim.getDate() + 14)
        var fimISO = fim.toISOString()

        var rClinica = await client.execute({
            sql: "INSERT INTO clinicas(nome, plano, plano_inicio, plano_fim, status_pagamento) VALUES(?,?,?,?,?)",
            args: [b.clinica_nome.trim(), 'trial', agora, fimISO, 'ativo']
        })
        var clinicaId = Number(rClinica.lastInsertRowid)

        // Cria usuário admin
        var senhaHash = bcrypt.hashSync(b.senha, 10)
        await client.execute({
            sql: "INSERT INTO usuarios(clinica_id, nome, email, senha_hash, perfil, ativo, deve_redefinir) VALUES(?,?,?,?,?,?,?)",
            args: [clinicaId, b.nome.trim(), email, senhaHash, 'admin', 1, 0]
        })

        // Cria templates padrão
        var templates = [
            {
                tipo: 'confirmacao',
                nome: 'Confirmação de Consulta',
                assunto: 'Confirmação de consulta — {clinica_nome}',
                conteudo: 'Olá {paciente_nome}, sua consulta está confirmada para {data} às {hora}. Clínica {clinica_nome}.'
            },
            {
                tipo: 'aniversario',
                nome: 'Feliz Aniversário',
                assunto: 'Feliz Aniversário, {paciente_nome}! 🎂',
                conteudo: 'Olá {paciente_nome}, a equipe da {clinica_nome} deseja um feliz aniversário! Aproveite para agendar sua consulta de rotina.'
            },
            {
                tipo: 'retorno',
                nome: 'Lembrete de Retorno',
                assunto: 'Hora de voltar — {clinica_nome}',
                conteudo: 'Olá {paciente_nome}, faz tempo que não nos visitamos. Agende seu retorno na {clinica_nome} e cuide do seu sorriso!'
            }
        ]

        for (var i = 0; i < templates.length; i++) {
            var t = templates[i]
            await client.execute({
                sql: "INSERT INTO templates_marketing(clinica_id, tipo, nome, assunto, conteudo) VALUES(?,?,?,?,?)",
                args: [clinicaId, t.tipo, t.nome, t.assunto, t.conteudo]
            })
        }

        return res.status(200).json({ success: true, msg: 'Clínica cadastrada', clinica_id: clinicaId })

    } catch(e) {
        console.error('[signup] Erro ao cadastrar clínica:', e.message)
        return res.status(500).json({ success: false, error: 'Erro interno ao cadastrar. Tente novamente.' })
    }
}
