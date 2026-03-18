// api/data.js — Router de dados (consolida todas as consultas)
// USO: /api/data?r=dashboard
//      /api/data?r=pacientes&busca=silva&status=ativos
//      /api/data?r=agendamentos&data=2026-03-14
//      /api/data?r=agenda-view&modo=dia&data=2026-03-14
//      /api/data?r=profissionais
//      /api/data?r=financeiro&de=2026-03-01&ate=2026-03-15
//      /api/data?r=crc&prioridade=urgente
//      /api/data?r=relatorios&tipo=producao
//      /api/data?r=busca&q=carlos
//      /api/data?r=aniversariantes
//      /api/data?r=conta-corrente&de=X&ate=X
//      /api/data?r=fluxo-caixa&mes=3&ano=2026
//      /api/data?r=metas&mes=3&ano=2026
//      /api/data?r=db-status

var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var q = req.query || {}
    var route = q.r || ''

    try {
        var client = getClient()

        // ═══ DB-STATUS ═══
        if (route === 'db-status') {
            var start = Date.now()
            await client.execute('SELECT 1')
            var lat = Date.now() - start
            var tabs = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            var counts = {}
            for (var i = 0; i < tabs.rows.length; i++) {
                try { var cr = await client.execute('SELECT COUNT(*) as total FROM ' + tabs.rows[i].name); counts[tabs.rows[i].name] = cr.rows[0].total } catch(e) { counts[tabs.rows[i].name] = 'erro' }
            }
            var ls = null; try { var sr = await client.execute('SELECT tabela, operacao, registros_processados, finalizado_em FROM sync_log ORDER BY id DESC LIMIT 1'); if (sr.rows.length > 0) ls = sr.rows[0] } catch(e) {}
            return res.status(200).json({ status: 'online', banco: 'Turso (libSQL)', latencia_ms: lat, tabelas: counts, total_tabelas: tabs.rows.length, ultimo_sync: ls, timestamp: new Date().toISOString() })
        }

        // ═══ DASHBOARD ═══
        if (route === 'dashboard') {
            var pc = await client.execute('SELECT COUNT(*) as total FROM pacientes')
            var prc = await client.execute('SELECT COUNT(*) as total FROM profissionais')
            var ac = await client.execute('SELECT COUNT(*) as total FROM agendamentos')
            var fc = await client.execute('SELECT COUNT(*) as total FROM financeiro')
            var rec = await client.execute("SELECT COALESCE(SUM(valor), 0) as total FROM financeiro WHERE tipo = 'entrada'")
            var hoje = new Date().toISOString().slice(0, 10)
            var ah = await client.execute({ sql: 'SELECT COUNT(*) as total FROM agendamentos WHERE data_hora LIKE ?', args: [hoje + '%'] })
            var pm = await client.execute("SELECT substr(data_hora, 1, 7) as mes, COUNT(*) as total FROM agendamentos WHERE data_hora >= date('now', '-6 months') GROUP BY mes ORDER BY mes")
            var pcat = await client.execute("SELECT tipo as categoria, COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo != '' GROUP BY tipo ORDER BY total DESC LIMIT 10")
            var inat = await client.execute("SELECT p.id, p.nome, p.telefone, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING ultima_visita < date('now', '-180 days') OR ultima_visita IS NULL ORDER BY ultima_visita ASC LIMIT 100")
            var profs = await client.execute("SELECT pr.id, pr.nome, pr.especialidade, COUNT(a.id) as total_agendamentos FROM profissionais pr LEFT JOIN agendamentos a ON pr.id = a.profissional_id GROUP BY pr.id ORDER BY total_agendamentos DESC")
            var lsync = await client.execute('SELECT tabela, operacao, registros_processados, finalizado_em FROM sync_log ORDER BY id DESC LIMIT 5')
            return res.status(200).json({ success: true, resumo: { total_pacientes: pc.rows[0].total, total_profissionais: prc.rows[0].total, total_agendamentos: ac.rows[0].total, total_financeiro: fc.rows[0].total, receita_total: rec.rows[0].total, agendamentos_hoje: ah.rows[0].total }, agendamentos_por_mes: pm.rows, agendamentos_por_categoria: pcat.rows, inativos: inat.rows, profissionais: profs.rows, ultimos_syncs: lsync.rows })
        }

        // ═══ PACIENTES ═══
        if (route === 'pacientes') {
            if (q.id) {
                var pac = await client.execute({ sql: 'SELECT * FROM pacientes WHERE id = ?', args: [parseInt(q.id)] })
                if (pac.rows.length === 0) return res.status(404).json({ success: false, error: 'Nao encontrado' })
                var pags = await client.execute({ sql: "SELECT a.id, a.data_hora, a.tipo as categoria, a.status, a.procedimento, pr.nome as profissional FROM agendamentos a LEFT JOIN profissionais pr ON a.profissional_id = pr.id WHERE a.paciente_id = ? ORDER BY a.data_hora DESC LIMIT 50", args: [parseInt(q.id)] })
                var pfin = await client.execute({ sql: "SELECT * FROM financeiro WHERE paciente_id = ? ORDER BY data_pagamento DESC LIMIT 20", args: [parseInt(q.id)] })
                return res.status(200).json({ success: true, paciente: pac.rows[0], agendamentos: pags.rows, financeiro: pfin.rows })
            }
            var page = parseInt(q.page) || 1, limit = Math.min(parseInt(q.limit) || 50, 200), offset = (page - 1) * limit
            var sql, csql, args = [], cargs = []
            if (q.status === 'inativos') {
                sql = "SELECT p.id, p.nome, p.telefone, p.email, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id" + (q.busca ? " WHERE p.nome LIKE ?" : "") + " GROUP BY p.id HAVING ultima_visita < date('now', '-180 days') OR ultima_visita IS NULL ORDER BY ultima_visita ASC LIMIT ? OFFSET ?"
                csql = "SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id" + (q.busca ? " WHERE p.nome LIKE ?" : "") + " GROUP BY p.id HAVING MAX(a.data_hora) < date('now', '-180 days') OR MAX(a.data_hora) IS NULL)"
                if (q.busca) { args.push('%' + q.busca + '%'); cargs.push('%' + q.busca + '%') }
            } else if (q.status === 'ativos') {
                sql = "SELECT p.id, p.nome, p.telefone, p.email, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id" + (q.busca ? " WHERE p.nome LIKE ?" : "") + " GROUP BY p.id HAVING ultima_visita >= date('now', '-180 days') ORDER BY ultima_visita DESC LIMIT ? OFFSET ?"
                csql = "SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id" + (q.busca ? " WHERE p.nome LIKE ?" : "") + " GROUP BY p.id HAVING MAX(a.data_hora) >= date('now', '-180 days'))"
                if (q.busca) { args.push('%' + q.busca + '%'); cargs.push('%' + q.busca + '%') }
            } else {
                sql = "SELECT p.id, p.nome, p.telefone, p.email, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id" + (q.busca ? " WHERE p.nome LIKE ?" : "") + " GROUP BY p.id ORDER BY p.nome ASC LIMIT ? OFFSET ?"
                csql = "SELECT COUNT(*) as total FROM pacientes p" + (q.busca ? " WHERE p.nome LIKE ?" : "")
                if (q.busca) { args.push('%' + q.busca + '%'); cargs.push('%' + q.busca + '%') }
            }
            args.push(limit); args.push(offset)
            var result = await client.execute({ sql: sql, args: args })
            var countR = await client.execute({ sql: csql, args: cargs })
            var totalP = await client.execute('SELECT COUNT(*) as total FROM pacientes')
            var totalI = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING MAX(a.data_hora) < date('now', '-180 days') OR MAX(a.data_hora) IS NULL)")
            return res.status(200).json({ success: true, data: result.rows, paginacao: { page: page, limit: limit, total: countR.rows[0].total, totalPages: Math.ceil(countR.rows[0].total / limit) }, resumo: { total_pacientes: totalP.rows[0].total, total_inativos: totalI.rows[0].total, total_ativos: totalP.rows[0].total - totalI.rows[0].total } })
        }

        // ═══ AGENDA-VIEW ═══
        if (route === 'agenda-view') {
            var modo = q.modo || 'dia'
            var where = [], aargs = []
            if (modo === 'dia') { where.push("a.data_hora LIKE ?"); aargs.push((q.data || new Date().toISOString().slice(0, 10)) + '%') }
            else if (modo === 'semana') { var bd = new Date((q.data || new Date().toISOString().slice(0, 10)) + 'T12:00:00'); var dow = bd.getDay(); var seg = new Date(bd); seg.setDate(seg.getDate() - (dow === 0 ? 6 : dow - 1)); var dom = new Date(seg); dom.setDate(dom.getDate() + 6); where.push("a.data_hora >= ? AND a.data_hora <= ?"); aargs.push(seg.toISOString().slice(0, 10)); aargs.push(dom.toISOString().slice(0, 10) + ' 23:59') }
            else if (modo === 'mes') { where.push("a.data_hora LIKE ?"); aargs.push((q.mes || new Date().toISOString().slice(0, 7)) + '%') }
            if (q.profissional) { where.push("a.profissional_id = ?"); aargs.push(parseInt(q.profissional)) }
            where.push("a.status != 'cancelado'")
            var wc = ' WHERE ' + where.join(' AND ')
            var agr = await client.execute({ sql: "SELECT a.id, a.data_hora, a.tipo as categoria, a.status, a.procedimento as paciente_nome, a.observacoes, a.profissional_id, pr.nome as profissional_nome FROM agendamentos a LEFT JOIN profissionais pr ON a.profissional_id = pr.id" + wc + " ORDER BY a.data_hora ASC LIMIT 1000", args: aargs })
            var profs2 = await client.execute("SELECT id, nome, especialidade FROM profissionais ORDER BY nome")
            var total = agr.rows.length, conf = agr.rows.filter(function(a) { return a.status === 'confirmado' }).length, aged = agr.rows.filter(function(a) { return a.status === 'agendado' }).length
            return res.status(200).json({ success: true, modo: modo, agendamentos: agr.rows, profissionais: profs2.rows, resumo: { total: total, confirmados: conf, agendados: aged } })
        }

        // ═══ PROFISSIONAIS ═══
        if (route === 'profissionais') {
            if (q.id) {
                var prof = await client.execute({ sql: 'SELECT * FROM profissionais WHERE id = ?', args: [parseInt(q.id)] })
                return res.status(200).json({ success: true, profissional: prof.rows[0] || null })
            }
            var pr = await client.execute("SELECT pr.id, pr.nome, pr.clinicorp_id, pr.cro, pr.especialidade, pr.ativo, COUNT(a.id) as total_agendamentos, COUNT(CASE WHEN a.data_hora >= date('now', '-30 days') THEN 1 END) as agendamentos_mes FROM profissionais pr LEFT JOIN agendamentos a ON pr.id = a.profissional_id GROUP BY pr.id ORDER BY total_agendamentos DESC")
            return res.status(200).json({ success: true, data: pr.rows, total: pr.rows.length })
        }

        // ═══ FINANCEIRO ═══
        if (route === 'financeiro') {
            var fw = [], fa = []
            if (q.de) { fw.push("f.data_pagamento >= ?"); fa.push(q.de) }
            if (q.ate) { fw.push("f.data_pagamento <= ?"); fa.push(q.ate) }
            if (q.tipo) { fw.push("f.tipo = ?"); fa.push(q.tipo) }
            if (q.busca) { fw.push("f.descricao LIKE ?"); fa.push('%' + q.busca + '%') }
            var fwc = fw.length > 0 ? ' WHERE ' + fw.join(' AND ') : ''
            var flim = Math.min(parseInt(q.limit) || 100, 500)
            var fr = await client.execute({ sql: "SELECT f.id, f.tipo, f.descricao, f.valor, f.data_pagamento, f.forma_pagamento, f.status FROM financeiro f" + fwc + " ORDER BY f.data_pagamento DESC LIMIT ?", args: fa.concat([flim]) })
            var ft = await client.execute({ sql: "SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) as total_entradas, COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END), 0) as total_saidas, COALESCE(SUM(valor), 0) as total_geral, COUNT(*) as total_registros FROM financeiro f" + fwc, args: fa })
            return res.status(200).json({ success: true, data: fr.rows, totais: ft.rows[0] })
        }

        // ═══ CRC ═══
        if (route === 'crc') {
            var csql2 = "SELECT p.id, p.nome, p.telefone, p.email, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id"
            var chav = " GROUP BY p.id HAVING ultima_visita < date('now', '-180 days') OR ultima_visita IS NULL"
            var ca = []
            if (q.busca) { csql2 += " WHERE p.nome LIKE ?"; ca.push('%' + q.busca + '%') }
            csql2 += chav
            if (q.prioridade === 'urgente') csql2 += " AND dias_ausente > 365"
            else if (q.prioridade === 'alta') csql2 += " AND dias_ausente > 270 AND dias_ausente <= 365"
            else if (q.prioridade === 'media') csql2 += " AND dias_ausente > 180 AND dias_ausente <= 270"
            csql2 += " ORDER BY dias_ausente DESC LIMIT 200"
            var cr2 = await client.execute({ sql: csql2, args: ca })
            var urg = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 365 OR MAX(a.data_hora) IS NULL)")
            var alt = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 270 AND dias <= 365)")
            var med = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 180 AND dias <= 270)")
            var cdata = cr2.rows.map(function(p) { var pr = 'media'; if (p.dias_ausente > 365 || !p.ultima_visita) pr = 'urgente'; else if (p.dias_ausente > 270) pr = 'alta'; return { id: p.id, nome: p.nome, telefone: p.telefone, email: p.email, ultima_visita: p.ultima_visita, dias_ausente: p.dias_ausente, prioridade: pr } })
            return res.status(200).json({ success: true, data: cdata, total: cdata.length, contagens: { urgente: urg.rows[0].total, alta: alt.rows[0].total, media: med.rows[0].total, total: urg.rows[0].total + alt.rows[0].total + med.rows[0].total } })
        }

        // ═══ RELATORIOS ═══
        if (route === 'relatorios') {
            var tipo = q.tipo || 'producao'
            if (tipo === 'producao') {
                var meses = parseInt(q.meses) || 6
                var prod = await client.execute({ sql: "SELECT substr(data_hora, 1, 7) as mes, COUNT(*) as agendamentos FROM agendamentos WHERE data_hora >= date('now', '-' || ? || ' months') GROUP BY mes ORDER BY mes", args: [meses] })
                var rece = await client.execute({ sql: "SELECT substr(data_pagamento, 1, 7) as mes, SUM(valor) as receita FROM financeiro WHERE data_pagamento >= date('now', '-' || ? || ' months') GROUP BY mes ORDER BY mes", args: [meses] })
                return res.status(200).json({ success: true, tipo: 'producao', producao_mensal: prod.rows, receita_mensal: rece.rows })
            }
            if (tipo === 'procedimentos') {
                var procs = await client.execute("SELECT tipo as categoria, COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo != '' GROUP BY tipo ORDER BY total DESC LIMIT 15")
                return res.status(200).json({ success: true, tipo: 'procedimentos', data: procs.rows })
            }
            if (tipo === 'inativos') {
                var u = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 365 OR MAX(a.data_hora) IS NULL)")
                var a2 = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 270 AND dias <= 365)")
                var m2 = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 180 AND dias <= 270)")
                return res.status(200).json({ success: true, tipo: 'inativos', urgente: u.rows[0].total, alta: a2.rows[0].total, media: m2.rows[0].total })
            }
            return res.status(200).json({ success: true, tipo: tipo, data: [] })
        }

        // ═══ BUSCA ═══
        if (route === 'busca') {
            var bq = q.q || ''; if (bq.length < 2) return res.status(400).json({ success: false, error: 'Min 2 chars' })
            var bt = '%' + bq + '%'
            var bp = await client.execute({ sql: "SELECT id, nome, telefone FROM pacientes WHERE nome LIKE ? LIMIT 10", args: [bt] })
            var ba = await client.execute({ sql: "SELECT a.id, a.data_hora, a.tipo as categoria, a.procedimento as paciente_nome FROM agendamentos a WHERE a.procedimento LIKE ? ORDER BY a.data_hora DESC LIMIT 10", args: [bt] })
            return res.status(200).json({ success: true, busca: bq, pacientes: bp.rows, agendamentos: ba.rows, total: bp.rows.length + ba.rows.length })
        }

        // ═══ ANIVERSARIANTES ═══
        if (route === 'aniversariantes') {
            var anr = await client.execute("SELECT id, nome, telefone, data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento != ''")
            var hj = new Date(); var adias = parseInt(q.dias) || 60; var anivs = []
            anr.rows.forEach(function(p) { try { var n = new Date(p.data_nascimento + 'T12:00:00'); if (isNaN(n.getTime())) return; var px = new Date(hj.getFullYear(), n.getMonth(), n.getDate()); if (px < hj) px.setFullYear(px.getFullYear() + 1); var df = Math.floor((px - hj) / 864e5); if (df >= 0 && df <= adias) anivs.push({ id: p.id, nome: p.nome, telefone: p.telefone, data_nascimento: p.data_nascimento, dia_aniversario: px.toISOString().slice(0, 10), dias_faltam: df }) } catch(e) {} })
            anivs.sort(function(a, b) { return a.dias_faltam - b.dias_faltam })
            return res.status(200).json({ success: true, data: anivs, total: anivs.length })
        }

        // ═══ CONTA CORRENTE ═══
        if (route === 'conta-corrente') {
            var cate = q.ate || new Date().toISOString().slice(0, 10)
            var cde = q.de; if (!cde) { var cd = new Date(); cd.setDate(cd.getDate() - 7); cde = cd.toISOString().slice(0, 10) }
            var ccr = await client.execute({ sql: "SELECT f.id, f.tipo, f.descricao, f.valor, f.data_pagamento, f.forma_pagamento FROM financeiro f WHERE f.data_pagamento >= ? AND f.data_pagamento <= ? ORDER BY f.data_pagamento ASC", args: [cde, cate] })
            var DSM = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']
            var MAB = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ']
            var cdias = {}, cte = 0, cts = 0
            ccr.rows.forEach(function(f) {
                var dia = f.data_pagamento || 'x'; if (!cdias[dia]) { var dt = new Date(dia + 'T12:00:00'); cdias[dia] = { data: dia, dia_num: dt.getDate(), mes_abr: MAB[dt.getMonth()] || '?', dia_semana: DSM[dt.getDay()] || '?', entradas: 0, saidas: 0, transacoes: [] } }
                var val = Math.abs(f.valor || 0); var fp = (f.forma_pagamento || '').toLowerCase(); var badge = ''
                if (fp.indexOf('boleto') >= 0) badge = 'boleto'; else if (fp.indexOf('cr') >= 0) badge = 'credito'; else if (fp.indexOf('pix') >= 0) badge = 'pix'; else if (fp.indexOf('transf') >= 0) badge = 'transf'; else if (fp.indexOf('dinheiro') >= 0) badge = 'dinheiro'
                if (f.tipo === 'entrada') { cdias[dia].entradas += val; cte += val } else { cdias[dia].saidas += val; cts += val }
                cdias[dia].transacoes.push({ tipo: f.tipo === 'entrada' ? 'Entrada' : 'Saída', badge: badge, descricao: f.descricao || '', valor: val, positivo: f.tipo === 'entrada' })
            })
            return res.status(200).json({ success: true, periodo: { de: cde, ate: cate }, totais: { entradas: cte, saidas: cts, saldo: cte - cts }, dias: Object.values(cdias).sort(function(a, b) { return a.data.localeCompare(b.data) }) })
        }

        // ═══ FLUXO DE CAIXA ═══
        if (route === 'fluxo-caixa') {
            var fmes = parseInt(q.mes) || (new Date().getMonth() + 1)
            var fano = parseInt(q.ano) || new Date().getFullYear()
            var fmstr = fano + '-' + String(fmes).padStart(2, '0')
            var fdr = await client.execute({ sql: "SELECT data_pagamento as dia, tipo, SUM(valor) as total FROM financeiro WHERE data_pagamento LIKE ? GROUP BY data_pagamento, tipo ORDER BY data_pagamento", args: [fmstr + '%'] })
            var fud = new Date(fano, fmes, 0).getDate(); var fpd = []; var fac = 0
            for (var fd = 1; fd <= fud; fd++) { var fds = fmstr + '-' + String(fd).padStart(2, '0'); var fe = 0, fs = 0; fdr.rows.forEach(function(r) { if (r.dia === fds) { if (r.tipo === 'entrada') fe = r.total || 0; else fs = Math.abs(r.total || 0) } }); fac += fe - fs; fpd.push({ dia: fd, data: fds, entradas: fe, saidas: fs, saldo: fe - fs, acumulado: fac }) }
            var fte = await client.execute({ sql: "SELECT COALESCE(SUM(valor), 0) as total FROM financeiro WHERE data_pagamento LIKE ? AND tipo = 'entrada'", args: [fmstr + '%'] })
            var fts = await client.execute({ sql: "SELECT COALESCE(SUM(ABS(valor)), 0) as total FROM financeiro WHERE data_pagamento LIKE ? AND tipo = 'saida'", args: [fmstr + '%'] })
            var fpf = await client.execute({ sql: "SELECT forma_pagamento, SUM(valor) as total FROM financeiro WHERE data_pagamento LIKE ? AND tipo = 'entrada' GROUP BY forma_pagamento ORDER BY total DESC", args: [fmstr + '%'] })
            return res.status(200).json({ success: true, mes: fmes, ano: fano, por_dia: fpd, totais: { entradas: fte.rows[0].total, saidas: fts.rows[0].total, saldo: fte.rows[0].total - fts.rows[0].total }, resumo_entradas: fpf.rows })
        }

        // ═══ METAS ═══
        if (route === 'metas') {
            var mm = parseInt(q.mes) || (new Date().getMonth() + 1)
            var ma = parseInt(q.ano) || new Date().getFullYear()
            var mstr = ma + '-' + String(mm).padStart(2, '0')
            var mpr = await client.execute({ sql: "SELECT pr.id, pr.nome, pr.especialidade, COUNT(a.id) as agendamentos_mes, COUNT(DISTINCT a.procedimento) as pacientes_mes FROM profissionais pr LEFT JOIN agendamentos a ON pr.id = a.profissional_id AND a.data_hora LIKE ? AND a.status != 'cancelado' GROUP BY pr.id ORDER BY agendamentos_mes DESC", args: [mstr + '%'] })
            var mtm = await client.execute({ sql: "SELECT COUNT(*) as agendamentos FROM agendamentos WHERE data_hora LIKE ? AND status != 'cancelado'", args: [mstr + '%'] })
            var mrm = await client.execute({ sql: "SELECT COALESCE(SUM(valor), 0) as total FROM financeiro WHERE data_pagamento LIKE ? AND tipo = 'entrada'", args: [mstr + '%'] })
            var MSPT = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
            return res.status(200).json({ success: true, mes: mm, ano: ma, mes_nome: MSPT[mm] || '', resumo_mes: { agendamentos: mtm.rows[0].agendamentos, receita: mrm.rows[0].total }, profissionais: mpr.rows })
        }

        return res.status(400).json({ success: false, error: 'Rota invalida. Use: r=dashboard, r=pacientes, r=agendamentos, r=profissionais, r=financeiro, r=crc, r=relatorios, r=busca, r=aniversariantes, r=conta-corrente, r=fluxo-caixa, r=metas, r=db-status' })

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message })
    }
}
