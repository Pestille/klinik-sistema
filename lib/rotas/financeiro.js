// lib/rotas/financeiro.js — Financeiro (Fase 6)
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
//
// O dinheiro da clínica está em várias tabelas por motivos históricos. Em vez de
// copiar dados, movimentos() lê todas e devolve uma lista única e normalizada —
// é ela que alimenta conta corrente, extrato, fluxo de caixa e DRE:
//   lancamentos            lançamentos manuais, comissões pagas, estornos
//   parcelas_orcamento     parcelas de tratamento pagas (baixa manual ou Asaas)
//   cobrancas              cobranças Asaas avulsas pagas (sem parcela vinculada)
//   financeiro, pagamentos recibos e pagamentos importados do Clinicorp
//   contas_pagar           contas pagas (saídas)
// Movimento sem conta bancária definida conta como "Caixa geral".

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var CLASSIFICACOES = ['Custo Fixo', 'Custo Variável', 'Investimento', 'Marketing', 'Impostos', 'Outros']
var FORMAS = ['Dinheiro', 'PIX', 'Cartão de crédito', 'Cartão de débito', 'Boleto', 'Transferência', 'Cheque', 'Convênio', 'Outros']
var TIPOS_CONTA = ['caixa', 'corrente', 'poupanca', 'digital']
var CATEGORIAS_PADRAO = [
    ['Aluguel', 'Custo Fixo', 'despesa'], ['Salários e Encargos', 'Custo Fixo', 'despesa'], ['Condomínio', 'Custo Fixo', 'despesa'], ['Internet e Telefone', 'Custo Fixo', 'despesa'],
    ['Contabilidade', 'Custo Fixo', 'despesa'], ['Seguros', 'Custo Fixo', 'despesa'], ['Limpeza e Manutenção', 'Custo Fixo', 'despesa'], ['Software e Sistemas', 'Custo Fixo', 'despesa'],
    ['Energia Elétrica', 'Custo Fixo', 'despesa'], ['Água', 'Custo Fixo', 'despesa'],
    ['Material Odontológico', 'Custo Variável', 'despesa'], ['Laboratório Protético', 'Custo Variável', 'despesa'], ['Comissão Profissionais', 'Custo Variável', 'despesa'],
    ['EPIs e Biossegurança', 'Custo Variável', 'despesa'], ['Taxas de cartão e boleto', 'Custo Variável', 'despesa'],
    ['Equipamentos', 'Investimento', 'despesa'], ['Reforma e Obras', 'Investimento', 'despesa'], ['Capacitação e Cursos', 'Investimento', 'despesa'],
    ['Google Ads', 'Marketing', 'despesa'], ['Instagram/Facebook Ads', 'Marketing', 'despesa'], ['Material Gráfico', 'Marketing', 'despesa'],
    ['ISS', 'Impostos', 'despesa'], ['Simples Nacional / DAS', 'Impostos', 'despesa'], ['INSS', 'Impostos', 'despesa'],
    ['Tratamento Particular', 'Receita', 'receita'], ['Convênio/Plano', 'Receita', 'receita'], ['Outras receitas', 'Receita', 'receita']
]

function num(v) { var n = typeof v === 'string' ? Number(v.replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0 }
function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function addMeses(ymd, n) {
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7) - 1 + n, d = +ymd.slice(8, 10)
    var ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    return new Date(Date.UTC(y, m, Math.min(d, ult))).toISOString().slice(0, 10)
}
function ultimoDia(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function normForma(f) {
    var s = String(f || '').toLowerCase()
    if (!s) return 'Não informada'
    if (/pix/.test(s)) return 'PIX'
    if (/d[ée]bito|debit/.test(s)) return 'Cartão de débito'
    if (/cr[ée]dito|credit|cart/.test(s)) return 'Cartão de crédito'
    if (/boleto|bank_slip/.test(s)) return 'Boleto'
    if (/dinheiro|esp[ée]cie|cash/.test(s)) return 'Dinheiro'
    if (/transf|ted|doc/.test(s)) return 'Transferência'
    if (/cheque/.test(s)) return 'Cheque'
    if (/conv[êe]nio|plano/.test(s)) return 'Convênio'
    return String(f).charAt(0).toUpperCase() + String(f).slice(1)
}

async function tentar(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args })).rows }
    catch (e) { if (/no such (table|column)/i.test(e.message || '')) return []; throw e }
}

async function caixaGeral(client, clinica_id) {
    var r = await client.execute({ sql: "SELECT id FROM contas_bancarias WHERE clinica_id=? AND tipo='caixa' AND ativo=1 ORDER BY id LIMIT 1", args: [clinica_id] })
    if (r.rows.length) return Number(r.rows[0].id)
    var ins = await client.execute({ sql: "INSERT INTO contas_bancarias(clinica_id,nome,tipo) VALUES(?,'Caixa geral','caixa')", args: [clinica_id] })
    return Number(ins.lastInsertRowid)
}

async function garantirCategorias(client) {
    var r = await client.execute("SELECT COUNT(*) n FROM categorias_financeiras WHERE clinica_id IS NULL")
    if (Number(r.rows[0].n)) return
    for (var i = 0; i < CATEGORIAS_PADRAO.length; i++) await client.execute({ sql: "INSERT INTO categorias_financeiras(clinica_id,nome,classificacao,tipo) VALUES(NULL,?,?,?)", args: CATEGORIAS_PADRAO[i] })
}

// Lista única do dinheiro que entrou e saiu (regime de caixa) entre de e ate.
async function movimentos(client, clinica_id, de, ate) {
    var out = [], A = [clinica_id, de, ate]
    function push(o) { o.valor = Math.round(Math.abs(Number(o.valor) || 0) * 100) / 100; if (o.valor) out.push(o) }

    // Lançamentos manuais/comissões/estornos (os que repetem parcela ou conta paga são ignorados)
    ;(await tentar(client, "SELECT * FROM lancamentos WHERE clinica_id=? AND substr(data,1,10) BETWEEN ? AND ? AND COALESCE(status,'realizado')='realizado' AND parcela_orcamento_id IS NULL AND conta_pagar_id IS NULL", A)).forEach(function (l) {
        var saida = /sa[ií]da|despesa|estorno/i.test(l.tipo || '') || Number(l.valor) < 0
        push({ id: 'lancamento:' + l.id, origem: 'lancamento', origem_id: l.id, data: String(l.data).slice(0, 10), hora: l.hora || '', tipo: saida ? 'saida' : 'entrada', forma: normForma(l.forma_pagamento),
            descricao: l.descricao || l.tipo, paciente_id: l.paciente_id, paciente_nome: l.paciente_nome, valor: l.valor, categoria: l.categoria, categoria_id: l.categoria_id, classificacao: l.classificacao,
            conta_id: l.conta_id, editavel: true, estorno: /estorno/i.test(l.tipo || '') || /estorno|devolu/i.test(l.descricao || '') })
    })
    // Parcelas de tratamento pagas
    ;(await tentar(client, "SELECT po.*, p.nome paciente_nome FROM parcelas_orcamento po LEFT JOIN pacientes p ON p.id=po.paciente_id AND p.clinica_id=po.clinica_id WHERE po.clinica_id=? AND po.status='pago' AND COALESCE(po.forma_pagamento,'')<>'credito_paciente' AND substr(po.data_pagamento,1,10) BETWEEN ? AND ?", A)).forEach(function (p) {
        push({ id: 'parcela:' + p.id, origem: 'parcela', origem_id: p.id, data: String(p.data_pagamento).slice(0, 10), hora: String(p.data_pagamento || '').slice(11, 16), tipo: 'entrada', forma: normForma(p.forma_pagamento || (p.cobranca_id ? 'Asaas' : '')),
            descricao: (p.tipo === 'entrada' ? 'Entrada' : 'Parcela ' + p.numero_parcela + '/' + p.total_parcelas) + ' · orçamento #' + p.orcamento_id, paciente_id: p.paciente_id, paciente_nome: p.paciente_nome, valor: p.valor,
            categoria: 'Tratamento Particular', classificacao: 'Receita', conta_id: p.conta_id })
    })
    // Cobranças Asaas avulsas pagas
    ;(await tentar(client, "SELECT c.* FROM cobrancas c WHERE c.clinica_id=? AND c.status IN ('pago','recebido','confirmado') AND COALESCE(c.tipo,'')<>'credito_paciente' AND substr(c.data_pagamento,1,10) BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM parcelas_orcamento po WHERE po.cobranca_id=c.id AND po.clinica_id=c.clinica_id)", A)).forEach(function (c) {
        push({ id: 'cobranca:' + c.id, origem: 'cobranca', origem_id: c.id, data: String(c.data_pagamento).slice(0, 10), hora: String(c.data_pagamento || '').slice(11, 16), tipo: 'entrada', forma: normForma(c.tipo),
            descricao: c.descricao || 'Cobrança Asaas', paciente_id: c.paciente_id, paciente_nome: c.paciente_nome, valor: c.valor, categoria: c.referencia === 'credito' ? 'Crédito do paciente' : (c.referencia === 'avulso' ? 'Atendimento avulso' : 'Tratamento Particular'), classificacao: 'Receita' })
    })
    // Recibos importados (financeiro) e lançamentos manuais antigos
    ;(await tentar(client, "SELECT f.*, p.nome paciente_nome FROM financeiro f LEFT JOIN pacientes p ON p.id=f.paciente_id AND p.clinica_id=f.clinica_id WHERE f.clinica_id=? AND substr(f.data_pagamento,1,10) BETWEEN ? AND ? AND COALESCE(f.status,'') NOT IN ('cancelado','cancelada')", A)).forEach(function (f) {
        var saida = /sa[ií]da/i.test(f.tipo || '') || Number(f.valor) < 0
        push({ id: 'financeiro:' + f.id, origem: 'financeiro', origem_id: f.id, data: String(f.data_pagamento).slice(0, 10), hora: '', tipo: saida ? 'saida' : 'entrada', forma: normForma(f.forma_pagamento),
            descricao: f.descricao || (saida ? 'Saída' : 'Recebimento'), paciente_id: f.paciente_id, paciente_nome: f.paciente_nome, valor: f.valor, classificacao: saida ? 'Outros' : 'Receita' })
    })
    // Pagamentos importados do Clinicorp
    ;(await tentar(client, "SELECT * FROM pagamentos WHERE clinica_id=? AND substr(data_pagamento,1,10) BETWEEN ? AND ? AND COALESCE(cancelado,0)=0", A)).forEach(function (g) {
        push({ id: 'pagamento:' + g.id, origem: 'pagamento', origem_id: g.id, data: String(g.data_pagamento).slice(0, 10), hora: '', tipo: 'entrada', forma: normForma(g.forma_pagamento),
            descricao: g.descricao || 'Pagamento' + (g.parcelas > 1 ? ' em ' + g.parcelas + 'x' : ''), paciente_id: g.paciente_id, paciente_nome: g.paciente_nome, valor: g.valor, classificacao: 'Receita' })
    })
    // Contas pagas
    ;(await tentar(client, "SELECT * FROM contas_pagar WHERE clinica_id=? AND status='paga' AND substr(pagamento,1,10) BETWEEN ? AND ?", A)).forEach(function (c) {
        push({ id: 'conta_pagar:' + c.id, origem: 'conta_pagar', origem_id: c.id, data: String(c.pagamento).slice(0, 10), hora: '', tipo: 'saida', forma: normForma(c.forma_pagamento),
            descricao: c.descricao + (c.fornecedor ? ' · ' + c.fornecedor : ''), valor: c.valor, categoria: c.categoria, categoria_id: c.categoria_id, classificacao: c.classificacao || 'Outros', conta_id: c.conta_id })
    })
    out.sort(function (a, b) { return (a.data + a.hora).localeCompare(b.data + b.hora) })
    return out
}

// Vendas (tratamentos aprovados) e cancelamentos de venda no período
async function vendas(client, clinica_id, de, ate) {
    var rows = await tentar(client, "SELECT o.id, o.status, o.valor_total, o.desconto, o.paciente_id, o.titulo, p.nome paciente_nome, substr(COALESCE(o.data_aprovacao,o.data_criacao),1,10) dt_aprov, substr(COALESCE(o.updated_at,o.data_aprovacao),1,10) dt_canc FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE o.clinica_id=? AND ((o.status='aprovado' AND substr(COALESCE(o.data_aprovacao,o.data_criacao),1,10) BETWEEN ? AND ?) OR (o.status='desaprovado' AND substr(COALESCE(o.updated_at,o.data_aprovacao),1,10) BETWEEN ? AND ?))", [clinica_id, de, ate, de, ate])
    return rows.map(function (o) {
        var canc = o.status === 'desaprovado'
        return { id: 'venda:' + o.id, origem: 'orcamento', origem_id: o.id, data: canc ? o.dt_canc : o.dt_aprov, hora: '', tipo: canc ? 'cancelamento' : 'venda', forma: '',
            descricao: (canc ? 'Cancelamento · ' : '') + (o.titulo || 'Orçamento #' + o.id), paciente_id: o.paciente_id, paciente_nome: o.paciente_nome,
            valor: Math.round(((Number(o.valor_total) || 0) - (Number(o.desconto) || 0)) * 100) / 100 }
    }).filter(function (v) { return v.valor > 0 })
}

function aplicarConta(lista, caixaId) { lista.forEach(function (m) { if (!m.conta_id) m.conta_id = caixaId }) ; return lista }

function periodo(q) {
    var h = hojeCG()
    var de = DATA_RE.test(q.de || '') ? q.de : h.slice(0, 8) + '01'
    var ate = DATA_RE.test(q.ate || '') ? q.ate : h
    if (ate < de) { var t = de; de = ate; ate = t }
    return { de: de, ate: ate }
}

async function fluxoMes(client, clinica_id, ano, mes) {
    var de = ano + '-' + String(mes).padStart(2, '0') + '-01', ate = ultimoDia(ano, mes), hoje = hojeCG()
    var mv = await movimentos(client, clinica_id, de, ate)
    var rec = await tentar(client, "SELECT substr(data_vencimento,1,10) dia, SUM(valor) total FROM parcelas_orcamento WHERE clinica_id=? AND status IN ('pendente','vencido') AND substr(data_vencimento,1,10) BETWEEN ? AND ? GROUP BY dia", [clinica_id, de, ate])
    var recC = await tentar(client, "SELECT substr(c.data_vencimento,1,10) dia, SUM(c.valor) total FROM cobrancas c WHERE c.clinica_id=? AND c.status IN ('pendente','vencido') AND substr(c.data_vencimento,1,10) BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM parcelas_orcamento po WHERE po.cobranca_id=c.id AND po.clinica_id=c.clinica_id) GROUP BY dia", [clinica_id, de, ate])
    var pag = await tentar(client, "SELECT substr(vencimento,1,10) dia, SUM(valor) total FROM contas_pagar WHERE clinica_id=? AND status IN ('aberta','vencida') AND substr(vencimento,1,10) BETWEEN ? AND ? GROUP BY dia", [clinica_id, de, ate])
    var mapa = {}
    function soma(rows, campo) { rows.forEach(function (r) { mapa[r.dia] = mapa[r.dia] || {}; mapa[r.dia][campo] = (mapa[r.dia][campo] || 0) + (Number(r.total) || 0) }) }
    soma(rec, 'a_receber'); soma(recC, 'a_receber'); soma(pag, 'a_pagar')
    var dias = [], ac = 0, T = { entradas: 0, saidas: 0, a_receber: 0, a_pagar: 0 }, porForma = {}, porCat = {}
    for (var d = de; d <= ate; d = addDias(d, 1)) {
        var doDia = mv.filter(function (m) { return m.data === d })
        var ent = 0, sai = 0
        doDia.forEach(function (m) {
            if (m.tipo === 'entrada') { ent += m.valor; porForma[m.forma] = (porForma[m.forma] || 0) + m.valor }
            else { sai += m.valor; var k = m.categoria || m.classificacao || 'Outros'; porCat[k] = (porCat[k] || 0) + m.valor }
        })
        var ar = (mapa[d] && mapa[d].a_receber) || 0, ap = (mapa[d] && mapa[d].a_pagar) || 0
        ac += ent - sai
        T.entradas += ent; T.saidas += sai; T.a_receber += ar; T.a_pagar += ap
        dias.push({ data: d, dia: +d.slice(8), entradas: r2(ent), saidas: r2(sai), a_receber: r2(ar), a_pagar: r2(ap), saldo: r2(ent - sai), acumulado: r2(ac), movimentos: doDia })
    }
    // Contas e parcelas vencidas antes do mês continuam pendentes: entram no previsto
    var atrRec = await tentar(client, "SELECT COALESCE(SUM(valor),0) t FROM parcelas_orcamento WHERE clinica_id=? AND status IN ('pendente','vencido') AND substr(data_vencimento,1,10)<?", [clinica_id, de])
    var atrPag = await tentar(client, "SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE clinica_id=? AND status IN ('aberta','vencida') AND substr(vencimento,1,10)<?", [clinica_id, de])
    var saldo = T.entradas - T.saidas
    return {
        mes: mes, ano: ano, de: de, ate: ate, hoje: hoje, dias: dias,
        totais: { entradas: r2(T.entradas), saidas: r2(T.saidas), saldo: r2(saldo), a_receber: r2(T.a_receber), a_pagar: r2(T.a_pagar), saldo_pendente: r2(T.a_receber - T.a_pagar), saldo_previsto: r2(saldo + T.a_receber - T.a_pagar),
            atrasado_receber: r2(atrRec.length ? Number(atrRec[0].t) : 0), atrasado_pagar: r2(atrPag.length ? Number(atrPag[0].t) : 0) },
        resumo_entradas: Object.keys(porForma).map(function (k) { return { nome: k, total: r2(porForma[k]) } }).sort(function (a, b) { return b.total - a.total }),
        resumo_saidas: Object.keys(porCat).map(function (k) { return { nome: k, total: r2(porCat[k]) } }).sort(function (a, b) { return b.total - a.total })
    }
}
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }

function statusConta(c, hoje) {
    if (c.status === 'paga') return 'paga'
    if (c.status === 'cancelada') return 'cancelada'
    return String(c.vencimento).slice(0, 10) < hoje ? 'vencida' : 'aberta'
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }
    var lixeira = require('../lixeira')

    // ── Contas bancárias ──────────────────────────────────────────
    if (route === 'fin-contas') {
        if (req.method === 'POST') {
            if (b.action === 'excluir') {
                var ex = await client.execute({ sql: "UPDATE contas_bancarias SET ativo=0 WHERE id=? AND clinica_id=? AND tipo<>'caixa'", args: [b.id, clinica_id] })
                return ex.rowsAffected ? json(200, { success: true }) : json(400, { success: false, error: 'O caixa geral não pode ser removido' })
            }
            var nome = txt(b.nome, 60)
            if (!nome) return json(400, { success: false, error: 'Informe o nome da conta' })
            var tipo = TIPOS_CONTA.indexOf(b.tipo) >= 0 ? b.tipo : 'corrente'
            var campos = [nome, tipo, txt(b.banco, 60), txt(b.agencia, 20), txt(b.conta, 30), num(b.saldo_inicial)]
            if (b.id) {
                var up = await client.execute({ sql: "UPDATE contas_bancarias SET nome=?,tipo=?,banco=?,agencia=?,conta=?,saldo_inicial=? WHERE id=? AND clinica_id=?", args: campos.concat([b.id, clinica_id]) })
                return up.rowsAffected ? json(200, { success: true, id: b.id }) : json(404, { success: false, error: 'Conta não encontrada' })
            }
            var ins = await client.execute({ sql: "INSERT INTO contas_bancarias(nome,tipo,banco,agencia,conta,saldo_inicial,clinica_id) VALUES(?,?,?,?,?,?,?)", args: campos.concat([clinica_id]) })
            return json(200, { success: true, id: Number(ins.lastInsertRowid) })
        }
        var cx = await caixaGeral(client, clinica_id)
        var contas = (await client.execute({ sql: "SELECT * FROM contas_bancarias WHERE clinica_id=? AND ativo=1 ORDER BY CASE tipo WHEN 'caixa' THEN 0 ELSE 1 END, nome", args: [clinica_id] })).rows
        if (q.saldos) {
            var tudo = aplicarConta(await movimentos(client, clinica_id, '1900-01-01', hojeCG()), cx)
            contas = contas.map(function (c) {
                var s = Number(c.saldo_inicial) || 0
                tudo.forEach(function (m) { if (Number(m.conta_id) === Number(c.id)) s += m.tipo === 'entrada' ? m.valor : -m.valor })
                return Object.assign({}, c, { saldo: r2(s) })
            })
        }
        return json(200, { success: true, data: contas, caixa_id: cx })
    }

    // ── Fornecedores ──────────────────────────────────────────────
    if (route === 'fin-fornecedores') {
        if (req.method === 'POST') {
            if (b.action === 'excluir') { await client.execute({ sql: "UPDATE fornecedores SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] }); return json(200, { success: true }) }
            var fn = txt(b.nome, 120)
            if (!fn) return json(400, { success: false, error: 'Informe o nome do fornecedor' })
            var fc = [fn, txt(b.documento, 20), txt(b.telefone, 20), txt(b.email, 120), txt(b.observacoes, 500)]
            if (b.id) {
                var fu = await client.execute({ sql: "UPDATE fornecedores SET nome=?,documento=?,telefone=?,email=?,observacoes=? WHERE id=? AND clinica_id=?", args: fc.concat([b.id, clinica_id]) })
                return fu.rowsAffected ? json(200, { success: true, id: b.id }) : json(404, { success: false, error: 'Fornecedor não encontrado' })
            }
            var fi = await client.execute({ sql: "INSERT INTO fornecedores(nome,documento,telefone,email,observacoes,clinica_id) VALUES(?,?,?,?,?,?)", args: fc.concat([clinica_id]) })
            return json(200, { success: true, id: Number(fi.lastInsertRowid) })
        }
        var fw = "clinica_id=? AND ativo=1", fa = [clinica_id]
        if (q.q) { fw += " AND (nome LIKE ? OR documento LIKE ?)"; fa.push('%' + q.q + '%', '%' + q.q + '%') }
        return json(200, { success: true, data: (await client.execute({ sql: "SELECT * FROM fornecedores WHERE " + fw + " ORDER BY nome LIMIT 500", args: fa })).rows })
    }

    // ── Categorias (plano de contas simplificado) ─────────────────
    if (route === 'fin-categorias') {
        await garantirCategorias(client)
        if (req.method === 'POST') {
            var cn = txt(b.nome, 80)
            if (!cn) return json(400, { success: false, error: 'Informe o nome da categoria' })
            var cl = CLASSIFICACOES.concat(['Receita']).indexOf(b.classificacao) >= 0 ? b.classificacao : 'Outros'
            var ci = await client.execute({ sql: "INSERT INTO categorias_financeiras(clinica_id,nome,classificacao,tipo) VALUES(?,?,?,?)", args: [clinica_id, cn, cl, cl === 'Receita' ? 'receita' : 'despesa'] })
            return json(200, { success: true, id: Number(ci.lastInsertRowid) })
        }
        var cats = (await client.execute({ sql: "SELECT id,nome,classificacao,tipo,clinica_id FROM categorias_financeiras WHERE (clinica_id IS NULL OR clinica_id=?) AND ativo=1 ORDER BY classificacao, nome", args: [clinica_id] })).rows
        return json(200, { success: true, data: cats, classificacoes: CLASSIFICACOES, formas: FORMAS })
    }

    // ── Conta corrente / extrato ──────────────────────────────────
    if (route === 'fin-movimentos') {
        var p = periodo(q), cxm = await caixaGeral(client, clinica_id)
        var mv = aplicarConta(await movimentos(client, clinica_id, p.de, p.ate), cxm)
        var vd = await vendas(client, clinica_id, p.de, p.ate)
        var kpis = { vendas: 0, cancelamentos: 0, entradas: 0, saidas: 0 }
        vd.forEach(function (v) { kpis[v.tipo === 'venda' ? 'vendas' : 'cancelamentos'] += v.valor })
        mv.forEach(function (m) { kpis[m.tipo === 'entrada' ? 'entradas' : 'saidas'] += m.valor })
        Object.keys(kpis).forEach(function (k) { kpis[k] = r2(kpis[k]) })
        var lista = mv.concat(vd)
        var tf = q.tipo || 'todos'
        if (tf === 'vendas') lista = vd.filter(function (v) { return v.tipo === 'venda' })
        else if (tf === 'cancelamentos') lista = vd.filter(function (v) { return v.tipo === 'cancelamento' })
        else if (tf === 'entradas') lista = mv.filter(function (m) { return m.tipo === 'entrada' })
        else if (tf === 'saidas') lista = mv.filter(function (m) { return m.tipo === 'saida' })
        if (q.conta_id) lista = lista.filter(function (m) { return Number(m.conta_id) === Number(q.conta_id) })
        if (q.q) { var s = String(q.q).toLowerCase(); lista = lista.filter(function (m) { return [m.descricao, m.paciente_nome, m.forma, m.categoria].join(' ').toLowerCase().indexOf(s) >= 0 }) }
        lista.sort(function (a, c) { return (c.data + c.hora).localeCompare(a.data + a.hora) })
        var resp = { success: true, de: p.de, ate: p.ate, kpis: kpis, transacoes: lista.length, movimentos: lista }
        // Extrato: saldo inicial (antes do período) por conta
        if (q.extrato) {
            var antes = aplicarConta(await movimentos(client, clinica_id, '1900-01-01', addDias(p.de, -1)), cxm)
            var cb = (await client.execute({ sql: "SELECT id, saldo_inicial FROM contas_bancarias WHERE clinica_id=? AND ativo=1", args: [clinica_id] })).rows
            var ini = 0
            cb.forEach(function (c) { if (!q.conta_id || Number(q.conta_id) === Number(c.id)) ini += Number(c.saldo_inicial) || 0 })
            antes.forEach(function (m) { if (!q.conta_id || Number(m.conta_id) === Number(q.conta_id)) ini += m.tipo === 'entrada' ? m.valor : -m.valor })
            resp.saldo_inicial = r2(ini)
        }
        return json(200, resp)
    }

    // ── Lançamento manual ─────────────────────────────────────────
    if (route === 'fin-lancamento') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (b.action === 'excluir') {
            var ok = await lixeira.moverParaLixeira(client, auth, 'lancamento', parseInt(b.id, 10) || 0)
            return ok ? json(200, { success: true }) : json(404, { success: false, error: 'Lançamento não encontrado' })
        }
        var tipoL = b.tipo === 'saida' ? 'Saída' : b.tipo === 'entrada' ? 'Entrada' : null
        if (!tipoL) return json(400, { success: false, error: 'Escolha se é entrada ou saída' })
        if (!DATA_RE.test(b.data || '')) return json(400, { success: false, error: 'Informe a data' })
        var valor = num(b.valor)
        if (valor <= 0) return json(400, { success: false, error: 'Informe um valor maior que zero' })
        var desc = txt(b.descricao, 140)
        if (!desc) return json(400, { success: false, error: 'Informe a descrição' })
        var conta = parseInt(b.conta_id, 10) || await caixaGeral(client, clinica_id)
        if (!(await client.execute({ sql: "SELECT 1 FROM contas_bancarias WHERE id=? AND clinica_id=?", args: [conta, clinica_id] })).rows.length) return json(400, { success: false, error: 'Conta inválida' })
        var cat = null
        if (b.categoria_id) {
            cat = (await client.execute({ sql: "SELECT * FROM categorias_financeiras WHERE id=? AND (clinica_id IS NULL OR clinica_id=?)", args: [b.categoria_id, clinica_id] })).rows[0]
            if (!cat) return json(400, { success: false, error: 'Categoria inválida' })
        }
        var pac = null
        if (b.paciente_id) {
            pac = (await client.execute({ sql: "SELECT id,nome FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })).rows[0]
            if (!pac) return json(404, { success: false, error: 'Paciente não encontrado' })
        }
        var dados = [b.data, /^\d{2}:\d{2}$/.test(b.hora || '') ? b.hora : null, tipoL, txt(b.forma_pagamento, 40) || null, desc, pac ? pac.id : null, pac ? pac.nome : null, valor,
            cat ? cat.classificacao : (tipoL === 'Entrada' ? 'Receita' : 'Outros'), cat ? cat.nome : null, cat ? cat.id : null, conta]
        if (b.id) {
            var lu = await client.execute({ sql: "UPDATE lancamentos SET data=?,hora=?,tipo=?,forma_pagamento=?,descricao=?,paciente_id=?,paciente_nome=?,valor=?,classificacao=?,categoria=?,categoria_id=?,conta_id=? WHERE id=? AND clinica_id=? AND parcela_orcamento_id IS NULL AND conta_pagar_id IS NULL", args: dados.concat([b.id, clinica_id]) })
            return lu.rowsAffected ? json(200, { success: true, id: b.id }) : json(404, { success: false, error: 'Lançamento não encontrado' })
        }
        var li = await client.execute({ sql: "INSERT INTO lancamentos(data,hora,tipo,forma_pagamento,descricao,paciente_id,paciente_nome,valor,classificacao,categoria,categoria_id,conta_id,clinica_id,status,criado_por_nome) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'realizado',?)", args: dados.concat([clinica_id, auth.nome || null]) })
        return json(200, { success: true, id: Number(li.lastInsertRowid) })
    }

    // ── Fluxo de caixa ────────────────────────────────────────────
    if (route === 'fin-fluxo' || route === 'fluxo-caixa-real') {
        var h = hojeCG()
        var mes = Math.min(Math.max(parseInt(q.mes, 10) || +h.slice(5, 7), 1), 12), ano = parseInt(q.ano, 10) || +h.slice(0, 4)
        var fx = await fluxoMes(client, clinica_id, ano, mes)
        if (route === 'fluxo-caixa-real') fx.por_dia = fx.dias.map(function (d) { var o = Object.assign({}, d); delete o.movimentos; return o })
        return json(200, Object.assign({ success: true }, fx))
    }

    // ── DRE (regime de caixa, a partir dos movimentos) ────────────
    if (route === 'dre') {
        var dAno = parseInt(q.ano, 10) || +hojeCG().slice(0, 4)
        var mi = Math.min(Math.max(parseInt(q.mes_inicio, 10) || 1, 1), 12), mf = Math.min(Math.max(parseInt(q.mes_fim, 10) || 12, mi), 12)
        var todos = await movimentos(client, clinica_id, dAno + '-' + String(mi).padStart(2, '0') + '-01', ultimoDia(dAno, mf))
        var meses = []
        for (var m = mi; m <= mf; m++) {
            var pre = dAno + '-' + String(m).padStart(2, '0')
            var L = { mes: m, mes_str: pre, receita_bruta: 0, impostos: 0, custos_fixos: 0, custos_variaveis: 0, marketing: 0, investimentos: 0, outras_despesas: 0 }
            todos.forEach(function (x) {
                if (x.data.slice(0, 7) !== pre) return
                if (x.tipo === 'entrada') { L.receita_bruta += x.valor; return }
                var c = x.classificacao
                if (c === 'Impostos') L.impostos += x.valor
                else if (c === 'Custo Fixo') L.custos_fixos += x.valor
                else if (c === 'Custo Variável') L.custos_variaveis += x.valor
                else if (c === 'Marketing') L.marketing += x.valor
                else if (c === 'Investimento') L.investimentos += x.valor
                else L.outras_despesas += x.valor
            })
            L.receita_liquida = L.receita_bruta - L.impostos
            L.resultado_operacional = L.receita_liquida - L.custos_fixos - L.custos_variaveis - L.marketing - L.outras_despesas
            L.resultado_final = L.resultado_operacional - L.investimentos
            Object.keys(L).forEach(function (k) { if (typeof L[k] === 'number' && k !== 'mes') L[k] = r2(L[k]) })
            meses.push(L)
        }
        var anual = {}
        ;['receita_bruta', 'impostos', 'receita_liquida', 'custos_fixos', 'custos_variaveis', 'marketing', 'outras_despesas', 'resultado_operacional', 'investimentos', 'resultado_final'].forEach(function (k) {
            anual[k] = r2(meses.reduce(function (s, x) { return s + x[k] }, 0))
        })
        return json(200, { success: true, ano: dAno, meses: meses, anual: anual })
    }

    // ── Contas a pagar ────────────────────────────────────────────
    if (route === 'fin-pagar') {
        var hojeP = hojeCG()
        if (req.method === 'POST') {
            if (b.action === 'excluir') {
                var cr = (await client.execute({ sql: "SELECT status FROM contas_pagar WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })).rows[0]
                if (!cr) return json(404, { success: false, error: 'Conta não encontrada' })
                if (cr.status === 'paga') return json(400, { success: false, error: 'Estorne o pagamento antes de excluir' })
                await lixeira.moverParaLixeira(client, auth, 'conta_pagar', parseInt(b.id, 10))
                return json(200, { success: true })
            }
            var dsc = txt(b.descricao, 140), vlr = num(b.valor)
            if (!dsc) return json(400, { success: false, error: 'Informe a descrição' })
            if (vlr <= 0) return json(400, { success: false, error: 'Informe um valor maior que zero' })
            if (!DATA_RE.test(b.vencimento || '')) return json(400, { success: false, error: 'Informe o vencimento' })
            var catP = null
            if (b.categoria_id) {
                catP = (await client.execute({ sql: "SELECT * FROM categorias_financeiras WHERE id=? AND (clinica_id IS NULL OR clinica_id=?)", args: [b.categoria_id, clinica_id] })).rows[0]
                if (!catP) return json(400, { success: false, error: 'Categoria inválida' })
            }
            var forn = null
            if (b.fornecedor_id) {
                forn = (await client.execute({ sql: "SELECT id,nome FROM fornecedores WHERE id=? AND clinica_id=?", args: [b.fornecedor_id, clinica_id] })).rows[0]
                if (!forn) return json(400, { success: false, error: 'Fornecedor inválido' })
            }
            if (b.conta_id && !(await client.execute({ sql: "SELECT 1 FROM contas_bancarias WHERE id=? AND clinica_id=?", args: [b.conta_id, clinica_id] })).rows.length) return json(400, { success: false, error: 'Conta inválida' })
            var classif = CLASSIFICACOES.indexOf(b.classificacao) >= 0 ? b.classificacao : (catP && CLASSIFICACOES.indexOf(catP.classificacao) >= 0 ? catP.classificacao : 'Outros')
            var comp = /^\d{4}-\d{2}$/.test(b.competencia || '') ? b.competencia : b.vencimento.slice(0, 7)
            var base = { fornecedor: forn ? forn.nome : txt(b.fornecedor, 120), fornecedor_id: forn ? forn.id : null, classificacao: classif, categoria: catP ? catP.nome : null, categoria_id: catP ? catP.id : null,
                conta_id: parseInt(b.conta_id, 10) || null, forma_pagamento: txt(b.forma_pagamento, 40) || null, observacoes: txt(b.observacoes, 1000) || null }
            if (b.id) {
                var atual = (await client.execute({ sql: "SELECT status FROM contas_pagar WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })).rows[0]
                if (!atual) return json(404, { success: false, error: 'Conta não encontrada' })
                if (atual.status === 'paga') return json(400, { success: false, error: 'Conta já paga: estorne para editar' })
                await client.execute({ sql: "UPDATE contas_pagar SET descricao=?,valor=?,vencimento=?,competencia=?,fornecedor=?,fornecedor_id=?,classificacao=?,categoria=?,categoria_id=?,conta_id=?,forma_pagamento=?,observacoes=? WHERE id=? AND clinica_id=?",
                    args: [dsc, vlr, b.vencimento, comp, base.fornecedor, base.fornecedor_id, base.classificacao, base.categoria, base.categoria_id, base.conta_id, base.forma_pagamento, base.observacoes, b.id, clinica_id] })
                return json(200, { success: true, id: b.id })
            }
            // Parcelado: divide o valor; recorrente: repete o valor (vezes=0 → o cron gera mês a mês)
            var parcelas = Math.min(Math.max(parseInt(b.parcelas, 10) || 1, 1), 60)
            var recorrente = !!b.recorrente && parcelas === 1, freq = ['mensal', 'semanal', 'quinzenal'].indexOf(b.frequencia) >= 0 ? b.frequencia : 'mensal'
            var vezes = recorrente ? Math.min(Math.max(parseInt(b.vezes, 10) || 0, 0), 60) : parcelas
            var gerar = recorrente ? (vezes || 1) : parcelas
            var ids = [], resto = r2(vlr - r2(vlr / parcelas) * parcelas)
            for (var i = 0; i < gerar; i++) {
                var venc = freq === 'semanal' && recorrente ? addDias(b.vencimento, 7 * i) : freq === 'quinzenal' && recorrente ? addDias(b.vencimento, 15 * i) : addMeses(b.vencimento, i)
                var v = parcelas > 1 ? r2(vlr / parcelas) + (i === 0 ? resto : 0) : vlr
                var d2 = parcelas > 1 ? dsc + ' (' + (i + 1) + '/' + parcelas + ')' : dsc
                var ci2 = await client.execute({
                    sql: "INSERT INTO contas_pagar(clinica_id,descricao,valor,vencimento,competencia,fornecedor,fornecedor_id,classificacao,categoria,categoria_id,conta_id,forma_pagamento,observacoes,recorrente,frequencia,total_parcelas,parcela_atual,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'aberta')",
                    args: [clinica_id, d2, r2(v), venc, i === 0 ? comp : venc.slice(0, 7), base.fornecedor, base.fornecedor_id, base.classificacao, base.categoria, base.categoria_id, base.conta_id, base.forma_pagamento, base.observacoes, recorrente ? 1 : 0, recorrente ? freq : null, recorrente ? vezes : parcelas, i + 1]
                })
                ids.push(Number(ci2.lastInsertRowid))
            }
            return json(200, { success: true, id: ids[0], ids: ids })
        }
        var pp = periodo({ de: q.de || hojeP.slice(0, 8) + '01', ate: q.ate || ultimoDia(+hojeP.slice(0, 4), +hojeP.slice(5, 7)) })
        var w = ["clinica_id=?", "status<>'cancelada'", "substr(vencimento,1,10) BETWEEN ? AND ?"], a = [clinica_id, pp.de, pp.ate]
        if (q.mostrar === 'a_pagar') w.push("status<>'paga'")
        else if (q.mostrar === 'pagas') w.push("status='paga'")
        if (q.fornecedor_id) { w.push("fornecedor_id=?"); a.push(q.fornecedor_id) }
        if (q.q) { w.push("(descricao LIKE ? OR fornecedor LIKE ? OR categoria LIKE ?)"); a.push('%' + q.q + '%', '%' + q.q + '%', '%' + q.q + '%') }
        var lst = (await client.execute({ sql: "SELECT * FROM contas_pagar WHERE " + w.join(' AND ') + " ORDER BY vencimento, id LIMIT 2000", args: a })).rows.map(function (c) { return Object.assign({}, c, { situacao: statusConta(c, hojeP) }) })
        var tot = { 'Custo Fixo': 0, 'Custo Variável': 0, 'Investimento': 0, 'Outros': 0 }, total = 0, aPagar = 0, vencidas = 0
        lst.forEach(function (c) {
            var k = tot[c.classificacao] !== undefined ? c.classificacao : 'Outros'
            tot[k] += Number(c.valor) || 0; total += Number(c.valor) || 0
            if (c.situacao !== 'paga') aPagar += Number(c.valor) || 0
            if (c.situacao === 'vencida') vencidas += Number(c.valor) || 0
        })
        Object.keys(tot).forEach(function (k) { tot[k] = r2(tot[k]) })
        return json(200, { success: true, de: pp.de, ate: pp.ate, contas: lst, totais: tot, total: r2(total), a_pagar: r2(aPagar), vencidas: r2(vencidas) })
    }

    if (route === 'fin-pagar-baixa') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var dt = DATA_RE.test(b.data || '') ? b.data : hojeCG()
        var cid = parseInt(b.conta_id, 10) || await caixaGeral(client, clinica_id)
        if (!(await client.execute({ sql: "SELECT 1 FROM contas_bancarias WHERE id=? AND clinica_id=?", args: [cid, clinica_id] })).rows.length) return json(400, { success: false, error: 'Conta inválida' })
        var setV = b.valor != null && num(b.valor) > 0 ? ', valor=' + num(b.valor) : ''
        var bx = await client.execute({ sql: "UPDATE contas_pagar SET status='paga', pagamento=?, conta_id=?, forma_pagamento=COALESCE(?,forma_pagamento)" + setV + " WHERE id=? AND clinica_id=? AND status<>'paga'", args: [dt, cid, txt(b.forma_pagamento, 40) || null, b.id, clinica_id] })
        return bx.rowsAffected ? json(200, { success: true }) : json(400, { success: false, error: 'Conta não encontrada ou já paga' })
    }

    if (route === 'fin-pagar-estornar') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var es = await client.execute({ sql: "UPDATE contas_pagar SET status='aberta', pagamento=NULL WHERE id=? AND clinica_id=? AND status='paga'", args: [b.id, clinica_id] })
        return es.rowsAffected ? json(200, { success: true }) : json(400, { success: false, error: 'Conta não encontrada ou não está paga' })
    }

    // ── Contas a receber (parcelas de tratamento + cobranças avulsas) ─
    if (route === 'fin-receber') {
        var hr = hojeCG(), pr = periodo({ de: q.de || hr.slice(0, 8) + '01', ate: q.ate || ultimoDia(+hr.slice(0, 4), +hr.slice(5, 7)) })
        var itens = []
        ;(await tentar(client, "SELECT po.*, p.nome paciente_nome FROM parcelas_orcamento po LEFT JOIN pacientes p ON p.id=po.paciente_id AND p.clinica_id=po.clinica_id WHERE po.clinica_id=? AND po.status IN ('pendente','vencido','pago') AND substr(po.data_vencimento,1,10) BETWEEN ? AND ?", [clinica_id, pr.de, pr.ate])).forEach(function (p) {
            itens.push({ origem: 'parcela', id: p.id, vencimento: String(p.data_vencimento).slice(0, 10), pagamento: p.data_pagamento ? String(p.data_pagamento).slice(0, 10) : null, paciente_id: p.paciente_id, paciente_nome: p.paciente_nome,
                descricao: (p.tipo === 'entrada' ? 'Entrada' : 'Parcela ' + p.numero_parcela + '/' + p.total_parcelas) + ' · orçamento #' + p.orcamento_id, forma: normForma(p.forma_pagamento), valor: r2(p.valor), cobranca_id: p.cobranca_id, status: p.status })
        })
        ;(await tentar(client, "SELECT c.* FROM cobrancas c WHERE c.clinica_id=? AND c.status IN ('pendente','vencido','pago','recebido','confirmado') AND substr(c.data_vencimento,1,10) BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM parcelas_orcamento po WHERE po.cobranca_id=c.id AND po.clinica_id=c.clinica_id)", [clinica_id, pr.de, pr.ate])).forEach(function (c) {
            itens.push({ origem: c.referencia === 'avulso' ? 'avulso' : 'cobranca', id: c.id, vencimento: String(c.data_vencimento).slice(0, 10), pagamento: c.data_pagamento ? String(c.data_pagamento).slice(0, 10) : null, paciente_id: c.paciente_id, paciente_nome: c.paciente_nome,
                descricao: c.descricao || 'Cobrança Asaas', forma: normForma(c.tipo), valor: r2(c.valor), status: /pago|recebido|confirmado/.test(c.status) ? 'pago' : c.status })
        })
        itens.forEach(function (i) { i.situacao = i.status === 'pago' ? 'pago' : (i.vencimento < hr ? 'vencido' : 'a_vencer') })
        if (q.situacao && q.situacao !== 'todos') itens = itens.filter(function (i) { return i.situacao === q.situacao })
        if (q.q) { var sr = String(q.q).toLowerCase(); itens = itens.filter(function (i) { return [i.paciente_nome, i.descricao].join(' ').toLowerCase().indexOf(sr) >= 0 }) }
        itens.sort(function (x, y) { return x.vencimento.localeCompare(y.vencimento) })
        var tr = { vencido: 0, a_vencer: 0, pago: 0 }
        itens.forEach(function (i) { tr[i.situacao] += i.valor })
        Object.keys(tr).forEach(function (k) { tr[k] = r2(tr[k]) })
        return json(200, { success: true, de: pr.de, ate: pr.ate, itens: itens, totais: tr })
    }

    return false
}

module.exports = { handle, movimentos, normForma }
