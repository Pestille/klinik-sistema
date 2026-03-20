// api/data.js — Router consolidado (Turso DB)
// Schema real: agendamentos.data_hora, financeiro.data_pagamento, pacientes.criado_em

var { getClient } = require('./db')

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

    try {
        var client = getClient()

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
                client.execute('SELECT COUNT(*) as total FROM pacientes'),
                client.execute('SELECT COUNT(*) as total FROM profissionais WHERE ativo=1'),
                client.execute('SELECT COUNT(*) as total FROM agendamentos'),
                client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE DATE(data_hora)=?", args: [hoje] }),
                client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=?", args: [mesStr] }),
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE tipo='entrada' AND strftime('%Y-%m',data_pagamento)=?", args: [mesStr] }),
                client.execute("SELECT pr.id,pr.nome,pr.especialidade,COUNT(a.id) as total_agendamentos FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id GROUP BY pr.id ORDER BY total_agendamentos DESC"),
                client.execute("SELECT p.id,p.nome,p.telefone,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(DATE(MAX(a.data_hora))) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id GROUP BY p.id HAVING ultima_visita < date('now','-180 days') OR ultima_visita IS NULL ORDER BY ultima_visita ASC LIMIT 50"),
                client.execute("SELECT strftime('%Y-%m',data_hora) as mes,COUNT(*) as total FROM agendamentos WHERE data_hora >= date('now','-6 months') GROUP BY mes ORDER BY mes"),
                client.execute("SELECT tipo,COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo!='' GROUP BY tipo ORDER BY total DESC LIMIT 10"),
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
        if (route === 'pacientes') {
            var page = parseInt(q.page) || 1
            var lim = Math.min(parseInt(q.limit) || 50, 200)
            var off = (page - 1) * lim
            var busca = q.busca || q.q || ''
            var status = q.status || ''
            var where = '', args = []
            if (busca) { where = ' WHERE p.nome LIKE ? OR p.telefone LIKE ?'; args = ['%'+busca+'%','%'+busca+'%'] }
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
            var tot = await client.execute('SELECT COUNT(*) as total FROM pacientes')
            return res.status(200).json({ success: true, data: pr.rows, total: tot.rows[0].total, page: page, limit: lim })
        }

        // ── AGENDAMENTOS ────────────────────────────────────────────────────
        if (route === 'agendamentos') {
            var lim2 = Math.min(parseInt(q.limit) || 200, 500)
            var base = "SELECT a.id,a.data_hora,a.hora_fim,a.tipo,a.status,a.procedimento,a.valor,a.observacoes,a.profissional_id,COALESCE(p.nome,a.paciente_nome) as paciente_nome,COALESCE(p.telefone,a.paciente_telefone) as paciente_telefone,COALESCE(pr.nome,a.profissional_nome) as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id"
            var wheres = [], argsAg = []
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
                sqlAv = "SELECT a.*,p.nome as paciente_nome,p.telefone as paciente_telefone,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND a.profissional_id=? ORDER BY a.data_hora"
                argsAv = [d, q.profissional]
            } else {
                sqlAv = "SELECT a.*,p.nome as paciente_nome,p.telefone as paciente_telefone,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? ORDER BY pr.nome,a.data_hora"
                argsAv = [d]
            }
            var rav = await client.execute({ sql: sqlAv, args: argsAv })
            var profs3 = await client.execute('SELECT id,nome,especialidade FROM profissionais WHERE ativo=1 ORDER BY nome')
            return res.status(200).json({ success: true, agendamentos: rav.rows, profissionais: profs3.rows, data: d, total: rav.rows.length })
        }

        // ── PROFISSIONAIS ───────────────────────────────────────────────────
        if (route === 'profissionais') {
            var rpr = await client.execute("SELECT pr.*,COUNT(a.id) as total_agendamentos FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id GROUP BY pr.id ORDER BY pr.nome")
            return res.status(200).json({ success: true, data: rpr.rows, total: rpr.rows.length })
        }

        // ── FINANCEIRO ──────────────────────────────────────────────────────
        if (route === 'financeiro') {
            var fw = [], fa = []
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
            var cw = busca2 ? ' WHERE p.nome LIKE ?' : ''
            var ca = busca2 ? ['%'+busca2+'%'] : []
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
                var prod = await client.execute({ sql: "SELECT strftime('%Y-%m',data_hora) as mes,COUNT(*) as agendamentos FROM agendamentos WHERE data_hora >= date('now','-' || ? || ' months') GROUP BY mes ORDER BY mes", args: [meses2] })
                var rece = await client.execute({ sql: "SELECT strftime('%Y-%m',data_pagamento) as mes,SUM(valor) as receita FROM financeiro WHERE data_pagamento >= date('now','-' || ? || ' months') AND tipo='entrada' GROUP BY mes ORDER BY mes", args: [meses2] })
                return res.status(200).json({ success: true, tipo: 'producao', producao_mensal: prod.rows, receita_mensal: rece.rows })
            }
            if (tipo === 'procedimentos') {
                var procs = await client.execute("SELECT tipo,COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo!='' GROUP BY tipo ORDER BY total DESC LIMIT 15")
                return res.status(200).json({ success: true, tipo: 'procedimentos', data: procs.rows })
            }
            return res.status(200).json({ success: true, tipo: tipo, data: [] })
        }

        // ── BUSCA ───────────────────────────────────────────────────────────
        if (route === 'busca') {
            var bq = q.q || q.busca || ''
            if (bq.length < 2) return res.status(400).json({ success: false, error: 'Mínimo 2 caracteres' })
            var bt = '%' + bq + '%'
            var bp = await client.execute({ sql: "SELECT id,nome,telefone,email FROM pacientes WHERE nome LIKE ? OR telefone LIKE ? LIMIT 15", args: [bt, bt] })
            var ba = await client.execute({ sql: "SELECT a.id,a.data_hora,a.tipo,a.status,a.procedimento,p.nome as paciente_nome,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE p.nome LIKE ? ORDER BY a.data_hora DESC LIMIT 10", args: [bt] })
            return res.status(200).json({ success: true, pacientes: bp.rows, agendamentos: ba.rows, total: bp.rows.length + ba.rows.length })
        }

        // ── ANIVERSARIANTES ─────────────────────────────────────────────────
        if (route === 'aniversariantes') {
            var dias3 = parseInt(q.dias) || 60
            var anr = await client.execute("SELECT id,nome,telefone,email,data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento!=''")
            var hj = new Date()
            var anivs = []
            anr.rows.forEach(function(p) {
                try {
                    var n = new Date(p.data_nascimento + 'T12:00:00')
                    if (isNaN(n.getTime())) return
                    var prox = new Date(hj.getFullYear(), n.getMonth(), n.getDate())
                    if (prox < hj) prox.setFullYear(prox.getFullYear() + 1)
                    var df = Math.floor((prox - hj) / 864e5)
                    if (df >= 0 && df <= dias3) anivs.push({ id: p.id, nome: p.nome, telefone: p.telefone, data_nascimento: p.data_nascimento, dias_faltam: df, data_aniversario: prox.toISOString().slice(0, 10) })
                } catch(e) {}
            })
            anivs.sort(function(a, b){ return a.dias_faltam - b.dias_faltam })
            return res.status(200).json({ success: true, data: anivs, total: anivs.length })
        }

        // ── CONTA CORRENTE ──────────────────────────────────────────────────
        if (route === 'conta-corrente') {
            var ccde = q.de || (function(){ var d = new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) })()
            var ccate = q.ate || new Date().toISOString().slice(0, 10)
            // Union financeiro + pagamentos para ter todos os lançamentos
            var ccsql = "SELECT 'recibo' as origem, f.id, f.clinicorp_id, f.tipo, f.descricao, f.valor, f.data_pagamento, f.forma_pagamento, f.criado_em, p.nome as paciente_nome FROM financeiro f LEFT JOIN pacientes p ON p.id=f.paciente_id WHERE f.data_pagamento >= ? AND f.data_pagamento <= ? UNION ALL SELECT 'pagamento' as origem, pg.id, pg.clinicorp_id, CASE WHEN pg.cancelado=1 THEN 'cancelado' ELSE 'entrada' END as tipo, pg.descricao, pg.valor, pg.data_pagamento, pg.forma_pagamento, pg.criado_em, pg.paciente_nome FROM pagamentos pg WHERE pg.data_pagamento >= ? AND pg.data_pagamento <= ? AND pg.cancelado=0 ORDER BY data_pagamento ASC, criado_em ASC"
            var ccr = await client.execute({ sql: ccsql, args: [ccde, ccate, ccde, ccate] })
            var totalE = 0, totalS = 0
            ccr.rows.forEach(function(r){ var v = +(r.valor||0); if (r.tipo==='entrada'||v>0) totalE += Math.abs(v); else totalS += Math.abs(v) })
            return res.status(200).json({ success: true, data: ccr.rows, totais: { entradas: totalE, saidas: totalS, saldo: totalE-totalS }, periodo: { de: ccde, ate: ccate } })
        }

        // ── FLUXO DE CAIXA ──────────────────────────────────────────────────
        if (route === 'fluxo-caixa') {
            var fmes = parseInt(q.mes) || (new Date().getMonth() + 1)
            var fano = parseInt(q.ano) || new Date().getFullYear()
            var fmstr = fano + '-' + String(fmes).padStart(2, '0')
            var fdr = await client.execute({ sql: "SELECT data_pagamento as dia,tipo,SUM(valor) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? GROUP BY data_pagamento,tipo ORDER BY data_pagamento", args: [fmstr] })
            var fud = new Date(fano, fmes, 0).getDate()
            var fpd = [], fac = 0
            for (var fd = 1; fd <= fud; fd++) {
                var fds = fmstr + '-' + String(fd).padStart(2, '0')
                var fe = 0, fs = 0
                fdr.rows.forEach(function(r){ if (r.dia===fds) { if (r.tipo==='entrada') fe=r.total||0; else fs=Math.abs(r.total||0) } })
                fac += fe - fs
                fpd.push({ dia: fd, data: fds, entradas: fe, saidas: fs, saldo: fe-fs, acumulado: fac })
            }
            var fte = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada'", args: [fmstr] })
            var fts = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='saida'", args: [fmstr] })
            return res.status(200).json({ success: true, mes: fmes, ano: fano, por_dia: fpd, totais: { entradas: fte.rows[0].total, saidas: fts.rows[0].total, saldo: fte.rows[0].total - fts.rows[0].total } })
        }

        // ── METAS ───────────────────────────────────────────────────────────
        if (route === 'metas') {
            var mm = parseInt(q.mes) || (new Date().getMonth() + 1)
            var ma = parseInt(q.ano) || new Date().getFullYear()
            var mstr = ma + '-' + String(mm).padStart(2, '0')
            var mpr = await client.execute({ sql: "SELECT pr.*,COUNT(a.id) as agendamentos_mes FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id AND strftime('%Y-%m',a.data_hora)=? AND a.status!='cancelado' GROUP BY pr.id ORDER BY agendamentos_mes DESC", args: [mstr] })
            var mtm = await client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND status!='cancelado'", args: [mstr] })
            var mrm = await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada'", args: [mstr] })
            return res.status(200).json({ success: true, mes: mm, ano: ma, resumo_mes: { agendamentos: mtm.rows[0].total, receita: mrm.rows[0].total }, profissionais: mpr.rows })
        }

        // ── PAGAMENTOS ─────────────────────────────────────────────────
        if (route === 'pagamentos') {
            var pw = [], pa = []
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
            var esql = "SELECT 'recibo' as origem, clinicorp_id, descricao, valor, data_pagamento as data, 'entrada' as tipo_mov, NULL as forma, NULL as bandeira FROM financeiro WHERE data_pagamento >= ? AND data_pagamento <= ? UNION ALL SELECT 'pagamento' as origem, clinicorp_id, descricao, valor, data_pagamento as data, CASE WHEN cancelado=1 THEN 'cancelado' ELSE 'entrada' END as tipo_mov, forma_pagamento as forma, bandeira FROM pagamentos WHERE data_pagamento >= ? AND data_pagamento <= ? AND cancelado=0 ORDER BY data DESC, origem"
            var er = await client.execute({ sql: esql, args: [ede, eate, ede, eate] })
            return res.status(200).json({ success: true, data: er.rows, periodo: { de: ede, ate: eate }, total: er.rows.length })
        }

        // ── DASHBOARD ANALÍTICO (dados reais por mês) ─────────────────
        if (route === 'dashboard-analitico') {
            var meses3 = []
            var now2 = new Date()
            for (var mi = 2; mi >= 0; mi--) {
                var dd = new Date(now2.getFullYear(), now2.getMonth() - mi, 1)
                meses3.push(dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0'))
            }
            var result = { meses: meses3, por_mes: {} }
            for (var mx = 0; mx < meses3.length; mx++) {
                var mm = meses3[mx]
                var rs3 = await Promise.all([
                    // Agendamentos totais do mês
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=?", args: [mm] }),
                    // Cancelados
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND status='cancelado'", args: [mm] }),
                    // Faltas
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND (status LIKE '%falt%' OR status='faltou')", args: [mm] }),
                    // Primeiras consultas (tipo contém 'Avaliação' ou primeiro agendamento)
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND (tipo LIKE '%Avaliação%' OR tipo LIKE '%avaliacao%')", args: [mm] }),
                    // Receita entrada (pagamentos)
                    client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0", args: [mm] }),
                    // Receita saída (financeiro tipo=saida)
                    client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='saida'", args: [mm] }),
                    // Recibos
                    client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE strftime('%Y-%m',data_pagamento)=? AND tipo='entrada'", args: [mm] }),
                    // Pagamentos confirmados
                    client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND confirmado=1", args: [mm] }),
                    // Pagamentos pendentes
                    client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND confirmado=0 AND cancelado=0", args: [mm] }),
                    // Categorias agendadas
                    client.execute({ sql: "SELECT tipo, COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND tipo IS NOT NULL AND tipo!='' GROUP BY tipo ORDER BY total DESC LIMIT 10", args: [mm] }),
                    // Total pagamentos (qtd)
                    client.execute({ sql: "SELECT COUNT(*) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0", args: [mm] }),
                    // Parcelas
                    client.execute({ sql: "SELECT COALESCE(SUM(parcelas),0) as total, COUNT(*) as qtd FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND parcelas>0", args: [mm] }),
                    // Faltas primeiras consultas
                    client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? AND (tipo LIKE '%Avaliação%') AND (status LIKE '%falt%' OR status='faltou')", args: [mm] }),
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
                }
            }
            return res.status(200).json({ success: true, ...result })
        }

        // ── ANALYTICS (Dashboard completo) ────────────────────────────
        if (route === 'analytics') {
            var mesAtual = new Date().toISOString().slice(0, 7)
            var mesAnt = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7)
            var rs = await Promise.all([
                client.execute("SELECT COUNT(*) as total FROM pacientes"),
                client.execute("SELECT COUNT(DISTINCT p.id) as total FROM pacientes p INNER JOIN agendamentos a ON p.id=a.paciente_id WHERE a.data_hora >= date('now','-180 days')"),
                client.execute("SELECT COUNT(DISTINCT p.id) as total FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id GROUP BY p.id HAVING MAX(a.data_hora) < date('now','-180 days') OR MAX(a.data_hora) IS NULL"),
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE tipo='entrada' AND strftime('%Y-%m',data_pagamento)=?", args: [mesAtual] }),
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM financeiro WHERE tipo='entrada' AND strftime('%Y-%m',data_pagamento)=?", args: [mesAnt] }),
                client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=?", args: [mesAtual] }),
                client.execute({ sql: "SELECT COUNT(*) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0", args: [mesAtual] }),
                client.execute({ sql: "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0", args: [mesAtual] }),
                // Receita por forma de pagamento
                client.execute({ sql: "SELECT forma_pagamento, COUNT(*) as qtd, SUM(valor) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 GROUP BY forma_pagamento ORDER BY total DESC", args: [mesAtual] }),
                // Evolução receita 6 meses
                client.execute("SELECT strftime('%Y-%m',data_pagamento) as mes, SUM(valor) as total FROM pagamentos WHERE data_pagamento >= date('now','-6 months') AND cancelado=0 GROUP BY mes ORDER BY mes"),
                // Top procedimentos
                client.execute("SELECT tipo, COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo!='' GROUP BY tipo ORDER BY total DESC LIMIT 10"),
                // Produção por profissional
                client.execute("SELECT pr.nome, COUNT(a.id) as agendamentos, COALESCE(SUM(a.valor),0) as receita FROM profissionais pr LEFT JOIN agendamentos a ON pr.id=a.profissional_id AND a.data_hora >= date('now','-30 days') WHERE pr.ativo=1 GROUP BY pr.id ORDER BY agendamentos DESC"),
                // Status agendamentos mês
                client.execute({ sql: "SELECT status, COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_hora)=? GROUP BY status", args: [mesAtual] }),
                // Faixa etária
                client.execute("SELECT CASE WHEN data_nascimento IS NULL OR data_nascimento='' THEN 'N/I' WHEN CAST((julianday('now')-julianday(data_nascimento))/365.25 AS INT)<18 THEN '0-17' WHEN CAST((julianday('now')-julianday(data_nascimento))/365.25 AS INT)<30 THEN '18-29' WHEN CAST((julianday('now')-julianday(data_nascimento))/365.25 AS INT)<45 THEN '30-44' WHEN CAST((julianday('now')-julianday(data_nascimento))/365.25 AS INT)<60 THEN '45-59' ELSE '60+' END as faixa, COUNT(*) as total FROM pacientes GROUP BY faixa ORDER BY faixa"),
                // Novos pacientes por mês
                client.execute("SELECT strftime('%Y-%m',criado_em) as mes, COUNT(*) as total FROM pacientes WHERE criado_em >= date('now','-6 months') GROUP BY mes ORDER BY mes"),
                // Ticket médio
                client.execute({ sql: "SELECT AVG(valor) as ticket FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND valor>0", args: [mesAtual] }),
                // Bandeira cartão
                client.execute({ sql: "SELECT bandeira, COUNT(*) as qtd, SUM(valor) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 AND bandeira!='' GROUP BY bandeira ORDER BY total DESC", args: [mesAtual] }),
                // Parcelas
                client.execute({ sql: "SELECT parcelas, COUNT(*) as qtd, SUM(valor) as total FROM pagamentos WHERE strftime('%Y-%m',data_pagamento)=? AND cancelado=0 GROUP BY parcelas ORDER BY parcelas", args: [mesAtual] }),
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
                client.execute("SELECT como_conheceu, COUNT(*) as total FROM pacientes WHERE como_conheceu IS NOT NULL AND como_conheceu!='' GROUP BY como_conheceu ORDER BY total DESC"),
                // Aniversariantes do mês
                client.execute("SELECT id,nome,telefone,email,data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento!=''"),
                // Inativos por faixa
                client.execute("SELECT CASE WHEN dias>365 THEN 'Crítico (+1 ano)' WHEN dias>270 THEN 'Urgente (+9m)' WHEN dias>180 THEN 'Atenção (+6m)' ELSE 'Recente' END as faixa, COUNT(*) as total FROM (SELECT CAST(julianday('now')-julianday(MAX(a.data_hora)) AS INT) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id=a.paciente_id GROUP BY p.id HAVING dias>180) GROUP BY faixa ORDER BY total DESC"),
                // Novos por mês (6 meses)
                client.execute("SELECT strftime('%Y-%m',criado_em) as mes, COUNT(*) as total FROM pacientes WHERE criado_em >= date('now','-6 months') GROUP BY mes ORDER BY mes"),
                // Top pacientes por receita
                client.execute("SELECT paciente_nome, COUNT(*) as pagamentos, SUM(valor) as total FROM pagamentos WHERE cancelado=0 AND paciente_nome IS NOT NULL GROUP BY paciente_nome ORDER BY total DESC LIMIT 10"),
                // Retenção: ativos vs total
                client.execute("SELECT COUNT(*) as total, SUM(CASE WHEN ultima < date('now','-180 days') OR ultima IS NULL THEN 1 ELSE 0 END) as inativos FROM (SELECT MAX(a.data_hora) as ultima FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id GROUP BY p.id)"),
                // Procedimentos mais lucrativos
                client.execute("SELECT tipo, COUNT(*) as qtd, COALESCE(SUM(valor),0) as receita FROM agendamentos WHERE tipo IS NOT NULL AND tipo!='' AND valor>0 GROUP BY tipo ORDER BY receita DESC LIMIT 8"),
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
            await client.execute({ sql: "INSERT INTO pacientes(nome,cpf,telefone,whatsapp,email,data_nascimento,sexo,estado_civil,como_conheceu,endereco,bairro,cidade,cep,convenio,alerta_medico,ativo,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))", args: [b.nome, b.cpf||'', b.telefone||'', b.whatsapp||'', b.email||'', b.data_nascimento||'', b.sexo||'', b.estado_civil||'', b.como_conheceu||'', b.endereco||'', b.bairro||'', b.cidade||'', b.cep||'', b.convenio||'', b.alerta_medico||''] })
            return res.status(200).json({ success: true, msg: 'Paciente salvo' })
        }

        // ── PROCEDIMENTOS (lista para selects) ────────────────────────
        if (route === 'procedimentos') {
            var ptab = q.tabela || ''
            var pw2 = ptab ? ' WHERE tabela_preco=?' : ''
            var pa2 = ptab ? [ptab] : []
            var prc = await client.execute({ sql: "SELECT * FROM procedimentos" + pw2 + " WHERE ativo=1 ORDER BY tabela_preco,descricao".replace('WHERE ativo','AND ativo').replace(' WHERE tabela_preco=? AND',' WHERE tabela_preco=? AND').replace(' WHERE ativo=1',' WHERE ativo=1'), args: pa2 })
            // Fix: handle WHERE correctly
            var sqlProc = ptab ? "SELECT * FROM procedimentos WHERE tabela_preco=? AND ativo=1 ORDER BY tabela_preco,descricao" : "SELECT * FROM procedimentos WHERE ativo=1 ORDER BY tabela_preco,descricao"
            var prcr = await client.execute({ sql: sqlProc, args: pa2 })
            var tabelas2 = await client.execute("SELECT DISTINCT tabela_preco FROM procedimentos WHERE ativo=1 ORDER BY tabela_preco")
            return res.status(200).json({ success: true, data: prcr.rows, total: prcr.rows.length, tabelas: tabelas2.rows.map(function(t){return t.tabela_preco}) })
        }

        // ── ANIVERSARIANTES DO MÊS ───────────────────────────────────
        if (route === 'aniversariantes-mes') {
            var ames = parseInt(q.mes) || (new Date().getMonth() + 1)
            var aanr = await client.execute("SELECT id,nome,telefone,email,data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento!=''")
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
            await client.execute({ sql: "INSERT INTO financeiro(tipo,descricao,valor,data_pagamento,forma_pagamento,status,criado_em,atualizado_em) VALUES(?,?,?,?,?,'manual',datetime('now'),datetime('now'))", args: [lb.tipo||'entrada', lb.descricao||'', lb.valor, lb.data_pagamento, lb.forma_pagamento||''] })
            return res.status(200).json({ success: true, msg: 'Lançamento salvo' })
        }

        return res.status(400).json({ success: false, error: 'Rota inválida: r=' + route })

    } catch (error) {
        console.error('[data.js] r=' + (req.query.r||'?'), error.message)
        return res.status(500).json({ success: false, error: error.message })
    }
}
