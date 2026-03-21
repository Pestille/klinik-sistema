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

        return {
            usuario_id: sess.usuario_id,
            clinica_id: sess.clinica_id,
            perfil: sess.perfil,
            nome: sess.nome
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

module.exports = { authenticateRequest, requireRole }
