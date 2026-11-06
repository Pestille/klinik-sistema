// lib/autorizacao.js — Autorização de execução de procedimentos de convênio
// Klinov — Campo Grande, MS
//
// Como no Clinicorp: procedimento de tabela de convênio fica "Em análise" até a
// clínica autorizar (com o Número de Guia) ou negar. Só Aprovado/Autorizado executa.
// A exigência vale para tabelas tipo 'convenio' com exige_autorizacao=1 (padrão).

var ROTULO = { em_analise: 'Em análise', autorizado: 'Autorizado', negado: 'Negado' }

// Nomes (maiúsculos) das tabelas de convênio que exigem autorização
async function tabelasQueExigem(client, clinica_id) {
    try {
        var r = await client.execute({ sql: "SELECT UPPER(nome) n FROM precos_tabelas WHERE clinica_id=? AND tipo='convenio' AND COALESCE(exige_autorizacao,1)=1", args: [clinica_id] })
        var s = {}
        r.rows.forEach(function (x) { s[x.n] = true })
        return s
    } catch (e) { return {} }
}

// Situação do item: null (não exige), 'em_analise', 'autorizado' ou 'negado'
function situacao(item, tabela, exigem) {
    if (item.autorizacao && ROTULO[item.autorizacao]) return item.autorizacao
    if (exigem[String(tabela || '').toUpperCase()]) return 'em_analise'
    return null
}

module.exports = { ROTULO: ROTULO, tabelasQueExigem: tabelasQueExigem, situacao: situacao }
