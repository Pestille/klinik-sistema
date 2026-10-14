// lib/rotas/crc.js — CRC: Central de Relacionamento com o Cliente (Fase 5)
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
//
// Cada fila é um quadro kanban. Os cartões NÃO são cadastrados: nascem do evento
// de origem (falta, desmarcação, parcela vencida, orçamento em aberto, alerta de
// retorno…) calculado na hora, e saem — ou vão para a coluna final — quando o
// evento se resolve (agendou, confirmou, pagou, aprovou). crc_cartoes guarda só
// o que a equipe fez com cada cartão (etapa, data para retornar) e
// crc_interacoes o histórico de contatos, que fica no paciente.

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var CONTATO = ['contato', 'Contato realizado'], RETORNAR = ['retornar', 'Retornar novamente'], AGENDADO = ['agendado', 'Agendado'], ABANDONOU = ['abandonou', 'Abandonou tratamento']

var FILAS = {
    sem_confirmacao: { nome: 'Agendamento sem confirmação', desc: 'Consultas dos próximos dias que ainda não foram confirmadas.', etapas: [['pendente', 'Confirmação pendente'], RETORNAR, ['desmarcou', 'Desmarcou'], ['reagendou', 'Reagendou'], ['confirmou', 'Confirmou']], periodo: [0, 2] },
    aniversariantes: { nome: 'Aniversariantes', desc: 'Pacientes que fazem aniversário: parabenize e aproveite para reativar.', etapas: [['dia', 'Aniversariantes do dia'], ['atraso', 'Aniversariantes em atraso'], CONTATO], periodo: [-7, 0] },
    cancelamentos: { nome: 'Desmarcações / Cancelamentos', desc: 'Consultas desmarcadas que ainda não foram remarcadas.', etapas: [['desmarcado', 'Desmarcado'], CONTATO, RETORNAR, AGENDADO, ABANDONOU], periodo: [-30, 0] },
    faltas: { nome: 'Faltas', desc: 'Pacientes que faltaram e ainda não remarcaram.', etapas: [['faltou', 'Faltou'], CONTATO, RETORNAR, AGENDADO, ABANDONOU], periodo: [-30, 0] },
    faltas_primeira: { nome: 'Faltas na 1ª consulta', desc: 'Faltas na primeira consulta do paciente na clínica.', etapas: [['faltou', 'Faltou'], CONTATO, RETORNAR, AGENDADO, ['desistiu', 'Desistiu']], periodo: [-30, 0] },
    inadimplencia: { nome: 'Inadimplência', desc: 'Pacientes com parcelas de tratamento vencidas.', etapas: [['vencida', 'Parcela vencida'], CONTATO, RETORNAR, ['renegociado', 'Renegociado'], ['sem_negociacao', 'Sem negociação'], ['pago', 'Pago']], periodo: [-365, -1] },
    orcamentos_abertos: { nome: 'Orçamentos em aberto', desc: 'Orçamentos apresentados que ainda não foram aprovados.', etapas: [['aberto', 'Em aberto'], CONTATO, RETORNAR, ['follow_up', 'Follow up'], ['reprovado', 'Orçamento reprovado'], ['aprovado', 'Orçamento aprovado']], periodo: [-90, 0] },
    tratamento_sem_agendamento: { nome: 'Tratamento sem agendamento', desc: 'Tratamentos aprovados com procedimentos pendentes e sem consulta marcada.', etapas: [['sem_agendamento', 'Sem agendamento'], CONTATO, RETORNAR, AGENDADO, ABANDONOU], periodo: [-365, 0] },
    alerta_retorno: { nome: 'Alerta de retorno', desc: 'Retornos previstos (revisões, manutenções) a contatar.', etapas: [['a_contatar', 'A contatar'], ['em_contato', 'Em contato'], RETORNAR, AGENDADO, ['recusado', 'Retorno recusado']], periodo: [-180, 7] }
}
var ORDEM_FILAS = ['sem_confirmacao', 'aniversariantes', 'cancelamentos', 'faltas', 'faltas_primeira', 'inadimplencia', 'orcamentos_abertos', 'tratamento_sem_agendamento', 'alerta_retorno']
var FORMAS = ['ligacao', 'whatsapp', 'presencial', 'email', 'sms']
var LIMITE = 1000

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function difDias(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000) }
function br(ymd) { return ymd ? ymd.slice(8, 10) + '/' + ymd.slice(5, 7) : '' }
function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim() }
function etapaValida(fila, etapa) { return FILAS[fila].etapas.some(function (e) { return e[0] === etapa }) }

// Pacientes com consulta marcada de hoje em diante (por id e, nos registros
// antigos importados sem paciente_id, pelo nome)
async function comConsultaFutura(client, clinica_id, hoje) {
    var r = await client.execute({ sql: "SELECT DISTINCT paciente_id, paciente_nome FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10)>=? AND COALESCE(status,'') NOT IN ('desmarcado','cancelado','faltou')", args: [clinica_id, hoje] })
    var ids = {}, nomes = {}
    r.rows.forEach(function (x) { if (x.paciente_id) ids[x.paciente_id] = 1; if (x.paciente_nome) nomes[norm(x.paciente_nome)] = 1 })
    return function (pid, nome) { return !!((pid && ids[pid]) || (nome && nomes[norm(nome)])) }
}

var SEL_AG = "SELECT a.id, a.paciente_id, COALESCE(p.nome,a.paciente_nome) nome, COALESCE(p.whatsapp,p.telefone) fone, a.profissional_id, COALESCE(pr.nome,a.profissional_nome) prof, a.data_hora, a.status, a.procedimento FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id AND p.clinica_id=a.clinica_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id AND pr.clinica_id=a.clinica_id WHERE a.clinica_id=? AND substr(a.data_hora,1,10) BETWEEN ? AND ?"
var PRIMEIRA = "NOT EXISTS (SELECT 1 FROM agendamentos a2 WHERE a2.clinica_id=a.clinica_id AND a2.data_hora<a.data_hora AND COALESCE(a2.status,'') NOT IN ('desmarcado','cancelado','faltou') AND (a2.paciente_id=a.paciente_id OR (a.paciente_id IS NULL AND UPPER(a2.paciente_nome)=UPPER(a.paciente_nome))))"

function hora(dh) { return String(dh || '').slice(11, 16) }
function evAg(a, extra) {
    var d = String(a.data_hora || '').slice(0, 10)
    return Object.assign({ chave: 'ag:' + a.id, ref: { tipo: 'agendamento', id: a.id }, paciente_id: a.paciente_id, paciente_nome: a.nome, fone: a.fone, profissional_nome: a.prof, data_evento: d, hora: hora(a.data_hora) }, extra)
}

// Gera os eventos de uma fila. f = { de, ate, prof, hoje }
async function eventos(client, clinica_id, fila, f) {
    var hoje = f.hoje, ev = []
    var profAg = f.prof ? ' AND a.profissional_id=?' : '', argsAg = [clinica_id, f.de, f.ate].concat(f.prof ? [f.prof] : [])

    if (fila === 'sem_confirmacao') {
        var r1 = await client.execute({ sql: SEL_AG + profAg + " AND (a.status IS NULL OR a.status IN ('agendado','nao_confirmado','confirmado','desmarcado','cancelado')) ORDER BY a.data_hora LIMIT " + LIMITE, args: argsAg })
        r1.rows.forEach(function (a) {
            var d = String(a.data_hora).slice(0, 10), dd = difDias(hoje, d)
            var ctx = dd === 0 ? 'Agendado para hoje' : dd === 1 ? 'Agendado para amanhã' : dd < 0 ? 'Consulta de ' + br(d) : 'Agendado para ' + br(d)
            ev.push(evAg(a, { contexto: ctx + (a.procedimento ? ' · ' + a.procedimento : ''), padrao: 'pendente', resolvido: a.status === 'confirmado' ? 'confirmou' : (a.status === 'desmarcado' || a.status === 'cancelado') ? 'desmarcou' : null, sempre_visivel: true }))
        })
    }

    if (fila === 'cancelamentos' || fila === 'faltas' || fila === 'faltas_primeira') {
        var cond = fila === 'cancelamentos' ? " AND a.status IN ('desmarcado','cancelado')" : " AND a.status='faltou' AND " + (fila === 'faltas' ? 'NOT ' : '') + PRIMEIRA
        var r2 = await client.execute({ sql: SEL_AG + profAg + cond + " ORDER BY a.data_hora DESC LIMIT " + LIMITE, args: argsAg })
        var futura = await comConsultaFutura(client, clinica_id, hoje)
        r2.rows.forEach(function (a) {
            var d = String(a.data_hora).slice(0, 10)
            ev.push(evAg(a, { contexto: (fila === 'cancelamentos' ? 'Desmarcou a consulta de ' : 'Faltou em ') + br(d) + ' ' + hora(a.data_hora) + (a.procedimento ? ' · ' + a.procedimento : ''), padrao: fila === 'cancelamentos' ? 'desmarcado' : 'faltou', resolvido: futura(a.paciente_id, a.nome) ? 'agendado' : null }))
        })
    }

    if (fila === 'aniversariantes') {
        // de/até limitados a 62 dias; o aniversário é comparado por mês-dia
        var de = f.de, ate = difDias(f.de, f.ate) > 62 ? addDias(f.de, 62) : f.ate, dias = {}
        for (var d = de; d <= ate; d = addDias(d, 1)) dias[d.slice(5)] = d
        var mds = Object.keys(dias)
        if (mds.length) {
            var MD = "CASE WHEN p.data_nascimento LIKE '__/__/____' THEN substr(p.data_nascimento,4,2)||'-'||substr(p.data_nascimento,1,2) ELSE substr(p.data_nascimento,6,5) END"
            var r3 = await client.execute({ sql: "SELECT p.id, p.nome, COALESCE(p.whatsapp,p.telefone) fone, p.data_nascimento, " + MD + " md FROM pacientes p WHERE p.clinica_id=? AND COALESCE(p.ativo,1)=1 AND p.data_nascimento IS NOT NULL AND p.data_nascimento<>'' AND " + MD + " IN (" + mds.map(function () { return '?' }).join(',') + ") LIMIT " + LIMITE, args: [clinica_id].concat(mds) })
            r3.rows.forEach(function (p) {
                var dia = dias[p.md], nasc = /^\d{2}\/\d{2}\/\d{4}$/.test(p.data_nascimento) ? p.data_nascimento.slice(6) : String(p.data_nascimento).slice(0, 4)
                var idade = Number(dia.slice(0, 4)) - Number(nasc), hojeAniv = dia === hoje
                ev.push({ chave: 'aniv:' + p.id + ':' + dia.slice(0, 4), ref: { tipo: 'paciente', id: p.id }, paciente_id: p.id, paciente_nome: p.nome, fone: p.fone, data_evento: dia,
                    contexto: (idade > 0 && idade < 130 ? (hojeAniv ? 'Faz ' + idade + ' anos hoje' : (dia < hoje ? 'Fez ' : 'Fará ') + idade + ' anos em ' + br(dia)) : 'Aniversário em ' + br(dia)),
                    padrao: dia < hoje ? 'atraso' : 'dia', resolvido: null })
            })
        }
    }

    if (fila === 'inadimplencia') {
        var r4 = await client.execute({
            sql: "SELECT po.paciente_id, MAX(p.nome) nome, MAX(COALESCE(p.whatsapp,p.telefone)) fone, COUNT(*) n, SUM(po.valor) total, MIN(po.data_vencimento) venc, MAX(o.profissional_nome) prof FROM parcelas_orcamento po LEFT JOIN pacientes p ON p.id=po.paciente_id AND p.clinica_id=po.clinica_id LEFT JOIN orcamentos o ON o.id=po.orcamento_id AND o.clinica_id=po.clinica_id WHERE po.clinica_id=? AND po.status IN ('pendente','vencido') AND po.data_vencimento<? AND po.data_vencimento BETWEEN ? AND ?" + (f.prof ? ' AND o.profissional_id=?' : '') + " GROUP BY po.paciente_id ORDER BY venc LIMIT " + LIMITE,
            args: [clinica_id, hoje, f.de, f.ate].concat(f.prof ? [f.prof] : [])
        })
        r4.rows.forEach(function (x) {
            ev.push({ chave: 'parc:' + x.paciente_id, ref: { tipo: 'paciente', id: x.paciente_id }, paciente_id: x.paciente_id, paciente_nome: x.nome, fone: x.fone, profissional_nome: x.prof, data_evento: String(x.venc).slice(0, 10),
                contexto: x.n + ' parcela(s) vencida(s) · ' + moeda(x.total) + ' · desde ' + br(String(x.venc).slice(0, 10)), valor: Number(x.total) || 0, padrao: 'vencida', resolvido: null })
        })
    }

    if (fila === 'orcamentos_abertos') {
        var r5 = await client.execute({
            sql: "SELECT o.id, o.paciente_id, p.nome, COALESCE(p.whatsapp,p.telefone) fone, o.profissional_nome prof, o.data_criacao, COALESCE(o.status,'aberto') status, o.valor_total, o.desconto, o.titulo FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE o.clinica_id=? AND substr(o.data_criacao,1,10) BETWEEN ? AND ? AND COALESCE(o.status,'aberto') IN ('aberto','desaprovado','aprovado','reprovado')" + (f.prof ? ' AND o.profissional_id=?' : '') + " ORDER BY o.data_criacao DESC LIMIT " + LIMITE,
            args: [clinica_id, f.de, f.ate].concat(f.prof ? [f.prof] : [])
        })
        r5.rows.forEach(function (o) {
            var v = (Number(o.valor_total) || 0) - (Number(o.desconto) || 0)
            ev.push({ chave: 'orc:' + o.id, ref: { tipo: 'orcamento', id: o.id }, paciente_id: o.paciente_id, paciente_nome: o.nome, fone: o.fone, profissional_nome: o.prof, data_evento: String(o.data_criacao).slice(0, 10),
                contexto: (o.titulo || 'Orçamento #' + o.id) + ' · ' + moeda(v), valor: v, padrao: 'aberto', resolvido: o.status === 'aprovado' ? 'aprovado' : o.status === 'reprovado' ? 'reprovado' : null })
        })
    }

    if (fila === 'tratamento_sem_agendamento') {
        var r6 = await client.execute({
            sql: "SELECT o.id, o.paciente_id, p.nome, COALESCE(p.whatsapp,p.telefone) fone, o.profissional_nome prof, COALESCE(o.data_aprovacao,o.data_criacao) dt, o.titulo, (SELECT COUNT(*) FROM orcamento_itens oi WHERE oi.orcamento_id=o.id AND oi.clinica_id=o.clinica_id AND COALESCE(oi.executado,0)=0) pend FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE o.clinica_id=? AND o.status='aprovado' AND substr(COALESCE(o.data_aprovacao,o.data_criacao),1,10) BETWEEN ? AND ?" + (f.prof ? ' AND o.profissional_id=?' : '') + " ORDER BY dt DESC LIMIT " + LIMITE,
            args: [clinica_id, f.de, f.ate].concat(f.prof ? [f.prof] : [])
        })
        var futura2 = await comConsultaFutura(client, clinica_id, hoje)
        r6.rows.forEach(function (o) {
            if (!Number(o.pend)) return
            ev.push({ chave: 'trat:' + o.id, ref: { tipo: 'orcamento', id: o.id }, paciente_id: o.paciente_id, paciente_nome: o.nome, fone: o.fone, profissional_nome: o.prof, data_evento: String(o.dt).slice(0, 10),
                contexto: (o.titulo || 'Orçamento #' + o.id) + ' · ' + o.pend + ' procedimento(s) a realizar', padrao: 'sem_agendamento', resolvido: futura2(o.paciente_id, o.nome) ? 'agendado' : null })
        })
    }

    if (fila === 'alerta_retorno') {
        var r7 = await client.execute({
            sql: "SELECT ar.id, ar.paciente_id, p.nome, COALESCE(p.whatsapp,p.telefone) fone, pr.nome prof, ar.data_retorno, ar.motivo, COALESCE(ar.status,'pendente') status, ar.agendamento_id FROM alertas_retorno ar LEFT JOIN pacientes p ON p.id=ar.paciente_id AND p.clinica_id=ar.clinica_id LEFT JOIN profissionais pr ON pr.id=ar.profissional_id AND pr.clinica_id=ar.clinica_id WHERE ar.clinica_id=? AND ar.data_retorno BETWEEN ? AND ? AND COALESCE(ar.status,'pendente') IN ('pendente','agendado')" + (f.prof ? ' AND ar.profissional_id=?' : '') + " ORDER BY ar.data_retorno LIMIT " + LIMITE,
            args: [clinica_id, f.de, f.ate].concat(f.prof ? [f.prof] : [])
        })
        var futura3 = await comConsultaFutura(client, clinica_id, hoje)
        r7.rows.forEach(function (x) {
            var d = String(x.data_retorno).slice(0, 10)
            ev.push({ chave: 'ret:' + x.id, ref: { tipo: 'alerta', id: x.id }, paciente_id: x.paciente_id, paciente_nome: x.nome, fone: x.fone, profissional_nome: x.prof, data_evento: d,
                contexto: (d > hoje ? 'Retorno previsto para ' : 'Retorno previsto em ') + br(d) + (x.motivo ? ' · ' + x.motivo : ''), padrao: 'a_contatar',
                resolvido: (x.status === 'agendado' || x.agendamento_id || futura3(x.paciente_id, x.nome)) ? 'agendado' : null })
        })
    }
    return ev
}

// Junta eventos com o que a equipe registrou e devolve os cartões visíveis
async function montarQuadro(client, clinica_id, fila, f) {
    var hoje = f.hoje, ev = await eventos(client, clinica_id, fila, f)
    var st = await client.execute({ sql: "SELECT * FROM crc_cartoes WHERE clinica_id=? AND fila=?", args: [clinica_id, fila] })
    var salvo = {}
    st.rows.forEach(function (c) { salvo[c.chave] = c })
    var vistos = {}, cartoes = []
    ev.forEach(function (e) {
        var c = salvo[e.chave]
        vistos[e.chave] = 1
        if (e.resolvido && !c && !e.sempre_visivel) return
        var etapa = e.resolvido || (c && c.etapa) || e.padrao
        cartoes.push(Object.assign(e, { etapa: etapa, retornar_em: c && etapa === 'retornar' ? c.retornar_em : null, resolvido: !!e.resolvido }))
    })
    // Inadimplência: quem tinha cartão e já não deve nada vai para "Pago" (por 30 dias)
    if (fila === 'inadimplencia') {
        var dev = await client.execute({ sql: "SELECT DISTINCT paciente_id FROM parcelas_orcamento WHERE clinica_id=? AND status IN ('pendente','vencido') AND data_vencimento<?", args: [clinica_id, hoje] })
        var deve = {}
        dev.rows.forEach(function (x) { deve[x.paciente_id] = 1 })
        st.rows.forEach(function (c) {
            if (vistos[c.chave] || deve[c.paciente_id] || String(c.atualizado_em || '').slice(0, 10) < addDias(hoje, -30)) return
            cartoes.push({ chave: c.chave, ref: { tipo: 'paciente', id: c.paciente_id }, paciente_id: c.paciente_id, paciente_nome: c.paciente_nome, data_evento: String(c.atualizado_em).slice(0, 10), contexto: 'Sem parcelas vencidas', etapa: 'pago', resolvido: true })
        })
    }
    var finais = { confirmou: 1, desmarcou: 1, reagendou: 1, agendado: 1, abandonou: 1, desistiu: 1, pago: 1, renegociado: 1, sem_negociacao: 1, aprovado: 1, reprovado: 1, recusado: 1, contato: 1 }
    cartoes.forEach(function (c) {
        c.dias = difDias(c.data_evento, hoje)
        c.atrasado = c.etapa === 'retornar' && !!c.retornar_em && c.retornar_em <= hoje
        c.pendente = !c.resolvido && !finais[c.etapa]
    })
    return cartoes
}

function filtrosPadrao(fila, q) {
    var hoje = hojeCG(), p = FILAS[fila].periodo
    var de = DATA_RE.test(q.de || '') ? q.de : addDias(hoje, p[0])
    var ate = DATA_RE.test(q.ate || '') ? q.ate : addDias(hoje, p[1])
    if (ate < de) { var t = de; de = ate; ate = t }
    return { de: de, ate: ate, prof: parseInt(q.profissional_id, 10) || null, hoje: hoje }
}

async function filasAtivas(client, clinica_id) {
    var r = await client.execute({ sql: "SELECT fila, ativo FROM crc_filas WHERE clinica_id=?", args: [clinica_id] })
    var m = {}
    r.rows.forEach(function (x) { m[x.fila] = !!Number(x.ativo) })
    return m
}

async function pacienteDaClinica(client, clinica_id, id) {
    if (!id) return true
    var r = await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [id, clinica_id] })
    return !!r.rows.length
}

async function salvarCartao(client, clinica_id, b, etapa, retornar) {
    await client.execute({
        sql: "INSERT INTO crc_cartoes(clinica_id,fila,chave,paciente_id,paciente_nome,etapa,retornar_em,atualizado_em) VALUES(?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(clinica_id,fila,chave) DO UPDATE SET etapa=excluded.etapa, retornar_em=excluded.retornar_em, paciente_nome=COALESCE(excluded.paciente_nome,crc_cartoes.paciente_nome), atualizado_em=datetime('now')",
        args: [clinica_id, b.fila, String(b.chave).slice(0, 80), b.paciente_id || null, b.paciente_nome ? String(b.paciente_nome).slice(0, 200) : null, etapa, etapa === 'retornar' ? retornar : null]
    })
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }

    // ── Home: filas com contadores ────────────────────────────────
    if (route === 'crc-filas') {
        if (req.method === 'POST') {
            if (!FILAS[b.fila]) return json(400, { success: false, error: 'Fila inválida' })
            await client.execute({ sql: "INSERT INTO crc_filas(clinica_id,fila,ativo) VALUES(?,?,?) ON CONFLICT(clinica_id,fila) DO UPDATE SET ativo=excluded.ativo", args: [clinica_id, b.fila, b.ativo ? 1 : 0] })
            return json(200, { success: true })
        }
        var ativas = await filasAtivas(client, clinica_id), out = []
        for (var i = 0; i < ORDEM_FILAS.length; i++) {
            var id = ORDEM_FILAS[i], ativo = ativas[id] !== false, item = { id: id, nome: FILAS[id].nome, descricao: FILAS[id].desc, ativo: ativo, total: 0, atrasados: 0 }
            if (ativo) {
                var cs = await montarQuadro(client, clinica_id, id, filtrosPadrao(id, {}))
                item.total = cs.filter(function (c) { return c.pendente || c.etapa === 'retornar' }).length
                item.atrasados = cs.filter(function (c) { return c.atrasado }).length
            }
            out.push(item)
        }
        return json(200, { success: true, filas: out })
    }

    // ── Quadro kanban de uma fila ─────────────────────────────────
    if (route === 'crc-quadro') {
        var fila = q.fila
        if (!FILAS[fila]) return json(400, { success: false, error: 'Fila inválida' })
        var f = filtrosPadrao(fila, q)
        var cartoes = await montarQuadro(client, clinica_id, fila, f)
        var busca = norm(q.q)
        if (busca) cartoes = cartoes.filter(function (c) { return norm(c.paciente_nome).indexOf(busca) >= 0 || String(c.paciente_id) === busca })
        cartoes.sort(function (a, c) { var x = (a.data_evento + (a.hora || '')).localeCompare(c.data_evento + (c.hora || '')); return q.ordem === 'antigo' ? x : -x })
        return json(200, { success: true, fila: { id: fila, nome: FILAS[fila].nome, descricao: FILAS[fila].desc }, etapas: FILAS[fila].etapas.map(function (e) { return { id: e[0], nome: e[1] } }), filtros: { de: f.de, ate: f.ate }, cartoes: cartoes })
    }

    // ── Mover cartão (arrastar e soltar) ──────────────────────────
    if (route === 'crc-cartao') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (!FILAS[b.fila] || !b.chave) return json(400, { success: false, error: 'Fila ou cartão inválido' })
        if (!etapaValida(b.fila, b.etapa)) return json(400, { success: false, error: 'Etapa inválida' })
        if (b.etapa === 'retornar' && !DATA_RE.test(b.retornar_em || '')) return json(400, { success: false, error: 'Informe a data para retornar' })
        if (!await pacienteDaClinica(client, clinica_id, b.paciente_id)) return json(404, { success: false, error: 'Paciente não encontrado' })
        await salvarCartao(client, clinica_id, b, b.etapa, b.retornar_em)
        await client.execute({ sql: "INSERT INTO crc_interacoes(clinica_id,paciente_id,paciente_nome,fila,chave,forma,etapa,detalhes,retornar_em,usuario_id,usuario_nome) VALUES(?,?,?,?,?,'etapa',?,NULL,?,?,?)", args: [clinica_id, b.paciente_id || null, b.paciente_nome || null, b.fila, String(b.chave).slice(0, 80), b.etapa, b.etapa === 'retornar' ? b.retornar_em : null, auth.usuario_id || null, auth.nome || null] })
        return json(200, { success: true })
    }

    // ── Nova interação ────────────────────────────────────────────
    if (route === 'crc-interacao') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (!FILAS[b.fila] || !b.chave) return json(400, { success: false, error: 'Fila ou cartão inválido' })
        if (FORMAS.indexOf(b.forma) < 0) return json(400, { success: false, error: 'Escolha a forma de contato' })
        if (!etapaValida(b.fila, b.etapa)) return json(400, { success: false, error: 'Etapa inválida' })
        if (b.etapa === 'retornar' && !DATA_RE.test(b.retornar_em || '')) return json(400, { success: false, error: 'Informe a data para retornar' })
        var det = String(b.detalhes || '').trim().slice(0, 2000)
        if (!det) return json(400, { success: false, error: 'Descreva a interação' })
        if (!await pacienteDaClinica(client, clinica_id, b.paciente_id)) return json(404, { success: false, error: 'Paciente não encontrado' })
        await salvarCartao(client, clinica_id, b, b.etapa, b.retornar_em)
        var ins = await client.execute({ sql: "INSERT INTO crc_interacoes(clinica_id,paciente_id,paciente_nome,fila,chave,forma,etapa,detalhes,retornar_em,usuario_id,usuario_nome) VALUES(?,?,?,?,?,?,?,?,?,?,?)", args: [clinica_id, b.paciente_id || null, b.paciente_nome || null, b.fila, String(b.chave).slice(0, 80), b.forma, b.etapa, det, b.etapa === 'retornar' ? b.retornar_em : null, auth.usuario_id || null, auth.nome || null] })
        return json(200, { success: true, id: Number(ins.lastInsertRowid) })
    }

    // ── Histórico de interações (do paciente ou do cartão) ────────
    if (route === 'crc-interacoes') {
        var w = ['clinica_id=?'], a = [clinica_id]
        if (q.paciente_id) { w.push('paciente_id=?'); a.push(parseInt(q.paciente_id, 10) || 0) }
        else if (q.fila && q.chave) { w.push('fila=? AND chave=?'); a.push(q.fila, q.chave) }
        else return json(400, { success: false, error: 'Informe o paciente ou o cartão' })
        var r = await client.execute({ sql: "SELECT id,paciente_id,paciente_nome,fila,chave,forma,etapa,detalhes,retornar_em,usuario_nome,criado_em FROM crc_interacoes WHERE " + w.join(' AND ') + " ORDER BY id DESC LIMIT 200", args: a })
        var nomesEtapa = {}
        Object.keys(FILAS).forEach(function (k) { FILAS[k].etapas.forEach(function (e) { nomesEtapa[k + ':' + e[0]] = e[1] }) })
        return json(200, { success: true, data: r.rows.map(function (x) { return Object.assign({}, x, { fila_nome: FILAS[x.fila] ? FILAS[x.fila].nome : x.fila, etapa_nome: nomesEtapa[x.fila + ':' + x.etapa] || x.etapa }) }) })
    }

    return false
}

module.exports = { handle, FILAS }
