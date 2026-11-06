// lib/rotas/agenda-online.js — Agendamento online: link público para o paciente marcar consulta
// Klinov — Campo Grande, MS
//
//   handle(route, ctx)               agenda-online-config, agenda-online-pedidos (com login)
//   handlePublico(ctx, contar)       ?r=publico&acao=agenda (sem login, só pelo token da clínica)
//
// O link nunca devolve dados de pacientes. Só oferece horários dos profissionais
// habilitados, dentro do horário de atendimento e sem bloqueio ou conflito.

var crypto = require('crypto')
var cfgLib = require('../config')
var { conflito } = require('./agenda')

var HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/
var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var MAX_ABERTOS_POR_TELEFONE = 2

function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function digitos(v) { return String(v || '').replace(/\D/g, '') }
function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) }
function minutos(h) { var p = String(h).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1] || 0, 10) }
function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') }
function sobrepoe(i1, f1, i2, f2) { return minutos(i1) < minutos(f2) && minutos(i2) < minutos(f1) }
function addDias(data, n) { var d = new Date(data + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function limitar(v, min, max, padrao) { var n = parseInt(v, 10); return isNaN(n) ? padrao : Math.min(Math.max(n, min), max) }
function nomeNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim() }

// o = { agora, antecedencia_horas, dias_max, duracao, faixas: [{dia_semana,hora_inicio,hora_fim}],
//       bloqueios: [{data,hora_inicio,hora_fim}], agendamentos: [{data,ini,fim}], limite }
// Devolve [{ data, horas: ['08:00', ...] }], só com os dias que têm horário livre.
function calcularHorarios(o) {
    var minimo = new Date(new Date(o.agora.replace(' ', 'T') + 'Z').getTime() + o.antecedencia_horas * 3600000).toISOString().replace('T', ' ').slice(0, 16)
    var hoje = o.agora.slice(0, 10), dias = []
    for (var i = 0; i <= o.dias_max; i++) {
        var data = addDias(hoje, i), dow = new Date(data + 'T12:00:00Z').getUTCDay(), horas = []
        var bl = o.bloqueios.filter(function (b) { return b.data === data })
        var ag = o.agendamentos.filter(function (a) { return a.data === data })
        o.faixas.filter(function (f) { return Number(f.dia_semana) === dow }).forEach(function (f) {
            for (var m = minutos(f.hora_inicio); m + o.duracao <= minutos(f.hora_fim); m += o.duracao) {
                var ini = hhmm(m), fim = hhmm(m + o.duracao)
                if (data + ' ' + ini < minimo) continue
                if (bl.some(function (b) { return sobrepoe(ini, fim, b.hora_inicio, b.hora_fim) })) continue
                if (ag.filter(function (a) { return sobrepoe(ini, fim, a.ini, a.fim || a.ini) }).length >= o.limite) continue
                horas.push(ini)
            }
        })
        if (horas.length) dias.push({ data: data, horas: horas.sort() })
    }
    return dias
}

async function horariosDoProfissional(client, cid, prof, cfg) {
    var on = cfg.agenda_online, hoje = agoraCG().slice(0, 10), dias = limitar(on.dias_max, 1, 90, 30), ate = addDias(hoje, dias)
    var faixas = (await client.execute({ sql: "SELECT dia_semana,hora_inicio,hora_fim FROM profissional_horarios WHERE clinica_id=? AND profissional_id=?", args: [cid, prof.id] })).rows
    if (!faixas.length) faixas = (await client.execute({ sql: "SELECT dia_semana,hora_inicio,hora_fim FROM clinica_horarios WHERE clinica_id=?", args: [cid] })).rows
    var bl = await client.execute({ sql: "SELECT data,hora_inicio,hora_fim FROM agenda_bloqueios WHERE clinica_id=? AND bloqueia=1 AND data>=? AND data<=? AND (profissional_id IS NULL OR profissional_id=?)", args: [cid, hoje, ate, prof.id] })
    var ag = await client.execute({ sql: "SELECT substr(data_hora,1,10) data, substr(data_hora,12,5) ini, hora_fim fim FROM agendamentos WHERE clinica_id=? AND profissional_id=? AND DATE(data_hora)>=? AND DATE(data_hora)<=? AND status NOT IN ('cancelado','desmarcado','faltou')", args: [cid, prof.id, hoje, ate] })
    return calcularHorarios({
        agora: agoraCG(), antecedencia_horas: limitar(on.antecedencia_horas, 0, 168, 2), dias_max: dias, duracao: limitar(prof.duracao_min, 10, 240, 30),
        faixas: faixas, bloqueios: bl.rows, agendamentos: ag.rows, limite: limitar(cfg.agenda.limite_simultaneos, 1, 10, 1)
    })
}

async function profissionaisHabilitados(client, cid) {
    return (await client.execute({
        sql: "SELECT p.id, p.nome, p.especialidade, o.duracao_min FROM agenda_online_profissionais o JOIN profissionais p ON p.id=o.profissional_id AND p.clinica_id=o.clinica_id WHERE o.clinica_id=? AND o.ativo=1 AND COALESCE(p.ativo,1)=1 ORDER BY p.nome",
        args: [cid]
    })).rows
}

// ════════════════════════════════════════════════════════════════
// SEM LOGIN
// ════════════════════════════════════════════════════════════════
async function handlePublico(ctx, contar) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }
    var indisponivel = 'Este link de agendamento não está disponível. Fale com a clínica.'

    var c = String(q.c || b.c || '')
    if (!/^[a-f0-9]{48}$/.test(c)) { await contar(); return json(404, { success: false, error: indisponivel }) }
    var cli = (await client.execute({ sql: "SELECT id, nome, logo FROM clinicas WHERE agenda_online_token=?", args: [c] })).rows[0]
    if (!cli) { await contar(); return json(404, { success: false, error: indisponivel }) }
    var cid = cli.id, cfg = await cfgLib.lerCfg(client, cid)
    if (!cfg.agenda_online.ativo) return json(404, { success: false, error: indisponivel })
    var profs = await profissionaisHabilitados(client, cid)

    if (req.method === 'GET') {
        if (q.prof) {
            var p = profs.filter(function (x) { return String(x.id) === String(q.prof) })[0]
            if (!p) return json(404, { success: false, error: 'Profissional não disponível.' })
            return json(200, { success: true, duracao: limitar(p.duracao_min, 10, 240, 30), dias: await horariosDoProfissional(client, cid, p, cfg) })
        }
        return json(200, { success: true, clinica: cli.nome || 'Clínica', logo: cli.logo || null, profissionais: profs.map(function (x) { return { id: x.id, nome: x.nome, especialidade: x.especialidade || '' } }) })
    }
    if (req.method !== 'POST') return json(405, { success: false, error: 'Método não permitido' })

    await contar()
    if (b.site) return json(200, { success: true }) // campo invisível: só robô preenche

    var nome = txt(b.nome, 120), tel = digitos(b.telefone), nasc = String(b.nascimento || ''), email = txt(b.email, 120), obs = txt(b.observacoes, 500), hoje = agoraCG().slice(0, 10)
    if (nomeNorm(nome).split(' ').length < 2) return json(400, { success: false, error: 'Informe nome e sobrenome.' })
    if (tel.length < 10 || tel.length > 11) return json(400, { success: false, error: 'Informe o celular com DDD.' })
    if (!DATA_RE.test(nasc) || nasc >= hoje || nasc < '1900-01-01') return json(400, { success: false, error: 'Informe a data de nascimento.' })
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { success: false, error: 'E-mail inválido.' })
    if (!b.aceite) return json(400, { success: false, error: 'É preciso concordar com o uso dos dados para agendar.' })
    if (!DATA_RE.test(b.data || '') || !HORA_RE.test(b.hora || '')) return json(400, { success: false, error: 'Escolha o dia e o horário.' })

    var prof = profs.filter(function (x) { return String(x.id) === String(b.prof) })[0]
    if (!prof) return json(404, { success: false, error: 'Profissional não disponível.' })
    var ocupado = 'Este horário acabou de ser ocupado. Escolha outro.'
    var dia = (await horariosDoProfissional(client, cid, prof, cfg)).filter(function (d) { return d.data === b.data })[0]
    if (!dia || dia.horas.indexOf(b.hora) === -1) return json(409, { success: false, ocupado: true, error: ocupado })

    // Só vincula a um cadastro existente com o final do telefone E o nascimento iguais
    var fim8 = tel.slice(-8), limpa = function (col) { return "substr(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(" + col + ",''),'(',''),')',''),'-',''),' ',''),-8)" }
    var achado = (await client.execute({ sql: "SELECT id FROM pacientes WHERE clinica_id=? AND substr(data_nascimento,1,10)=? AND (" + limpa('telefone') + "=? OR " + limpa('whatsapp') + "=?) ORDER BY id LIMIT 1", args: [cid, nasc, fim8, fim8] })).rows[0]
    var pacId = achado ? achado.id : null

    var naoFoi = 'Não foi possível agendar por aqui. Fale com a clínica.'
    if (pacId) {
        var abertos = await client.execute({ sql: "SELECT COUNT(*) n FROM agendamentos WHERE clinica_id=? AND paciente_id=? AND origem='online' AND DATE(data_hora)>=? AND status NOT IN ('cancelado','desmarcado','faltou')", args: [cid, pacId, hoje] })
        if (Number(abertos.rows[0].n) >= MAX_ABERTOS_POR_TELEFONE) return json(409, { success: false, error: naoFoi })
        // Bloqueio por inadimplência vale aqui também, sem revelar o motivo a quem preencheu
        if (cfg.bloqueios.inadimplencia === 'bloquear' || cfg.bloqueios.inadimplencia === 'admin') {
            var limiteVenc = addDias(hoje, -(Number(cfg.bloqueios.dias_tolerancia) || 0)), dev = 0
            try { dev = Number((await client.execute({ sql: "SELECT COALESCE(SUM(valor),0) v FROM parcelas_orcamento WHERE clinica_id=? AND paciente_id=? AND status IN ('pendente','vencido') AND substr(data_vencimento,1,10)<?", args: [cid, pacId, limiteVenc] })).rows[0].v) || 0 } catch (e) { dev = 0 }
            if (dev > 0) return json(409, { success: false, error: naoFoi })
        }
    } else {
        var novoPac = await client.execute({ sql: "INSERT INTO pacientes(clinica_id,nome,telefone,whatsapp,email,data_nascimento,como_conheceu,criado_em) VALUES(?,?,?,?,?,?,'Agendamento online',datetime('now'))", args: [cid, nome, tel, tel, email || null, nasc] })
        pacId = Number(novoPac.lastInsertRowid)
    }

    var horaFim = hhmm(minutos(b.hora) + limitar(prof.duracao_min, 10, 240, 30))
    // Com aprovação exigida o pedido já segura o horário, mas só vira consulta quando a clínica aprova
    var pendente = cfg.agenda_online.exigir_aprovacao === true
    var nomeAg = achado ? (await client.execute({ sql: "SELECT nome FROM pacientes WHERE id=? AND clinica_id=?", args: [pacId, cid] })).rows[0].nome : nome
    var ins = await client.execute({
        sql: "INSERT INTO agendamentos(paciente_id,profissional_id,hora_fim,tipo,status,procedimento,observacoes,paciente_nome,profissional_nome,primeira_consulta,confirmacao_envio,canal_envio,data_hora,origem,criado_por_nome,criado_em,atualizado_em,clinica_id) VALUES(?,?,?,'Agendamento online',?,'',?,?,?,?,?,?,?,'online','Agendamento online',datetime('now'),datetime('now'),?)",
        args: [pacId, prof.id, horaFim, pendente ? 'solicitado' : 'agendado', obs, nomeAg, prof.nome, achado ? 0 : 1, cfg.agenda.confirmacao_padrao || null, cfg.agenda.canal_padrao || null, b.data + ' ' + b.hora, cid]
    })
    // Dois pacientes no mesmo instante: quem encontrar o outro já gravado desiste
    var novoId = Number(ins.lastInsertRowid)
    var colide = await conflito(client, cid, prof.id, b.data, b.hora, horaFim, novoId, limitar(cfg.agenda.limite_simultaneos, 1, 10, 1))
    if (colide) {
        await client.execute({ sql: "DELETE FROM agendamentos WHERE id=? AND clinica_id=?", args: [novoId, cid] })
        return json(409, { success: false, ocupado: true, error: ocupado })
    }
    return json(200, { success: true, pendente: pendente, clinica: cli.nome || 'Clínica', profissional: prof.nome, data: b.data, hora: b.hora })
}

// ════════════════════════════════════════════════════════════════
// COM LOGIN
// ════════════════════════════════════════════════════════════════
async function handle(route, ctx) {
    if (route === 'agenda-online-pedidos') return pedidos(ctx)
    if (route !== 'agenda-online-config') return false
    var req = ctx.req, res = ctx.res, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id, b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }

    if (req.method === 'POST') {
        if (auth.perfil !== 'admin') return json(403, { success: false, error: 'Apenas o administrador altera o agendamento online' })
        if (b.action === 'renovar') {
            await client.execute({ sql: "UPDATE clinicas SET agenda_online_token=? WHERE id=?", args: [crypto.randomBytes(24).toString('hex'), clinica_id] })
            await cfgLib.registrar(client, auth, 'config.agenda_online', 'Novo link de agendamento online', req)
        } else {
            var atual = (await cfgLib.lerCfg(client, clinica_id)).agenda_online
            var novo = { ativo: b.ativo === true, exigir_aprovacao: b.exigir_aprovacao === true, antecedencia_horas: limitar(b.antecedencia_horas, 0, 168, atual.antecedencia_horas), dias_max: limitar(b.dias_max, 1, 90, atual.dias_max) }
            await cfgLib.salvarSecao(client, clinica_id, 'agenda_online', novo)
            var lista = Array.isArray(b.profissionais) ? b.profissionais : []
            var validos = (await client.execute({ sql: "SELECT id FROM profissionais WHERE clinica_id=?", args: [clinica_id] })).rows.map(function (r) { return Number(r.id) })
            for (var i = 0; i < lista.length; i++) {
                var pid = Number(lista[i].id)
                if (validos.indexOf(pid) === -1) continue
                await client.execute({
                    sql: "INSERT INTO agenda_online_profissionais(clinica_id,profissional_id,ativo,duracao_min) VALUES(?,?,?,?) ON CONFLICT(clinica_id,profissional_id) DO UPDATE SET ativo=excluded.ativo, duracao_min=excluded.duracao_min",
                    args: [clinica_id, pid, lista[i].ativo ? 1 : 0, limitar(lista[i].duracao_min, 10, 240, 30)]
                })
            }
            await cfgLib.registrar(client, auth, 'config.agenda_online', (novo.ativo ? 'Ligado' : 'Desligado') + (novo.exigir_aprovacao ? ' · com aprovação' : '') + ' · antecedência ' + novo.antecedencia_horas + 'h · até ' + novo.dias_max + ' dias', req)
        }
    }

    var cl = (await client.execute({ sql: "SELECT agenda_online_token FROM clinicas WHERE id=?", args: [clinica_id] })).rows[0]
    if (!cl) return json(404, { success: false, error: 'Clínica não encontrada' })
    var tk = cl.agenda_online_token
    if (!tk) { tk = crypto.randomBytes(24).toString('hex'); await client.execute({ sql: "UPDATE clinicas SET agenda_online_token=? WHERE id=?", args: [tk, clinica_id] }) }
    var profs = await client.execute({ sql: "SELECT p.id, p.nome, COALESCE(o.ativo,0) online, COALESCE(o.duracao_min,30) duracao_min FROM profissionais p LEFT JOIN agenda_online_profissionais o ON o.profissional_id=p.id AND o.clinica_id=p.clinica_id WHERE p.clinica_id=? AND COALESCE(p.ativo,1)=1 ORDER BY p.nome", args: [clinica_id] })
    var recentes = await client.execute({ sql: "SELECT id, paciente_nome, profissional_nome, data_hora, status, criado_em FROM agendamentos WHERE clinica_id=? AND origem='online' ORDER BY id DESC LIMIT 20", args: [clinica_id] })
    return json(200, { success: true, cfg: (await cfgLib.lerCfg(client, clinica_id)).agenda_online, caminho: '/agendar?c=' + tk, profissionais: profs.rows, recentes: recentes.rows })
}

// Pedidos que esperam aprovação: GET lista, POST { id, decisao: 'aprovar'|'recusar', motivo }
async function pedidos(ctx) {
    var req = ctx.req, res = ctx.res, client = ctx.client, auth = ctx.auth, cid = ctx.clinica_id, b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }
    if (req.method === 'POST') {
        var id = parseInt(b.id, 10)
        if (!id || (b.decisao !== 'aprovar' && b.decisao !== 'recusar')) return json(400, { success: false, error: 'Pedido ou decisão inválidos' })
        var motivo = txt(b.motivo, 200)
        if (b.decisao === 'recusar' && !motivo) return json(400, { success: false, error: 'Informe o motivo da recusa' })
        var a = (await client.execute({ sql: "SELECT id,status,observacoes,paciente_nome,data_hora FROM agendamentos WHERE id=? AND clinica_id=? AND origem='online'", args: [id, cid] })).rows[0]
        if (!a) return json(404, { success: false, error: 'Pedido não encontrado' })
        if (a.status !== 'solicitado') return json(409, { success: false, error: 'Este pedido já foi decidido' })
        var quem = txt(auth.nome || auth.email || 'Usuário', 80), quando = agoraCG().slice(0, 16)
        var nota = b.decisao === 'aprovar' ? 'Pedido online aprovado por ' + quem + ' em ' + quando : 'Pedido online recusado por ' + quem + ' em ' + quando + ': ' + motivo
        var obs = (a.observacoes ? String(a.observacoes) + '\n' : '') + nota
        // condição no status evita que duas pessoas decidam o mesmo pedido ao mesmo tempo
        var up = await client.execute({ sql: "UPDATE agendamentos SET status=?, observacoes=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=? AND status='solicitado'", args: [b.decisao === 'aprovar' ? 'agendado' : 'cancelado', obs, id, cid] })
        if (!up.rowsAffected) return json(409, { success: false, error: 'Este pedido já foi decidido' })
        try { await cfgLib.registrar(client, auth, 'agenda.pedido_online', nota + ' · ' + a.paciente_nome + ' · ' + a.data_hora, req) } catch (e) {}
        return json(200, { success: true })
    }
    var r = await client.execute({ sql: "SELECT id, paciente_id, paciente_nome, profissional_id, profissional_nome, data_hora, hora_fim, observacoes, criado_em FROM agendamentos WHERE clinica_id=? AND origem='online' AND status='solicitado' ORDER BY data_hora", args: [cid] })
    return json(200, { success: true, data: r.rows })
}

module.exports = { handle, handlePublico, calcularHorarios }
