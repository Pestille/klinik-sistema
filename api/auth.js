// api/auth.js — Autenticação de usuários (Turso)
// Rotas: login, logout, me, criar-usuario, listar-usuarios, alterar-senha, redefinir-senha,
//        esqueci-senha, resetar-senha, ativar

var crypto = require('crypto')
var bcrypt = require('bcryptjs')
var nodemailer = require('nodemailer')
var { getClient } = require('../lib/db')

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
    // Try Resend first (configured), then Gmail fallback
    var resendKey = process.env.RESEND_API_KEY || ''
    var resendFrom = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    if (resendKey) {
        try {
            var r = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: resendFrom, to: [para], subject: assunto, html: html })
            })
            var rd = await r.json()
            console.log('[auth] Resend email to ' + para + ': ' + (r.ok ? 'OK' : JSON.stringify(rd)))
            return r.ok
        } catch(e) {
            console.error('[auth] Resend error:', e.message)
        }
    }
    // Gmail fallback
    var user = process.env.EMAIL_USER
    var pass = process.env.EMAIL_PASS
    if (!user || !pass) { console.log('[auth] Nenhum servico de email configurado (RESEND_API_KEY ou EMAIL_USER/EMAIL_PASS)'); return false }
    try {
        var transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: user, pass: pass } })
        await transporter.sendMail({ from: 'Klinov <' + user + '>', to: para, subject: assunto, html: html })
        return true
    } catch(e) {
        console.error('[auth] Gmail error:', e.message)
        return false
    }
}

var { setCorsHeaders, checkRateLimit } = require('../lib/middleware')
var { runMigrations } = require('../lib/migrations')
var cfgLib = require('../lib/config')

// Cria a sessão com a duração configurada pela clínica e registra o acesso
async function criarSessao(client, user, req, acao) {
    var cfg = await cfgLib.lerCfg(client, user.clinica_id)
    var token = gerarToken()
    var expira = new Date(); expira.setHours(expira.getHours() + (Number(cfg.seguranca.sessao_horas) || 8))
    await client.execute({ sql: "INSERT INTO sessoes(usuario_id,token,expira_em) VALUES(?,?,?)", args: [user.id, token, expira.toISOString()] })
    await client.execute({ sql: "UPDATE usuarios SET ultimo_login=datetime('now') WHERE id=?", args: [user.id] })
    await cfgLib.registrar(client, { clinica_id: user.clinica_id, usuario_id: user.id, nome: user.nome }, acao || 'login', null, req)
    return token
}
function hashCodigo(desafio, codigo) { return crypto.createHash('sha256').update(String(desafio) + ':' + String(codigo)).digest('hex') }
function mascararEmail(e) { var p = String(e || '').split('@'); return p.length === 2 ? p[0].slice(0, 2) + '***@' + p[1] : '' }

module.exports = async function handler(req, res) {
    setCorsHeaders(req, res)
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var q = req.query || {}
    var action = q.action || ''
    var client = getClient()
    await runMigrations(client)

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
        // Rate limiting: max 5 tentativas por email em 15 min
        var rlKey = 'login:' + (b.email || '').toLowerCase()
        if (!checkRateLimit(rlKey, 5, 900000)) {
            return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde 15 minutos.' })
        }

        // Busca usuário pelo email (sem comparar hash ainda — precisamos detectar formato)
        var r = await client.execute({ sql: "SELECT * FROM usuarios WHERE email=?", args: [b.email.toLowerCase().trim()] })
        if (!r.rows.length) return res.status(401).json({ success: false, error: 'Email ou senha inválidos' })

        var user = r.rows[0]
        var senhaValida = false

        // Apenas bcrypt é aceito. O hash SHA-256 legado (salt hardcoded) foi
        // removido — qualquer conta ainda em SHA-256 precisa usar "esqueci senha"
        // para recriar a senha via email e gerar um bcrypt limpo.
        if (user.senha_hash && user.senha_hash.indexOf('$2') === 0) {
            senhaValida = bcrypt.compareSync(b.senha, user.senha_hash)
        }

        if (!senhaValida) {
            await cfgLib.registrar(client, { clinica_id: user.clinica_id, usuario_id: user.id, nome: user.nome }, 'login.falha', 'Senha incorreta', req)
            return res.status(401).json({ success: false, error: 'Email ou senha inválidos' })
        }
        if (!user.ativo) return res.status(403).json({ success: false, error: 'Usuário desativado' })

        // Se deve redefinir, retorna flag (frontend mostrará tela de redefinição).
        // O reset_token prova que quem chama redefinir-senha acabou de acertar a
        // senha atual — sem ele, qualquer um trocaria a senha de qualquer usuario_id.
        if (user.deve_redefinir) {
            var resetToken = gerarToken()
            var expiraReset = new Date(); expiraReset.setMinutes(expiraReset.getMinutes() + 15)
            await client.execute({ sql: "UPDATE usuarios SET token_redefinir=?, token_redefinir_expira=? WHERE id=?", args: [resetToken, expiraReset.toISOString(), user.id] })
            return res.status(200).json({ success: true, deve_redefinir: true, usuario_id: user.id, nome: user.nome, reset_token: resetToken })
        }

        // Login em duas etapas (Configurações › Segurança): código de 6 dígitos no e-mail pessoal
        var cfgLogin = await cfgLib.lerCfg(client, user.clinica_id)
        if (cfgLogin.seguranca.dois_fatores && user.email_pessoal) {
            var desafio = gerarToken(), codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
            var expCod = new Date(); expCod.setMinutes(expCod.getMinutes() + 10)
            await client.execute({ sql: "UPDATE usuarios SET desafio_2fa=?, codigo_2fa=?, codigo_2fa_expira=?, codigo_2fa_tentativas=0 WHERE id=?", args: [desafio, hashCodigo(desafio, codigo), expCod.toISOString(), user.id] })
            var enviou = await enviarEmail(user.email_pessoal, 'Seu código de acesso — Klinov', '<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto"><p>Olá, ' + String(user.nome || '').split(' ')[0] + '.</p><p>Seu código para entrar no Klinov é:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#034030">' + codigo + '</p><p style="color:#757575;font-size:12px">Vale por 10 minutos. Se não foi você, troque sua senha.</p></div>')
            if (!enviou) return res.status(503).json({ success: false, error: 'Não foi possível enviar o código de acesso. Tente de novo em instantes.' })
            return res.status(200).json({ success: true, precisa_codigo: true, desafio: desafio, email: mascararEmail(user.email_pessoal) })
        }

        var token = await criarSessao(client, user, req, 'login')

        return res.status(200).json({ success: true, token: token, usuario: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil, clinica_id: user.clinica_id } })
    }

    // ── REDEFINIR SENHA (primeiro acesso) ─────────────────────
    if (action === 'redefinir-senha') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var br = req.body || {}
        if (!br.usuario_id || !br.nova_senha || !br.reset_token) return res.status(400).json({ success: false, error: 'usuario_id, reset_token e nova_senha obrigatórios' })

        var rr = await client.execute({ sql: "SELECT token_redefinir_expira FROM usuarios WHERE id=? AND token_redefinir=? AND deve_redefinir=1 AND ativo=1", args: [br.usuario_id, String(br.reset_token)] })
        if (!rr.rows.length || !rr.rows[0].token_redefinir_expira || new Date(rr.rows[0].token_redefinir_expira) < new Date()) {
            return res.status(401).json({ success: false, error: 'Sessão de redefinição expirada. Faça login novamente.' })
        }

        var erroSenha = validarSenha(br.nova_senha)
        if (erroSenha) return res.status(400).json({ success: false, error: erroSenha })

        var hashR = bcrypt.hashSync(br.nova_senha, 10)
        await client.execute({ sql: "UPDATE usuarios SET senha_hash=?, deve_redefinir=0, token_redefinir=NULL, token_redefinir_expira=NULL WHERE id=?", args: [hashR, br.usuario_id] })
        await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [br.usuario_id] })

        // Cria nova sessão
        var tokenR = gerarToken()
        var expiraR = new Date(); expiraR.setHours(expiraR.getHours() + 8)
        await client.execute({ sql: "INSERT INTO sessoes(usuario_id,token,expira_em) VALUES(?,?,?)", args: [br.usuario_id, tokenR, expiraR.toISOString()] })
        await client.execute({ sql: "UPDATE usuarios SET ultimo_login=datetime('now') WHERE id=?", args: [br.usuario_id] })

        var udata = await client.execute({ sql: "SELECT id,nome,email,perfil,clinica_id FROM usuarios WHERE id=?", args: [br.usuario_id] })
        var urow = udata.rows[0] || {}

        return res.status(200).json({ success: true, token: tokenR, usuario: { id: urow.id, nome: urow.nome, email: urow.email, perfil: urow.perfil, clinica_id: urow.clinica_id } })
    }

    // ── ME (verificar sessão) ──────────────────────────────────
    if (action === 'me') {
        var authHeader = req.headers.authorization || ''
        var token2 = authHeader.replace('Bearer ', '') || q.token || ''
        if (!token2) return res.status(401).json({ success: false, error: 'Token não fornecido' })

        try { await client.execute("ALTER TABLE usuarios ADD COLUMN email_pessoal TEXT") } catch(e) {}
        var s = await client.execute({ sql: "SELECT s.usuario_id, s.expira_em, u.nome, u.email, u.email_pessoal, u.perfil, u.clinica_id FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=? AND u.ativo=1", args: [token2] })
        if (!s.rows.length) return res.status(401).json({ success: false, error: 'Sessão inválida' })

        var sess = s.rows[0]
        if (new Date(sess.expira_em) < new Date()) {
            await client.execute({ sql: "DELETE FROM sessoes WHERE token=?", args: [token2] })
            return res.status(401).json({ success: false, error: 'Sessão expirada' })
        }

        return res.status(200).json({ success: true, usuario: { id: sess.usuario_id, nome: sess.nome, email: sess.email, email_pessoal: sess.email_pessoal || '', perfil: sess.perfil, clinica_id: sess.clinica_id } })
    }

    // ── VERIFICAR CÓDIGO (segunda etapa do login) ─────────────
    if (action === 'verificar-codigo') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var bv = req.body || {}
        if (!bv.desafio || !bv.codigo) return res.status(400).json({ success: false, error: 'Informe o código' })
        if (!checkRateLimit('2fa:' + String(bv.desafio).slice(0, 64), 10, 900000)) return res.status(429).json({ success: false, error: 'Muitas tentativas. Faça login de novo.' })
        var uv = (await client.execute({ sql: "SELECT * FROM usuarios WHERE desafio_2fa=? AND ativo=1", args: [String(bv.desafio)] })).rows[0]
        if (!uv || !uv.codigo_2fa_expira || new Date(uv.codigo_2fa_expira) < new Date()) return res.status(401).json({ success: false, error: 'Código expirado. Faça login de novo.', expirado: true })
        if (Number(uv.codigo_2fa_tentativas) >= 5) {
            await client.execute({ sql: "UPDATE usuarios SET desafio_2fa=NULL, codigo_2fa=NULL WHERE id=?", args: [uv.id] })
            return res.status(401).json({ success: false, error: 'Muitas tentativas erradas. Faça login de novo.', expirado: true })
        }
        if (hashCodigo(bv.desafio, String(bv.codigo).replace(/\D/g, '')) !== uv.codigo_2fa) {
            await client.execute({ sql: "UPDATE usuarios SET codigo_2fa_tentativas=COALESCE(codigo_2fa_tentativas,0)+1 WHERE id=?", args: [uv.id] })
            await cfgLib.registrar(client, { clinica_id: uv.clinica_id, usuario_id: uv.id, nome: uv.nome }, 'login.codigo_errado', null, req)
            return res.status(401).json({ success: false, error: 'Código incorreto' })
        }
        await client.execute({ sql: "UPDATE usuarios SET desafio_2fa=NULL, codigo_2fa=NULL, codigo_2fa_expira=NULL, codigo_2fa_tentativas=0 WHERE id=?", args: [uv.id] })
        var tokenV = await criarSessao(client, uv, req, 'login.2fa')
        return res.status(200).json({ success: true, token: tokenV, usuario: { id: uv.id, nome: uv.nome, email: uv.email, perfil: uv.perfil, clinica_id: uv.clinica_id } })
    }

    // ── LOGOUT ─────────────────────────────────────────────────
    if (action === 'logout') {
        var tk = (req.headers.authorization || '').replace('Bearer ', '') || q.token || ''
        if (tk) {
            var sl = (await client.execute({ sql: "SELECT u.id, u.nome, u.clinica_id FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=?", args: [tk] })).rows[0]
            if (sl) await cfgLib.registrar(client, { clinica_id: sl.clinica_id, usuario_id: sl.id, nome: sl.nome }, 'logout', null, req)
            await client.execute({ sql: "DELETE FROM sessoes WHERE token=?", args: [tk] })
        }
        return res.status(200).json({ success: true })
    }

    // ── CRIAR USUÁRIO ──────────────────────────────────────────
    if (action === 'criar-usuario') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var { authenticateRequest: authCU } = require('../lib/middleware')
        var authCr = await authCU(req)
        if (!authCr) return res.status(401).json({ success: false, error: 'Não autenticado' })
        if (authCr.perfil !== 'admin') return res.status(403).json({ success: false, error: 'Apenas admin' })
        var b2 = req.body || {}
        // clinica_id vem sempre da sessão do admin — nunca do body
        b2.clinica_id = authCr.clinica_id
        if (!b2.nome || !b2.email || !b2.email_pessoal) return res.status(400).json({ success: false, error: 'Nome, login e email pessoal obrigatórios' })

        var existe = await client.execute({ sql: "SELECT id FROM usuarios WHERE email=?", args: [b2.email.toLowerCase().trim()] })
        if (existe.rows.length) return res.status(409).json({ success: false, error: 'Email já cadastrado' })

        // Gera token de ativação (sem senha temporária)
        var tokenAtivacao = crypto.randomBytes(32).toString('hex')
        var perfil = b2.perfil || 'recepcionista'
        var validos = require('../lib/permissoes').PERFIS
        if (validos.indexOf(perfil) === -1) perfil = 'recepcionista'

        // Ensure columns exist
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_ativacao TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN ativado INTEGER DEFAULT 0") } catch(e) {}
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_ativacao_expira TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN email_pessoal TEXT") } catch(e) {}

        var expiraAtivacao = new Date()
        expiraAtivacao.setHours(expiraAtivacao.getHours() + 48)

        var emailPessoalCU = (b2.email_pessoal || '').toLowerCase().trim()
        await client.execute({
            sql: "INSERT INTO usuarios(nome,email,email_pessoal,senha_hash,perfil,deve_redefinir,clinica_id,ativado,token_ativacao,token_ativacao_expira) VALUES(?,?,?,'',?,1,?,0,?,?)",
            args: [b2.nome.trim(), b2.email.toLowerCase().trim(), emailPessoalCU || null, perfil, b2.clinica_id, tokenAtivacao, expiraAtivacao.toISOString()]
        })

        // Envia email com link de ativação
        var siteUrl = 'https://klinik-sistema.vercel.app'
        var linkAtivacao = siteUrl + '/api/auth?action=ativar&token=' + tokenAtivacao
        var emailHtml = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f5f5f5">' +
            '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.1)">' +
            '<div style="text-align:center;margin-bottom:24px"><span style="font-size:22px;font-weight:700;color:#1B5E3B">KLINOV</span></div>' +
            '<p style="color:#333;font-size:15px">Ola <strong>' + b2.nome.trim() + '</strong>,</p>' +
            '<p style="color:#555;font-size:14px">Voce foi convidado para o Klinov com o perfil <strong>' + perfil.toUpperCase() + '</strong>.</p>' +
            '<p style="color:#555;font-size:14px">Para ativar sua conta e criar sua senha, clique no botao abaixo:</p>' +
            '<div style="text-align:center;margin:24px 0"><a href="' + linkAtivacao + '" style="display:inline-block;background:#E65100;color:#fff;text-decoration:none;padding:14px 36px;border-radius:6px;font-weight:600;font-size:15px">Ativar Minha Conta</a></div>' +
            '<p style="color:#999;font-size:12px">Este link expira em 48 horas. Se voce nao solicitou esta conta, ignore este email.</p>' +
            '<div style="border-top:1px solid #eee;margin-top:24px;padding-top:16px">' +
            '<p style="color:#999;font-size:11px;margin:0">Se o botao nao funcionar, copie e cole o link abaixo no seu navegador:</p>' +
            '<p style="color:#1565C0;font-size:11px;word-break:break-all">' + linkAtivacao + '</p>' +
            '</div>' +
            '<p style="color:#999;font-size:11px;text-align:center;margin-top:16px">Klinov</p>' +
            '</div></body></html>'

        // Envia para o email pessoal (o login é usuario@klinov — não é endereço real)
        var emailDestino = b2.email_pessoal.toLowerCase().trim()
        var emailEnviado = await enviarEmail(emailDestino, 'Ative sua conta — Klinov', emailHtml)

        await cfgLib.registrar(client, authCr, 'usuario.criar', b2.nome + ' (' + perfil + ')', req)
        return res.status(200).json({ success: true, msg: 'Convite enviado por email', email_enviado: emailEnviado })
    }

    // ── ESQUECI MINHA SENHA (solicita reset por email) ──────────
    if (action === 'esqueci-senha') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var bes = req.body || {}
        var esEmail = String(bes.email || '').toLowerCase().trim()
        if (!esEmail || !/^[^\s@]+@[^\s@]+$/.test(esEmail)) {
            return res.status(400).json({ success: false, error: 'Informe seu usuário ou email pessoal' })
        }

        // Rate limit: max 3 solicitações por email em 15 min
        if (!checkRateLimit('reset:' + esEmail, 3, 900000)) {
            return res.status(429).json({ success: false, error: 'Muitas solicitações. Aguarde 15 minutos.' })
        }

        // Garante colunas
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_reset TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_reset_expira TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN email_pessoal TEXT") } catch(e) {}

        // Busca por login (email) OU por email_pessoal — usuário pode lembrar qualquer um
        var esUser = await client.execute({
            sql: "SELECT id, nome, email, email_pessoal FROM usuarios WHERE (email=? OR email_pessoal=?) AND ativo=1",
            args: [esEmail, esEmail]
        })

        console.log('[esqueci-senha] email=' + esEmail + ' encontrou=' + esUser.rows.length)

        // Sempre responde sucesso (não revela se email existe — evita enumeração)
        if (esUser.rows.length) {
            var esU = esUser.rows[0]
            var esToken = gerarToken()
            var esExpira = new Date(); esExpira.setHours(esExpira.getHours() + 1) // 1h
            await client.execute({
                sql: "UPDATE usuarios SET token_reset=?, token_reset_expira=? WHERE id=?",
                args: [esToken, esExpira.toISOString(), esU.id]
            })

            var esOrigem = (req.headers.origin || 'https://klinov.com.br').replace(/\/$/, '')
            if (esOrigem.indexOf('klinov.com.br') === -1 && esOrigem.indexOf('vercel.app') === -1) {
                esOrigem = 'https://klinov.com.br'
            }
            var linkReset = esOrigem + '/api/auth?action=resetar&token=' + esToken

            var esHtml =
                '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1A1A1A">' +
                '<h2 style="color:#034030;margin:0 0 16px">Redefinir sua senha</h2>' +
                '<p style="font-size:14px;line-height:1.7">Olá ' + (esU.nome || 'usuário') + ', recebemos uma solicitação para redefinir sua senha no Klinov.</p>' +
                '<p style="font-size:14px;line-height:1.7">Clique no botão abaixo para criar uma nova senha. O link expira em 1 hora.</p>' +
                '<p style="text-align:center;margin:24px 0"><a href="' + linkReset + '" style="display:inline-block;background:#E65100;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">Redefinir Senha</a></p>' +
                '<p style="font-size:12px;color:#999;line-height:1.6">Se você não solicitou essa redefinição, ignore este email — sua senha atual continua válida.</p>' +
                '<div style="border-top:1px solid #eee;margin-top:24px;padding-top:16px">' +
                '<p style="color:#999;font-size:11px;margin:0">Link completo (caso o botão não funcione):</p>' +
                '<p style="color:#1565C0;font-size:11px;word-break:break-all">' + linkReset + '</p>' +
                '</div></div>'

            // Envia SEMPRE pro email_pessoal quando existe (login é usuario@klinov — não é email real).
            // Se não houver email_pessoal (usuários legados), cai no próprio login.
            var esDestino = esU.email_pessoal || esU.email
            await enviarEmail(esDestino, 'Redefinição de senha — Klinov', esHtml)
        }

        return res.status(200).json({ success: true, msg: 'Se o email estiver cadastrado, um link de redefinição foi enviado.' })
    }

    // ── RESETAR SENHA (via link do email) ───────────────────────
    if (action === 'resetar') {
        var tokenRs = q.token || ''
        if (!tokenRs) {
            res.setHeader('Content-Type', 'text/html')
            return res.status(400).send('<html><body style="font-family:Arial;padding:40px;text-align:center"><h2 style="color:#C62828">Link invalido</h2><p>Token de redefinicao nao informado.</p></body></html>')
        }

        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_reset TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_reset_expira TEXT") } catch(e) {}

        var userRs = await client.execute({ sql: "SELECT id, nome, email, token_reset_expira FROM usuarios WHERE token_reset=? AND ativo=1", args: [tokenRs] })
        if (!userRs.rows.length) {
            res.setHeader('Content-Type', 'text/html')
            return res.status(400).send('<html><body style="font-family:Arial;padding:40px;text-align:center"><h2 style="color:#C62828">Link invalido ou ja utilizado</h2><p>Este link de redefinicao nao e valido. Solicite um novo em <a href="/app">/app</a>.</p></body></html>')
        }

        var uRs = userRs.rows[0]
        if (uRs.token_reset_expira && new Date(uRs.token_reset_expira) < new Date()) {
            res.setHeader('Content-Type', 'text/html')
            return res.status(400).send('<html><body style="font-family:Arial;padding:40px;text-align:center"><h2 style="color:#E65100">Link expirado</h2><p>Este link expirou (validade: 1 hora). Solicite um novo em <a href="/app">/app</a>.</p></body></html>')
        }

        if (req.method === 'POST') {
            var bRs = req.body || {}
            var novaSenhaRs = bRs.senha || ''
            var erroRs = validarSenha(novaSenhaRs)
            if (erroRs) return res.status(400).json({ success: false, error: erroRs })

            var hashRs = bcrypt.hashSync(novaSenhaRs, 10)
            await client.execute({ sql: "UPDATE usuarios SET senha_hash=?, deve_redefinir=0, token_reset=NULL, token_reset_expira=NULL WHERE id=?", args: [hashRs, uRs.id] })
            // Invalida sessões antigas por segurança
            await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [uRs.id] })
            return res.status(200).json({ success: true, msg: 'Senha redefinida com sucesso. Faça login com a nova senha.' })
        }

        // GET: mostra formulário HTML (mesmo estilo da ativação)
        res.setHeader('Content-Type', 'text/html')
        return res.status(200).send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redefinir Senha — Klinov</title></head>' +
            '<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;margin:0">' +
            '<div style="max-width:420px;margin:40px auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.1)">' +
            '<div style="text-align:center;margin-bottom:24px"><span style="font-size:22px;font-weight:700;color:#1B5E3B">KLINOV</span></div>' +
            '<h2 style="color:#333;font-size:18px;margin-bottom:8px">Redefinir sua senha</h2>' +
            '<p style="color:#666;font-size:14px;margin-bottom:24px">Ola <strong>' + uRs.nome + '</strong>, crie uma nova senha para sua conta.</p>' +
            '<div id="form-area">' +
            '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px">Usuario</label><input type="text" value="' + uRs.email + '" readonly style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:#f9f9f9;color:#999"></div>' +
            '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px">Nova Senha *</label><input type="password" id="rs-senha" placeholder="Minimo 8 caracteres" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px"></div>' +
            '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px">Confirmar Senha *</label><input type="password" id="rs-confirma" placeholder="Repita a senha" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px"></div>' +
            '<p style="font-size:12px;color:#999;margin-bottom:16px">Requisitos: minimo 8 caracteres, 1 numero e 1 caractere especial (!@#$%...)</p>' +
            '<button onclick="resetarSenha()" style="width:100%;padding:12px;background:#E65100;color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer">Redefinir Senha</button>' +
            '<div id="rs-msg" style="margin-top:12px;text-align:center;font-size:13px"></div>' +
            '</div></div>' +
            '<script>' +
            'async function resetarSenha(){' +
            '  var s=document.getElementById("rs-senha").value;' +
            '  var c=document.getElementById("rs-confirma").value;' +
            '  var msg=document.getElementById("rs-msg");' +
            '  if(s!==c){msg.innerHTML="<span style=\\"color:#C62828\\">As senhas nao coincidem</span>";return}' +
            '  if(s.length<8){msg.innerHTML="<span style=\\"color:#C62828\\">Minimo 8 caracteres</span>";return}' +
            '  msg.innerHTML="<span style=\\"color:#1565C0\\">Redefinindo...</span>";' +
            '  try{' +
            '    var r=await fetch("/api/auth?action=resetar&token=' + tokenRs + '",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({senha:s})});' +
            '    var d=await r.json();' +
            '    if(d.success){' +
            '      document.getElementById("form-area").innerHTML="<div style=\\"text-align:center;padding:20px\\"><div style=\\"font-size:40px;margin-bottom:12px\\">✅</div><h3 style=\\"color:#1B5E3B\\">Senha redefinida!</h3><p style=\\"color:#666\\">Agora faca login com sua nova senha.</p><a href=\\"/app\\" style=\\"display:inline-block;margin-top:16px;background:#1B5E3B;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:600\\">Ir para Login</a></div>";' +
            '    }else{msg.innerHTML="<span style=\\"color:#C62828\\">"+(d.error||"Erro")+"</span>"}' +
            '  }catch(e){msg.innerHTML="<span style=\\"color:#C62828\\">Erro de conexao</span>"}' +
            '}' +
            '</script></body></html>')
    }

    // ── LISTAR USUÁRIOS ────────────────────────────────────────
    // ── ATIVAR CONTA (via link do email) ────────────────────────
    if (action === 'ativar') {
        var tokenAt = q.token || ''
        if (!tokenAt) {
            res.setHeader('Content-Type', 'text/html')
            return res.status(400).send('<html><body style="font-family:Arial;padding:40px;text-align:center"><h2 style="color:#C62828">Link invalido</h2><p>Token de ativacao nao informado.</p></body></html>')
        }

        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_ativacao TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN ativado INTEGER DEFAULT 0") } catch(e) {}
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_ativacao_expira TEXT") } catch(e) {}

        var userAt = await client.execute({ sql: "SELECT id, nome, email, token_ativacao_expira FROM usuarios WHERE token_ativacao=?", args: [tokenAt] })
        if (!userAt.rows.length) {
            res.setHeader('Content-Type', 'text/html')
            return res.status(400).send('<html><body style="font-family:Arial;padding:40px;text-align:center"><h2 style="color:#C62828">Link invalido ou expirado</h2><p>Este link de ativacao nao e valido. Solicite um novo convite ao administrador.</p></body></html>')
        }

        var uAt = userAt.rows[0]
        if (uAt.token_ativacao_expira && new Date(uAt.token_ativacao_expira) < new Date()) {
            res.setHeader('Content-Type', 'text/html')
            return res.status(400).send('<html><body style="font-family:Arial;padding:40px;text-align:center"><h2 style="color:#E65100">Link expirado</h2><p>Este link expirou. Solicite um novo convite ao administrador.</p></body></html>')
        }

        // Se POST, é a submissão do formulário de senha
        if (req.method === 'POST') {
            var senhaBody = req.body || {}
            var novaSenha = senhaBody.senha || ''
            if (novaSenha.length < 8) return res.status(400).json({ success: false, error: 'Senha deve ter no minimo 8 caracteres' })
            if (!/[0-9]/.test(novaSenha)) return res.status(400).json({ success: false, error: 'Senha deve conter pelo menos 1 numero' })
            if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(novaSenha)) return res.status(400).json({ success: false, error: 'Senha deve conter pelo menos 1 caractere especial' })

            var hashAtiv = bcrypt.hashSync(novaSenha, 10)
            await client.execute({ sql: "UPDATE usuarios SET senha_hash=?, ativado=1, deve_redefinir=0, token_ativacao=NULL, token_ativacao_expira=NULL WHERE id=?", args: [hashAtiv, uAt.id] })
            return res.status(200).json({ success: true, msg: 'Conta ativada com sucesso! Voce ja pode fazer login.' })
        }

        // GET: mostra formulário HTML de criação de senha
        res.setHeader('Content-Type', 'text/html')
        return res.status(200).send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ativar Conta — Klinov</title></head>' +
            '<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;margin:0">' +
            '<div style="max-width:420px;margin:40px auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.1)">' +
            '<div style="text-align:center;margin-bottom:24px"><span style="font-size:22px;font-weight:700;color:#1B5E3B">KLINOV</span></div>' +
            '<h2 style="color:#333;font-size:18px;margin-bottom:8px">Ativar sua conta</h2>' +
            '<p style="color:#666;font-size:14px;margin-bottom:24px">Ola <strong>' + uAt.nome + '</strong>, crie sua senha para acessar o sistema.</p>' +
            '<div id="form-area">' +
            '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px">Usuario</label><input type="text" value="' + uAt.email + '" readonly style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:#f9f9f9;color:#999"></div>' +
            '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px">Nova Senha *</label><input type="password" id="at-senha" placeholder="Minimo 8 caracteres" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px"></div>' +
            '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px">Confirmar Senha *</label><input type="password" id="at-confirma" placeholder="Repita a senha" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px"></div>' +
            '<p style="font-size:12px;color:#999;margin-bottom:16px">Requisitos: minimo 8 caracteres, 1 numero e 1 caractere especial (!@#$%...)</p>' +
            '<button onclick="ativarConta()" style="width:100%;padding:12px;background:#E65100;color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer">Ativar Conta</button>' +
            '<div id="at-msg" style="margin-top:12px;text-align:center;font-size:13px"></div>' +
            '</div></div>' +
            '<script>' +
            'async function ativarConta(){' +
            '  var s=document.getElementById("at-senha").value;' +
            '  var c=document.getElementById("at-confirma").value;' +
            '  var msg=document.getElementById("at-msg");' +
            '  if(s!==c){msg.innerHTML="<span style=\\"color:#C62828\\">As senhas nao coincidem</span>";return}' +
            '  if(s.length<8){msg.innerHTML="<span style=\\"color:#C62828\\">Minimo 8 caracteres</span>";return}' +
            '  msg.innerHTML="<span style=\\"color:#1565C0\\">Ativando...</span>";' +
            '  try{' +
            '    var r=await fetch("/api/auth?action=ativar&token=' + tokenAt + '",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({senha:s})});' +
            '    var d=await r.json();' +
            '    if(d.success){' +
            '      document.getElementById("form-area").innerHTML="<div style=\\"text-align:center;padding:20px\\"><div style=\\"font-size:40px;margin-bottom:12px\\">✅</div><h3 style=\\"color:#1B5E3B\\">Conta ativada!</h3><p style=\\"color:#666\\">Sua senha foi criada com sucesso.</p><a href=\\"/app\\" style=\\"display:inline-block;margin-top:16px;background:#1B5E3B;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:600\\">Acessar o Sistema</a></div>";' +
            '    }else{msg.innerHTML="<span style=\\"color:#C62828\\">"+(d.error||"Erro")+"</span>"}' +
            '  }catch(e){msg.innerHTML="<span style=\\"color:#C62828\\">Erro de conexao</span>"}' +
            '}' +
            '</script></body></html>')
    }

    if (action === 'listar-usuarios') {
        var { authenticateRequest } = require('../lib/middleware')
        var authLU = await authenticateRequest(req)
        if (!authLU) return res.status(401).json({ success: false, error: 'Não autenticado' })
        if (authLU.perfil !== 'admin') return res.status(403).json({ success: false, error: 'Apenas admin pode listar usuários' })
        var us = await client.execute({ sql: "SELECT id,nome,email,email_pessoal,telefone,perfil,ativo,deve_redefinir,profissional_id,criado_em,ultimo_login FROM usuarios WHERE clinica_id=? ORDER BY nome", args: [authLU.clinica_id] })
        return res.status(200).json({ success: true, data: us.rows, total: us.rows.length })
    }

    // ── ALTERAR SENHA ──────────────────────────────────────────
    if (action === 'alterar-senha') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var { authenticateRequest: authAS } = require('../lib/middleware')
        var authAl = await authAS(req)
        if (!authAl) return res.status(401).json({ success: false, error: 'Não autenticado' })
        var b3 = req.body || {}
        if (!b3.usuario_id || !b3.nova_senha) return res.status(400).json({ success: false, error: 'usuario_id e nova_senha obrigatórios' })
        // Admin troca a senha de usuários da própria clínica; os demais só a própria
        if (authAl.perfil !== 'admin' && Number(b3.usuario_id) !== Number(authAl.usuario_id)) {
            return res.status(403).json({ success: false, error: 'Apenas admin' })
        }
        var owAl = await client.execute({ sql: "SELECT id FROM usuarios WHERE id=? AND clinica_id=?", args: [b3.usuario_id, authAl.clinica_id] })
        if (!owAl.rows.length) return res.status(404).json({ success: false, error: 'Usuário não encontrado' })

        var erroSenha2 = validarSenha(b3.nova_senha)
        if (erroSenha2) return res.status(400).json({ success: false, error: erroSenha2 })

        var hash3 = bcrypt.hashSync(b3.nova_senha, 10)
        await client.execute({ sql: "UPDATE usuarios SET senha_hash=?, deve_redefinir=0 WHERE id=? AND clinica_id=?", args: [hash3, b3.usuario_id, authAl.clinica_id] })
        await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [b3.usuario_id] })
        await cfgLib.registrar(client, authAl, 'usuario.senha', Number(b3.usuario_id) === Number(authAl.usuario_id) ? 'Própria senha' : 'Senha do usuário #' + b3.usuario_id, req)
        return res.status(200).json({ success: true, msg: 'Senha alterada' })
    }

    // ── ATIVAR/DESATIVAR ───────────────────────────────────────
    if (action === 'toggle-usuario') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var { authenticateRequest: authTU } = require('../lib/middleware')
        var authTg = await authTU(req)
        if (!authTg) return res.status(401).json({ success: false, error: 'Não autenticado' })
        if (authTg.perfil !== 'admin') return res.status(403).json({ success: false, error: 'Apenas admin' })
        var b4 = req.body || {}
        if (!b4.usuario_id) return res.status(400).json({ success: false, error: 'usuario_id obrigatório' })
        // Verifica que o usuário pertence à mesma clínica
        var owTg = await client.execute({ sql: "SELECT id FROM usuarios WHERE id=? AND clinica_id=?", args: [b4.usuario_id, authTg.clinica_id] })
        if (!owTg.rows.length) return res.status(404).json({ success: false, error: 'Usuário não encontrado' })
        await client.execute({ sql: "UPDATE usuarios SET ativo = CASE WHEN ativo=1 THEN 0 ELSE 1 END WHERE id=? AND clinica_id=?", args: [b4.usuario_id, authTg.clinica_id] })
        // Invalida sessões se desativou
        var check = await client.execute({ sql: "SELECT ativo FROM usuarios WHERE id=? AND clinica_id=?", args: [b4.usuario_id, authTg.clinica_id] })
        if (check.rows.length && !check.rows[0].ativo) {
            await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [b4.usuario_id] })
        }
        await cfgLib.registrar(client, authTg, check.rows.length && !check.rows[0].ativo ? 'usuario.inativar' : 'usuario.reativar', 'Usuário #' + b4.usuario_id, req)
        return res.status(200).json({ success: true })
    }

    // ── EXCLUIR USUÁRIO ──────────────────────────────────────
    if (action === 'excluir-usuario') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var { authenticateRequest: authEU } = require('../lib/middleware')
        var authEx = await authEU(req)
        if (!authEx) return res.status(401).json({ success: false, error: 'Não autenticado' })
        if (authEx.perfil !== 'admin') return res.status(403).json({ success: false, error: 'Apenas admin' })
        var b5 = req.body || {}
        if (!b5.usuario_id) return res.status(400).json({ success: false, error: 'usuario_id obrigatório' })
        if (Number(b5.usuario_id) === Number(authEx.usuario_id)) return res.status(400).json({ success: false, error: 'Você não pode excluir a própria conta' })
        // Verifica que o usuário pertence à mesma clínica
        var owEx = await client.execute({ sql: "SELECT id FROM usuarios WHERE id=? AND clinica_id=?", args: [b5.usuario_id, authEx.clinica_id] })
        if (!owEx.rows.length) return res.status(404).json({ success: false, error: 'Usuário não encontrado' })
        await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [b5.usuario_id] })
        await client.execute({ sql: "DELETE FROM usuarios WHERE id=? AND clinica_id=?", args: [b5.usuario_id, authEx.clinica_id] })
        await client.execute({ sql: "DELETE FROM permissoes_usuario WHERE usuario_id=? AND clinica_id=?", args: [b5.usuario_id, authEx.clinica_id] }).catch(function () {})
        await cfgLib.registrar(client, authEx, 'usuario.excluir', 'Usuário #' + b5.usuario_id, req)
        return res.status(200).json({ success: true, msg: 'Usuário excluído' })
    }

    // ── EDITAR USUÁRIO (admin) ───────────────────────────────
    if (action === 'editar-usuario') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var { authenticateRequest: authED } = require('../lib/middleware')
        var authEd = await authED(req)
        if (!authEd) return res.status(401).json({ success: false, error: 'Não autenticado' })
        if (authEd.perfil !== 'admin') return res.status(403).json({ success: false, error: 'Apenas admin' })
        var be = req.body || {}
        var ue = (await client.execute({ sql: "SELECT id, perfil FROM usuarios WHERE id=? AND clinica_id=?", args: [be.usuario_id, authEd.clinica_id] })).rows[0]
        if (!ue) return res.status(404).json({ success: false, error: 'Usuário não encontrado' })
        var nomeE = String(be.nome || '').trim().slice(0, 120)
        if (!nomeE) return res.status(400).json({ success: false, error: 'Informe o nome' })
        var perfilE = require('../lib/permissoes').PERFIS.indexOf(be.perfil) >= 0 ? be.perfil : ue.perfil
        if (Number(ue.id) === Number(authEd.usuario_id) && perfilE !== 'admin') return res.status(400).json({ success: false, error: 'Você não pode tirar o seu próprio perfil de administrador' })
        var emailP = String(be.email_pessoal || '').trim().toLowerCase().slice(0, 150)
        if (emailP && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailP)) return res.status(400).json({ success: false, error: 'E-mail pessoal inválido' })
        var profE = parseInt(be.profissional_id, 10) || null
        if (profE && !(await client.execute({ sql: "SELECT id FROM profissionais WHERE id=? AND clinica_id=?", args: [profE, authEd.clinica_id] })).rows.length) return res.status(400).json({ success: false, error: 'Profissional inválido' })
        await client.execute({ sql: "UPDATE usuarios SET nome=?, perfil=?, email_pessoal=?, telefone=?, profissional_id=? WHERE id=? AND clinica_id=?", args: [nomeE, perfilE, emailP || null, String(be.telefone || '').slice(0, 20) || null, profE, ue.id, authEd.clinica_id] })
        if (perfilE !== ue.perfil) await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=?", args: [ue.id] })
        await cfgLib.registrar(client, authEd, 'usuario.editar', nomeE + (perfilE !== ue.perfil ? ' (perfil ' + ue.perfil + ' → ' + perfilE + ')' : ''), req)
        return res.status(200).json({ success: true })
    }

    // ── ATUALIZAR PERFIL (self-service) ──────────────────────
    if (action === 'atualizar-perfil') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
        var { authenticateRequest: authAP } = require('../lib/middleware')
        var authAp = await authAP(req)
        if (!authAp) return res.status(401).json({ success: false, error: 'Não autenticado' })

        var bp = req.body || {}
        var nome = (bp.nome || '').trim()
        var emailPessoal = (bp.email_pessoal || '').toLowerCase().trim()
        var novoUsuario = (bp.novo_usuario || '').toLowerCase().trim()
        var novaSenha = bp.nova_senha || ''
        var senhaAtual = bp.senha_atual || ''

        var trocaSensivel = !!(novoUsuario || novaSenha)
        if (trocaSensivel) {
            if (!senhaAtual) return res.status(400).json({ success: false, error: 'Senha atual obrigatória para alterar usuário ou senha' })
            var curUser = await client.execute({ sql: "SELECT senha_hash FROM usuarios WHERE id=?", args: [authAp.usuario_id] })
            if (!curUser.rows.length) return res.status(404).json({ success: false, error: 'Usuário não encontrado' })
            var hashCur = curUser.rows[0].senha_hash || ''
            var senhaOk = hashCur.indexOf('$2') === 0 && bcrypt.compareSync(senhaAtual, hashCur)
            if (!senhaOk) return res.status(401).json({ success: false, error: 'Senha atual incorreta' })
        }

        if (emailPessoal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPessoal)) {
            return res.status(400).json({ success: false, error: 'Email pessoal inválido' })
        }

        if (novoUsuario) {
            if (!/^[^\s@]+@[^\s@]+$/.test(novoUsuario)) return res.status(400).json({ success: false, error: 'Nome de usuário inválido' })
            var dup = await client.execute({ sql: "SELECT id FROM usuarios WHERE email=? AND id<>?", args: [novoUsuario, authAp.usuario_id] })
            if (dup.rows.length) return res.status(409).json({ success: false, error: 'Este usuário já está em uso' })
        }

        if (novaSenha) {
            var erroNs = validarSenha(novaSenha)
            if (erroNs) return res.status(400).json({ success: false, error: erroNs })
        }

        var sets = []
        var args = []
        if (nome) { sets.push('nome=?'); args.push(nome) }
        if (emailPessoal) { sets.push('email_pessoal=?'); args.push(emailPessoal) }
        if (novoUsuario) { sets.push('email=?'); args.push(novoUsuario) }
        if (novaSenha) { sets.push('senha_hash=?'); args.push(bcrypt.hashSync(novaSenha, 10)); sets.push('deve_redefinir=0') }

        if (!sets.length) return res.status(400).json({ success: false, error: 'Nenhum campo para atualizar' })

        args.push(authAp.usuario_id)
        await client.execute({ sql: "UPDATE usuarios SET " + sets.join(',') + " WHERE id=?", args: args })

        if (novaSenha) {
            var tokenCurrent = (req.headers.authorization || '').replace('Bearer ', '')
            await client.execute({ sql: "DELETE FROM sessoes WHERE usuario_id=? AND token<>?", args: [authAp.usuario_id, tokenCurrent] })
        }

        var updRow = await client.execute({ sql: "SELECT id,nome,email,email_pessoal,perfil,clinica_id FROM usuarios WHERE id=?", args: [authAp.usuario_id] })
        var u = updRow.rows[0] || {}
        return res.status(200).json({ success: true, usuario: { id: u.id, nome: u.nome, email: u.email, email_pessoal: u.email_pessoal || '', perfil: u.perfil, clinica_id: u.clinica_id } })
    }

    return res.status(400).json({ success: false, error: 'Action inválida', actions: ['login', 'me', 'logout', 'criar-usuario', 'listar-usuarios', 'alterar-senha', 'redefinir-senha', 'esqueci-senha', 'resetar', 'ativar', 'toggle-usuario', 'excluir-usuario', 'atualizar-perfil'] })
}
