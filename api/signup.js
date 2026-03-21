// api/signup.js — Cadastro de clínicas (SaaS)
// Klinik Sistema — Campo Grande, MS

var bcrypt = require('bcryptjs')
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var q = req.query || {}
    var action = q.action || ''

    if (action !== 'registrar') {
        return res.status(400).json({ success: false, error: 'Action inválida', actions: ['registrar'] })
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'POST required' })
    }

    var client = getClient()

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
