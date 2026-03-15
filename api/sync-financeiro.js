// api/sync-financeiro.js — Sync recebimentos Clinicorp → Turso
var https = require('https')
var { getClient } = require('./db')

var USUARIO = 'klinik'
var TOKEN   = '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
var SUB     = 'klinik'
var BID     = '5073030694043648'

function auth() {
    return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

function fetchOnePage(page, dias) {
    return new Promise(function(resolve) {
        var d = new Date()
        var from = new Date(); from.setDate(from.getDate() - (dias || 365))
        var qs = '?subscriber_id=' + SUB +
            '&businessId=' + BID +
            '&from=' + from.toISOString().slice(0,10) +
            '&to=' + d.toISOString().slice(0,10) +
            '&limit=100&page=' + page
        var opts = {
            hostname: 'api.clinicorp.com',
            path: '/rest/v1/financial/list_receipt' + qs,
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
        req.setTimeout(15000, function() { req.destroy(); resolve([]) })
        req.end()
    })
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var startTime = Date.now()
    var pg = parseInt(req.query.page) || 1
    var dias = parseInt(req.query.dias) || 365

    try {
        var client = getClient()
        var items = await fetchOnePage(pg, dias)
        var salvos = 0
        var erros = 0

        for (var i = 0; i < items.length; i++) {
            var r = items[i]
            try {
                var clinicorpId = String(r.id || r.Id || r.ReceiptId || (pg + '-fin-' + i))
                var valor = parseFloat(r.Amount || r.amount || r.Value || r.value || 0)
                var data = (r.ReceiptDate || r.date || r.Date || '').slice(0, 10)
                var pacienteNome = r.PatientName || r.patientName || ''
                var descricao = r.Description || r.description || r.PaymentMethod || ''
                var tipo = valor >= 0 ? 'entrada' : 'saida'
                var formaPagamento = r.PaymentMethod || r.paymentMethod || ''

                if (!clinicorpId) continue

                // Buscar paciente local
                var pacLocalId = null
                var pacClinicorpId = String(r.Patient_PersonId || r.PatientId || '')
                if (pacClinicorpId) {
                    try {
                        var pr = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id = ?', args: [pacClinicorpId] })
                        if (pr.rows.length > 0) pacLocalId = pr.rows[0].id
                    } catch(e) {}
                }

                await client.execute({
                    sql: "INSERT INTO financeiro (clinicorp_id, paciente_id, tipo, descricao, valor, data_pagamento, forma_pagamento, status, sincronizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, 'pago', datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET paciente_id=excluded.paciente_id, tipo=excluded.tipo, descricao=excluded.descricao, valor=excluded.valor, data_pagamento=excluded.data_pagamento, forma_pagamento=excluded.forma_pagamento, atualizado_em=datetime('now'), sincronizado_em=datetime('now')",
                    args: [clinicorpId, pacLocalId, tipo, pacienteNome + ' - ' + descricao, valor, data, formaPagamento]
                })
                salvos++
            } catch(e) { erros++ }
        }

        var duracao = Date.now() - startTime
        try {
            await client.execute({
                sql: "INSERT INTO sync_log (tabela, operacao, registros_processados, registros_erros, detalhes, finalizado_em) VALUES ('financeiro', 'sync_clinicorp', ?, ?, ?, datetime('now'))",
                args: [salvos, erros, JSON.stringify({ pagina: pg, ms: duracao })]
            })
        } catch(e) {}

        var countResult = await client.execute('SELECT COUNT(*) as total FROM financeiro')
        var somaResult = await client.execute('SELECT SUM(valor) as total FROM financeiro')

        res.status(200).json({
            success: true,
            pagina: pg,
            recebimentos_na_pagina: items.length,
            salvos: salvos,
            erros: erros,
            total_no_banco: countResult.rows[0].total,
            valor_total: somaResult.rows[0].total,
            proxima_pagina: items.length >= 100 ? '/api/sync-financeiro?page=' + (pg + 1) : null,
            ms: duracao
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
