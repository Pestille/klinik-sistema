// api/sync-pacientes.js — Sync Clinicorp → Turso (versão final)
var https = require('https')
var { getClient } = require('./db')

var USUARIO = 'klinik'
var TOKEN   = '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
var SUB     = 'klinik'
var BID     = '5073030694043648'

function auth() {
    return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

function fetchPage(endpoint, params) {
    return new Promise(function(resolve) {
        var qs = '?' + Object.entries(params).map(function(kv) {
            return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1])
        }).join('&')
        var opts = {
            hostname: 'api.clinicorp.com',
            path: '/rest/v1/' + endpoint + qs,
            method: 'GET',
            headers: { 'Authorization': auth(), 'accept': 'application/json' }
        }
        var req = https.request(opts, function(res) {
            var body = ''
            res.on('data', function(c) { body += c })
            res.on('end', function() {
                if (res.statusCode >= 400) { resolve({ items: [], _error: res.statusCode }); return }
                try {
                    var d = JSON.parse(body)
                    var items = Array.isArray(d) ? d : (d.data || d.items || d.results || d.list || [])
                    resolve({ items: items })
                } catch(e) { resolve({ items: [], _parse_error: e.message }) }
            })
        })
        req.on('error', function(e) { resolve({ items: [], _err: e.message }) })
        req.setTimeout(20000, function() { req.destroy(); resolve({ items: [], _timeout: true }) })
        req.end()
    })
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var startTime = Date.now()
    var totalProcessados = 0
    var totalErros = 0

    try {
        var client = getClient()

        var d = new Date()
        var from = new Date(); from.setDate(from.getDate() - 365)
        var params = {
            subscriber_id: SUB,
            businessId: BID,
            from: from.toISOString().slice(0, 10),
            to: d.toISOString().slice(0, 10),
            limit: 100,
            page: 1
        }

        var allItems = []
        for (var pg = 1; pg <= 10; pg++) {
            params.page = pg
            var r = await fetchPage('appointment/list', params)
            if (r._error || r._timeout || r._err) break
            allItems = allItems.concat(r.items)
            if (r.items.length < 100) break
        }

        // Extrair pacientes unicos usando campos REAIS da API
        var pacientesMap = {}
        allItems.forEach(function(a) {
            if (a.Deleted) return
            // Campos reais: PatientName, Patient_PersonId, MobilePhone, Phone, Email
            var nome = a.PatientName || a.patientName || ''
            var id = String(a.Patient_PersonId || a.PatientId || a.patientId || '')
            var tel = a.MobilePhone || a.Phone || a.mobilePhone || ''
            var email = a.Email || a.email || ''
            if (!nome && !id) return
            var key = id || nome
            if (!pacientesMap[key]) {
                pacientesMap[key] = { clinicorp_id: key, nome: nome, telefone: tel, email: email }
            }
        })

        var pacientes = Object.values(pacientesMap)

        for (var i = 0; i < pacientes.length; i++) {
            var p = pacientes[i]
            try {
                await client.execute({
                    sql: "INSERT INTO pacientes (clinicorp_id, nome, telefone, email, sincronizado_em) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET nome = excluded.nome, telefone = excluded.telefone, email = excluded.email, atualizado_em = datetime('now'), sincronizado_em = datetime('now')",
                    args: [p.clinicorp_id, p.nome, p.telefone, p.email]
                })
                totalProcessados++
            } catch (err) {
                totalErros++
            }
        }

        var duracao = Date.now() - startTime
        try {
            await client.execute({
                sql: "INSERT INTO sync_log (tabela, operacao, registros_processados, registros_erros, detalhes, finalizado_em) VALUES ('pacientes', 'sync_clinicorp', ?, ?, ?, datetime('now'))",
                args: [totalProcessados, totalErros, JSON.stringify({ agendamentos: allItems.length, pacientes: pacientes.length, ms: duracao })]
            })
        } catch(e) {}

        var countResult = await client.execute('SELECT COUNT(*) as total FROM pacientes')

        res.status(200).json({
            success: true,
            message: 'Sync concluido em ' + duracao + 'ms',
            agendamentos_lidos: allItems.length,
            pacientes_extraidos: pacientes.length,
            registros_salvos: totalProcessados,
            erros: totalErros,
            total_pacientes_no_banco: countResult.rows[0].total
        })

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack ? error.stack.substring(0, 300) : ''
        })
    }
}
