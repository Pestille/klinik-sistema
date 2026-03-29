// api/middleware.js — Middleware de autenticação e autorização (SaaS)
// Klinik Sistema — Campo Grande, MS

var { getClient } = require('./db')

/**
 * authenticateRequest(req)
 * Lê header Authorization: Bearer <token>, busca sessão válida
 * Retorna { usuario_id, clinica_id, perfil, nome } ou null
 */
async function authenticateRequest(req) {
    var authHeader = (req.headers && req.headers.authorization) || ''
    var token = authHeader.replace('Bearer ', '')
    if (!token) return null

    try {
        var client = getClient()
        var r = await client.execute({
            sql: "SELECT s.usuario_id, s.expira_em, u.nome, u.perfil, u.clinica_id FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=? AND u.ativo=1",
            args: [token]
        })
        if (!r.rows.length) return null

        var sess = r.rows[0]
        if (new Date(sess.expira_em) < new Date()) {
            await client.execute({ sql: "DELETE FROM sessoes WHERE token=?", args: [token] })
            return null
        }

        // Load clinic plan info
        var plano = 'trial', statusPg = 'ativo', planoFim = null
        try {
            var cliR = await client.execute({ sql: "SELECT plano,status_pagamento,plano_fim FROM clinicas WHERE id=?", args: [sess.clinica_id] })
            if (cliR.rows.length) {
                plano = cliR.rows[0].plano || 'trial'
                statusPg = cliR.rows[0].status_pagamento || 'ativo'
                planoFim = cliR.rows[0].plano_fim
            }
        } catch(e) {}

        return {
            usuario_id: sess.usuario_id,
            clinica_id: sess.clinica_id,
            perfil: sess.perfil,
            nome: sess.nome,
            plano: plano,
            status_pagamento: statusPg,
            plano_fim: planoFim
        }
    } catch (e) {
        console.error('[middleware] Erro ao autenticar:', e.message)
        return null
    }
}

/**
 * requireRole(auth, roles)
 * Verifica se auth.perfil está na lista de roles permitidos
 * Lança erro com status 403 se não estiver
 */
function requireRole(auth, roles) {
    if (!auth || roles.indexOf(auth.perfil) === -1) {
        var err = new Error('Sem permissão')
        err.status = 403
        err.error = 'Sem permissão'
        throw err
    }
}

/**
 * verificarPermissao(client, clinica_id, perfil, recurso)
 * Retorna true se o perfil tem permissão para o recurso
 */
async function verificarPermissao(client, clinica_id, perfil, recurso) {
    if (perfil === 'admin') return true // Admin always has access
    try {
        var r = await client.execute({
            sql: "SELECT permitido FROM permissoes WHERE (clinica_id IS NULL OR clinica_id=?) AND perfil=? AND recurso=? ORDER BY clinica_id DESC LIMIT 1",
            args: [clinica_id, perfil, recurso]
        })
        if (!r.rows.length) return false
        return r.rows[0].permitido === 1
    } catch(e) { return false }
}

/**
 * setCorsHeaders(req, res)
 * CORS restrito a origens confiáveis
 */
function setCorsHeaders(req, res) {
    var allowedOrigins = [
        'https://klinik-sistema.vercel.app',
        'https://klinik-sistema-pestilles-projects.vercel.app',
        'https://klinik-sistema-git-main-pestilles-projects.vercel.app'
    ]
    var origin = (req.headers && req.headers.origin) || ''
    if (allowedOrigins.indexOf(origin) !== -1) {
        res.setHeader('Access-Control-Allow-Origin', origin)
    } else if (!origin) {
        // Same-origin requests (no Origin header) or server-to-server
        res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
}

/**
 * Rate limiting simples em memória
 * Para produção com múltiplas instâncias, usar Redis
 */
var _rateLimits = {}
setInterval(function() { _rateLimits = {} }, 900000) // Limpa a cada 15 min

function checkRateLimit(key, maxRequests, windowMs) {
    var now = Date.now()
    if (!_rateLimits[key]) _rateLimits[key] = []
    // Remove entradas antigas
    _rateLimits[key] = _rateLimits[key].filter(function(t) { return now - t < windowMs })
    if (_rateLimits[key].length >= maxRequests) return false
    _rateLimits[key].push(now)
    return true
}

/**
 * escapeHtml - sanitiza strings para prevenir XSS
 */
function escapeHtml(str) {
    if (!str) return ''
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

module.exports = { authenticateRequest, requireRole, verificarPermissao, setCorsHeaders, checkRateLimit, escapeHtml }
