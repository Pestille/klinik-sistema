// api/sync.js — Router consolidado para TODOS os syncs Clinicorp → Turso
// Campos reais Clinicorp: Amount, ReceiptDate, PatientId, PatientName, id, Deleted

const { getClient } = require('./db')

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
        var merged = Object.assign({ subscriber_id: SUB, businessId: BID }, params)
        var qs = '?' + Object.entries(merged)
            .map(function(kv){ return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1]) }).join('&')
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
                if (res.statusCode === 429) { resolve({ _rateLimit: true, status: 429, items: [] }); return }
                if (res.statusCode >= 400)  { resolve({ _error: res.statusCode, status: res.statusCode, items: [], raw_start: body.slice(0,200) }); return }
                try {
                    var d = JSON.parse(body)
                    var items = Array.isArray(d) ? d : (d.data || d.items || d.results || d.list || [])
                    resolve({ status: res.statusCode, items: items, raw: d, keys: Array.isArray(d) ? null : Object.keys(d) })
                } catch(e) { resolve({ status: res.statusCode, items: [], raw_start: body.slice(0,200) }) }
            })
        })
        req.on('error', function(e){ resolve({ items: [], _err: e.message }) })
        req.setTimeout(4000, function(){ req.destroy(); resolve({ items: [], _timeout: true }) })
        req.end()
    })
}

async function fetchAll(endpoint, params, maxPages) {
    maxPages = maxPages || 3
    var pageSize = parseInt(params.limit) || 100
    var all = []
    for (var page = 1; page <= maxPages; page++) {
        var r = await fetchPage(endpoint, Object.assign({}, params, { limit: pageSize, page: page }))
        if (r._rateLimit || r._timeout || r._error) break
        all = all.concat(r.items)
        if (r.items.length < pageSize) break
    }
    return all
}

function isoToDate(str) {
    if (!str) return null
    return str.slice(0, 10)
}

function hoje365() {
    var h = new Date()
    var d = new Date(); d.setDate(d.getDate() - 365)
    return { from: d.toISOString().slice(0,10), to: h.toISOString().slice(0,10) }
}

// ── EXPLORAR ENDPOINTS CLINICORP ──────────────────────────────────────────────
async function explorar() {
    var dt = hoje365()
    var endpoints = [
        // Já conhecidos
        { ep: 'patient/list', p: { limit: 2, page: 1 } },
        { ep: 'patient/birthdays', p: { initial_date: dt.from, final_date: dt.to, limit: 2 } },
        { ep: 'professional/list_all_professionals', p: { limit: 2 } },
        { ep: 'appointment/list', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'financial/list_receipt', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'procedures/list', p: { limit: 2 } },
        // Possíveis novos
        { ep: 'budget/list', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'budget/list_budgets', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'treatment/list', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'treatment/list_treatments', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'treatment_plan/list', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'financial/list_payment', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'financial/list_all', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'financial/list_invoice', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'anamnesis/list', p: { limit: 2 } },
        { ep: 'anamnese/list', p: { limit: 2 } },
        { ep: 'document/list', p: { limit: 2 } },
        { ep: 'prescription/list', p: { limit: 2 } },
        { ep: 'category/list', p: { limit: 2 } },
        { ep: 'attendance/list', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'clinical_record/list', p: { limit: 2 } },
        { ep: 'stock/list', p: { limit: 2 } },
        { ep: 'service/list', p: { limit: 2 } },
        { ep: 'payment/list', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'dental_chart/list', p: { limit: 2 } },
        { ep: 'odontogram/list', p: { limit: 2 } },
        { ep: 'schedule/list', p: { from: dt.from, to: dt.to, limit: 2 } },
        { ep: 'recall/list', p: { limit: 2 } },
        { ep: 'indication/list', p: { limit: 2 } },
        { ep: 'insurance/list', p: { limit: 2 } },
        { ep: 'price_table/list', p: { limit: 2 } },
    ]

    var results = await Promise.allSettled(
        endpoints.map(function(e) { return fetchPage(e.ep, e.p) })
    )

    var found = []
    var notFound = []
    for (var i = 0; i < endpoints.length; i++) {
        var ep = endpoints[i].ep
        var r = results[i].status === 'fulfilled' ? results[i].value : { _err: 'rejected' }
        if (r._timeout)   { notFound.push({ endpoint: ep, reason: 'timeout' }); continue }
        if (r._err)       { notFound.push({ endpoint: ep, reason: r._err }); continue }
        if (r._error)     { notFound.push({ endpoint: ep, reason: 'HTTP ' + r._error, detail: r.raw_start }); continue }
        var count = r.items ? r.items.length : 0
        var isArray = Array.isArray(r.raw)
        found.push({
            endpoint: ep,
            status: r.status,
            count: count,
            is_array: isArray,
            keys: r.keys,
            first_item_keys: count > 0 ? Object.keys(r.items[0]) : null,
            first_item: count > 0 ? r.items[0] : null
        })
    }

    return { tipo: 'explorar', encontrados: found.length, nao_encontrados: notFound.length, endpoints: found, erros: notFound }
}

// ── SYNC PROFISSIONAIS ────────────────────────────────────────────────────────
async function syncProfissionais(client) {
    // Garante colunas extras
    try { await client.execute("ALTER TABLE profissionais ADD COLUMN cpf TEXT") } catch(e) {}
    try { await client.execute("ALTER TABLE profissionais ADD COLUMN email TEXT") } catch(e) {}
    try { await client.execute("ALTER TABLE profissionais ADD COLUMN telefone TEXT") } catch(e) {}
    try { await client.execute("ALTER TABLE profissionais ADD COLUMN cro TEXT") } catch(e) {}

    var lista = await fetchAll('professional/list_all_professionals', {}, 3)
    var inseridos = 0, atualizados = 0
    for (var i = 0; i < lista.length; i++) {
        var p = lista[i]
        var cid  = String(p.id || p.Id || '')
        if (!cid) continue
        var nome  = p.name || p.Name || p.nome || ''
        var esp   = p.specialty || p.Specialty || p.especialidade || ''
        var cpf   = p.cpf || p.CPF || p.document || ''
        var email = p.email || p.Email || ''
        var tel   = p.phone || p.Phone || p.mobilePhone || ''
        var cro   = p.cro || p.CRO || p.council || ''
        var ativo = (p.active === false || p.Active === false) ? 0 : 1
        var existe = await client.execute({ sql: 'SELECT id FROM profissionais WHERE clinicorp_id=?', args: [cid] })
        if (existe.rows.length > 0) {
            await client.execute({ sql: "UPDATE profissionais SET nome=?,especialidade=?,cpf=?,email=?,telefone=?,cro=?,ativo=?,atualizado_em=datetime('now') WHERE clinicorp_id=?", args: [nome, esp, cpf, email, tel, cro, ativo, cid] })
            atualizados++
        } else {
            await client.execute({ sql: "INSERT INTO profissionais(clinicorp_id,nome,especialidade,cpf,email,telefone,cro,ativo,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))", args: [cid, nome, esp, cpf, email, tel, cro, ativo] })
            inseridos++
        }
    }
    return { tipo: 'profissionais', total: lista.length, inseridos, atualizados }
}

// ── SYNC PACIENTES ────────────────────────────────────────────────────────────
// Auto-paginação: se pagina='auto', busca TODAS as páginas (max 10 = 1000 pacientes)
async function syncPacientes(client, pagina) {
    var autoMode = pagina === 'auto'
    var startPage = autoMode ? 1 : (parseInt(pagina) || 1)
    var maxPage   = autoMode ? 10 : startPage
    var totalProcessados = 0, totalInseridos = 0, totalAtualizados = 0
    var paginasProcessadas = 0

    for (var pg = startPage; pg <= maxPage; pg++) {
        var r = await fetchPage('patient/list', { limit: 100, page: pg })
        var lista = r.items || []
        if (lista.length === 0) break
        paginasProcessadas++

        for (var i = 0; i < lista.length; i++) {
            var p = lista[i]
            var cid  = String(p.id || p.Id || p.patientId || '')
            if (!cid) continue
            var nome  = p.name || p.Name || p.nome || ''
            var tel   = p.phone || p.Phone || p.mobilePhone || p.MobilePhone || p.telefone || ''
            var email = p.email || p.Email || ''
            var nasc  = p.birthDate || p.BirthDate || p.birth_date || ''
            var cpf   = p.cpf || p.CPF || p.document || ''
            var existe = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id=?', args: [cid] })
            if (existe.rows.length > 0) {
                await client.execute({ sql: "UPDATE pacientes SET nome=?,telefone=?,email=?,data_nascimento=?,cpf=?,atualizado_em=datetime('now') WHERE clinicorp_id=?", args: [nome, tel, email, nasc, cpf, cid] })
                totalAtualizados++
            } else {
                await client.execute({ sql: "INSERT INTO pacientes(clinicorp_id,nome,telefone,email,data_nascimento,cpf,ativo,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,1,datetime('now'),datetime('now'))", args: [cid, nome, tel, email, nasc, cpf] })
                totalInseridos++
            }
        }
        totalProcessados += lista.length
        if (lista.length < 100) break // última página
    }

    return {
        tipo: 'pacientes',
        modo: autoMode ? 'auto' : 'pagina',
        paginas_processadas: paginasProcessadas,
        total_processados: totalProcessados,
        inseridos: totalInseridos,
        atualizados: totalAtualizados,
        completo: autoMode ? (paginasProcessadas < 10 || totalProcessados % 100 !== 0) : undefined
    }
}

// ── SYNC AGENDAMENTOS ─────────────────────────────────────────────────────────
async function syncAgendamentos(client, dataInicio, dataFim) {
    // Garante colunas extras
    try { await client.execute("ALTER TABLE agendamentos ADD COLUMN hora_fim TEXT") } catch(e) {}
    try { await client.execute("ALTER TABLE agendamentos ADD COLUMN paciente_nome TEXT") } catch(e) {}
    try { await client.execute("ALTER TABLE agendamentos ADD COLUMN paciente_telefone TEXT") } catch(e) {}
    try { await client.execute("ALTER TABLE agendamentos ADD COLUMN profissional_nome TEXT") } catch(e) {}

    var h = new Date()
    var d7 = new Date(); d7.setDate(d7.getDate() - 7)
    var inicio = dataInicio || d7.toISOString().slice(0,10)
    var fim    = dataFim    || h.toISOString().slice(0,10)
    var lista = await fetchAll('appointment/list', { from: inicio, to: fim }, 1)
    var inseridos = 0, atualizados = 0
    for (var i = 0; i < lista.length; i++) {
        var a = lista[i]
        var cid = String(a.id || a.Id || a.appointmentId || '')
        if (!cid) continue

        var pacienteId = null
        // Clinicorp usa Patient_PersonId e Dentist_PersonId
        var pacCid = String(a.Patient_PersonId || a.patientId || a.PatientId || '')
        if (pacCid) {
            var rp = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id=?', args: [pacCid] })
            if (rp.rows.length > 0) pacienteId = rp.rows[0].id
        }

        var profId = null
        var proCid = String(a.Dentist_PersonId || a.professionalId || a.ProfessionalId || '')
        if (proCid) {
            var rpr = await client.execute({ sql: 'SELECT id FROM profissionais WHERE clinicorp_id=?', args: [proCid] })
            if (rpr.rows.length > 0) profId = rpr.rows[0].id
        }

        var dataRaw = a.date || a.Date || ''
        var dataPart = dataRaw ? dataRaw.slice(0,10) : '' // "2026-03-19"
        var horaInicio = a.fromTime || a.FromTime || ''
        var dataHora = dataPart && horaInicio ? dataPart + ' ' + horaInicio : dataPart

        var tipo     = a.CategoryDescription || a.categoryDescription || ''
        var statusRaw = a.StatusId || a.status || a.Status || ''
        var status   = (typeof statusRaw === 'string' ? statusRaw : 'agendado').toLowerCase() || 'agendado'
        var proc     = a.Procedures || a.procedureName || a.ProcedureName || ''
        var valor    = parseFloat(a.value || a.Value || a.amount || 0) || 0
        var obs      = a.Notes || a.observations || a.Observations || ''
        var horaFim  = a.toTime || a.ToTime || null
        var pacNome  = a.PatientName || a.Name || ''
        var pacTel   = a.MobilePhone || ''
        var profNome = '' // Resolve pelo profId
        if (profId) {
            var prn = await client.execute({ sql: 'SELECT nome FROM profissionais WHERE id=?', args: [profId] })
            if (prn.rows.length > 0) profNome = prn.rows[0].nome
        }

        var existe = await client.execute({ sql: 'SELECT id FROM agendamentos WHERE clinicorp_id=?', args: [cid] })
        if (existe.rows.length > 0) {
            await client.execute({ sql: "UPDATE agendamentos SET paciente_id=?,profissional_id=?,data_hora=?,hora_fim=?,tipo=?,status=?,procedimento=?,valor=?,observacoes=?,paciente_nome=?,paciente_telefone=?,profissional_nome=?,atualizado_em=datetime('now') WHERE clinicorp_id=?", args: [pacienteId, profId, dataHora, horaFim, tipo, status, proc, valor, obs, pacNome, pacTel, profNome, cid] })
            atualizados++
        } else {
            await client.execute({ sql: "INSERT INTO agendamentos(clinicorp_id,paciente_id,profissional_id,data_hora,hora_fim,tipo,status,procedimento,valor,observacoes,paciente_nome,paciente_telefone,profissional_nome,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))", args: [cid, pacienteId, profId, dataHora, horaFim, tipo, status, proc, valor, obs, pacNome, pacTel, profNome] })
            inseridos++
        }
    }
    try { await client.execute({ sql: "INSERT INTO sync_log(tabela,operacao,registros_processados,finalizado_em) VALUES('agendamentos','sync',?,datetime('now'))", args: [lista.length] }) } catch(e) {}
    return { tipo: 'agendamentos', periodo: inicio + ' → ' + fim, total: lista.length, inseridos, atualizados }
}

// ── SYNC FINANCEIRO ───────────────────────────────────────────────────────────
// Clinicorp retorna array direto — fetch direto sem fetchAll
async function syncFinanceiro(client) {
    var https = require('https')
    var dt = hoje365()
    var params = {
        subscriber_id: SUB, businessId: BID,
        from: dt.from, to: dt.to, limit: 500
    }
    var qs = '?' + Object.entries(params)
        .map(function(kv){ return encodeURIComponent(kv[0])+'='+encodeURIComponent(kv[1]) }).join('&')

    var apiStatus = 0
    var rawSample = ''
    var lista = await new Promise(function(resolve) {
        var opts = {
            hostname: 'api.clinicorp.com',
            path: '/rest/v1/financial/list_receipt' + qs,
            method: 'GET',
            headers: { 'Authorization': auth(), 'accept': 'application/json' }
        }
        var req2 = https.request(opts, function(r) {
            apiStatus = r.statusCode
            var body = ''
            r.on('data', function(c){ body += c })
            r.on('end', function() {
                rawSample = body.slice(0, 300)
                if (r.statusCode >= 400) { resolve([]); return }
                try { var d = JSON.parse(body); resolve(Array.isArray(d) ? d : (d.data||d.items||[])) }
                catch(e) { resolve([]) }
            })
        })
        req2.on('error', function(){ resolve([]) })
        req2.setTimeout(9000, function(){ req2.destroy(); resolve([]) })
        req2.end()
    })

    var deletados  = lista.filter(function(r){ return r.Deleted === true || r.Deleted === 'X' })
    var ativos     = lista.filter(function(r){ return r.Deleted !== true && r.Deleted !== 'X' })

    var inseridos = 0, atualizados = 0, ignorados = 0

    for (var i = 0; i < ativos.length; i++) {
        var r = ativos[i]
        var cid = String(r.id || r.Id || '')
        if (!cid) { ignorados++; continue }

        var valor    = parseFloat(r.Amount || r.amount || 0) || 0
        if (valor <= 0) { ignorados++; continue }

        var pacienteId = null
        var pacCid = String(r.PatientId || r.patientId || '')
        if (pacCid) {
            var rp2 = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id=?', args: [pacCid] })
            if (rp2.rows.length > 0) pacienteId = rp2.rows[0].id
        }

        var dataPag  = isoToDate(r.ReceiptDate || r.receiptDate || r.date || '')
        var desc     = r.Description || r.description || r.PatientName || r.patientName || ''

        var existe = await client.execute({ sql: 'SELECT id FROM financeiro WHERE clinicorp_id=?', args: [cid] })
        if (existe.rows.length > 0) {
            await client.execute({
                sql: "UPDATE financeiro SET paciente_id=?,descricao=?,valor=?,data_pagamento=?,atualizado_em=datetime('now') WHERE clinicorp_id=?",
                args: [pacienteId, desc, valor, dataPag, cid]
            })
            atualizados++
        } else {
            await client.execute({
                sql: "INSERT INTO financeiro(clinicorp_id,paciente_id,tipo,descricao,valor,data_pagamento,forma_pagamento,status,criado_em,atualizado_em) VALUES(?,?,'entrada',?,?,?,'recibo','pago',datetime('now'),datetime('now'))",
                args: [cid, pacienteId, desc, valor, dataPag]
            })
            inseridos++
        }
    }

    try { await client.execute({ sql: "INSERT INTO sync_log(tabela,operacao,registros_processados,finalizado_em) VALUES('financeiro','sync',?,datetime('now'))", args: [ativos.length] }) } catch(e) {}
    return {
        tipo: 'financeiro',
        api_status: apiStatus,
        total: lista.length,
        ativos: ativos.length,
        deletados: deletados.length,
        inseridos, atualizados, ignorados
    }
}

// ── SYNC PROCEDIMENTOS (tabelas de preço) ────────────────────────────────────
// procedures/list retorna objeto: { PARTICULAR: [...], PREVIDENT: [...], ... }
async function syncProcedimentos(client) {
    try {
        await client.execute("CREATE TABLE IF NOT EXISTS procedimentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinicorp_id TEXT UNIQUE, tabela_preco TEXT, codigo TEXT, descricao TEXT NOT NULL, valor REAL DEFAULT 0, ativo INTEGER DEFAULT 1, criado_em TEXT, atualizado_em TEXT)")
    } catch(e) {}

    var r = await fetchPage('procedures/list', {})
    var raw = r.raw || {}
    // Se for objeto com tabelas como keys
    var tabelas = Array.isArray(raw) ? {} : raw
    var inseridos = 0, atualizados = 0, totalItens = 0

    var keys = Object.keys(tabelas)
    for (var k = 0; k < keys.length; k++) {
        var nomeTabela = keys[k]
        var itens = tabelas[nomeTabela]
        if (!Array.isArray(itens)) continue
        for (var i = 0; i < itens.length; i++) {
            var p = itens[i]
            var cid = String(p.id || p.Id || '')
            if (!cid) continue
            totalItens++
            var codigo = p.code || p.Code || p.TussCode || ''
            var desc   = p.name || p.Name || p.description || p.Description || ''
            var valor  = parseFloat(p.value || p.Value || p.price || p.Price || 0) || 0
            var ativo  = (p.active === false || p.Deleted) ? 0 : 1

            var existe = await client.execute({ sql: 'SELECT id FROM procedimentos WHERE clinicorp_id=?', args: [cid] })
            if (existe.rows.length > 0) {
                await client.execute({ sql: "UPDATE procedimentos SET tabela_preco=?,codigo=?,descricao=?,valor=?,ativo=?,atualizado_em=datetime('now') WHERE clinicorp_id=?", args: [nomeTabela, codigo, desc, valor, ativo, cid] })
                atualizados++
            } else {
                await client.execute({ sql: "INSERT INTO procedimentos(clinicorp_id,tabela_preco,codigo,descricao,valor,ativo,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))", args: [cid, nomeTabela, codigo, desc, valor, ativo] })
                inseridos++
            }
        }
    }
    return { tipo: 'procedimentos', tabelas: keys, total_itens: totalItens, inseridos, atualizados, primeiro_item: totalItens === 0 ? (r.raw ? JSON.stringify(r.raw).slice(0,500) : null) : undefined }
}

// ── SYNC PAGAMENTOS ──────────────────────────────────────────────────────────
// payment/list retorna 1098+ registros com forma de pagamento, bandeira, parcelas
async function syncPagamentos(client) {
    try {
        await client.execute("CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinicorp_id TEXT UNIQUE, paciente_id INTEGER, paciente_nome TEXT, valor REAL, forma_pagamento TEXT, tipo TEXT, bandeira TEXT, parcelas INTEGER, data_pagamento TEXT, data_vencimento TEXT, data_recebimento TEXT, data_checkout TEXT, confirmado INTEGER DEFAULT 0, cancelado INTEGER DEFAULT 0, descricao TEXT, treatment_id TEXT, titular TEXT, titular_cpf TEXT, pagador_email TEXT, data_confirmacao TEXT, tipo_pessoa TEXT, criado_em TEXT, atualizado_em TEXT)")
        // Adiciona colunas novas se tabela já existia
        try { await client.execute("ALTER TABLE pagamentos ADD COLUMN titular TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE pagamentos ADD COLUMN titular_cpf TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE pagamentos ADD COLUMN pagador_email TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE pagamentos ADD COLUMN data_confirmacao TEXT") } catch(e) {}
        try { await client.execute("ALTER TABLE pagamentos ADD COLUMN tipo_pessoa TEXT") } catch(e) {}
    } catch(e) {}

    // Busca pagamentos: 3 meses atrás + 6 meses à frente (captura checkouts e parcelas)
    var h = new Date()
    var dInicio = new Date(h.getFullYear(), h.getMonth() - 3, 1)
    var dFim = new Date(h.getFullYear(), h.getMonth() + 6, 0)
    var desde = dInicio.toISOString().slice(0,10)
    var ate = dFim.toISOString().slice(0,10)
    var lista = await fetchAll('payment/list', { from: desde, to: ate, limit: 500 }, 10)
    var inseridos = 0, atualizados = 0, ignorados = 0

    for (var i = 0; i < lista.length; i++) {
        var p = lista[i]
        var cid = String(p.id || '')
        if (!cid) { ignorados++; continue }

        var valor = parseFloat(p.Amount || 0) || 0
        if (valor <= 0) { ignorados++; continue }

        // Resolve paciente_id
        var pacienteId = null
        var pacCid = String(p.PatientId || '')
        if (pacCid) {
            var rp = await client.execute({ sql: 'SELECT id FROM pacientes WHERE clinicorp_id=?', args: [pacCid] })
            if (rp.rows.length > 0) pacienteId = rp.rows[0].id
        }

        var forma     = p.PaymentForm || ''
        var tipo      = p.Type || ''
        var bandeira  = p.CreditDebitCardFlag || ''
        var parcelas  = parseInt(p.InstallmentsCount || p.CreditCardInstallmentsCount || 0) || 0
        var dataPag   = isoToDate(p.PaymentDate || '')
        var dataVenc  = isoToDate(p.DueDate || '')
        var dataReceb = isoToDate(p.ReceivedDate || '')
        var dataCheck = isoToDate(p.CheckOutDate || '')
        var confirmado = (p.PaymentConfirmed === 'X' || p.PaymentConfirmed === true) ? 1 : 0
        var cancelado  = (p.Canceled === 'X' || p.Canceled === true) ? 1 : 0
        var desc      = p.PaymentDescription || ''
        var pacNome   = p.PatientName || ''
        var treatId   = String(p.TreatmentId || '')
        var titular   = p.OwnerName || p.PayerName || ''
        var titCpf    = p.OwnerCPF || ''
        var pagEmail  = p.PayerEmail || ''
        var dataConf  = isoToDate(p.ConfirmedDate || '')
        var tipoPess  = p.PersonType || ''

        var existe = await client.execute({ sql: 'SELECT id FROM pagamentos WHERE clinicorp_id=?', args: [cid] })
        if (existe.rows.length > 0) {
            await client.execute({
                sql: "UPDATE pagamentos SET paciente_id=?,paciente_nome=?,valor=?,forma_pagamento=?,tipo=?,bandeira=?,parcelas=?,data_pagamento=?,data_vencimento=?,data_recebimento=?,data_checkout=?,confirmado=?,cancelado=?,descricao=?,treatment_id=?,titular=?,titular_cpf=?,pagador_email=?,data_confirmacao=?,tipo_pessoa=?,atualizado_em=datetime('now') WHERE clinicorp_id=?",
                args: [pacienteId, pacNome, valor, forma, tipo, bandeira, parcelas, dataPag, dataVenc, dataReceb, dataCheck, confirmado, cancelado, desc, treatId, titular, titCpf, pagEmail, dataConf, tipoPess, cid]
            })
            atualizados++
        } else {
            await client.execute({
                sql: "INSERT INTO pagamentos(clinicorp_id,paciente_id,paciente_nome,valor,forma_pagamento,tipo,bandeira,parcelas,data_pagamento,data_vencimento,data_recebimento,data_checkout,confirmado,cancelado,descricao,treatment_id,titular,titular_cpf,pagador_email,data_confirmacao,tipo_pessoa,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))",
                args: [cid, pacienteId, pacNome, valor, forma, tipo, bandeira, parcelas, dataPag, dataVenc, dataReceb, dataCheck, confirmado, cancelado, desc, treatId, titular, titCpf, pagEmail, dataConf, tipoPess]
            })
            inseridos++
        }
    }

    return { tipo: 'pagamentos', total: lista.length, inseridos, atualizados, ignorados }
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var params     = req.method === 'POST' ? (req.body || {}) : req.query
    var tipo       = params.tipo
    var pagina     = params.pagina || 1
    var dataInicio = params.dataInicio || params.de || ''
    var dataFim    = params.dataFim   || params.ate || ''

    if (!tipo) {
        return res.status(400).json({
            error: "Parâmetro 'tipo' obrigatório.",
            tipos: ['explorar', 'profissionais', 'pacientes', 'agendamentos', 'financeiro', 'pagamentos', 'procedimentos', 'todos'],
            exemplos: [
                '/api/sync?tipo=explorar                     → sonda TODOS os endpoints Clinicorp',
                '/api/sync?tipo=pacientes&pagina=auto        → sync TODOS os pacientes',
                '/api/sync?tipo=agendamentos                 → últimos 365 dias',
                '/api/sync?tipo=agendamentos&de=2025-01-01&ate=2026-03-18',
                '/api/sync?tipo=financeiro',
                '/api/sync?tipo=pagamentos                   → 1098+ pagamentos detalhados',
                '/api/sync?tipo=procedimentos                → tabelas de preço',
                '/api/sync?tipo=profissionais',
                '/api/sync?tipo=todos'
            ]
        })
    }

    var t0 = Date.now()

    try {
        var resultado

        if (tipo === 'explorar') {
            resultado = await explorar()
            return res.json({ success: true, duracao_ms: Date.now() - t0, ...resultado })
        }

        var client = getClient()

        if (tipo === 'todos') {
            var r1 = await syncProfissionais(client)
            var r2 = await syncProcedimentos(client)
            var r3 = await syncFinanceiro(client)
            var r4 = await syncPagamentos(client)
            resultado = { sincs: [r1, r2, r3, r4], aviso: 'Pacientes e Agendamentos: executar separado para evitar timeout' }
        } else if (tipo === 'profissionais') {
            resultado = await syncProfissionais(client)
        } else if (tipo === 'pacientes') {
            resultado = await syncPacientes(client, pagina)
        } else if (tipo === 'agendamentos') {
            resultado = await syncAgendamentos(client, dataInicio, dataFim)
        } else if (tipo === 'financeiro') {
            resultado = await syncFinanceiro(client)
        } else if (tipo === 'procedimentos') {
            resultado = await syncProcedimentos(client)
        } else if (tipo === 'pagamentos') {
            resultado = await syncPagamentos(client)
        } else {
            return res.status(404).json({ error: "Tipo '" + tipo + "' não encontrado." })
        }

        return res.json({ success: true, duracao_ms: Date.now() - t0, timestamp: new Date().toISOString(), ...resultado })
    } catch (err) {
        console.error('[sync.js] tipo=' + tipo, err.message)
        return res.status(500).json({ error: err.message, tipo })
    }
}
