// lib/comissoes.js — Cálculo e geração de comissões
// Klinov — Campo Grande, MS
//
// Ordem das regras:
//   1. Valor fixo por procedimento (comissoes_procedimento), pago na execução.
//      Valor zero é uma decisão registrada: aquele procedimento não gera comissão.
//   2. Regra geral do profissional (comissoes_config), por tabela de preço.
// Só vale a regra dentro da validade na data de referência.
//
// Momentos: aprovação do orçamento, execução do procedimento e recebimento.
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

function calcular(regra, item) {
    var base = baseDoItem(item)
    if (regra.tipo === 'percentual') return { valor_base: base, percentual: Number(regra.valor) || 0, valor_comissao: r2(base * (Number(regra.valor) || 0) / 100), tipo: 'percentual' }
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
    var calc = null
    if (fixa) {
        if (o.momento !== 'execucao') return null
        var qtd = Number(o.item.quantidade) || 1
        calc = { valor_base: baseDoItem(o.item), percentual: null, valor_comissao: r2(Number(fixa.valor) * qtd), tipo: 'fixo_procedimento' }
    } else {
        var gerais = await linhas(client, "SELECT * FROM comissoes_config WHERE clinica_id=? AND profissional_id=? AND momento=?", [o.clinica_id, o.profissional_id, o.momento])
        var regra = escolherRegra(gerais, o.tabela, o.data)
        if (!regra) return null
        calc = calcular(regra, o.item)
    }
    if (!(calc.valor_comissao > 0)) return null
    await inserir(client, o, calc, regra && Number(regra.requer_aprovacao) ? 'aguardando' : 'pendente', null)
    return calc.valor_comissao
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
    ;(await linhas(client, "SELECT taxa FROM recebiveis WHERE clinica_id=? AND origem='parcela' AND origem_id=?", [clinica_id, p.id])).forEach(function (r) { taxa += Number(r.taxa) || 0 })
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
        if (regra.tipo === 'percentual') calc = { valor_base: base, percentual: Number(regra.valor) || 0, valor_comissao: r2(base * (Number(regra.valor) || 0) / 100), tipo: 'percentual' }
        else {
            // Valor fixo por procedimento: paga a fração correspondente ao que entrou
            var cheio = baseDoItem(it), qtd = Number(it.quantidade) || 1
            calc = { valor_base: base, percentual: null, valor_comissao: cheio > 0 ? r2(Number(regra.valor) * qtd * Math.min(1, partes[i] / cheio)) : 0, tipo: regra.tipo || 'fixo' }
        }
        if (!(calc.valor_comissao > 0)) continue
        await inserir(client, { clinica_id: clinica_id, profissional_id: it.profissional_id, profissional_nome: it.profissional_nome, orcamento_id: p.orcamento_id, paciente_id: p.paciente_id, paciente_nome: p.paciente_nome, item: it, tabela: p.tabela_preco, momento: 'recebimento', data: ref }, calc, Number(regra.requer_aprovacao) ? 'aguardando' : 'pendente', p.id)
        gerados.push(calc.valor_comissao)
    }
    return gerados
}

// Para as baixas que não podem falhar por causa da comissão (webhook, sincronização)
async function comissaoRecebimentoSegura(client, clinica_id, parcela_id, data) {
    try { return await comissaoRecebimento(client, clinica_id, parcela_id, data) }
    catch (e) { console.error('[comissoes] recebimento parcela ' + parcela_id + ': ' + e.message); return [] }
}

module.exports = { vigente, escolherRegra, baseDoItem, calcular, gerarComissao, normNome, dividir, baseRecebida, comissaoRecebimento, comissaoRecebimentoSegura }
