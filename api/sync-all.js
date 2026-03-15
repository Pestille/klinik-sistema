// api/sync-all.js — Roda todos os syncs em sequencia
// USO: /api/sync-all (sincroniza profissionais + pacientes + agendamentos + financeiro)
var https = require('https')
var { getClient } = require('./db')

var USUARIO = 'klinik'
var TOKEN   = '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
var SUB     = 'klinik'
var BID     = '5073030694043648'

function auth() {
    return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

function fetchApi(endpoint, extraParams) {
    return new Promise(function(resolve) {
        var params = Object.assign({ subscriber_id: SUB }, extraParams || {})
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
                try {
                    var d = JSON.parse(body)
                    var items = Array.isArray(d) ? d : (d.data || d.items || d.results || d.list || [])
                    resolve(items)
                } catch(e) { resolve([]) }
            })
        })
        req.on('error', function() { resolve([]) })
        req.setTimeout(20000, function() { req.destroy(); resolve([]) })
        req.end()
    })
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var startTime = Date.now()
    var resultados = {}

    try {
        var client = getClient()
        var d = new Date()
        var from = new Date(); from.setDate(from.getDate() - 90)
        var dateParams = { businessId: BID, from: from.toISOString().slice(0,10), to: d.toISOString().slice(0,10), limit: 100, page: 1 }

        // 1. PROFISSIONAIS
        var profs = await fetchApi('professional/list_all_professionals')
        var profSalvos = 0
        for (var i = 0; i < profs.length; i++) {
            var p = profs[i]
            var nome = p.name || p.Name || ''
            if (!nome) continue
            try {
                await client.execute({
                    sql: "INSERT INTO profissionais (clinicorp_id, nome, especialidade, sincronizado_em) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET nome=excluded.nome, especialidade=excluded.especialidade, atualizado_em=datetime('now'), sincronizado_em=datetime('now')",
                    args: [String(p.id || p.Id || p.PersonId || i), nome, p.specialty || p.Specialty || '']
                })
                profSalvos++
            } catch(e) {}
        }
        resultados.profissionais = { api: profs.length, salvos: profSalvos }

        // 2. AGENDAMENTOS (1 pagina = 100)
        var ags = await fetchApi('appointment/list', dateParams)
        var agSalvos = 0
        for (var j = 0; j < ags.length; j++) {
            var a = ags[j]
            try {
                var agId = String(a.id || a.AppointmentId || a.Id || j)
                var dataAg = (a.date || '').slice(0, 10)
                await client.execute({
                    sql: "INSERT INTO agendamentos (clinicorp_id, data_hora, tipo, status, procedimento, observacoes, sincronizado_em) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET data_hora=excluded.data_hora, tipo=excluded.tipo, status=excluded.status, procedimento=excluded.procedimento, atualizado_em=datetime('now'), sincronizado_em=datetime('now')",
                    args: [agId, dataAg + ' ' + (a.fromTime || ''), a.CategoryDescription || '', a.Deleted ? 'cancelado' : 'agendado', a.PatientName || '', a.Notes || '']
                })
                agSalvos++
            } catch(e) {}
        }
        resultados.agendamentos = { api: ags.length, salvos: agSalvos }

        // 3. FINANCEIRO (1 pagina = 100)
        var fins = await fetchApi('financial/list_receipt', dateParams)
        var finSalvos = 0
        for (var k = 0; k < fins.length; k++) {
            var f = fins[k]
            try {
                var finId = String(f.id || f.Id || f.ReceiptId || ('fin-' + k))
                var valor = parseFloat(f.Amount || f.amount || f.Value || 0)
                await client.execute({
                    sql: "INSERT INTO financeiro (clinicorp_id, tipo, descricao, valor, data_pagamento, forma_pagamento, status, sincronizado_em) VALUES (?, ?, ?, ?, ?, ?, 'pago', datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET tipo=excluded.tipo, descricao=excluded.descricao, valor=excluded.valor, data_pagamento=excluded.data_pagamento, atualizado_em=datetime('now'), sincronizado_em=datetime('now')",
                    args: [finId, valor >= 0 ? 'entrada' : 'saida', (f.PatientName || '') + ' - ' + (f.PaymentMethod || ''), valor, (f.ReceiptDate || f.date || '').slice(0, 10), f.PaymentMethod || '']
                })
                finSalvos++
            } catch(e) {}
        }
        resultados.financeiro = { api: fins.length, salvos: finSalvos }

        // Log
        var duracao = Date.now() - startTime
        await client.execute({
            sql: "INSERT INTO sync_log (tabela, operacao, registros_processados, detalhes, finalizado_em) VALUES ('todos', 'sync_all', ?, ?, datetime('now'))",
            args: [profSalvos + agSalvos + finSalvos, JSON.stringify(resultados)]
        })

        // Contagens finais
        var counts = {}
        var tabelas = ['pacientes', 'profissionais', 'agendamentos', 'financeiro']
        for (var t = 0; t < tabelas.length; t++) {
            var cr = await client.execute('SELECT COUNT(*) as total FROM ' + tabelas[t])
            counts[tabelas[t]] = cr.rows[0].total
        }

        res.status(200).json({
            success: true,
            sync: resultados,
            totais_no_banco: counts,
            ms: duracao
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
