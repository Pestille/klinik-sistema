// api/data.js — Router consolidado (Turso DB)
// Schema real: agendamentos.data_hora, financeiro.data_pagamento, pacientes.criado_em

var { getClient } = require('./db')
var { authenticateRequest, verificarPermissao } = require('./middleware')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var q = req.query || {}
    var route = q.r || ''

    if (!route) {
        return res.status(400).json({
            error: "Parâmetro 'r' obrigatório.",
            rotas: ['db-status','schema','dashboard','pacientes','agendamentos',
                    'profissionais','financeiro','crc','relatorios','busca',
                    'aniversariantes','conta-corrente','fluxo-caixa','metas','agenda-view']
        })
    }

    // Auth check — public routes skip authentication
    var publicRoutes = ['db-status', 'migrate-saas', 'marketing-migrate', 'orcamentos-migrate', 'importar-orcamentos-lote', 'anamnese-migrate', 'importar-anamneses-lote', 'importar-tabela-precos', 'pagamentos-migrate', 'financeiro-migrate', 'financeiro-migrate-v2', 'financeiro-migrate-v3', 'comissoes-migrate', 'permissoes-migrate']
    var auth = null, clinica_id = null
    if (publicRoutes.indexOf(route) === -1) {
        auth = await authenticateRequest(req)
        if (!auth) return res.status(401).json({ success: false, error: 'Não autenticado' })
        clinica_id = auth.clinica_id
    }

    try {
        var client = getClient()

        // Ensure foto_url column exists (once per cold start)
        if (!global._fotoColChecked) {
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN foto_url TEXT") } catch(e) {}
            global._fotoColChecked = true
        }

        // ── DB-STATUS ───────────────────────────────────────────────────────
        if (route === 'db-status') {
            var start = Date.now()
            await client.execute('SELECT 1')
            var lat = Date.now() - start
            var tabs = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            var counts = {}
            for (var i = 0; i < tabs.rows.length; i++) {
                try {
                    var cr = await client.execute('SELECT COUNT(*) as total FROM ' + tabs.rows[i].name)
                    counts[tabs.rows[i].name] = cr.rows[0].total
                } catch(e) { counts[tabs.rows[i].name] = 'erro' }
            }
            return res.status(200).json({ status: 'online', latencia_ms: lat, tabelas: counts, timestamp: new Date().toISOString() })
        }

        // ── SCHEMA ──────────────────────────────────────────────────────────
        if (route === 'schema') {
            var t = q.t || 'agendamentos'
            var r2 = await client.execute('PRAGMA table_info(' + t + ')')
            return res.status(200).json({ table: t, columns: r2.rows.map(function(c){ return { name: c.name, type: c.type } }) })
        }

        // ── DASHBOARD ───────────────────────────────────────────────────────
        if (route === 'dashboard') {
            var hoje = new Date().toISOString().slice(0, 10)
            var mesStr = hoje.slice(0, 7)
            var rs = await Promise.all([
                client.execute({ sql: 'SELECT COUNT(*) as total FROM pacientes WHERE clinica_id=?', args: [clinica_id] }),
                client.execute({ sql: 'SELECT COUNT(*) as total FROM profissionais WHERE ativo=1 AND clinica_id=?', args: [clinica_id] }),
                client.execute({ sql: 'SELECT COUNT(*) as total FROM agendamentos WHERE clinica_id=?', args: [clinica_id] }),
                client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE DATE(data_hora)=? AND clinica_id=?", args: [hoje, clinica_id] }),
                client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND clinica_id=?", args: [mesStr, clinica_id] }),
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE tipo='entrada' AND strftime('%Y-%m',data_pagamento)=? AND clinica_id=?", args: [mesStr, clinica_id] }),
                client.execute({ sql: "SELECT pr.id,pr.nome,pr.especialidade,COUNT(a.id) as total_agendamentos FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id WHERE pr.clinica_id=? GROUP BY pr.id ORDER BY total_agendamentos DESC", args: [clinica_id] }),
                client.execute({ sql: "SELECT p.id,p.nome,p.telefone,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(DATE(MAX(a.data_hora))) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id WHERE p.clinica_id=? GROUP BY p.id HAVING ultima_visita < date('now','-180 days') OR ultima_visita IS NULL ORDER BY ultima_visita ASC LIMIT 50", args: [clinica_id] }),
                client.execute({ sql: "SELECT strftime('%Y-%m',data_hora) as mes,COUNT(*) as total FROM agendamentos WHERE data_hora >= date('now','-6 months') AND clinica_id=? GROUP BY mes ORDER BY mes", args: [clinica_id] }),
                client.execute({ sql: "SELECT tipo,COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo!='' AND clinica_id=? GROUP BY tipo ORDER BY total DESC LIMIT 10", args: [clinica_id] }),
            ])
            return res.status(200).json({
                success: true,
                resumo: {
                    total_pacientes:     rs[0].rows[0].total,
                    total_profissionais: rs[1].rows[0].total,
                    total_agendamentos:  rs[2].rows[0].total,
                    agendamentos_hoje:   rs[3].rows[0].total,
                    agendamentos_mes:    rs[4].rows[0].total,
                    receita_mes:         rs[5].rows[0].total
                },
                profissionais:           rs[6].rows,
                inativos:                rs[7].rows,
                agendamentos_por_mes:    rs[8].rows,
                agendamentos_por_tipo:   rs[9].rows
            })
        }

        // ── PACIENTES ───────────────────────────────────────────────────────
        // ── PACIENTE COMPLETO (prontuário) ─────────────────────────
        if (route === 'paciente') {
            var pid = parseInt(q.id) || 0
            var pnome = q.nome || ''
            var sqlP, argP
            if (pid) { sqlP = "SELECT * FROM pacientes WHERE id=? AND clinica_id=?"; argP = [pid, clinica_id] }
            else { sqlP = "SELECT * FROM pacientes WHERE nome LIKE ? AND clinica_id=? LIMIT 1"; argP = ['%'+pnome+'%', clinica_id] }
            var rp = await client.execute({ sql: sqlP, args: argP })
            if (!rp.rows.length) return res.status(404).json({ success: false, error: 'Paciente não encontrado' })
            var pac = rp.rows[0]
            var rpId = pac.id
            var rs5 = await Promise.all([
                client.execute({ sql: "SELECT a.*,COALESCE(pr.nome,a.profissional_nome) as prof_nome FROM agendamentos a LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE (a.paciente_id=? OR a.paciente_nome LIKE ?) AND a.clinica_id=? ORDER BY a.data_hora DESC LIMIT 100", args: [rpId, '%'+pac.nome+'%', clinica_id] }),
                client.execute({ sql: "SELECT * FROM pagamentos WHERE (paciente_id=? OR paciente_nome LIKE ?) AND clinica_id=? ORDER BY data_pagamento DESC LIMIT 100", args: [rpId, '%'+pac.nome+'%', clinica_id] }),
                client.execute({ sql: "SELECT * FROM financeiro WHERE paciente_id=? AND clinica_id=? ORDER BY data_pagamento DESC LIMIT 50", args: [rpId, clinica_id] }),
            ])
            // Anamnese
            var anamneseRows = []
            try {
                var anmR = await client.execute({ sql: "SELECT * FROM anamnese_respostas WHERE paciente_id=? AND clinica_id=? ORDER BY pergunta_id", args: [rpId, clinica_id] })
                anamneseRows = anmR.rows
            } catch(e) { /* tabela não existe */ }
            // Odontograma — tabela pode não existir ainda
            var odontRows = []
            try {
                await client.execute("CREATE TABLE IF NOT EXISTS odontograma (id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER REFERENCES pacientes(id), dente INTEGER NOT NULL, status TEXT DEFAULT 'saudavel', cor TEXT, observacao TEXT, updated_at TEXT DEFAULT (datetime('now')))")
                var odR = await client.execute({ sql: "SELECT * FROM odontograma WHERE paciente_id=? AND clinica_id=? ORDER BY dente", args: [rpId, clinica_id] })
                odontRows = odR.rows
            } catch(e) { /* tabela não existe, retorna vazio */ }
            // Orçamentos
            var orcRows = []
            try {
                var orcR = await client.execute({ sql: "SELECT * FROM orcamentos WHERE paciente_id=? AND clinica_id=? ORDER BY data_criacao DESC", args: [rpId, clinica_id] })
                orcRows = orcR.rows
                var orcIds2 = orcRows.map(function(o) { return o.id })
                if (orcIds2.length) {
                    var itR = await client.execute({ sql: "SELECT * FROM orcamento_itens WHERE orcamento_id IN (" + orcIds2.join(',') + ") ORDER BY id", args: [] })
                    var itMap2 = {}
                    itR.rows.forEach(function(it) { if (!itMap2[it.orcamento_id]) itMap2[it.orcamento_id] = []; itMap2[it.orcamento_id].push(it) })
                    orcRows.forEach(function(o) { o.itens = itMap2[o.id] || [] })
                }
            } catch(e) { /* tabela não existe */ }
            return res.status(200).json({ success: true, paciente: pac, agendamentos: rs5[0].rows, pagamentos: rs5[1].rows, financeiro: rs5[2].rows, odontograma: odontRows, orcamentos: orcRows, anamnese: anamneseRows })
        }

        if (route === 'pacientes') {
            var page = parseInt(q.page) || 1
            var lim = Math.min(parseInt(q.limit) || 50, 200)
            var off = (page - 1) * lim
            var busca = q.busca || q.q || ''
            var status = q.status || ''
            var where = ' WHERE p.clinica_id=?', args = [clinica_id]
            if (busca) { where += ' AND (p.nome LIKE ? OR p.telefone LIKE ?)'; args.push('%'+busca+'%','%'+busca+'%') }
            var sql
            if (status === 'inativos') {
                sql = "SELECT p.id,p.nome,p.telefone,p.email,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(DATE(MAX(a.data_hora))) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id" + where + " GROUP BY p.id HAVING ultima_visita < date('now','-180 days') OR ultima_visita IS NULL ORDER BY ultima_visita ASC LIMIT ? OFFSET ?"
            } else if (status === 'ativos') {
                sql = "SELECT p.id,p.nome,p.telefone,p.email,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(DATE(MAX(a.data_hora))) AS INTEGER) as dias_ausente FROM pacientes p INNER JOIN agendamentos a ON p.id=a.paciente_id" + where + " GROUP BY p.id HAVING ultima_visita >= date('now','-180 days') ORDER BY ultima_visita DESC LIMIT ? OFFSET ?"
            } else {
                sql = "SELECT p.id,p.nome,p.telefone,p.email,p.data_nascimento,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(DATE(MAX(a.data_hora))) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id" + where + " GROUP BY p.id ORDER BY p.nome ASC LIMIT ? OFFSET ?"
            }
            args.push(lim, off)
            var pr = await client.execute({ sql: sql, args: args })
            var tot = await client.execute({ sql: 'SELECT COUNT(*) as total FROM pacientes WHERE clinica_id=?', args: [clinica_id] })
            return res.status(200).json({ success: true, data: pr.rows, total: tot.rows[0].total, page: page, limit: lim })
        }

        // ── AGENDAMENTOS ────────────────────────────────────────────────────
        if (route === 'agendamentos') {
            var lim2 = Math.min(parseInt(q.limit) || 1000, 5000)
            var base = "SELECT a.id,a.data_hora,a.hora_fim,a.tipo,a.status,a.procedimento,a.valor,a.observacoes,a.profissional_id,a.paciente_id,COALESCE(p.nome,a.paciente_nome) as paciente_nome,COALESCE(p.telefone,a.paciente_telefone) as paciente_telefone,p.foto_url as paciente_foto,COALESCE(pr.nome,a.profissional_nome) as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id"
            var wheres = ["a.clinica_id=?"], argsAg = [clinica_id]
            if (q.dataInicio && q.dataFim) { wheres.push("DATE(a.data_hora) BETWEEN ? AND ?"); argsAg.push(q.dataInicio, q.dataFim) }
            else if (q.data) { wheres.push("DATE(a.data_hora)=?"); argsAg.push(q.data) }
            else { var m = q.mes || new Date().toISOString().slice(0, 7); wheres.push("strftime('%Y-%m',a.data_hora)=?"); argsAg.push(m) }
            if (q.profissional) { wheres.push("a.profissional_id=?"); argsAg.push(q.profissional) }
            var sqlAg = base + (wheres.length ? " WHERE " + wheres.join(" AND ") : "") + " ORDER BY a.data_hora DESC LIMIT " + lim2
            var ra = await client.execute({ sql: sqlAg, args: argsAg })
            return res.status(200).json({ success: true, agendamentos: ra.rows, total: ra.rows.length })
        }

        // ── AGENDA VIEW ─────────────────────────────────────────────────────
        if (route === 'agenda-view') {
            var d = q.data || new Date().toISOString().slice(0, 10)
            var sqlAv, argsAv
            if (q.profissional) {
                sqlAv = "SELECT a.*,p.nome as paciente_nome,p.telefone as paciente_telefone,p.foto_url as paciente_foto,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND a.profissional_id=? AND a.clinica_id=? ORDER BY a.data_hora"
                argsAv = [d, q.profissional, clinica_id]
            } else {
                sqlAv = "SELECT a.*,p.nome as paciente_nome,p.telefone as paciente_telefone,p.foto_url as paciente_foto,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND a.clinica_id=? ORDER BY pr.nome,a.data_hora"
                argsAv = [d, clinica_id]
            }
            var rav = await client.execute({ sql: sqlAv, args: argsAv })
            var profs3 = await client.execute({ sql: 'SELECT id,nome,especialidade FROM profissionais WHERE ativo=1 AND clinica_id=? ORDER BY nome', args: [clinica_id] })
            return res.status(200).json({ success: true, agendamentos: rav.rows, profissionais: profs3.rows, data: d, total: rav.rows.length })
        }

        // ── PROFISSIONAIS ───────────────────────────────────────────────────
        if (route === 'profissionais') {
            var rpr = await client.execute({ sql: "SELECT pr.*,COUNT(a.id) as total_agendamentos FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id WHERE pr.clinica_id=? GROUP BY pr.id ORDER BY pr.nome", args: [clinica_id] })
            return res.status(200).json({ success: true, data: rpr.rows, total: rpr.rows.length })
        }

        // ── FINANCEIRO ──────────────────────────────────────────────────────
        if (route === 'financeiro') {
            var fw = ["f.clinica_id=?"], fa = [clinica_id]
            if (q.de)   { fw.push("f.data_pagamento >= ?"); fa.push(q.de) }
            if (q.ate)  { fw.push("f.data_pagamento <= ?"); fa.push(q.ate) }
            if (q.tipo) { fw.push("f.tipo = ?");            fa.push(q.tipo) }
            if (!q.de && !q.ate) {
                var m2 = q.mes || new Date().toISOString().slice(0, 7)
                fw.push("strftime('%Y-%m',f.data_pagamento)=?"); fa.push(m2)
            }
            var fwc = fw.length ? ' WHERE ' + fw.join(' AND ') : ''
            var flim2 = Math.min(parseInt(q.limit) || 200, 500)
            var fr = await client.execute({ sql: "SELECT f.*,p.nome as paciente_nome FROM financeiro f LEFT JOIN pacientes p ON p.id=f.paciente_id" + fwc + " ORDER BY f.data_pagamento DESC LIMIT ?", args: fa.concat([flim2]) })
            var ft = await client.execute({ sql: "SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) as total_entradas,COALESCE(SUM(CASE WHEN tipo='saida' THEN ABS(valor) ELSE 0 END),0) as total_saidas,COUNT(*) as total_registros FROM financeiro f" + fwc, args: fa })
            return res.status(200).json({ success: true, data: fr.rows, totais: ft.rows[0] })
        }

        // ── CRC (inativos) ──────────────────────────────────────────────────
        if (route === 'crc') {
            var busca2 = q.busca || q.q || ''
            var cw = busca2 ? ' WHERE p.clinica_id=? AND p.nome LIKE ?' : ' WHERE p.clinica_id=?'
            var ca = busca2 ? [clinica_id, '%'+busca2+'%'] : [clinica_id]
            var prioridade = q.prioridade || ''
            var having = " GROUP BY p.id HAVING ultima_visita < date('now','-180 days') OR ultima_visita IS NULL"
            if (prioridade === 'urgente')    having += ' AND dias_ausente > 365'
            else if (prioridade === 'alta')  having += ' AND dias_ausente > 270 AND dias_ausente <= 365'
            else if (prioridade === 'media') having += ' AND dias_ausente > 180 AND dias_ausente <= 270'
            var rc = await client.execute({ sql: "SELECT p.id,p.nome,p.telefone,p.email,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(DATE(MAX(a.data_hora))) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id" + cw + having + " ORDER BY dias_ausente DESC LIMIT 200", args: ca })
            var cdata = rc.rows.map(function(p) {
                var pr2 = (p.dias_ausente > 365 || !p.ultima_visita) ? 'urgente' : p.dias_ausente > 270 ? 'alta' : 'media'
                return { id: p.id, nome: p.nome, telefone: p.telefone, email: p.email, ultima_visita: p.ultima_visita, dias_ausente: p.dias_ausente, prioridade: pr2 }
            })
            var urg = cdata.filter(function(p){ return p.prioridade==='urgente' }).length
            var alt = cdata.filter(function(p){ return p.prioridade==='alta' }).length
            var med = cdata.filter(function(p){ return p.prioridade==='media' }).length
            return res.status(200).json({ success: true, data: cdata, total: cdata.length, contagens: { urgente: urg, alta: alt, media: med } })
        }

        // ── RELATÓRIOS ──────────────────────────────────────────────────────
        if (route === 'relatorios') {
            var tipo = q.tipo || 'producao'
            var meses2 = parseInt(q.meses) || 6
            if (tipo === 'producao') {
                var prod = await client.execute({ sql: "SELECT strftime('%Y-%m',data_hora) as mes,COUNT(*) as agendamentos FROM agendamentos WHERE data_hora >= date('now','-' || ? || ' months') AND clinica_id=? GROUP BY mes ORDER BY mes", args: [meses2, clinica_id] })
                var rece = await client.execute({ sql: "SELECT strftime('%Y-%m',data_pagamento) as mes,SUM(valor) as receita FROM financeiro WHERE data_pagamento >= date('now','-' || ? || ' months') AND tipo='entrada' AND clinica_id=? GROUP BY mes ORDER BY mes", args: [meses2, clinica_id] })
                return res.status(200).json({ success: true, tipo: 'producao', producao_mensal: prod.rows, receita_mensal: rece.rows })
            }
            if (tipo === 'procedimentos') {
                var procs = await client.execute({ sql: "SELECT tipo,COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo!='' AND clinica_id=? GROUP BY tipo ORDER BY total DESC LIMIT 15", args: [clinica_id] })
                return res.status(200).json({ success: true, tipo: 'procedimentos', data: procs.rows })
            }
            return res.status(200).json({ success: true, tipo: tipo, data: [] })
        }

        // ── BUSCA ───────────────────────────────────────────────────────────
        if (route === 'busca') {
            var bq = q.q || q.busca || ''
            if (bq.length < 2) return res.status(400).json({ success: false, error: 'Mínimo 2 caracteres' })
            var bt = '%' + bq + '%'
            var bp = await client.execute({ sql: "SELECT id,nome,telefone,email,foto_url FROM pacientes WHERE (nome LIKE ? OR telefone LIKE ?) AND clinica_id=? LIMIT 15", args: [bt, bt, clinica_id] })
            var ba = await client.execute({ sql: "SELECT a.id,a.data_hora,a.tipo,a.status,a.procedimento,p.nome as paciente_nome,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE p.nome LIKE ? AND a.clinica_id=? ORDER BY a.data_hora DESC LIMIT 10", args: [bt, clinica_id] })
            return res.status(200).json({ success: true, pacientes: bp.rows, agendamentos: ba.rows, total: bp.rows.length + ba.rows.length })
        }

        // ── ANIVERSARIANTES ─────────────────────────────────────────────────
        // ── DIAGNOSTICO INTEGRAÇÕES ──────────────────────────────────
        if (route === 'diagnostico-integracoes') {
            var diag = {
                whatsapp_token: process.env.WHATSAPP_TOKEN ? 'Configurado (' + process.env.WHATSAPP_TOKEN.slice(0, 8) + '...)' : 'NAO CONFIGURADO',
                whatsapp_phone_id: process.env.WHATSAPP_PHONE_ID || 'NAO CONFIGURADO',
                whatsapp_template: process.env.WHATSAPP_TEMPLATE_NAME || 'Nao configurado (usando texto livre)',
                resend_api_key: process.env.RESEND_API_KEY ? 'Configurado' : 'NAO CONFIGURADO',
                resend_from: process.env.RESEND_FROM_EMAIL || 'noreply@klinik.com.br (default)',
                asaas_api_key_env: process.env.ASAAS_API_KEY ? 'Configurado' : 'Nao configurado (usa da clinica)',
                turso_url: process.env.TURSO_DATABASE_URL ? 'Configurado' : 'NAO CONFIGURADO',
                stripe_key: process.env.STRIPE_SECRET_KEY ? 'Configurado' : 'NAO CONFIGURADO'
            }
            // Check Asaas from clinic
            try {
                var diagCli = await client.execute({ sql: "SELECT CASE WHEN asaas_api_key IS NOT NULL AND asaas_api_key!='' THEN 'Configurado na clinica' ELSE 'NAO CONFIGURADO' END as asaas FROM clinicas WHERE id=?", args: [clinica_id] })
                if (diagCli.rows.length) diag.asaas_clinica = diagCli.rows[0].asaas
            } catch(e) {}
            return res.status(200).json({ success: true, diagnostico: diag })
        }

        if (route === 'aniversariantes') {
            var anMes = parseInt(q.mes) || (new Date().getMonth() + 1)
            var anMesStr = String(anMes).padStart(2, '0')
            // Also filter by month in SQL for efficiency
            var anr = await client.execute({ sql: "SELECT id,nome,telefone,email,data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento!='' AND substr(data_nascimento,6,2)=? AND clinica_id=?", args: [anMesStr, clinica_id] })
            console.log('[aniversariantes] clinica_id='+clinica_id+' mes='+anMes+' encontrados='+anr.rows.length)
            var hj = new Date()
            var anivs = []
            anr.rows.forEach(function(p) {
                try {
                    var dn = p.data_nascimento || ''
                    var n = null
                    if (dn.match(/^\d{4}-\d{2}-\d{2}/)) { n = new Date(dn.slice(0,10) + 'T12:00:00') }
                    else if (dn.match(/^\d{2}\/\d{2}\/\d{4}/)) { var pp = dn.split('/'); n = new Date(pp[2]+'-'+pp[1]+'-'+pp[0]+'T12:00:00') }
                    else { n = new Date(dn + 'T12:00:00') }
                    if (!n || isNaN(n.getTime())) return
                    var dia = n.getDate()
                    anivs.push({ id: p.id, nome: p.nome, telefone: p.telefone, data_nascimento: p.data_nascimento, dia: dia })
                } catch(e) {}
            })
            anivs.sort(function(a, b){ return a.dia - b.dia })
            return res.status(200).json({ success: true, data: anivs, total: anivs.length, mes: anMes })
        }

        // ── CONTA CORRENTE ──────────────────────────────────────────────────
        if (route === 'conta-corrente') {
            var ccde = q.de || (function(){ var d = new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) })()
            var ccate = q.ate || new Date().toISOString().slice(0, 10)
            // Union financeiro + pagamentos para ter todos os lançamentos
            var ccsql = "SELECT 'recibo' as origem, f.id, f.clinicorp_id, f.tipo, f.descricao, f.valor, f.data_pagamento, f.forma_pagamento, f.criado_em, p.nome as paciente_nome FROM financeiro f LEFT JOIN pacientes p ON p.id=f.paciente_id WHERE f.data_pagamento >= ? AND f.data_pagamento <= ? AND f.clinica_id=? UNION ALL SELECT 'pagamento' as origem, pg.id, pg.clinicorp_id, CASE WHEN pg.cancelado=1 THEN 'cancelado' ELSE 'entrada' END as tipo, pg.descricao, pg.valor, pg.data_pagamento, pg.forma_pagamento, pg.criado_em, pg.paciente_nome FROM pagamentos pg WHERE pg.data_pagamento >= ? AND pg.data_pagamento <= ? AND pg.cancelado=0 AND pg.clinica_id=? ORDER BY data_pagamento ASC, criado_em ASC"
            var ccr = await client.execute({ sql: ccsql, args: [ccde, ccate, clinica_id, ccde, ccate, clinica_id] })
            var totalE = 0, totalS = 0
            ccr.rows.forEach(function(r){ var v = +(r.valor||0); if (r.tipo==='entrada'||v>0) totalE += Math.abs(v); else totalS += Math.abs(v) })
            return res.status(200).json({ success: true, data: ccr.rows, totais: { entradas: totalE, saidas: totalS, saldo: totalE-totalS }, periodo: { de: ccde, ate: ccate } })
        }

        // ── FLUXO DE CAIXA ──────────────────────────────────────────────────
        if (route === 'fluxo-caixa') {
            var fmes = parseInt(q.mes) || (new Date().getMonth() + 1)
            var fano = parseInt(q.ano) || new Date().getFullYear()
            var fmstr = fano + '-' + String(fmes).padStart(2, '0')
            var fdr = await client.execute({ sql: "SELECT data_pagamento as dia,tipo,SUM(valor) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND clinica_id=? GROUP BY data_pagamento,tipo ORDER BY data_pagamento", args: [fmstr, clinica_id] })
            var fud = new Date(fano, fmes, 0).getDate()
            var fpd = [], fac = 0
            for (var fd = 1; fd <= fud; fd++) {
                var fds = fmstr + '-' + String(fd).padStart(2, '0')
                var fe = 0, fs = 0
                fdr.rows.forEach(function(r){ if (r.dia===fds) { if (r.tipo==='entrada') fe=r.total||0; else fs=Math.abs(r.total||0) } })
                fac += fe - fs
                fpd.push({ dia: fd, data: fds, entradas: fe, saidas: fs, saldo: fe-fs, acumulado: fac })
            }
            var fte = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada' AND clinica_id=?", args: [fmstr, clinica_id] })
            var fts = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='saida' AND clinica_id=?", args: [fmstr, clinica_id] })
            return res.status(200).json({ success: true, mes: fmes, ano: fano, por_dia: fpd, totais: { entradas: fte.rows[0].total, saidas: fts.rows[0].total, saldo: fte.rows[0].total - fts.rows[0].total } })
        }

        // ── METAS ───────────────────────────────────────────────────────────
        if (route === 'metas') {
            var mm = parseInt(q.mes) || (new Date().getMonth() + 1)
            var ma = parseInt(q.ano) || new Date().getFullYear()
            var mstr = ma + '-' + String(mm).padStart(2, '0')
            var mpr = await client.execute({ sql: "SELECT pr.*,COUNT(a.id) as agendamentos_mes FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id AND strftime('%Y-%m',a.data_hora)=? AND a.status!='cancelado' WHERE pr.clinica_id=? GROUP BY pr.id ORDER BY agendamentos_mes DESC", args: [mstr, clinica_id] })
            var mtm = await client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND status!='cancelado' AND clinica_id=?", args: [mstr, clinica_id] })
            var mrm = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada' AND clinica_id=?", args: [mstr, clinica_id] })
            return res.status(200).json({ success: true, mes: mm, ano: ma, resumo_mes: { agendamentos: mtm.rows[0].total, receita: mrm.rows[0].total }, profissionais: mpr.rows })
        }

        // ── METAS-CONFIG (CRUD) ──────────────────────────────────────
        if (route === 'metas-config') {
            // Ensure table exists
            await client.execute("CREATE TABLE IF NOT EXISTS metas_config (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, tipo TEXT NOT NULL, valor REAL NOT NULL, data_inicio TEXT NOT NULL, data_fim TEXT NOT NULL, analise TEXT DEFAULT 'clinica', created_at TEXT DEFAULT (datetime('now')))")

            if (req.method === 'POST') {
                var mc = req.body || {}
                if (mc.action === 'delete') {
                    await client.execute({ sql: "DELETE FROM metas_config WHERE id=? AND clinica_id=?", args: [mc.id, clinica_id] })
                    return res.status(200).json({ success: true, msg: 'Meta excluída' })
                }
                if (!mc.tipo || !mc.valor || !mc.data_inicio || !mc.data_fim) return res.status(400).json({ success: false, error: 'tipo, valor, data_inicio e data_fim obrigatórios' })
                if (mc.id) {
                    await client.execute({ sql: "UPDATE metas_config SET tipo=?, valor=?, data_inicio=?, data_fim=?, analise=? WHERE id=? AND clinica_id=?", args: [mc.tipo, parseFloat(mc.valor), mc.data_inicio, mc.data_fim, mc.analise || 'clinica', mc.id, clinica_id] })
                    return res.status(200).json({ success: true, msg: 'Meta atualizada' })
                }
                var mcIns = await client.execute({ sql: "INSERT INTO metas_config(clinica_id, tipo, valor, data_inicio, data_fim, analise) VALUES(?,?,?,?,?,?)", args: [clinica_id, mc.tipo, parseFloat(mc.valor), mc.data_inicio, mc.data_fim, mc.analise || 'clinica'] })
                return res.status(200).json({ success: true, id: Number(mcIns.lastInsertRowid) })
            }
            // GET
            var mcRows = await client.execute({ sql: "SELECT * FROM metas_config WHERE clinica_id=? ORDER BY data_inicio DESC", args: [clinica_id] })
            return res.status(200).json({ success: true, metas: mcRows.rows })
        }

        // ── METAS-VISUALIZAR ──────────────────────────────────────────
        if (route === 'metas-visualizar') {
            await client.execute("CREATE TABLE IF NOT EXISTS metas_config (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, tipo TEXT NOT NULL, valor REAL NOT NULL, data_inicio TEXT NOT NULL, data_fim TEXT NOT NULL, analise TEXT DEFAULT 'clinica', created_at TEXT DEFAULT (datetime('now')))")

            var mvTipo = q.tipo || ''
            var mvW = ["clinica_id=?"], mvA = [clinica_id]
            if (mvTipo) { mvW.push("tipo=?"); mvA.push(mvTipo) }
            var mvMetas = await client.execute({ sql: "SELECT * FROM metas_config WHERE " + mvW.join(' AND ') + " ORDER BY data_inicio DESC", args: mvA })

            var mvResult = []
            for (var mvi = 0; mvi < mvMetas.rows.length; mvi++) {
                var mvM = mvMetas.rows[mvi]
                var mvAlcancado = 0

                if (mvM.tipo === 'vendas') {
                    // Vendas = orçamentos aprovados no período
                    var mvV = await client.execute({ sql: "SELECT COALESCE(SUM(valor_total - COALESCE(desconto,0)),0) as total FROM orcamentos WHERE status='aprovado' AND data_aprovacao >= ? AND data_aprovacao <= ? AND clinica_id=?", args: [mvM.data_inicio, mvM.data_fim + ' 23:59:59', clinica_id] })
                    mvAlcancado = mvV.rows[0].total || 0
                } else if (mvM.tipo === 'agendamentos') {
                    // Agendamentos = total no período
                    var mvAg = await client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE DATE(data_hora) >= ? AND DATE(data_hora) <= ? AND status!='cancelado' AND clinica_id=?", args: [mvM.data_inicio, mvM.data_fim, clinica_id] })
                    mvAlcancado = mvAg.rows[0].total || 0
                } else if (mvM.tipo === 'faltas') {
                    // Faltas = pacientes que faltaram
                    var mvF = await client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE DATE(data_hora) >= ? AND DATE(data_hora) <= ? AND (status='faltou' OR status LIKE '%falt%') AND clinica_id=?", args: [mvM.data_inicio, mvM.data_fim, clinica_id] })
                    mvAlcancado = mvF.rows[0].total || 0
                }

                var mvPct = mvM.valor > 0 ? Math.round((mvAlcancado / mvM.valor) * 10000) / 100 : 0
                mvResult.push({ id: mvM.id, tipo: mvM.tipo, valor: mvM.valor, data_inicio: mvM.data_inicio, data_fim: mvM.data_fim, analise: mvM.analise, alcancado: mvAlcancado, percentual: mvPct })
            }

            return res.status(200).json({ success: true, metas: mvResult })
        }

        // ── PAGAMENTOS ─────────────────────────────────────────────────
        if (route === 'pagamentos') {
            var pw = ["clinica_id=?"], pa = [clinica_id]
            if (q.de)    { pw.push("data_pagamento >= ?"); pa.push(q.de) }
            if (q.ate)   { pw.push("data_pagamento <= ?"); pa.push(q.ate) }
            if (q.forma) { pw.push("forma_pagamento LIKE ?"); pa.push('%'+q.forma+'%') }
            if (q.tipo)  { pw.push("tipo LIKE ?"); pa.push('%'+q.tipo+'%') }
            if (q.cancelado === '0') { pw.push("cancelado=0") }
            if (q.cancelado === '1') { pw.push("cancelado=1") }
            if (!q.de && !q.ate) {
                var pm = q.mes || new Date().toISOString().slice(0, 7)
                pw.push("strftime('%Y-%m',data_pagamento)=?"); pa.push(pm)
            }
            var pwc = pw.length ? ' WHERE ' + pw.join(' AND ') : ''
            var plim = Math.min(parseInt(q.limit) || 200, 500)
            var pr2 = await client.execute({ sql: "SELECT * FROM pagamentos" + pwc + " ORDER BY data_pagamento DESC LIMIT ?", args: pa.concat([plim]) })
            // Totais por forma
            var ptf = await client.execute({ sql: "SELECT forma_pagamento,COUNT(*) as qtd,SUM(valor) as total FROM pagamentos" + pwc + " GROUP BY forma_pagamento ORDER BY total DESC", args: pa })
            var ptot = await client.execute({ sql: "SELECT COUNT(*) as qtd,COALESCE(SUM(valor),0) as total,SUM(CASE WHEN confirmado=1 THEN valor ELSE 0 END) as confirmado,SUM(CASE WHEN confirmado=0 AND cancelado=0 THEN valor ELSE 0 END) as pendente FROM pagamentos" + pwc, args: pa })
            return res.status(200).json({ success: true, data: pr2.rows, total: pr2.rows.length, por_forma: ptf.rows, totais: ptot.rows[0] })
        }

        // ── EXTRATO ───────────────────────────────────────────────────────
        if (route === 'extrato') {
            var ede = q.de || (function(){ var d2 = new Date(); d2.setDate(d2.getDate()-30); return d2.toISOString().slice(0,10) })()
            var eate = q.ate || new Date().toISOString().slice(0, 10)
            // Union de financeiro + pagamentos
            var esql = "SELECT 'recibo' as origem, clinicorp_id, descricao, valor, data_pagamento as data, 'entrada' as tipo_mov, NULL as forma, NULL as bandeira FROM financeiro WHERE data_pagamento >= ? AND data_pagamento <= ? AND clinica_id=? UNION ALL SELECT 'pagamento' as origem, clinicorp_id, descricao, valor, data_pagamento as data, CASE WHEN cancelado=1 THEN 'cancelado' ELSE 'entrada' END as tipo_mov, forma_pagamento as forma, bandeira FROM pagamentos WHERE data_pagamento >= ? AND data_pagamento <= ? AND cancelado=0 AND clinica_id=? ORDER BY data DESC, origem"
            var er = await client.execute({ sql: esql, args: [ede, eate, clinica_id, ede, eate, clinica_id] })
            return res.status(200).json({ success: true, data: er.rows, periodo: { de: ede, ate: eate }, total: er.rows.length })
        }

        // ── DASHBOARD ANALÍTICO (dados reais por mês) ─────────────────
        if (route === 'dashboard-analitico') {
            var qtdMeses = parseInt(q.meses) || 3
            var mesRef = parseInt(q.mes) || (new Date().getMonth() + 1)
            var anoRef = parseInt(q.ano) || new Date().getFullYear()
            var meses3 = []
            for (var mi = qtdMeses - 1; mi >= 0; mi--) {
                var dd = new Date(anoRef, mesRef - 1 - mi, 1)
                meses3.push(dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0'))
            }
            var result = { meses: meses3, por_mes: {} }
            for (var mx = 0; mx < meses3.length; mx++) {
                var mm = meses3[mx]
                var rs3 = await Promise.all([
                    // Agendamentos totais do mês
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND clinica_id=?", args: [mm, clinica_id] }),
                    // Cancelados
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND status='cancelado' AND clinica_id=?", args: [mm, clinica_id] }),
                    // Faltas
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND (status LIKE '%falt%' OR status='faltou') AND clinica_id=?", args: [mm, clinica_id] }),
                    // Primeiras consultas (tipo contém 'Avaliação' ou primeiro agendamento)
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND (tipo LIKE '%Avaliação%' OR tipo LIKE '%avaliacao%') AND clinica_id=?", args: [mm, clinica_id] }),
                    // Receita entrada (pagamentos)
                    client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND clinica_id=?", args: [mm, clinica_id] }),
                    // Receita saída (financeiro tipo=saida)
                    client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='saida' AND clinica_id=?", args: [mm, clinica_id] }),
                    // Recibos
                    client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada' AND clinica_id=?", args: [mm, clinica_id] }),
                    // Pagamentos confirmados
                    client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND confirmado=1 AND clinica_id=?", args: [mm, clinica_id] }),
                    // Pagamentos pendentes
                    client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND confirmado=0 AND cancelado=0 AND clinica_id=?", args: [mm, clinica_id] }),
                    // Categorias agendadas
                    client.execute({ sql: "SELECT tipo, COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND tipo IS NOT NULL AND tipo!='' AND clinica_id=? GROUP BY tipo ORDER BY total DESC LIMIT 10", args: [mm, clinica_id] }),
                    // Total pagamentos (qtd)
                    client.execute({ sql: "SELECT COUNT(*) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND clinica_id=?", args: [mm, clinica_id] }),
                    // Parcelas
                    client.execute({ sql: "SELECT COALESCE(SUM(parcelas),0) as total, COUNT(*) as qtd FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND parcelas>0 AND clinica_id=?", args: [mm, clinica_id] }),
                    // Faltas primeiras consultas
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND (tipo LIKE '%Avaliação%') AND (status LIKE '%falt%' OR status='faltou') AND clinica_id=?", args: [mm, clinica_id] }),
                    // Pagamentos por forma
                    client.execute({ sql: "SELECT forma_pagamento, COUNT(*) as qtd, SUM(valor) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND clinica_id=? GROUP BY forma_pagamento ORDER BY total DESC", args: [mm, clinica_id] }),
                    // Pagamentos cancelados (valor)
                    client.execute({ sql: "SELECT COUNT(*) as qtd, COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=1 AND clinica_id=?", args: [mm, clinica_id] }),
                    // Orçamentos aprovados (vendas): valor_parcela × qtd_parcelas por treatment
                    client.execute({ sql: "SELECT COUNT(*) as total, COALESCE(SUM(vt),0) as valor FROM (SELECT treatment_id, valor * CASE WHEN parcelas>0 THEN parcelas ELSE 1 END as vt FROM pagamentos WHERE strftime('%Y-%m',data_checkout)=? AND cancelado=0 AND treatment_id IS NOT NULL AND treatment_id!='' AND clinica_id=? GROUP BY treatment_id)", args: [mm, clinica_id] }),
                    // Orçamentos em aberto: parcelas pendentes (não confirmadas)
                    client.execute({ sql: "SELECT COUNT(*) as total, COALESCE(SUM(valor),0) as valor FROM pagamentos WHERE strftime('%Y-%m',data_vencimento)=? AND confirmado=0 AND cancelado=0 AND clinica_id=?", args: [mm, clinica_id] }),
                    // Ticket médio pagamentos
                    client.execute({ sql: "SELECT AVG(valor) as ticket FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND valor>0 AND clinica_id=?", args: [mm, clinica_id] }),
                ])
                result.por_mes[mm] = {
                    agendamentos: rs3[0].rows[0].total,
                    cancelados: rs3[1].rows[0].total,
                    faltas: rs3[2].rows[0].total,
                    primeiras_consultas: rs3[3].rows[0].total,
                    receita_entrada: +(rs3[4].rows[0].total || 0),
                    receita_saida: +(rs3[5].rows[0].total || 0),
                    recibos: +(rs3[6].rows[0].total || 0),
                    pagamentos_confirmados: +(rs3[7].rows[0].total || 0),
                    pagamentos_pendentes: +(rs3[8].rows[0].total || 0),
                    categorias: rs3[9].rows,
                    pagamentos_qtd: rs3[10].rows[0].total,
                    parcelas_total: +(rs3[11].rows[0].total || 0),
                    parcelas_qtd: +(rs3[11].rows[0].qtd || 0),
                    faltas_primeira: rs3[12].rows[0].total,
                    por_forma: rs3[13].rows,
                    pagamentos_cancelados_qtd: rs3[14].rows[0].qtd,
                    pagamentos_cancelados_valor: +(rs3[14].rows[0].total || 0),
                    orcamentos_total: rs3[15].rows[0].total,
                    orcamentos_valor: +(rs3[15].rows[0].valor || 0),
                    orcamentos_aprovados: rs3[16].rows[0].total,
                    orcamentos_aprovados_valor: +(rs3[16].rows[0].valor || 0),
                    ticket_medio: +(rs3[17].rows[0].ticket || 0),
                }
            }
            return res.status(200).json({ success: true, ...result })
        }

        // ── ORÇAMENTOS APROVADOS (query direta) ──────────────────────
        if (route === 'orcamentos-aprovados') {
            var omRef = q.mes || new Date().toISOString().slice(0, 7)
            var orc = await client.execute({ sql: "SELECT treatment_id, paciente_nome, valor, parcelas, forma_pagamento, data_checkout FROM pagamentos WHERE strftime('%Y-%m',data_checkout)=? AND cancelado=0 AND treatment_id IS NOT NULL AND treatment_id!='' AND clinica_id=? GROUP BY treatment_id", args: [omRef, clinica_id] })
            var total = 0
            var items = orc.rows.map(function(r) {
                var vt = (+(r.valor||0)) * Math.max(+(r.parcelas||1), 1)
                total += vt
                return { treatment_id: r.treatment_id, paciente: r.paciente_nome, valor_parcela: r.valor, parcelas: r.parcelas, valor_total: vt, forma: r.forma_pagamento, checkout: r.data_checkout }
            })
            return res.status(200).json({ success: true, mes: omRef, orcamentos: items, total_orcamentos: items.length, valor_total: total })
        }

        // ── RELATÓRIO PRODUTIVIDADE PROFISSIONAIS ─────────────────────
        if (route === 'relatorio-profissionais') {
            var rmeses = parseInt(q.meses) || 3
            var dDesde = new Date(); dDesde.setMonth(dDesde.getMonth() - rmeses)
            var desde = dDesde.toISOString().slice(0, 10)
            var rs4 = await Promise.all([
                // Produtividade: atendimentos + receita via pagamentos vinculados ao paciente do profissional
                client.execute({ sql: "SELECT pr.id,pr.nome,pr.especialidade,COUNT(DISTINCT a.id) as atendimentos,COALESCE((SELECT SUM(pg.valor) FROM pagamentos pg WHERE pg.paciente_id IN (SELECT DISTINCT a2.paciente_id FROM agendamentos a2 WHERE a2.profissional_id=pr.id AND a2.data_hora>=? AND a2.clinica_id=?) AND pg.data_pagamento>=? AND pg.cancelado=0 AND pg.clinica_id=?),0) as valor_total FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id AND a.data_hora>=? WHERE pr.ativo=1 AND pr.clinica_id=? GROUP BY pr.id ORDER BY valor_total DESC", args: [desde, clinica_id, desde, clinica_id, desde, clinica_id] }),
                // Procedimentos por profissional (qtd + receita estimada via ticket médio)
                client.execute({ sql: "SELECT pr.nome as profissional,a.tipo as procedimento,COUNT(*) as qtd FROM agendamentos a INNER JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.data_hora>=? AND a.tipo IS NOT NULL AND a.tipo!='' AND a.clinica_id=? GROUP BY pr.id,a.tipo ORDER BY pr.nome,qtd DESC", args: [desde, clinica_id] }),
                // Orçamentos aprovados por profissional: valor_parcela × qtd_parcelas
                client.execute({ sql: "SELECT pr.nome as profissional,COUNT(DISTINCT t.treatment_id) as orcamentos,COALESCE(SUM(t.vt),0) as valor_orcamentos FROM (SELECT treatment_id, paciente_id, valor * CASE WHEN parcelas>0 THEN parcelas ELSE 1 END as vt FROM pagamentos WHERE data_checkout>=? AND cancelado=0 AND treatment_id IS NOT NULL AND treatment_id!='' AND clinica_id=? GROUP BY treatment_id) t INNER JOIN (SELECT DISTINCT paciente_id, profissional_id FROM agendamentos WHERE profissional_id IS NOT NULL AND clinica_id=?) a2 ON t.paciente_id=a2.paciente_id INNER JOIN profissionais pr ON pr.id=a2.profissional_id GROUP BY pr.id ORDER BY valor_orcamentos DESC", args: [desde, clinica_id, clinica_id] }),
                // Totais gerais (atendimentos + receita pagamentos)
                client.execute({ sql: "SELECT COUNT(*) as total_atendimentos,COUNT(DISTINCT profissional_id) as total_profissionais FROM agendamentos WHERE data_hora>=? AND clinica_id=?", args: [desde, clinica_id] }),
                // Total receita pagamentos no período
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total_valor FROM pagamentos WHERE data_pagamento>=? AND cancelado=0 AND clinica_id=?", args: [desde, clinica_id] }),
            ])
            // Agrupar procedimentos por profissional + calcular valor via ticket médio
            var procsPorProf = {}
            var totalValor = +(rs4[4].rows[0].total_valor || 0)
            var totalAtend = rs4[3].rows[0].total_atendimentos || 1
            var ticketMedio = totalValor / totalAtend
            rs4[1].rows.forEach(function(r) {
                if (!procsPorProf[r.profissional]) procsPorProf[r.profissional] = []
                procsPorProf[r.profissional].push({ procedimento: r.procedimento, qtd: r.qtd, valor: Math.round(r.qtd * ticketMedio * 100) / 100 })
            })
            var totais = rs4[3].rows[0]
            totais.total_valor = totalValor
            return res.status(200).json({
                success: true,
                meses: rmeses,
                produtividade: rs4[0].rows,
                procedimentos_por_profissional: procsPorProf,
                orcamentos_por_profissional: rs4[2].rows,
                totais: totais
            })
        }

        // ── ANALYTICS (Dashboard completo) ────────────────────────────
        if (route === 'analytics') {
            var mesAtual = new Date().toISOString().slice(0, 7)
            var mesAnt = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7)
            var rs = await Promise.all([
                client.execute({ sql: "SELECT COUNT(*) as total FROM pacientes WHERE clinica_id=?", args: [clinica_id] }),
                client.execute({ sql: "SELECT COUNT(DISTINCT p.id) as total FROM pacientes p INNER JOIN agendamentos a ON p.id=a.paciente_id WHERE a.data_hora >= date('now','-180 days') AND p.clinica_id=?", args: [clinica_id] }),
                client.execute({ sql: "SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id WHERE p.clinica_id=? GROUP BY p.id HAVING MAX(a.data_hora) < date('now','-180 days') OR MAX(a.data_hora) IS NULL)", args: [clinica_id] }),
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE tipo='entrada' AND strftime('%Y-%m',data_pagamento)=? AND clinica_id=?", args: [mesAtual, clinica_id] }),
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE tipo='entrada' AND strftime('%Y-%m',data_pagamento)=? AND clinica_id=?", args: [mesAnt, clinica_id] }),
                client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND clinica_id=?", args: [mesAtual, clinica_id] }),
                client.execute({ sql: "SELECT COUNT(*) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND clinica_id=?", args: [mesAtual, clinica_id] }),
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND clinica_id=?", args: [mesAtual, clinica_id] }),
                // Receita por forma de pagamento
                client.execute({ sql: "SELECT forma_pagamento, COUNT(*) as qtd, SUM(valor) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND clinica_id=? GROUP BY forma_pagamento ORDER BY total DESC", args: [mesAtual, clinica_id] }),
                // Evolução receita 6 meses
                client.execute({ sql: "SELECT strftime('%Y-%m',data_pagamento) as mes, SUM(valor) as total FROM pagamentos WHERE data_pagamento >= date('now','-6 months') AND cancelado=0 AND clinica_id=? GROUP BY mes ORDER BY mes", args: [clinica_id] }),
                // Top procedimentos
                client.execute({ sql: "SELECT tipo, COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo!='' AND clinica_id=? GROUP BY tipo ORDER BY total DESC LIMIT 10", args: [clinica_id] }),
                // Produção por profissional
                client.execute({ sql: "SELECT pr.nome, COUNT(a.id) as agendamentos, COALESCE(SUM(a.valor),0) as receita FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id AND a.data_hora >= date('now','-30 days') WHERE pr.ativo=1 AND pr.clinica_id=? GROUP BY pr.id ORDER BY agendamentos DESC", args: [clinica_id] }),
                // Status agendamentos mês
                client.execute({ sql: "SELECT status, COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND clinica_id=? GROUP BY status", args: [mesAtual, clinica_id] }),
                // Faixa etária
                client.execute({ sql: "SELECT CASE WHEN data_nascimento IS NULL OR data_nascimento='' THEN 'N/I' WHEN CAST((julianday('now')-julianday(data_nascimento))/365.25 AS INT)<18 THEN '0-17' WHEN CAST((julianday('now')-julianday(data_nascimento))/365.25 AS INT)<30 THEN '18-29' WHEN CAST((julianday('now')-julianday(data_nascimento))/365.25 AS INT)<45 THEN '30-44' WHEN CAST((julianday('now')-julianday(data_nascimento))/365.25 AS INT)<60 THEN '45-59' ELSE '60+' END as faixa, COUNT(*) as total FROM pacientes WHERE clinica_id=? GROUP BY faixa ORDER BY faixa", args: [clinica_id] }),
                // Novos pacientes por mês
                client.execute({ sql: "SELECT strftime('%Y-%m',criado_em) as mes, COUNT(*) as total FROM pacientes WHERE criado_em >= date('now','-6 months') AND clinica_id=? GROUP BY mes ORDER BY mes", args: [clinica_id] }),
                // Ticket médio
                client.execute({ sql: "SELECT AVG(valor) as ticket FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND valor>0 AND clinica_id=?", args: [mesAtual, clinica_id] }),
                // Bandeira cartão
                client.execute({ sql: "SELECT bandeira, COUNT(*) as qtd, SUM(valor) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND bandeira!='' AND clinica_id=? GROUP BY bandeira ORDER BY total DESC", args: [mesAtual, clinica_id] }),
                // Parcelas
                client.execute({ sql: "SELECT parcelas, COUNT(*) as qtd, SUM(valor) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND clinica_id=? GROUP BY parcelas ORDER BY parcelas", args: [mesAtual, clinica_id] }),
            ])
            var receitaMes = +(rs[3].rows[0].total||0) + +(rs[7].rows[0].total||0)
            var receitaAnt = +(rs[4].rows[0].total||0)
            return res.status(200).json({
                success: true,
                kpis: {
                    total_pacientes: rs[0].rows[0].total,
                    pacientes_ativos: rs[1].rows[0].total,
                    pacientes_inativos: rs[2].rows[0].total,
                    receita_mes: receitaMes,
                    receita_mes_anterior: receitaAnt,
                    variacao_receita: receitaAnt > 0 ? Math.round((receitaMes - receitaAnt) / receitaAnt * 100) : 0,
                    agendamentos_mes: rs[5].rows[0].total,
                    pagamentos_mes: rs[6].rows[0].total,
                    ticket_medio: +(rs[15].rows[0].ticket||0),
                },
                por_forma_pagamento: rs[8].rows,
                evolucao_receita: rs[9].rows,
                top_procedimentos: rs[10].rows,
                producao_profissionais: rs[11].rows,
                status_agendamentos: rs[12].rows,
                faixa_etaria: rs[13].rows,
                novos_pacientes_mes: rs[14].rows,
                bandeiras_cartao: rs[16].rows,
                distribuicao_parcelas: rs[17].rows,
            })
        }

        // ── MARKETING ─────────────────────────────────────────────────
        if (route === 'marketing') {
            // Garante colunas extras existem
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN como_conheceu TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN whatsapp TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN sexo TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN estado_civil TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN bairro TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN alerta_medico TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN numero_convenio TEXT") } catch(e) {}

            var rs2 = await Promise.all([
                // Como conheceu
                client.execute({ sql: "SELECT como_conheceu, COUNT(*) as total FROM pacientes WHERE como_conheceu IS NOT NULL AND como_conheceu!='' AND clinica_id=? GROUP BY como_conheceu ORDER BY total DESC", args: [clinica_id] }),
                // Aniversariantes do mês
                client.execute({ sql: "SELECT id,nome,telefone,email,data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento!='' AND clinica_id=?", args: [clinica_id] }),
                // Inativos por faixa
                client.execute({ sql: "SELECT CASE WHEN dias>365 THEN 'Crítico (+1 ano)' WHEN dias>270 THEN 'Urgente (+9m)' WHEN dias>180 THEN 'Atenção (+6m)' ELSE 'Recente' END as faixa, COUNT(*) as total FROM (SELECT CAST(julianday('now')-julianday(MAX(a.data_hora)) AS INT) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id=a.paciente_id WHERE p.clinica_id=? GROUP BY p.id HAVING dias>180) GROUP BY faixa ORDER BY total DESC", args: [clinica_id] }),
                // Novos por mês (6 meses)
                client.execute({ sql: "SELECT strftime('%Y-%m',criado_em) as mes, COUNT(*) as total FROM pacientes WHERE criado_em >= date('now','-6 months') AND clinica_id=? GROUP BY mes ORDER BY mes", args: [clinica_id] }),
                // Top pacientes por receita
                client.execute({ sql: "SELECT paciente_nome, COUNT(*) as pagamentos, SUM(valor) as total FROM pagamentos WHERE cancelado=0 AND paciente_nome IS NOT NULL AND clinica_id=? GROUP BY paciente_nome ORDER BY total DESC LIMIT 10", args: [clinica_id] }),
                // Retenção: ativos vs total
                client.execute({ sql: "SELECT COUNT(*) as total, SUM(CASE WHEN ultima < date('now','-180 days') OR ultima IS NULL THEN 1 ELSE 0 END) as inativos FROM (SELECT MAX(a.data_hora) as ultima FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id WHERE p.clinica_id=? GROUP BY p.id)", args: [clinica_id] }),
                // Procedimentos mais lucrativos
                client.execute({ sql: "SELECT tipo, COUNT(*) as qtd, COALESCE(SUM(valor),0) as receita FROM agendamentos WHERE tipo IS NOT NULL AND tipo!='' AND valor>0 AND clinica_id=? GROUP BY tipo ORDER BY receita DESC LIMIT 8", args: [clinica_id] }),
            ])
            // Processar aniversariantes do mês atual
            var mesAtual2 = new Date().getMonth() + 1
            var anivs = []
            rs2[1].rows.forEach(function(p) {
                try {
                    var n = new Date(p.data_nascimento + 'T12:00:00')
                    if (!isNaN(n.getTime()) && (n.getMonth() + 1) === mesAtual2) {
                        anivs.push({ nome: p.nome, telefone: p.telefone, email: p.email, dia: n.getDate() })
                    }
                } catch(e) {}
            })
            anivs.sort(function(a, b) { return a.dia - b.dia })
            var retencao = rs2[5].rows[0] || {}
            var totalPac = +(retencao.total || 0)
            var inatPac = +(retencao.inativos || 0)
            return res.status(200).json({
                success: true,
                como_conheceu: rs2[0].rows,
                aniversariantes_mes: anivs,
                inativos_faixa: rs2[2].rows,
                novos_por_mes: rs2[3].rows,
                top_pacientes_receita: rs2[4].rows,
                taxa_retencao: totalPac > 0 ? Math.round((totalPac - inatPac) / totalPac * 100) : 0,
                total_pacientes: totalPac,
                pacientes_inativos: inatPac,
                procedimentos_lucrativos: rs2[6].rows,
            })
        }

        // ── SALVAR PACIENTE ────────────────────────────────────────────
        if (route === 'salvar-paciente') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var b = req.body || {}
            if (!b.nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' })
            await client.execute({ sql: "INSERT INTO pacientes(nome,cpf,telefone,whatsapp,email,data_nascimento,sexo,estado_civil,como_conheceu,endereco,bairro,cidade,cep,convenio,alerta_medico,ativo,criado_em,atualizado_em,clinica_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'),datetime('now'),?)", args: [b.nome, b.cpf||'', b.telefone||'', b.whatsapp||'', b.email||'', b.data_nascimento||'', b.sexo||'', b.estado_civil||'', b.como_conheceu||'', b.endereco||'', b.bairro||'', b.cidade||'', b.cep||'', b.convenio||'', b.alerta_medico||'', clinica_id] })
            return res.status(200).json({ success: true, msg: 'Paciente salvo' })
        }

        // ── PROCEDIMENTOS (lista para selects) ────────────────────────
        if (route === 'procedimentos') {
            var ptab = q.tabela || ''
            var pw2 = ptab ? ' WHERE tabela_preco=?' : ''
            var pa2 = ptab ? [ptab] : []
            // Fix: handle WHERE correctly
            var sqlProc = ptab ? "SELECT * FROM procedimentos WHERE tabela_preco=? AND ativo=1 AND clinica_id=? ORDER BY tabela_preco,descricao" : "SELECT * FROM procedimentos WHERE ativo=1 AND clinica_id=? ORDER BY tabela_preco,descricao"
            var pa2args = ptab ? [ptab, clinica_id] : [clinica_id]
            var prcr = await client.execute({ sql: sqlProc, args: pa2args })
            var tabelas2 = await client.execute({ sql: "SELECT DISTINCT tabela_preco FROM procedimentos WHERE ativo=1 AND clinica_id=? ORDER BY tabela_preco", args: [clinica_id] })
            return res.status(200).json({ success: true, data: prcr.rows, total: prcr.rows.length, tabelas: tabelas2.rows.map(function(t){return t.tabela_preco}) })
        }

        // ── ANIVERSARIANTES DO MÊS ───────────────────────────────────
        if (route === 'aniversariantes-mes') {
            var ames = parseInt(q.mes) || (new Date().getMonth() + 1)
            var aanr = await client.execute({ sql: "SELECT id,nome,telefone,email,data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento!='' AND clinica_id=?", args: [clinica_id] })
            var aanivs = []
            aanr.rows.forEach(function(p) {
                try {
                    var n = new Date(p.data_nascimento + 'T12:00:00')
                    if (isNaN(n.getTime())) return
                    if ((n.getMonth() + 1) === ames) aanivs.push({ id: p.id, nome: p.nome, telefone: p.telefone, email: p.email, data_nascimento: p.data_nascimento, dia: n.getDate() })
                } catch(e) {}
            })
            aanivs.sort(function(a, b) { return a.dia - b.dia })
            return res.status(200).json({ success: true, data: aanivs, total: aanivs.length, mes: ames })
        }

        // ── SALVAR LANÇAMENTO ─────────────────────────────────────────
        if (route === 'salvar-lancamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var lb = req.body || {}
            if (!lb.data_pagamento || !lb.valor) return res.status(400).json({ success: false, error: 'Data e valor obrigatórios' })
            await client.execute({ sql: "INSERT INTO financeiro(tipo,descricao,valor,data_pagamento,forma_pagamento,status,criado_em,atualizado_em,clinica_id) VALUES(?,?,?,?,?,'manual',datetime('now'),datetime('now'),?)", args: [lb.tipo||'entrada', lb.descricao||'', lb.valor, lb.data_pagamento, lb.forma_pagamento||'', clinica_id] })
            return res.status(200).json({ success: true, msg: 'Lançamento salvo' })
        }

        // ── IMPORTAR DADOS CLINICORP (varredura completa) ──────────
        if (route === 'importar-clinicorp') {
            var https2 = require('https')
            var USUARIO2 = process.env.CLINICORP_USUARIO || 'klinik'
            var TOKEN2 = process.env.CLINICORP_TOKEN || '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
            var auth2 = 'Basic ' + Buffer.from(USUARIO2 + ':' + TOKEN2).toString('base64')
            function fetchClinicorp(ep, params2) {
                return new Promise(function(resolve2) {
                    var qs2 = '?' + Object.entries(Object.assign({ subscriber_id: 'klinik', businessId: '5073030694043648' }, params2)).map(function(kv) { return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1]) }).join('&')
                    var req2 = https2.request({ hostname: 'api.clinicorp.com', path: '/rest/v1/' + ep + qs2, method: 'GET', headers: { 'Authorization': auth2, 'accept': 'application/json' } }, function(r2) {
                        var body2 = ''; r2.on('data', function(c) { body2 += c }); r2.on('end', function() { try { resolve2(JSON.parse(body2)) } catch(e2) { resolve2([]) } })
                    }); req2.on('error', function() { resolve2([]) }); req2.setTimeout(8000, function() { req2.destroy(); resolve2([]) }); req2.end()
                })
            }

            var stats = { enderecos: 0, como_conheceu: 0, telefone: 0, email: 0, cpf: 0, erros: [] }
            try {
            // 1. Enriquecer a partir dos dados JÁ NO TURSO (pagamentos + agendamentos)
            // CPF e email dos pagamentos
            var pgCpf = await client.execute({ sql: "SELECT DISTINCT paciente_nome, titular_cpf, pagador_email FROM pagamentos WHERE ((titular_cpf IS NOT NULL AND titular_cpf!='') OR (pagador_email IS NOT NULL AND pagador_email!='')) AND clinica_id=?", args: [clinica_id] })
            var pgRows = (pgCpf && pgCpf.rows) ? pgCpf.rows : []
            for (var pi2 = 0; pi2 < pgRows.length; pi2++) {
                var pg = pgRows[pi2]
                var pg = pgCpf.rows[pi2]; var sets = []; var args3 = []
                if (pg.titular_cpf) { sets.push("cpf=CASE WHEN cpf IS NULL OR cpf='' THEN ? ELSE cpf END"); args3.push(pg.titular_cpf); stats.cpf++ }
                if (pg.pagador_email) { sets.push("email=CASE WHEN email IS NULL OR email='' THEN ? ELSE email END"); args3.push(pg.pagador_email); stats.email++ }
                if (sets.length) { sets.push("atualizado_em=datetime('now')"); args3.push(pg.paciente_nome); args3.push(clinica_id); await client.execute({ sql: "UPDATE pacientes SET " + sets.join(',') + " WHERE nome=? AND clinica_id=?", args: args3 }) }
            }
            // Telefone dos agendamentos
            var agTel2 = await client.execute({ sql: "SELECT DISTINCT paciente_nome, paciente_telefone FROM agendamentos WHERE paciente_telefone IS NOT NULL AND paciente_telefone!='' AND clinica_id=?", args: [clinica_id] })
            var agRows = (agTel2 && agTel2.rows) ? agTel2.rows : []
            for (var ti2 = 0; ti2 < agRows.length; ti2++) {
                var at2 = agRows[ti2]; if (!at2.paciente_nome) continue
                await client.execute({ sql: "UPDATE pacientes SET telefone=CASE WHEN telefone IS NULL OR telefone='' THEN ? ELSE telefone END, atualizado_em=datetime('now') WHERE nome=? AND clinica_id=?", args: [at2.paciente_telefone, at2.paciente_nome, clinica_id] })
                stats.telefone++
            }

            // 2. Buscar dados extras da Clinicorp (endereços de boletos + como conheceu)
            var h2 = new Date(); var d365 = new Date(); d365.setDate(d365.getDate() - 365)
            try {
                var pgRaw = await fetchClinicorp('payment/list', { from: d365.toISOString().slice(0, 10), to: h2.toISOString().slice(0, 10), limit: 500 })
                var pgData = Array.isArray(pgRaw) ? pgRaw : (pgRaw && typeof pgRaw === 'object' ? (pgRaw.data || pgRaw.items || []) : [])
                for (var pi3 = 0; pi3 < pgData.length; pi3++) {
                    var pg2 = pgData[pi3]; var nome = pg2.PatientName || ''; if (!nome) continue
                    if (pg2.PayerAddressStreet) {
                        await client.execute({ sql: "UPDATE pacientes SET endereco=CASE WHEN endereco IS NULL OR endereco='' THEN ? ELSE endereco END, bairro=CASE WHEN bairro IS NULL OR bairro='' THEN ? ELSE bairro END, cidade=CASE WHEN cidade IS NULL OR cidade='' THEN ? ELSE cidade END, estado=CASE WHEN estado IS NULL OR estado='' THEN ? ELSE estado END, cep=CASE WHEN cep IS NULL OR cep='' THEN ? ELSE cep END, atualizado_em=datetime('now') WHERE nome=? AND clinica_id=?", args: [pg2.PayerAddressStreet, pg2.PayerAddressDistrict || '', pg2.PayerAddressCity || '', pg2.PayerAddressState || '', pg2.PayerAddressZip || '', nome, clinica_id] })
                        stats.enderecos++
                    }
                }
            } catch(e3) { /* Clinicorp pode dar timeout, não é crítico */ }

            // 3. Buscar como conheceu dos agendamentos Clinicorp
            if (q.etapa === '2') {
            try {
                var agRaw = await fetchClinicorp('appointment/list', { from: d365.toISOString().slice(0, 10), to: h2.toISOString().slice(0, 10), limit: 100, page: 1 })
                var agData = Array.isArray(agRaw) ? agRaw : (agRaw && typeof agRaw === 'object' ? (agRaw.data || agRaw.items || []) : [])
                for (var ai2 = 0; ai2 < agData.length; ai2++) {
                    var ag2 = agData[ai2]; if (!ag2.PatientName) continue
                    var sets2 = []; var args4 = []
                    if (ag2.HowDidMeet) { sets2.push("como_conheceu=CASE WHEN como_conheceu IS NULL OR como_conheceu='' THEN ? ELSE como_conheceu END"); args4.push(ag2.HowDidMeet); stats.como_conheceu++ }
                    if (ag2.Email) { sets2.push("email=CASE WHEN email IS NULL OR email='' THEN ? ELSE email END"); args4.push(ag2.Email) }
                    if (ag2.MobilePhone) { sets2.push("telefone=CASE WHEN telefone IS NULL OR telefone='' THEN ? ELSE telefone END"); args4.push(ag2.MobilePhone) }
                    if (sets2.length) { sets2.push("atualizado_em=datetime('now')"); args4.push(ag2.PatientName); args4.push(clinica_id); await client.execute({ sql: "UPDATE pacientes SET " + sets2.join(',') + " WHERE nome=? AND clinica_id=?", args: args4 }) }
                }
            } catch(e4) { /* timeout ok */ }
            } // fim etapa 2

            } catch(eImport) { stats.erros.push(eImport.message) }
            // 3. Contar resultado final
            var finalStats = await client.execute({ sql: "SELECT COUNT(*) as total, SUM(CASE WHEN email!='' AND email IS NOT NULL THEN 1 ELSE 0 END) as com_email, SUM(CASE WHEN cpf!='' AND cpf IS NOT NULL THEN 1 ELSE 0 END) as com_cpf, SUM(CASE WHEN telefone!='' AND telefone IS NOT NULL THEN 1 ELSE 0 END) as com_tel, SUM(CASE WHEN endereco!='' AND endereco IS NOT NULL THEN 1 ELSE 0 END) as com_endereco, SUM(CASE WHEN como_conheceu!='' AND como_conheceu IS NOT NULL THEN 1 ELSE 0 END) as com_como, SUM(CASE WHEN data_nascimento!='' AND data_nascimento IS NOT NULL THEN 1 ELSE 0 END) as com_nasc FROM pacientes WHERE clinica_id=?", args: [clinica_id] })
            return res.status(200).json({ success: true, importados: stats, resultado_final: (finalStats && finalStats.rows) ? finalStats.rows[0] : {} })
        }

        // ── IMPORTAR PACIENTES EM LOTE (do Excel) ────────────────────
        if (route === 'importar-pacientes-lote') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var lote = req.body || []
            if (!Array.isArray(lote)) lote = lote.pacientes || []
            var at = 0, ins = 0, errs = 0
            for (var li = 0; li < lote.length; li++) {
                var lp = lote[li]; if (!lp.nome) continue
                try {
                    var ex = await client.execute({ sql: "SELECT id FROM pacientes WHERE nome=? AND clinica_id=?", args: [lp.nome, clinica_id] })
                    if (ex.rows.length) {
                        // UPDATE: preenche campos vazios
                        var s = [], a = []
                        if (lp.data_nascimento) { s.push("data_nascimento=CASE WHEN data_nascimento IS NULL OR data_nascimento='' THEN ? ELSE data_nascimento END"); a.push(lp.data_nascimento) }
                        if (lp.sexo) { s.push("sexo=CASE WHEN sexo IS NULL OR sexo='' THEN ? ELSE sexo END"); a.push(lp.sexo) }
                        if (lp.estado_civil) { s.push("estado_civil=CASE WHEN estado_civil IS NULL OR estado_civil='' THEN ? ELSE estado_civil END"); a.push(lp.estado_civil) }
                        if (lp.cpf) { s.push("cpf=CASE WHEN cpf IS NULL OR cpf='' THEN ? ELSE cpf END"); a.push(lp.cpf) }
                        if (lp.telefone) { s.push("telefone=CASE WHEN telefone IS NULL OR telefone='' THEN ? ELSE telefone END"); a.push(lp.telefone) }
                        if (lp.email) { s.push("email=CASE WHEN email IS NULL OR email='' THEN ? ELSE email END"); a.push(lp.email) }
                        if (lp.endereco) { s.push("endereco=CASE WHEN endereco IS NULL OR endereco='' THEN ? ELSE endereco END"); a.push(lp.endereco) }
                        if (lp.bairro) { s.push("bairro=CASE WHEN bairro IS NULL OR bairro='' THEN ? ELSE bairro END"); a.push(lp.bairro) }
                        if (lp.cidade) { s.push("cidade=CASE WHEN cidade IS NULL OR cidade='' THEN ? ELSE cidade END"); a.push(lp.cidade) }
                        if (lp.estado) { s.push("estado=CASE WHEN estado IS NULL OR estado='' THEN ? ELSE estado END"); a.push(lp.estado) }
                        if (lp.cep) { s.push("cep=CASE WHEN cep IS NULL OR cep='' THEN ? ELSE cep END"); a.push(lp.cep) }
                        if (lp.como_conheceu) { s.push("como_conheceu=CASE WHEN como_conheceu IS NULL OR como_conheceu='' THEN ? ELSE como_conheceu END"); a.push(lp.como_conheceu) }
                        if (lp.convenio) { s.push("convenio=CASE WHEN convenio IS NULL OR convenio='' THEN ? ELSE convenio END"); a.push(lp.convenio) }
                        if (lp.numero_convenio) { s.push("numero_convenio=CASE WHEN numero_convenio IS NULL OR numero_convenio='' THEN ? ELSE numero_convenio END"); a.push(lp.numero_convenio) }
                        if (lp.observacoes) { s.push("observacoes=CASE WHEN observacoes IS NULL OR observacoes='' THEN ? ELSE observacoes END"); a.push(lp.observacoes) }
                        if (s.length) { s.push("atualizado_em=datetime('now')"); a.push(lp.nome); a.push(clinica_id); await client.execute({ sql: "UPDATE pacientes SET " + s.join(',') + " WHERE nome=? AND clinica_id=?", args: a }); at++ }
                    } else {
                        // INSERT novo paciente
                        await client.execute({ sql: "INSERT INTO pacientes(nome,data_nascimento,sexo,estado_civil,cpf,telefone,email,endereco,bairro,cidade,estado,cep,como_conheceu,convenio,numero_convenio,observacoes,ativo,criado_em,atualizado_em,clinica_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'),datetime('now'),?)", args: [lp.nome, lp.data_nascimento||'', lp.sexo||'', lp.estado_civil||'', lp.cpf||'', lp.telefone||'', lp.email||'', lp.endereco||'', lp.bairro||'', lp.cidade||'', lp.estado||'', lp.cep||'', lp.como_conheceu||'', lp.convenio||'', lp.numero_convenio||'', lp.observacoes||'', clinica_id] })
                        ins++
                    }
                } catch(el) { errs++ }
            }
            var fStats = await client.execute({ sql: "SELECT COUNT(*) as total, SUM(CASE WHEN data_nascimento!='' AND data_nascimento IS NOT NULL THEN 1 ELSE 0 END) as com_nasc, SUM(CASE WHEN sexo!='' AND sexo IS NOT NULL THEN 1 ELSE 0 END) as com_sexo, SUM(CASE WHEN estado_civil!='' AND estado_civil IS NOT NULL THEN 1 ELSE 0 END) as com_civil, SUM(CASE WHEN cpf!='' AND cpf IS NOT NULL THEN 1 ELSE 0 END) as com_cpf, SUM(CASE WHEN endereco!='' AND endereco IS NOT NULL THEN 1 ELSE 0 END) as com_end, SUM(CASE WHEN como_conheceu!='' AND como_conheceu IS NOT NULL THEN 1 ELSE 0 END) as com_como, SUM(CASE WHEN convenio!='' AND convenio IS NOT NULL THEN 1 ELSE 0 END) as com_conv FROM pacientes WHERE clinica_id=?", args: [clinica_id] })
            return res.status(200).json({ success: true, recebidos: lote.length, atualizados: at, inseridos: ins, erros: errs, resultado: (fStats && fStats.rows) ? fStats.rows[0] : {} })
        }

        // ── ENRIQUECER PACIENTES (preenche campos vazios com dados dos pagamentos) ──
        if (route === 'enriquecer-pacientes') {
            // Busca todos pagamentos com email ou CPF do titular
            var pgAll = await client.execute({ sql: "SELECT DISTINCT paciente_nome, pagador_email, titular_cpf FROM pagamentos WHERE ((pagador_email IS NOT NULL AND pagador_email!='') OR (titular_cpf IS NOT NULL AND titular_cpf!='')) AND clinica_id=?", args: [clinica_id] })
            var atualiz = 0
            for (var ei = 0; ei < pgAll.rows.length; ei++) {
                var pg = pgAll.rows[ei]
                if (!pg.paciente_nome) continue
                var updates = [], args2 = []
                if (pg.pagador_email) { updates.push("email=CASE WHEN email IS NULL OR email='' THEN ? ELSE email END"); args2.push(pg.pagador_email) }
                if (pg.titular_cpf) { updates.push("cpf=CASE WHEN cpf IS NULL OR cpf='' THEN ? ELSE cpf END"); args2.push(pg.titular_cpf) }
                if (updates.length) {
                    updates.push("atualizado_em=datetime('now')")
                    args2.push(pg.paciente_nome)
                    args2.push(clinica_id)
                    await client.execute({ sql: "UPDATE pacientes SET " + updates.join(',') + " WHERE nome=? AND clinica_id=?", args: args2 })
                    atualiz++
                }
            }
            // Também preenche telefone dos agendamentos
            var agTel = await client.execute({ sql: "SELECT DISTINCT paciente_nome, paciente_telefone FROM agendamentos WHERE paciente_telefone IS NOT NULL AND paciente_telefone!='' AND clinica_id=?", args: [clinica_id] })
            for (var ti = 0; ti < agTel.rows.length; ti++) {
                var at = agTel.rows[ti]
                if (!at.paciente_nome || !at.paciente_telefone) continue
                await client.execute({ sql: "UPDATE pacientes SET telefone=CASE WHEN telefone IS NULL OR telefone='' THEN ? ELSE telefone END, atualizado_em=datetime('now') WHERE nome=? AND clinica_id=?", args: [at.paciente_telefone, at.paciente_nome, clinica_id] })
            }
            // Conta resultado
            var stats = await client.execute({ sql: "SELECT COUNT(*) as total, SUM(CASE WHEN email!='' AND email IS NOT NULL THEN 1 ELSE 0 END) as com_email, SUM(CASE WHEN cpf!='' AND cpf IS NOT NULL THEN 1 ELSE 0 END) as com_cpf, SUM(CASE WHEN telefone!='' AND telefone IS NOT NULL THEN 1 ELSE 0 END) as com_tel FROM pacientes WHERE clinica_id=?", args: [clinica_id] })
            return res.status(200).json({ success: true, pacientes_processados: atualiz, telefones_atualizados: agTel.rows.length, stats: stats.rows[0] })
        }

        // ── EDITAR PACIENTE ───────────────────────────────────────────
        if (route === 'salvar-paciente-edit') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var spe = req.body || {}
            if (!spe.id) return res.status(400).json({ success: false, error: 'ID obrigatório' })
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN rg TEXT") } catch(e) {}
            await client.execute({ sql: "UPDATE pacientes SET nome=?,telefone=?,email=?,cpf=?,rg=?,data_nascimento=?,cep=?,cidade=?,endereco=?,bairro=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [spe.nome||'', spe.telefone||'', spe.email||'', spe.cpf||'', spe.rg||'', spe.data_nascimento||'', spe.cep||'', spe.cidade||'', spe.endereco||'', spe.bairro||'', spe.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Paciente atualizado' })
        }

        // ── ATUALIZAR RG EM LOTE ──────────────────────────────────────
        if (route === 'atualizar-rg-lote') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            // Garante coluna rg
            try { await client.execute("ALTER TABLE pacientes ADD COLUMN rg TEXT") } catch(e) {}
            var lista = req.body || []
            if (!Array.isArray(lista)) lista = lista.pacientes || []
            var at = 0, nf = 0, skip = 0
            for (var ri = 0; ri < lista.length; ri++) {
                var item = lista[ri]; if (!item.rg) { skip++; continue }
                // Tenta match por CPF primeiro, depois por nome
                var found = null
                if (item.cpf) {
                    var byCpf = await client.execute({ sql: "SELECT id,rg FROM pacientes WHERE cpf=? AND clinica_id=?", args: [item.cpf, clinica_id] })
                    if (byCpf.rows.length) found = byCpf.rows[0]
                }
                if (!found && item.nome) {
                    var byNome = await client.execute({ sql: "SELECT id,rg FROM pacientes WHERE UPPER(nome)=UPPER(?) AND clinica_id=?", args: [item.nome, clinica_id] })
                    if (byNome.rows.length) found = byNome.rows[0]
                }
                if (found) {
                    await client.execute({ sql: "UPDATE pacientes SET rg=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [item.rg, found.id, clinica_id] })
                    at++
                } else { nf++ }
            }
            return res.status(200).json({ success: true, recebidos: lista.length, atualizados: at, nao_encontrados: nf, sem_rg: skip })
        }

        // ── SALVAR ODONTOGRAMA (dente) ────────────────────────────────
        if (route === 'salvar-odontograma') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var od = req.body || {}
            if (!od.paciente_id || !od.dente) return res.status(400).json({ success: false, error: 'paciente_id e dente obrigatórios' })
            await client.execute("CREATE TABLE IF NOT EXISTS odontograma (id INTEGER PRIMARY KEY AUTOINCREMENT, paciente_id INTEGER REFERENCES pacientes(id), dente INTEGER NOT NULL, status TEXT DEFAULT 'saudavel', cor TEXT, observacao TEXT, updated_at TEXT DEFAULT (datetime('now')))")
            // Upsert: check if exists
            var existing = await client.execute({ sql: "SELECT id FROM odontograma WHERE paciente_id=? AND dente=? AND clinica_id=?", args: [od.paciente_id, od.dente, clinica_id] })
            if (existing.rows.length) {
                await client.execute({ sql: "UPDATE odontograma SET status=?,cor=?,observacao=?,updated_at=datetime('now') WHERE paciente_id=? AND dente=? AND clinica_id=?", args: [od.status||'saudavel', od.cor||null, od.observacao||null, od.paciente_id, od.dente, clinica_id] })
            } else {
                await client.execute({ sql: "INSERT INTO odontograma (paciente_id,dente,status,cor,observacao,clinica_id) VALUES (?,?,?,?,?,?)", args: [od.paciente_id, od.dente, od.status||'saudavel', od.cor||null, od.observacao||null, clinica_id] })
            }
            return res.status(200).json({ success: true })
        }

        // ── SALVAR FOTO PACIENTE ─────────────────────────────────
        if (route === 'salvar-foto-paciente') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var sf = req.body || {}
            if (!sf.paciente_id) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            if (!sf.foto) return res.status(400).json({ success: false, error: 'foto obrigatória' })
            var fotoSize = sf.foto.length
            console.log('[salvar-foto] paciente_id='+sf.paciente_id+' foto_size='+fotoSize)
            if (fotoSize > 500000) return res.status(400).json({ success: false, error: 'Foto muito grande ('+Math.round(fotoSize/1024)+'KB). Máximo 500KB.' })
            try {
                try { await client.execute("ALTER TABLE pacientes ADD COLUMN foto_url TEXT") } catch(e) {}
                await client.execute({ sql: "UPDATE pacientes SET foto_url=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [sf.foto, parseInt(sf.paciente_id), clinica_id] })
                return res.status(200).json({ success: true, msg: 'Foto salva' })
            } catch(fErr) {
                console.error('[salvar-foto] erro:', fErr.message)
                return res.status(500).json({ success: false, error: 'Erro ao salvar foto: ' + fErr.message })
            }
        }

        // ── SALVAR PROFISSIONAL ─────────────────────────────────────
        if (route === 'salvar-profissional') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var sp = req.body || {}
            if (!sp.id) return res.status(400).json({ success: false, error: 'ID obrigatório' })
            await client.execute({ sql: "UPDATE profissionais SET nome=?,especialidade=?,cpf=?,email=?,telefone=?,cro=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [sp.nome||'', sp.especialidade||'', sp.cpf||'', sp.email||'', sp.telefone||'', sp.cro||'', sp.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Profissional atualizado' })
        }

        // ── SALVAR AGENDAMENTO ────────────────────────────────────────
        // ── EXCLUIR AGENDAMENTO ──────────────────────────────────────
        if (route === 'excluir-agendamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ea = req.body || {}
            if (!ea.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({ sql: "DELETE FROM agendamentos WHERE id=? AND clinica_id=?", args: [ea.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Agendamento excluído' })
        }

        if (route === 'salvar-agendamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var sa2 = req.body || {}
            // Status-only update (partial)
            if (sa2.id && sa2.paciente_nome === '_keep_') {
                await client.execute({ sql: "UPDATE agendamentos SET status=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [sa2.status||'agendado', sa2.id, clinica_id] })
                return res.status(200).json({ success: true, msg: 'Status atualizado' })
            }
            if (!sa2.paciente_nome || !sa2.data || !sa2.hora) return res.status(400).json({ success: false, error: 'Paciente, data e hora obrigatórios' })
            var dataHora2 = sa2.data + ' ' + sa2.hora
            var horaFim2 = sa2.hora_fim || ''
            // Resolve paciente_id pelo nome
            var pacId2 = null
            if (sa2.paciente_nome) {
                var rPac = await client.execute({ sql: "SELECT id FROM pacientes WHERE nome=? AND clinica_id=? LIMIT 1", args: [sa2.paciente_nome, clinica_id] })
                if (rPac.rows.length) pacId2 = rPac.rows[0].id
            }
            // Resolve profissional_id pelo nome
            var profId2 = sa2.profissional_id || null
            if (!profId2 && sa2.profissional_nome) {
                var rProf = await client.execute({ sql: "SELECT id FROM profissionais WHERE nome=? AND clinica_id=? LIMIT 1", args: [sa2.profissional_nome, clinica_id] })
                if (rProf.rows.length) profId2 = rProf.rows[0].id
            }
            if (sa2.id) {
                await client.execute({ sql: "UPDATE agendamentos SET paciente_id=?,profissional_id=?,data_hora=?,hora_fim=?,tipo=?,status=?,procedimento=?,observacoes=?,paciente_nome=?,profissional_nome=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [pacId2, profId2, dataHora2, horaFim2, sa2.tipo||'', sa2.status||'agendado', sa2.procedimento||'', sa2.observacoes||'', sa2.paciente_nome||'', sa2.profissional_nome||'', sa2.id, clinica_id] })
                return res.status(200).json({ success: true, msg: 'Agendamento atualizado' })
            }
            await client.execute({ sql: "INSERT INTO agendamentos(paciente_id,profissional_id,data_hora,hora_fim,tipo,status,procedimento,observacoes,paciente_nome,profissional_nome,criado_em,atualizado_em,clinica_id) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),?)", args: [pacId2, profId2, dataHora2, horaFim2, sa2.tipo||'', sa2.status||'agendado', sa2.procedimento||'', sa2.observacoes||'', sa2.paciente_nome||'', sa2.profissional_nome||'', clinica_id] })
            return res.status(200).json({ success: true, msg: 'Agendamento salvo' })
        }

        // ── SALVAR PAGAMENTO ──────────────────────────────────────────
        if (route === 'salvar-pagamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var spg = req.body || {}
            if (!spg.valor) return res.status(400).json({ success: false, error: 'Valor obrigatório' })
            var pacIdPg = null
            if (spg.paciente_nome) {
                var rPacPg = await client.execute({ sql: "SELECT id FROM pacientes WHERE nome=? AND clinica_id=? LIMIT 1", args: [spg.paciente_nome, clinica_id] })
                if (rPacPg.rows.length) pacIdPg = rPacPg.rows[0].id
            }
            await client.execute({ sql: "INSERT INTO pagamentos(paciente_id,paciente_nome,valor,forma_pagamento,tipo,bandeira,parcelas,data_pagamento,data_vencimento,confirmado,cancelado,descricao,criado_em,atualizado_em,clinica_id) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,datetime('now'),datetime('now'),?)", args: [pacIdPg, spg.paciente_nome||'', spg.valor, spg.forma_pagamento||'', spg.tipo||'entrada', spg.bandeira||'', spg.parcelas||1, spg.data_pagamento||new Date().toISOString().slice(0,10), spg.data_vencimento||'', spg.confirmado||0, spg.descricao||'', clinica_id] })
            return res.status(200).json({ success: true, msg: 'Pagamento salvo' })
        }

        // ── MARKETING / CAMPANHAS ──────────────────────────────────────

        function renderTemplate(tpl, vars) {
            return (tpl||'').replace(/\{\{(\w+)\}\}/g, function(_, key) { return vars[key] || ''; });
        }

        async function resolveSegmento(cl, segmento, filtro) {
            var sql, args = [];
            if (segmento === 'individual') {
                var f = {}; try { f = JSON.parse(filtro || '{}') } catch(e) {}
                if (f.paciente_id) {
                    sql = "SELECT id,nome,email,telefone FROM pacientes WHERE id=? AND clinica_id=?";
                    args = [f.paciente_id, clinica_id];
                } else {
                    return [];
                }
            } else if (segmento === 'ativos') {
                sql = "SELECT DISTINCT p.id,p.nome,p.email,p.telefone FROM pacientes p INNER JOIN agendamentos a ON p.id=a.paciente_id WHERE p.ativo=1 AND a.data_hora >= date('now','-180 days') AND p.clinica_id=?";
                args = [clinica_id];
            } else if (segmento === 'inativos') {
                sql = "SELECT p.id,p.nome,p.email,p.telefone FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id WHERE p.ativo=1 AND p.clinica_id=? GROUP BY p.id HAVING MAX(a.data_hora) < date('now','-180 days') OR MAX(a.data_hora) IS NULL";
                args = [clinica_id];
            } else if (segmento === 'aniversariantes') {
                sql = "SELECT id,nome,email,telefone FROM pacientes WHERE ativo=1 AND data_nascimento IS NOT NULL AND strftime('%m',data_nascimento)=strftime('%m','now') AND clinica_id=?";
                args = [clinica_id];
            } else if (segmento === 'convenio') {
                var f = {}; try { f = JSON.parse(filtro || '{}') } catch(e) {}
                sql = "SELECT id,nome,email,telefone FROM pacientes WHERE ativo=1 AND convenio LIKE ? AND clinica_id=?";
                args = ['%' + (f.convenio || '') + '%', clinica_id];
            } else {
                sql = "SELECT id,nome,email,telefone FROM pacientes WHERE ativo=1 AND clinica_id=?";
                args = [clinica_id];
            }
            var r = await cl.execute({ sql: sql, args: args });
            return r.rows;
        }

        // ── MARKETING-MIGRATE ───────────────────────────────────────
        if (route === 'marketing-migrate') {
            try { await client.execute("CREATE TABLE IF NOT EXISTS campanhas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL, segmento TEXT NOT NULL, filtro_json TEXT, assunto TEXT, template TEXT NOT NULL, status TEXT DEFAULT 'rascunho', agendada_para TEXT, total_destinatarios INTEGER DEFAULT 0, total_enviados INTEGER DEFAULT 0, total_erros INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))") } catch(e) { console.error('campanhas table:', e.message) }
            try { await client.execute("CREATE TABLE IF NOT EXISTS envios (id INTEGER PRIMARY KEY AUTOINCREMENT, campanha_id INTEGER, paciente_id INTEGER, canal TEXT NOT NULL, destinatario TEXT, mensagem_final TEXT, status TEXT DEFAULT 'pendente', erro_msg TEXT, enviado_em TEXT, created_at TEXT DEFAULT (datetime('now')))") } catch(e) { console.error('envios table:', e.message) }
            try { await client.execute("CREATE TABLE IF NOT EXISTS templates_mensagem (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL, assunto TEXT, corpo TEXT NOT NULL, ativo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))") } catch(e) { console.error('templates_mensagem table:', e.message) }
            // Insert default templates if none exist
            var tplCount = await client.execute("SELECT COUNT(*) as total FROM templates_mensagem")
            if (tplCount.rows[0].total === 0) {
                await client.execute({ sql: "INSERT INTO templates_mensagem(nome,tipo,assunto,corpo) VALUES(?,?,?,?)", args: ['Confirmação de Consulta', 'confirmacao', 'Confirmação de Consulta', 'Olá {{nome}}, sua consulta está confirmada para {{data_consulta}} às {{hora}} com {{profissional}}. Procedimento: {{procedimento}}. Qualquer dúvida, entre em contato conosco.'] })
                await client.execute({ sql: "INSERT INTO templates_mensagem(nome,tipo,assunto,corpo) VALUES(?,?,?,?)", args: ['Aniversário', 'aniversario', 'Feliz Aniversário!', 'Olá {{nome}}, a equipe Klinik deseja um feliz aniversário! Aproveite para agendar sua consulta com condições especiais.'] })
                await client.execute({ sql: "INSERT INTO templates_mensagem(nome,tipo,assunto,corpo) VALUES(?,?,?,?)", args: ['Reativação', 'retorno', 'Sentimos sua falta!', 'Olá {{nome}}, faz tempo que não nos visitamos! Que tal agendar uma consulta? Estamos com horários disponíveis para você.'] })
            }
            return res.status(200).json({ success: true, msg: 'Tabelas criadas' })
        }

        // ── TEMPLATES ───────────────────────────────────────────────
        if (route === 'templates') {
            var tpls = await client.execute({ sql: "SELECT * FROM templates_mensagem WHERE ativo=1 AND clinica_id=? ORDER BY nome", args: [clinica_id] })
            return res.status(200).json({ success: true, data: tpls.rows })
        }

        // ── SALVAR-TEMPLATE ─────────────────────────────────────────
        if (route === 'salvar-template') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var st = req.body || {}
            if (!st.nome || !st.tipo || !st.corpo) return res.status(400).json({ success: false, error: 'nome, tipo e corpo obrigatórios' })
            if (st.id) {
                await client.execute({ sql: "UPDATE templates_mensagem SET nome=?,tipo=?,assunto=?,corpo=?,updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [st.nome, st.tipo, st.assunto||'', st.corpo, st.id, clinica_id] })
            } else {
                await client.execute({ sql: "INSERT INTO templates_mensagem(nome,tipo,assunto,corpo,clinica_id) VALUES(?,?,?,?,?)", args: [st.nome, st.tipo, st.assunto||'', st.corpo, clinica_id] })
            }
            return res.status(200).json({ success: true, msg: 'Template salvo' })
        }

        // ── EXCLUIR-TEMPLATE ────────────────────────────────────────
        if (route === 'excluir-template') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var et = req.body || {}
            if (!et.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({ sql: "UPDATE templates_mensagem SET ativo=0 WHERE id=? AND clinica_id=?", args: [et.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Template excluído' })
        }

        // ── CAMPANHAS ───────────────────────────────────────────────
        if (route === 'campanhas') {
            var camps = await client.execute({ sql: "SELECT * FROM campanhas WHERE clinica_id=? ORDER BY created_at DESC LIMIT 50", args: [clinica_id] })
            return res.status(200).json({ success: true, data: camps.rows })
        }

        // ── SALVAR-CAMPANHA ─────────────────────────────────────────
        if (route === 'salvar-campanha') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var sc = req.body || {}
            if (!sc.nome || !sc.tipo || !sc.segmento || !sc.template) return res.status(400).json({ success: false, error: 'nome, tipo, segmento e template obrigatórios' })
            if (sc.id) {
                await client.execute({ sql: "UPDATE campanhas SET nome=?,tipo=?,segmento=?,filtro_json=?,assunto=?,template=?,status=?,updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [sc.nome, sc.tipo, sc.segmento, sc.filtro_json||'', sc.assunto||'', sc.template, sc.status||'rascunho', sc.id, clinica_id] })
            } else {
                await client.execute({ sql: "INSERT INTO campanhas(nome,tipo,segmento,filtro_json,assunto,template,status,clinica_id) VALUES(?,?,?,?,?,?,?,?)", args: [sc.nome, sc.tipo, sc.segmento, sc.filtro_json||'', sc.assunto||'', sc.template, sc.status||'rascunho', clinica_id] })
            }
            return res.status(200).json({ success: true, msg: 'Campanha salva' })
        }

        // ── CAMPANHA-PREVIEW ────────────────────────────────────────
        if (route === 'campanha-preview') {
            var segPrev = q.segmento || 'todos'
            var filPrev = q.filtro || ''
            var pacsPrev = await resolveSegmento(client, segPrev, filPrev)
            var amostra = pacsPrev.slice(0, 10).map(function(p) { return { nome: p.nome, email: p.email, telefone: p.telefone } })
            return res.status(200).json({ success: true, total: pacsPrev.length, amostra: amostra })
        }

        // ── CAMPANHA-ENVIAR ─────────────────────────────────────────
        if (route === 'campanha-enviar') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ce = req.body || {}
            if (!ce.id) return res.status(400).json({ success: false, error: 'id da campanha obrigatório' })
            var campR = await client.execute({ sql: "SELECT * FROM campanhas WHERE id=? AND clinica_id=?", args: [ce.id, clinica_id] })
            if (!campR.rows.length) return res.status(404).json({ success: false, error: 'Campanha não encontrada' })
            var camp = campR.rows[0]
            var pacsCamp = await resolveSegmento(client, camp.segmento, camp.filtro_json)
            var totalEnv = 0, totalErr = 0
            var resendKey = process.env.RESEND_API_KEY || ''
            var resendFrom = process.env.RESEND_FROM_EMAIL || 'noreply@klinik.com.br'
            var waToken = process.env.WHATSAPP_TOKEN || ''
            var waPhoneId = process.env.WHATSAPP_PHONE_ID || ''

            // Process in batches of 10
            for (var bi = 0; bi < pacsCamp.length; bi += 10) {
                var batch = pacsCamp.slice(bi, bi + 10)
                for (var bj = 0; bj < batch.length; bj++) {
                    var pac = batch[bj]
                    var vars = { nome: pac.nome || '', email: pac.email || '', telefone: pac.telefone || '' }
                    var msgFinal = renderTemplate(camp.template, vars)
                    var envStatus = 'pendente', envErro = ''

                    // Email send
                    if ((camp.tipo === 'email' || camp.tipo === 'ambos') && resendKey && pac.email) {
                        try {
                            var emailRes = await fetch('https://api.resend.com/emails', {
                                method: 'POST',
                                headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ from: resendFrom, to: [pac.email], subject: camp.assunto || camp.nome, html: msgFinal })
                            })
                            if (emailRes.ok) { envStatus = 'enviado'; totalEnv++ }
                            else { var eBody = await emailRes.text(); envStatus = 'erro'; envErro = 'Email: ' + eBody; totalErr++ }
                        } catch(emailErr) { envStatus = 'erro'; envErro = 'Email: ' + emailErr.message; totalErr++ }
                        await client.execute({ sql: "INSERT INTO envios(campanha_id,paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em,clinica_id) VALUES(?,?,?,?,?,?,?,datetime('now'),?)", args: [camp.id, pac.id, 'email', pac.email, msgFinal, envStatus, envErro, clinica_id] })
                    }

                    // WhatsApp send
                    if ((camp.tipo === 'whatsapp' || camp.tipo === 'ambos') && waToken && waPhoneId && pac.telefone) {
                        var waStatus = 'pendente', waErro = ''
                        try {
                            var waPhone = (pac.telefone || '').replace(/\D/g, '')
                            if (waPhone.length <= 11) waPhone = '55' + waPhone
                            var waRes = await fetch('https://graph.facebook.com/v23.0/' + waPhoneId + '/messages', {
                                method: 'POST',
                                headers: { 'Authorization': 'Bearer ' + waToken, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: msgFinal } })
                            })
                            if (waRes.ok) { waStatus = 'enviado'; totalEnv++ }
                            else { var wBody = await waRes.text(); waStatus = 'erro'; waErro = 'WhatsApp: ' + wBody; totalErr++ }
                        } catch(waErr) { waStatus = 'erro'; waErro = 'WhatsApp: ' + waErr.message; totalErr++ }
                        await client.execute({ sql: "INSERT INTO envios(campanha_id,paciente_id,canal,destinatario,mensagem_final,status,erro_msg,enviado_em,clinica_id) VALUES(?,?,?,?,?,?,?,datetime('now'),?)", args: [camp.id, pac.id, 'whatsapp', pac.telefone, msgFinal, waStatus, waErro, clinica_id] })
                    }
                }
                // Small delay between batches to avoid rate limits
                if (bi + 10 < pacsCamp.length) await new Promise(function(resolve) { setTimeout(resolve, 500) })
            }

            await client.execute({ sql: "UPDATE campanhas SET total_destinatarios=?,total_enviados=?,total_erros=?,status='concluida',updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [pacsCamp.length, totalEnv, totalErr, camp.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Campanha enviada', total_destinatarios: pacsCamp.length, total_enviados: totalEnv, total_erros: totalErr })
        }

        // ── ENVIOS-HISTORICO ────────────────────────────────────────
        if (route === 'envios-historico') {
            var ehPage = parseInt(q.page) || 1
            var ehOff = (ehPage - 1) * 20
            var ehSql = "SELECT e.*,p.nome as paciente_nome,c.nome as campanha_nome FROM envios e LEFT JOIN pacientes p ON p.id=e.paciente_id LEFT JOIN campanhas c ON c.id=e.campanha_id WHERE e.clinica_id=?"
            var ehArgs = [clinica_id]
            if (q.campanha_id) {
                ehSql += " AND e.campanha_id=?"
                ehArgs.push(parseInt(q.campanha_id))
            }
            ehSql += " ORDER BY e.created_at DESC LIMIT 20 OFFSET ?"
            ehArgs.push(ehOff)
            var ehR = await client.execute({ sql: ehSql, args: ehArgs })
            return res.status(200).json({ success: true, data: ehR.rows, page: ehPage })
        }

        // ── MARKETING-CONFIG ────────────────────────────────────────
        if (route === 'marketing-config') {
            return res.status(200).json({
                success: true,
                resend_configured: !!process.env.RESEND_API_KEY,
                whatsapp_configured: !!process.env.WHATSAPP_TOKEN,
                resend_from: process.env.RESEND_FROM_EMAIL || ''
            })
        }

        // ── EXPORTAR DADOS ─────────────────────────────────────────
        if (route === 'exportar-dados') {
            var tipo = q.tipo || ''
            var sqlMap = {
                pacientes: "SELECT id,nome,cpf,rg,data_nascimento,sexo,estado_civil,telefone,whatsapp,email,endereco,bairro,cidade,cep,convenio,numero_convenio,como_conheceu,observacoes,alerta_medico,ativo,criado_em FROM pacientes WHERE clinica_id=? ORDER BY nome",
                agendamentos: "SELECT a.id,a.data_hora,a.hora_fim,a.tipo,a.status,a.procedimento,a.valor,a.observacoes,COALESCE(p.nome,a.paciente_nome) as paciente_nome,COALESCE(pr.nome,a.profissional_nome) as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.clinica_id=? ORDER BY a.data_hora DESC",
                financeiro: "SELECT * FROM financeiro WHERE clinica_id=? ORDER BY data_pagamento DESC",
                orcamentos: "SELECT o.*,p.nome as paciente_nome FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id WHERE o.clinica_id=? ORDER BY o.data_criacao DESC",
                pagamentos: "SELECT pg.*,COALESCE(p.nome,pg.paciente_nome) as paciente FROM pagamentos pg LEFT JOIN pacientes p ON p.id=pg.paciente_id WHERE pg.clinica_id=? ORDER BY pg.data_pagamento DESC",
                profissionais: "SELECT id,nome,especialidade,cpf,email,telefone,cro FROM profissionais WHERE clinica_id=? ORDER BY nome",
                procedimentos: "SELECT * FROM procedimentos WHERE clinica_id=? ORDER BY nome"
            }
            if (!sqlMap[tipo]) return res.status(400).json({ success: false, error: 'Tipo inválido: ' + tipo })
            var expR = await client.execute({ sql: sqlMap[tipo], args: [clinica_id] })
            return res.status(200).json({ success: true, data: expR.rows, total: expR.rows.length })
        }

        // ── MIGRATE-SAAS ────────────────────────────────────────────
        if (route === 'migrate-saas') {
            var summary = { clinica: null, tabelas: {}, indexes: [], billing_columns: [] }

            // 1. Cria tabela clinicas se não existir
            await client.execute("CREATE TABLE IF NOT EXISTS clinicas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, cnpj TEXT, cidade TEXT, estado TEXT, criado_em TEXT DEFAULT (datetime('now')))")

            // 2. Insere clínica padrão se nenhuma existir
            var cCheck = await client.execute("SELECT id FROM clinicas LIMIT 1")
            if (!cCheck.rows.length) {
                await client.execute("INSERT INTO clinicas(nome,cnpj,cidade,estado) VALUES('Klinik Odontologia','','Campo Grande','MS')")
                summary.clinica = 'Criada: Klinik Odontologia'
            } else {
                summary.clinica = 'Já existia (id=' + cCheck.rows[0].id + ')'
            }

            // Pega o id da clínica
            var cRow = await client.execute("SELECT id FROM clinicas LIMIT 1")
            var clinicaId = cRow.rows[0].id

            // 3. Adiciona coluna clinica_id e atualiza registros em cada tabela
            var tabelas = ['pacientes', 'agendamentos', 'pagamentos', 'procedimentos', 'financeiro', 'profissionais', 'usuarios', 'campanhas', 'envios', 'templates_mensagem', 'odontograma']
            for (var i = 0; i < tabelas.length; i++) {
                var tb = tabelas[i]
                try {
                    try { await client.execute("ALTER TABLE " + tb + " ADD COLUMN clinica_id INTEGER") } catch(e) {}
                    var upd = await client.execute({ sql: "UPDATE " + tb + " SET clinica_id=? WHERE clinica_id IS NULL", args: [clinicaId] })
                    summary.tabelas[tb] = upd.rowsAffected || 0
                } catch(e) {
                    summary.tabelas[tb] = 'erro: ' + e.message
                }
            }

            // 4. Cria indexes de clinica_id nas tabelas principais
            var idxTabelas = ['pacientes', 'agendamentos', 'pagamentos', 'procedimentos', 'financeiro', 'profissionais', 'usuarios']
            for (var j = 0; j < idxTabelas.length; j++) {
                var itb = idxTabelas[j]
                try {
                    await client.execute("CREATE INDEX IF NOT EXISTS idx_" + itb + "_clinica ON " + itb + "(clinica_id)")
                    summary.indexes.push(itb + ': ok')
                } catch(e) {
                    summary.indexes.push(itb + ': ' + e.message)
                }
            }

            // 5. Adiciona colunas de billing à tabela clinicas
            var billingCols = [
                "plano TEXT DEFAULT 'trial'",
                "plano_inicio TEXT",
                "plano_fim TEXT",
                "stripe_customer_id TEXT",
                "status_pagamento TEXT DEFAULT 'ativo'"
            ]
            for (var k = 0; k < billingCols.length; k++) {
                var colDef = billingCols[k]
                var colName = colDef.split(' ')[0]
                try {
                    await client.execute("ALTER TABLE clinicas ADD COLUMN " + colDef)
                    summary.billing_columns.push(colName + ': adicionada')
                } catch(e) {
                    summary.billing_columns.push(colName + ': já existe ou erro')
                }
            }

            return res.status(200).json({ success: true, summary: summary })
        }

        // ── ORÇAMENTOS — MIGRATE ─────────────────────────────────────
        if (route === 'orcamentos-migrate') {
            await client.execute("CREATE TABLE IF NOT EXISTS orcamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, profissional_id INTEGER, profissional_nome TEXT, data_criacao TEXT DEFAULT (datetime('now')), observacoes TEXT, tabela_preco TEXT DEFAULT 'PARTICULAR', status TEXT DEFAULT 'aberto', aprovado_por TEXT, data_aprovacao TEXT, motivo_reprovacao TEXT, forma_pagamento TEXT, tipo_pagamento TEXT DEFAULT 'valor_total', parcelas INTEGER DEFAULT 1, desconto REAL DEFAULT 0, valor_total REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))")
            await client.execute("CREATE TABLE IF NOT EXISTS orcamento_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, orcamento_id INTEGER REFERENCES orcamentos(id), procedimento_codigo TEXT, procedimento_nome TEXT, dente TEXT, regiao TEXT, profissional_id INTEGER, profissional_nome TEXT, valor_unitario REAL DEFAULT 0, valor_plano REAL DEFAULT 0, quantidade INTEGER DEFAULT 1, executado INTEGER DEFAULT 0, data_execucao TEXT, created_at TEXT DEFAULT (datetime('now')))")
            return res.status(200).json({ success: true, msg: 'Tabelas orcamentos e orcamento_itens criadas' })
        }

        // ── IMPORTAR ORÇAMENTOS EM LOTE ──────────────────────────────
        if (route === 'importar-orcamentos-lote') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var lote = req.body || []
            if (!Array.isArray(lote)) lote = lote.orcamentos || []
            var ins = 0, errs = 0
            for (var oi = 0; oi < lote.length; oi++) {
                var orc = lote[oi]
                try {
                    // Find paciente_id by name
                    var pacR = await client.execute({ sql: "SELECT id FROM pacientes WHERE nome=? LIMIT 1", args: [orc.paciente_nome || ''] })
                    var pacId = pacR.rows.length ? pacR.rows[0].id : null
                    if (!pacId) { errs++; continue }
                    // Find profissional_id
                    var profR = await client.execute({ sql: "SELECT id FROM profissionais WHERE nome=? LIMIT 1", args: [orc.profissional_nome || ''] })
                    var profId = profR.rows.length ? profR.rows[0].id : null
                    // Parse date
                    var dataCriacao = orc.data || ''
                    if (dataCriacao.includes('/')) {
                        var dp = dataCriacao.split(' ')[0].split('/')
                        if (dp.length === 3) dataCriacao = dp[2] + '-' + dp[1].padStart(2,'0') + '-' + dp[0].padStart(2,'0')
                    }
                    // Insert orcamento
                    var orcRes = await client.execute({ sql: "INSERT INTO orcamentos(clinica_id,paciente_id,profissional_id,profissional_nome,data_criacao,observacoes,tabela_preco,status,aprovado_por,data_aprovacao,forma_pagamento,tipo_pagamento,parcelas,desconto,valor_total) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", args: [pacId, profId, orc.profissional_nome||'', dataCriacao, orc.obs||'', orc.tabela||'PARTICULAR', orc.status||'aberto', orc.aprovado_por||'', orc.data_aprovacao||'', orc.forma_pagamento||'', orc.tipo_pagamento||'valor_total', orc.parcelas||1, orc.desconto||0, orc.valor_total||0] })
                    var orcId = Number(orcRes.lastInsertRowid)
                    // Insert items
                    if (orc.itens && orc.itens.length) {
                        for (var ii = 0; ii < orc.itens.length; ii++) {
                            var it = orc.itens[ii]
                            await client.execute({ sql: "INSERT INTO orcamento_itens(orcamento_id,procedimento_nome,dente,regiao,profissional_nome,valor_unitario,valor_plano,executado,data_execucao) VALUES(?,?,?,?,?,?,?,?,?)", args: [orcId, it.procedimento_nome||'', it.dente||'', it.regiao||'', it.profissional_nome||'', it.valor_unitario||0, it.valor_plano||0, it.executado||0, it.data_execucao||''] })
                        }
                    }
                    ins++
                } catch(e) { errs++ }
            }
            return res.status(200).json({ success: true, importados: ins, erros: errs })
        }

        // ── ORÇAMENTOS — LISTAR POR PACIENTE ─────────────────────────
        if (route === 'orcamentos-paciente') {
            var opId = parseInt(q.paciente_id) || 0
            if (!opId) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            // Ensure tables exist
            try { await client.execute("CREATE TABLE IF NOT EXISTS orcamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, profissional_id INTEGER, profissional_nome TEXT, data_criacao TEXT DEFAULT (datetime('now')), observacoes TEXT, tabela_preco TEXT DEFAULT 'PARTICULAR', status TEXT DEFAULT 'aberto', aprovado_por TEXT, data_aprovacao TEXT, motivo_reprovacao TEXT, forma_pagamento TEXT, tipo_pagamento TEXT DEFAULT 'valor_total', parcelas INTEGER DEFAULT 1, desconto REAL DEFAULT 0, valor_total REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))") } catch(e) {}
            try { await client.execute("CREATE TABLE IF NOT EXISTS orcamento_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, orcamento_id INTEGER REFERENCES orcamentos(id), procedimento_codigo TEXT, procedimento_nome TEXT, dente TEXT, regiao TEXT, profissional_id INTEGER, profissional_nome TEXT, valor_unitario REAL DEFAULT 0, valor_plano REAL DEFAULT 0, quantidade INTEGER DEFAULT 1, executado INTEGER DEFAULT 0, data_execucao TEXT, created_at TEXT DEFAULT (datetime('now')))") } catch(e) {}
            var orcRows = await client.execute({ sql: "SELECT * FROM orcamentos WHERE paciente_id=? AND clinica_id=? ORDER BY data_criacao DESC", args: [opId, clinica_id] })
            var orcList = orcRows.rows
            // Load items for each orcamento
            var orcIds = orcList.map(function(o) { return o.id })
            var itensMap = {}
            if (orcIds.length) {
                var itensRows = await client.execute({ sql: "SELECT * FROM orcamento_itens WHERE orcamento_id IN (" + orcIds.join(',') + ") ORDER BY id", args: [] })
                itensRows.rows.forEach(function(it) {
                    if (!itensMap[it.orcamento_id]) itensMap[it.orcamento_id] = []
                    itensMap[it.orcamento_id].push(it)
                })
            }
            orcList.forEach(function(o) { o.itens = itensMap[o.id] || [] })
            return res.status(200).json({ success: true, orcamentos: orcList })
        }

        // ── ORÇAMENTOS — SALVAR (criar ou atualizar) ─────────────────
        if (route === 'salvar-orcamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var so = req.body || {}
            if (!so.paciente_id) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            // Ensure tables exist
            try { await client.execute("CREATE TABLE IF NOT EXISTS orcamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, profissional_id INTEGER, profissional_nome TEXT, data_criacao TEXT DEFAULT (datetime('now')), observacoes TEXT, tabela_preco TEXT DEFAULT 'PARTICULAR', status TEXT DEFAULT 'aberto', aprovado_por TEXT, data_aprovacao TEXT, motivo_reprovacao TEXT, forma_pagamento TEXT, tipo_pagamento TEXT DEFAULT 'valor_total', parcelas INTEGER DEFAULT 1, desconto REAL DEFAULT 0, valor_total REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))") } catch(e) {}
            try { await client.execute("CREATE TABLE IF NOT EXISTS orcamento_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, orcamento_id INTEGER REFERENCES orcamentos(id), procedimento_codigo TEXT, procedimento_nome TEXT, dente TEXT, regiao TEXT, profissional_id INTEGER, profissional_nome TEXT, valor_unitario REAL DEFAULT 0, valor_plano REAL DEFAULT 0, quantidade INTEGER DEFAULT 1, executado INTEGER DEFAULT 0, data_execucao TEXT, created_at TEXT DEFAULT (datetime('now')))") } catch(e) {}
            var soItens = so.itens || []
            var soValorTotal = soItens.reduce(function(s, it) { return s + (+(it.valor_unitario || 0) * (+(it.quantidade || 1))) }, 0)
            var orcId
            if (so.id) {
                // Update existing
                await client.execute({ sql: "UPDATE orcamentos SET profissional_id=?,profissional_nome=?,data_criacao=?,observacoes=?,tabela_preco=?,forma_pagamento=?,tipo_pagamento=?,parcelas=?,desconto=?,valor_total=?,status=CASE WHEN status IN ('desaprovado','reprovado') THEN 'aberto' ELSE status END,updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [so.profissional_id||null, so.profissional_nome||'', so.data_criacao||new Date().toISOString().slice(0,10), so.observacoes||'', so.tabela_preco||'PARTICULAR', so.forma_pagamento||null, so.tipo_pagamento||'valor_total', so.parcelas||1, so.desconto||0, soValorTotal, so.id, clinica_id] })
                orcId = so.id
                // Delete old items and re-insert
                await client.execute({ sql: "DELETE FROM orcamento_itens WHERE orcamento_id=?", args: [orcId] })
            } else {
                // Insert new
                var insResult = await client.execute({ sql: "INSERT INTO orcamentos (clinica_id,paciente_id,profissional_id,profissional_nome,data_criacao,observacoes,tabela_preco,forma_pagamento,tipo_pagamento,parcelas,desconto,valor_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", args: [clinica_id, so.paciente_id, so.profissional_id||null, so.profissional_nome||'', so.data_criacao||new Date().toISOString().slice(0,10), so.observacoes||'', so.tabela_preco||'PARTICULAR', so.forma_pagamento||null, so.tipo_pagamento||'valor_total', so.parcelas||1, so.desconto||0, soValorTotal] })
                orcId = Number(insResult.lastInsertRowid)
            }
            // Insert items
            for (var si = 0; si < soItens.length; si++) {
                var it = soItens[si]
                await client.execute({ sql: "INSERT INTO orcamento_itens (orcamento_id,procedimento_codigo,procedimento_nome,dente,regiao,profissional_id,profissional_nome,valor_unitario,valor_plano,quantidade) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [orcId, it.procedimento_codigo||'', it.procedimento_nome||'', it.dente||'', it.regiao||'', it.profissional_id||null, it.profissional_nome||'', +(it.valor_unitario||0), +(it.valor_plano||0), +(it.quantidade||1)] })
            }
            return res.status(200).json({ success: true, id: orcId, msg: 'Orçamento salvo' })
        }

        // ── ORÇAMENTOS — APROVAR ─────────────────────────────────────
        if (route === 'aprovar-orcamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ao = req.body || {}
            if (!ao.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({ sql: "UPDATE orcamentos SET status='aprovado',aprovado_por=?,data_aprovacao=datetime('now'),updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [ao.aprovado_por||'', ao.id, clinica_id] })

            // Generate approval commissions for each item's professional
            try {
                var aoOrc = await client.execute({ sql: "SELECT tabela_preco, paciente_id FROM orcamentos WHERE id=?", args: [ao.id] })
                var aoTabela = aoOrc.rows.length ? (aoOrc.rows[0].tabela_preco || 'PARTICULAR') : 'PARTICULAR'
                var aoPacId = aoOrc.rows.length ? aoOrc.rows[0].paciente_id : null
                var aoPacNome = ''
                if (aoPacId) { var aoPn = await client.execute({ sql: "SELECT nome FROM pacientes WHERE id=?", args: [aoPacId] }); if (aoPn.rows.length) aoPacNome = aoPn.rows[0].nome }

                var aoItens = await client.execute({ sql: "SELECT * FROM orcamento_itens WHERE orcamento_id=?", args: [ao.id] })
                for (var aoi = 0; aoi < aoItens.rows.length; aoi++) {
                    var aoItem = aoItens.rows[aoi]
                    var aoProfId = aoItem.profissional_id
                    if (!aoProfId) continue
                    var aoConfig = await client.execute({ sql: "SELECT * FROM comissoes_config WHERE profissional_id=? AND momento='aprovacao' AND (tabela_preco=? OR tabela_preco='TODAS') AND clinica_id=? ORDER BY tabela_preco='TODAS' LIMIT 1", args: [aoProfId, aoTabela, clinica_id] })
                    if (!aoConfig.rows.length) continue
                    var aoR = aoConfig.rows[0]
                    var aoValBase = (aoItem.valor_unitario || 0) * (aoItem.quantidade || 1)
                    var aoValCom = aoR.tipo === 'percentual' ? aoValBase * aoR.valor / 100 : aoR.valor
                    var aoProfNome = aoItem.profissional_nome || ''
                    if (!aoProfNome) { var aoProfN = await client.execute({ sql: "SELECT nome FROM profissionais WHERE id=?", args: [aoProfId] }); if (aoProfN.rows.length) aoProfNome = aoProfN.rows[0].nome }
                    await client.execute({
                        sql: "INSERT INTO comissoes_lancamentos(clinica_id, profissional_id, profissional_nome, orcamento_id, orcamento_item_id, paciente_id, paciente_nome, procedimento_nome, tabela_preco, momento, tipo, valor_base, percentual, valor_comissao, data_referencia) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        args: [clinica_id, aoProfId, aoProfNome, ao.id, aoItem.id, aoPacId, aoPacNome, aoItem.procedimento_nome, aoTabela, 'aprovacao', aoR.tipo, aoValBase, aoR.tipo === 'percentual' ? aoR.valor : null, aoValCom, new Date().toISOString().slice(0, 10)]
                    })
                }
            } catch(e) { console.error('[aprovar-orcamento] comissoes error:', e.message) }

            return res.status(200).json({ success: true, msg: 'Orçamento aprovado' })
        }

        // ── ORÇAMENTOS — REPROVAR ────────────────────────────────────
        if (route === 'reprovar-orcamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ro = req.body || {}
            if (!ro.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({ sql: "UPDATE orcamentos SET status='reprovado',motivo_reprovacao=?,updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [ro.motivo||'', ro.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Orçamento reprovado' })
        }

        // ── ORÇAMENTOS — DESAPROVAR ──────────────────────────────────
        if (route === 'desaprovar-orcamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var da = req.body || {}
            if (!da.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            if (!da.motivo) return res.status(400).json({ success: false, error: 'motivo obrigatório' })

            // Verify orcamento is approved
            var daOrc = await client.execute({ sql: "SELECT * FROM orcamentos WHERE id=? AND clinica_id=?", args: [da.id, clinica_id] })
            if (!daOrc.rows.length) return res.status(404).json({ success: false, error: 'Orçamento não encontrado' })
            var daO = daOrc.rows[0]
            if (daO.status !== 'aprovado') return res.status(400).json({ success: false, error: 'Orçamento não está aprovado' })

            // Check executed items
            var daItens = await client.execute({ sql: "SELECT * FROM orcamento_itens WHERE orcamento_id=?", args: [da.id] })
            var daExec = daItens.rows.filter(function(i) { return i.executado === 1 })
            var daNaoExec = daItens.rows.filter(function(i) { return i.executado !== 1 })
            var daForceParcial = da.parcial === true

            // Check permission for partial (when items are executed)
            if (daExec.length > 0 && !daForceParcial) {
                return res.status(400).json({
                    success: false,
                    error: 'Existem ' + daExec.length + ' procedimentos executados',
                    executados: daExec.length,
                    nao_executados: daNaoExec.length,
                    requer_parcial: true
                })
            }

            var daHoje = new Date().toISOString().slice(0, 10)

            if (daExec.length === 0) {
                // TOTAL disapproval - no items executed
                await client.execute({ sql: "UPDATE orcamentos SET status='desaprovado', motivo_reprovacao=?, updated_at=datetime('now') WHERE id=?", args: [da.motivo, da.id] })

                // Cancel all parcelas
                await client.execute({ sql: "UPDATE parcelas_orcamento SET status='cancelado', updated_at=datetime('now') WHERE orcamento_id=? AND status='pendente'", args: [da.id] })

                // Cancel pending Asaas charges in DB
                await client.execute({ sql: "UPDATE cobrancas SET status='cancelado', updated_at=datetime('now') WHERE id IN (SELECT cobranca_id FROM parcelas_orcamento WHERE orcamento_id=? AND cobranca_id IS NOT NULL) AND status='pendente'", args: [da.id] })

                // Cancel pending commissions
                await client.execute({ sql: "UPDATE comissoes_lancamentos SET status='cancelado' WHERE orcamento_id=? AND status='pendente'", args: [da.id] })

                // Calculate refund: how much was already paid
                var daPago = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM parcelas_orcamento WHERE orcamento_id=? AND status='pago'", args: [da.id] })
                var daValorPago = daPago.rows[0].total || 0

                // If patient paid something, register credit
                if (daValorPago > 0) {
                    await client.execute({
                        sql: "INSERT INTO lancamentos(clinica_id, data, tipo, descricao, valor, classificacao, categoria, status) VALUES(?,?,?,?,?,?,?,?)",
                        args: [clinica_id, daHoje, 'Saída', 'Estorno - Desaprovação Orçamento #' + da.id, daValorPago, 'Receita', 'Estorno', 'pendente']
                    })
                }

                // Activity log
                try {
                    await client.execute({ sql: "INSERT INTO activity_log(clinica_id, usuario_id, acao, detalhes, created_at) VALUES(?,?,?,?,datetime('now'))", args: [clinica_id, auth.usuario_id, 'desaprovar_orcamento', 'Orçamento #' + da.id + ' desaprovado totalmente. Motivo: ' + da.motivo + '. Estorno: R$ ' + daValorPago.toFixed(2)] })
                } catch(e) {}

                return res.status(200).json({ success: true, tipo: 'total', msg: 'Orçamento desaprovado totalmente', estorno: daValorPago })

            } else {
                // PARTIAL disapproval - some items executed
                // Calculate new total (only executed items)
                var daNovoTotal = daExec.reduce(function(s, i) { return s + (i.valor_unitario || 0) * (i.quantidade || 1) }, 0)
                var daDesconto = parseFloat(daO.desconto) || 0
                var daNovoLiquido = daNovoTotal - daDesconto
                if (daNovoLiquido < 0) daNovoLiquido = 0

                // Update orcamento with new total
                await client.execute({ sql: "UPDATE orcamentos SET valor_total=?, motivo_reprovacao=?, updated_at=datetime('now') WHERE id=?", args: [daNovoTotal, 'Desaprovação parcial: ' + da.motivo, da.id] })

                // Cancel non-executed item commissions
                for (var dai = 0; dai < daNaoExec.length; dai++) {
                    await client.execute({ sql: "UPDATE comissoes_lancamentos SET status='cancelado' WHERE orcamento_item_id=? AND status='pendente'", args: [daNaoExec[dai].id] })
                }

                // Cancel pending parcelas
                await client.execute({ sql: "UPDATE parcelas_orcamento SET status='cancelado', updated_at=datetime('now') WHERE orcamento_id=? AND status='pendente'", args: [da.id] })
                await client.execute({ sql: "UPDATE cobrancas SET status='cancelado', updated_at=datetime('now') WHERE id IN (SELECT cobranca_id FROM parcelas_orcamento WHERE orcamento_id=? AND cobranca_id IS NOT NULL) AND status='pendente'", args: [da.id] })

                // Calculate refund
                var daPago2 = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM parcelas_orcamento WHERE orcamento_id=? AND status='pago'", args: [da.id] })
                var daValorPago2 = daPago2.rows[0].total || 0
                var daDiferenca = daValorPago2 - daNovoLiquido

                if (daDiferenca > 0) {
                    // Patient overpaid - register credit/refund
                    await client.execute({
                        sql: "INSERT INTO lancamentos(clinica_id, data, tipo, descricao, valor, classificacao, categoria, status) VALUES(?,?,?,?,?,?,?,?)",
                        args: [clinica_id, daHoje, 'Saída', 'Estorno parcial - Orçamento #' + da.id + ' (Pago: ' + daValorPago2.toFixed(2) + ', Novo total: ' + daNovoLiquido.toFixed(2) + ')', daDiferenca, 'Receita', 'Estorno', 'pendente']
                    })
                }

                // Activity log
                try {
                    await client.execute({ sql: "INSERT INTO activity_log(clinica_id, usuario_id, acao, detalhes, created_at) VALUES(?,?,?,?,datetime('now'))", args: [clinica_id, auth.usuario_id, 'desaprovar_orcamento_parcial', 'Orçamento #' + da.id + ' desaprovado parcialmente. ' + daExec.length + ' executados, ' + daNaoExec.length + ' cancelados. Novo total: R$ ' + daNovoTotal.toFixed(2) + '. Diferença/Estorno: R$ ' + (daDiferenca > 0 ? daDiferenca.toFixed(2) : '0.00')] })
                } catch(e) {}

                return res.status(200).json({
                    success: true, tipo: 'parcial', msg: 'Orçamento desaprovado parcialmente',
                    executados: daExec.length, cancelados: daNaoExec.length,
                    novo_total: daNovoTotal, valor_pago: daValorPago2, estorno: daDiferenca > 0 ? daDiferenca : 0
                })
            }
        }

        // ── DOCUMENTOS-PACIENTE (fotos, exames, RX) ──────────────
        if (route === 'documentos-paciente') {
            var dpPacId = parseInt(q.paciente_id) || 0
            if (!dpPacId) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            await client.execute("CREATE TABLE IF NOT EXISTS documentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, tipo TEXT, nome TEXT, descricao TEXT, url TEXT, created_at TEXT DEFAULT (datetime('now')))")
            try { await client.execute("ALTER TABLE documentos ADD COLUMN descricao TEXT") } catch(e) {}
            if (q.tipo) {
                var dpRows = await client.execute({ sql: "SELECT * FROM documentos WHERE paciente_id=? AND clinica_id=? AND tipo=? ORDER BY created_at DESC", args: [dpPacId, clinica_id, q.tipo] })
                return res.status(200).json({ success: true, documentos: dpRows.rows })
            }
            var dpRows2 = await client.execute({ sql: "SELECT * FROM documentos WHERE paciente_id=? AND clinica_id=? ORDER BY created_at DESC", args: [dpPacId, clinica_id] })
            return res.status(200).json({ success: true, documentos: dpRows2.rows })
        }

        // ── SALVAR-DOCUMENTO ──────────────────────────────────────────
        if (route === 'salvar-documento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var sd = req.body || {}
            if (!sd.paciente_id || !sd.url) return res.status(400).json({ success: false, error: 'paciente_id e url obrigatórios' })
            await client.execute("CREATE TABLE IF NOT EXISTS documentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, tipo TEXT, nome TEXT, descricao TEXT, url TEXT, created_at TEXT DEFAULT (datetime('now')))")
            try { await client.execute("ALTER TABLE documentos ADD COLUMN descricao TEXT") } catch(e) {}
            if (sd.url.length > 2000000) return res.status(400).json({ success: false, error: 'Arquivo muito grande. Maximo 1.5MB.' })
            var sdIns = await client.execute({ sql: "INSERT INTO documentos(clinica_id, paciente_id, tipo, nome, descricao, url) VALUES(?,?,?,?,?,?)", args: [clinica_id, sd.paciente_id, sd.tipo || 'foto', sd.nome || '', sd.descricao || '', sd.url] })
            return res.status(200).json({ success: true, id: Number(sdIns.lastInsertRowid) })
        }

        // ── EXCLUIR-DOCUMENTO ──────────────────────────────────────────
        if (route === 'excluir-documento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ed = req.body || {}
            if (!ed.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({ sql: "DELETE FROM documentos WHERE id=? AND clinica_id=?", args: [ed.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Documento excluído' })
        }

        // ── FICHA-CLINICA (procedimentos executados do paciente) ────
        if (route === 'ficha-clinica') {
            var fcPacId = parseInt(q.paciente_id) || 0
            if (!fcPacId) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            var fcRows = await client.execute({
                sql: "SELECT oi.id, oi.orcamento_id, oi.procedimento_codigo, oi.procedimento_nome, oi.dente, oi.regiao, oi.profissional_nome, oi.valor_unitario, oi.quantidade, oi.executado, oi.data_execucao, o.data_aprovacao, o.status as orc_status FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id WHERE o.paciente_id=? AND o.clinica_id=? AND oi.executado=1 ORDER BY oi.data_execucao DESC, oi.id DESC",
                args: [fcPacId, clinica_id]
            })
            return res.status(200).json({ success: true, procedimentos: fcRows.rows })
        }

        // ── RENEGOCIAR-ORCAMENTO ────────────────────────────────────
        if (route === 'renegociar-orcamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var rn = req.body || {}
            if (!rn.id) return res.status(400).json({ success: false, error: 'id obrigatório' })

            // Verify orcamento exists and is approved
            var rnOrc = await client.execute({ sql: "SELECT * FROM orcamentos WHERE id=? AND clinica_id=?", args: [rn.id, clinica_id] })
            if (!rnOrc.rows.length) return res.status(404).json({ success: false, error: 'Orçamento não encontrado' })

            // Cancel pending parcelas
            var rnParc = await client.execute({ sql: "UPDATE parcelas_orcamento SET status='cancelado', updated_at=datetime('now') WHERE orcamento_id=? AND status IN ('pendente','vencido') AND clinica_id=?", args: [rn.id, clinica_id] })

            // Cancel pending cobrancas in DB
            var rnCob = await client.execute({ sql: "UPDATE cobrancas SET status='cancelado', updated_at=datetime('now') WHERE id IN (SELECT cobranca_id FROM parcelas_orcamento WHERE orcamento_id=? AND cobranca_id IS NOT NULL AND status='cancelado') AND status IN ('pendente','vencido')", args: [rn.id] })

            // Cancel pending commissions
            try { await client.execute({ sql: "UPDATE comissoes_lancamentos SET status='cancelado' WHERE orcamento_id=? AND status='pendente'", args: [rn.id] }) } catch(e) {}

            // Try to cancel in Asaas API
            var rnApiKey = ''
            try {
                var rnAk = await client.execute({ sql: "SELECT asaas_api_key FROM clinicas WHERE id=?", args: [clinica_id] })
                rnApiKey = (rnAk.rows.length && rnAk.rows[0].asaas_api_key) ? rnAk.rows[0].asaas_api_key : (process.env.ASAAS_API_KEY || '')
            } catch(e) {}
            if (rnApiKey) {
                var rnAsaasIds = await client.execute({ sql: "SELECT DISTINCT c.asaas_id FROM cobrancas c JOIN parcelas_orcamento po ON po.cobranca_id=c.id WHERE po.orcamento_id=? AND c.asaas_id IS NOT NULL AND c.asaas_id!='' AND c.status='cancelado'", args: [rn.id] })
                for (var rni = 0; rni < rnAsaasIds.rows.length; rni++) {
                    try {
                        await fetch('https://api.asaas.com/v3/payments/' + rnAsaasIds.rows[rni].asaas_id, {
                            method: 'DELETE',
                            headers: { 'access_token': rnApiKey }
                        })
                    } catch(e) {}
                }
            }

            // Log
            try { await client.execute({ sql: "INSERT INTO activity_log(clinica_id, usuario_id, acao, detalhes, created_at) VALUES(?,?,?,?,datetime('now'))", args: [clinica_id, auth.usuario_id, 'renegociar_orcamento', 'Orçamento #' + rn.id + ' renegociado. Parcelas canceladas: ' + (rnParc.rowsAffected || 0)] }) } catch(e) {}

            return res.status(200).json({ success: true, msg: 'Orçamento pronto para renegociação', parcelas_canceladas: rnParc.rowsAffected || 0, cobrancas_canceladas: rnCob.rowsAffected || 0 })
        }

        // ── ORÇAMENTOS — EXCLUIR ─────────────────────────────────────
        if (route === 'excluir-orcamento') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var eo = req.body || {}
            if (!eo.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({ sql: "DELETE FROM orcamento_itens WHERE orcamento_id=?", args: [eo.id] })
            await client.execute({ sql: "DELETE FROM orcamentos WHERE id=? AND clinica_id=?", args: [eo.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Orçamento excluído' })
        }

        // ── BUSCAR PROCEDIMENTO (autocomplete) ───────────────────────
        if (route === 'buscar-procedimento') {
            var bpq = q.q || ''
            var bpTab = q.tabela || ''
            if (bpq.length < 2) return res.status(400).json({ success: false, error: 'Mínimo 2 caracteres' })
            try { await client.execute("CREATE TABLE IF NOT EXISTS tabela_precos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER DEFAULT 1, tabela TEXT NOT NULL, procedimento TEXT NOT NULL, especialidade TEXT, sessoes INTEGER DEFAULT 1, valor REAL DEFAULT 0, comissao REAL DEFAULT 0, codigo_interno TEXT)") } catch(e) {}
            var bpSql, bpArgs
            if (bpTab) {
                bpSql = "SELECT id,procedimento as nome,especialidade,sessoes,valor,tabela,codigo_interno FROM tabela_precos WHERE procedimento LIKE ? AND UPPER(tabela)=UPPER(?) AND clinica_id=? ORDER BY procedimento LIMIT 20"
                bpArgs = ['%'+bpq+'%', bpTab, clinica_id || 1]
            } else {
                bpSql = "SELECT id,procedimento as nome,especialidade,sessoes,valor,tabela,codigo_interno FROM tabela_precos WHERE procedimento LIKE ? AND clinica_id=? ORDER BY procedimento LIMIT 20"
                bpArgs = ['%'+bpq+'%', clinica_id || 1]
            }
            var bpResult = await client.execute({ sql: bpSql, args: bpArgs })
            return res.status(200).json({ success: true, procedimentos: bpResult.rows })
        }

        // ── IMPORTAR TABELA DE PREÇOS ────────────────────────────────
        if (route === 'importar-tabela-precos') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            try { await client.execute("CREATE TABLE IF NOT EXISTS tabela_precos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER DEFAULT 1, tabela TEXT NOT NULL, procedimento TEXT NOT NULL, especialidade TEXT, sessoes INTEGER DEFAULT 1, valor REAL DEFAULT 0, comissao REAL DEFAULT 0, codigo_interno TEXT)") } catch(e) {}
            var tpLote = req.body || []
            if (!Array.isArray(tpLote)) tpLote = tpLote.itens || []
            var tpIns = 0, tpErr = 0
            for (var ti = 0; ti < tpLote.length; ti++) {
                var tp = tpLote[ti]
                try {
                    await client.execute({ sql: "INSERT INTO tabela_precos(clinica_id,tabela,procedimento,especialidade,sessoes,valor,comissao,codigo_interno) VALUES(1,?,?,?,?,?,?,?)", args: [tp.tabela||'', tp.procedimento||'', tp.especialidade||'', tp.sessoes||1, tp.valor||0, tp.comissao||0, tp.codigo_interno||''] })
                    tpIns++
                } catch(e) { tpErr++ }
            }
            return res.status(200).json({ success: true, importados: tpIns, erros: tpErr })
        }

        // ── ANAMNESE ─────────────────────────────────────────────────
        if (route === 'anamnese-migrate') {
            await client.execute("CREATE TABLE IF NOT EXISTS anamnese_perguntas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, pergunta TEXT NOT NULL, tipo TEXT DEFAULT 'YES_NO', sequencia INTEGER, ativo INTEGER DEFAULT 1)")
            await client.execute("CREATE TABLE IF NOT EXISTS anamnese_respostas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, pergunta_id INTEGER, pergunta_texto TEXT, resposta TEXT, descricao TEXT, data_preenchimento TEXT DEFAULT (datetime('now')), preenchido_por TEXT)")
            // Seed 18 default questions for clinica_id=1
            var existQ = await client.execute({ sql: "SELECT COUNT(*) as c FROM anamnese_perguntas WHERE clinica_id=1", args: [] })
            if (existQ.rows[0].c === 0) {
                var pergs = [
                    [1,'Qual o motivo da consulta?','DESC',1],
                    [1,'Quando foi o seu último tratamento odontológico?','DESC',2],
                    [1,'Está fazendo algum tratamento médico?','YES_NO',3],
                    [1,'Está tomando algum medicamento?','YES_NO',4],
                    [1,'Tem alergia a algum medicamento?','YES_NO',5],
                    [1,'Teve alguma reação a anestesia local?','YES_NO',6],
                    [1,'Sente sensibilidade nos dentes?','YES_NO',7],
                    [1,'Range os dentes ou tem apertamento?','YES_NO',8],
                    [1,'Sua gengiva sangra com frequência?','YES_NO',9],
                    [1,'Tem algum hábito? (Ex.: roe unha, morde tampa de caneta)','YES_NO',10],
                    [1,'Fuma? Quantos cigarros por dia?','YES_NO',11],
                    [1,'É diabético? Tem alguém da família que é diabético?','YES_NO',12],
                    [1,'Quando você se corta, sangra muito?','YES_NO',13],
                    [1,'Tem algum problema cardíaco?','YES_NO',14],
                    [1,'Sente dores de cabeça, dores na face, ouvido ou articulação?','YES_NO',15],
                    [1,'Teve algum desmaio, tem ataques nervosos, epilepsia ou convulsão?','YES_NO',16],
                    [1,'Sua pressão arterial é normal?','YES_NO',17],
                    [1,'Está grávida?','YES_NO',18]
                ]
                for (var pi = 0; pi < pergs.length; pi++) {
                    var pg = pergs[pi]
                    await client.execute({ sql: "INSERT INTO anamnese_perguntas(clinica_id,pergunta,tipo,sequencia) VALUES(?,?,?,?)", args: pg })
                }
            }
            return res.status(200).json({ success: true, message: 'Anamnese tables created and seeded' })
        }

        if (route === 'anamnese-perguntas') {
            var apCid = clinica_id || parseInt(q.clinica_id) || 1
            var apR = await client.execute({ sql: "SELECT * FROM anamnese_perguntas WHERE clinica_id=? AND ativo=1 ORDER BY sequencia", args: [apCid] })
            return res.status(200).json({ success: true, perguntas: apR.rows })
        }

        if (route === 'anamnese-paciente') {
            var anPid = parseInt(q.paciente_id) || 0
            if (!anPid) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            var anCid = clinica_id || parseInt(q.clinica_id) || 1
            var anR = await client.execute({ sql: "SELECT * FROM anamnese_respostas WHERE paciente_id=? AND clinica_id=? ORDER BY pergunta_id", args: [anPid, anCid] })
            return res.status(200).json({ success: true, respostas: anR.rows })
        }

        if (route === 'salvar-anamnese') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var saBody = req.body || {}
            var saPid = parseInt(saBody.paciente_id) || 0
            var saRespostas = saBody.respostas || []
            if (!saPid) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            var saCid = clinica_id || 1
            // Delete existing answers for this patient
            await client.execute({ sql: "DELETE FROM anamnese_respostas WHERE paciente_id=? AND clinica_id=?", args: [saPid, saCid] })
            // Insert new answers
            var saIns = 0
            for (var si = 0; si < saRespostas.length; si++) {
                var sr = saRespostas[si]
                await client.execute({ sql: "INSERT INTO anamnese_respostas(clinica_id,paciente_id,pergunta_id,pergunta_texto,resposta,descricao,preenchido_por) VALUES(?,?,?,?,?,?,?)", args: [saCid, saPid, sr.pergunta_id||0, sr.pergunta_texto||'', sr.resposta||'', sr.descricao||'', saBody.preenchido_por||''] })
                saIns++
            }
            return res.status(200).json({ success: true, salvos: saIns })
        }

        if (route === 'importar-anamneses-lote') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            // Ensure tables exist
            await client.execute("CREATE TABLE IF NOT EXISTS anamnese_perguntas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, pergunta TEXT NOT NULL, tipo TEXT DEFAULT 'YES_NO', sequencia INTEGER, ativo INTEGER DEFAULT 1)")
            await client.execute("CREATE TABLE IF NOT EXISTS anamnese_respostas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, pergunta_id INTEGER, pergunta_texto TEXT, resposta TEXT, descricao TEXT, data_preenchimento TEXT DEFAULT (datetime('now')), preenchido_por TEXT)")
            var alBody = req.body || []
            if (!Array.isArray(alBody)) alBody = alBody.anamneses || []
            var alIns = 0, alErrs = 0
            for (var ai = 0; ai < alBody.length; ai++) {
                var an = alBody[ai]
                try {
                    // Find paciente by clinicorp_id
                    var anPacR = await client.execute({ sql: "SELECT id FROM pacientes WHERE clinicorp_id=? LIMIT 1", args: [an.clinicorp_patient_id || ''] })
                    var anPacId = anPacR.rows.length ? anPacR.rows[0].id : null
                    if (!anPacId) { alErrs++; continue }
                    // Delete existing answers
                    await client.execute({ sql: "DELETE FROM anamnese_respostas WHERE paciente_id=? AND clinica_id=1", args: [anPacId] })
                    // Insert answers
                    var anResps = an.respostas || []
                    for (var ari = 0; ari < anResps.length; ari++) {
                        var ar = anResps[ari]
                        // Try to find pergunta_id by matching text
                        var arPergR = await client.execute({ sql: "SELECT id FROM anamnese_perguntas WHERE pergunta=? AND clinica_id=1 LIMIT 1", args: [ar.pergunta || ''] })
                        var arPergId = arPergR.rows.length ? arPergR.rows[0].id : null
                        await client.execute({ sql: "INSERT INTO anamnese_respostas(clinica_id,paciente_id,pergunta_id,pergunta_texto,resposta,descricao) VALUES(1,?,?,?,?,?)", args: [anPacId, arPergId, ar.pergunta||'', ar.resposta||'', ar.descricao||''] })
                    }
                    alIns++
                } catch(e) { alErrs++ }
            }
            return res.status(200).json({ success: true, importados: alIns, erros: alErrs })
        }

        // ── PAGAMENTOS-MIGRATE ──────────────────────────────────────
        if (route === 'pagamentos-migrate') {
            var pmSummary = { tables: [], columns: [] }

            // Create cobrancas table
            await client.execute("CREATE TABLE IF NOT EXISTS cobrancas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, paciente_nome TEXT, tipo TEXT NOT NULL, valor REAL NOT NULL, descricao TEXT, referencia TEXT, status TEXT DEFAULT 'pendente', data_vencimento TEXT, data_pagamento TEXT, boleto_url TEXT, boleto_codigo TEXT, pix_qrcode TEXT, pix_copia_cola TEXT, asaas_id TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))")
            pmSummary.tables.push('cobrancas: ok')

            // Create saques table
            await client.execute("CREATE TABLE IF NOT EXISTS saques (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, valor REAL NOT NULL, taxa REAL DEFAULT 0, valor_liquido REAL, status TEXT DEFAULT 'pendente', banco_dados TEXT, created_at TEXT DEFAULT (datetime('now')), processado_em TEXT)")
            pmSummary.tables.push('saques: ok')

            // Add columns to clinicas
            var pmCols = [
                "documento_tipo TEXT",
                "documento_numero TEXT",
                "razao_social TEXT",
                "endereco TEXT",
                "cep TEXT",
                "pix_tipo TEXT",
                "pix_chave TEXT",
                "banco_nome TEXT",
                "banco_agencia TEXT",
                "banco_conta TEXT",
                "asaas_api_key TEXT",
                "saldo REAL DEFAULT 0"
            ]
            for (var pmi = 0; pmi < pmCols.length; pmi++) {
                var pmCol = pmCols[pmi]
                var pmColName = pmCol.split(' ')[0]
                try {
                    await client.execute("ALTER TABLE clinicas ADD COLUMN " + pmCol)
                    pmSummary.columns.push(pmColName + ': adicionada')
                } catch(e) {
                    pmSummary.columns.push(pmColName + ': já existe')
                }
            }

            // Create indexes
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_cobrancas_clinica ON cobrancas(clinica_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_cobrancas_paciente ON cobrancas(paciente_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_saques_clinica ON saques(clinica_id)") } catch(e) {}

            return res.status(200).json({ success: true, summary: pmSummary })
        }

        // ── SALVAR-DADOS-CLINICA ──────────────────────────────────────
        if (route === 'salvar-dados-clinica') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var dc = req.body || {}
            // Ensure WhatsApp columns exist
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN whatsapp_token TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN whatsapp_phone_id TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN whatsapp_template TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN resend_api_key TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN resend_from_email TEXT") } catch(e) {}

            await client.execute({
                sql: "UPDATE clinicas SET documento_tipo=?, documento_numero=?, razao_social=?, endereco=?, cidade=?, estado=?, cep=?, pix_tipo=?, pix_chave=?, banco_nome=?, banco_agencia=?, banco_conta=?, asaas_api_key=COALESCE(NULLIF(?, ''), asaas_api_key), whatsapp_token=COALESCE(NULLIF(?, ''), whatsapp_token), whatsapp_phone_id=COALESCE(NULLIF(?, ''), whatsapp_phone_id), whatsapp_template=COALESCE(NULLIF(?, ''), whatsapp_template), resend_api_key=COALESCE(NULLIF(?, ''), resend_api_key), resend_from_email=COALESCE(NULLIF(?, ''), resend_from_email) WHERE id=?",
                args: [
                    dc.documento_tipo || '', dc.documento_numero || '', dc.razao_social || '',
                    dc.endereco || '', dc.cidade || '', dc.estado || '', dc.cep || '',
                    dc.pix_tipo || '', dc.pix_chave || '',
                    dc.banco_nome || '', dc.banco_agencia || '', dc.banco_conta || '',
                    dc.asaas_api_key || '', dc.whatsapp_token || '', dc.whatsapp_phone_id || '',
                    dc.whatsapp_template || '', dc.resend_api_key || '', dc.resend_from_email || '',
                    clinica_id
                ]
            })
            return res.status(200).json({ success: true, msg: 'Dados da clínica atualizados' })
        }

        // ── DADOS-CLINICA ──────────────────────────────────────────────
        if (route === 'dados-clinica') {
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN whatsapp_token TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN whatsapp_phone_id TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN whatsapp_template TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN resend_api_key TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE clinicas ADD COLUMN resend_from_email TEXT") } catch(e) {}
            var dcRow = await client.execute({ sql: "SELECT id, nome, cnpj, cidade, estado, documento_tipo, documento_numero, razao_social, endereco, cep, pix_tipo, pix_chave, banco_nome, banco_agencia, banco_conta, saldo, CASE WHEN asaas_api_key IS NOT NULL AND asaas_api_key != '' THEN 1 ELSE 0 END as asaas_configurado, CASE WHEN whatsapp_token IS NOT NULL AND whatsapp_token != '' THEN 1 ELSE 0 END as whatsapp_configurado, whatsapp_phone_id, whatsapp_template, CASE WHEN resend_api_key IS NOT NULL AND resend_api_key != '' THEN 1 ELSE 0 END as email_configurado, resend_from_email FROM clinicas WHERE id=?", args: [clinica_id] })
            if (!dcRow.rows.length) return res.status(404).json({ success: false, error: 'Clínica não encontrada' })
            return res.status(200).json({ success: true, clinica: dcRow.rows[0] })
        }

        // ── GERAR-COBRANCA ──────────────────────────────────────────────
        if (route === 'gerar-cobranca') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var gc = req.body || {}
            if (!gc.tipo || !gc.valor) return res.status(400).json({ success: false, error: 'tipo e valor obrigatórios' })

            var gcPix = '', gcPixCola = '', gcBoletoUrl = '', gcBoletoCod = '', gcAsaasId = '', gcInvoiceUrl = ''

            // Check if Asaas is configured
            var gcAsaas = await client.execute({ sql: "SELECT asaas_api_key FROM clinicas WHERE id=?", args: [clinica_id] })
            var gcApiKey = (gcAsaas.rows.length && gcAsaas.rows[0].asaas_api_key) ? gcAsaas.rows[0].asaas_api_key : (process.env.ASAAS_API_KEY || '')
            if (!gcApiKey) {
                return res.status(400).json({ success: false, error: 'Asaas API Key não configurada. Vá em Configurações > Dados da Clínica.' })
            }

            // Check/create customer in Asaas
            var gcPaciente = null
            if (gc.paciente_id) {
                var gcPacRow = await client.execute({ sql: "SELECT nome, cpf, email, telefone FROM pacientes WHERE id=? AND clinica_id=?", args: [gc.paciente_id, clinica_id] })
                if (gcPacRow.rows.length) gcPaciente = gcPacRow.rows[0]
            }

            try {
                // Search for existing customer by CPF
                var gcCpf = (gcPaciente && gcPaciente.cpf) ? gcPaciente.cpf.replace(/\D/g, '') : ''
                var gcCustomerId = ''

                // Boleto requires CPF
                if ((gc.tipo === 'boleto') && !gcCpf) {
                    return res.status(400).json({ success: false, error: 'CPF do paciente é obrigatório para gerar boleto. Cadastre o CPF no prontuário do paciente.' })
                }

                if (gcCpf) {
                    var gcCustSearch = await fetch('https://api.asaas.com/v3/customers?cpfCnpj=' + encodeURIComponent(gcCpf), {
                        headers: { 'access_token': gcApiKey }
                    })
                    var gcCustData = await gcCustSearch.json()
                    if (gcCustData.data && gcCustData.data.length > 0) gcCustomerId = gcCustData.data[0].id
                }
                if (!gcCustomerId) {
                    // Create customer
                    var gcCustBody = { name: (gcPaciente && gcPaciente.nome) || gc.paciente_nome || 'Cliente' }
                    if (gcCpf) gcCustBody.cpfCnpj = gcCpf
                    if (gcPaciente && gcPaciente.email) gcCustBody.email = gcPaciente.email
                    if (gcPaciente && gcPaciente.telefone) gcCustBody.mobilePhone = gcPaciente.telefone.replace(/\D/g, '')

                    console.log('[gerar-cobranca] Criando cliente Asaas:', JSON.stringify(gcCustBody))
                    var gcNewCust = await fetch('https://api.asaas.com/v3/customers', {
                        method: 'POST',
                        headers: { 'access_token': gcApiKey, 'Content-Type': 'application/json' },
                        body: JSON.stringify(gcCustBody)
                    })
                    var gcNewCustData = await gcNewCust.json()
                    console.log('[gerar-cobranca] Resposta criar cliente:', JSON.stringify(gcNewCustData))
                    if (gcNewCustData.errors) return res.status(400).json({ success: false, error: 'Asaas cliente: ' + (gcNewCustData.errors[0] && gcNewCustData.errors[0].description || JSON.stringify(gcNewCustData.errors)) })
                    gcCustomerId = gcNewCustData.id || ''
                }
                if (!gcCustomerId) return res.status(400).json({ success: false, error: 'Não foi possível criar/encontrar cliente no Asaas. Verifique o CPF do paciente.' })

                // Map tipo to Asaas billingType
                var gcBillingMap = { pix: 'PIX', boleto: 'BOLETO', credito: 'CREDIT_CARD', debito: 'DEBIT_CARD' }
                var gcBillingType = gcBillingMap[gc.tipo] || 'BOLETO'

                // Build payment body - ensure dueDate is today or future
                var gcDueDate = gc.data_vencimento || new Date().toISOString().slice(0, 10)
                var gcToday = new Date().toISOString().slice(0, 10)
                if (gcDueDate < gcToday) gcDueDate = gcToday // Asaas rejects past dates

                var gcPayBody = {
                    customer: gcCustomerId,
                    billingType: gcBillingType,
                    value: parseFloat(gc.valor),
                    dueDate: gcDueDate,
                    description: gc.descricao || 'Cobrança Klinik'
                }
                // Credit card: add installment count
                if (gc.tipo === 'credito' && gc.parcelas && parseInt(gc.parcelas) > 1) {
                    gcPayBody.installmentCount = parseInt(gc.parcelas)
                    gcPayBody.installmentValue = parseFloat((parseFloat(gc.valor) / parseInt(gc.parcelas)).toFixed(2))
                }

                console.log('[gerar-cobranca] Criando pagamento Asaas:', JSON.stringify(gcPayBody))
                var gcPayment = await fetch('https://api.asaas.com/v3/payments', {
                    method: 'POST',
                    headers: { 'access_token': gcApiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify(gcPayBody)
                })
                var gcPayData = await gcPayment.json()
                console.log('[gerar-cobranca] Resposta pagamento:', JSON.stringify({ id: gcPayData.id, status: gcPayData.status, invoiceUrl: gcPayData.invoiceUrl, errors: gcPayData.errors }))
                if (gcPayData.errors) {
                    return res.status(400).json({ success: false, error: 'Asaas pagamento: ' + (gcPayData.errors[0] && gcPayData.errors[0].description || JSON.stringify(gcPayData.errors)), detalhes: gcPayData.errors })
                }
                gcAsaasId = gcPayData.id || ''
                gcBoletoUrl = gcPayData.bankSlipUrl || ''
                gcBoletoCod = gcPayData.nossoNumero || ''
                gcInvoiceUrl = gcPayData.invoiceUrl || ''

                // For PIX, fetch the QR code
                if (gc.tipo === 'pix' && gcAsaasId) {
                    try {
                        var gcPixRes = await fetch('https://api.asaas.com/v3/payments/' + gcAsaasId + '/pixQrCode', {
                            headers: { 'access_token': gcApiKey }
                        })
                        var gcPixData = await gcPixRes.json()
                        gcPixCola = gcPixData.payload || ''
                        gcPix = gcPixData.encodedImage || ''
                    } catch(ep) { console.error('[gerar-cobranca] PIX QR error:', ep.message) }
                }
            } catch(e) {
                return res.status(500).json({ success: false, error: 'Erro ao gerar cobrança no Asaas: ' + e.message })
            }

            // Add invoice_url column if missing
            try { await client.execute("ALTER TABLE cobrancas ADD COLUMN invoice_url TEXT") } catch(e) {}
            try { await client.execute("ALTER TABLE cobrancas ADD COLUMN parcelas INTEGER DEFAULT 1") } catch(e) {}

            // Insert cobranca
            var gcIns = await client.execute({
                sql: "INSERT INTO cobrancas(clinica_id, paciente_id, paciente_nome, tipo, valor, descricao, referencia, status, data_vencimento, boleto_url, boleto_codigo, pix_qrcode, pix_copia_cola, asaas_id, invoice_url, parcelas) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                args: [clinica_id, gc.paciente_id || null, gc.paciente_nome || '', gc.tipo, parseFloat(gc.valor), gc.descricao || '', gc.referencia || '', 'pendente', gc.data_vencimento || '', gcBoletoUrl, gcBoletoCod, gcPix || '', gcPixCola, gcAsaasId, gcInvoiceUrl, parseInt(gc.parcelas) || 1]
            })
            var gcNewId = Number(gcIns.lastInsertRowid)

            // Send payment link via WhatsApp/Email if requested
            if (gc.enviar_link && gcInvoiceUrl && gcPaciente) {
                var linkMsg = 'Olá ' + (gcPaciente.nome || '').split(' ')[0] + '! Segue o link para pagamento: ' + gcInvoiceUrl + ' - Valor: R$ ' + parseFloat(gc.valor).toFixed(2).replace('.', ',') + (gc.tipo === 'credito' && gc.parcelas > 1 ? ' ('+gc.parcelas+'x de R$ '+(parseFloat(gc.valor)/parseInt(gc.parcelas)).toFixed(2).replace('.',',')+')' : '') + ' - Klinik Odontologia'
                // WhatsApp
                var waToken = process.env.WHATSAPP_TOKEN || ''
                var waPhoneId = process.env.WHATSAPP_PHONE_ID || ''
                if (waToken && waPhoneId && gcPaciente.telefone) {
                    try {
                        var waPhone = (gcPaciente.telefone || '').replace(/\D/g, '')
                        if (waPhone.length <= 11) waPhone = '55' + waPhone
                        await fetch('https://graph.facebook.com/v23.0/' + waPhoneId + '/messages', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + waToken, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: linkMsg } })
                        })
                    } catch(ew) { console.error('[cobranca] WhatsApp send error:', ew.message) }
                }
                // Email
                var resendKey = process.env.RESEND_API_KEY || ''
                var resendFrom = process.env.RESEND_FROM_EMAIL || 'noreply@klinik.com.br'
                if (resendKey && gcPaciente.email) {
                    try {
                        await fetch('https://api.resend.com/emails', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ from: resendFrom, to: [gcPaciente.email], subject: 'Link de Pagamento - Klinik Odontologia', html: linkMsg.replace(/\n/g, '<br>') })
                        })
                    } catch(ee) { console.error('[cobranca] Email send error:', ee.message) }
                }
            }

            // Fetch the inserted record
            var gcRec = await client.execute({ sql: "SELECT * FROM cobrancas WHERE id=?", args: [gcNewId] })
            return res.status(200).json({ success: true, cobranca: gcRec.rows[0] || { id: gcNewId }, invoice_url: gcInvoiceUrl })
        }

        // ── COBRANCAS-PACIENTE ──────────────────────────────────────────
        if (route === 'cobrancas-paciente') {
            var cpPacId = parseInt(q.paciente_id) || 0
            if (!cpPacId) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            var cpRows = await client.execute({ sql: "SELECT * FROM cobrancas WHERE paciente_id=? AND clinica_id=? ORDER BY created_at DESC", args: [cpPacId, clinica_id] })
            return res.status(200).json({ success: true, cobrancas: cpRows.rows })
        }

        // ── COBRANCAS-CLINICA ──────────────────────────────────────────
        if (route === 'cobrancas-clinica') {
            var ccPage = parseInt(q.page) || 1
            var ccLimit = parseInt(q.limit) || 50
            var ccOffset = (ccPage - 1) * ccLimit
            var ccTotal = await client.execute({ sql: "SELECT COUNT(*) as total FROM cobrancas WHERE clinica_id=?", args: [clinica_id] })
            var ccRows = await client.execute({ sql: "SELECT * FROM cobrancas WHERE clinica_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?", args: [clinica_id, ccLimit, ccOffset] })
            return res.status(200).json({ success: true, cobrancas: ccRows.rows, total: ccTotal.rows[0].total, page: ccPage, limit: ccLimit })
        }

        // ── SINCRONIZAR-COBRANCAS (consulta Asaas e atualiza status) ──
        if (route === 'sincronizar-cobrancas') {
            // Get Asaas API key (try clinic-specific, then env var)
            var scAsaas = await client.execute({ sql: "SELECT asaas_api_key FROM clinicas WHERE id=?", args: [clinica_id] })
            var scApiKey = (scAsaas.rows.length && scAsaas.rows[0].asaas_api_key) ? scAsaas.rows[0].asaas_api_key : (process.env.ASAAS_API_KEY || '')
            if (!scApiKey) return res.status(200).json({ success: false, error: 'Asaas API Key não configurada. Vá em Configurações > Dados da Clínica.' })

            // If specific cobranca_id provided, sync only that one
            var scSingleId = q.cobranca_id ? parseInt(q.cobranca_id) : null
            var scSql = scSingleId
                ? "SELECT id, asaas_id, status, valor FROM cobrancas WHERE id=? AND clinica_id=? AND asaas_id IS NOT NULL AND asaas_id!=''"
                : "SELECT id, asaas_id, status, valor FROM cobrancas WHERE clinica_id=? AND asaas_id IS NOT NULL AND asaas_id!='' AND status IN ('pendente','vencido') ORDER BY created_at DESC LIMIT 50"
            var scArgs = scSingleId ? [scSingleId, clinica_id] : [clinica_id]
            var scPendentes = await client.execute({ sql: scSql, args: scArgs })

            var scAtualizado = 0, scErros = 0, scDetalhes = []
            for (var sci = 0; sci < scPendentes.rows.length; sci++) {
                var scCob = scPendentes.rows[sci]
                try {
                    var scRes = await fetch('https://api.asaas.com/v3/payments/' + scCob.asaas_id, {
                        headers: { 'access_token': scApiKey }
                    })
                    if (!scRes.ok) { scErros++; scDetalhes.push({ asaas_id: scCob.asaas_id, erro: 'HTTP ' + scRes.status }); continue }
                    var scData = await scRes.json()
                    if (scData.errors) { scErros++; scDetalhes.push({ asaas_id: scCob.asaas_id, erro: scData.errors[0] && scData.errors[0].description || 'Asaas error' }); continue }

                    // Map Asaas status to our status
                    var scNovoStatus = null
                    if (scData.status === 'RECEIVED' || scData.status === 'CONFIRMED' || scData.status === 'RECEIVED_IN_CASH' || scData.status === 'BILLING_PROCESS_FINISHED') {
                        scNovoStatus = 'pago'
                    } else if (scData.status === 'OVERDUE') {
                        scNovoStatus = 'vencido'
                    } else if (scData.status === 'REFUNDED' || scData.status === 'DELETED' || scData.status === 'REFUND_REQUESTED' || scData.status === 'REFUND_IN_PROGRESS') {
                        scNovoStatus = 'cancelado'
                    }
                    // PENDING, AWAITING_RISK_ANALYSIS = still pending, no update needed

                    if (scNovoStatus && scNovoStatus !== scCob.status) {
                        await client.execute({ sql: "UPDATE cobrancas SET status=?, data_pagamento=CASE WHEN ?='pago' THEN datetime('now') ELSE data_pagamento END, updated_at=datetime('now') WHERE id=?", args: [scNovoStatus, scNovoStatus, scCob.id] })

                        // Cascade to parcelas
                        try {
                            if (scNovoStatus === 'pago') {
                                await client.execute({ sql: "UPDATE parcelas_orcamento SET status='pago', data_pagamento=datetime('now'), updated_at=datetime('now') WHERE cobranca_id=? AND status!='pago'", args: [scCob.id] })
                                await client.execute({ sql: "UPDATE clinicas SET saldo=saldo+? WHERE id=?", args: [scCob.valor, clinica_id] })
                            } else if (scNovoStatus === 'vencido') {
                                await client.execute({ sql: "UPDATE parcelas_orcamento SET status='vencido', updated_at=datetime('now') WHERE cobranca_id=? AND status='pendente'", args: [scCob.id] })
                            }
                        } catch(ep) {}

                        scAtualizado++
                        scDetalhes.push({ asaas_id: scCob.asaas_id, de: scCob.status, para: scNovoStatus, asaas_status: scData.status })
                    } else {
                        scDetalhes.push({ asaas_id: scCob.asaas_id, status_atual: scCob.status, asaas_status: scData.status, msg: 'sem alteração' })
                    }
                } catch(e) { scErros++; console.error('[sincronizar] Erro asaas_id=' + scCob.asaas_id + ':', e.message) }
            }

            return res.status(200).json({ success: true, verificados: scPendentes.rows.length, atualizados: scAtualizado, erros: scErros, detalhes: scDetalhes })
        }

        // ── SOLICITAR-SAQUE ──────────────────────────────────────────────
        if (route === 'solicitar-saque') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ss = req.body || {}
            var ssValor = parseFloat(ss.valor) || 0
            if (ssValor <= 0) return res.status(400).json({ success: false, error: 'Valor deve ser maior que zero' })

            // Check saldo
            var ssSaldo = await client.execute({ sql: "SELECT saldo, banco_nome, banco_agencia, banco_conta FROM clinicas WHERE id=?", args: [clinica_id] })
            if (!ssSaldo.rows.length) return res.status(404).json({ success: false, error: 'Clínica não encontrada' })
            var ssClinica = ssSaldo.rows[0]
            if ((ssClinica.saldo || 0) < ssValor) return res.status(400).json({ success: false, error: 'Saldo insuficiente. Saldo atual: R$ ' + (ssClinica.saldo || 0).toFixed(2) })

            // Check if first withdrawal today
            var ssToday = await client.execute({ sql: "SELECT COUNT(*) as cnt FROM saques WHERE clinica_id=? AND DATE(created_at)=DATE('now') AND taxa=0", args: [clinica_id] })
            var ssTaxa = (ssToday.rows[0].cnt > 0) ? 2.50 : 0
            var ssLiquido = ssValor - ssTaxa

            if (ssLiquido <= 0) return res.status(400).json({ success: false, error: 'Valor líquido deve ser maior que zero após taxa' })

            // Deduct from saldo
            await client.execute({ sql: "UPDATE clinicas SET saldo = saldo - ? WHERE id=?", args: [ssValor, clinica_id] })

            // Insert saque
            var ssBancoJson = JSON.stringify({ banco: ssClinica.banco_nome || '', agencia: ssClinica.banco_agencia || '', conta: ssClinica.banco_conta || '' })
            var ssIns = await client.execute({
                sql: "INSERT INTO saques(clinica_id, valor, taxa, valor_liquido, status, banco_dados) VALUES(?,?,?,?,?,?)",
                args: [clinica_id, ssValor, ssTaxa, ssLiquido, 'pendente', ssBancoJson]
            })

            return res.status(200).json({ success: true, saque: { id: Number(ssIns.lastInsertRowid), valor: ssValor, taxa: ssTaxa, valor_liquido: ssLiquido, status: 'pendente' } })
        }

        // ── SAQUES-CLINICA ──────────────────────────────────────────────
        if (route === 'saques-clinica') {
            var scRows = await client.execute({ sql: "SELECT * FROM saques WHERE clinica_id=? ORDER BY created_at DESC", args: [clinica_id] })
            return res.status(200).json({ success: true, saques: scRows.rows })
        }

        // ── SALDO-CLINICA ──────────────────────────────────────────────
        if (route === 'saldo-clinica') {
            var slRow = await client.execute({ sql: "SELECT saldo FROM clinicas WHERE id=?", args: [clinica_id] })
            var slSaldo = slRow.rows.length ? (slRow.rows[0].saldo || 0) : 0
            var slToday = await client.execute({ sql: "SELECT COUNT(*) as cnt FROM saques WHERE clinica_id=? AND DATE(created_at)=DATE('now')", args: [clinica_id] })
            var slFree = await client.execute({ sql: "SELECT COUNT(*) as cnt FROM saques WHERE clinica_id=? AND DATE(created_at)=DATE('now') AND taxa=0", args: [clinica_id] })
            return res.status(200).json({ success: true, saldo: slSaldo, saques_hoje: slToday.rows[0].cnt, saque_gratis_usado: slFree.rows[0].cnt > 0 })
        }

        // ── PERMISSOES-MIGRATE ──────────────────────────────────────────
        if (route === 'permissoes-migrate') {
            var pmSummary = { tables: [], seeds: 0 }
            await client.execute("CREATE TABLE IF NOT EXISTS permissoes (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, perfil TEXT NOT NULL, recurso TEXT NOT NULL, permitido INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))")
            pmSummary.tables.push('permissoes: ok')
            try { await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_perm_perfil_recurso ON permissoes(clinica_id, perfil, recurso)") } catch(e) {}

            // Add clinica_id column to usuarios if missing
            try { await client.execute("ALTER TABLE usuarios ADD COLUMN clinica_id INTEGER") } catch(e) {}

            // Clear and reseed all permissions
            await client.execute("DELETE FROM permissoes WHERE clinica_id IS NULL")
            var pmRecursos = [
                // [recurso, admin, dentista, recepcionista, asb, administrativo]
                // ── AGENDA ──
                ['agenda.agendar_atendimento', 1, 1, 1, 0, 0],
                ['agenda.editar_horarios', 1, 1, 1, 0, 0],
                ['agenda.visualizar_classificacao', 1, 1, 1, 1, 1],
                // ── CLINICA ──
                ['clinica.ver', 1, 1, 1, 1, 1],
                // ── CONFIGURACOES ──
                ['configuracoes.acessar', 1, 0, 0, 0, 0],
                ['configuracoes.editar', 1, 0, 0, 0, 0],
                // ── CONTROLE DE CHEQUE ──
                ['cheque.acessar', 1, 0, 0, 0, 1],
                ['cheque.excluir', 1, 0, 0, 0, 0],
                ['cheque.editar_parcelas', 1, 0, 0, 0, 1],
                // ── CONTROLE DE INDICACAO ──
                ['indicacao.acessar', 1, 1, 1, 0, 1],
                ['indicacao.excluir', 1, 0, 0, 0, 0],
                // ── CONTROLE PROTETICO ──
                ['protetico.acessar', 1, 1, 1, 1, 1],
                ['protetico.excluir', 1, 0, 0, 0, 0],
                // ── CRC ──
                ['crc.acessar', 1, 1, 1, 0, 1],
                ['crc.excluir', 1, 0, 0, 0, 0],
                ['crc.agendamento_pacificacao', 1, 1, 1, 0, 0],
                ['crc.enviar_mensagem', 1, 1, 1, 0, 1],
                ['crc.exportar_planilha', 1, 0, 0, 0, 1],
                ['crc.abrir_nova_funcao', 1, 0, 0, 0, 0],
                ['crc.editar', 1, 0, 0, 0, 0],
                ['crc.rejeitar_paciente', 1, 0, 0, 0, 0],
                ['crc.encaminhamento', 1, 1, 1, 0, 0],
                ['crc.exportar_agendamento', 1, 0, 0, 0, 1],
                // ── CRM ──
                ['crm.acessar', 1, 1, 1, 0, 1],
                ['crm.excluir', 1, 0, 0, 0, 0],
                ['crm.acessar_campanha', 1, 0, 0, 0, 1],
                // ── DASHBOARD ANALITICO ──
                ['dashboard.acessar', 1, 1, 0, 0, 1],
                ['dashboard.editar_metas', 1, 0, 0, 0, 0],
                // ── FINANCEIRO ──
                ['financeiro.acessar', 1, 0, 0, 0, 1],
                ['financeiro.excluir', 1, 0, 0, 0, 0],
                ['financeiro.contas', 1, 0, 0, 0, 1],
                ['financeiro.editar_contas', 1, 0, 0, 0, 0],
                ['financeiro.planos', 1, 0, 0, 0, 1],
                ['financeiro.processar_recibo', 1, 0, 0, 0, 1],
                ['financeiro.conta_corrente', 1, 0, 0, 0, 1],
                ['financeiro.controle_cheques', 1, 0, 0, 0, 1],
                ['financeiro.editar_cheques', 1, 0, 0, 0, 0],
                ['financeiro.controle_cartoes', 1, 0, 0, 0, 1],
                ['financeiro.editar_cartoes', 1, 0, 0, 0, 0],
                ['financeiro.editar_parcelas', 1, 0, 0, 0, 0],
                ['financeiro.controle_boletos', 1, 0, 0, 0, 1],
                ['financeiro.controle_planos', 1, 0, 0, 0, 1],
                ['financeiro.fluxo_caixa', 1, 0, 0, 0, 1],
                ['financeiro.parcela_avulsa', 1, 0, 0, 0, 0],
                ['financeiro.dre', 1, 0, 0, 0, 0],
                ['financeiro.comissoes', 1, 0, 0, 0, 1],
                ['financeiro.dar_baixa', 1, 0, 0, 0, 1],
                ['financeiro.conciliacoes', 1, 0, 0, 0, 0],
                ['financeiro.receita_saude', 1, 1, 0, 0, 1],
                // ── GERENCIAR CONTAS ──
                ['gerenciar_contas.acessar', 1, 0, 0, 0, 1],
                ['gerenciar_contas.editar', 1, 0, 0, 0, 0],
                ['gerenciar_contas.importacao', 1, 0, 0, 0, 0],
                ['gerenciar_contas.excluir_relatorio', 1, 0, 0, 0, 0],
                // ── MARKETPLACE ──
                ['marketplace.acessar', 1, 0, 0, 0, 0],
                ['marketplace.exclusao_grupos', 1, 0, 0, 0, 0],
                // ── METAS ──
                ['metas.acessar', 1, 1, 0, 0, 1],
                ['metas.editar', 1, 0, 0, 0, 0],
                // ── PACIENTES ──
                ['pacientes.acessar', 1, 1, 1, 1, 1],
                ['pacientes.agendamentos', 1, 1, 1, 0, 1],
                ['pacientes.prontuario', 1, 1, 1, 1, 0],
                ['pacientes.orcamentos', 1, 1, 1, 0, 0],
                ['pacientes.editar_orcamento', 1, 1, 0, 0, 0],
                ['pacientes.financeiro', 1, 0, 0, 0, 1],
                ['pacientes.fotos', 1, 1, 1, 1, 0],
                ['pacientes.emissao_relatorio', 1, 0, 0, 0, 1],
                ['pacientes.atendimento_recepcao', 1, 0, 1, 0, 0],
                ['pacientes.exportar', 1, 0, 0, 0, 1],
                ['pacientes.prescricoes', 1, 1, 0, 0, 0],
                ['pacientes.recibos', 1, 1, 0, 0, 1],
                ['pacientes.documentos', 1, 1, 1, 1, 1],
                ['pacientes.anamnese', 1, 1, 1, 0, 0],
                ['pacientes.odontograma', 1, 1, 0, 0, 0],
                ['pacientes.ficha_clinica', 1, 1, 0, 0, 0],
                ['pacientes.exames', 1, 1, 1, 1, 0],
                ['pacientes.indicacoes', 1, 1, 1, 0, 1],
                ['pacientes.editar_cadastro', 1, 1, 1, 0, 1],
                ['pacientes.excluir', 1, 0, 0, 0, 0],
                ['pacientes.gerar_procedimentos', 1, 1, 0, 0, 0],
                // ── PLANO DE RECORRENCIA ──
                ['recorrencia.acessar', 1, 0, 0, 0, 1],
                ['recorrencia.editar', 1, 0, 0, 0, 0],
                ['recorrencia.editar_config', 1, 0, 0, 0, 0],
                // ── PORTAL DO ASSINANTE ──
                ['portal.acessar', 1, 0, 0, 0, 0],
                ['portal.editar', 1, 0, 0, 0, 0],
                // ── PROFISSIONAIS ──
                ['profissionais.acessar', 1, 1, 1, 0, 1],
                ['profissionais.editar', 1, 0, 0, 0, 0],
                // ── RELATORIOS ──
                ['relatorios.acessar', 1, 1, 0, 0, 1],
                ['relatorios.editar', 1, 0, 0, 0, 0],
                ['relatorios.agendamentos_retornos', 1, 1, 0, 0, 1],
                ['relatorios.agendamentos_cadastros', 1, 1, 0, 0, 1],
                ['relatorios.agendamentos_desc', 1, 1, 0, 0, 1],
                ['relatorios.agendamentos_atendidos', 1, 1, 0, 0, 1],
                ['relatorios.agendamentos_faltas', 1, 1, 0, 0, 1],
                ['relatorios.agendamentos_geral', 1, 1, 0, 0, 1],
                ['relatorios.agendamentos_movimentacao', 1, 1, 0, 0, 1],
                ['relatorios.agendamentos_marcacoes', 1, 1, 0, 0, 1],
                ['relatorios.agendamentos_confirmacoes', 1, 1, 0, 0, 1],
                ['relatorios.procedimentos_agendados', 1, 1, 0, 0, 1],
                ['relatorios.procedimentos_evolucao', 1, 1, 0, 0, 1],
                ['relatorios.procedimentos_credito_debito', 1, 0, 0, 0, 1],
                ['relatorios.procedimentos_falta_cancel', 1, 1, 0, 0, 1],
                ['relatorios.financeiro_cpf', 1, 0, 0, 0, 1],
                ['relatorios.financeiro_liquidez', 1, 0, 0, 0, 0],
                ['relatorios.financeiro_pagamentos', 1, 0, 0, 0, 1],
                ['relatorios.procedimentos_retornos', 1, 1, 0, 0, 1],
                ['relatorios.procedimentos_modalidade', 1, 1, 0, 0, 1],
                ['relatorios.orcamentos', 1, 1, 0, 0, 1],
                ['relatorios.orcamentos_aprovados', 1, 1, 0, 0, 1],
                ['relatorios.comissoes', 1, 0, 0, 0, 1],
                ['relatorios.producao', 1, 1, 0, 0, 1],
                // ── ESTOQUE ──
                ['estoque.acessar', 1, 0, 1, 1, 1],
                ['estoque.editar', 1, 0, 0, 0, 1],
                // ── MARKETING ──
                ['marketing.acessar', 1, 0, 1, 0, 1],
                ['marketing.editar', 1, 0, 0, 0, 0],
                // ── USUARIOS E PERMISSOES ──
                ['usuarios.acessar', 1, 0, 0, 0, 0],
                ['usuarios.modificar_senhas', 1, 0, 0, 0, 0],
                ['usuarios.trocar_perfil', 1, 0, 0, 0, 0],
            ]
            var pmPerfis = ['admin', 'dentista', 'recepcionista', 'asb', 'administrativo']
            for (var pri = 0; pri < pmRecursos.length; pri++) {
                var pmR = pmRecursos[pri]
                for (var ppi = 0; ppi < pmPerfis.length; ppi++) {
                    await client.execute({ sql: "INSERT OR IGNORE INTO permissoes(clinica_id, perfil, recurso, permitido) VALUES(NULL,?,?,?)", args: [pmPerfis[ppi], pmR[0], pmR[1 + ppi]] })
                    pmSummary.seeds++
                }
            }
            return res.status(200).json({ success: true, summary: pmSummary })
        }

        // ── PERMISSOES-PERFIL (GET permissões de um perfil) ──────────
        if (route === 'permissoes-perfil') {
            var ppPerfil = q.perfil || 'recepcionista'
            var ppRows = await client.execute({
                sql: "SELECT recurso, permitido FROM permissoes WHERE (clinica_id IS NULL OR clinica_id=?) AND perfil=? ORDER BY recurso",
                args: [clinica_id, ppPerfil]
            })
            // Clinic-specific overrides global
            var ppMap = {}
            ppRows.rows.forEach(function(r) { ppMap[r.recurso] = r.permitido })
            return res.status(200).json({ success: true, perfil: ppPerfil, permissoes: ppMap })
        }

        // ── PERMISSOES-SALVAR (POST save permissions for a profile) ──
        if (route === 'permissoes-salvar') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ps = req.body || {}
            if (!ps.perfil || !ps.permissoes) return res.status(400).json({ success: false, error: 'perfil e permissoes obrigatórios' })

            var psPerm = ps.permissoes // { recurso: 0|1, ... }
            for (var psRecurso in psPerm) {
                // Upsert: try update, then insert
                var psUpd = await client.execute({ sql: "UPDATE permissoes SET permitido=? WHERE clinica_id=? AND perfil=? AND recurso=?", args: [psPerm[psRecurso] ? 1 : 0, clinica_id, ps.perfil, psRecurso] })
                if (!psUpd.rowsAffected) {
                    await client.execute({ sql: "INSERT OR IGNORE INTO permissoes(clinica_id, perfil, recurso, permitido) VALUES(?,?,?,?)", args: [clinica_id, ps.perfil, psRecurso, psPerm[psRecurso] ? 1 : 0] })
                }
            }
            return res.status(200).json({ success: true, msg: 'Permissões salvas para ' + ps.perfil })
        }

        // ── PERMISSOES-USUARIO (GET permissões do usuário logado) ────
        if (route === 'permissoes-usuario') {
            var puRows = await client.execute({
                sql: "SELECT recurso, permitido FROM permissoes WHERE (clinica_id IS NULL OR clinica_id=?) AND perfil=? ORDER BY recurso",
                args: [clinica_id, auth.perfil]
            })
            var puMap = {}
            puRows.rows.forEach(function(r) { puMap[r.recurso] = r.permitido })
            return res.status(200).json({ success: true, perfil: auth.perfil, permissoes: puMap })
        }

        // ── COMISSOES-MIGRATE ──────────────────────────────────────────
        if (route === 'comissoes-migrate') {
            var cmSummary = { tables: [] }
            await client.execute("CREATE TABLE IF NOT EXISTS comissoes_config (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, profissional_id INTEGER, tabela_preco TEXT DEFAULT 'PARTICULAR', momento TEXT NOT NULL, tipo TEXT NOT NULL, valor REAL NOT NULL, valido_desde TEXT, valido_ate TEXT, editado_por TEXT, created_at TEXT DEFAULT (datetime('now')))")
            cmSummary.tables.push('comissoes_config: ok')
            await client.execute("CREATE TABLE IF NOT EXISTS comissoes_lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, profissional_id INTEGER, profissional_nome TEXT, orcamento_id INTEGER, orcamento_item_id INTEGER, paciente_id INTEGER, paciente_nome TEXT, procedimento_nome TEXT, tabela_preco TEXT, momento TEXT, tipo TEXT, valor_base REAL, percentual REAL, valor_comissao REAL, status TEXT DEFAULT 'pendente', data_referencia TEXT, data_pagamento TEXT, created_at TEXT DEFAULT (datetime('now')))")
            cmSummary.tables.push('comissoes_lancamentos: ok')
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_com_config_prof ON comissoes_config(profissional_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_com_lanc_prof ON comissoes_lancamentos(profissional_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_com_lanc_orc ON comissoes_lancamentos(orcamento_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_com_lanc_clinica ON comissoes_lancamentos(clinica_id)") } catch(e) {}
            return res.status(200).json({ success: true, summary: cmSummary })
        }

        // ── COMISSOES-CONFIG (CRUD) ──────────────────────────────────
        if (route === 'comissoes-config') {
            if (req.method === 'POST') {
                var cc = req.body || {}
                if (!cc.profissional_id || !cc.momento || !cc.tipo || cc.valor === undefined) return res.status(400).json({ success: false, error: 'profissional_id, momento, tipo e valor obrigatórios' })
                if (cc.id) {
                    await client.execute({ sql: "UPDATE comissoes_config SET tabela_preco=?, momento=?, tipo=?, valor=?, valido_desde=?, valido_ate=?, editado_por=? WHERE id=? AND clinica_id=?", args: [cc.tabela_preco || 'PARTICULAR', cc.momento, cc.tipo, parseFloat(cc.valor), cc.valido_desde || '', cc.valido_ate || '', cc.editado_por || '', cc.id, clinica_id] })
                    return res.status(200).json({ success: true, msg: 'Regra atualizada' })
                }
                var ccIns = await client.execute({ sql: "INSERT INTO comissoes_config(clinica_id, profissional_id, tabela_preco, momento, tipo, valor, valido_desde, valido_ate, editado_por) VALUES(?,?,?,?,?,?,?,?,?)", args: [clinica_id, cc.profissional_id, cc.tabela_preco || 'PARTICULAR', cc.momento, cc.tipo, parseFloat(cc.valor), cc.valido_desde || '', cc.valido_ate || '', cc.editado_por || ''] })
                return res.status(200).json({ success: true, id: Number(ccIns.lastInsertRowid) })
            }
            if (req.method === 'DELETE' || (req.method === 'POST' && (req.body || {}).action === 'delete')) {
                var ccd = req.body || {}; var ccdId = ccd.id || parseInt(q.id) || 0
                if (!ccdId) return res.status(400).json({ success: false, error: 'id obrigatório' })
                await client.execute({ sql: "DELETE FROM comissoes_config WHERE id=? AND clinica_id=?", args: [ccdId, clinica_id] })
                return res.status(200).json({ success: true, msg: 'Regra excluída' })
            }
            // GET
            var ccProfId = parseInt(q.profissional_id) || 0
            var ccW = ["clinica_id=?"], ccA = [clinica_id]
            if (ccProfId) { ccW.push("profissional_id=?"); ccA.push(ccProfId) }
            var ccRows = await client.execute({ sql: "SELECT cc.*, p.nome as profissional_nome FROM comissoes_config cc LEFT JOIN profissionais p ON p.id=cc.profissional_id WHERE " + ccW.join(' AND ') + " ORDER BY cc.profissional_id, cc.tabela_preco", args: ccA })
            return res.status(200).json({ success: true, configs: ccRows.rows })
        }

        // ── COMISSOES-PROFISSIONAL (lista lançamentos) ──────────────
        if (route === 'comissoes-profissional') {
            var cpProfId = parseInt(q.profissional_id) || 0
            if (!cpProfId) return res.status(400).json({ success: false, error: 'profissional_id obrigatório' })
            var cpW = ["clinica_id=?", "profissional_id=?"], cpA = [clinica_id, cpProfId]
            if (q.status && q.status !== 'todas') { cpW.push("status=?"); cpA.push(q.status) }
            if (q.de) { cpW.push("data_referencia>=?"); cpA.push(q.de) }
            if (q.ate) { cpW.push("data_referencia<=?"); cpA.push(q.ate) }
            if (!q.de && !q.ate && q.mes) { cpW.push("strftime('%Y-%m',data_referencia)=?"); cpA.push(q.mes) }
            var cpRows = await client.execute({ sql: "SELECT * FROM comissoes_lancamentos WHERE " + cpW.join(' AND ') + " ORDER BY data_referencia DESC", args: cpA })
            var cpTotais = { pendente: 0, pago: 0, cancelado: 0 }
            cpRows.rows.forEach(function(r) { if (cpTotais[r.status] !== undefined) cpTotais[r.status] += r.valor_comissao })
            return res.status(200).json({ success: true, comissoes: cpRows.rows, totais: cpTotais })
        }

        // ── COMISSOES-PAGAR (dar baixa) ──────────────────────────────
        if (route === 'comissoes-pagar') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var cpg = req.body || {}
            var cpgData = cpg.data_pagamento || new Date().toISOString().slice(0, 10)
            if (cpg.ids && cpg.ids.length) {
                // Batch pay
                for (var cpi = 0; cpi < cpg.ids.length; cpi++) {
                    await client.execute({ sql: "UPDATE comissoes_lancamentos SET status='pago', data_pagamento=? WHERE id=? AND clinica_id=?", args: [cpgData, cpg.ids[cpi], clinica_id] })
                }
                // Create lancamento for total
                var cpgTotal = await client.execute({ sql: "SELECT SUM(valor_comissao) as total, profissional_nome FROM comissoes_lancamentos WHERE id IN (" + cpg.ids.map(function() { return '?' }).join(',') + ")", args: cpg.ids })
                if (cpgTotal.rows.length && cpgTotal.rows[0].total) {
                    try {
                        await client.execute({ sql: "INSERT INTO lancamentos(clinica_id, data, tipo, descricao, valor, classificacao, categoria, status) VALUES(?,?,?,?,?,?,?,?)", args: [clinica_id, cpgData, 'Saída', 'Comissão - ' + (cpgTotal.rows[0].profissional_nome || ''), cpgTotal.rows[0].total, 'Custo Variável', 'Comissão Profissionais', 'realizado'] })
                    } catch(e) {}
                }
                return res.status(200).json({ success: true, msg: cpg.ids.length + ' comissões pagas' })
            }
            if (cpg.id) {
                await client.execute({ sql: "UPDATE comissoes_lancamentos SET status='pago', data_pagamento=? WHERE id=? AND clinica_id=?", args: [cpgData, cpg.id, clinica_id] })
                return res.status(200).json({ success: true, msg: 'Comissão paga' })
            }
            return res.status(400).json({ success: false, error: 'id ou ids obrigatório' })
        }

        // ── COMISSOES-RELATORIO ──────────────────────────────────────
        if (route === 'comissoes-relatorio') {
            var crMes = q.mes || new Date().toISOString().slice(0, 7)
            var crRows = await client.execute({
                sql: "SELECT cl.profissional_id, cl.profissional_nome, cl.status, SUM(cl.valor_comissao) as total, COUNT(*) as qtd FROM comissoes_lancamentos cl WHERE cl.clinica_id=? AND strftime('%Y-%m',cl.data_referencia)=? GROUP BY cl.profissional_id, cl.status ORDER BY cl.profissional_nome",
                args: [clinica_id, crMes]
            })
            return res.status(200).json({ success: true, mes: crMes, dados: crRows.rows })
        }

        // ── MARCAR-EXECUTADO (procedimento) ──────────────────────────
        if (route === 'marcar-executado') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var me = req.body || {}
            if (!me.orcamento_item_id) return res.status(400).json({ success: false, error: 'orcamento_item_id obrigatório' })
            var meData = me.data_execucao || new Date().toISOString().slice(0, 10)

            // Update item (including professional if provided)
            if (me.profissional_id) {
                await client.execute({ sql: "UPDATE orcamento_itens SET executado=1, data_execucao=?, profissional_id=?, profissional_nome=? WHERE id=?", args: [meData, me.profissional_id, me.profissional_nome || '', me.orcamento_item_id] })
            } else {
                await client.execute({ sql: "UPDATE orcamento_itens SET executado=1, data_execucao=? WHERE id=?", args: [meData, me.orcamento_item_id] })
            }

            // Get item + orcamento info for commission
            var meItem = await client.execute({ sql: "SELECT oi.*, o.tabela_preco, o.paciente_id, p.nome as paciente_nome FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id LEFT JOIN pacientes p ON p.id=o.paciente_id WHERE oi.id=?", args: [me.orcamento_item_id] })
            if (meItem.rows.length) {
                var meI = meItem.rows[0]
                var meProfId = me.profissional_id || meI.profissional_id
                if (meProfId) {
                    // Check for execution commission rule
                    var meConfig = await client.execute({ sql: "SELECT * FROM comissoes_config WHERE profissional_id=? AND momento='execucao' AND (tabela_preco=? OR tabela_preco='TODAS') AND clinica_id=? ORDER BY tabela_preco='TODAS' LIMIT 1", args: [meProfId, meI.tabela_preco || 'PARTICULAR', clinica_id] })
                    if (meConfig.rows.length) {
                        var meR = meConfig.rows[0]
                        var meValBase = meI.valor_unitario * (meI.quantidade || 1)
                        var meValCom = meR.tipo === 'percentual' ? meValBase * meR.valor / 100 : meR.valor
                        var meProfNome = meI.profissional_nome || ''
                        if (!meProfNome) { var mePn = await client.execute({ sql: "SELECT nome FROM profissionais WHERE id=?", args: [meProfId] }); if (mePn.rows.length) meProfNome = mePn.rows[0].nome }
                        await client.execute({
                            sql: "INSERT INTO comissoes_lancamentos(clinica_id, profissional_id, profissional_nome, orcamento_id, orcamento_item_id, paciente_id, paciente_nome, procedimento_nome, tabela_preco, momento, tipo, valor_base, percentual, valor_comissao, data_referencia) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            args: [clinica_id, meProfId, meProfNome, meI.orcamento_id, me.orcamento_item_id, meI.paciente_id, meI.paciente_nome || '', meI.procedimento_nome, meI.tabela_preco || 'PARTICULAR', 'execucao', meR.tipo, meValBase, meR.tipo === 'percentual' ? meR.valor : null, meValCom, meData]
                        })
                    }
                }
            }
            return res.status(200).json({ success: true, msg: 'Procedimento marcado como executado' })
        }

        // ── EDITAR-EXECUCAO ──────────────────────────────────────────
        if (route === 'editar-execucao') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ee = req.body || {}
            if (!ee.orcamento_item_id) return res.status(400).json({ success: false, error: 'orcamento_item_id obrigatório' })
            // Check permission
            if (auth.perfil !== 'admin' && auth.perfil !== 'dentista') {
                try {
                    var eePerm = await verificarPermissao(client, clinica_id, auth.perfil, 'prontuario.editar')
                    if (!eePerm) return res.status(403).json({ success: false, error: 'Sem permissão para editar procedimentos executados' })
                } catch(e) {}
            }
            await client.execute({
                sql: "UPDATE orcamento_itens SET data_execucao=?, profissional_id=?, profissional_nome=? WHERE id=?",
                args: [ee.data_execucao || new Date().toISOString().slice(0, 10), ee.profissional_id || null, ee.profissional_nome || '', ee.orcamento_item_id]
            })
            return res.status(200).json({ success: true, msg: 'Execução atualizada' })
        }

        // ── DESFAZER-EXECUCAO ──────────────────────────────────────────
        if (route === 'desfazer-execucao') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var de2 = req.body || {}
            if (!de2.orcamento_item_id) return res.status(400).json({ success: false, error: 'orcamento_item_id obrigatório' })
            // Check permission
            if (auth.perfil !== 'admin' && auth.perfil !== 'dentista') {
                try {
                    var dePerm = await verificarPermissao(client, clinica_id, auth.perfil, 'prontuario.editar')
                    if (!dePerm) return res.status(403).json({ success: false, error: 'Sem permissão para desfazer execuções' })
                } catch(e) {}
            }
            await client.execute({ sql: "UPDATE orcamento_itens SET executado=0, data_execucao=NULL WHERE id=?", args: [de2.orcamento_item_id] })
            // Cancel related commission
            try { await client.execute({ sql: "UPDATE comissoes_lancamentos SET status='cancelado' WHERE orcamento_item_id=? AND momento='execucao' AND status='pendente'", args: [de2.orcamento_item_id] }) } catch(e) {}
            return res.status(200).json({ success: true, msg: 'Execução desfeita' })
        }

        // ── DASHBOARD-FINANCEIRO ──────────────────────────────────────
        if (route === 'dashboard-financeiro') {
            var dfHoje = new Date().toISOString().slice(0, 10)
            var dfMes = new Date().toISOString().slice(0, 7)
            var dfProx30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

            // Receita do mês (parcelas pagas + lancamentos + financeiro)
            var dfRecParc = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM parcelas_orcamento WHERE strftime('%Y-%m',data_pagamento)=? AND status='pago' AND clinica_id=?", args: [dfMes, clinica_id] })
            var dfRecLanc = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND tipo IN ('Vendas','Entrada') AND status='realizado' AND clinica_id=?", args: [dfMes, clinica_id] })
            var dfRecFin = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada' AND clinica_id=?", args: [dfMes, clinica_id] })
            var receitaMes = (dfRecParc.rows[0].total || 0) + (dfRecLanc.rows[0].total || 0) + (dfRecFin.rows[0].total || 0)

            // Despesas do mês
            var dfDespLanc = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND tipo='Saída' AND status='realizado' AND clinica_id=?", args: [dfMes, clinica_id] })
            var dfDespFin = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='saida' AND clinica_id=?", args: [dfMes, clinica_id] })
            var dfDespCP = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE strftime('%Y-%m',pagamento)=? AND status='paga' AND clinica_id=?", args: [dfMes, clinica_id] })
            var despesasMes = (dfDespLanc.rows[0].total || 0) + (dfDespFin.rows[0].total || 0) + (dfDespCP.rows[0].total || 0)

            // Parcelas vencidas (inadimplência)
            var dfVencidas = await client.execute({ sql: "SELECT COUNT(*) as qtd, COALESCE(SUM(valor),0) as total FROM parcelas_orcamento WHERE status='vencido' AND clinica_id=?", args: [clinica_id] })

            // Contas a pagar vencidas
            var dfCPVenc = await client.execute({ sql: "SELECT COUNT(*) as qtd, COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE status='vencida' AND clinica_id=?", args: [clinica_id] })

            // A receber próximos 30 dias
            var dfAReceber = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total, COUNT(*) as qtd FROM parcelas_orcamento WHERE data_vencimento >= ? AND data_vencimento <= ? AND status='pendente' AND clinica_id=?", args: [dfHoje, dfProx30, clinica_id] })

            // A pagar próximos 30 dias
            var dfAPagar = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total, COUNT(*) as qtd FROM contas_pagar WHERE vencimento >= ? AND vencimento <= ? AND status='aberta' AND clinica_id=?", args: [dfHoje, dfProx30, clinica_id] })

            return res.status(200).json({
                success: true,
                receita_mes: receitaMes,
                despesas_mes: despesasMes,
                resultado_mes: receitaMes - despesasMes,
                inadimplencia: { qtd: dfVencidas.rows[0].qtd, valor: dfVencidas.rows[0].total },
                contas_vencidas: { qtd: dfCPVenc.rows[0].qtd, valor: dfCPVenc.rows[0].total },
                projecao_30d: {
                    a_receber: dfAReceber.rows[0].total, a_receber_qtd: dfAReceber.rows[0].qtd,
                    a_pagar: dfAPagar.rows[0].total, a_pagar_qtd: dfAPagar.rows[0].qtd,
                    saldo_projetado: receitaMes - despesasMes + (dfAReceber.rows[0].total || 0) - (dfAPagar.rows[0].total || 0)
                }
            })
        }

        // ── GERAR-RECORRENTES ──────────────────────────────────────────
        if (route === 'gerar-recorrentes') {
            var grHoje = new Date()
            var grProxMes = new Date(grHoje.getFullYear(), grHoje.getMonth() + 1, 1)
            var grProxMesStr = grProxMes.toISOString().slice(0, 7)

            // Find recorrente contas_pagar where last parcela_atual < total_parcelas
            var grContas = await client.execute({
                sql: "SELECT cp.*, MAX(cp2.vencimento) as ultimo_venc FROM contas_pagar cp LEFT JOIN contas_pagar cp2 ON cp2.descricao=cp.descricao AND cp2.clinica_id=cp.clinica_id AND cp2.recorrente=1 WHERE cp.recorrente=1 AND cp.clinica_id=? GROUP BY cp.descricao HAVING NOT EXISTS (SELECT 1 FROM contas_pagar x WHERE x.descricao=cp.descricao AND x.clinica_id=cp.clinica_id AND strftime('%Y-%m',x.vencimento)=?)",
                args: [clinica_id, grProxMesStr]
            })

            var grCriadas = 0
            for (var gri = 0; gri < grContas.rows.length; gri++) {
                var grC = grContas.rows[gri]
                // Calculate next due date
                var grUlt = grC.ultimo_venc ? new Date(grC.ultimo_venc + 'T12:00:00') : new Date(grC.vencimento + 'T12:00:00')
                var grNext = new Date(grUlt)
                if (grC.frequencia === 'semanal') grNext.setDate(grNext.getDate() + 7)
                else if (grC.frequencia === 'quinzenal') grNext.setDate(grNext.getDate() + 15)
                else grNext.setMonth(grNext.getMonth() + 1)

                var grNextStr = grNext.toISOString().slice(0, 10)
                var grNewParcela = (grC.parcela_atual || 1) + 1

                if (grC.total_parcelas && grNewParcela > grC.total_parcelas) continue

                await client.execute({
                    sql: "INSERT INTO contas_pagar(clinica_id, descricao, fornecedor, valor, vencimento, classificacao, categoria, categoria_id, recorrente, frequencia, total_parcelas, parcela_atual, status) VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?)",
                    args: [clinica_id, grC.descricao, grC.fornecedor || '', grC.valor, grNextStr, grC.classificacao || '', grC.categoria || '', grC.categoria_id || null, grC.frequencia || 'mensal', grC.total_parcelas || 0, grNewParcela, 'aberta']
                })
                grCriadas++
            }

            return res.status(200).json({ success: true, contas_criadas: grCriadas })
        }

        // ── FINANCEIRO-MIGRATE-V3 (conciliação + receita saúde) ──────
        if (route === 'financeiro-migrate-v3') {
            var fm3Summary = { tables: [] }

            await client.execute("CREATE TABLE IF NOT EXISTS conciliacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, descricao TEXT, periodo_de TEXT, periodo_ate TEXT, status TEXT DEFAULT 'pendente', total_itens INTEGER DEFAULT 0, total_conciliados INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))")
            fm3Summary.tables.push('conciliacoes: ok')

            await client.execute("CREATE TABLE IF NOT EXISTS conciliacao_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, conciliacao_id INTEGER, data TEXT, descricao TEXT, valor REAL, tipo TEXT, lancamento_id INTEGER, status TEXT DEFAULT 'pendente', created_at TEXT DEFAULT (datetime('now')))")
            fm3Summary.tables.push('conciliacao_itens: ok')

            await client.execute("CREATE TABLE IF NOT EXISTS receitas_saude (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, profissional_id INTEGER, orcamento_id INTEGER, valor REAL NOT NULL, data_emissao TEXT, numero_recibo TEXT, cpf_paciente TEXT, nome_paciente TEXT, cpf_profissional TEXT, nome_profissional TEXT, cro_profissional TEXT, descricao_servico TEXT, tipo TEXT DEFAULT 'recibo', status TEXT DEFAULT 'rascunho', created_at TEXT DEFAULT (datetime('now')))")
            try { await client.execute("ALTER TABLE receitas_saude ADD COLUMN tipo TEXT DEFAULT 'recibo'") } catch(e) {}
            fm3Summary.tables.push('receitas_saude: ok')

            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_conc_clinica ON conciliacoes(clinica_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_conc_itens_conc ON conciliacao_itens(conciliacao_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_rec_saude_clinica ON receitas_saude(clinica_id)") } catch(e) {}

            return res.status(200).json({ success: true, summary: fm3Summary })
        }

        // ── CONCILIACAO-IMPORTAR (CSV) ──────────────────────────────
        if (route === 'conciliacao-importar') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var ci = req.body || {}
            if (!ci.itens || !ci.itens.length) return res.status(400).json({ success: false, error: 'itens obrigatórios (array de {data, descricao, valor, tipo})' })

            // Create conciliacao header
            var ciDatas = ci.itens.map(function(i) { return i.data || '' }).filter(Boolean).sort()
            var ciIns = await client.execute({
                sql: "INSERT INTO conciliacoes(clinica_id, descricao, periodo_de, periodo_ate, total_itens) VALUES(?,?,?,?,?)",
                args: [clinica_id, ci.descricao || 'Importação ' + new Date().toISOString().slice(0, 10), ciDatas[0] || '', ciDatas[ciDatas.length - 1] || '', ci.itens.length]
            })
            var ciId = Number(ciIns.lastInsertRowid)

            // Insert items
            for (var cii = 0; cii < ci.itens.length; cii++) {
                var item = ci.itens[cii]
                await client.execute({
                    sql: "INSERT INTO conciliacao_itens(conciliacao_id, data, descricao, valor, tipo, status) VALUES(?,?,?,?,?,?)",
                    args: [ciId, item.data || '', item.descricao || '', parseFloat(item.valor) || 0, item.tipo || (parseFloat(item.valor) >= 0 ? 'credito' : 'debito'), 'pendente']
                })
            }

            // Auto-match: try to find lancamentos/financeiro with same date and value
            var ciItens = await client.execute({ sql: "SELECT * FROM conciliacao_itens WHERE conciliacao_id=?", args: [ciId] })
            var ciMatched = 0
            for (var cim = 0; cim < ciItens.rows.length; cim++) {
                var cItem = ciItens.rows[cim]
                var absVal = Math.abs(cItem.valor)
                // Try financeiro table
                var matchFin = await client.execute({
                    sql: "SELECT id FROM financeiro WHERE data_pagamento=? AND ABS(valor - ?) < 0.01 AND clinica_id=? LIMIT 1",
                    args: [cItem.data, absVal, clinica_id]
                })
                if (matchFin.rows.length) {
                    await client.execute({ sql: "UPDATE conciliacao_itens SET status='conciliado', lancamento_id=? WHERE id=?", args: [matchFin.rows[0].id, cItem.id] })
                    ciMatched++
                    continue
                }
                // Try lancamentos table
                var matchLanc = await client.execute({
                    sql: "SELECT id FROM lancamentos WHERE data=? AND ABS(valor - ?) < 0.01 AND clinica_id=? LIMIT 1",
                    args: [cItem.data, absVal, clinica_id]
                })
                if (matchLanc.rows.length) {
                    await client.execute({ sql: "UPDATE conciliacao_itens SET status='conciliado', lancamento_id=? WHERE id=?", args: [matchLanc.rows[0].id, cItem.id] })
                    ciMatched++
                }
            }

            await client.execute({ sql: "UPDATE conciliacoes SET total_conciliados=?, status=? WHERE id=?", args: [ciMatched, ciMatched === ci.itens.length ? 'concluida' : 'parcial', ciId] })

            return res.status(200).json({ success: true, conciliacao_id: ciId, total: ci.itens.length, conciliados: ciMatched })
        }

        // ── CONCILIACOES-LISTAR ──────────────────────────────────────
        if (route === 'conciliacoes-listar') {
            var clRows = await client.execute({ sql: "SELECT * FROM conciliacoes WHERE clinica_id=? ORDER BY created_at DESC LIMIT 50", args: [clinica_id] })
            return res.status(200).json({ success: true, conciliacoes: clRows.rows })
        }

        // ── CONCILIACAO-ITENS ──────────────────────────────────────────
        if (route === 'conciliacao-itens') {
            var cqId = parseInt(q.conciliacao_id) || 0
            if (!cqId) return res.status(400).json({ success: false, error: 'conciliacao_id obrigatório' })
            var cqRows = await client.execute({ sql: "SELECT * FROM conciliacao_itens WHERE conciliacao_id=? ORDER BY data ASC", args: [cqId] })
            return res.status(200).json({ success: true, itens: cqRows.rows })
        }

        // ── CONCILIACAO-CONCILIAR (manual match) ────────────────────
        if (route === 'conciliacao-conciliar') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var cc = req.body || {}
            if (!cc.item_id) return res.status(400).json({ success: false, error: 'item_id obrigatório' })
            var ccStatus = cc.action === 'ignorar' ? 'ignorado' : 'conciliado'
            await client.execute({ sql: "UPDATE conciliacao_itens SET status=?, lancamento_id=? WHERE id=?", args: [ccStatus, cc.lancamento_id || null, cc.item_id] })
            // Update totals
            var ccItem = await client.execute({ sql: "SELECT conciliacao_id FROM conciliacao_itens WHERE id=?", args: [cc.item_id] })
            if (ccItem.rows.length) {
                var ccConcId = ccItem.rows[0].conciliacao_id
                var ccTot = await client.execute({ sql: "SELECT COUNT(*) as total, SUM(CASE WHEN status IN ('conciliado','ignorado') THEN 1 ELSE 0 END) as done FROM conciliacao_itens WHERE conciliacao_id=?", args: [ccConcId] })
                var ccDone = ccTot.rows[0].done || 0, ccTotal = ccTot.rows[0].total || 0
                await client.execute({ sql: "UPDATE conciliacoes SET total_conciliados=?, status=? WHERE id=?", args: [ccDone, ccDone >= ccTotal ? 'concluida' : 'parcial', ccConcId] })
            }
            return res.status(200).json({ success: true, msg: 'Item ' + ccStatus })
        }

        // ── RECEITAS-SAUDE (CRUD) ──────────────────────────────────
        if (route === 'receitas-saude') {
            if (req.method === 'POST') {
                var rs = req.body || {}
                if (rs.id) {
                    // Update
                    await client.execute({
                        sql: "UPDATE receitas_saude SET paciente_id=?, profissional_id=?, orcamento_id=?, valor=?, data_emissao=?, numero_recibo=?, cpf_paciente=?, nome_paciente=?, cpf_profissional=?, nome_profissional=?, cro_profissional=?, descricao_servico=?, tipo=?, status=? WHERE id=? AND clinica_id=?",
                        args: [rs.paciente_id || null, rs.profissional_id || null, rs.orcamento_id || null, parseFloat(rs.valor) || 0, rs.data_emissao || '', rs.numero_recibo || '', rs.cpf_paciente || '', rs.nome_paciente || '', rs.cpf_profissional || '', rs.nome_profissional || '', rs.cro_profissional || '', rs.descricao_servico || '', rs.tipo || 'recibo', rs.status || 'rascunho', rs.id, clinica_id]
                    })
                    return res.status(200).json({ success: true, msg: 'Recibo atualizado' })
                }
                // Create
                var rsIns = await client.execute({
                    sql: "INSERT INTO receitas_saude(clinica_id, paciente_id, profissional_id, orcamento_id, valor, data_emissao, numero_recibo, cpf_paciente, nome_paciente, cpf_profissional, nome_profissional, cro_profissional, descricao_servico, tipo, status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    args: [clinica_id, rs.paciente_id || null, rs.profissional_id || null, rs.orcamento_id || null, parseFloat(rs.valor) || 0, rs.data_emissao || new Date().toISOString().slice(0, 10), rs.numero_recibo || '', rs.cpf_paciente || '', rs.nome_paciente || '', rs.cpf_profissional || '', rs.nome_profissional || '', rs.cro_profissional || '', rs.descricao_servico || '', rs.tipo || 'recibo', 'rascunho']
                })
                return res.status(200).json({ success: true, id: Number(rsIns.lastInsertRowid), msg: 'Recibo criado' })
            }
            // GET
            var rsRows = await client.execute({ sql: "SELECT * FROM receitas_saude WHERE clinica_id=? ORDER BY created_at DESC LIMIT 200", args: [clinica_id] })
            return res.status(200).json({ success: true, recibos: rsRows.rows })
        }

        // ── RECIBOS-PACIENTE ──────────────────────────────────────────
        if (route === 'recibos-paciente') {
            var rpPacId = parseInt(q.paciente_id) || 0
            if (!rpPacId) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })
            var rpRows = await client.execute({ sql: "SELECT * FROM receitas_saude WHERE paciente_id=? AND clinica_id=? ORDER BY created_at DESC", args: [rpPacId, clinica_id] })
            return res.status(200).json({ success: true, recibos: rpRows.rows })
        }

        // ── RECEITA-SAUDE-EMITIR (marca como emitido) ──────────────
        if (route === 'receita-saude-emitir') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var rse = req.body || {}
            if (!rse.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({ sql: "UPDATE receitas_saude SET status='emitido', data_emissao=COALESCE(NULLIF(data_emissao,''),?) WHERE id=? AND clinica_id=?", args: [new Date().toISOString().slice(0, 10), rse.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Recibo marcado como emitido' })
        }

        // ── VERIFICAR-VENCIMENTOS ──────────────────────────────────
        if (route === 'verificar-vencimentos') {
            var vvHoje = new Date().toISOString().slice(0, 10)
            // Parcelas vencidas
            var vvParc = await client.execute({
                sql: "UPDATE parcelas_orcamento SET status='vencido', updated_at=datetime('now') WHERE data_vencimento < ? AND status='pendente' AND clinica_id=?",
                args: [vvHoje, clinica_id]
            })
            // Contas a pagar vencidas
            var vvCP = await client.execute({
                sql: "UPDATE contas_pagar SET status='vencida' WHERE vencimento < ? AND status='aberta' AND clinica_id=?",
                args: [vvHoje, clinica_id]
            })
            return res.status(200).json({ success: true, parcelas_vencidas: vvParc.rowsAffected || 0, contas_vencidas: vvCP.rowsAffected || 0 })
        }

        // ── FINANCEIRO-MIGRATE-V2 (categorias + contas_pagar melhorias) ──
        if (route === 'financeiro-migrate-v2') {
            var fm2Summary = { tables: [], columns: [] }

            // Create categorias_financeiras
            await client.execute("CREATE TABLE IF NOT EXISTS categorias_financeiras (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, nome TEXT NOT NULL, classificacao TEXT NOT NULL, tipo TEXT NOT NULL, ativo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))")
            fm2Summary.tables.push('categorias_financeiras: ok')

            // Seed default categories if empty
            var fm2Count = await client.execute("SELECT COUNT(*) as cnt FROM categorias_financeiras")
            if (fm2Count.rows[0].cnt === 0) {
                var fm2Cats = [
                    // Custos Fixos
                    ['Aluguel', 'Custo Fixo', 'despesa'],
                    ['Salários e Encargos', 'Custo Fixo', 'despesa'],
                    ['Condomínio', 'Custo Fixo', 'despesa'],
                    ['Internet e Telefone', 'Custo Fixo', 'despesa'],
                    ['Contabilidade', 'Custo Fixo', 'despesa'],
                    ['Seguros', 'Custo Fixo', 'despesa'],
                    ['Limpeza e Manutenção', 'Custo Fixo', 'despesa'],
                    ['Alarme e Monitoramento', 'Custo Fixo', 'despesa'],
                    ['Software e Sistemas', 'Custo Fixo', 'despesa'],
                    ['Energia Elétrica', 'Custo Fixo', 'despesa'],
                    ['Água', 'Custo Fixo', 'despesa'],
                    // Custos Variáveis
                    ['Material Odontológico', 'Custo Variável', 'despesa'],
                    ['Laboratório Protético', 'Custo Variável', 'despesa'],
                    ['Comissão Profissionais', 'Custo Variável', 'despesa'],
                    ['EPIs e Biossegurança', 'Custo Variável', 'despesa'],
                    ['Material de Limpeza', 'Custo Variável', 'despesa'],
                    ['Descartáveis', 'Custo Variável', 'despesa'],
                    // Investimentos
                    ['Equipamentos', 'Investimento', 'despesa'],
                    ['Reforma e Obras', 'Investimento', 'despesa'],
                    ['Capacitação e Cursos', 'Investimento', 'despesa'],
                    ['Mobiliário', 'Investimento', 'despesa'],
                    // Marketing
                    ['Google Ads', 'Marketing', 'despesa'],
                    ['Instagram/Facebook Ads', 'Marketing', 'despesa'],
                    ['Material Gráfico', 'Marketing', 'despesa'],
                    ['Eventos e Ações', 'Marketing', 'despesa'],
                    // Impostos
                    ['ISS', 'Impostos', 'despesa'],
                    ['Simples Nacional / DAS', 'Impostos', 'despesa'],
                    ['IRPJ', 'Impostos', 'despesa'],
                    ['CSLL', 'Impostos', 'despesa'],
                    ['INSS', 'Impostos', 'despesa'],
                    // Receitas
                    ['Tratamento Particular', 'Receita', 'receita'],
                    ['Convênio/Plano', 'Receita', 'receita'],
                    ['Estética', 'Receita', 'receita'],
                    ['Ortodontia', 'Receita', 'receita'],
                    ['Implante', 'Receita', 'receita'],
                ]
                for (var ci = 0; ci < fm2Cats.length; ci++) {
                    await client.execute({ sql: "INSERT INTO categorias_financeiras(clinica_id, nome, classificacao, tipo) VALUES(NULL,?,?,?)", args: fm2Cats[ci] })
                }
                fm2Summary.tables.push('categorias seed: ' + fm2Cats.length + ' categorias')
            }

            // Add columns to contas_pagar
            var fm2Cols = ["categoria_id INTEGER", "parcela_atual INTEGER DEFAULT 1", "total_parcelas INTEGER DEFAULT 1", "frequencia TEXT"]
            for (var fi2 = 0; fi2 < fm2Cols.length; fi2++) {
                try {
                    await client.execute("ALTER TABLE contas_pagar ADD COLUMN " + fm2Cols[fi2])
                    fm2Summary.columns.push(fm2Cols[fi2].split(' ')[0] + ': adicionada')
                } catch(e) {
                    fm2Summary.columns.push(fm2Cols[fi2].split(' ')[0] + ': já existe')
                }
            }

            // Add columns to lancamentos for cross-references
            var fm2LancCols = ["orcamento_id INTEGER", "parcela_orcamento_id INTEGER", "conta_pagar_id INTEGER"]
            for (var fi3 = 0; fi3 < fm2LancCols.length; fi3++) {
                try {
                    await client.execute("ALTER TABLE lancamentos ADD COLUMN " + fm2LancCols[fi3])
                    fm2Summary.columns.push('lancamentos.' + fm2LancCols[fi3].split(' ')[0] + ': adicionada')
                } catch(e) {
                    fm2Summary.columns.push('lancamentos.' + fm2LancCols[fi3].split(' ')[0] + ': já existe')
                }
            }

            return res.status(200).json({ success: true, summary: fm2Summary })
        }

        // ── CATEGORIAS-FINANCEIRAS ──────────────────────────────────
        if (route === 'categorias-financeiras') {
            if (req.method === 'POST') {
                var cf = req.body || {}
                if (!cf.nome || !cf.classificacao || !cf.tipo) return res.status(400).json({ success: false, error: 'nome, classificacao e tipo obrigatórios' })
                var cfIns = await client.execute({ sql: "INSERT INTO categorias_financeiras(clinica_id, nome, classificacao, tipo) VALUES(?,?,?,?)", args: [clinica_id, cf.nome, cf.classificacao, cf.tipo] })
                return res.status(200).json({ success: true, id: Number(cfIns.lastInsertRowid) })
            }
            // GET - list all (global + clinic-specific)
            var cfRows = await client.execute({ sql: "SELECT * FROM categorias_financeiras WHERE (clinica_id IS NULL OR clinica_id=?) AND ativo=1 ORDER BY classificacao, nome", args: [clinica_id] })
            return res.status(200).json({ success: true, categorias: cfRows.rows })
        }

        // ── DRE (Demonstrativo de Resultado do Exercício) ──────────
        if (route === 'dre') {
            var dreAno = parseInt(q.ano) || new Date().getFullYear()
            var dreMesIni = parseInt(q.mes_inicio) || 1
            var dreMesFim = parseInt(q.mes_fim) || 12
            var dreResult = []

            for (var drm = dreMesIni; drm <= dreMesFim; drm++) {
                var dreMes = dreAno + '-' + String(drm).padStart(2, '0')

                // Receita: parcelas pagas + lancamentos tipo Vendas/Entrada
                var dreRec = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM parcelas_orcamento WHERE strftime('%Y-%m',data_pagamento)=? AND status='pago' AND clinica_id=?", args: [dreMes, clinica_id] })
                var dreRecLanc = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND tipo IN ('Vendas','Entrada') AND status='realizado' AND clinica_id=?", args: [dreMes, clinica_id] })
                var dreRecFin = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada' AND clinica_id=?", args: [dreMes, clinica_id] })
                var receitaBruta = (dreRec.rows[0].total || 0) + (dreRecLanc.rows[0].total || 0) + (dreRecFin.rows[0].total || 0)

                // Impostos
                var dreImp = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND classificacao='Impostos' AND status='realizado' AND clinica_id=?", args: [dreMes, clinica_id] })
                var dreImpCP = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE strftime('%Y-%m',pagamento)=? AND classificacao='Impostos' AND status='paga' AND clinica_id=?", args: [dreMes, clinica_id] })
                var impostos = (dreImp.rows[0].total || 0) + (dreImpCP.rows[0].total || 0)

                // Custos Fixos
                var dreCF = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND classificacao='Custo Fixo' AND status='realizado' AND clinica_id=?", args: [dreMes, clinica_id] })
                var dreCFcp = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE strftime('%Y-%m',pagamento)=? AND classificacao='Custo Fixo' AND status='paga' AND clinica_id=?", args: [dreMes, clinica_id] })
                var custosFixos = (dreCF.rows[0].total || 0) + (dreCFcp.rows[0].total || 0)

                // Custos Variáveis
                var dreCV = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND classificacao='Custo Variável' AND status='realizado' AND clinica_id=?", args: [dreMes, clinica_id] })
                var dreCVcp = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE strftime('%Y-%m',pagamento)=? AND classificacao='Custo Variável' AND status='paga' AND clinica_id=?", args: [dreMes, clinica_id] })
                var custosVariaveis = (dreCV.rows[0].total || 0) + (dreCVcp.rows[0].total || 0)

                // Marketing
                var dreMkt = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND classificacao='Marketing' AND status='realizado' AND clinica_id=?", args: [dreMes, clinica_id] })
                var dreMktCP = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE strftime('%Y-%m',pagamento)=? AND classificacao='Marketing' AND status='paga' AND clinica_id=?", args: [dreMes, clinica_id] })
                var marketing = (dreMkt.rows[0].total || 0) + (dreMktCP.rows[0].total || 0)

                // Investimentos
                var dreInv = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND classificacao='Investimento' AND status='realizado' AND clinica_id=?", args: [dreMes, clinica_id] })
                var dreInvCP = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE strftime('%Y-%m',pagamento)=? AND classificacao='Investimento' AND status='paga' AND clinica_id=?", args: [dreMes, clinica_id] })
                var investimentos = (dreInv.rows[0].total || 0) + (dreInvCP.rows[0].total || 0)

                var receitaLiquida = receitaBruta - impostos
                var resultadoOperacional = receitaLiquida - custosFixos - custosVariaveis - marketing
                var resultadoFinal = resultadoOperacional - investimentos

                dreResult.push({
                    mes: drm, mes_str: dreMes,
                    receita_bruta: receitaBruta, impostos: impostos, receita_liquida: receitaLiquida,
                    custos_fixos: custosFixos, custos_variaveis: custosVariaveis, marketing: marketing,
                    resultado_operacional: resultadoOperacional,
                    investimentos: investimentos, resultado_final: resultadoFinal
                })
            }

            // Annual totals
            var dreAnual = { receita_bruta: 0, impostos: 0, receita_liquida: 0, custos_fixos: 0, custos_variaveis: 0, marketing: 0, resultado_operacional: 0, investimentos: 0, resultado_final: 0 }
            dreResult.forEach(function(m) {
                for (var k in dreAnual) dreAnual[k] += m[k]
            })

            return res.status(200).json({ success: true, ano: dreAno, meses: dreResult, anual: dreAnual })
        }

        // ── FLUXO-CAIXA-REAL ──────────────────────────────────────────
        if (route === 'fluxo-caixa-real') {
            var fcMes = parseInt(q.mes) || (new Date().getMonth() + 1)
            var fcAno = parseInt(q.ano) || new Date().getFullYear()
            var fcMstr = fcAno + '-' + String(fcMes).padStart(2, '0')
            var fcUltDia = new Date(fcAno, fcMes, 0).getDate()
            var fcHoje = new Date().toISOString().slice(0, 10)

            // Realized entries (financeiro + lancamentos + parcelas pagas)
            var fcEntRealizadas = await client.execute({ sql: "SELECT data_pagamento as dia, SUM(valor) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada' AND clinica_id=? GROUP BY data_pagamento", args: [fcMstr, clinica_id] })
            var fcEntLanc = await client.execute({ sql: "SELECT data as dia, SUM(valor) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND tipo IN ('Vendas','Entrada') AND status='realizado' AND clinica_id=? GROUP BY data", args: [fcMstr, clinica_id] })
            var fcEntParc = await client.execute({ sql: "SELECT data_pagamento as dia, SUM(valor) as total FROM parcelas_orcamento WHERE strftime('%Y-%m',data_pagamento)=? AND status='pago' AND clinica_id=? GROUP BY data_pagamento", args: [fcMstr, clinica_id] })

            // Realized exits
            var fcSaiRealizadas = await client.execute({ sql: "SELECT data_pagamento as dia, SUM(ABS(valor)) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='saida' AND clinica_id=? GROUP BY data_pagamento", args: [fcMstr, clinica_id] })
            var fcSaiLanc = await client.execute({ sql: "SELECT data as dia, SUM(ABS(valor)) as total FROM lancamentos WHERE strftime('%Y-%m',data)=? AND tipo='Saída' AND status='realizado' AND clinica_id=? GROUP BY data", args: [fcMstr, clinica_id] })
            var fcSaiCP = await client.execute({ sql: "SELECT pagamento as dia, SUM(valor) as total FROM contas_pagar WHERE strftime('%Y-%m',pagamento)=? AND status='paga' AND clinica_id=? GROUP BY pagamento", args: [fcMstr, clinica_id] })

            // Projected: parcelas pendentes e contas a pagar abertas
            var fcAReceber = await client.execute({ sql: "SELECT data_vencimento as dia, SUM(valor) as total FROM parcelas_orcamento WHERE strftime('%Y-%m',data_vencimento)=? AND status='pendente' AND clinica_id=? GROUP BY data_vencimento", args: [fcMstr, clinica_id] })
            var fcAPagar = await client.execute({ sql: "SELECT vencimento as dia, SUM(valor) as total FROM contas_pagar WHERE strftime('%Y-%m',vencimento)=? AND status='aberta' AND clinica_id=? GROUP BY vencimento", args: [fcMstr, clinica_id] })

            // Build day-by-day data
            function fcSumMap(rows) { var m = {}; rows.forEach(function(r) { m[r.dia] = (m[r.dia] || 0) + (r.total || 0) }); return m }
            var mEnt = fcSumMap(fcEntRealizadas.rows), mEntL = fcSumMap(fcEntLanc.rows), mEntP = fcSumMap(fcEntParc.rows)
            var mSai = fcSumMap(fcSaiRealizadas.rows), mSaiL = fcSumMap(fcSaiLanc.rows), mSaiCP = fcSumMap(fcSaiCP.rows)
            var mARec = fcSumMap(fcAReceber.rows), mAPag = fcSumMap(fcAPagar.rows)

            var fcDias = [], fcAc = 0, fcTotEnt = 0, fcTotSai = 0, fcTotARec = 0, fcTotAPag = 0
            for (var fcd = 1; fcd <= fcUltDia; fcd++) {
                var fcDs = fcMstr + '-' + String(fcd).padStart(2, '0')
                var ent = (mEnt[fcDs] || 0) + (mEntL[fcDs] || 0) + (mEntP[fcDs] || 0)
                var sai = (mSai[fcDs] || 0) + (mSaiL[fcDs] || 0) + (mSaiCP[fcDs] || 0)
                var arec = mARec[fcDs] || 0
                var apag = mAPag[fcDs] || 0
                fcAc += ent - sai
                fcTotEnt += ent; fcTotSai += sai; fcTotARec += arec; fcTotAPag += apag
                fcDias.push({ dia: fcd, data: fcDs, entradas: ent, saidas: sai, a_receber: arec, a_pagar: apag, saldo: ent - sai, acumulado: fcAc })
            }

            return res.status(200).json({ success: true, mes: fcMes, ano: fcAno, por_dia: fcDias, totais: { entradas: fcTotEnt, saidas: fcTotSai, a_receber: fcTotARec, a_pagar: fcTotAPag, saldo: fcTotEnt - fcTotSai } })
        }

        // ── CONTAS-PAGAR-CRUD ──────────────────────────────────────────
        if (route === 'contas-pagar-crud') {
            if (req.method === 'POST') {
                var cp = req.body || {}
                if (!cp.descricao || !cp.valor || !cp.vencimento) return res.status(400).json({ success: false, error: 'descricao, valor e vencimento obrigatórios' })

                if (cp.id) {
                    // Update existing
                    await client.execute({
                        sql: "UPDATE contas_pagar SET descricao=?, fornecedor=?, valor=?, vencimento=?, classificacao=?, categoria=?, categoria_id=?, recorrente=?, frequencia=?, total_parcelas=?, parcela_atual=? WHERE id=? AND clinica_id=?",
                        args: [cp.descricao, cp.fornecedor || '', parseFloat(cp.valor), cp.vencimento, cp.classificacao || '', cp.categoria || '', parseInt(cp.categoria_id) || null, cp.recorrente ? 1 : 0, cp.frequencia || '', parseInt(cp.total_parcelas) || 1, parseInt(cp.parcela_atual) || 1, cp.id, clinica_id]
                    })
                    return res.status(200).json({ success: true, msg: 'Conta atualizada' })
                }

                // Create new
                var cpIns = await client.execute({
                    sql: "INSERT INTO contas_pagar(clinica_id, descricao, fornecedor, valor, vencimento, classificacao, categoria, categoria_id, recorrente, frequencia, total_parcelas, parcela_atual, status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    args: [clinica_id, cp.descricao, cp.fornecedor || '', parseFloat(cp.valor), cp.vencimento, cp.classificacao || '', cp.categoria || '', parseInt(cp.categoria_id) || null, cp.recorrente ? 1 : 0, cp.frequencia || '', parseInt(cp.total_parcelas) || 1, parseInt(cp.parcela_atual) || 1, 'aberta']
                })

                // If recorrente, generate future entries
                if (cp.recorrente && cp.total_parcelas > 1) {
                    var cpBase = new Date(cp.vencimento + 'T12:00:00')
                    for (var cpi = 1; cpi < parseInt(cp.total_parcelas); cpi++) {
                        var cpNext = new Date(cpBase)
                        if (cp.frequencia === 'semanal') cpNext.setDate(cpNext.getDate() + 7 * cpi)
                        else if (cp.frequencia === 'quinzenal') cpNext.setDate(cpNext.getDate() + 15 * cpi)
                        else cpNext.setMonth(cpNext.getMonth() + cpi) // mensal default
                        var cpNextStr = cpNext.toISOString().slice(0, 10)
                        await client.execute({
                            sql: "INSERT INTO contas_pagar(clinica_id, descricao, fornecedor, valor, vencimento, classificacao, categoria, categoria_id, recorrente, frequencia, total_parcelas, parcela_atual, status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            args: [clinica_id, cp.descricao, cp.fornecedor || '', parseFloat(cp.valor), cpNextStr, cp.classificacao || '', cp.categoria || '', parseInt(cp.categoria_id) || null, 1, cp.frequencia || 'mensal', parseInt(cp.total_parcelas), cpi + 1, 'aberta']
                        })
                    }
                }

                return res.status(200).json({ success: true, id: Number(cpIns.lastInsertRowid), msg: 'Conta criada' })
            }

            // GET - list
            var cpW = ["clinica_id=?"], cpA = [clinica_id]
            if (q.status && q.status !== 'todas') { cpW.push("status=?"); cpA.push(q.status) }
            if (q.classificacao) { cpW.push("classificacao=?"); cpA.push(q.classificacao) }
            if (q.de) { cpW.push("vencimento>=?"); cpA.push(q.de) }
            if (q.ate) { cpW.push("vencimento<=?"); cpA.push(q.ate) }
            if (!q.de && !q.ate) {
                var cpMes = q.mes || new Date().toISOString().slice(0, 7)
                cpW.push("strftime('%Y-%m',vencimento)=?"); cpA.push(cpMes)
            }
            var cpRows = await client.execute({ sql: "SELECT * FROM contas_pagar WHERE " + cpW.join(' AND ') + " ORDER BY vencimento ASC", args: cpA })

            // Totals by classification
            var cpTotais = await client.execute({ sql: "SELECT classificacao, SUM(valor) as total, COUNT(*) as qtd FROM contas_pagar WHERE " + cpW.join(' AND ') + " GROUP BY classificacao", args: cpA })

            return res.status(200).json({ success: true, contas: cpRows.rows, totais_classificacao: cpTotais.rows })
        }

        // ── CONTA-PAGAR-BAIXA ──────────────────────────────────────────
        if (route === 'conta-pagar-baixa') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var cpb = req.body || {}
            if (!cpb.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            var cpbData = cpb.data_pagamento || new Date().toISOString().slice(0, 10)
            await client.execute({
                sql: "UPDATE contas_pagar SET status='paga', pagamento=? WHERE id=? AND clinica_id=?",
                args: [cpbData, cpb.id, clinica_id]
            })
            // Create lancamento
            var cpbRow = await client.execute({ sql: "SELECT * FROM contas_pagar WHERE id=?", args: [cpb.id] })
            if (cpbRow.rows.length) {
                var cpbConta = cpbRow.rows[0]
                try {
                    await client.execute({
                        sql: "INSERT INTO lancamentos(clinica_id, data, tipo, descricao, valor, classificacao, categoria, conta_pagar_id, status) VALUES(?,?,?,?,?,?,?,?,?)",
                        args: [clinica_id, cpbData, 'Saída', cpbConta.descricao, cpbConta.valor, cpbConta.classificacao || '', cpbConta.categoria || '', cpb.id, 'realizado']
                    })
                } catch(e) { console.error('[conta-pagar-baixa] lancamento error:', e.message) }
            }
            return res.status(200).json({ success: true, msg: 'Conta paga' })
        }

        // ── CONTA-PAGAR-CANCELAR ──────────────────────────────────────
        if (route === 'conta-pagar-cancelar') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var cpc = req.body || {}
            if (!cpc.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({ sql: "UPDATE contas_pagar SET status='cancelada' WHERE id=? AND clinica_id=?", args: [cpc.id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Conta cancelada' })
        }

        // ── CONTAS-RECEBER-REAL ────────────────────────────────────────
        if (route === 'contas-receber-real') {
            var crDe = q.de || new Date().toISOString().slice(0, 7) + '-01'
            var crAte = q.ate || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10)
            var crStatus = q.status || 'todas'

            var crW = ["po.clinica_id=?", "po.data_vencimento>=?", "po.data_vencimento<=?"]
            var crA = [clinica_id, crDe, crAte]
            if (crStatus !== 'todas') { crW.push("po.status=?"); crA.push(crStatus) }

            var crRows = await client.execute({
                sql: "SELECT po.*, p.nome as paciente_nome, o.valor_total as orcamento_valor, (SELECT GROUP_CONCAT(oi.procedimento_nome, ', ') FROM orcamento_itens oi WHERE oi.orcamento_id=po.orcamento_id LIMIT 3) as procedimentos FROM parcelas_orcamento po JOIN pacientes p ON p.id=po.paciente_id JOIN orcamentos o ON o.id=po.orcamento_id WHERE " + crW.join(' AND ') + " ORDER BY po.data_vencimento ASC",
                args: crA
            })

            var crTotais = { pendente: 0, pago: 0, vencido: 0 }
            crRows.rows.forEach(function(r) { if (crTotais[r.status] !== undefined) crTotais[r.status] += r.valor })

            return res.status(200).json({ success: true, parcelas: crRows.rows, totais: crTotais })
        }

        // ── BOLETOS-DASHBOARD ──────────────────────────────────────────
        if (route === 'boletos-dashboard') {
            var bdStatus = q.status || 'todas'
            var bdDe = q.de || ''
            var bdAte = q.ate || ''
            var bdW = ["clinica_id=?", "tipo='boleto'"], bdA = [clinica_id]
            if (bdStatus !== 'todas') { bdW.push("status=?"); bdA.push(bdStatus) }
            if (bdDe) { bdW.push("data_vencimento>=?"); bdA.push(bdDe) }
            if (bdAte) { bdW.push("data_vencimento<=?"); bdA.push(bdAte) }
            if (!bdDe && !bdAte) {
                var bdMes = q.mes || new Date().toISOString().slice(0, 7)
                bdW.push("strftime('%Y-%m',data_vencimento)=?"); bdA.push(bdMes)
            }
            var bdRows = await client.execute({ sql: "SELECT * FROM cobrancas WHERE " + bdW.join(' AND ') + " ORDER BY data_vencimento ASC", args: bdA })
            var bdTotais = await client.execute({ sql: "SELECT status, COUNT(*) as qtd, SUM(valor) as total FROM cobrancas WHERE clinica_id=? AND tipo='boleto' GROUP BY status", args: [clinica_id] })
            return res.status(200).json({ success: true, boletos: bdRows.rows, totais: bdTotais.rows })
        }

        // ── PLANOS-CONVENIO ──────────────────────────────────────────
        if (route === 'planos-convenio') {
            if (req.method === 'POST') {
                var plc = req.body || {}
                if (plc.action === 'atualizar-status') {
                    await client.execute({ sql: "UPDATE planos_convenio SET status=?, data_recebimento=? WHERE id=? AND clinica_id=?", args: [plc.status || 'recebido', plc.data_recebimento || new Date().toISOString().slice(0, 10), plc.id, clinica_id] })
                    if (plc.status === 'recebido' && plc.valor_recebido) {
                        try {
                            await client.execute({
                                sql: "INSERT INTO lancamentos(clinica_id, data, tipo, descricao, valor, classificacao, categoria, status) VALUES(?,?,?,?,?,?,?,?)",
                                args: [clinica_id, plc.data_recebimento || new Date().toISOString().slice(0, 10), 'Vendas', 'Convênio - ' + (plc.convenio || ''), parseFloat(plc.valor_recebido), 'Receita', 'Convênio/Plano', 'realizado']
                            })
                        } catch(e) {}
                    }
                    return res.status(200).json({ success: true, msg: 'Status atualizado' })
                }
            }
            // GET - try planos_convenio first, fallback to empty
            try {
                var plRows = await client.execute({ sql: "SELECT pc.*, p.nome as paciente_nome FROM planos_convenio pc LEFT JOIN pacientes p ON p.id=pc.paciente_id WHERE pc.clinica_id=? ORDER BY pc.created_at DESC LIMIT 100", args: [clinica_id] })
                return res.status(200).json({ success: true, planos: plRows.rows })
            } catch(e) {
                return res.status(200).json({ success: true, planos: [], msg: 'Tabela planos_convenio não existe ainda' })
            }
        }

        // ── FINANCEIRO-MIGRATE ──────────────────────────────────────
        if (route === 'financeiro-migrate') {
            var fmSummary = { tables: [], columns: [] }

            // Create parcelas_orcamento table
            await client.execute("CREATE TABLE IF NOT EXISTS parcelas_orcamento (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, orcamento_id INTEGER, paciente_id INTEGER, numero_parcela INTEGER NOT NULL, total_parcelas INTEGER NOT NULL, valor REAL NOT NULL, data_vencimento TEXT NOT NULL, data_pagamento TEXT, forma_pagamento TEXT, status TEXT DEFAULT 'pendente', tipo TEXT DEFAULT 'parcela', cobranca_id INTEGER, asaas_id TEXT, observacoes TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))")
            fmSummary.tables.push('parcelas_orcamento: ok')

            // Create indexes
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_parc_orc ON parcelas_orcamento(orcamento_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_parc_pac ON parcelas_orcamento(paciente_id)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_parc_venc ON parcelas_orcamento(data_vencimento)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_parc_status ON parcelas_orcamento(status)") } catch(e) {}
            try { await client.execute("CREATE INDEX IF NOT EXISTS idx_parc_clinica ON parcelas_orcamento(clinica_id)") } catch(e) {}

            // Add columns to orcamentos
            var fmCols = ["entrada_valor REAL DEFAULT 0", "entrada_forma TEXT", "dia_vencimento INTEGER DEFAULT 10"]
            for (var fi = 0; fi < fmCols.length; fi++) {
                try {
                    await client.execute("ALTER TABLE orcamentos ADD COLUMN " + fmCols[fi])
                    fmSummary.columns.push(fmCols[fi].split(' ')[0] + ': adicionada')
                } catch(e) {
                    fmSummary.columns.push(fmCols[fi].split(' ')[0] + ': já existe')
                }
            }

            return res.status(200).json({ success: true, summary: fmSummary })
        }

        // ── PARCELAS-PACIENTE ──────────────────────────────────────────
        if (route === 'parcelas-paciente') {
            var ppPacId = parseInt(q.paciente_id) || 0
            if (!ppPacId) return res.status(400).json({ success: false, error: 'paciente_id obrigatório' })

            // Get all approved orcamentos for this patient
            var ppOrcs = await client.execute({
                sql: "SELECT o.id, o.valor_total, o.desconto, o.forma_pagamento, o.observacoes, o.data_aprovacao, o.status, o.parcelas as num_parcelas, (SELECT GROUP_CONCAT(oi.procedimento_nome, ', ') FROM orcamento_itens oi WHERE oi.orcamento_id=o.id) as procedimentos FROM orcamentos o WHERE o.paciente_id=? AND o.clinica_id=? AND o.status='aprovado' ORDER BY o.data_aprovacao DESC",
                args: [ppPacId, clinica_id]
            })

            // Try to get parcelas (table may not exist yet)
            var ppRows = { rows: [] }
            try {
                ppRows = await client.execute({
                    sql: "SELECT po.*, o.valor_total as orcamento_valor, o.desconto as orcamento_desconto, o.forma_pagamento as orcamento_forma, o.observacoes as orcamento_obs, o.data_aprovacao, (SELECT GROUP_CONCAT(oi.procedimento_nome, ', ') FROM orcamento_itens oi WHERE oi.orcamento_id=po.orcamento_id) as procedimentos FROM parcelas_orcamento po JOIN orcamentos o ON o.id=po.orcamento_id WHERE po.paciente_id=? AND po.clinica_id=? ORDER BY po.orcamento_id, po.numero_parcela",
                    args: [ppPacId, clinica_id]
                })
            } catch(e) { /* table may not exist yet */ }

            // Group parcelas by orcamento
            var ppGroups = {}
            for (var pi = 0; pi < ppRows.rows.length; pi++) {
                var pr = ppRows.rows[pi]
                if (!ppGroups[pr.orcamento_id]) {
                    ppGroups[pr.orcamento_id] = {
                        orcamento_id: pr.orcamento_id,
                        valor_total: pr.orcamento_valor,
                        desconto: pr.orcamento_desconto,
                        forma_pagamento: pr.orcamento_forma,
                        procedimentos: pr.procedimentos,
                        observacoes: pr.orcamento_obs,
                        data_aprovacao: pr.data_aprovacao,
                        parcelas: []
                    }
                }
                ppGroups[pr.orcamento_id].parcelas.push(pr)
            }

            // Add approved orcamentos that have no parcelas yet
            for (var poi = 0; poi < ppOrcs.rows.length; poi++) {
                var ppOrc = ppOrcs.rows[poi]
                if (!ppGroups[ppOrc.id]) {
                    ppGroups[ppOrc.id] = {
                        orcamento_id: ppOrc.id,
                        valor_total: ppOrc.valor_total,
                        desconto: ppOrc.desconto,
                        forma_pagamento: ppOrc.forma_pagamento,
                        procedimentos: ppOrc.procedimentos,
                        observacoes: ppOrc.observacoes,
                        data_aprovacao: ppOrc.data_aprovacao,
                        parcelas: [],
                        sem_parcelas: true
                    }
                }
            }
            var ppResult = Object.values(ppGroups)
            return res.status(200).json({ success: true, orcamentos: ppResult })
        }

        // ── PARCELAS-ORCAMENTO ──────────────────────────────────────────
        if (route === 'parcelas-orcamento') {
            var poOrcId = parseInt(q.orcamento_id) || 0
            if (!poOrcId) return res.status(400).json({ success: false, error: 'orcamento_id obrigatório' })
            var poRows = await client.execute({
                sql: "SELECT * FROM parcelas_orcamento WHERE orcamento_id=? AND clinica_id=? ORDER BY numero_parcela",
                args: [poOrcId, clinica_id]
            })
            return res.status(200).json({ success: true, parcelas: poRows.rows })
        }

        // ── PARCELA-BAIXA (dar baixa manual) ──────────────────────────
        if (route === 'parcela-baixa') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var pb = req.body || {}
            if (!pb.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            var pbData = pb.data_pagamento || new Date().toISOString().slice(0, 10)

            // Get parcela info
            var pbRow = await client.execute({ sql: "SELECT * FROM parcelas_orcamento WHERE id=? AND clinica_id=?", args: [pb.id, clinica_id] })
            if (!pbRow.rows.length) return res.status(404).json({ success: false, error: 'Parcela não encontrada' })
            var pbParc = pbRow.rows[0]

            // Update parcela
            await client.execute({
                sql: "UPDATE parcelas_orcamento SET status='pago', data_pagamento=?, updated_at=datetime('now') WHERE id=? AND clinica_id=?",
                args: [pbData, pb.id, clinica_id]
            })

            // Create lancamento entry
            var pbPacNome = ''
            var pbPacRow = await client.execute({ sql: "SELECT nome FROM pacientes WHERE id=?", args: [pbParc.paciente_id] })
            if (pbPacRow.rows.length) pbPacNome = pbPacRow.rows[0].nome

            try {
                await client.execute({
                    sql: "INSERT INTO lancamentos(clinica_id, data, tipo, forma_pagamento, descricao, paciente_id, paciente_nome, valor, classificacao, categoria, status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    args: [clinica_id, pbData, 'Vendas', pbParc.forma_pagamento || '', 'Parcela ' + pbParc.numero_parcela + '/' + pbParc.total_parcelas + ' - Orçamento #' + pbParc.orcamento_id, pbParc.paciente_id, pbPacNome, pbParc.valor, 'Receita', 'Tratamento', 'realizado']
                })
            } catch(e) { console.error('[parcela-baixa] lancamento error:', e.message) }

            return res.status(200).json({ success: true, msg: 'Baixa realizada' })
        }

        // ── PARCELA-CANCELAR ──────────────────────────────────────────
        // ── PARCELA-VINCULAR-COBRANCA ──────────────────────────────
        if (route === 'parcela-vincular-cobranca') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var pvc = req.body || {}
            if (!pvc.parcela_id || !pvc.cobranca_id) return res.status(400).json({ success: false, error: 'parcela_id e cobranca_id obrigatórios' })
            await client.execute({ sql: "UPDATE parcelas_orcamento SET cobranca_id=?, updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [pvc.cobranca_id, pvc.parcela_id, clinica_id] })
            return res.status(200).json({ success: true, msg: 'Cobrança vinculada à parcela' })
        }

        if (route === 'parcela-cancelar') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var pc = req.body || {}
            if (!pc.id) return res.status(400).json({ success: false, error: 'id obrigatório' })
            await client.execute({
                sql: "UPDATE parcelas_orcamento SET status='cancelado', updated_at=datetime('now') WHERE id=? AND clinica_id=?",
                args: [pc.id, clinica_id]
            })
            return res.status(200).json({ success: true, msg: 'Parcela cancelada' })
        }

        // ── GERAR-PARCELAS (chamado após aprovação do orçamento) ──────
        if (route === 'gerar-parcelas') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var gp = req.body || {}
            if (!gp.orcamento_id) return res.status(400).json({ success: false, error: 'orcamento_id obrigatório' })

            // Load orcamento
            var gpOrc = await client.execute({ sql: "SELECT * FROM orcamentos WHERE id=? AND clinica_id=?", args: [gp.orcamento_id, clinica_id] })
            if (!gpOrc.rows.length) return res.status(404).json({ success: false, error: 'Orçamento não encontrado' })
            var gpO = gpOrc.rows[0]

            // Config from request body (overrides orcamento defaults)
            var gpEntradaValor = parseFloat(gp.entrada_valor) || 0
            var gpEntradaForma = gp.entrada_forma || 'pix'
            var gpParcelas = parseInt(gp.parcelas) || parseInt(gpO.parcelas) || 1
            var gpFormaPag = gp.forma_pagamento || gpO.forma_pagamento || 'boleto'
            var gpDiaVenc = parseInt(gp.dia_vencimento) || 10
            var gpDesconto = parseFloat(gpO.desconto) || 0
            var gpValorTotal = parseFloat(gpO.valor_total) || 0
            var gpGerarAsaas = gp.gerar_cobrancas !== false

            // Update orcamento with payment config
            await client.execute({
                sql: "UPDATE orcamentos SET entrada_valor=?, entrada_forma=?, dia_vencimento=?, forma_pagamento=?, parcelas=?, updated_at=datetime('now') WHERE id=?",
                args: [gpEntradaValor, gpEntradaForma, gpDiaVenc, gpFormaPag, gpParcelas, gp.orcamento_id]
            })

            // Delete existing parcelas for this orcamento (in case of reconfiguration)
            await client.execute({ sql: "DELETE FROM parcelas_orcamento WHERE orcamento_id=? AND clinica_id=?", args: [gp.orcamento_id, clinica_id] })

            var gpValorLiquido = gpValorTotal - gpDesconto
            var gpValorRestante = gpValorLiquido - gpEntradaValor
            var gpValorParcela = gpParcelas > 0 ? Math.round((gpValorRestante / gpParcelas) * 100) / 100 : gpValorRestante
            var gpHoje = new Date().toISOString().slice(0, 10)
            var gpParcelasGeradas = []
            var gpNumero = 0

            // Load patient info for Asaas
            var gpPacRow = await client.execute({ sql: "SELECT nome, cpf, email, telefone FROM pacientes WHERE id=?", args: [gpO.paciente_id] })
            var gpPaciente = gpPacRow.rows.length ? gpPacRow.rows[0] : null

            // Get Asaas API key
            var gpAsaasKey = ''
            if (gpGerarAsaas) {
                var gpAk = await client.execute({ sql: "SELECT asaas_api_key FROM clinicas WHERE id=?", args: [clinica_id] })
                gpAsaasKey = (gpAk.rows.length && gpAk.rows[0].asaas_api_key) ? gpAk.rows[0].asaas_api_key : ''
            }

            // Helper to create Asaas charge
            async function criarCobrancaAsaas(tipo, valor, vencimento, descricao, parcNum) {
                if (!gpAsaasKey || !gpPaciente) return null
                var billingMap = { pix: 'PIX', boleto: 'BOLETO', credito: 'CREDIT_CARD', debito: 'DEBIT_CARD', dinheiro: null, cheque: null }
                var billingType = billingMap[tipo]
                if (!billingType) return null

                try {
                    // Find or create customer
                    var custId = ''
                    var cpf = (gpPaciente.cpf || '').replace(/\D/g, '')
                    if (cpf) {
                        var custSearch = await fetch('https://api.asaas.com/v3/customers?cpfCnpj=' + encodeURIComponent(cpf), { headers: { 'access_token': gpAsaasKey } })
                        var custData = await custSearch.json()
                        if (custData.data && custData.data.length > 0) custId = custData.data[0].id
                    }
                    if (!custId) {
                        var newCust = await fetch('https://api.asaas.com/v3/customers', {
                            method: 'POST',
                            headers: { 'access_token': gpAsaasKey, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: gpPaciente.nome || 'Cliente', cpfCnpj: cpf || undefined, email: gpPaciente.email || undefined })
                        })
                        var newCustData = await newCust.json()
                        if (newCustData.errors) return null
                        custId = newCustData.id || ''
                    }
                    if (!custId) return null

                    var payBody = { customer: custId, billingType: billingType, value: valor, dueDate: vencimento, description: descricao }
                    var payRes = await fetch('https://api.asaas.com/v3/payments', {
                        method: 'POST',
                        headers: { 'access_token': gpAsaasKey, 'Content-Type': 'application/json' },
                        body: JSON.stringify(payBody)
                    })
                    var payData = await payRes.json()
                    if (payData.errors) return null

                    // Get PIX QR code if applicable
                    var pixQr = '', pixCola = ''
                    if (tipo === 'pix' && payData.id) {
                        try {
                            var pixRes = await fetch('https://api.asaas.com/v3/payments/' + payData.id + '/pixQrCode', { headers: { 'access_token': gpAsaasKey } })
                            var pixData = await pixRes.json()
                            pixCola = pixData.payload || ''
                            pixQr = pixData.encodedImage || ''
                        } catch(ep) {}
                    }

                    // Insert cobranca
                    try { await client.execute("ALTER TABLE cobrancas ADD COLUMN invoice_url TEXT") } catch(e) {}
                    try { await client.execute("ALTER TABLE cobrancas ADD COLUMN parcelas INTEGER DEFAULT 1") } catch(e) {}
                    var cobIns = await client.execute({
                        sql: "INSERT INTO cobrancas(clinica_id, paciente_id, paciente_nome, tipo, valor, descricao, referencia, status, data_vencimento, boleto_url, boleto_codigo, pix_qrcode, pix_copia_cola, asaas_id, invoice_url, parcelas) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        args: [clinica_id, gpO.paciente_id, gpPaciente.nome || '', tipo, valor, descricao, 'ORC-' + gp.orcamento_id, 'pendente', vencimento, payData.bankSlipUrl || '', payData.nossoNumero || '', pixQr, pixCola, payData.id || '', payData.invoiceUrl || '', 1]
                    })

                    // Send link to patient
                    if (payData.invoiceUrl && gpPaciente) {
                        var linkMsg = 'Olá ' + (gpPaciente.nome || '').split(' ')[0] + '! Parcela ' + parcNum + ': R$ ' + valor.toFixed(2).replace('.', ',') + ' - Vencimento: ' + vencimento.split('-').reverse().join('/') + ' - Link: ' + payData.invoiceUrl + ' - Klinik Odontologia'
                        var waToken = process.env.WHATSAPP_TOKEN || ''
                        var waPhoneId = process.env.WHATSAPP_PHONE_ID || ''
                        if (waToken && waPhoneId && gpPaciente.telefone) {
                            try {
                                var waPhone = (gpPaciente.telefone || '').replace(/\D/g, '')
                                if (waPhone.length <= 11) waPhone = '55' + waPhone
                                await fetch('https://graph.facebook.com/v23.0/' + waPhoneId + '/messages', {
                                    method: 'POST',
                                    headers: { 'Authorization': 'Bearer ' + waToken, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: linkMsg } })
                                })
                            } catch(ew) {}
                        }
                    }

                    return { cobranca_id: Number(cobIns.lastInsertRowid), asaas_id: payData.id || '', invoice_url: payData.invoiceUrl || '' }
                } catch(e) {
                    console.error('[gerar-parcelas] Asaas error:', e.message)
                    return null
                }
            }

            // 1. Generate entrada (down payment) if applicable
            if (gpEntradaValor > 0) {
                gpNumero++
                var gpEntradaAsaas = null
                if (gpGerarAsaas && gpEntradaForma !== 'dinheiro' && gpEntradaForma !== 'cheque') {
                    gpEntradaAsaas = await criarCobrancaAsaas(gpEntradaForma, gpEntradaValor, gpHoje, 'Entrada - Orçamento #' + gp.orcamento_id, 'Entrada')
                }
                await client.execute({
                    sql: "INSERT INTO parcelas_orcamento(clinica_id, orcamento_id, paciente_id, numero_parcela, total_parcelas, valor, data_vencimento, forma_pagamento, status, tipo, cobranca_id, asaas_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    args: [clinica_id, gp.orcamento_id, gpO.paciente_id, gpNumero, gpParcelas + (gpEntradaValor > 0 ? 1 : 0), gpEntradaValor, gpHoje, gpEntradaForma, 'pendente', 'entrada', gpEntradaAsaas ? gpEntradaAsaas.cobranca_id : null, gpEntradaAsaas ? gpEntradaAsaas.asaas_id : null]
                })
                gpParcelasGeradas.push({ numero: gpNumero, tipo: 'entrada', valor: gpEntradaValor, vencimento: gpHoje })
            }

            // 2. Generate installments
            var gpTotalParcComEntrada = gpParcelas + (gpEntradaValor > 0 ? 1 : 0)
            for (var gpi = 0; gpi < gpParcelas; gpi++) {
                gpNumero++
                // Calculate due date: next months from today, on the configured day
                var gpBaseDate = new Date()
                gpBaseDate.setMonth(gpBaseDate.getMonth() + gpi + 1)
                gpBaseDate.setDate(Math.min(gpDiaVenc, new Date(gpBaseDate.getFullYear(), gpBaseDate.getMonth() + 1, 0).getDate()))
                var gpVenc = gpBaseDate.toISOString().slice(0, 10)

                // Last parcela gets the remainder to handle rounding
                var gpVal = (gpi === gpParcelas - 1) ? Math.round((gpValorRestante - gpValorParcela * (gpParcelas - 1)) * 100) / 100 : gpValorParcela

                var gpAsaasResult = null
                if (gpGerarAsaas && gpFormaPag !== 'dinheiro' && gpFormaPag !== 'cheque') {
                    gpAsaasResult = await criarCobrancaAsaas(gpFormaPag, gpVal, gpVenc, 'Parcela ' + (gpi + 1) + '/' + gpParcelas + ' - Orçamento #' + gp.orcamento_id, (gpi + 1) + '/' + gpParcelas)
                }

                await client.execute({
                    sql: "INSERT INTO parcelas_orcamento(clinica_id, orcamento_id, paciente_id, numero_parcela, total_parcelas, valor, data_vencimento, forma_pagamento, status, tipo, cobranca_id, asaas_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    args: [clinica_id, gp.orcamento_id, gpO.paciente_id, gpNumero, gpTotalParcComEntrada, gpVal, gpVenc, gpFormaPag, 'pendente', 'parcela', gpAsaasResult ? gpAsaasResult.cobranca_id : null, gpAsaasResult ? gpAsaasResult.asaas_id : null]
                })
                gpParcelasGeradas.push({ numero: gpNumero, tipo: 'parcela', valor: gpVal, vencimento: gpVenc })
            }

            return res.status(200).json({ success: true, parcelas: gpParcelasGeradas, total: gpValorLiquido, entrada: gpEntradaValor, valor_parcela: gpValorParcela })
        }

        return res.status(400).json({ success: false, error: 'Rota inválida: r=' + route })

    } catch (error) {
        console.error('[data.js] r=' + (req.query.r||'?'), error.message)
        return res.status(500).json({ success: false, error: error.message })
    }
}
