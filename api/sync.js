// api/sync.js — Router consolidado para TODOS os syncs Clinicorp → Turso
// Schema real: agendamentos.data_hora, financeiro.data_pagamento, pacientes.criado_em

const { getClient } = require('./db')

const BASE = 'https://api.clinicorp.com/rest/v1'
const USUARIO = process.env.CLINICORP_USUARIO || 'klinik'
const TOKEN   = process.env.CLINICORP_TOKEN   || '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
const BID     = process.env.CLINICORP_BID     || '5073030694043648'
const SUB     = 'klinik'

function auth() {
    return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

function fetchPage(endpoint, params) {
    return new Promise(function(resolve) {
        var https = require('https')
        var qs = '?' + Object.entries(Object.assign({ subscriber_id: SUB, businessId: BID }, params))
            .map(function(kv){ return encodeURIComponent(kv[0])+'='+encodeURIComponent(kv[1]) }).join('&')
        var opts = {
            hostname: 'api.clinicorp.com',
            path: '/rest/v1/' + endpoint + qs,
            method: 'GET',
            headers: { 'Authorization': auth(), 'accept': 'application/json' }
        }
        var req = https.request(opts, function(res) {
            var body = ''
            res.on('data', function(c){ body += c })
            res.on('end', function() {
                if (res.statusCode === 429) { resolve({ _rateLimit: true, items: [] }); return }
                if (res.statusCode >= 400)  { resolve({ _error: res.statusCode, items: [] }); return }
                try {
                    var d = JSON.parse(body)
                    var items = Array.isArray(d) ? d : (d.data||d.items||d.results||d.list||[])
                    resolve({ items: items, raw: d })
                } catch(e) { resolve({ items: [] }) }
            })
        })
        req.on('error', function(e){ resolve({ items: [], _err: e.message }) })
        req.setTimeout(8000, function(){ req.destroy(); resolve({ items: [], _timeout: true }) })
        req.end()
    })
}

async function fetchAll(endpoint, params, maxPages) {
    maxPages = maxPages || 3
    var all = []
    for (var page = 1; page <= maxPages; page++) {
        var r = await fetchPage(endpoint, Object.assign({}, params, { limit: 100, page: page }))
        if (r._rateLimit || r._timeout || r._error) break
        all = all.concat(r.items)
        if (r.items.length < 100) break
    }
    return all
}

// ── SYNC PROFISSIONAIS ────────────────────────────────────────────────────────
async function syncProfissionais(client) {
    var lista = await fetchAll('professional/list_all_professionals', {}, 2)
    var inseridos = 0, atualizados = 0
    for (var i = 0; i < lista.length; i++) {
        var p = lista[i]
        var cid = String(p.id || p.Id || p.ID || '')
        if (!cid) continue
        var nome = p.name || p.Name || p.nome || ''
        var esp  = p.specialty || p.Specialty || p.especialidade || ''
        var ativo = p.active === false || p.Active === false ? 0 : 1
        var existe = await client.execute({ sql: 'SELECT id FROM profissionais WHERE clinicorp_id=?', args: [cid] })
        if (existe.rows.length > 0) {
            await client.execute({ sql: "UPDATE profissionais SET nome=?,especialidade=?,ativo=?,atualizado_em=datetime('now') WHERE clinicorp_id=?", args: [nome, esp, ativo, cid] })
            atualizados++
        } else {
            await client.execute({ sql: "INSERT INTO profissionais(clinicorp_id,nome,especialidade,ativo,criado_em,atualizado_em) VALUES(?,?,?,?,datetime('now'),datetime('now'))", args: [cid, nome, esp, ativo] })
            inseridos++
        }
    }
    return { tipo: 'profissionais', total: lista.length, inseridos: inseridos, atualizados: atualizados }
}

// ── SYNC PACIENTES ────────────────────────────────────────────────────────────
async function syncPacientes(client, pagina) {
    var pg = parseInt(pagina) || 1
    var pageSize = 100
    var r = await fetchPage('patient/list', { limit: pageSize, page: pg })
    var lista = r.items || []
    var temMais = lista.length === pageSize
    var inseridos = 0, atualizados = 0
    for (var i = 0; i < lista.length; i++) {
        var p = lista[i]
        var cid = String(p.id || p.Id || p.ID || p.patientId || '')
        if (!cid) continue
        var nome  = p.name || p.Name || p.nome || ''
        var tel   = p.phone || p.Phone || p.mobilePhone || p.MobilePhone || p.telefone || ''
        var email = p.email || p.Email || ''
        var nasc  = p.birthDate || p.BirthDate || p.birth_date || p.dataNascimento || ''
        var cpf   = p.cpf || p.CPF || p.document || ''
        var existe = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id=?', args: [cid] })
        if (existe.rows.length > 0) {
            await client.execute({ sql: "UPDATE pacientes SET nome=?,telefone=?,email=?,data_nascimento=?,cpf=?,atualizado_em=datetime('now') WHERE clinicorp_id=?", args: [nome, tel, email, nasc, cpf, cid] })
            atualizados++
        } else {
            await client.execute({ sql: "INSERT INTO pacientes(clinicorp_id,nome,telefone,email,data_nascimento,cpf,ativo,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,1,datetime('now'),datetime('now'))", args: [cid, nome, tel, email, nasc, cpf] })
            inseridos++
        }
    }
    return { tipo: 'pacientes', pagina: pg, processados: lista.length, inseridos: inseridos, atualizados: atualizados, temMaisPaginas: temMais, proximaPagina: temMais ? pg + 1 : null }
}

// ── SYNC AGENDAMENTOS ─────────────────────────────────────────────────────────
async function syncAgendamentos(client, dataInicio, dataFim) {
    var hoje = new Date()
    var inicio = dataInicio || new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
    var fim    = dataFim    || new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10)
    var lista = await fetchAll('appointment/list', { from: inicio, to: fim }, 5)
    var inseridos = 0, atualizados = 0
    for (var i = 0; i < lista.length; i++) {
        var a = lista[i]
        var cid = String(a.id || a.Id || a.appointmentId || '')
        if (!cid) continue

        // Resolve paciente_id
        var pacienteId = null
        var pacCid = String(a.patientId || a.PatientId || a.patient_id || '')
        if (pacCid) {
            var rp = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id=?', args: [pacCid] })
            if (rp.rows.length > 0) pacienteId = rp.rows[0].id
        }

        // Resolve profissional_id
        var profId = null
        var proCid = String(a.professionalId || a.ProfessionalId || a.professional_id || '')
        if (proCid) {
            var rpr = await client.execute({ sql: 'SELECT id FROM profissionais WHERE clinicorp_id=?', args: [proCid] })
            if (rpr.rows.length > 0) profId = rpr.rows[0].id
        }

        // data_hora: combina date + fromTime da Clinicorp
        var dataHora = a.date || a.Date || a.dateTime || a.DateTime || ''
        var horaInicio = a.fromTime || a.FromTime || a.startTime || ''
        if (dataHora && horaInicio && !dataHora.includes('T') && !dataHora.includes(' ')) {
            dataHora = dataHora + ' ' + horaInicio
        }

        var tipo       = a.CategoryDescription || a.categoryDescription || a.tipo || a.type || ''
        var status     = (a.status || a.Status || 'agendado').toLowerCase()
        var procedimento = a.procedureName || a.ProcedureName || a.procedure || ''
        var valor      = parseFloat(a.value || a.Value || a.amount || 0) || 0
        var obs        = a.observations || a.Observations || a.observacoes || ''

        var existe = await client.execute({ sql: 'SELECT id FROM agendamentos WHERE clinicorp_id=?', args: [cid] })
        if (existe.rows.length > 0) {
            await client.execute({
                sql: "UPDATE agendamentos SET paciente_id=?,profissional_id=?,data_hora=?,tipo=?,status=?,procedimento=?,valor=?,observacoes=?,atualizado_em=datetime('now') WHERE clinicorp_id=?",
                args: [pacienteId, profId, dataHora, tipo, status, procedimento, valor, obs, cid]
            })
            atualizados++
        } else {
            await client.execute({
                sql: "INSERT INTO agendamentos(clinicorp_id,paciente_id,profissional_id,data_hora,tipo,status,procedimento,valor,observacoes,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))",
                args: [cid, pacienteId, profId, dataHora, tipo, status, procedimento, valor, obs]
            })
            inseridos++
        }
    }

    // Registra no sync_log
    try {
        await client.execute({
            sql: "INSERT INTO sync_log(tabela,operacao,registros_processados,finalizado_em) VALUES('agendamentos','sync',?,datetime('now'))",
            args: [lista.length]
        })
    } catch(e) {}

    return { tipo: 'agendamentos', periodo: inicio + ' → ' + fim, total: lista.length, inseridos: inseridos, atualizados: atualizados }
}

// ── SYNC FINANCEIRO ───────────────────────────────────────────────────────────
async function syncFinanceiro(client, dataInicio, dataFim) {
    var hoje = new Date()
    var inicio = dataInicio || new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
    var fim    = dataFim    || new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10)
    var lista = await fetchAll('financial/list_receipt', { from: inicio, to: fim }, 5)
    var inseridos = 0, atualizados = 0
    for (var i = 0; i < lista.length; i++) {
        var r = lista[i]
        var cid = String(r.id || r.Id || r.receiptId || '')
        if (!cid) continue

        var pacienteId = null
        var pacCid = String(r.patientId || r.PatientId || r.patient_id || '')
        if (pacCid) {
            var rp2 = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id=?', args: [pacCid] })
            if (rp2.rows.length > 0) pacienteId = rp2.rows[0].id
        }

        var valor      = parseFloat(r.Amount || r.amount || r.Value || r.value || 0) || 0
        var dataPag    = r.ReceiptDate || r.receiptDate || r.date || r.Date || ''
        var forma      = r.PaymentMethod || r.paymentMethod || r.FormaPagamento || ''
        var desc       = r.Description || r.description || r.descricao || ''
        var tipo       = 'entrada' // recebimentos são sempre entradas

        var existe = await client.execute({ sql: 'SELECT id FROM financeiro WHERE clinicorp_id=?', args: [cid] })
        if (existe.rows.length > 0) {
            await client.execute({
                sql: "UPDATE financeiro SET paciente_id=?,tipo=?,descricao=?,valor=?,data_pagamento=?,forma_pagamento=?,atualizado_em=datetime('now') WHERE clinicorp_id=?",
                args: [pacienteId, tipo, desc, valor, dataPag, forma, cid]
            })
            atualizados++
        } else {
            await client.execute({
                sql: "INSERT INTO financeiro(clinicorp_id,paciente_id,tipo,descricao,valor,data_pagamento,forma_pagamento,status,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,'pago',datetime('now'),datetime('now'))",
                args: [cid, pacienteId, tipo, desc, valor, dataPag, forma]
            })
            inseridos++
        }
    }

    try {
        await client.execute({
            sql: "INSERT INTO sync_log(tabela,operacao,registros_processados,finalizado_em) VALUES('financeiro','sync',?,datetime('now'))",
            args: [lista.length]
        })
    } catch(e) {}

    return { tipo: 'financeiro', periodo: inicio + ' → ' + fim, total: lista.length, inseridos: inseridos, atualizados: atualizados }
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var params = req.method === 'POST' ? (req.body || {}) : req.query
    var tipo       = params.tipo
    var pagina     = params.pagina || 1
    var dataInicio = params.dataInicio || params.de || ''
    var dataFim    = params.dataFim   || params.ate || ''

    if (!tipo) {
        return res.status(400).json({
            error: "Parâmetro 'tipo' obrigatório.",
            tipos: ['profissionais', 'pacientes', 'agendamentos', 'financeiro', 'todos']
        })
    }

    var client = getClient()
    var t0 = Date.now()

    try {
        var resultado
        if (tipo === 'todos') {
            var r1 = await syncProfissionais(client)
            var r2 = await syncAgendamentos(client, dataInicio, dataFim)
            var r3 = await syncFinanceiro(client, dataInicio, dataFim)
            resultado = { sincs: [r1, r2, r3], aviso: 'Pacientes omitidos no modo todos — use tipo=pacientes paginado' }
        } else if (tipo === 'profissionais') {
            resultado = await syncProfissionais(client)
        } else if (tipo === 'pacientes') {
            resultado = await syncPacientes(client, pagina)
        } else if (tipo === 'agendamentos') {
            resultado = await syncAgendamentos(client, dataInicio, dataFim)
        } else if (tipo === 'financeiro') {
            resultado = await syncFinanceiro(client, dataInicio, dataFim)
        } else {
            return res.status(404).json({ error: "Tipo '" + tipo + "' não encontrado." })
        }

        return res.json({ success: true, duracao_ms: Date.now() - t0, timestamp: new Date().toISOString(), ...resultado })
    } catch (err) {
        console.error('[sync.js] tipo=' + tipo, err.message)
        return res.status(500).json({ error: err.message, tipo: tipo })
    }
}
