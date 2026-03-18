// api/sync.js — Router de sincronização Clinicorp → Turso
// USO: /api/sync?tipo=pacientes
//      /api/sync?tipo=profissionais
//      /api/sync?tipo=agendamentos&page=1
//      /api/sync?tipo=financeiro&page=1
//      /api/sync?tipo=all

var https = require('https')
var { getClient } = require('./db')

var USUARIO = 'klinik'
var TOKEN   = '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
var SUB     = 'klinik'
var BID     = '5073030694043648'

function auth() { return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64') }

function fetchApi(endpoint, params) {
    return new Promise(function(resolve) {
        var allParams = Object.assign({ subscriber_id: SUB }, params || {})
        var qs = '?' + Object.entries(allParams).map(function(kv) { return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1]) }).join('&')
        var opts = { hostname: 'api.clinicorp.com', path: '/rest/v1/' + endpoint + qs, method: 'GET', headers: { 'Authorization': auth(), 'accept': 'application/json' } }
        var req = https.request(opts, function(res) {
            var body = ''
            res.on('data', function(c) { body += c })
            res.on('end', function() { try { var d = JSON.parse(body); var items = Array.isArray(d) ? d : (d.data || d.items || d.results || d.list || []); resolve(items) } catch(e) { resolve([]) } })
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

    var q = req.query || {}
    var tipo = q.tipo || ''
    var startTime = Date.now()

    try {
        var client = getClient()
        var d = new Date()
        var from = new Date(); from.setDate(from.getDate() - (parseInt(q.dias) || 365))
        var dateParams = { businessId: BID, from: from.toISOString().slice(0, 10), to: d.toISOString().slice(0, 10), limit: 100, page: parseInt(q.page) || 1 }

        // ═══ PROFISSIONAIS ═══
        if (tipo === 'profissionais') {
            var profs = await fetchApi('professional/list_all_professionals')
            var salvos = 0
            for (var i = 0; i < profs.length; i++) {
                var p = profs[i]; var nome = p.name || p.Name || ''; if (!nome) continue
                try { await client.execute({ sql: "INSERT INTO profissionais (clinicorp_id, nome, especialidade) VALUES (?, ?, ?) ON CONFLICT(clinicorp_id) DO UPDATE SET nome=excluded.nome, especialidade=excluded.especialidade", args: [String(p.id || i), nome, p.specialty || ''] }); salvos++ } catch(e) {}
            }
            return res.status(200).json({ success: true, tipo: 'profissionais', api: profs.length, salvos: salvos, ms: Date.now() - startTime })
        }

        // ═══ PACIENTES ═══
        if (tipo === 'pacientes') {
            var allItems = []
            for (var pg = 1; pg <= 10; pg++) {
                dateParams.page = pg
                var r = await fetchApi('appointment/list', dateParams)
                if (r.length === 0) break
                allItems = allItems.concat(r)
                if (r.length < 100) break
            }
            var map = {}
            allItems.forEach(function(a) { if (a.Deleted) return; var id = String(a.Patient_PersonId || ''); var nome = a.PatientName || ''; if (!id || !nome) return; if (!map[id]) map[id] = { id: id, nome: nome, tel: a.MobilePhone || a.Phone || '', email: a.Email || '' } })
            var pacs = Object.values(map); var salvos2 = 0
            for (var j = 0; j < pacs.length; j++) {
                try { await client.execute({ sql: "INSERT INTO pacientes (clinicorp_id, nome, telefone, email, sincronizado_em) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET nome=excluded.nome, telefone=excluded.telefone, email=excluded.email, atualizado_em=datetime('now'), sincronizado_em=datetime('now')", args: [pacs[j].id, pacs[j].nome, pacs[j].tel, pacs[j].email] }); salvos2++ } catch(e) {}
            }
            var cnt = await client.execute('SELECT COUNT(*) as total FROM pacientes')
            return res.status(200).json({ success: true, tipo: 'pacientes', agendamentos_lidos: allItems.length, pacientes_extraidos: pacs.length, salvos: salvos2, total_no_banco: cnt.rows[0].total, ms: Date.now() - startTime })
        }

        // ═══ AGENDAMENTOS ═══
        if (tipo === 'agendamentos') {
            var items = await fetchApi('appointment/list', dateParams)
            var salvos3 = 0, erros3 = 0
            for (var k = 0; k < items.length; k++) {
                var a = items[k]
                try {
                    var agId = String(a.id || a.AppointmentId || k); var data = (a.date || '').slice(0, 10); var pacNome = a.PatientName || ''; var pacId = String(a.Patient_PersonId || ''); var profId = String(a.Dentist_PersonId || '')
                    var pacLocal = null, profLocal = null
                    if (pacId) { try { var pr2 = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id = ?', args: [pacId] }); if (pr2.rows.length > 0) pacLocal = pr2.rows[0].id } catch(e) {} }
                    if (profId) { try { var pp = await client.execute({ sql: 'SELECT id FROM profissionais WHERE clinicorp_id = ?', args: [profId] }); if (pp.rows.length > 0) profLocal = pp.rows[0].id } catch(e) {} }
                    await client.execute({ sql: "INSERT INTO agendamentos (clinicorp_id, paciente_id, profissional_id, data_hora, tipo, status, procedimento, observacoes, sincronizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET paciente_id=excluded.paciente_id, profissional_id=excluded.profissional_id, data_hora=excluded.data_hora, tipo=excluded.tipo, status=excluded.status, procedimento=excluded.procedimento, atualizado_em=datetime('now'), sincronizado_em=datetime('now')", args: [agId, pacLocal, profLocal, data + ' ' + (a.fromTime || ''), a.CategoryDescription || '', a.Deleted ? 'cancelado' : 'agendado', pacNome, a.Notes || ''] })
                    salvos3++
                } catch(e) { erros3++ }
            }
            var cnt2 = await client.execute('SELECT COUNT(*) as total FROM agendamentos')
            return res.status(200).json({ success: true, tipo: 'agendamentos', pagina: dateParams.page, lidos: items.length, salvos: salvos3, erros: erros3, total_no_banco: cnt2.rows[0].total, proxima: items.length >= 100 ? '/api/sync?tipo=agendamentos&page=' + (dateParams.page + 1) : null, ms: Date.now() - startTime })
        }

        // ═══ FINANCEIRO ═══
        if (tipo === 'financeiro') {
            var fins = await fetchApi('financial/list_receipt', dateParams)
            var salvos4 = 0
            for (var l = 0; l < fins.length; l++) {
                var f = fins[l]
                try {
                    var fid = String(f.id || f.ReceiptId || ('fin-' + l)); var valor = parseFloat(f.Amount || f.amount || f.Value || 0)
                    await client.execute({ sql: "INSERT INTO financeiro (clinicorp_id, tipo, descricao, valor, data_pagamento, forma_pagamento, status, sincronizado_em) VALUES (?, ?, ?, ?, ?, ?, 'pago', datetime('now')) ON CONFLICT(clinicorp_id) DO UPDATE SET tipo=excluded.tipo, descricao=excluded.descricao, valor=excluded.valor, data_pagamento=excluded.data_pagamento, atualizado_em=datetime('now'), sincronizado_em=datetime('now')", args: [fid, valor >= 0 ? 'entrada' : 'saida', (f.PatientName || '') + ' - ' + (f.PaymentMethod || ''), valor, (f.ReceiptDate || f.date || '').slice(0, 10), f.PaymentMethod || ''] })
                    salvos4++
                } catch(e) {}
            }
            var cnt3 = await client.execute('SELECT COUNT(*) as total FROM financeiro')
            return res.status(200).json({ success: true, tipo: 'financeiro', lidos: fins.length, salvos: salvos4, total_no_banco: cnt3.rows[0].total, ms: Date.now() - startTime })
        }

        // ═══ ALL ═══
        if (tipo === 'all') {
            // Redireciona para sync sequencial via resposta
            return res.status(200).json({ success: true, tipo: 'all', instrucoes: 'Execute em sequencia: /api/sync?tipo=profissionais, depois /api/sync?tipo=pacientes, depois /api/sync?tipo=agendamentos&page=1, depois /api/sync?tipo=financeiro' })
        }

        return res.status(400).json({ success: false, error: 'Tipo invalido. Use: profissionais, pacientes, agendamentos, financeiro' })

    } catch(error) {
        return res.status(500).json({ success: false, error: error.message })
    }
}
