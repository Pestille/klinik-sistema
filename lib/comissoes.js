// lib/comissoes.js — Cálculo e geração de comissões
// Klinov — Campo Grande, MS
//
// Ordem das regras:
//   1. Valor fixo por procedimento (comissoes_procedimento), pago na execução.
//      Valor zero é uma decisão registrada: aquele procedimento não gera comissão.
//   2. Regra geral do profissional (comissoes_config), por tabela de preço.
// Só vale a regra dentro da validade na data de referência.
//
// Momentos: aprovação do orçamento, execução do procedimento, check out do
// paciente (agendamento marcado como Atendido) e recebimento.
// Como no Clinicorp, a regra percentual tem Comissão Geral e Comissão Plano
// (procedimento de tabela de convênio) e pode ter percentuais próprios por
// especialidade (comissoes_especialidade), que substituem os da regra.
// No recebimento, o valor pago na parcela é dividido entre os procedimentos do
// orçamento na proporção do valor de cada um (o desconto do orçamento já está
// no valor das parcelas). Regra com "requer aprovação" gera o lançamento como
// 'aguardando'; só depois de aprovado ele fica 'pendente' e pode ser pago.

function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
function normNome(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim() }
function dia(s) { return String(s || '').slice(0, 10) }

function vigente(regra, data) {
    var d = dia(data), de = dia(regra.valido_desde), ate = dia(regra.valido_ate)
    return (!de || de <= d) && (!ate || ate >= d)
}

// A tabela do orçamento vence "TODAS"; entre iguais, vale a de início mais recente
function escolherRegra(regras, tabela, data) {
    var t = normNome(tabela)
    var validas = (regras || []).filter(function (r) { return vigente(r, data) })
    var pontos = function (r) { return normNome(r.tabela_preco) === t ? 1 : 0 }
    var aceitas = validas.filter(function (r) { return pontos(r) === 1 || normNome(r.tabela_preco) === 'TODAS' })
    aceitas.sort(function (a, b) { return pontos(b) - pontos(a) || dia(b.valido_desde).localeCompare(dia(a.valido_desde)) || (Number(b.id) || 0) - (Number(a.id) || 0) })
    return aceitas[0] || null
}

// No convênio a base é o valor do plano; sem plano, o valor do procedimento
function baseDoItem(item) {
    var qtd = Number(item.quantidade) || 1, plano = Number(item.valor_plano) || 0
    return r2((plano > 0 ? plano : Number(item.valor_unitario) || 0) * qtd)
}

// Percentual da regra para o item: especialidade > Comissão Plano > Comissão Geral
// ctx = { plano: bool, especialidade: {geral_pct, plano_pct} | null }
function percentualDe(regra, ctx) {
    ctx = ctx || {}
    var num = function (v) { return v === null || v === undefined || v === '' ? null : Number(v) }
    var esp = ctx.especialidade
    if (esp) {
        var ep = num(esp.plano_pct), eg = num(esp.geral_pct)
        if (ctx.plano && ep !== null) return ep
        if (eg !== null) return eg
    }
    var pp = num(regra.percentual_plano)
    if (ctx.plano && pp !== null) return pp
    return Number(regra.valor) || 0
}

// Descobre se o orçamento é de convênio e a especialidade do procedimento
async function contextoItem(client, clinica_id, regra, tabela, item) {
    var t = normNome(tabela), ctx = { plano: false, especialidade: null }
    var tabs = await linhas(client, "SELECT nome, tipo FROM precos_tabelas WHERE clinica_id=?", [clinica_id])
    var achada = tabs.filter(function (x) { return normNome(x.nome) === t })[0]
    ctx.plano = achada ? achada.tipo === 'convenio' : Number(item.valor_plano) > 0
    if (!regra || !regra.id) return ctx
    var esps = await linhas(client, "SELECT * FROM comissoes_especialidade WHERE clinica_id=? AND config_id=?", [clinica_id, regra.id])
    if (!esps.length) return ctx
    var nome = normNome(item.procedimento_nome)
    var procs = await linhas(client, "SELECT procedimento, tabela, especialidade FROM tabela_precos WHERE clinica_id=? AND COALESCE(especialidade,'')<>''", [clinica_id])
    var doProc = procs.filter(function (x) { return normNome(x.procedimento) === nome })
    var pr = doProc.filter(function (x) { return normNome(x.tabela) === t })[0] || doProc[0]
    if (!pr) return ctx
    var e = normNome(pr.especialidade)
    ctx.especialidade = esps.filter(function (x) { return normNome(x.especialidade) === e })[0] || null
    return ctx
}

function calcular(regra, item, ctx) {
    var base = baseDoItem(item)
    if (regra.tipo === 'percentual') { var pc = percentualDe(regra, ctx); return { valor_base: base, percentual: pc, valor_comissao: r2(base * pc / 100), tipo: 'percentual' } }
    return { valor_base: base, percentual: null, valor_comissao: r2(regra.valor), tipo: regra.tipo || 'fixo' }
}

async function linhas(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args })).rows }
    catch (e) { if (/no such table/i.test(e.message || '')) return []; throw e }
}

// o = { clinica_id, momento, data, item, profissional_id, profissional_nome, orcamento_id, paciente_id, paciente_nome, tabela }
// Devolve o valor gerado, ou null quando nenhuma regra se aplica.
async function gerarComissao(client, o) {
    var porProc = await linhas(client, "SELECT * FROM comissoes_procedimento WHERE clinica_id=? AND profissional_id=?", [o.clinica_id, o.profissional_id])
    var nome = normNome(o.item.procedimento_nome)
    var fixa = escolherRegra(porProc.filter(function (r) { return normNome(r.procedimento_nome) === nome }), o.tabela, o.data)
    var calc = null, regra = null
    if (o.momento === 'checkout') {
        var jaCo = await linhas(client, "SELECT 1 FROM comissoes_lancamentos WHERE clinica_id=? AND orcamento_item_id=? AND momento='checkout' AND COALESCE(status,'')<>'cancelado' LIMIT 1", [o.clinica_id, o.item.id])
        if (jaCo.length) return null
    }
    if (fixa) {
        if (o.momento !== 'execucao') return null
        var qtd = Number(o.item.quantidade) || 1
        calc = { valor_base: baseDoItem(o.item), percentual: null, valor_comissao: r2(Number(fixa.valor) * qtd), tipo: 'fixo_procedimento' }
    } else {
        var gerais = await linhas(client, "SELECT * FROM comissoes_config WHERE clinica_id=? AND profissional_id=? AND momento=?", [o.clinica_id, o.profissional_id, o.momento])
        regra = escolherRegra(gerais, o.tabela, o.data)
        if (!regra) return null
        calc = calcular(regra, o.item, await contextoItem(client, o.clinica_id, regra, o.tabela, o.item))
    }
    if (!(calc.valor_comissao > 0)) return null
    await inserir(client, o, calc, regra && Number(regra.requer_aprovacao) ? 'aguardando' : 'pendente', null)
    return calc.valor_comissao
}

// Check out do paciente: procedimentos executados no dia pelo profissional do
// atendimento. Vale nas duas ordens (executa e depois marca Atendido, ou o contrário).
async function comissaoCheckout(client, clinica_id, paciente_id, profissional_id, data) {
    var d = dia(data)
    if (!paciente_id || !profissional_id || !d) return []
    var regras = await linhas(client, "SELECT 1 FROM comissoes_config WHERE clinica_id=? AND profissional_id=? AND momento='checkout' LIMIT 1", [clinica_id, profissional_id])
    if (!regras.length) return []
    var itens = await linhas(client, "SELECT oi.*, o.tabela_preco, o.paciente_id pac_id, p.nome paciente_nome FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE oi.clinica_id=? AND o.paciente_id=? AND COALESCE(oi.executado,0)=1 AND substr(oi.data_execucao,1,10)=? AND oi.profissional_id=?", [clinica_id, paciente_id, d, profissional_id])
    var prof = (await linhas(client, "SELECT nome FROM profissionais WHERE id=? AND clinica_id=?", [profissional_id, clinica_id]))[0] || {}
    var gerados = []
    for (var i = 0; i < itens.length; i++) {
        var it = itens[i]
        var v = await gerarComissao(client, { clinica_id: clinica_id, momento: 'checkout', data: d, item: it, profissional_id: profissional_id, profissional_nome: prof.nome || it.profissional_nome || '', orcamento_id: it.orcamento_id, paciente_id: it.pac_id, paciente_nome: it.paciente_nome, tabela: it.tabela_preco || 'PARTICULAR' })
        if (v) gerados.push(v)
    }
    return gerados
}

async function comissaoCheckoutSegura(client, clinica_id, paciente_id, profissional_id, data) {
    try { return await comissaoCheckout(client, clinica_id, paciente_id, profissional_id, data) }
    catch (e) { console.error('[comissoes] checkout paciente ' + paciente_id + ': ' + e.message); return [] }
}

async function inserir(client, o, calc, status, parcela_id) {
    await client.execute({
        sql: "INSERT INTO comissoes_lancamentos(clinica_id, profissional_id, profissional_nome, orcamento_id, orcamento_item_id, paciente_id, paciente_nome, procedimento_nome, tabela_preco, momento, tipo, valor_base, percentual, valor_comissao, data_referencia, status, parcela_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [o.clinica_id, o.profissional_id, o.profissional_nome || '', o.orcamento_id, o.item.id, o.paciente_id || null, o.paciente_nome || '', o.item.procedimento_nome || '', o.tabela, o.momento, calc.tipo, calc.valor_base, calc.percentual, calc.valor_comissao, dia(o.data), status, parcela_id]
    })
}

// Parte de cada procedimento num valor recebido, proporcional ao valor do item.
// O último item leva o resto do arredondamento, para a soma bater com o pago.
function dividir(itens, valor) {
    var bases = itens.map(baseDoItem), total = bases.reduce(function (a, b) { return a + b }, 0)
    if (!(total > 0)) return itens.map(function () { return 0 })
    var usado = 0
    return bases.map(function (b, i) {
        if (i === bases.length - 1) return r2(valor - usado)
        var v = r2(valor * b / total); usado = r2(usado + v); return v
    })
}

// Valor sobre o qual a regra incide no recebimento
function baseRecebida(regra, parte, taxaParte) {
    var v = parte
    if (Number(regra.descontar_taxas)) v -= taxaParte
    var imp = Number(regra.imposto_pct) || 0
    if (imp > 0) v = v * (1 - imp / 100)
    return r2(Math.max(0, v))
}

// Gera as comissões de uma parcela de orçamento que acabou de ser paga.
// Pode ser chamada mais de uma vez: não repete o lançamento da mesma parcela.
// Devolve a lista de valores gerados.
async function comissaoRecebimento(client, clinica_id, parcela_id, data) {
    var p = (await linhas(client, "SELECT po.*, o.tabela_preco, pc.nome paciente_nome FROM parcelas_orcamento po JOIN orcamentos o ON o.id=po.orcamento_id AND o.clinica_id=po.clinica_id LEFT JOIN pacientes pc ON pc.id=po.paciente_id AND pc.clinica_id=po.clinica_id WHERE po.id=? AND po.clinica_id=?", [parcela_id, clinica_id]))[0]
    if (!p || p.status !== 'pago') return []
    var ja = await linhas(client, "SELECT 1 FROM comissoes_lancamentos WHERE clinica_id=? AND parcela_id=? AND momento='recebimento' LIMIT 1", [clinica_id, p.id])
    if (ja.length) return []
    var itens = await linhas(client, "SELECT * FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=? ORDER BY id", [p.orcamento_id, clinica_id])
    if (!itens.length) return []
    var pago = Number(p.valor_pago) > 0 ? Number(p.valor_pago) : Number(p.valor) || 0
    if (!(pago > 0)) return []
    var taxa = 0
    var recs = await linhas(client, "SELECT tipo, cartao_tipo, valor, taxa, vencimento FROM recebiveis WHERE clinica_id=? AND origem='parcela' AND origem_id=? ORDER BY vencimento, id", [clinica_id, p.id])
    recs.forEach(function (r) { taxa += Number(r.taxa) || 0 })
    // Cartão de crédito: a comissão é contabilizada na data de recebimento de cada parcela do cartão,
    // a não ser que a regra tenha "Considerar data de pagamento para Cartão de Crédito"
    var credito = recs.filter(function (r) { return r.tipo === 'cartao' && r.cartao_tipo !== 'debito' && dia(r.vencimento) })
    var partes = dividir(itens, pago), taxas = dividir(itens, r2(taxa))
    var ref = dia(data || p.data_pagamento), gerados = []
    for (var i = 0; i < itens.length; i++) {
        var it = itens[i]
        if (!it.profissional_id || !(partes[i] > 0)) continue
        var porProc = await linhas(client, "SELECT * FROM comissoes_procedimento WHERE clinica_id=? AND profissional_id=?", [clinica_id, it.profissional_id])
        var nome = normNome(it.procedimento_nome)
        // Procedimento com valor fixo próprio só gera comissão na execução
        if (escolherRegra(porProc.filter(function (r) { return normNome(r.procedimento_nome) === nome }), p.tabela_preco, ref)) continue
        var gerais = await linhas(client, "SELECT * FROM comissoes_config WHERE clinica_id=? AND profissional_id=? AND momento='recebimento'", [clinica_id, it.profissional_id])
        var regra = escolherRegra(gerais, p.tabela_preco, ref)
        if (!regra) continue
        var base = baseRecebida(regra, partes[i], taxas[i]), calc
        if (regra.tipo === 'percentual') { var pcR = percentualDe(regra, await contextoItem(client, clinica_id, regra, p.tabela_preco, it)); calc = { valor_base: base, percentual: pcR, valor_comissao: r2(base * pcR / 100), tipo: 'percentual' } }
        else {
            // Valor fixo por procedimento: paga a fração correspondente ao que entrou
            var cheio = baseDoItem(it), qtd = Number(it.quantidade) || 1
            calc = { valor_base: base, percentual: null, valor_comissao: cheio > 0 ? r2(Number(regra.valor) * qtd * Math.min(1, partes[i] / cheio)) : 0, tipo: regra.tipo || 'fixo' }
        }
        if (!(calc.valor_comissao > 0)) continue
        var stR = Number(regra.requer_aprovacao) ? 'aguardando' : 'pendente'
        var oR = { clinica_id: clinica_id, profissional_id: it.profissional_id, profissional_nome: it.profissional_nome, orcamento_id: p.orcamento_id, paciente_id: p.paciente_id, paciente_nome: p.paciente_nome, item: it, tabela: p.tabela_preco, momento: 'recebimento', data: ref }
        if (credito.length && !Number(regra.data_pagamento_cartao)) {
            // Divide pelas parcelas do cartão, cada uma na sua data de recebimento
            var pesos = dividir(credito.map(function (r) { return { valor_unitario: Number(r.valor) || 0, quantidade: 1 } }), calc.valor_comissao)
            var pesosB = dividir(credito.map(function (r) { return { valor_unitario: Number(r.valor) || 0, quantidade: 1 } }), calc.valor_base)
            for (var k = 0; k < credito.length; k++) {
                if (!(pesos[k] > 0)) continue
                await inserir(client, Object.assign({}, oR, { data: dia(credito[k].vencimento) }), { valor_base: pesosB[k], percentual: calc.percentual, valor_comissao: pesos[k], tipo: calc.tipo }, stR, p.id)
            }
        } else await inserir(client, oR, calc, stR, p.id)
        gerados.push(calc.valor_comissao)
    }
    return gerados
}

// Para as baixas que não podem falhar por causa da comissão (webhook, sincronização)
async function comissaoRecebimentoSegura(client, clinica_id, parcela_id, data) {
    try { return await comissaoRecebimento(client, clinica_id, parcela_id, data) }
    catch (e) { console.error('[comissoes] recebimento parcela ' + parcela_id + ': ' + e.message); return [] }
}

module.exports = { percentualDe, contextoItem, comissaoCheckout, comissaoCheckoutSegura, vigente, escolherRegra, baseDoItem, calcular, gerarComissao, normNome, dividir, baseRecebida, comissaoRecebimento, comissaoRecebimentoSegura }
