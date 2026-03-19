// api/auth.js — Autenticação de usuários (Turso)
// Rotas: login, logout, me, criar-usuario, listar-usuarios, alterar-senha

var crypto = require('crypto')
var { getClient } = require('./db')

function hashSenha(senha) {
    return crypto.createHash('sha256').update(senha + '_klinik_salt_2026').digest('hex')
}

function gerarToken() {
    return crypto.randomBytes(32).toString('hex')
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
        await client.execute("CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT, perfil TEXT DEFAULT 'recepcionista', ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')), ultimo_login TEXT)")
        await client.execute("CREATE TABLE IF NOT EXISTS sessoes (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, token TEXT UNIQUE NOT NULL, criado_em TEXT DEFAULT (datetime('now')), expira_em TEXT)")
    } catch(e) {}

    // ── LOGIN ──────────────────────────────────────────────────
    if (action === 'login') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var b = req.body || {}
        if (!b.email || !b.senha) return res.status(400).json({ success: false, error: 'Email e senha obrigatórios' })

        var hash = hashSenha(b.senha)
        var r = await client.execute({ sql: "SELECT id,nome,email,perfil,ativo FROM usuarios WHERE email=? AND senha_hash=?", args: [b.email.toLowerCase().trim(), hash] })
        if (!r.rows.length) return res.status(401).json({ success: false, error: 'Email ou senha inválidos' })

        var user = r.rows[0]
        if (!user.ativo) return res.status(403).json({ success: false, error: 'Usuário desativado' })

        // Cria sessão (expira em 7 dias)
        var token = gerarToken()
        var expira = new Date(); expira.setDate(expira.getDate() + 7)
        await client.execute({ sql: "INSERT INTO sessoes(usuario_id,token,expira_em) VALUES(?,?,?)", args: [user.id, token, expira.toISOString()] })
        await client.execute({ sql: "UPDATE usuarios SET ultimo_login=datetime('now') WHERE id=?", args: [user.id] })

        return res.status(200).json({ success: true, token: token, usuario: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil } })
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
        if (!b2.nome || !b2.email || !b2.senha) return res.status(400).json({ success: false, error: 'Nome, email e senha obrigatórios' })
        if (b2.senha.length < 4) return res.status(400).json({ success: false, error: 'Senha deve ter no mínimo 4 caracteres' })

        var existe = await client.execute({ sql: "SELECT id FROM usuarios WHERE email=?", args: [b2.email.toLowerCase().trim()] })
        if (existe.rows.length) return res.status(409).json({ success: false, error: 'Email já cadastrado' })

        var hash2 = hashSenha(b2.senha)
        var perfil = b2.perfil || 'recepcionista'
        var validos = ['admin', 'dentista', 'recepcionista']
        if (validos.indexOf(perfil) === -1) perfil = 'recepcionista'

        await client.execute({ sql: "INSERT INTO usuarios(nome,email,senha_hash,perfil) VALUES(?,?,?,?)", args: [b2.nome.trim(), b2.email.toLowerCase().trim(), hash2, perfil] })
        return res.status(200).json({ success: true, msg: 'Usuário criado' })
    }

    // ── LISTAR USUÁRIOS ────────────────────────────────────────
    if (action === 'listar-usuarios') {
        var us = await client.execute("SELECT id,nome,email,perfil,ativo,criado_em,ultimo_login FROM usuarios ORDER BY nome")
        return res.status(200).json({ success: true, data: us.rows, total: us.rows.length })
    }

    // ── ALTERAR SENHA ──────────────────────────────────────────
    if (action === 'alterar-senha') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var b3 = req.body || {}
        if (!b3.usuario_id || !b3.nova_senha) return res.status(400).json({ success: false, error: 'usuario_id e nova_senha obrigatórios' })
        if (b3.nova_senha.length < 4) return res.status(400).json({ success: false, error: 'Senha deve ter no mínimo 4 caracteres' })

        var hash3 = hashSenha(b3.nova_senha)
        await client.execute({ sql: "UPDATE usuarios SET senha_hash=? WHERE id=?", args: [hash3, b3.usuario_id] })
        // Invalida sessões existentes
        await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [b3.usuario_id] })
        return res.status(200).json({ success: true, msg: 'Senha alterada' })
    }

    // ── ATIVAR/DESATIVAR ───────────────────────────────────────
    if (action === 'toggle-usuario') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var b4 = req.body || {}
        if (!b4.usuario_id) return res.status(400).json({ success: false, error: 'usuario_id obrigatório' })
        await client.execute({ sql: "UPDATE usuarios SET ativo = CASE WHEN ativo=1 THEN 0 ELSE 1 END WHERE id=?", args: [b4.usuario_id] })
        return res.status(200).json({ success: true })
    }

    return res.status(400).json({ success: false, error: 'Action inválida', actions: ['login', 'me', 'logout', 'criar-usuario', 'listar-usuarios', 'alterar-senha', 'toggle-usuario'] })
}
