// lib/rotas/equipe.js — Chat interno, notificações, marcadores da agenda e Receita Saúde
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
//   chat-contatos / chat-mensagens / chat-nao-lidas   CliniChat entre usuários da clínica
//   notificacoes          sino do topo (chat, check-ins, anamneses, contas, estoque, protético)
//   marcadores            etiquetas da agenda; agendamento-marcadores liga ao agendamento
//   receita-saude         recebimentos de pacientes para o lote do Receita Saúde

var { pode } = require('../permissoes')
var { movimentos } = require('./financeiro')

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var CORES = ['#2E7D52', '#E65100', '#1565C0', '#C62828', '#00695C', '#034030', '#757575']

function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function digitos(v) { return String(v || '').replace(/\D/g, '') }

async function tentar(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args || [] })).rows }
    catch (e) { if (/no such (table|column)/i.test(e.message || '')) return []; throw e }
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }
    var eu = Number(auth.usuario_id)

    // ── CliniChat ────────────────────────────────────────────────
    if (route === 'chat-nao-lidas') {
        var nl = await client.execute({ sql: "SELECT COUNT(*) n FROM chat_mensagens WHERE clinica_id=? AND para_id=? AND lida_em IS NULL", args: [clinica_id, eu] })
        return json(200, { success: true, nao_lidas: Number(nl.rows[0].n) })
    }
    if (route === 'chat-contatos') {
        var us = await client.execute({ sql: "SELECT id, nome, perfil, ultimo_login FROM usuarios WHERE clinica_id=? AND COALESCE(ativo,1)=1 AND id<>? ORDER BY nome", args: [clinica_id, eu] })
        var nls = await client.execute({ sql: "SELECT de_id, COUNT(*) n FROM chat_mensagens WHERE clinica_id=? AND para_id=? AND lida_em IS NULL GROUP BY de_id", args: [clinica_id, eu] })
        var ult = await client.execute({
            sql: "SELECT CASE WHEN de_id=? THEN para_id ELSE de_id END outro, MAX(id) mid FROM chat_mensagens WHERE clinica_id=? AND (de_id=? OR para_id=?) GROUP BY outro",
            args: [eu, clinica_id, eu, eu]
        })
        var mapN = {}, mapU = {}
        nls.rows.forEach(function (r) { mapN[r.de_id] = Number(r.n) })
        if (ult.rows.length) {
            var ms = await client.execute({ sql: "SELECT id, de_id, texto, criado_em FROM chat_mensagens WHERE clinica_id=? AND id IN (" + ult.rows.map(function () { return '?' }).join(',') + ")", args: [clinica_id].concat(ult.rows.map(function (r) { return r.mid })) })
            var porId = {}; ms.rows.forEach(function (m) { porId[m.id] = m })
            ult.rows.forEach(function (r) { mapU[r.outro] = porId[r.mid] })
        }
        var lista = us.rows.map(function (u) {
            var m = mapU[u.id]
            return { id: u.id, nome: u.nome, perfil: u.perfil, ultimo_login: u.ultimo_login, nao_lidas: mapN[u.id] || 0, ultima: m ? { texto: String(m.texto).slice(0, 80), minha: Number(m.de_id) === eu, em: m.criado_em } : null }
        })
        lista.sort(function (a, b) { return (b.ultima ? b.ultima.em : '').localeCompare(a.ultima ? a.ultima.em : '') || a.nome.localeCompare(b.nome) })
        return json(200, { success: true, data: lista })
    }
    if (route === 'chat-mensagens') {
        var com = Number(q.com || b.para)
        var outro = (await client.execute({ sql: "SELECT id, nome FROM usuarios WHERE id=? AND clinica_id=? AND COALESCE(ativo,1)=1", args: [com, clinica_id] })).rows[0]
        if (!outro || com === eu) return json(404, { success: false, error: 'Usuário não encontrado' })
        if (req.method === 'POST') {
            var t = txt(b.texto, 2000)
            if (!t) return json(400, { success: false, error: 'Escreva a mensagem' })
            var ins = await client.execute({ sql: "INSERT INTO chat_mensagens(clinica_id,de_id,para_id,texto,criado_em) VALUES(?,?,?,?,?)", args: [clinica_id, eu, com, t, agoraCG()] })
            return json(200, { success: true, id: Number(ins.lastInsertRowid) })
        }
        var depois = Number(q.depois) || 0
        var w = "clinica_id=? AND ((de_id=? AND para_id=?) OR (de_id=? AND para_id=?))" + (depois ? " AND id>?" : "")
        var a = [clinica_id, eu, com, com, eu].concat(depois ? [depois] : [])
        var msgs = await client.execute({ sql: "SELECT id, de_id, texto, criado_em, lida_em FROM chat_mensagens WHERE " + w + " ORDER BY id DESC LIMIT 100", args: a })
        await client.execute({ sql: "UPDATE chat_mensagens SET lida_em=? WHERE clinica_id=? AND de_id=? AND para_id=? AND lida_em IS NULL", args: [agoraCG(), clinica_id, com, eu] })
        return json(200, { success: true, com: { id: outro.id, nome: outro.nome }, data: msgs.rows.reverse().map(function (m) { return { id: m.id, minha: Number(m.de_id) === eu, texto: m.texto, em: m.criado_em, lida: !!m.lida_em } }) })
    }

    // ── Notificações (sino) ──────────────────────────────────────
    if (route === 'notificacoes') {
        var vis = (await client.execute({ sql: "SELECT visto_em FROM notif_visto WHERE clinica_id=? AND usuario_id=?", args: [clinica_id, eu] })).rows[0]
        if (req.method === 'POST') {
            await client.execute({ sql: "INSERT INTO notif_visto(clinica_id,usuario_id,visto_em) VALUES(?,?,?) ON CONFLICT(clinica_id,usuario_id) DO UPDATE SET visto_em=excluded.visto_em", args: [clinica_id, eu, agoraCG()] })
            return json(200, { success: true })
        }
        var visto = vis ? vis.visto_em : '0000', hoje = agoraCG().slice(0, 10), itens = []
        var chat = await client.execute({ sql: "SELECT u.nome, COUNT(*) n, MAX(m.criado_em) em FROM chat_mensagens m JOIN usuarios u ON u.id=m.de_id WHERE m.clinica_id=? AND m.para_id=? AND m.lida_em IS NULL GROUP BY m.de_id", args: [clinica_id, eu] })
        chat.rows.forEach(function (r) { itens.push({ tipo: 'chat', titulo: 'Mensagem de ' + r.nome, texto: Number(r.n) + ' não lida(s) no chat', em: r.em, abrir: 'chat' }) })
        if (await pode(client, auth, 'agenda.visualizar_classificacao')) {
            ;(await tentar(client, "SELECT paciente_nome, substr(data_hora,12,5) hora, chegada_em FROM agendamentos WHERE clinica_id=? AND substr(chegada_em,1,10)=? ORDER BY chegada_em DESC LIMIT 20", [clinica_id, hoje])).forEach(function (r) {
                itens.push({ tipo: 'checkin', titulo: 'Check-in: ' + (r.paciente_nome || 'Paciente'), texto: 'Chegou às ' + String(r.chegada_em).slice(11, 16) + ' para a consulta das ' + r.hora, em: r.chegada_em, abrir: 'agenda' })
            })
        }
        if (await pode(client, auth, 'pacientes.anamnese')) {
            ;(await tentar(client, "SELECT l.paciente_id, l.usado_em, p.nome FROM anamnese_links l JOIN pacientes p ON p.id=l.paciente_id AND p.clinica_id=l.clinica_id WHERE l.clinica_id=? AND l.usado_em >= datetime('now','-4 hours','-7 days') ORDER BY l.usado_em DESC LIMIT 20", [clinica_id])).forEach(function (r) {
                itens.push({ tipo: 'anamnese', titulo: 'Anamnese respondida', texto: r.nome + ' respondeu pelo link', em: r.usado_em, abrir: 'paciente:' + r.paciente_id })
            })
        }
        if (await pode(client, auth, 'financeiro.contas')) {
            var cv = (await tentar(client, "SELECT COUNT(*) n, COALESCE(SUM(valor),0) v FROM contas_pagar WHERE clinica_id=? AND status='aberta' AND vencimento<=?", [clinica_id, hoje]))[0]
            if (cv && Number(cv.n)) itens.push({ tipo: 'contas', titulo: 'Contas a pagar', texto: Number(cv.n) + ' conta(s) vencendo hoje ou vencidas', em: hoje + ' 07:00:00', abrir: 'financeiro', valor: Number(cv.v) })
        }
        if (await pode(client, auth, 'estoque.acessar')) {
            var er = (await tentar(client, "SELECT COUNT(*) n FROM estoque_produtos WHERE clinica_id=? AND ativo=1 AND minimo>0 AND quantidade<=minimo", [clinica_id]))[0]
            if (er && Number(er.n)) itens.push({ tipo: 'estoque', titulo: 'Estoque', texto: Number(er.n) + ' produto(s) no mínimo ou zerados', em: hoje + ' 07:00:00', abrir: 'estoque' })
        }
        if (await pode(client, auth, 'protetico.acessar')) {
            var pa = (await tentar(client, "SELECT COUNT(*) n FROM proteticos WHERE clinica_id=? AND COALESCE(arquivado,0)=0 AND etapa='laboratorio' AND data_prevista IS NOT NULL AND data_prevista<?", [clinica_id, hoje]))[0]
            if (pa && Number(pa.n)) itens.push({ tipo: 'protetico', titulo: 'Controle protético', texto: Number(pa.n) + ' trabalho(s) com retorno do laboratório atrasado', em: hoje + ' 07:00:00', abrir: 'protético' })
        }
        ;(await tentar(client, "SELECT id, titulo, prazo FROM tarefas WHERE clinica_id=? AND responsavel_id=? AND status='aberta' AND prazo IS NOT NULL AND prazo<=? ORDER BY prazo LIMIT 20", [clinica_id, eu, hoje])).forEach(function (t) {
            itens.push({ tipo: 'tarefa', titulo: t.prazo < hoje ? 'Tarefa atrasada' : 'Tarefa para hoje', texto: t.titulo, em: t.prazo + ' 07:00:00', abrir: 'tarefas' })
        })
        itens.sort(function (x, y) { return String(y.em).localeCompare(String(x.em)) })
        itens.forEach(function (i) { i.nova = String(i.em) > visto })
        return json(200, { success: true, data: itens, novas: itens.filter(function (i) { return i.nova }).length })
    }

    // ── Marcadores da agenda ─────────────────────────────────────
    if (route === 'marcadores') {
        if (req.method === 'GET') return json(200, { success: true, data: (await client.execute({ sql: "SELECT id, nome, cor FROM marcadores WHERE clinica_id=? AND ativo=1 ORDER BY nome", args: [clinica_id] })).rows, cores: CORES })
        if (b.action === 'excluir') {
            var ex = await client.execute({ sql: "UPDATE marcadores SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!ex.rowsAffected) return json(404, { success: false, error: 'Marcador não encontrado' })
            await client.execute({ sql: "DELETE FROM agendamento_marcadores WHERE marcador_id=? AND clinica_id=?", args: [b.id, clinica_id] })
            return json(200, { success: true })
        }
        var nm = txt(b.nome, 40), cor = CORES.indexOf(b.cor) !== -1 ? b.cor : CORES[0]
        if (!nm) return json(400, { success: false, error: 'Dê um nome ao marcador' })
        var dup = (await client.execute({ sql: "SELECT id FROM marcadores WHERE clinica_id=? AND ativo=1 AND lower(nome)=lower(?) AND id<>?", args: [clinica_id, nm, b.id || 0] })).rows[0]
        if (dup) return json(409, { success: false, error: 'Já existe um marcador com esse nome' })
        if (b.id) {
            var up = await client.execute({ sql: "UPDATE marcadores SET nome=?, cor=? WHERE id=? AND clinica_id=? AND ativo=1", args: [nm, cor, b.id, clinica_id] })
            if (!up.rowsAffected) return json(404, { success: false, error: 'Marcador não encontrado' })
            return json(200, { success: true, id: Number(b.id) })
        }
        var im = await client.execute({ sql: "INSERT INTO marcadores(clinica_id,nome,cor) VALUES(?,?,?)", args: [clinica_id, nm, cor] })
        return json(200, { success: true, id: Number(im.lastInsertRowid) })
    }
    if (route === 'agendamento-marcadores') {
        if (req.method === 'GET') {
            // por agendamento (popover) ou por período (pontos na grade)
            if (q.agendamento_id) return json(200, { success: true, ids: (await client.execute({ sql: "SELECT marcador_id FROM agendamento_marcadores WHERE clinica_id=? AND agendamento_id=?", args: [clinica_id, q.agendamento_id] })).rows.map(function (r) { return r.marcador_id }) })
            if (!DATA_RE.test(q.de || '') || !DATA_RE.test(q.ate || '')) return json(400, { success: false, error: 'Período inválido' })
            var rows = await client.execute({ sql: "SELECT am.agendamento_id, am.marcador_id FROM agendamento_marcadores am JOIN agendamentos a ON a.id=am.agendamento_id AND a.clinica_id=am.clinica_id WHERE am.clinica_id=? AND DATE(a.data_hora) BETWEEN ? AND ?", args: [clinica_id, q.de, q.ate] })
            var mapa = {}; rows.rows.forEach(function (r) { (mapa[r.agendamento_id] = mapa[r.agendamento_id] || []).push(r.marcador_id) })
            return json(200, { success: true, mapa: mapa })
        }
        var ag = (await client.execute({ sql: "SELECT id FROM agendamentos WHERE id=? AND clinica_id=?", args: [b.agendamento_id, clinica_id] })).rows[0]
        if (!ag) return json(404, { success: false, error: 'Agendamento não encontrado' })
        var validos = (await client.execute({ sql: "SELECT id FROM marcadores WHERE clinica_id=? AND ativo=1", args: [clinica_id] })).rows.map(function (r) { return Number(r.id) })
        var ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(function (i, k, arr) { return validos.indexOf(i) !== -1 && arr.indexOf(i) === k })
        await client.execute({ sql: "DELETE FROM agendamento_marcadores WHERE clinica_id=? AND agendamento_id=?", args: [clinica_id, ag.id] })
        for (var i = 0; i < ids.length; i++) await client.execute({ sql: "INSERT INTO agendamento_marcadores(clinica_id,agendamento_id,marcador_id) VALUES(?,?,?)", args: [clinica_id, ag.id, ids[i]] })
        return json(200, { success: true, ids: ids })
    }

    // ── Receita Saúde ────────────────────────────────────────────
    if (route === 'receita-saude') {
        if (req.method === 'POST') {
            var mids = (Array.isArray(b.ids) ? b.ids : []).map(function (x) { return txt(x, 40) }).filter(function (x) { return /^[a-z_]+:\d+$/.test(x) })
            if (!mids.length) return json(400, { success: false, error: 'Nenhum recebimento selecionado' })
            var quando = agoraCG()
            for (var k = 0; k < mids.length; k++) {
                await client.execute({ sql: "INSERT INTO receita_saude_export(clinica_id,mov_id,exportado_em,exportado_por) VALUES(?,?,?,?) ON CONFLICT(clinica_id,mov_id) DO UPDATE SET exportado_em=excluded.exportado_em, exportado_por=excluded.exportado_por", args: [clinica_id, mids[k], quando, auth.nome || null] })
            }
            return json(200, { success: true, exportados: mids.length, em: quando })
        }
        if (!DATA_RE.test(q.de || '') || !DATA_RE.test(q.ate || '')) return json(400, { success: false, error: 'Informe o período' })
        var cli = (await client.execute({ sql: "SELECT * FROM clinicas WHERE id=?", args: [clinica_id] })).rows[0] || {}
        var docClinica = digitos(cli.cnpj || cli.documento_numero || '')
        var mov = (await movimentos(client, clinica_id, q.de, q.ate)).filter(function (m) { return m.tipo === 'entrada' && m.paciente_id && !m.estorno })
        var pids = mov.map(function (m) { return m.paciente_id }).filter(function (x, i, a) { return a.indexOf(x) === i })
        var pac = {}
        for (var j = 0; j < pids.length; j += 200) {
            var fatia = pids.slice(j, j + 200)
            ;(await tentar(client, "SELECT id, nome, cpf, data_nascimento, responsavel_nome, responsavel_cpf FROM pacientes WHERE clinica_id=? AND id IN (" + fatia.map(function () { return '?' }).join(',') + ")", [clinica_id].concat(fatia))).forEach(function (p) { pac[p.id] = p })
        }
        var exp = {}
        ;(await tentar(client, "SELECT mov_id, exportado_em FROM receita_saude_export WHERE clinica_id=?", [clinica_id])).forEach(function (e) { exp[e.mov_id] = e.exportado_em })
        var linhas = mov.map(function (m) {
            var p = pac[m.paciente_id] || {}, cpf = digitos(p.cpf), rcpf = digitos(p.responsavel_cpf)
            return { id: m.id, data: m.data, paciente_id: m.paciente_id, paciente: p.nome || m.paciente_nome || '', cpf_paciente: cpf, cpf_pagador: rcpf.length === 11 ? rcpf : cpf, pagador: rcpf.length === 11 ? (p.responsavel_nome || '') : (p.nome || ''), descricao: m.descricao || 'Tratamento odontológico', forma: m.forma, valor: m.valor, exportado_em: exp[m.id] || null, pendencia: cpf.length !== 11 && rcpf.length !== 11 ? 'Paciente sem CPF' : '' }
        })
        if (q.status === 'exportado') linhas = linhas.filter(function (l) { return l.exportado_em })
        if (q.status === 'nao') linhas = linhas.filter(function (l) { return !l.exportado_em })
        return json(200, { success: true, clinica_documento: docClinica, data: linhas })
    }

    return false
}

module.exports = { handle, CORES }
