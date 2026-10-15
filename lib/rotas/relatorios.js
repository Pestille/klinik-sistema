// lib/rotas/relatorios.js — Relatórios e metas (Fase 7)
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
//
// Relatórios: um catálogo (RELATORIOS) em que cada item declara categoria, filtros
// e uma função que devolve { resumo, colunas, linhas, totais }. A tela é única e
// genérica (public/relatorios.js): lista por categoria, filtros, tabela,
// impressão e CSV. Dinheiro vem de movimentos() (lib/rotas/financeiro.js).
//
// Metas: metas_config por clínica ou por profissional, com tipos calculados em
// alcancado() — o mesmo cálculo serve a tela de metas e o dashboard analítico.

var fin = require('./financeiro')
var permissoes = require('../permissoes')
var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var DESM = "('desmarcado','cancelado')"
var ATEND = "('atendido','realizado','em_atendimento')"

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function difDias(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000) }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0 }
function ultimoDia(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
function mesesEntre(de, ate) { var out = [], y = +de.slice(0, 4), m = +de.slice(5, 7); while ((y + '-' + String(m).padStart(2, '0')) <= ate.slice(0, 7) && out.length < 36) { out.push(y + '-' + String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++ } } return out }
var NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function rotMes(ym) { return NOMES_MES[+ym.slice(5, 7) - 1] + '/' + ym.slice(2, 4) }
function nasc(s) { s = String(s || ''); if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s.slice(6) + '-' + s.slice(3, 5) + '-' + s.slice(0, 2); return DATA_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : null }
function idade(n, ref) { var d = nasc(n); if (!d) return null; var a = +ref.slice(0, 4) - +d.slice(0, 4); if (ref.slice(5) < d.slice(5)) a--; return a >= 0 && a < 130 ? a : null }

async function tentar(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args || [] })).rows }
    catch (e) { if (/no such (table|column)/i.test(e.message || '')) return []; throw e }
}

// Filtros comuns: de/ate (padrão mês corrente), profissional
function filtros(q) {
    var h = hojeCG()
    var de = DATA_RE.test(q.de || '') ? q.de : h.slice(0, 8) + '01'
    var ate = DATA_RE.test(q.ate || '') ? q.ate : ultimoDia(h.slice(0, 7))
    if (ate < de) { var t = de; de = ate; ate = t }
    if (difDias(de, ate) > 1100) de = addDias(ate, -1100)
    return { de: de, ate: ate, hoje: h, prof: parseInt(q.profissional_id, 10) || null, status: q.status || '', q: String(q.q || '').trim() }
}
function C(k, t, tipo) { return { k: k, t: t, tipo: tipo || 'texto' } }
function soma(linhas, k) { return r2(linhas.reduce(function (s, l) { return s + (Number(l[k]) || 0) }, 0)) }

var SEL_AG = "SELECT a.id, a.data_hora, a.hora_fim, a.status, a.tipo, a.procedimento, a.primeira_consulta, a.paciente_id, COALESCE(p.nome,a.paciente_nome) paciente, COALESCE(p.whatsapp,p.telefone) telefone, a.profissional_id, COALESCE(pr.nome,a.profissional_nome) profissional, COALESCE(c.nome,a.tipo) categoria FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id AND p.clinica_id=a.clinica_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id AND pr.clinica_id=a.clinica_id LEFT JOIN agenda_categorias c ON c.id=a.categoria_id AND c.clinica_id=a.clinica_id WHERE a.clinica_id=? AND substr(a.data_hora,1,10) BETWEEN ? AND ?"
var STATUS_NOME = { agendado: 'Agendado', confirmado: 'Confirmado', em_espera: 'Em espera', em_atendimento: 'Em atendimento', atendido: 'Atendido', realizado: 'Atendido', atrasado: 'Atrasado', faltou: 'Faltou', desmarcado: 'Desmarcado', cancelado: 'Desmarcado', nao_confirmado: 'Não confirmado' }
async function agendamentos(client, cid, f, extra, args) {
    var sql = SEL_AG + (f.prof ? ' AND a.profissional_id=?' : '') + (extra || '') + ' ORDER BY a.data_hora LIMIT 5000'
    var rows = await tentar(client, sql, [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []).concat(args || []))
    return rows.map(function (a) { return { data: String(a.data_hora).slice(0, 10), hora: String(a.data_hora).slice(11, 16), paciente_id: a.paciente_id, paciente: a.paciente, telefone: a.telefone, profissional: a.profissional || '—', profissional_id: a.profissional_id, categoria: a.categoria || a.procedimento || '—', procedimento: a.procedimento || '', status: STATUS_NOME[a.status] || a.status || 'Agendado', status_id: a.status || 'agendado', primeira: Number(a.primeira_consulta) === 1 } })
}
function agrupar(lista, chave, campos) {
    var m = {}
    lista.forEach(function (x) { var k = typeof chave === 'function' ? chave(x) : x[chave]; k = k == null || k === '' ? '—' : k; m[k] = m[k] || { chave: k, n: 0 }; m[k].n++; (campos || []).forEach(function (c) { m[k][c[0]] = (m[k][c[0]] || 0) + c[1](x) }) })
    return Object.keys(m).map(function (k) { return m[k] }).sort(function (a, b) { return b.n - a.n })
}

// ════════════════════════════════════════════════════════════════
// CATÁLOGO
// ════════════════════════════════════════════════════════════════
var CATS = ['Agendamentos', 'Financeiro', 'Pacientes', 'Tratamentos', 'Geral']
var R = []
function rel(id, cat, nome, desc, opts, run) { R.push({ id: id, cat: cat, nome: nome, desc: desc, filtros: opts.filtros || ['periodo'], perm: opts.perm || null, run: run }) }

// ── Agendamentos ──────────────────────────────────────────────────
rel('ag-geral', 'Agendamentos', 'Geral', 'Todos os agendamentos do período com situação, categoria e profissional.', { filtros: ['periodo', 'profissional', 'status_agenda'] }, async function (c, cid, f) {
    var l = await agendamentos(c, cid, f, f.status ? (f.status === 'desmarcado' ? ' AND a.status IN ' + DESM : ' AND a.status=?') : '', f.status && f.status !== 'desmarcado' ? [f.status] : [])
    var desm = l.filter(function (x) { return /desmarcado|cancelado/.test(x.status_id) }).length, falt = l.filter(function (x) { return x.status_id === 'faltou' }).length, at = l.filter(function (x) { return /atendido|realizado|em_atendimento/.test(x.status_id) }).length
    return { resumo: [['Agendamentos', l.length, 'num'], ['Atendidos', at, 'num'], ['Faltas', falt, 'num'], ['Desmarcados', desm, 'num'], ['Taxa de falta', pct(falt, l.length - desm), 'pct']],
        colunas: [C('data', 'Data', 'data'), C('hora', 'Hora'), C('paciente', 'Paciente', 'paciente'), C('profissional', 'Profissional'), C('categoria', 'Categoria'), C('status', 'Situação')], linhas: l }
})
rel('ag-desmarcacoes', 'Agendamentos', 'Desmarcações', 'Consultas desmarcadas no período e se o paciente já remarcou.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var l = await agendamentos(c, cid, f, ' AND a.status IN ' + DESM)
    var fut = {}
    ;(await tentar(c, "SELECT DISTINCT paciente_id FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10)>=? AND COALESCE(status,'') NOT IN ('desmarcado','cancelado','faltou')", [cid, f.hoje])).forEach(function (x) { fut[x.paciente_id] = 1 })
    l.forEach(function (x) { x.remarcou = fut[x.paciente_id] ? 'Sim' : 'Não' })
    return { resumo: [['Desmarcações', l.length, 'num'], ['Já remarcaram', l.filter(function (x) { return x.remarcou === 'Sim' }).length, 'num']],
        colunas: [C('data', 'Data', 'data'), C('hora', 'Hora'), C('paciente', 'Paciente', 'paciente'), C('telefone', 'Telefone'), C('profissional', 'Profissional'), C('categoria', 'Categoria'), C('remarcou', 'Remarcou')], linhas: l }
})
rel('ag-faltas', 'Agendamentos', 'Faltas', 'Pacientes que faltaram no período.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var l = await agendamentos(c, cid, f, " AND a.status='faltou'")
    var tot = (await tentar(c, "SELECT COUNT(*) n FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10) BETWEEN ? AND ? AND COALESCE(status,'') NOT IN " + DESM + (f.prof ? ' AND profissional_id=?' : ''), [cid, f.de, f.ate].concat(f.prof ? [f.prof] : [])))[0]
    return { resumo: [['Faltas', l.length, 'num'], ['Taxa de falta', pct(l.length, tot ? Number(tot.n) : 0), 'pct']],
        colunas: [C('data', 'Data', 'data'), C('hora', 'Hora'), C('paciente', 'Paciente', 'paciente'), C('telefone', 'Telefone'), C('profissional', 'Profissional'), C('categoria', 'Categoria')], linhas: l }
})
rel('ag-primeira', 'Agendamentos', 'Primeira consulta', 'Primeiras consultas do período, comparecimento e se viraram orçamento aprovado.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var l = await agendamentos(c, cid, f, " AND (a.primeira_consulta=1 OR NOT EXISTS (SELECT 1 FROM agendamentos a2 WHERE a2.clinica_id=a.clinica_id AND a2.paciente_id=a.paciente_id AND a2.data_hora<a.data_hora AND COALESCE(a2.status,'') NOT IN ('desmarcado','cancelado','faltou'))) AND a.paciente_id IS NOT NULL")
    var aprov = {}
    ;(await tentar(c, "SELECT DISTINCT paciente_id FROM orcamentos WHERE clinica_id=? AND status='aprovado' AND substr(COALESCE(data_aprovacao,data_criacao),1,10)>=?", [cid, f.de])).forEach(function (x) { aprov[x.paciente_id] = 1 })
    l = l.filter(function (x) { return !/desmarcado|cancelado/.test(x.status_id) })
    l.forEach(function (x) { x.converteu = aprov[x.paciente_id] ? 'Sim' : 'Não' })
    var falt = l.filter(function (x) { return x.status_id === 'faltou' }).length, conv = l.filter(function (x) { return x.converteu === 'Sim' }).length
    return { resumo: [['Primeiras consultas', l.length, 'num'], ['Faltas na 1ª', falt, 'num'], ['Viraram tratamento', conv, 'num'], ['Conversão', pct(conv, l.length - falt), 'pct']],
        colunas: [C('data', 'Data', 'data'), C('hora', 'Hora'), C('paciente', 'Paciente', 'paciente'), C('profissional', 'Profissional'), C('status', 'Situação'), C('converteu', 'Orçamento aprovado')], linhas: l }
})
rel('ag-categoria', 'Agendamentos', 'Categoria', 'Quantidade de agendamentos por categoria, com faltas e desmarcações.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var l = await agendamentos(c, cid, f)
    var g = agrupar(l, 'categoria', [['faltas', function (x) { return x.status_id === 'faltou' ? 1 : 0 }], ['desm', function (x) { return /desmarcado|cancelado/.test(x.status_id) ? 1 : 0 }]])
    var linhas = g.map(function (x) { return { categoria: x.chave, total: x.n, perc: pct(x.n, l.length), faltas: x.faltas, desmarcados: x.desm } })
    return { grafico: { tipo: 'barras', rotulo: 'categoria', valor: 'total' }, colunas: [C('categoria', 'Categoria'), C('total', 'Agendamentos', 'num'), C('perc', '% do total', 'pct'), C('faltas', 'Faltas', 'num'), C('desmarcados', 'Desmarcados', 'num')], linhas: linhas, totais: { total: l.length, faltas: soma(linhas, 'faltas'), desmarcados: soma(linhas, 'desmarcados') } }
})
rel('ag-profissional', 'Agendamentos', 'Por profissional', 'Agenda de cada profissional: atendidos, faltas, desmarcações e taxa de falta.', { filtros: ['periodo'] }, async function (c, cid, f) {
    var l = await agendamentos(c, cid, f)
    var g = agrupar(l, 'profissional', [['at', function (x) { return /atendido|realizado|em_atendimento/.test(x.status_id) ? 1 : 0 }], ['fa', function (x) { return x.status_id === 'faltou' ? 1 : 0 }], ['de', function (x) { return /desmarcado|cancelado/.test(x.status_id) ? 1 : 0 }], ['pr', function (x) { return x.primeira ? 1 : 0 }]])
    var linhas = g.map(function (x) { return { profissional: x.chave, total: x.n, atendidos: x.at, faltas: x.fa, desmarcados: x.de, primeiras: x.pr, taxa_falta: pct(x.fa, x.n - x.de) } })
    return { grafico: { tipo: 'barras', rotulo: 'profissional', valor: 'total' }, colunas: [C('profissional', 'Profissional'), C('total', 'Agendamentos', 'num'), C('atendidos', 'Atendidos', 'num'), C('faltas', 'Faltas', 'num'), C('desmarcados', 'Desmarcados', 'num'), C('primeiras', '1ª consulta', 'num'), C('taxa_falta', 'Taxa de falta', 'pct')], linhas: linhas,
        totais: { total: l.length, atendidos: soma(linhas, 'atendidos'), faltas: soma(linhas, 'faltas'), desmarcados: soma(linhas, 'desmarcados'), primeiras: soma(linhas, 'primeiras') } }
})
rel('ag-alertas', 'Agendamentos', 'Alertas de retorno', 'Retornos previstos no período e se já foram agendados.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT ar.*, p.nome paciente, COALESCE(p.whatsapp,p.telefone) telefone, pr.nome profissional FROM alertas_retorno ar LEFT JOIN pacientes p ON p.id=ar.paciente_id AND p.clinica_id=ar.clinica_id LEFT JOIN profissionais pr ON pr.id=ar.profissional_id AND pr.clinica_id=ar.clinica_id WHERE ar.clinica_id=? AND ar.data_retorno BETWEEN ? AND ?" + (f.prof ? ' AND ar.profissional_id=?' : '') + " ORDER BY ar.data_retorno", [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []))
    var l = rows.map(function (x) { return { data: x.data_retorno, paciente_id: x.paciente_id, paciente: x.paciente, telefone: x.telefone, profissional: x.profissional || '—', motivo: x.motivo || '', situacao: x.status === 'agendado' || x.agendamento_id ? 'Agendado' : x.data_retorno < f.hoje ? 'Atrasado' : 'Pendente' } })
    return { resumo: [['Alertas', l.length, 'num'], ['Agendados', l.filter(function (x) { return x.situacao === 'Agendado' }).length, 'num'], ['Atrasados', l.filter(function (x) { return x.situacao === 'Atrasado' }).length, 'num']],
        colunas: [C('data', 'Retorno previsto', 'data'), C('paciente', 'Paciente', 'paciente'), C('telefone', 'Telefone'), C('profissional', 'Profissional'), C('motivo', 'Motivo'), C('situacao', 'Situação')], linhas: l }
})

// ── Financeiro ────────────────────────────────────────────────────
rel('fin-conta-corrente', 'Financeiro', 'Conta corrente', 'Todas as entradas e saídas do período (regime de caixa).', { perm: 'financeiro.acessar' }, async function (c, cid, f) {
    var mv = await fin.movimentos(c, cid, f.de, f.ate)
    var l = mv.map(function (m) { return { data: m.data, tipo: m.tipo === 'entrada' ? 'Entrada' : 'Saída', forma: m.forma, descricao: m.descricao, paciente_id: m.paciente_id, paciente: m.paciente_nome || '', categoria: m.categoria || m.classificacao || '', valor: m.tipo === 'entrada' ? m.valor : -m.valor } })
    var ent = soma(l.filter(function (x) { return x.valor > 0 }), 'valor'), sai = -soma(l.filter(function (x) { return x.valor < 0 }), 'valor')
    return { resumo: [['Entradas', ent, 'moeda'], ['Saídas', sai, 'moeda'], ['Saldo', r2(ent - sai), 'moeda']], colunas: [C('data', 'Data', 'data'), C('tipo', 'Tipo'), C('forma', 'Forma'), C('descricao', 'Descrição'), C('paciente', 'Paciente', 'paciente'), C('categoria', 'Categoria'), C('valor', 'Valor', 'moeda')], linhas: l, totais: { valor: r2(ent - sai) } }
})
rel('fin-caixa', 'Financeiro', 'Caixa por forma de pagamento', 'Entradas e saídas do período agrupadas por forma de pagamento.', { perm: 'financeiro.acessar' }, async function (c, cid, f) {
    var mv = await fin.movimentos(c, cid, f.de, f.ate)
    var g = agrupar(mv, 'forma', [['ent', function (m) { return m.tipo === 'entrada' ? m.valor : 0 }], ['sai', function (m) { return m.tipo === 'saida' ? m.valor : 0 }]])
    var l = g.map(function (x) { return { forma: x.chave, qtd: x.n, entradas: r2(x.ent), saidas: r2(x.sai), saldo: r2(x.ent - x.sai) } }).sort(function (a, b) { return b.entradas - a.entradas })
    return { grafico: { tipo: 'barras', rotulo: 'forma', valor: 'entradas' }, colunas: [C('forma', 'Forma'), C('qtd', 'Transações', 'num'), C('entradas', 'Entradas', 'moeda'), C('saidas', 'Saídas', 'moeda'), C('saldo', 'Saldo', 'moeda')], linhas: l, totais: { qtd: soma(l, 'qtd'), entradas: soma(l, 'entradas'), saidas: soma(l, 'saidas'), saldo: soma(l, 'saldo') } }
})
rel('fin-fluxo', 'Financeiro', 'Fluxo financeiro mensal', 'Entradas, saídas, resultado e saldo acumulado mês a mês.', { perm: 'financeiro.acessar' }, async function (c, cid, f) {
    var mv = await fin.movimentos(c, cid, f.de.slice(0, 8) + '01', ultimoDia(f.ate.slice(0, 7)))
    var ac = 0
    var l = mesesEntre(f.de, f.ate).map(function (ym) {
        var e = 0, s = 0
        mv.forEach(function (m) { if (m.data.slice(0, 7) === ym) { if (m.tipo === 'entrada') e += m.valor; else s += m.valor } })
        ac += e - s
        return { mes: rotMes(ym), entradas: r2(e), saidas: r2(s), resultado: r2(e - s), acumulado: r2(ac) }
    })
    return { grafico: { tipo: 'barras', rotulo: 'mes', valor: 'resultado' }, colunas: [C('mes', 'Mês'), C('entradas', 'Entradas', 'moeda'), C('saidas', 'Saídas', 'moeda'), C('resultado', 'Resultado', 'moeda'), C('acumulado', 'Acumulado', 'moeda')], linhas: l, totais: { entradas: soma(l, 'entradas'), saidas: soma(l, 'saidas'), resultado: soma(l, 'resultado') } }
})
rel('fin-dre', 'Financeiro', 'DRE', 'Demonstrativo de resultado por mês, com análise vertical (% da receita).', { perm: 'financeiro.dre' }, async function (c, cid, f) {
    var meses = mesesEntre(f.de, f.ate), mv = await fin.movimentos(c, cid, meses[0] + '-01', ultimoDia(meses[meses.length - 1]))
    var contas = [['receita', '(+) Receita bruta'], ['impostos', '(−) Impostos'], ['liquida', '(=) Receita líquida'], ['fixos', '(−) Custos fixos'], ['variaveis', '(−) Custos variáveis'], ['marketing', '(−) Marketing'], ['outras', '(−) Outras despesas'], ['operacional', '(=) Resultado operacional'], ['invest', '(−) Investimentos'], ['final', '(=) Resultado final']]
    var por = {}
    meses.concat(['total']).forEach(function (ym) { por[ym] = { receita: 0, impostos: 0, fixos: 0, variaveis: 0, marketing: 0, outras: 0, invest: 0 } })
    mv.forEach(function (m) {
        var ym = m.data.slice(0, 7); if (!por[ym]) return
        var k = m.tipo === 'entrada' ? 'receita' : { 'Impostos': 'impostos', 'Custo Fixo': 'fixos', 'Custo Variável': 'variaveis', 'Marketing': 'marketing', 'Investimento': 'invest' }[m.classificacao] || 'outras'
        por[ym][k] += m.valor; por.total[k] += m.valor
    })
    Object.keys(por).forEach(function (ym) { var p = por[ym]; p.liquida = p.receita - p.impostos; p.operacional = p.liquida - p.fixos - p.variaveis - p.marketing - p.outras; p.final = p.operacional - p.invest })
    var cols = [C('conta', 'Conta')].concat(meses.map(function (ym) { return C(ym, rotMes(ym), 'moeda') })).concat([C('total', 'Total', 'moeda'), C('av', 'AV %', 'pct')])
    var l = contas.map(function (ct) { var o = { conta: ct[1], _destaque: /^\(=\)/.test(ct[1]) }; meses.forEach(function (ym) { o[ym] = r2(por[ym][ct[0]]) }); o.total = r2(por.total[ct[0]]); o.av = pct(Math.abs(o.total), por.total.receita); return o })
    return { colunas: cols, linhas: l, resumo: [['Receita bruta', r2(por.total.receita), 'moeda'], ['Resultado final', r2(por.total.final), 'moeda'], ['Margem', pct(por.total.final, por.total.receita), 'pct']] }
})
rel('fin-contas-pagar', 'Financeiro', 'Contas a pagar', 'Contas com vencimento no período, pagas e em aberto.', { perm: 'financeiro.contas', filtros: ['periodo', 'status_conta'] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT * FROM contas_pagar WHERE clinica_id=? AND status<>'cancelada' AND substr(vencimento,1,10) BETWEEN ? AND ?" + (f.status === 'paga' ? " AND status='paga'" : f.status === 'aberta' ? " AND status<>'paga'" : '') + " ORDER BY vencimento", [cid, f.de, f.ate])
    var l = rows.map(function (x) { return { vencimento: String(x.vencimento).slice(0, 10), descricao: x.descricao, fornecedor: x.fornecedor || '', tipo: x.classificacao || '', categoria: x.categoria || '', pagamento: x.pagamento ? String(x.pagamento).slice(0, 10) : '', situacao: x.status === 'paga' ? 'Paga' : String(x.vencimento).slice(0, 10) < f.hoje ? 'Vencida' : 'Aberta', valor: r2(x.valor) } })
    return { resumo: [['Total', soma(l, 'valor'), 'moeda'], ['Pago', soma(l.filter(function (x) { return x.situacao === 'Paga' }), 'valor'), 'moeda'], ['Vencido', soma(l.filter(function (x) { return x.situacao === 'Vencida' }), 'valor'), 'moeda']],
        colunas: [C('vencimento', 'Vencimento', 'data'), C('descricao', 'Descrição'), C('fornecedor', 'Fornecedor'), C('tipo', 'Tipo'), C('categoria', 'Categoria'), C('situacao', 'Situação'), C('pagamento', 'Pago em', 'data'), C('valor', 'Valor', 'moeda')], linhas: l, totais: { valor: soma(l, 'valor') } }
})
rel('fin-recibos', 'Financeiro', 'Recebimentos por paciente', 'Tudo o que cada paciente pagou no período (base para recibos e Receita Saúde).', { perm: 'financeiro.acessar' }, async function (c, cid, f) {
    var mv = (await fin.movimentos(c, cid, f.de, f.ate)).filter(function (m) { return m.tipo === 'entrada' && (m.paciente_id || m.paciente_nome) })
    var g = agrupar(mv, function (m) { return (m.paciente_id || '') + '|' + (m.paciente_nome || '') }, [['v', function (m) { return m.valor }]])
    var cpf = {}
    ;(await tentar(c, "SELECT id, cpf FROM pacientes WHERE clinica_id=?", [cid])).forEach(function (p) { cpf[p.id] = p.cpf })
    var l = g.map(function (x) { var p = x.chave.split('|'); return { paciente_id: +p[0] || null, paciente: p.slice(1).join('|'), cpf: cpf[p[0]] || '', pagamentos: x.n, valor: r2(x.v) } }).sort(function (a, b) { return b.valor - a.valor })
    return { colunas: [C('paciente', 'Paciente', 'paciente'), C('cpf', 'CPF'), C('pagamentos', 'Pagamentos', 'num'), C('valor', 'Total pago', 'moeda')], linhas: l, totais: { pagamentos: soma(l, 'pagamentos'), valor: soma(l, 'valor') } }
})
rel('fin-comissoes', 'Financeiro', 'Pagamentos e comissões', 'Comissões geradas no período por profissional, pagas e pendentes.', { perm: 'financeiro.comissoes', filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT profissional_id, profissional_nome, status, COUNT(*) n, SUM(valor_comissao) v FROM comissoes_lancamentos WHERE clinica_id=? AND substr(data_referencia,1,10) BETWEEN ? AND ? AND status<>'cancelado'" + (f.prof ? ' AND profissional_id=?' : '') + " GROUP BY profissional_id, profissional_nome, status", [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []))
    var m = {}
    rows.forEach(function (x) { var k = x.profissional_nome || '—'; m[k] = m[k] || { profissional: k, qtd: 0, pago: 0, pendente: 0 }; m[k].qtd += Number(x.n); m[k][x.status === 'pago' ? 'pago' : 'pendente'] += Number(x.v) || 0 })
    var l = Object.keys(m).map(function (k) { var o = m[k]; o.pago = r2(o.pago); o.pendente = r2(o.pendente); o.total = r2(o.pago + o.pendente); return o }).sort(function (a, b) { return b.total - a.total })
    return { colunas: [C('profissional', 'Profissional'), C('qtd', 'Comissões', 'num'), C('pago', 'Pago', 'moeda'), C('pendente', 'A pagar', 'moeda'), C('total', 'Total', 'moeda')], linhas: l, totais: { qtd: soma(l, 'qtd'), pago: soma(l, 'pago'), pendente: soma(l, 'pendente'), total: soma(l, 'total') } }
})
rel('fin-lancamentos', 'Financeiro', 'Lançamentos manuais', 'Lançamentos feitos à mão na conta corrente, com quem lançou.', { perm: 'financeiro.acessar' }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT l.*, cb.nome conta FROM lancamentos l LEFT JOIN contas_bancarias cb ON cb.id=l.conta_id AND cb.clinica_id=l.clinica_id WHERE l.clinica_id=? AND substr(l.data,1,10) BETWEEN ? AND ? ORDER BY l.data, l.id", [cid, f.de, f.ate])
    var l = rows.map(function (x) { var s = /sa[ií]da|estorno/i.test(x.tipo || ''); return { data: String(x.data).slice(0, 10), tipo: x.tipo, descricao: x.descricao || '', categoria: x.categoria || '', conta: x.conta || 'Caixa geral', criado_por: x.criado_por_nome || '', valor: s ? -r2(x.valor) : r2(x.valor) } })
    return { colunas: [C('data', 'Data', 'data'), C('tipo', 'Tipo'), C('descricao', 'Descrição'), C('categoria', 'Categoria'), C('conta', 'Conta'), C('criado_por', 'Lançado por'), C('valor', 'Valor', 'moeda')], linhas: l, totais: { valor: soma(l, 'valor') } }
})

// ── Pacientes ─────────────────────────────────────────────────────
rel('pac-novos', 'Pacientes', 'Novos pacientes', 'Pacientes cadastrados no período e como conheceram a clínica.', {}, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT id, nome, COALESCE(whatsapp,telefone) telefone, como_conheceu, indicado_por_nome, substr(COALESCE(criado_em,''),1,10) cad FROM pacientes WHERE clinica_id=? AND substr(criado_em,1,10) BETWEEN ? AND ? ORDER BY criado_em", [cid, f.de, f.ate])
    var l = rows.map(function (x) { return { data: x.cad, paciente_id: x.id, paciente: x.nome, telefone: x.telefone || '', origem: x.como_conheceu || 'Não informado', indicado_por: x.indicado_por_nome || '' } })
    return { grafico: { tipo: 'barras', dados: agrupar(l, 'origem').map(function (x) { return { rotulo: x.chave, valor: x.n } }) }, resumo: [['Novos pacientes', l.length, 'num']],
        colunas: [C('data', 'Cadastro', 'data'), C('paciente', 'Paciente', 'paciente'), C('telefone', 'Telefone'), C('origem', 'Como conheceu'), C('indicado_por', 'Indicado por')], linhas: l }
})
rel('pac-aniversariantes', 'Pacientes', 'Aniversariantes', 'Pacientes ativos que fazem aniversário no período.', {}, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT id, nome, COALESCE(whatsapp,telefone) telefone, email, data_nascimento FROM pacientes WHERE clinica_id=? AND COALESCE(ativo,1)=1 AND data_nascimento IS NOT NULL AND data_nascimento<>''", [cid])
    var l = []
    rows.forEach(function (p) {
        var n = nasc(p.data_nascimento); if (!n) return
        for (var y = +f.de.slice(0, 4); y <= +f.ate.slice(0, 4); y++) { var d = y + n.slice(4); if (d >= f.de && d <= f.ate) l.push({ data: d, paciente_id: p.id, paciente: p.nome, idade: y - +n.slice(0, 4), telefone: p.telefone || '', email: p.email || '' }) }
    })
    l.sort(function (a, b) { return a.data.localeCompare(b.data) })
    return { resumo: [['Aniversariantes', l.length, 'num']], colunas: [C('data', 'Aniversário', 'data'), C('paciente', 'Paciente', 'paciente'), C('idade', 'Fará', 'num'), C('telefone', 'Telefone'), C('email', 'E-mail')], linhas: l.slice(0, 3000) }
})
rel('pac-faixa-etaria', 'Pacientes', 'Faixa etária', 'Distribuição dos pacientes ativos por idade e sexo.', { filtros: [] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT data_nascimento, sexo FROM pacientes WHERE clinica_id=? AND COALESCE(ativo,1)=1", [cid])
    var faixas = [['0 a 12', 0, 12], ['13 a 17', 13, 17], ['18 a 29', 18, 29], ['30 a 39', 30, 39], ['40 a 49', 40, 49], ['50 a 59', 50, 59], ['60 a 69', 60, 69], ['70 ou mais', 70, 200]]
    var l = faixas.map(function (fx) { return { faixa: fx[0], feminino: 0, masculino: 0, outro: 0, total: 0 } }).concat([{ faixa: 'Sem data de nascimento', feminino: 0, masculino: 0, outro: 0, total: 0 }])
    rows.forEach(function (p) {
        var i = idade(p.data_nascimento, f.hoje), k = /^f/i.test(p.sexo || '') ? 'feminino' : /^m/i.test(p.sexo || '') ? 'masculino' : 'outro'
        var ix = i == null ? l.length - 1 : faixas.findIndex(function (fx) { return i >= fx[1] && i <= fx[2] })
        l[ix][k]++; l[ix].total++
    })
    l.forEach(function (x) { x.perc = pct(x.total, rows.length) })
    return { grafico: { tipo: 'barras', rotulo: 'faixa', valor: 'total' }, colunas: [C('faixa', 'Faixa etária'), C('feminino', 'Feminino', 'num'), C('masculino', 'Masculino', 'num'), C('outro', 'Não informado', 'num'), C('total', 'Total', 'num'), C('perc', '%', 'pct')], linhas: l, totais: { feminino: soma(l, 'feminino'), masculino: soma(l, 'masculino'), outro: soma(l, 'outro'), total: rows.length } }
})
rel('pac-localizacao', 'Pacientes', 'Localização', 'Pacientes ativos por cidade e bairro.', { filtros: [] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT COALESCE(NULLIF(TRIM(cidade),''),'Não informada') cidade, COALESCE(NULLIF(TRIM(bairro),''),'Não informado') bairro, COUNT(*) n FROM pacientes WHERE clinica_id=? AND COALESCE(ativo,1)=1 GROUP BY 1,2 ORDER BY n DESC LIMIT 500", [cid])
    var tot = rows.reduce(function (s, x) { return s + Number(x.n) }, 0)
    var l = rows.map(function (x) { return { cidade: x.cidade, bairro: x.bairro, pacientes: Number(x.n), perc: pct(Number(x.n), tot) } })
    return { colunas: [C('cidade', 'Cidade'), C('bairro', 'Bairro'), C('pacientes', 'Pacientes', 'num'), C('perc', '%', 'pct')], linhas: l, totais: { pacientes: tot } }
})
rel('pac-indicacoes', 'Pacientes', 'Origem e indicações', 'Como os pacientes conheceram a clínica e quem mais indicou (cadastros no período).', {}, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT COALESCE(NULLIF(TRIM(como_conheceu),''),'Não informado') origem, indicado_por_nome FROM pacientes WHERE clinica_id=? AND substr(criado_em,1,10) BETWEEN ? AND ?", [cid, f.de, f.ate])
    var g = agrupar(rows, 'origem')
    var ind = agrupar(rows.filter(function (x) { return x.indicado_por_nome }), 'indicado_por_nome').slice(0, 10)
    return { grafico: { tipo: 'barras', dados: g.map(function (x) { return { rotulo: x.chave, valor: x.n } }) }, resumo: ind.map(function (x) { return ['Indicou: ' + x.chave, x.n, 'num'] }).slice(0, 4),
        colunas: [C('origem', 'Como conheceu'), C('pacientes', 'Pacientes', 'num'), C('perc', '%', 'pct')], linhas: g.map(function (x) { return { origem: x.chave, pacientes: x.n, perc: pct(x.n, rows.length) } }), totais: { pacientes: rows.length } }
})
rel('pac-orcamentos', 'Pacientes', 'Orçamentos', 'Orçamentos criados no período, situação e valor.', { filtros: ['periodo', 'profissional', 'status_orcamento'] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT o.*, p.nome paciente FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE o.clinica_id=? AND substr(o.data_criacao,1,10) BETWEEN ? AND ?" + (f.prof ? ' AND o.profissional_id=?' : '') + (f.status ? ' AND COALESCE(o.status,\'aberto\')=?' : '') + " ORDER BY o.data_criacao", [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []).concat(f.status ? [f.status] : []))
    var SN = { aberto: 'Em aberto', aprovado: 'Aprovado', reprovado: 'Reprovado', desaprovado: 'Desaprovado' }
    var l = rows.map(function (o) { return { data: String(o.data_criacao).slice(0, 10), paciente_id: o.paciente_id, paciente: o.paciente || '', titulo: o.titulo || 'Orçamento #' + o.id, profissional: o.profissional_nome || '', tabela: o.tabela_preco || '', situacao: SN[o.status || 'aberto'] || o.status, valor: r2((Number(o.valor_total) || 0) - (Number(o.desconto) || 0)) } })
    var ap = l.filter(function (x) { return x.situacao === 'Aprovado' })
    return { resumo: [['Orçamentos', l.length, 'num'], ['Valor orçado', soma(l, 'valor'), 'moeda'], ['Aprovado', soma(ap, 'valor'), 'moeda'], ['Conversão (valor)', pct(soma(ap, 'valor'), soma(l, 'valor')), 'pct']],
        colunas: [C('data', 'Data', 'data'), C('paciente', 'Paciente', 'paciente'), C('titulo', 'Tratamento'), C('profissional', 'Profissional'), C('tabela', 'Tabela'), C('situacao', 'Situação'), C('valor', 'Valor', 'moeda')], linhas: l, totais: { valor: soma(l, 'valor') } }
})
rel('pac-oportunidades', 'Pacientes', 'Oportunidades e conversão', 'Por mês: orçamentos apresentados, aprovados, conversão e ticket médio.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT substr(data_criacao,1,7) ym, COALESCE(status,'aberto') st, COUNT(*) n, SUM(valor_total-COALESCE(desconto,0)) v FROM orcamentos WHERE clinica_id=? AND substr(data_criacao,1,10) BETWEEN ? AND ?" + (f.prof ? ' AND profissional_id=?' : '') + " GROUP BY 1,2", [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []))
    var l = mesesEntre(f.de, f.ate).map(function (ym) {
        var o = { mes: rotMes(ym), qtd: 0, valor: 0, aprovados: 0, valor_aprovado: 0, abertos: 0, reprovados: 0 }
        rows.filter(function (x) { return x.ym === ym }).forEach(function (x) { var n = Number(x.n), v = Number(x.v) || 0; o.qtd += n; o.valor += v; if (x.st === 'aprovado') { o.aprovados += n; o.valor_aprovado += v } else if (x.st === 'aberto') o.abertos += n; else o.reprovados += n })
        o.valor = r2(o.valor); o.valor_aprovado = r2(o.valor_aprovado); o.conversao = pct(o.aprovados, o.qtd); o.ticket = o.aprovados ? r2(o.valor_aprovado / o.aprovados) : 0
        return o
    })
    return { grafico: { tipo: 'barras', rotulo: 'mes', valor: 'valor_aprovado' }, colunas: [C('mes', 'Mês'), C('qtd', 'Orçamentos', 'num'), C('valor', 'Valor orçado', 'moeda'), C('aprovados', 'Aprovados', 'num'), C('valor_aprovado', 'Valor aprovado', 'moeda'), C('abertos', 'Em aberto', 'num'), C('reprovados', 'Reprovados', 'num'), C('conversao', 'Conversão', 'pct'), C('ticket', 'Ticket médio', 'moeda')], linhas: l,
        totais: { qtd: soma(l, 'qtd'), valor: soma(l, 'valor'), aprovados: soma(l, 'aprovados'), valor_aprovado: soma(l, 'valor_aprovado'), abertos: soma(l, 'abertos'), reprovados: soma(l, 'reprovados'), conversao: pct(soma(l, 'aprovados'), soma(l, 'qtd')) } }
})
rel('pac-cobranca', 'Pacientes', 'Cobrança e pagamentos', 'Parcelas de tratamento com vencimento no período: pagas, a vencer e vencidas, por paciente.', { perm: 'financeiro.acessar', filtros: ['periodo', 'status_parcela'] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT po.*, p.nome paciente, COALESCE(p.whatsapp,p.telefone) telefone FROM parcelas_orcamento po LEFT JOIN pacientes p ON p.id=po.paciente_id AND p.clinica_id=po.clinica_id WHERE po.clinica_id=? AND po.status IN ('pendente','vencido','pago') AND substr(po.data_vencimento,1,10) BETWEEN ? AND ? ORDER BY po.data_vencimento", [cid, f.de, f.ate])
    var l = rows.map(function (x) { var v = String(x.data_vencimento).slice(0, 10); return { vencimento: v, paciente_id: x.paciente_id, paciente: x.paciente || '', telefone: x.telefone || '', parcela: x.numero_parcela + '/' + x.total_parcelas, situacao: x.status === 'pago' ? 'Paga' : v < f.hoje ? 'Vencida' : 'A vencer', dias_atraso: x.status !== 'pago' && v < f.hoje ? difDias(v, f.hoje) : '', pagamento: x.data_pagamento ? String(x.data_pagamento).slice(0, 10) : '', valor: r2(x.valor) } })
    if (f.status) l = l.filter(function (x) { return x.situacao === { pago: 'Paga', vencido: 'Vencida', a_vencer: 'A vencer' }[f.status] })
    var venc = l.filter(function (x) { return x.situacao === 'Vencida' })
    return { resumo: [['Pago', soma(l.filter(function (x) { return x.situacao === 'Paga' }), 'valor'), 'moeda'], ['A vencer', soma(l.filter(function (x) { return x.situacao === 'A vencer' }), 'valor'), 'moeda'], ['Vencido', soma(venc, 'valor'), 'moeda'], ['Inadimplência', pct(soma(venc, 'valor'), soma(l, 'valor')), 'pct']],
        colunas: [C('vencimento', 'Vencimento', 'data'), C('paciente', 'Paciente', 'paciente'), C('telefone', 'Telefone'), C('parcela', 'Parcela'), C('situacao', 'Situação'), C('dias_atraso', 'Dias em atraso', 'num'), C('pagamento', 'Pago em', 'data'), C('valor', 'Valor', 'moeda')], linhas: l, totais: { valor: soma(l, 'valor') } }
})
rel('pac-convenios', 'Pacientes', 'Planos / convênios', 'Pacientes com orçamento em tabela de convênio e valor coberto pelo plano.', {}, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT o.tabela_preco convenio, COUNT(DISTINCT o.paciente_id) pacientes, COUNT(DISTINCT o.id) orcamentos, COALESCE(SUM(oi.valor_plano*COALESCE(oi.quantidade,1)),0) plano FROM orcamentos o JOIN precos_tabelas pt ON pt.clinica_id=o.clinica_id AND UPPER(pt.nome)=UPPER(o.tabela_preco) AND pt.tipo='convenio' LEFT JOIN orcamento_itens oi ON oi.orcamento_id=o.id AND oi.clinica_id=o.clinica_id WHERE o.clinica_id=? AND substr(o.data_criacao,1,10) BETWEEN ? AND ? GROUP BY o.tabela_preco ORDER BY pacientes DESC", [cid, f.de, f.ate])
    var l = rows.map(function (x) { return { convenio: x.convenio, pacientes: Number(x.pacientes), orcamentos: Number(x.orcamentos), plano: r2(x.plano) } })
    return { colunas: [C('convenio', 'Convênio'), C('pacientes', 'Pacientes', 'num'), C('orcamentos', 'Orçamentos', 'num'), C('plano', 'Coberto pelo plano', 'moeda')], linhas: l, totais: { pacientes: soma(l, 'pacientes'), orcamentos: soma(l, 'orcamentos'), plano: soma(l, 'plano') } }
})
rel('pac-ultimo', 'Pacientes', 'Último agendamento', 'Pacientes ativos e há quantos dias vieram pela última vez (para reativação).', { filtros: ['dias_min'] }, async function (c, cid, f, q) {
    var min = Math.max(parseInt(q.dias_min, 10) || 180, 0)
    var rows = await tentar(c, "SELECT p.id, p.nome, COALESCE(p.whatsapp,p.telefone) telefone, MAX(substr(a.data_hora,1,10)) ultima FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id AND a.clinica_id=p.clinica_id AND COALESCE(a.status,'') NOT IN ('desmarcado','cancelado','faltou') AND substr(a.data_hora,1,10)<=? WHERE p.clinica_id=? AND COALESCE(p.ativo,1)=1 GROUP BY p.id HAVING ultima IS NULL OR ultima<=? ORDER BY ultima LIMIT 3000", [f.hoje, cid, addDias(f.hoje, -min)])
    var fut = {}
    ;(await tentar(c, "SELECT DISTINCT paciente_id FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10)>? AND COALESCE(status,'') NOT IN ('desmarcado','cancelado')", [cid, f.hoje])).forEach(function (x) { fut[x.paciente_id] = 1 })
    var l = rows.filter(function (x) { return !fut[x.id] }).map(function (x) { return { paciente_id: x.id, paciente: x.nome, telefone: x.telefone || '', ultima: x.ultima || '', dias: x.ultima ? difDias(x.ultima, f.hoje) : '' } })
    return { resumo: [['Pacientes sem vir há ' + min + '+ dias', l.length, 'num']], colunas: [C('paciente', 'Paciente', 'paciente'), C('telefone', 'Telefone'), C('ultima', 'Último atendimento', 'data'), C('dias', 'Dias sem vir', 'num')], linhas: l }
})
rel('pac-regua', 'Pacientes', 'Alertas da régua de cobrança', 'Lembretes de pagamento enviados no período e o resultado.', { perm: 'financeiro.acessar' }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT e.*, r.dias, p.nome paciente, po.paciente_id, po.valor, po.data_vencimento, po.status pst FROM regua_envios e LEFT JOIN regua_regras r ON r.id=e.regra_id AND r.clinica_id=e.clinica_id LEFT JOIN parcelas_orcamento po ON po.id=e.parcela_id AND po.clinica_id=e.clinica_id LEFT JOIN pacientes p ON p.id=po.paciente_id AND p.clinica_id=e.clinica_id WHERE e.clinica_id=? AND substr(e.enviado_em,1,10) BETWEEN ? AND ? ORDER BY e.id", [cid, f.de, f.ate])
    var SN = { enviado: 'Enviado', erro: 'Erro', sem_destino: 'Sem contato', sem_template: 'Sem modelo', sem_canal: 'Sem canal' }
    var l = rows.map(function (x) { return { data: String(x.enviado_em).slice(0, 10), paciente_id: x.paciente_id, paciente: x.paciente || '', regra: x.dias == null ? '—' : x.dias === 0 ? 'No vencimento' : Math.abs(x.dias) + ' dia(s) ' + (x.dias < 0 ? 'antes' : 'depois'), canal: x.canal === 'email' ? 'E-mail' : 'WhatsApp', situacao: SN[x.status] || x.status, pagou: x.pst === 'pago' ? 'Sim' : 'Não', valor: r2(x.valor) } })
    var env = l.filter(function (x) { return x.situacao === 'Enviado' })
    return { resumo: [['Enviados', env.length, 'num'], ['Pagaram depois', env.filter(function (x) { return x.pagou === 'Sim' }).length, 'num'], ['Falharam', l.length - env.length, 'num']],
        colunas: [C('data', 'Data', 'data'), C('paciente', 'Paciente', 'paciente'), C('regra', 'Lembrete'), C('canal', 'Canal'), C('situacao', 'Situação'), C('pagou', 'Parcela paga'), C('valor', 'Valor', 'moeda')], linhas: l }
})

// ── Tratamentos ───────────────────────────────────────────────────
rel('tr-faturamento', 'Tratamentos', 'Faturamento (vendas)', 'Tratamentos aprovados no período por profissional: valor vendido, desconto e ticket médio.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT COALESCE(profissional_nome,'—') profissional, COUNT(*) n, SUM(valor_total) bruto, SUM(COALESCE(desconto,0)) desconto FROM orcamentos WHERE clinica_id=? AND status='aprovado' AND substr(COALESCE(data_aprovacao,data_criacao),1,10) BETWEEN ? AND ?" + (f.prof ? ' AND profissional_id=?' : '') + " GROUP BY 1 ORDER BY bruto DESC", [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []))
    var l = rows.map(function (x) { var liq = (Number(x.bruto) || 0) - (Number(x.desconto) || 0); return { profissional: x.profissional, tratamentos: Number(x.n), bruto: r2(x.bruto), desconto: r2(x.desconto), liquido: r2(liq), ticket: x.n ? r2(liq / x.n) : 0 } })
    return { grafico: { tipo: 'barras', rotulo: 'profissional', valor: 'liquido' }, resumo: [['Vendido', soma(l, 'liquido'), 'moeda'], ['Tratamentos', soma(l, 'tratamentos'), 'num'], ['Ticket médio', soma(l, 'tratamentos') ? r2(soma(l, 'liquido') / soma(l, 'tratamentos')) : 0, 'moeda']],
        colunas: [C('profissional', 'Profissional'), C('tratamentos', 'Tratamentos', 'num'), C('bruto', 'Valor bruto', 'moeda'), C('desconto', 'Descontos', 'moeda'), C('liquido', 'Vendido', 'moeda'), C('ticket', 'Ticket médio', 'moeda')], linhas: l,
        totais: { tratamentos: soma(l, 'tratamentos'), bruto: soma(l, 'bruto'), desconto: soma(l, 'desconto'), liquido: soma(l, 'liquido') } }
})
var SEL_IT = "SELECT oi.*, o.paciente_id, o.status ost, o.data_aprovacao, o.tabela_preco, p.nome paciente FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE oi.clinica_id=?"
function itemLinha(x) { var q = Number(x.quantidade) || 1; return { paciente_id: x.paciente_id, paciente: x.paciente || '', procedimento: x.procedimento_nome || '', dente: [x.dente, x.faces ? '(' + x.faces + ')' : ''].filter(Boolean).join(' '), profissional: x.profissional_nome || '', tabela: x.tabela_preco || '', particular: r2((Number(x.valor_unitario) || 0) * q), plano: r2((Number(x.valor_plano) || 0) * q) } }
rel('tr-executados', 'Tratamentos', 'Procedimentos executados', 'Procedimentos marcados como executados no período (produção clínica).', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var rows = await tentar(c, SEL_IT + " AND COALESCE(oi.executado,0)=1 AND substr(oi.data_execucao,1,10) BETWEEN ? AND ?" + (f.prof ? ' AND oi.profissional_id=?' : '') + " ORDER BY oi.data_execucao", [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []))
    var l = rows.map(function (x) { return Object.assign({ data: String(x.data_execucao).slice(0, 10) }, itemLinha(x)) })
    return { resumo: [['Procedimentos', l.length, 'num'], ['Produção particular', soma(l, 'particular'), 'moeda'], ['Produção convênio', soma(l, 'plano'), 'moeda']],
        colunas: [C('data', 'Execução', 'data'), C('paciente', 'Paciente', 'paciente'), C('procedimento', 'Procedimento'), C('dente', 'Dente'), C('profissional', 'Profissional'), C('particular', 'Particular', 'moeda'), C('plano', 'Convênio', 'moeda')], linhas: l, totais: { particular: soma(l, 'particular'), plano: soma(l, 'plano') } }
})
rel('tr-producao', 'Tratamentos', 'Produção por profissional', 'Valor executado por profissional no período (particular + convênio).', { filtros: ['periodo'] }, async function (c, cid, f) {
    var rows = await tentar(c, SEL_IT + " AND COALESCE(oi.executado,0)=1 AND substr(oi.data_execucao,1,10) BETWEEN ? AND ?", [cid, f.de, f.ate])
    var g = agrupar(rows.map(itemLinha), function (x) { return x.profissional || '—' }, [['p', function (x) { return x.particular }], ['c', function (x) { return x.plano }]])
    var l = g.map(function (x) { return { profissional: x.chave, procedimentos: x.n, particular: r2(x.p), plano: r2(x.c), total: r2(x.p + x.c) } }).sort(function (a, b) { return b.total - a.total })
    return { grafico: { tipo: 'barras', rotulo: 'profissional', valor: 'total' }, colunas: [C('profissional', 'Profissional'), C('procedimentos', 'Procedimentos', 'num'), C('particular', 'Particular', 'moeda'), C('plano', 'Convênio', 'moeda'), C('total', 'Total', 'moeda')], linhas: l,
        totais: { procedimentos: soma(l, 'procedimentos'), particular: soma(l, 'particular'), plano: soma(l, 'plano'), total: soma(l, 'total') } }
})
rel('tr-nao-executados', 'Tratamentos', 'Procedimentos não executados', 'Procedimentos de tratamentos aprovados (no período) que ainda não foram feitos.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var rows = await tentar(c, SEL_IT + " AND o.status='aprovado' AND COALESCE(oi.executado,0)=0 AND substr(COALESCE(o.data_aprovacao,o.data_criacao),1,10) BETWEEN ? AND ?" + (f.prof ? ' AND oi.profissional_id=?' : '') + " ORDER BY o.data_aprovacao", [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []))
    var l = rows.map(function (x) { var a = String(x.data_aprovacao || '').slice(0, 10); return Object.assign({ aprovado: a, dias: a ? difDias(a, f.hoje) : '' }, itemLinha(x)) })
    return { resumo: [['Procedimentos pendentes', l.length, 'num'], ['Valor a executar', r2(soma(l, 'particular') + soma(l, 'plano')), 'moeda']],
        colunas: [C('aprovado', 'Aprovado em', 'data'), C('dias', 'Dias', 'num'), C('paciente', 'Paciente', 'paciente'), C('procedimento', 'Procedimento'), C('dente', 'Dente'), C('profissional', 'Profissional'), C('particular', 'Particular', 'moeda'), C('plano', 'Convênio', 'moeda')], linhas: l, totais: { particular: soma(l, 'particular'), plano: soma(l, 'plano') } }
})
rel('tr-em-aberto', 'Tratamentos', 'Tratamentos em aberto', 'Tratamentos aprovados com procedimentos a executar: progresso e próxima consulta.', { filtros: ['profissional'] }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT o.id, o.titulo, o.paciente_id, o.profissional_nome, o.data_aprovacao, p.nome paciente, COUNT(oi.id) itens, SUM(CASE WHEN COALESCE(oi.executado,0)=1 THEN 1 ELSE 0 END) feitos, SUM(CASE WHEN COALESCE(oi.executado,0)=0 THEN (COALESCE(oi.valor_unitario,0)+COALESCE(oi.valor_plano,0))*COALESCE(oi.quantidade,1) ELSE 0 END) restante FROM orcamentos o JOIN orcamento_itens oi ON oi.orcamento_id=o.id AND oi.clinica_id=o.clinica_id LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE o.clinica_id=? AND o.status='aprovado'" + (f.prof ? ' AND o.profissional_id=?' : '') + " GROUP BY o.id HAVING feitos<itens ORDER BY o.data_aprovacao LIMIT 3000", [cid].concat(f.prof ? [f.prof] : []))
    var prox = {}
    ;(await tentar(c, "SELECT paciente_id, MIN(substr(data_hora,1,10)) d FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10)>=? AND COALESCE(status,'') NOT IN ('desmarcado','cancelado','faltou') GROUP BY paciente_id", [cid, f.hoje])).forEach(function (x) { prox[x.paciente_id] = x.d })
    var l = rows.map(function (x) { return { aprovado: String(x.data_aprovacao || '').slice(0, 10), paciente_id: x.paciente_id, paciente: x.paciente || '', tratamento: x.titulo || 'Orçamento #' + x.id, profissional: x.profissional_nome || '', progresso: Number(x.feitos) + '/' + Number(x.itens), restante: r2(x.restante), proxima: prox[x.paciente_id] || '' } })
    return { resumo: [['Tratamentos em aberto', l.length, 'num'], ['Sem consulta marcada', l.filter(function (x) { return !x.proxima }).length, 'num'], ['Valor a executar', soma(l, 'restante'), 'moeda']],
        colunas: [C('aprovado', 'Aprovado em', 'data'), C('paciente', 'Paciente', 'paciente'), C('tratamento', 'Tratamento'), C('profissional', 'Profissional'), C('progresso', 'Executados'), C('restante', 'A executar', 'moeda'), C('proxima', 'Próxima consulta', 'data')], linhas: l, totais: { restante: soma(l, 'restante') } }
})
rel('tr-procedimentos', 'Tratamentos', 'Procedimentos mais vendidos', 'Ranking dos procedimentos nos tratamentos aprovados do período.', { filtros: ['periodo', 'profissional'] }, async function (c, cid, f) {
    var rows = await tentar(c, SEL_IT + " AND o.status='aprovado' AND substr(COALESCE(o.data_aprovacao,o.data_criacao),1,10) BETWEEN ? AND ?" + (f.prof ? ' AND oi.profissional_id=?' : ''), [cid, f.de, f.ate].concat(f.prof ? [f.prof] : []))
    var g = agrupar(rows.map(itemLinha), 'procedimento', [['q', function () { return 1 }], ['v', function (x) { return x.particular + x.plano }]])
    var l = g.map(function (x) { return { procedimento: x.chave, quantidade: x.n, valor: r2(x.v), medio: r2(x.v / x.n) } }).sort(function (a, b) { return b.valor - a.valor })
    return { grafico: { tipo: 'barras', rotulo: 'procedimento', valor: 'valor' }, colunas: [C('procedimento', 'Procedimento'), C('quantidade', 'Quantidade', 'num'), C('valor', 'Valor vendido', 'moeda'), C('medio', 'Valor médio', 'moeda')], linhas: l, totais: { quantidade: soma(l, 'quantidade'), valor: soma(l, 'valor') } }
})

// ── Geral ─────────────────────────────────────────────────────────
rel('ger-mensagens', 'Geral', 'Mensagens enviadas', 'Confirmações, campanhas e avisos enviados por e-mail e WhatsApp no período.', {}, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT e.*, p.nome paciente FROM envios e LEFT JOIN pacientes p ON p.id=e.paciente_id AND p.clinica_id=e.clinica_id WHERE e.clinica_id=? AND substr(e.enviado_em,1,10) BETWEEN ? AND ? ORDER BY e.id DESC LIMIT 5000", [cid, f.de, f.ate])
    var l = rows.map(function (x) { return { data: String(x.enviado_em).slice(0, 10), hora: String(x.enviado_em).slice(11, 16), paciente_id: x.paciente_id, paciente: x.paciente || '', canal: x.canal === 'email' ? 'E-mail' : 'WhatsApp', destino: x.destinatario || '', situacao: x.status === 'enviado' ? 'Enviado' : 'Erro', mensagem: String(x.mensagem_final || '').slice(0, 120) } })
    return { resumo: [['Mensagens', l.length, 'num'], ['WhatsApp', l.filter(function (x) { return x.canal === 'WhatsApp' }).length, 'num'], ['E-mail', l.filter(function (x) { return x.canal === 'E-mail' }).length, 'num'], ['Com erro', l.filter(function (x) { return x.situacao === 'Erro' }).length, 'num']],
        colunas: [C('data', 'Data', 'data'), C('hora', 'Hora'), C('paciente', 'Paciente', 'paciente'), C('canal', 'Canal'), C('destino', 'Destino'), C('situacao', 'Situação'), C('mensagem', 'Mensagem')], linhas: l }
})
rel('ger-acessos', 'Geral', 'Acessos por usuário', 'Usuários da clínica, perfil e último acesso.', { filtros: [], perm: 'usuarios.acessar' }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT nome, email, perfil, ativo, ultimo_login FROM usuarios WHERE clinica_id=? ORDER BY ultimo_login DESC", [cid])
    var l = rows.map(function (x) { return { nome: x.nome || '', perfil: x.perfil || '', situacao: x.ativo === 0 ? 'Inativo' : 'Ativo', ultimo: x.ultimo_login ? String(x.ultimo_login).slice(0, 16).replace('T', ' ') : 'Nunca', dias: x.ultimo_login ? difDias(String(x.ultimo_login).slice(0, 10), f.hoje) : '' } })
    return { colunas: [C('nome', 'Usuário'), C('perfil', 'Perfil'), C('situacao', 'Situação'), C('ultimo', 'Último acesso'), C('dias', 'Dias sem acessar', 'num')], linhas: l }
})
rel('ger-exclusoes', 'Geral', 'Exclusões (auditoria)', 'Registros excluídos no período, por quem e se já foram restaurados.', { perm: 'configuracoes.editar' }, async function (c, cid, f) {
    var rows = await tentar(c, "SELECT * FROM lixeira WHERE clinica_id=? AND substr(excluido_em,1,10) BETWEEN ? AND ? ORDER BY id DESC LIMIT 3000", [cid, f.de, f.ate])
    var l = rows.map(function (x) { return { data: String(x.excluido_em).slice(0, 16), tipo: x.tipo, descricao: x.descricao || '', por: x.excluido_por_nome || '', restaurado: x.restaurado_em ? 'Sim' : 'Não' } })
    return { colunas: [C('data', 'Excluído em'), C('tipo', 'Tipo'), C('descricao', 'Registro'), C('por', 'Por'), C('restaurado', 'Restaurado')], linhas: l }
})

// ════════════════════════════════════════════════════════════════
// METAS
// ════════════════════════════════════════════════════════════════
var TIPOS_META = {
    vendas: { nome: 'Vendas (tratamentos aprovados)', moeda: true, prof: true },
    recebimentos: { nome: 'Recebimentos', moeda: true, prof: true },
    producao: { nome: 'Produção (procedimentos executados)', moeda: true, prof: true },
    agendamentos: { nome: 'Agendamentos', prof: true },
    primeiras: { nome: 'Primeiras consultas', prof: true },
    novos_pacientes: { nome: 'Novos pacientes' },
    faltas: { nome: 'Faltas (limite máximo)', inversa: true, prof: true }
}
async function alcancado(c, cid, tipo, de, ate, prof) {
    var P = prof ? [prof] : []
    function um(rows) { return rows.length ? Number(rows[0].v) || 0 : 0 }
    if (tipo === 'vendas') return r2(um(await tentar(c, "SELECT SUM(valor_total-COALESCE(desconto,0)) v FROM orcamentos WHERE clinica_id=? AND status='aprovado' AND substr(COALESCE(data_aprovacao,data_criacao),1,10) BETWEEN ? AND ?" + (prof ? ' AND profissional_id=?' : ''), [cid, de, ate].concat(P))))
    if (tipo === 'recebimentos') {
        if (!prof) return r2((await fin.movimentos(c, cid, de, ate)).filter(function (m) { return m.tipo === 'entrada' }).reduce(function (s, m) { return s + m.valor }, 0))
        return r2(um(await tentar(c, "SELECT SUM(po.valor) v FROM parcelas_orcamento po JOIN orcamentos o ON o.id=po.orcamento_id AND o.clinica_id=po.clinica_id WHERE po.clinica_id=? AND po.status='pago' AND substr(po.data_pagamento,1,10) BETWEEN ? AND ? AND o.profissional_id=?", [cid, de, ate, prof])))
    }
    if (tipo === 'producao') return r2(um(await tentar(c, "SELECT SUM((COALESCE(valor_unitario,0)+COALESCE(valor_plano,0))*COALESCE(quantidade,1)) v FROM orcamento_itens WHERE clinica_id=? AND COALESCE(executado,0)=1 AND substr(data_execucao,1,10) BETWEEN ? AND ?" + (prof ? ' AND profissional_id=?' : ''), [cid, de, ate].concat(P))))
    if (tipo === 'agendamentos') return um(await tentar(c, "SELECT COUNT(*) v FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10) BETWEEN ? AND ? AND COALESCE(status,'') NOT IN " + DESM + (prof ? ' AND profissional_id=?' : ''), [cid, de, ate].concat(P)))
    if (tipo === 'primeiras') return um(await tentar(c, "SELECT COUNT(*) v FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10) BETWEEN ? AND ? AND primeira_consulta=1 AND COALESCE(status,'') NOT IN " + DESM + (prof ? ' AND profissional_id=?' : ''), [cid, de, ate].concat(P)))
    if (tipo === 'faltas') return um(await tentar(c, "SELECT COUNT(*) v FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10) BETWEEN ? AND ? AND status='faltou'" + (prof ? ' AND profissional_id=?' : ''), [cid, de, ate].concat(P)))
    if (tipo === 'novos_pacientes') return um(await tentar(c, "SELECT COUNT(*) v FROM pacientes WHERE clinica_id=? AND substr(criado_em,1,10) BETWEEN ? AND ?", [cid, de, ate]))
    return 0
}
// Situação da meta: % atingido, esperado até hoje (proporcional ao tempo) e projeção
function avaliar(m, valor, hoje) {
    var total = Math.max(difDias(m.data_inicio, m.data_fim) + 1, 1)
    var passados = hoje < m.data_inicio ? 0 : hoje > m.data_fim ? total : difDias(m.data_inicio, hoje) + 1
    var frac = passados / total, esperado = r2(Number(m.valor) * frac), proj = passados ? r2(valor / passados * total) : 0
    var inversa = TIPOS_META[m.tipo] && TIPOS_META[m.tipo].inversa
    var p = pct(valor, Number(m.valor))
    var situacao = passados === 0 ? 'nao_iniciada' : inversa ? (valor > Number(m.valor) ? 'estourou' : valor > esperado ? 'atencao' : 'ok') : (valor >= Number(m.valor) ? 'atingida' : valor >= esperado * 0.95 ? 'ok' : 'atencao')
    return { alcancado: valor, percentual: p, esperado: esperado, projecao: proj, tempo: Math.round(frac * 100), situacao: situacao, encerrada: hoje > m.data_fim }
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }

    if (route === 'relatorios-catalogo') {
        var lista = []
        for (var i = 0; i < R.length; i++) if (!R[i].perm || await permissoes.pode(client, auth, R[i].perm)) lista.push({ id: R[i].id, cat: R[i].cat, nome: R[i].nome, desc: R[i].desc, filtros: R[i].filtros })
        return json(200, { success: true, categorias: CATS, relatorios: lista })
    }

    if (route === 'relatorio') {
        var r = R.filter(function (x) { return x.id === q.id })[0]
        if (!r) return json(404, { success: false, error: 'Relatório não encontrado' })
        if (r.perm && !(await permissoes.pode(client, auth, r.perm))) return json(403, { success: false, error: 'Seu perfil não tem acesso a este relatório' })
        var f = filtros(q)
        var out = await r.run(client, clinica_id, f, q)
        if (out.linhas && out.linhas.length > 5000) { out.linhas = out.linhas.slice(0, 5000); out.cortado = true }
        if (out.resumo) out.resumo = out.resumo.map(function (x) { return { rotulo: x[0], valor: x[1], tipo: x[2] } })
        return json(200, Object.assign({ success: true, relatorio: { id: r.id, cat: r.cat, nome: r.nome, desc: r.desc }, de: f.de, ate: f.ate }, out))
    }

    // ── Metas ─────────────────────────────────────────────────────
    if (route === 'metas-config') {
        if (req.method === 'POST') {
            if (b.action === 'delete') {
                var lix = require('../lixeira')
                var ok = await lix.moverParaLixeira(client, auth, 'meta', parseInt(b.id, 10) || 0)
                return ok ? json(200, { success: true }) : json(404, { success: false, error: 'Meta não encontrada' })
            }
            if (!TIPOS_META[b.tipo]) return json(400, { success: false, error: 'Tipo de meta inválido' })
            var valor = Number(String(b.valor || '').replace(/\./g, '').replace(',', '.'))
            if (!(valor > 0)) return json(400, { success: false, error: 'Informe o valor da meta' })
            if (!DATA_RE.test(b.data_inicio || '') || !DATA_RE.test(b.data_fim || '') || b.data_fim < b.data_inicio) return json(400, { success: false, error: 'Período inválido' })
            var analise = b.analise === 'profissional' ? 'profissional' : 'clinica', ref = null, refNome = null
            if (analise === 'profissional') {
                if (!TIPOS_META[b.tipo].prof) return json(400, { success: false, error: 'Esta meta só existe para a clínica toda' })
                var pr = (await client.execute({ sql: "SELECT id, nome FROM profissionais WHERE id=? AND clinica_id=?", args: [b.referencia_id, clinica_id] })).rows[0]
                if (!pr) return json(400, { success: false, error: 'Escolha o profissional' })
                ref = pr.id; refNome = pr.nome
            }
            var args = [b.tipo, Math.round(valor * 100) / 100, b.data_inicio, b.data_fim, analise, ref, refNome]
            if (b.id) {
                var up = await client.execute({ sql: "UPDATE metas_config SET tipo=?, valor=?, data_inicio=?, data_fim=?, analise=?, referencia_id=?, referencia_nome=? WHERE id=? AND clinica_id=?", args: args.concat([b.id, clinica_id]) })
                return up.rowsAffected ? json(200, { success: true, id: b.id }) : json(404, { success: false, error: 'Meta não encontrada' })
            }
            var ins = await client.execute({ sql: "INSERT INTO metas_config(tipo,valor,data_inicio,data_fim,analise,referencia_id,referencia_nome,clinica_id) VALUES(?,?,?,?,?,?,?,?)", args: args.concat([clinica_id]) })
            return json(200, { success: true, id: Number(ins.lastInsertRowid) })
        }
        var ms = (await client.execute({ sql: "SELECT * FROM metas_config WHERE clinica_id=? ORDER BY data_inicio DESC, id DESC", args: [clinica_id] })).rows
        return json(200, { success: true, metas: ms, tipos: Object.keys(TIPOS_META).map(function (k) { return Object.assign({ id: k }, TIPOS_META[k]) }) })
    }

    if (route === 'metas-visualizar') {
        var hoje = hojeCG(), w = ['clinica_id=?'], a = [clinica_id]
        if (q.tipo) { w.push('tipo=?'); a.push(q.tipo) }
        if (q.periodo === 'vigentes') { w.push('data_fim>=? AND data_inicio<=?'); a.push(hoje, hoje) }
        else if (/^\d{4}$/.test(q.periodo || '')) { w.push("substr(data_inicio,1,4)<=? AND substr(data_fim,1,4)>=?"); a.push(q.periodo, q.periodo) }
        else if (/^\d{4}-\d{2}$/.test(q.periodo || '')) { w.push("substr(data_inicio,1,7)<=? AND substr(data_fim,1,7)>=?"); a.push(q.periodo, q.periodo) }
        var metas = (await client.execute({ sql: "SELECT * FROM metas_config WHERE " + w.join(' AND ') + " ORDER BY data_inicio DESC, id DESC LIMIT 200", args: a })).rows
        var out2 = []
        for (var k = 0; k < metas.length; k++) {
            var m = metas[k]
            var v = await alcancado(client, clinica_id, m.tipo, m.data_inicio, m.data_fim, m.analise === 'profissional' ? m.referencia_id : null)
            out2.push(Object.assign({ id: m.id, tipo: m.tipo, tipo_nome: (TIPOS_META[m.tipo] || {}).nome || m.tipo, moeda: !!(TIPOS_META[m.tipo] || {}).moeda, inversa: !!(TIPOS_META[m.tipo] || {}).inversa, valor: Number(m.valor), data_inicio: m.data_inicio, data_fim: m.data_fim, analise: m.analise || 'clinica', referencia_id: m.referencia_id, referencia_nome: m.referencia_nome }, avaliar(m, v, hoje)))
        }
        return json(200, { success: true, hoje: hoje, metas: out2 })
    }

    if (route === 'analitico') return json(200, Object.assign({ success: true }, await analitico(client, clinica_id, q)))

    return false
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD ANALÍTICO — mês de referência e os anteriores
// ════════════════════════════════════════════════════════════════
function minutos(h) { var p = String(h || '').split(':'); return p.length >= 2 ? +p[0] * 60 + +p[1] : null }
async function analitico(c, cid, q) {
    var hoje = hojeCG(), ref = /^\d{4}-\d{2}$/.test(q.mes || '') ? q.mes : hoje.slice(0, 7), n = Math.min(Math.max(parseInt(q.meses, 10) || 3, 1), 12)
    var meses = []
    for (var i = n - 1; i >= 0; i--) { var y = +ref.slice(0, 4), m = +ref.slice(5, 7) - i; while (m < 1) { m += 12; y-- } meses.push(y + '-' + String(m).padStart(2, '0')) }
    var de = meses[0] + '-01', ate = ultimoDia(ref)
    var out = { ref: ref, meses: meses.map(function (ym) { return { ym: ym, rotulo: rotMes(ym) } }) }

    // Fluxo de caixa
    var mv = await fin.movimentos(c, cid, de, ate)
    out.fluxo = meses.map(function (ym) { var e = 0, s = 0; mv.forEach(function (x) { if (x.data.slice(0, 7) === ym) { if (x.tipo === 'entrada') e += x.valor; else s += x.valor } }); return { entradas: r2(e), saidas: r2(s), resultado: r2(e - s) } })

    // Parcelas: previsto x recebido x inadimplência (por vencimento)
    var parc = await tentar(c, "SELECT substr(data_vencimento,1,7) ym, status, SUM(valor) v FROM parcelas_orcamento WHERE clinica_id=? AND substr(data_vencimento,1,10) BETWEEN ? AND ? AND status IN ('pendente','vencido','pago') GROUP BY 1,2", [cid, de, ate])
    out.parcelas = meses.map(function (ym) {
        var o = { previsto: 0, pago: 0, inadimplente: 0, a_vencer: 0 }
        parc.filter(function (x) { return x.ym === ym }).forEach(function (x) { var v = Number(x.v) || 0; o.previsto += v; if (x.status === 'pago') o.pago += v; else if (ultimoDia(ym) < hoje || x.status === 'vencido') o.inadimplente += v; else o.a_vencer += v })
        Object.keys(o).forEach(function (k) { o[k] = r2(o[k]) }); o.taxa = pct(o.inadimplente, o.previsto); return o
    })
    // inadimplência do mês de referência considerando vencimento até hoje
    var refP = await tentar(c, "SELECT status, CASE WHEN substr(data_vencimento,1,10)<? THEN 1 ELSE 0 END venc, SUM(valor) v FROM parcelas_orcamento WHERE clinica_id=? AND substr(data_vencimento,1,7)=? AND status IN ('pendente','vencido','pago') GROUP BY 1,2", [hoje, cid, ref])
    var ip = { pago: 0, inadimplente: 0, a_vencer: 0 }
    refP.forEach(function (x) { var v = Number(x.v) || 0; if (x.status === 'pago') ip.pago += v; else if (Number(x.venc)) ip.inadimplente += v; else ip.a_vencer += v })
    Object.keys(ip).forEach(function (k) { ip[k] = r2(ip[k]) })
    out.inadimplencia_ref = ip

    // Agenda
    var ag = await tentar(c, "SELECT substr(data_hora,1,7) ym, COALESCE(status,'agendado') st, COALESCE(primeira_consulta,0) pr, COUNT(*) n FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10) BETWEEN ? AND ? GROUP BY 1,2,3", [cid, de, ate])
    out.agenda = meses.map(function (ym) {
        var o = { total: 0, desmarcados: 0, faltas: 0, primeiras: 0, faltas_primeiras: 0 }
        ag.filter(function (x) { return x.ym === ym }).forEach(function (x) { var k = Number(x.n); if (/desmarcado|cancelado/.test(x.st)) { o.desmarcados += k; return } o.total += k; if (x.st === 'faltou') o.faltas += k; if (Number(x.pr) === 1) { o.primeiras += k; if (x.st === 'faltou') o.faltas_primeiras += k } })
        o.taxa_desm = pct(o.desmarcados, o.total + o.desmarcados); o.taxa_falta = pct(o.faltas, o.total); o.taxa_falta_primeira = pct(o.faltas_primeiras, o.primeiras)
        return o
    })
    var cats = await tentar(c, "SELECT COALESCE(ac.nome, NULLIF(a.tipo,''), 'Sem categoria') nome, COUNT(*) n FROM agendamentos a LEFT JOIN agenda_categorias ac ON ac.id=a.categoria_id AND ac.clinica_id=a.clinica_id WHERE a.clinica_id=? AND substr(a.data_hora,1,10) BETWEEN ? AND ? AND COALESCE(a.status,'') NOT IN " + DESM + " GROUP BY 1 ORDER BY n DESC LIMIT 8", [cid, de, ate])
    out.categorias = cats.map(function (x) { return { nome: x.nome, total: Number(x.n) } })

    // Ocupação: minutos agendados ÷ minutos de atendimento disponíveis (horários cadastrados)
    var hp = await tentar(c, "SELECT ph.profissional_id, ph.dia_semana, ph.hora_inicio, ph.hora_fim FROM profissional_horarios ph JOIN profissionais p ON p.id=ph.profissional_id AND p.clinica_id=ph.clinica_id WHERE ph.clinica_id=? AND COALESCE(p.ativo,1)=1", [cid])
    if (!hp.length) {
        var hc = await tentar(c, "SELECT dia_semana, hora_inicio, hora_fim FROM clinica_horarios WHERE clinica_id=?", [cid])
        var np = await tentar(c, "SELECT COUNT(*) n FROM profissionais WHERE clinica_id=? AND COALESCE(ativo,1)=1", [cid])
        var nprof = np.length ? Number(np[0].n) : 0
        hc.forEach(function (h) { for (var k = 0; k < nprof; k++) hp.push({ profissional_id: k, dia_semana: h.dia_semana, hora_inicio: h.hora_inicio, hora_fim: h.hora_fim }) })
    }
    if (hp.length) {
        var porDow = {}
        hp.forEach(function (h) { var mi = minutos(h.hora_fim) - minutos(h.hora_inicio); if (mi > 0) porDow[h.dia_semana] = (porDow[h.dia_semana] || 0) + mi })
        var oc = await tentar(c, "SELECT substr(data_hora,1,7) ym, substr(data_hora,12,5) ini, hora_fim FROM agendamentos WHERE clinica_id=? AND substr(data_hora,1,10) BETWEEN ? AND ? AND COALESCE(status,'') NOT IN " + DESM, [cid, de, ate])
        out.ocupacao = meses.map(function (ym) {
            var disp = 0
            for (var d = ym + '-01'; d <= ultimoDia(ym); d = addDias(d, 1)) disp += porDow[new Date(d + 'T12:00:00Z').getUTCDay()] || 0
            var usado = 0
            oc.forEach(function (x) { if (x.ym !== ym) return; var a = minutos(x.ini), f = minutos(x.hora_fim); usado += a != null && f != null && f > a ? f - a : 30 })
            return { disponivel_h: Math.round(disp / 60), agendado_h: Math.round(usado / 60), taxa: pct(usado, disp) }
        })
    } else out.ocupacao = null

    // Orçamentos e conversão, parcelamento médio
    var orc = await tentar(c, "SELECT substr(data_criacao,1,7) ym, COALESCE(status,'aberto') st, COUNT(*) n, SUM(valor_total-COALESCE(desconto,0)) v, AVG(COALESCE(parcelas,1)) parc FROM orcamentos WHERE clinica_id=? AND substr(data_criacao,1,10) BETWEEN ? AND ? GROUP BY 1,2", [cid, de, ate])
    out.orcamentos = meses.map(function (ym) {
        var o = { total: 0, valor_total: 0, aprovados: 0, valor_aprovado: 0, abertos: 0, valor_aberto: 0, reprovados: 0, valor_reprovado: 0, parcelas_media: 0 }
        orc.filter(function (x) { return x.ym === ym }).forEach(function (x) {
            var k = Number(x.n), v = Number(x.v) || 0; o.total += k; o.valor_total += v
            if (x.st === 'aprovado') { o.aprovados += k; o.valor_aprovado += v; o.parcelas_media = Math.round((Number(x.parc) || 1) * 10) / 10 }
            else if (x.st === 'aberto') { o.abertos += k; o.valor_aberto += v } else { o.reprovados += k; o.valor_reprovado += v }
        })
        ;['valor_total', 'valor_aprovado', 'valor_aberto', 'valor_reprovado'].forEach(function (k) { o[k] = r2(o[k]) })
        o.conversao = pct(o.aprovados, o.total); o.ticket = o.aprovados ? r2(o.valor_aprovado / o.aprovados) : 0
        return o
    })

    // Vendas por especialidade (itens dos tratamentos aprovados, especialidade da tabela de preços)
    var esp = await tentar(c, "SELECT COALESCE(NULLIF((SELECT tp.especialidade FROM tabela_precos tp WHERE tp.clinica_id=oi.clinica_id AND UPPER(tp.procedimento)=UPPER(oi.procedimento_nome) AND COALESCE(tp.especialidade,'')<>'' LIMIT 1),''),'Sem especialidade') esp, SUM((COALESCE(oi.valor_unitario,0)+COALESCE(oi.valor_plano,0))*COALESCE(oi.quantidade,1)) v FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id WHERE oi.clinica_id=? AND o.status='aprovado' AND substr(COALESCE(o.data_aprovacao,o.data_criacao),1,10) BETWEEN ? AND ? GROUP BY 1 ORDER BY v DESC LIMIT 8", [cid, de, ate])
    out.especialidades = esp.map(function (x) { return { nome: x.esp, valor: r2(x.v) } })

    // Metas da clínica que cobrem o mês de referência
    var mt = await tentar(c, "SELECT * FROM metas_config WHERE clinica_id=? AND COALESCE(analise,'clinica')='clinica' AND data_inicio<=? AND data_fim>=? ORDER BY tipo", [cid, ultimoDia(ref), ref + '-01'])
    out.metas = []
    for (var j = 0; j < mt.length; j++) {
        var v = await alcancado(c, cid, mt[j].tipo, mt[j].data_inicio, mt[j].data_fim, null)
        out.metas.push(Object.assign({ tipo: mt[j].tipo, tipo_nome: (TIPOS_META[mt[j].tipo] || {}).nome || mt[j].tipo, moeda: !!(TIPOS_META[mt[j].tipo] || {}).moeda, inversa: !!(TIPOS_META[mt[j].tipo] || {}).inversa, valor: Number(mt[j].valor), data_inicio: mt[j].data_inicio, data_fim: mt[j].data_fim }, avaliar(mt[j], v, hoje)))
    }

    // Oportunidade parada: orçamentos em aberto dos últimos 30 dias
    var op = (await tentar(c, "SELECT COUNT(*) n, COALESCE(SUM(valor_total-COALESCE(desconto,0)),0) v FROM orcamentos WHERE clinica_id=? AND COALESCE(status,'aberto')='aberto' AND substr(data_criacao,1,10)>=?", [cid, addDias(hoje, -30)]))[0] || { n: 0, v: 0 }
    out.oportunidade = { qtd: Number(op.n) || 0, valor: r2(op.v) }
    return out
}

module.exports = { handle, alcancado, TIPOS_META, RELATORIOS: R, avaliar, analitico }
