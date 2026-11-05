// lib/comissoes.js — Cálculo e geração de comissões
// Klinov — Campo Grande, MS
//
// Ordem das regras:
//   1. Valor fixo por procedimento (comissoes_procedimento), pago na execução.
//      Valor zero é uma decisão registrada: aquele procedimento não gera comissão.
//   2. Regra geral do profissional (comissoes_config), por tabela de preço.
// Só vale a regra dentro da validade na data de referência.

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
    await client.execute({
        sql: "INSERT INTO comissoes_lancamentos(clinica_id, profissional_id, profissional_nome, orcamento_id, orcamento_item_id, paciente_id, paciente_nome, procedimento_nome, tabela_preco, momento, tipo, valor_base, percentual, valor_comissao, data_referencia) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [o.clinica_id, o.profissional_id, o.profissional_nome || '', o.orcamento_id, o.item.id, o.paciente_id || null, o.paciente_nome || '', o.item.procedimento_nome || '', o.tabela, o.momento, calc.tipo, calc.valor_base, calc.percentual, calc.valor_comissao, dia(o.data)]
    })
    return calc.valor_comissao
}

module.exports = { vigente, escolherRegra, baseDoItem, calcular, gerarComissao, normNome }
