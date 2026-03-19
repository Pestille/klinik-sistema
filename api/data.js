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
                client.execute("SELECT p.id,p.nome,p.telefone,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id GROUP BY p.id HAVING ultima_visita < date('now','-180 days') OR ultima_visita IS NULL ORDER BY ultima_visita ASC LIMIT 50"),
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
                sql = "SELECT p.id,p.nome,p.telefone,p.email,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id" + where + " GROUP BY p.id HAVING ultima_visita < date('now','-180 days') OR ultima_visita IS NULL ORDER BY ultima_visita ASC LIMIT ? OFFSET ?"
            } else if (status === 'ativos') {
                sql = "SELECT p.id,p.nome,p.telefone,p.email,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p INNER JOIN agendamentos a ON p.id=a.paciente_id" + where + " GROUP BY p.id HAVING ultima_visita >= date('now','-180 days') ORDER BY ultima_visita DESC LIMIT ? OFFSET ?"
            } else {
                sql = "SELECT p.id,p.nome,p.telefone,p.email,p.data_nascimento,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id" + where + " GROUP BY p.id ORDER BY p.nome ASC LIMIT ? OFFSET ?"
            }
            args.push(lim, off)
            var pr = await client.execute({ sql: sql, args: args })
            var tot = await client.execute('SELECT COUNT(*) as total FROM pacientes')
            return res.status(200).json({ success: true, data: pr.rows, total: tot.rows[0].total, page: page, limit: lim })
        }

        // ── AGENDAMENTOS ────────────────────────────────────────────────────
        if (route === 'agendamentos') {
            var lim2 = Math.min(parseInt(q.limit) || 200, 500)
            var base = "SELECT a.id,a.data_hora,a.tipo,a.status,a.procedimento,a.valor,a.observacoes,a.profissional_id,p.nome as paciente_nome,p.telefone as paciente_telefone,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id"
            var sqlAg, argsAg
            if (q.dataInicio && q.dataFim) {
                sqlAg = base + " WHERE DATE(a.data_hora) BETWEEN ? AND ? ORDER BY a.data_hora DESC LIMIT " + lim2
                argsAg = [q.dataInicio, q.dataFim]
            } else if (q.data) {
                sqlAg = base + " WHERE DATE(a.data_hora)=? ORDER BY a.data_hora"
                argsAg = [q.data]
            } else {
                var m = q.mes || new Date().toISOString().slice(0, 7)
                sqlAg = base + " WHERE strftime('%Y-%m',a.data_hora)=? ORDER BY a.data_hora DESC LIMIT " + lim2
                argsAg = [m]
            }
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
            var rc = await client.execute({ sql: "SELECT p.id,p.nome,p.telefone,p.email,MAX(a.data_hora) as ultima_visita,CAST(julianday('now')-julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id=a.paciente_id" + cw + having + " ORDER BY dias_ausente DESC LIMIT 200", args: ca })
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
            var ccr = await client.execute({ sql: "SELECT f.*,p.nome as paciente_nome FROM financeiro f LEFT JOIN pacientes p ON p.id=f.paciente_id WHERE f.data_pagamento >= ? AND f.data_pagamento <= ? ORDER BY f.data_pagamento ASC,f.id ASC", args: [ccde, ccate] })
            var totalE = 0, totalS = 0
            ccr.rows.forEach(function(r){ if (r.tipo==='entrada') totalE += (r.valor||0); else totalS += Math.abs(r.valor||0) })
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

        return res.status(400).json({ success: false, error: 'Rota inválida: r=' + route })

    } catch (error) {
        console.error('[data.js] r=' + (req.query.r||'?'), error.message)
        return res.status(500).json({ success: false, error: error.message })
    }
}
