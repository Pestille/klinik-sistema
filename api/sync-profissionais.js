// api/sync-profissionais.js — Sync profissionais Clinicorp → Turso
var https = require('https')
var { getClient } = require('./db')

var USUARIO = 'klinik'
var TOKEN   = '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
var SUB     = 'klinik'

function auth() {
    return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

function fetchProfs() {
    return new Promise(function(resolve) {
        var qs = '?subscriber_id=' + SUB + '&limit=100&page=1'
        var opts = {
            hostname: 'api.clinicorp.com',
            path: '/rest/v1/professional/list_all_professionals' + qs,
            method: 'GET',
            headers: { 'Authorization': auth(), 'accept': 'application/json' }
        }
        var req = https.request(opts, function(res) {
            var body = ''
            res.on('data', function(c) { body += c })
            res.on('end', function() {
                try {
                    var d = JSON.parse(body)
                    var items = Array.isArray(d) ? d : (d.data || d.items || d.results || d.list || [])
                    resolve(items)
                } catch(e) { resolve([]) }
            })
        })
        req.on('error', function() { resolve([]) })
        req.setTimeout(10000, function() { req.destroy(); resolve([]) })
        req.end()
    })
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var startTime = Date.now()

    try {
        var client = getClient()
        var profs = await fetchProfs()
        var salvos = 0
        var erros = 0

        for (var i = 0; i < profs.length; i++) {
            var p = profs[i]
            try {
                var id = String(p.id || p.Id || p.PersonId || p.professionalId || i)
                var nome = p.name || p.Name || p.professionalName || ''
                var especialidade = p.specialty || p.Specialty || p.especialidade || ''
                var cro = p.cro || p.CRO || p.Cro || ''
                var telefone = p.phone || p.Phone || p.MobilePhone || ''
                var email = p.email || p.Email || ''

                if (!nome) continue

                await client.execute({
                    sql: "INSERT INTO profissionais (clinicorp_id, nome, cro, especialidade, telefone, email, sincronizado_em) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET nome=excluded.nome, cro=excluded.cro, especialidade=excluded.especialidade, telefone=excluded.telefone, email=excluded.email, atualizado_em=datetime('now'), sincronizado_em=datetime('now')",
                    args: [id, nome, cro, especialidade, telefone, email]
                })
                salvos++
            } catch(e) { erros++ }
        }

        var duracao = Date.now() - startTime
        try {
            await client.execute({
                sql: "INSERT INTO sync_log (tabela, operacao, registros_processados, registros_erros, detalhes, finalizado_em) VALUES ('profissionais', 'sync_clinicorp', ?, ?, ?, datetime('now'))",
                args: [salvos, erros, JSON.stringify({ total_api: profs.length, ms: duracao })]
            })
        } catch(e) {}

        var countResult = await client.execute('SELECT COUNT(*) as total FROM profissionais')

        res.status(200).json({
            success: true,
            profissionais_api: profs.length,
            salvos: salvos,
            erros: erros,
            total_no_banco: countResult.rows[0].total,
            ms: duracao
        })
    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
