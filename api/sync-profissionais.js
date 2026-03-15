// api/sync-profissionais.js — com debug de erro
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

    try {
        var client = getClient()
        var profs = await fetchProfs()
        var salvos = 0
        var errosDetalhes = []

        // Primeiro: mostrar as colunas da tabela
        var schema = await client.execute("PRAGMA table_info(profissionais)")

        // Mostrar o primeiro profissional para ver os campos
        var amostra = profs.length > 0 ? Object.keys(profs[0]) : []

        for (var i = 0; i < profs.length; i++) {
            var p = profs[i]
            try {
                var id = String(p.id || p.Id || p.PersonId || p.professionalId || i)
                var nome = p.name || p.Name || p.professionalName || ''
                var especialidade = p.specialty || p.Specialty || p.especialidade || ''

                if (!nome) continue

                await client.execute({
                    sql: "INSERT INTO profissionais (clinicorp_id, nome, especialidade) VALUES (?, ?, ?) ON CONFLICT(clinicorp_id) DO UPDATE SET nome=excluded.nome, especialidade=excluded.especialidade",
                    args: [id, nome, especialidade]
                })
                salvos++
            } catch(e) {
                errosDetalhes.push({ prof: (p.name || p.Name || '?'), erro: e.message })
            }
        }

        var countResult = await client.execute('SELECT COUNT(*) as total FROM profissionais')

        res.status(200).json({
            success: true,
            profissionais_api: profs.length,
            campos_api: amostra,
            colunas_tabela: schema.rows.map(function(r) { return r.name }),
            salvos: salvos,
            erros: errosDetalhes,
            total_no_banco: countResult.rows[0].total,
            primeiro_prof: profs.length > 0 ? profs[0] : null
        })
    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
