// api/auth.js — Autenticação de usuários (Turso)
// Rotas: login, logout, me, criar-usuario, listar-usuarios, alterar-senha, redefinir-senha

var crypto = require('crypto')
var nodemailer = require('nodemailer')
var { getClient } = require('./db')

function hashSenha(senha) {
    return crypto.createHash('sha256').update(senha + '_klinik_salt_2026').digest('hex')
}

function gerarToken() {
    return crypto.randomBytes(32).toString('hex')
}

function validarSenha(senha) {
    if (!senha || senha.length < 8) return 'Senha deve ter no mínimo 8 caracteres'
    if (!/[0-9]/.test(senha)) return 'Senha deve conter pelo menos 1 número'
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(senha)) return 'Senha deve conter pelo menos 1 caractere especial (!@#$%...)'
    return null
}

// Envio de email via Gmail SMTP (nodemailer)
// Configurar no Vercel: EMAIL_USER (gmail) e EMAIL_PASS (senha de app)
async function enviarEmail(para, assunto, html) {
    var user = process.env.EMAIL_USER
    var pass = process.env.EMAIL_PASS
    if (!user || !pass) { console.log('[auth] EMAIL_USER/EMAIL_PASS não configurados'); return false }
    try {
        var transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: user, pass: pass }
        })
        await transporter.sendMail({
            from: 'Klinik Sistema <' + user + '>',
            to: para,
            subject: assunto,
            html: html
        })
        return true
    } catch(e) {
        console.error('[auth] Erro ao enviar email:', e.message)
        return false
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var q = req.query || {}
    var action = q.action || ''
    var client = getClient()

    // Garante que tabelas existem
    try {
        await client.execute("CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT, perfil TEXT DEFAULT 'recepcionista', ativo INTEGER DEFAULT 1, deve_redefinir INTEGER DEFAULT 0, criado_em TEXT DEFAULT (datetime('now')), ultimo_login TEXT)")
        await client.execute("CREATE TABLE IF NOT EXISTS sessoes (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, token TEXT UNIQUE NOT NULL, criado_em TEXT DEFAULT (datetime('now')), expira_em TEXT)")
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN deve_redefinir INTEGER DEFAULT 0") } catch(e) {}
    } catch(e) {}

    // ── LOGIN ──────────────────────────────────────────────────
    if (action === 'login') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var b = req.body || {}
        if (!b.email || !b.senha) return res.status(400).json({ success: false, error: 'Email e senha obrigatórios' })

        var hash = hashSenha(b.senha)
        var r = await client.execute({ sql: "SELECT id,nome,email,perfil,ativo,deve_redefinir FROM usuarios WHERE email=? AND senha_hash=?", args: [b.email.toLowerCase().trim(), hash] })
        if (!r.rows.length) return res.status(401).json({ success: false, error: 'Email ou senha inválidos' })

        var user = r.rows[0]
        if (!user.ativo) return res.status(403).json({ success: false, error: 'Usuário desativado' })

        // Se deve redefinir, retorna flag (frontend mostrará tela de redefinição)
        if (user.deve_redefinir) {
            return res.status(200).json({ success: true, deve_redefinir: true, usuario_id: user.id, nome: user.nome })
        }

        // Cria sessão (expira em 7 dias)
        var token = gerarToken()
        var expira = new Date(); expira.setDate(expira.getDate() + 7)
        await client.execute({ sql: "INSERT INTO sessoes(usuario_id,token,expira_em) VALUES(?,?,?)", args: [user.id, token, expira.toISOString()] })
        await client.execute({ sql: "UPDATE usuarios SET ultimo_login=datetime('now') WHERE id=?", args: [user.id] })

        return res.status(200).json({ success: true, token: token, usuario: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil } })
    }

    // ── REDEFINIR SENHA (primeiro acesso) ─────────────────────
    if (action === 'redefinir-senha') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var br = req.body || {}
        if (!br.usuario_id || !br.nova_senha) return res.status(400).json({ success: false, error: 'usuario_id e nova_senha obrigatórios' })

        var erroSenha = validarSenha(br.nova_senha)
        if (erroSenha) return res.status(400).json({ success: false, error: erroSenha })

        var hashR = hashSenha(br.nova_senha)
        await client.execute({ sql: "UPDATE usuarios SET senha_hash=?, deve_redefinir=0 WHERE id=?", args: [hashR, br.usuario_id] })
        await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [br.usuario_id] })

        // Cria nova sessão
        var tokenR = gerarToken()
        var expiraR = new Date(); expiraR.setDate(expiraR.getDate() + 7)
        await client.execute({ sql: "INSERT INTO sessoes(usuario_id,token,expira_em) VALUES(?,?,?)", args: [br.usuario_id, tokenR, expiraR.toISOString()] })
        await client.execute({ sql: "UPDATE usuarios SET ultimo_login=datetime('now') WHERE id=?", args: [br.usuario_id] })

        var udata = await client.execute({ sql: "SELECT id,nome,email,perfil FROM usuarios WHERE id=?", args: [br.usuario_id] })
        var urow = udata.rows[0] || {}

        return res.status(200).json({ success: true, token: tokenR, usuario: { id: urow.id, nome: urow.nome, email: urow.email, perfil: urow.perfil } })
    }

    // ── ME (verificar sessão) ──────────────────────────────────
    if (action === 'me') {
        var authHeader = req.headers.authorization || ''
        var token2 = authHeader.replace('Bearer ', '') || q.token || ''
        if (!token2) return res.status(401).json({ success: false, error: 'Token não fornecido' })

        var s = await client.execute({ sql: "SELECT s.usuario_id, s.expira_em, u.nome, u.email, u.perfil FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=? AND u.ativo=1", args: [token2] })
        if (!s.rows.length) return res.status(401).json({ success: false, error: 'Sessão inválida' })

        var sess = s.rows[0]
        if (new Date(sess.expira_em) < new Date()) {
            await client.execute({ sql: "DELETE FROM sessoes WHERE token=?", args: [token2] })
            return res.status(401).json({ success: false, error: 'Sessão expirada' })
        }

        return res.status(200).json({ success: true, usuario: { id: sess.usuario_id, nome: sess.nome, email: sess.email, perfil: sess.perfil } })
    }

    // ── LOGOUT ─────────────────────────────────────────────────
    if (action === 'logout') {
        var tk = (req.headers.authorization || '').replace('Bearer ', '') || q.token || ''
        if (tk) await client.execute({ sql: "DELETE FROM sessoes WHERE token=?", args: [tk] })
        return res.status(200).json({ success: true })
    }

    // ── CRIAR USUÁRIO ──────────────────────────────────────────
    if (action === 'criar-usuario') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var b2 = req.body || {}
        if (!b2.nome || !b2.email) return res.status(400).json({ success: false, error: 'Nome e email obrigatórios' })

        var existe = await client.execute({ sql: "SELECT id FROM usuarios WHERE email=?", args: [b2.email.toLowerCase().trim()] })
        if (existe.rows.length) return res.status(409).json({ success: false, error: 'Email já cadastrado' })

        // Gera senha temporária
        var senhaTemp = crypto.randomBytes(4).toString('hex') // 8 chars hex
        var hash2 = hashSenha(senhaTemp)
        var perfil = b2.perfil || 'recepcionista'
        var validos = ['admin', 'dentista', 'recepcionista']
        if (validos.indexOf(perfil) === -1) perfil = 'recepcionista'

        await client.execute({ sql: "INSERT INTO usuarios(nome,email,senha_hash,perfil,deve_redefinir) VALUES(?,?,?,?,1)", args: [b2.nome.trim(), b2.email.toLowerCase().trim(), hash2, perfil] })

        // Envia email com senha temporária
        var siteUrl = 'https://klinik-sistema.vercel.app'
        var emailHtml = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f5f5f5">' +
            '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.1)">' +
            '<div style="text-align:center;margin-bottom:24px"><span style="font-size:22px;font-weight:700;color:#1B5E3B">KLINIK SISTEMA</span></div>' +
            '<p style="color:#333;font-size:15px">Olá <strong>' + b2.nome.trim() + '</strong>,</p>' +
            '<p style="color:#555;font-size:14px">Sua conta foi criada no Klinik Sistema com o perfil <strong>' + perfil.toUpperCase() + '</strong>.</p>' +
            '<div style="background:#f8f8f8;border-radius:6px;padding:16px;margin:20px 0;border-left:4px solid #E65100">' +
            '<p style="margin:0 0 8px;font-size:13px;color:#666">Seus dados de acesso:</p>' +
            '<p style="margin:0;font-size:14px"><strong>Email:</strong> ' + b2.email.toLowerCase().trim() + '</p>' +
            '<p style="margin:4px 0 0;font-size:14px"><strong>Senha temporária:</strong> <code style="background:#eee;padding:2px 8px;border-radius:4px;font-size:16px;letter-spacing:1px">' + senhaTemp + '</code></p>' +
            '</div>' +
            '<p style="color:#D32F2F;font-size:13px;font-weight:500">Ao fazer o primeiro login, você será obrigado a redefinir sua senha.</p>' +
            '<p style="color:#555;font-size:13px">Requisitos da nova senha: mínimo 8 caracteres, pelo menos 1 número e 1 caractere especial (!@#$%...).</p>' +
            '<div style="text-align:center;margin-top:24px"><a href="' + siteUrl + '" style="display:inline-block;background:#E65100;color:#fff;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:500;font-size:14px">Acessar o Sistema</a></div>' +
            '<p style="color:#999;font-size:11px;text-align:center;margin-top:24px">Klinik Odontologia — Campo Grande, MS</p>' +
            '</div></body></html>'

        var emailEnviado = await enviarEmail(b2.email.toLowerCase().trim(), 'Bem-vindo ao Klinik Sistema — Seus dados de acesso', emailHtml)

        return res.status(200).json({ success: true, msg: 'Usuário criado', email_enviado: emailEnviado, senha_temp: emailEnviado ? undefined : senhaTemp })
    }

    // ── LISTAR USUÁRIOS ────────────────────────────────────────
    if (action === 'listar-usuarios') {
        var us = await client.execute("SELECT id,nome,email,perfil,ativo,deve_redefinir,criado_em,ultimo_login FROM usuarios ORDER BY nome")
        return res.status(200).json({ success: true, data: us.rows, total: us.rows.length })
    }

    // ── ALTERAR SENHA ──────────────────────────────────────────
    if (action === 'alterar-senha') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var b3 = req.body || {}
        if (!b3.usuario_id || !b3.nova_senha) return res.status(400).json({ success: false, error: 'usuario_id e nova_senha obrigatórios' })

        var erroSenha2 = validarSenha(b3.nova_senha)
        if (erroSenha2) return res.status(400).json({ success: false, error: erroSenha2 })

        var hash3 = hashSenha(b3.nova_senha)
        await client.execute({ sql: "UPDATE usuarios SET senha_hash=?, deve_redefinir=0 WHERE id=?", args: [hash3, b3.usuario_id] })
        await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [b3.usuario_id] })
        return res.status(200).json({ success: true, msg: 'Senha alterada' })
    }

    // ── ATIVAR/DESATIVAR ───────────────────────────────────────
    if (action === 'toggle-usuario') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var b4 = req.body || {}
        if (!b4.usuario_id) return res.status(400).json({ success: false, error: 'usuario_id obrigatório' })
        await client.execute({ sql: "UPDATE usuarios SET ativo = CASE WHEN ativo=1 THEN 0 ELSE 1 END WHERE id=?", args: [b4.usuario_id] })
        // Invalida sessões se desativou
        var check = await client.execute({ sql: "SELECT ativo FROM usuarios WHERE id=?", args: [b4.usuario_id] })
        if (check.rows.length && !check.rows[0].ativo) {
            await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [b4.usuario_id] })
        }
        return res.status(200).json({ success: true })
    }

    // ── EXCLUIR USUÁRIO ──────────────────────────────────────
    if (action === 'excluir-usuario') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var b5 = req.body || {}
        if (!b5.usuario_id) return res.status(400).json({ success: false, error: 'usuario_id obrigatório' })
        await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [b5.usuario_id] })
        await client.execute({ sql: "DELETE FROM usuarios WHERE id=?", args: [b5.usuario_id] })
        return res.status(200).json({ success: true, msg: 'Usuário excluído' })
    }

    return res.status(400).json({ success: false, error: 'Action inválida', actions: ['login', 'me', 'logout', 'criar-usuario', 'listar-usuarios', 'alterar-senha', 'redefinir-senha', 'toggle-usuario', 'excluir-usuario'] })
}
