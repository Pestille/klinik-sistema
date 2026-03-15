// api/sync-agendamentos.js — Sync agendamentos Clinicorp → Turso
// USO: /api/sync-agendamentos?page=1 (pagina por pagina para nao estourar timeout)
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
            path: '/rest/v1/appointment/list' + qs,
            method: 'GET',
            headers: { 'Authorization': auth(), 'accept': 'application/json' }
        }
        var req = https.request(opts, function(res) {
            var body = ''
            res.on('data', function(c) { body += c })
            res.on('end', function() {
                try {
                    var d = JSON.parse(body)
                    var items = Array.isArray(d) ? d : []
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
            var a = items[i]
            try {
                var clinicorpId = String(a.id || a.AppointmentId || a.Id || (pg + '-' + i))
                var data = a.date || ''
                if (data) data = data.slice(0, 10)
                var horaInicio = a.fromTime || ''
                var horaFim = a.toTime || ''
                var dataHora = data + ' ' + horaInicio
                var categoria = a.CategoryDescription || ''
                var deleted = a.Deleted ? 1 : 0
                var status = deleted ? 'cancelado' : 'agendado'
                var pacienteNome = a.PatientName || ''
                var pacienteId = String(a.Patient_PersonId || '')
                var profissionalId = String(a.Dentist_PersonId || '')
                var notas = a.Notes || ''
                var primeira = a.FirstAppointment === 'X' ? 1 : 0

                // Buscar IDs locais
                var pacLocalId = null
                var profLocalId = null

                if (pacienteId) {
                    try {
                        var pr = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id = ?', args: [pacienteId] })
                        if (pr.rows.length > 0) pacLocalId = pr.rows[0].id
                    } catch(e) {}
                }
                if (profissionalId) {
                    try {
                        var pp = await client.execute({ sql: 'SELECT id FROM profissionais WHERE clinicorp_id = ?', args: [profissionalId] })
                        if (pp.rows.length > 0) profLocalId = pp.rows[0].id
                    } catch(e) {}
                }

                await client.execute({
                    sql: "INSERT INTO agendamentos (clinicorp_id, paciente_id, profissional_id, data_hora, tipo, status, procedimento, observacoes, sincronizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET paciente_id=excluded.paciente_id, profissional_id=excluded.profissional_id, data_hora=excluded.data_hora, tipo=excluded.tipo, status=excluded.status, procedimento=excluded.procedimento, observacoes=excluded.observacoes, atualizado_em=datetime('now'), sincronizado_em=datetime('now')",
                    args: [clinicorpId, pacLocalId, profLocalId, dataHora, categoria, status, pacienteNome, notas]
                })
                salvos++
            } catch(e) { erros++ }
        }

        var duracao = Date.now() - startTime
        try {
            await client.execute({
                sql: "INSERT INTO sync_log (tabela, operacao, registros_processados, registros_erros, detalhes, finalizado_em) VALUES ('agendamentos', 'sync_clinicorp', ?, ?, ?, datetime('now'))",
                args: [salvos, erros, JSON.stringify({ pagina: pg, ms: duracao })]
            })
        } catch(e) {}

        var countResult = await client.execute('SELECT COUNT(*) as total FROM agendamentos')

        res.status(200).json({
            success: true,
            pagina: pg,
            agendamentos_na_pagina: items.length,
            salvos: salvos,
            erros: erros,
            total_no_banco: countResult.rows[0].total,
            proxima_pagina: items.length >= 100 ? '/api/sync-agendamentos?page=' + (pg + 1) : null,
            ms: duracao
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
