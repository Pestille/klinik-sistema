// public/financeiro.js — Financeiro (Fase 6)
// Klinov — Campo Grande, MS
//
// Substitui as abas Conta Corrente, Fluxo de Caixa, Contas a Pagar, Contas a
// Receber e Extrato do app.html (renderCC, renderFDC, renderCPagar,
// renderCReceber, renderExtrato). Tudo lê a lista unificada de movimentos do
// servidor (lib/rotas/financeiro.js).
;(function () {
  'use strict'

  var DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  var TIPO_NOME = { entrada: 'Entrada', saida: 'Saída', venda: 'Venda', cancelamento: 'Cancelamento' }
  var TIPO_COR = { entrada: 'ok', saida: 'err', venda: 'info', cancelamento: 'off' }
  var CLASSIF = ['Custo Fixo', 'Custo Variável', 'Investimento', 'Marketing', 'Impostos', 'Outros']
  var FORMAS = ['Dinheiro', 'PIX', 'Cartão de crédito', 'Cartão de débito', 'Boleto', 'Transferência', 'Cheque', 'Convênio', 'Outros']
  var FN = { cache: {}, f: {} }

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function moeda(v) { var n = Number(v || 0); return (n < 0 ? '- ' : '') + 'R$ ' + Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function hoje() { return ymd(new Date()) }
  function inicioMes() { var d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)) }
  function fimMes() { var d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
  function diaSemana(s) { return DIAS_SEMANA[new Date(s + 'T12:00:00').getDay()] }
  function isAdmin() { return (KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }
  function vazio(msg) { return '<div class="pc-vazio" style="padding:32px 0">' + esc(msg) + '</div>' }
  function carregando() { return '<div class="fn-sk"></div><div class="fn-sk" style="height:200px"></div>' }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('fn-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'fn-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10010'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 620) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="fn-m-x">✕</button></div>' +
      '<div class="ag-modal-b" id="fn-m-b">' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('fn-m-x').onclick = fechar
    ov.onmousedown = function (e) { if (e.target === ov) fechar() }
  }
  function fechar() { var ov = el('fn-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  function erro(msg) { var b = el('fn-err'); if (b) b.innerHTML = msg ? '<div class="ag-err">' + esc(msg) + '</div>' : '' }

  async function contas(forcar) {
    if (!FN.cache.contas || forcar) { var d = await apiData('fin-contas', {}); FN.cache.contas = d.data || []; FN.cache.caixa = d.caixa_id }
    return FN.cache.contas
  }
  async function categorias(forcar) {
    if (!FN.cache.cats || forcar) { var d = await apiData('fin-categorias', {}); FN.cache.cats = d.data || [] }
    return FN.cache.cats
  }
  async function fornecedores(forcar) {
    if (!FN.cache.forn || forcar) { var d = await apiData('fin-fornecedores', {}); FN.cache.forn = d.data || [] }
    return FN.cache.forn
  }
  function opcoes(lista, sel, vazioTxt) {
    return (vazioTxt != null ? '<option value="">' + esc(vazioTxt) + '</option>' : '') + lista.map(function (x) { return '<option value="' + x.id + '"' + (String(sel) === String(x.id) ? ' selected' : '') + '>' + esc(x.nome) + '</option>' }).join('')
  }
  function opcoesTexto(lista, sel, vazioTxt) {
    return (vazioTxt != null ? '<option value="">' + esc(vazioTxt) + '</option>' : '') + lista.map(function (x) { return '<option' + (sel === x ? ' selected' : '') + '>' + esc(x) + '</option>' }).join('')
  }
  function sub(id) { var s = el('fin-' + id); if (s) s.classList.add('fn-pronto'); return s }
  function linkPac(id, nome) { return id ? '<a class="fn-pac" data-pac="' + id + '">' + esc(nome || 'Paciente') + '</a>' : esc(nome || '—') }
  function ligarPacientes(box) { box.querySelectorAll('[data-pac]').forEach(function (a) { a.onclick = function () { abrirProntuario('', +this.getAttribute('data-pac')) } }) }

  function csv(nome, linhas) {
    var txt = '﻿' + linhas.map(function (l) { return l.map(function (v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }).join(';') }).join('\r\n')
    var a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }))
    a.download = nome + '-' + hoje() + '.csv'
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }
  function num(v) { var n = Number(String(v || '').replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0 }

  // ════════════════════════════════════════════════════════════════
  // CONTA CORRENTE
  // ════════════════════════════════════════════════════════════════
  async function renderCC() {
    var box = sub('contacorrente'); if (!box) return
    var F = FN.f.cc = FN.f.cc || { de: inicioMes(), ate: hoje(), tipo: 'todos', conta_id: '', q: '' }
    var cs = await contas()
    box.innerHTML = '<div class="fn-pg"><div class="fn-head"><div><div class="gpage-title">Conta corrente</div><div class="gpage-sub">Vendas, entradas e saídas da clínica.</div></div>' +
      '<div class="fn-acoes"><button class="btn" id="cc-exp">Exportar</button>' + (pode('financeiro.editar_contas') ? '<button class="btn" id="cc-contas">Contas bancárias</button>' : '') +
      '<button class="ag-btn-novo" id="cc-novo">+ Novo lançamento</button></div></div>' +
      '<div class="fn-filtros"><div class="ag-f"><label>De</label><input class="ag-in" type="date" id="cc-de" value="' + F.de + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="cc-ate" value="' + F.ate + '"></div>' +
      '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="cc-tipo">' + [['todos', 'Todos'], ['vendas', 'Vendas'], ['entradas', 'Entradas'], ['saidas', 'Saídas'], ['cancelamentos', 'Cancelamentos']].map(function (t) { return '<option value="' + t[0] + '"' + (F.tipo === t[0] ? ' selected' : '') + '>' + t[1] + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label>Conta</label><select class="ag-in" id="cc-conta">' + opcoes(cs, F.conta_id, 'Todas') + '</select></div>' +
      '<div class="ag-f" style="flex:2"><label>Buscar</label><input class="ag-in" id="cc-q" placeholder="Descrição, paciente, forma…" value="' + esc(F.q) + '"></div>' +
      '<div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" id="cc-ok">Listar</button></div></div>' +
      '<div id="cc-res">' + carregando() + '</div></div>'
    el('cc-novo').onclick = function () { abrirLancamento(null, renderCC) }
    if (el('cc-contas')) el('cc-contas').onclick = function () { gerenciarContas(renderCC) }
    el('cc-ok').onclick = function () { F.de = el('cc-de').value; F.ate = el('cc-ate').value; F.tipo = el('cc-tipo').value; F.conta_id = el('cc-conta').value; F.q = el('cc-q').value; renderCC() }
    el('cc-q').onkeydown = function (e) { if (e.key === 'Enter') el('cc-ok').click() }
    var d = await apiData('fin-movimentos', { de: F.de, ate: F.ate, tipo: F.tipo, conta_id: F.conta_id, q: F.q }).catch(function (e) { return { success: false, error: e.message } })
    var res = el('cc-res'); if (!res) return
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    FN.cc = d
    el('cc-exp').onclick = function () {
      csv('conta-corrente', [['Data', 'Hora', 'Tipo', 'Forma', 'Descrição', 'Paciente', 'Categoria', 'Valor']].concat(d.movimentos.map(function (m) { return [br(m.data), m.hora, TIPO_NOME[m.tipo], m.forma, m.descricao, m.paciente_nome || '', m.categoria || '', (m.tipo === 'saida' ? '-' : '') + m.valor.toFixed(2).replace('.', ',')] })))
    }
    var k = d.kpis
    res.innerHTML = '<div class="fn-kpis">' + kpi('Vendas', k.vendas, 'Tratamentos aprovados') + kpi('Cancelamento de vendas', k.cancelamentos, 'Orçamentos desaprovados') + kpi('Entradas', k.entradas, 'Recebido', 'ok') + kpi('Saídas', k.saidas, 'Pago', 'err') + '</div>' +
      '<div class="ag-hint" style="margin:0 0 12px">' + d.transacoes + ' transação(ões) no período · saldo do período ' + moeda(k.entradas - k.saidas) + '</div>' +
      (d.movimentos.length ? porDia(d.movimentos) : vazio('Nenhuma transação no período.'))
    ligarDias(res, renderCC)
  }

  function kpi(rot, v, hint, cor) { return '<div class="pc-box fn-kpi' + (cor ? ' ' + cor : '') + '"><div class="pc-box-h" style="margin-bottom:8px">' + esc(rot) + '</div><div class="fn-kpi-v">' + moeda(v) + '</div><div class="ag-hint" style="margin:0">' + esc(hint || '') + '</div></div>' }

  function porDia(lista) {
    var grupos = {}, ordem = []
    lista.forEach(function (m) { if (!grupos[m.data]) { grupos[m.data] = []; ordem.push(m.data) } grupos[m.data].push(m) })
    return ordem.map(function (dt) {
      var ms = grupos[dt], ent = 0, sai = 0, ven = 0
      ms.forEach(function (m) { if (m.tipo === 'entrada') ent += m.valor; else if (m.tipo === 'saida') sai += m.valor; else if (m.tipo === 'venda') ven += m.valor })
      return '<div class="pc-box fn-dia"><div class="fn-dia-h" data-tg="1"><div><b>' + br(dt) + '</b> · ' + diaSemana(dt) + ' <span class="ag-hint" style="display:inline;margin:0">· ' + ms.length + ' transação(ões)</span></div>' +
        '<div class="fn-dia-k">' + (ven ? '<span>Vendas ' + moeda(ven) + '</span>' : '') + (ent ? '<span class="ok">+ ' + moeda(ent) + '</span>' : '') + (sai ? '<span class="err">- ' + moeda(sai) + '</span>' : '') + '</div></div>' +
        '<div class="fn-dia-b"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Hora</th><th>Tipo</th><th class="hide-sm">Forma</th><th>Descrição</th><th class="hide-sm">Paciente</th><th style="text-align:right">Valor</th><th></th></tr></thead><tbody>' +
        ms.map(function (m) {
          return '<tr><td>' + esc(m.hora || '—') + '</td><td><span class="pc-badge ' + TIPO_COR[m.tipo] + '">' + TIPO_NOME[m.tipo] + '</span></td><td class="hide-sm">' + esc(m.forma || '—') + '</td>' +
            '<td>' + esc(m.descricao || '') + (m.categoria ? '<div class="ag-hint" style="margin:0">' + esc(m.categoria) + '</div>' : '') + '</td><td class="hide-sm">' + linkPac(m.paciente_id, m.paciente_nome) + '</td>' +
            '<td class="fn-num ' + (m.tipo === 'saida' ? 'err' : m.tipo === 'entrada' ? 'ok' : '') + '">' + (m.tipo === 'saida' ? '- ' : '') + moeda(m.valor) + '</td>' +
            '<td style="text-align:right;white-space:nowrap">' + (m.editavel && pode('financeiro.conta_corrente') ? '<button class="btn btn-sm" data-ed="' + esc(m.id) + '">Editar</button>' : '') + '</td></tr>'
        }).join('') + '</tbody></table></div></div></div>'
    }).join('')
  }
  function ligarDias(box, recarregar) {
    box.querySelectorAll('[data-tg]').forEach(function (h) { h.onclick = function () { this.parentNode.classList.toggle('fechado') } })
    box.querySelectorAll('[data-ed]').forEach(function (b) {
      b.onclick = function () { var id = this.getAttribute('data-ed'), m = ((FN.cc && FN.cc.movimentos) || []).concat((FN.ex && FN.ex.movimentos) || []).filter(function (x) { return x.id === id })[0]; if (m) abrirLancamento(m, recarregar) }
    })
    ligarPacientes(box)
  }

  async function abrirLancamento(m, aoSalvar) {
    var cs = await contas(), cats = await categorias(), tipo = m ? m.tipo : 'entrada'
    function catsDo(t) { return cats.filter(function (c) { return t === 'entrada' ? c.tipo === 'receita' : c.tipo !== 'receita' }) }
    modal(m ? 'Editar lançamento' : 'Novo lançamento', '<div id="fn-err"></div>' +
      '<div class="ag-f"><label>Tipo</label><div class="ag-chips" id="ln-tipo"><span class="ag-chip' + (tipo === 'entrada' ? ' on' : '') + '" data-t="entrada">Receita / entrada</span><span class="ag-chip' + (tipo === 'saida' ? ' on' : '') + '" data-t="saida">Despesa / saída</span></div></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="ln-data" value="' + (m ? m.data : hoje()) + '"></div>' +
      '<div class="ag-f"><label>Hora (opcional)</label><input class="ag-in" type="time" id="ln-hora" value="' + (m && m.hora ? m.hora : '') + '"></div>' +
      '<div class="ag-f"><label>Valor (R$)</label><input class="ag-in" id="ln-valor" inputmode="decimal" value="' + (m ? String(m.valor).replace('.', ',') : '') + '"></div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Conta</label><select class="ag-in" id="ln-conta">' + opcoes(cs, m ? m.conta_id : FN.cache.caixa) + '</select></div>' +
      '<div class="ag-f"><label>Forma de pagamento</label><select class="ag-in" id="ln-forma">' + opcoesTexto(FORMAS, m ? m.forma : '', 'Não informada') + '</select></div></div>' +
      '<div class="ag-f"><label>Conta de receita / despesa</label><select class="ag-in" id="ln-cat"></select></div>' +
      '<div class="ag-f"><label>Descrição</label><input class="ag-in" id="ln-desc" maxlength="140" value="' + esc(m ? m.descricao : '') + '"></div>',
      (m ? '<button class="btn" id="ln-del" style="color:var(--red);margin-right:auto">Excluir</button>' : '') + '<button class="btn" id="ln-c">Cancelar</button><button class="ag-btn-novo" id="ln-ok">Salvar lançamento</button>', 600)
    function preencherCats() {
      var l = catsDo(tipo), grupos = {}
      l.forEach(function (c) { (grupos[c.classificacao] = grupos[c.classificacao] || []).push(c) })
      el('ln-cat').innerHTML = '<option value="">Sem categoria</option>' + Object.keys(grupos).map(function (g) { return '<optgroup label="' + esc(g) + '">' + opcoes(grupos[g], m && m.categoria_id) + '</optgroup>' }).join('')
    }
    preencherCats()
    el('ln-tipo').querySelectorAll('[data-t]').forEach(function (s) { s.onclick = function () { tipo = this.getAttribute('data-t'); el('ln-tipo').querySelectorAll('[data-t]').forEach(function (x) { x.classList.toggle('on', x === s) }); preencherCats() } })
    el('ln-c').onclick = fechar
    if (el('ln-del')) el('ln-del').onclick = async function () {
      if (!confirm('Excluir este lançamento? Ele vai para a Administração de Dados e pode ser restaurado.')) return
      var r = await apiPost('fin-lancamento', { action: 'excluir', id: m.origem_id }); if (!r.success) return erro(r.error || 'Erro')
      fechar(); aoSalvar && aoSalvar()
    }
    el('ln-ok').onclick = async function () {
      var btn = this; btn.disabled = true
      var r = await apiPost('fin-lancamento', { id: m ? m.origem_id : undefined, tipo: tipo, data: el('ln-data').value, hora: el('ln-hora').value, valor: el('ln-valor').value, conta_id: el('ln-conta').value,
        forma_pagamento: el('ln-forma').value, categoria_id: el('ln-cat').value, descricao: el('ln-desc').value })
      btn.disabled = false
      if (!r.success) return erro(r.error || 'Erro')
      fechar(); aoSalvar && aoSalvar()
    }
  }

  // ── Contas bancárias ────────────────────────────────────────────
  async function gerenciarContas(aoFechar) {
    var d = await apiData('fin-contas', { saldos: 1 }), cs = d.data || []
    var TIPOS = { caixa: 'Caixa', corrente: 'Conta corrente', poupanca: 'Poupança', digital: 'Conta digital' }
    modal('Contas bancárias', '<div id="fn-err"></div><table class="pc-tbl"><thead><tr><th>Conta</th><th class="hide-sm">Tipo</th><th class="hide-sm">Banco / agência / conta</th><th style="text-align:right">Saldo atual</th><th></th></tr></thead><tbody>' +
      cs.map(function (c) {
        return '<tr><td>' + esc(c.nome) + '</td><td class="hide-sm">' + TIPOS[c.tipo] + '</td><td class="hide-sm">' + esc([c.banco, c.agencia, c.conta].filter(Boolean).join(' · ') || '—') + '</td><td class="fn-num">' + moeda(c.saldo) + '</td>' +
          '<td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-ed="' + c.id + '">Editar</button>' + (c.tipo !== 'caixa' ? ' <button class="btn btn-sm" data-rm="' + c.id + '" style="color:var(--red)">Remover</button>' : '') + '</td></tr>'
      }).join('') + '</tbody></table><p class="ag-hint">Movimentos sem conta definida (recibos antigos, cobranças do Asaas) contam no Caixa geral. O saldo considera o saldo inicial informado em cada conta.</p>',
      '<button class="btn" id="cb-f">Fechar</button><button class="ag-btn-novo" id="cb-novo">+ Nova conta</button>', 760)
    el('cb-f').onclick = function () { fechar(); FN.cache.contas = null; aoFechar && aoFechar() }
    el('cb-novo').onclick = function () { editarConta(null, aoFechar) }
    el('fn-m-b').querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { editarConta(cs.filter(function (c) { return c.id === +b.getAttribute('data-ed') })[0], aoFechar) } })
    el('fn-m-b').querySelectorAll('[data-rm]').forEach(function (b) {
      b.onclick = async function () { if (!confirm('Remover esta conta? Os lançamentos já feitos continuam no histórico.')) return; var r = await apiPost('fin-contas', { action: 'excluir', id: +b.getAttribute('data-rm') }); if (!r.success) return erro(r.error); FN.cache.contas = null; gerenciarContas(aoFechar) }
    })
  }
  function editarConta(c, aoFechar) {
    c = c || {}
    modal(c.id ? 'Editar conta' : 'Nova conta bancária', '<div id="fn-err"></div><div class="ag-row c2"><div class="ag-f"><label>Nome</label><input class="ag-in" id="cb-nome" maxlength="60" value="' + esc(c.nome || '') + '" placeholder="Ex.: Sicredi PJ"></div>' +
      '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="cb-tipo"' + (c.tipo === 'caixa' ? ' disabled' : '') + '>' + [['corrente', 'Conta corrente'], ['poupanca', 'Poupança'], ['digital', 'Conta digital'], ['caixa', 'Caixa']].map(function (t) { return '<option value="' + t[0] + '"' + (c.tipo === t[0] ? ' selected' : '') + '>' + t[1] + '</option>' }).join('') + '</select></div></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Banco</label><input class="ag-in" id="cb-banco" maxlength="60" value="' + esc(c.banco || '') + '"></div><div class="ag-f"><label>Agência</label><input class="ag-in" id="cb-ag" maxlength="20" value="' + esc(c.agencia || '') + '"></div>' +
      '<div class="ag-f"><label>Conta</label><input class="ag-in" id="cb-ct" maxlength="30" value="' + esc(c.conta || '') + '"></div></div>' +
      '<div class="ag-f" style="max-width:220px"><label>Saldo inicial (R$)</label><input class="ag-in" id="cb-saldo" inputmode="decimal" value="' + (c.saldo_inicial ? String(c.saldo_inicial).replace('.', ',') : '') + '"></div>',
      '<button class="btn" id="cb-v">Voltar</button><button class="ag-btn-novo" id="cb-ok">Salvar</button>', 620)
    el('cb-v').onclick = function () { gerenciarContas(aoFechar) }
    el('cb-ok').onclick = async function () {
      var r = await apiPost('fin-contas', { id: c.id, nome: el('cb-nome').value, tipo: c.tipo === 'caixa' ? 'caixa' : el('cb-tipo').value, banco: el('cb-banco').value, agencia: el('cb-ag').value, conta: el('cb-ct').value, saldo_inicial: el('cb-saldo').value })
      if (!r.success) return erro(r.error || 'Erro')
      FN.cache.contas = null; gerenciarContas(aoFechar)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // FLUXO DE CAIXA
  // ════════════════════════════════════════════════════════════════
  async function renderFDC() {
    var box = sub('fluxocaixa'); if (!box) return
    var now = new Date(), F = FN.f.fx = FN.f.fx || { mes: now.getMonth() + 1, ano: now.getFullYear() }
    var anos = []; for (var a = now.getFullYear() + 1; a >= now.getFullYear() - 4; a--) anos.push(a)
    box.innerHTML = '<div class="fn-pg"><div class="fn-head"><div><div class="gpage-title">Fluxo de caixa</div><div class="gpage-sub">O que entrou e saiu, o que está a receber e a pagar no mês.</div></div>' +
      '<div class="fn-acoes"><select class="ag-in" id="fx-mes" style="width:auto">' + MESES.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (F.mes === i + 1 ? ' selected' : '') + '>' + n + '</option>' }).join('') + '</select>' +
      '<select class="ag-in" id="fx-ano" style="width:auto">' + anos.map(function (x) { return '<option' + (F.ano === x ? ' selected' : '') + '>' + x + '</option>' }).join('') + '</select><button class="btn btn-primary" id="fx-ok">Listar</button></div></div>' +
      '<div id="fx-res">' + carregando() + '</div></div>'
    el('fx-ok').onclick = function () { F.mes = +el('fx-mes').value; F.ano = +el('fx-ano').value; renderFDC() }
    var d = await apiData('fin-fluxo', { mes: F.mes, ano: F.ano }).catch(function (e) { return { success: false, error: e.message } })
    var res = el('fx-res'); if (!res) return
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    var t = d.totais
    res.innerHTML = '<div class="fn-fx"><div class="pc-box" style="min-width:0"><div class="pc-box-h">Movimento diário</div>' + grafico(d) + '</div>' +
      '<div class="pc-box fn-resumo"><div class="pc-box-h">' + MESES[d.mes - 1] + ' de ' + d.ano + '</div>' +
        linha('Entradas', t.entradas, 'ok') + linha('Saídas', t.saidas, 'err') + linha('Saldo (realizado)', t.saldo, null, true) +
        '<div class="fn-sep"></div>' + linha('A receber', t.a_receber, 'info') + linha('A pagar', t.a_pagar, 'err') + linha('Saldo (pendente)', t.saldo_pendente, null, true) +
        '<div class="fn-sep"></div>' + linha('Saldo (previsto)', t.saldo_previsto, null, true, true) +
        (t.atrasado_receber || t.atrasado_pagar ? '<div class="ag-hint">De meses anteriores ainda em aberto: ' + moeda(t.atrasado_receber) + ' a receber e ' + moeda(t.atrasado_pagar) + ' a pagar (fora do previsto do mês).</div>' : '') + '</div></div>' +
      '<div class="fn-fx2"><div class="pc-box"><div class="pc-box-h">Resumo das entradas</div>' + resumo(d.resumo_entradas, t.entradas) + '</div><div class="pc-box"><div class="pc-box-h">Resumo das saídas</div>' + resumo(d.resumo_saidas, t.saidas) + '</div></div>' +
      '<div class="pc-box-h" style="margin-top:24px">Dia a dia</div>' +
      (d.dias.filter(function (x) { return x.entradas || x.saidas || x.a_receber || x.a_pagar }).map(function (x) {
        var ents = x.movimentos.filter(function (m) { return m.tipo === 'entrada' }), sais = x.movimentos.filter(function (m) { return m.tipo === 'saida' })
        return '<div class="pc-box fn-dia fechado"><div class="fn-dia-h" data-tg="1"><div><b>' + br(x.data) + '</b> · ' + diaSemana(x.data) + '</div><div class="fn-dia-k"><span class="ok">+ ' + moeda(x.entradas) + '</span><span class="err">- ' + moeda(x.saidas) + '</span><span>Saldo ' + moeda(x.saldo) + '</span>' +
          (x.a_receber ? '<span class="info">a receber ' + moeda(x.a_receber) + '</span>' : '') + (x.a_pagar ? '<span>a pagar ' + moeda(x.a_pagar) + '</span>' : '') + '</div></div>' +
          '<div class="fn-dia-b fn-2col"><div><div class="ag-hint" style="margin-top:0">Entradas</div>' + (ents.map(itemMov).join('') || '<div class="ag-hint">—</div>') + '</div><div><div class="ag-hint" style="margin-top:0">Saídas</div>' + (sais.map(itemMov).join('') || '<div class="ag-hint">—</div>') + '</div></div></div>'
      }).join('') || vazio('Nenhum movimento neste mês.'))
    ligarDias(res)
    ligarGrafico(d)
  }
  function itemMov(m) { return '<div class="fn-mov"><span>' + esc(m.descricao || '') + (m.paciente_nome ? ' · ' + esc(m.paciente_nome) : '') + '<small>' + esc(m.forma || m.categoria || '') + '</small></span><b>' + moeda(m.valor) + '</b></div>' }
  function linha(rot, v, cor, forte, destaque) { return '<div class="fn-lin' + (destaque ? ' destaque' : '') + '"><span>' + rot + '</span><b class="' + (cor || (v < 0 ? 'err' : '')) + '"' + (forte ? '' : ' style="font-weight:400"') + '>' + moeda(v) + '</b></div>' }
  function resumo(lista, total) {
    if (!lista.length) return '<div class="ag-hint">Nada no mês.</div>'
    return lista.map(function (x) { var p = total ? Math.round(x.total / total * 100) : 0; return '<div class="fn-res-l"><span>' + esc(x.nome) + '</span><span class="fn-num">' + moeda(x.total) + ' <small>' + p + '%</small></span><div class="fn-barra"><i style="width:' + p + '%"></i></div></div>' }).join('')
  }

  // Barras de entrada (acima da linha) e saída (abaixo) por dia + linha do saldo acumulado
  function grafico(d) {
    var W = 920, H = 260, PL = 64, PR = 12, PT = 16, PB = 28, n = d.dias.length
    var max = 1, min = 0
    d.dias.forEach(function (x) { max = Math.max(max, x.entradas, x.acumulado); min = Math.min(min, -x.saidas, x.acumulado) })
    // passo "redondo" (1, 2 ou 5 × 10^n) para ~4 divisões
    var bruto = (max - min) / 4 || 1, mag = Math.pow(10, Math.floor(Math.log10(bruto))), r = bruto / mag
    var passo = mag * (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10)
    var topo = Math.ceil(max / passo) * passo, base = Math.floor(min / passo) * passo
    if (topo === base) topo = base + passo
    var y = function (v) { return PT + (topo - v) / (topo - base) * (H - PT - PB) }, cw = (W - PL - PR) / n, bw = Math.max(3, Math.min(14, cw / 2 - 2))
    var s = '<svg class="fn-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Entradas, saídas e saldo acumulado por dia">'
    for (var v = base; v <= topo + passo / 2; v += passo) { s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="fn-grid"/><text x="' + (PL - 8) + '" y="' + (y(v) + 4) + '" class="fn-tick" text-anchor="end">' + abrev(v) + '</text>' }
    s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(0) + '" y2="' + y(0) + '" class="fn-zero"/>'
    var pts = []
    d.dias.forEach(function (x, i) {
      var cx = PL + cw * i + cw / 2
      if (x.entradas) s += '<rect x="' + (cx - bw - 1) + '" y="' + y(x.entradas) + '" width="' + bw + '" height="' + Math.max(1, y(0) - y(x.entradas)) + '" rx="2" class="fn-b-ent"/>'
      if (x.saidas) s += '<rect x="' + (cx + 1) + '" y="' + y(0) + '" width="' + bw + '" height="' + Math.max(1, y(-x.saidas) - y(0)) + '" rx="2" class="fn-b-sai"/>'
      if (x.data <= d.hoje) pts.push(cx.toFixed(1) + ',' + y(x.acumulado).toFixed(1)) // saldo realizado só até hoje
      if (x.dia === 1 || x.dia % 5 === 0) s += '<text x="' + cx + '" y="' + (H - 8) + '" class="fn-tick" text-anchor="middle">' + x.dia + '</text>'
      if (x.data === d.hoje) s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + PT + '" y2="' + (H - PB) + '" class="fn-hoje"/><text x="' + (cx + 4) + '" y="' + (PT + 10) + '" class="fn-tick">hoje</text>'
    })
    s += '<polyline points="' + pts.join(' ') + '" class="fn-l-acum"/>'
    d.dias.forEach(function (x, i) { s += '<rect x="' + (PL + cw * i) + '" y="' + PT + '" width="' + cw + '" height="' + (H - PT - PB) + '" class="fn-hit" data-i="' + i + '"/>' })
    s += '</svg>'
    return '<div class="fn-leg"><span><i class="fn-sw ent"></i>Entradas</span><span><i class="fn-sw sai"></i>Saídas</span><span><i class="fn-sw acum"></i>Saldo acumulado</span></div><div class="fn-graf">' + s + '<div class="fn-tip" id="fx-tip"></div></div>'
  }
  function abrev(v) { var a = Math.abs(v), k = function (x) { return (Math.round(x * 10) / 10).toString().replace('.', ',') }; return (v < 0 ? '-' : '') + (a >= 1e6 ? k(a / 1e6) + ' mi' : a >= 1000 ? k(a / 1000) + ' mil' : Math.round(a)) }
  function ligarGrafico(d) {
    var tip = el('fx-tip'); if (!tip) return
    document.querySelectorAll('.fn-hit').forEach(function (r) {
      r.addEventListener('mouseenter', function () {
        var x = d.dias[+r.getAttribute('data-i')]
        tip.innerHTML = '<b>' + br(x.data) + '</b><div><i class="fn-sw ent"></i>Entradas ' + moeda(x.entradas) + '</div><div><i class="fn-sw sai"></i>Saídas ' + moeda(x.saidas) + '</div><div><i class="fn-sw acum"></i>Acumulado ' + moeda(x.acumulado) + '</div>' +
          (x.a_receber ? '<div>A receber ' + moeda(x.a_receber) + '</div>' : '') + (x.a_pagar ? '<div>A pagar ' + moeda(x.a_pagar) + '</div>' : '')
        var box = r.ownerSVGElement.getBoundingClientRect(), rb = r.getBoundingClientRect()
        var left = rb.left - box.left + rb.width / 2
        tip.style.left = Math.min(Math.max(left, 80), box.width - 80) + 'px'
        tip.classList.add('on')
      })
      r.addEventListener('mouseleave', function () { tip.classList.remove('on') })
    })
  }

  // ════════════════════════════════════════════════════════════════
  // CONTAS A PAGAR
  // ════════════════════════════════════════════════════════════════
  var SIT = { aberta: ['Aberta', 'pend'], vencida: ['Vencida', 'err'], paga: ['Paga', 'ok'] }
  async function renderCPagar() {
    var box = sub('contaspagar'); if (!box) return
    var F = FN.f.cp = FN.f.cp || { de: inicioMes(), ate: fimMes(), mostrar: 'todas', fornecedor_id: '', q: '' }
    var fs = await fornecedores()
    box.innerHTML = '<div class="fn-pg"><div class="fn-head"><div><div class="gpage-title">Contas a pagar</div><div class="gpage-sub">Despesas da clínica por vencimento.</div></div>' +
      '<div class="fn-acoes"><button class="btn" id="cp-exp">Exportar</button><button class="btn" id="cp-forn">Fornecedores</button><button class="ag-btn-novo" id="cp-novo">+ Nova conta a pagar</button></div></div>' +
      '<div class="fn-filtros"><div class="ag-f"><label>Mostrar</label><select class="ag-in" id="cp-mostrar">' + [['todas', 'A pagar e pagas'], ['a_pagar', 'Só a pagar'], ['pagas', 'Só pagas']].map(function (t) { return '<option value="' + t[0] + '"' + (F.mostrar === t[0] ? ' selected' : '') + '>' + t[1] + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label>Vencimento de</label><input class="ag-in" type="date" id="cp-de" value="' + F.de + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="cp-ate" value="' + F.ate + '"></div>' +
      '<div class="ag-f"><label>Fornecedor</label><select class="ag-in" id="cp-forn-f">' + opcoes(fs, F.fornecedor_id, 'Todos') + '</select></div>' +
      '<div class="ag-f" style="flex:2"><label>Buscar</label><input class="ag-in" id="cp-q" placeholder="Descrição, categoria…" value="' + esc(F.q) + '"></div>' +
      '<div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" id="cp-ok">Listar</button></div></div><div id="cp-res">' + carregando() + '</div></div>'
    el('cp-novo').onclick = function () { abrirConta(null) }
    el('cp-forn').onclick = function () { gerenciarFornecedores() }
    el('cp-ok').onclick = function () { F.mostrar = el('cp-mostrar').value; F.de = el('cp-de').value; F.ate = el('cp-ate').value; F.fornecedor_id = el('cp-forn-f').value; F.q = el('cp-q').value; renderCPagar() }
    el('cp-q').onkeydown = function (e) { if (e.key === 'Enter') el('cp-ok').click() }
    var d = await apiData('fin-pagar', F).catch(function (e) { return { success: false, error: e.message } })
    var res = el('cp-res'); if (!res) return
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    FN.cp = d
    el('cp-exp').onclick = function () { csv('contas-a-pagar', [['Vencimento', 'Situação', 'Descrição', 'Fornecedor', 'Tipo', 'Categoria', 'Pagamento', 'Valor']].concat(d.contas.map(function (c) { return [br(c.vencimento), SIT[c.situacao][0], c.descricao, c.fornecedor || '', c.classificacao || '', c.categoria || '', br(c.pagamento), Number(c.valor).toFixed(2).replace('.', ',')] }))) }
    var t = d.totais
    res.innerHTML = '<div class="fn-kpis c5">' + kpi('Custo fixo', t['Custo Fixo']) + kpi('Custo variável', t['Custo Variável']) + kpi('Investimento', t['Investimento']) + kpi('Outros', t['Outros']) + kpi('Valor total', d.total, 'A pagar ' + moeda(d.a_pagar) + (d.vencidas ? ' · vencido ' + moeda(d.vencidas) : '')) + '</div>' +
      (d.contas.length ? contasPorDia(d.contas) : vazio('Nenhuma conta no período.'))
    res.querySelectorAll('[data-tg]').forEach(function (h) { h.onclick = function () { this.parentNode.classList.toggle('fechado') } })
    res.querySelectorAll('[data-ac]').forEach(function (b) {
      b.onclick = async function () {
        var c = d.contas.filter(function (x) { return x.id === +b.getAttribute('data-id') })[0], ac = b.getAttribute('data-ac')
        if (ac === 'pagar') return pagarConta(c)
        if (ac === 'anexos') return window.abrirAnexos ? abrirAnexos('conta_pagar', c.id, c.descricao, renderCPagar) : null
        if (ac === 'editar') return abrirConta(c)
        if (ac === 'estornar') { if (!confirm('Estornar o pagamento? A conta volta para "a pagar".')) return; var r = await apiPost('fin-pagar-estornar', { id: c.id }); if (!r.success) return alert(r.error); return renderCPagar() }
        if (ac === 'excluir') { if (!confirm('Excluir esta conta? Ela vai para a Administração de Dados e pode ser restaurada.')) return; var x = await apiPost('fin-pagar', { action: 'excluir', id: c.id }); if (!x.success) return alert(x.error); return renderCPagar() }
      }
    })
  }
  function contasPorDia(lista) {
    var g = {}, ordem = []
    lista.forEach(function (c) { var k = String(c.vencimento).slice(0, 10); if (!g[k]) { g[k] = []; ordem.push(k) } g[k].push(c) })
    return ordem.map(function (dt) {
      var cs = g[dt], tot = cs.reduce(function (s, c) { return s + Number(c.valor) }, 0)
      return '<div class="pc-box fn-dia"><div class="fn-dia-h" data-tg="1"><div><b>' + br(dt) + '</b> · ' + diaSemana(dt) + ' <span class="ag-hint" style="display:inline;margin:0">· ' + cs.length + ' conta(s)</span></div><div class="fn-dia-k"><span>' + moeda(tot) + '</span></div></div>' +
        '<div class="fn-dia-b"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Situação</th><th>Descrição</th><th class="hide-sm">Tipo / categoria</th><th class="hide-sm">Fornecedor</th><th style="text-align:right">Valor</th><th></th></tr></thead><tbody>' +
        cs.map(function (c) {
          var s = SIT[c.situacao] || SIT.aberta
          return '<tr><td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span>' + (c.situacao === 'paga' ? '<div class="ag-hint" style="margin:2px 0 0">em ' + br(c.pagamento) + '</div>' : '') + '</td>' +
            '<td>' + esc(c.descricao) + (c.recorrente ? ' <span class="ag-hint" style="display:inline">· recorrente</span>' : '') + '</td><td class="hide-sm">' + esc(c.classificacao || '—') + (c.categoria ? '<div class="ag-hint" style="margin:0">' + esc(c.categoria) + '</div>' : '') + '</td>' +
            '<td class="hide-sm">' + esc(c.fornecedor || '—') + '</td><td class="fn-num">' + moeda(c.valor) + '</td><td style="text-align:right;white-space:nowrap">' +
            '<button class="btn btn-sm" data-ac="anexos" data-id="' + c.id + '">' + (c.comprovante_url ? 'Comprovante' : 'Anexos') + '</button> ' + (c.situacao !== 'paga' ? (pode('financeiro.dar_baixa') ? '<button class="btn btn-sm btn-primary" data-ac="pagar" data-id="' + c.id + '">Pagar</button> ' : '') + '<button class="btn btn-sm" data-ac="editar" data-id="' + c.id + '">Editar</button> <button class="btn btn-sm" data-ac="excluir" data-id="' + c.id + '" style="color:var(--red)">Excluir</button>'
              : (pode('financeiro.editar_contas') ? '<button class="btn btn-sm" data-ac="estornar" data-id="' + c.id + '">Estornar</button>' : '')) + '</td></tr>'
        }).join('') + '</tbody></table></div></div></div>'
    }).join('')
  }

  async function abrirConta(c) {
    var cats = (await categorias()).filter(function (x) { return x.tipo !== 'receita' }), fs = await fornecedores(), cs = await contas()
    c = c || {}
    var grupos = {}; cats.forEach(function (x) { (grupos[x.classificacao] = grupos[x.classificacao] || []).push(x) })
    modal(c.id ? 'Editar conta a pagar' : 'Nova conta a pagar', '<div id="fn-err"></div>' +
      '<div class="ag-f"><label>Descrição</label><input class="ag-in" id="cp-desc" maxlength="140" value="' + esc(c.descricao || '') + '"></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Valor (R$)</label><input class="ag-in" id="cp-valor" inputmode="decimal" value="' + (c.valor ? String(c.valor).replace('.', ',') : '') + '"></div>' +
      '<div class="ag-f"><label>Vencimento</label><input class="ag-in" type="date" id="cp-venc" value="' + (c.vencimento ? String(c.vencimento).slice(0, 10) : hoje()) + '"></div>' +
      '<div class="ag-f"><label>Competência</label><input class="ag-in" type="month" id="cp-comp" value="' + esc(c.competencia || '') + '"></div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Categoria</label><select class="ag-in" id="cp-cat"><option value="">Sem categoria</option>' + Object.keys(grupos).map(function (g) { return '<optgroup label="' + esc(g) + '">' + opcoes(grupos[g], c.categoria_id) + '</optgroup>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="cp-tipo">' + opcoesTexto(CLASSIF, c.classificacao || 'Custo Fixo') + '</select></div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Fornecedor</label><select class="ag-in" id="cp-fornec">' + opcoes(fs, c.fornecedor_id, 'Nenhum') + '</select></div>' +
      '<div class="ag-f"><label>Pagar pela conta</label><select class="ag-in" id="cp-conta">' + opcoes(cs, c.conta_id, 'Definir no pagamento') + '</select></div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Forma de pagamento</label><select class="ag-in" id="cp-forma">' + opcoesTexto(FORMAS, c.forma_pagamento, 'Não informada') + '</select></div><div></div></div>' +
      (c.id ? '' : '<div class="ag-f"><label>Repetição</label><div class="ag-chips" id="cp-rep"><span class="ag-chip on" data-r="nao">Única</span><span class="ag-chip" data-r="parc">Parcelada</span><span class="ag-chip" data-r="rec">Recorrente</span></div></div>' +
        '<div class="ag-row c2" id="cp-rep-parc" style="display:none"><div class="ag-f"><label>Número de parcelas</label><input class="ag-in" type="number" min="2" max="60" id="cp-nparc" value="2"></div><div class="ag-hint" style="align-self:end">O valor é dividido entre as parcelas, uma por mês.</div></div>' +
        '<div class="ag-row c2" id="cp-rep-rec" style="display:none"><div class="ag-f"><label>Frequência</label><select class="ag-in" id="cp-freq"><option value="mensal">Mensal</option><option value="quinzenal">Quinzenal</option><option value="semanal">Semanal</option></select></div>' +
          '<div class="ag-f"><label>Quantas vezes</label><input class="ag-in" type="number" min="0" max="60" id="cp-vezes" value="12"><div class="ag-hint">0 = sem fim (gera o próximo mês automaticamente)</div></div></div>') +
      '<div class="ag-f"><label>Observações</label><textarea class="ag-in" id="cp-obs" rows="2" maxlength="1000">' + esc(c.observacoes || '') + '</textarea></div>',
      '<button class="btn" id="cp-c">Cancelar</button><button class="ag-btn-novo" id="cp-salvar">Salvar</button>', 680)
    var rep = 'nao'
    if (el('cp-rep')) el('cp-rep').querySelectorAll('[data-r]').forEach(function (s) {
      s.onclick = function () { rep = this.getAttribute('data-r'); el('cp-rep').querySelectorAll('[data-r]').forEach(function (x) { x.classList.toggle('on', x === s) }); el('cp-rep-parc').style.display = rep === 'parc' ? '' : 'none'; el('cp-rep-rec').style.display = rep === 'rec' ? '' : 'none' }
    })
    el('cp-cat').onchange = function () { var x = cats.filter(function (k) { return String(k.id) === el('cp-cat').value })[0]; if (x && CLASSIF.indexOf(x.classificacao) >= 0) el('cp-tipo').value = x.classificacao }
    el('cp-c').onclick = fechar
    el('cp-salvar').onclick = async function () {
      var btn = this; btn.disabled = true
      var r = await apiPost('fin-pagar', { id: c.id, descricao: el('cp-desc').value, valor: el('cp-valor').value, vencimento: el('cp-venc').value, competencia: el('cp-comp').value, categoria_id: el('cp-cat').value, classificacao: el('cp-tipo').value,
        fornecedor_id: el('cp-fornec').value, conta_id: el('cp-conta').value, forma_pagamento: el('cp-forma').value, observacoes: el('cp-obs').value,
        parcelas: rep === 'parc' ? el('cp-nparc').value : 1, recorrente: rep === 'rec', frequencia: rep === 'rec' ? el('cp-freq').value : null, vezes: rep === 'rec' ? el('cp-vezes').value : null })
      btn.disabled = false
      if (!r.success) return erro(r.error || 'Erro')
      fechar(); renderCPagar()
    }
  }

  async function pagarConta(c) {
    var cs = await contas()
    modal('Pagar conta', '<div id="fn-err"></div><div class="ag-hint" style="margin:0 0 12px">' + esc(c.descricao) + ' · vencimento ' + br(c.vencimento) + '</div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Data do pagamento</label><input class="ag-in" type="date" id="pg-data" value="' + hoje() + '"></div><div class="ag-f"><label>Valor pago (R$)</label><input class="ag-in" id="pg-valor" inputmode="decimal" value="' + String(c.valor).replace('.', ',') + '"></div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Conta</label><select class="ag-in" id="pg-conta">' + opcoes(cs, c.conta_id || FN.cache.caixa) + '</select></div><div class="ag-f"><label>Forma</label><select class="ag-in" id="pg-forma">' + opcoesTexto(FORMAS, c.forma_pagamento, 'Não informada') + '</select></div></div>',
      '<button class="btn" id="pg-c">Cancelar</button><button class="ag-btn-novo" id="pg-ok">Confirmar pagamento</button>', 560)
    el('pg-c').onclick = fechar
    el('pg-ok').onclick = async function () {
      var r = await apiPost('fin-pagar-baixa', { id: c.id, data: el('pg-data').value, valor: el('pg-valor').value, conta_id: el('pg-conta').value, forma_pagamento: el('pg-forma').value })
      if (!r.success) return erro(r.error || 'Erro')
      fechar(); renderCPagar()
    }
  }

  async function gerenciarFornecedores() {
    var fs = await fornecedores(true)
    modal('Fornecedores', '<div id="fn-err"></div>' + (fs.length ? '<table class="pc-tbl"><thead><tr><th>Nome</th><th class="hide-sm">CNPJ / CPF</th><th class="hide-sm">Contato</th><th></th></tr></thead><tbody>' +
      fs.map(function (f) { return '<tr><td>' + esc(f.nome) + '</td><td class="hide-sm">' + esc(f.documento || '—') + '</td><td class="hide-sm">' + esc([f.telefone, f.email].filter(Boolean).join(' · ') || '—') + '</td><td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-ed="' + f.id + '">Editar</button> <button class="btn btn-sm" data-rm="' + f.id + '" style="color:var(--red)">Remover</button></td></tr>' }).join('') + '</tbody></table>'
      : vazio('Nenhum fornecedor cadastrado.')), '<button class="btn" id="fo-f">Fechar</button><button class="ag-btn-novo" id="fo-novo">+ Novo fornecedor</button>', 760)
    el('fo-f').onclick = function () { fechar(); renderCPagar() }
    el('fo-novo').onclick = function () { editarFornecedor({}) }
    el('fn-m-b').querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { editarFornecedor(fs.filter(function (f) { return f.id === +b.getAttribute('data-ed') })[0]) } })
    el('fn-m-b').querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = async function () { if (!confirm('Remover este fornecedor? As contas já lançadas continuam com o nome dele.')) return; await apiPost('fin-fornecedores', { action: 'excluir', id: +b.getAttribute('data-rm') }); gerenciarFornecedores() } })
  }
  function editarFornecedor(f) {
    modal(f.id ? 'Editar fornecedor' : 'Novo fornecedor', '<div id="fn-err"></div><div class="ag-row c2"><div class="ag-f"><label>Nome</label><input class="ag-in" id="fo-nome" maxlength="120" value="' + esc(f.nome || '') + '"></div><div class="ag-f"><label>CNPJ / CPF</label><input class="ag-in" id="fo-doc" maxlength="20" value="' + esc(f.documento || '') + '"></div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Telefone</label><input class="ag-in" id="fo-tel" maxlength="20" value="' + esc(f.telefone || '') + '"></div><div class="ag-f"><label>E-mail</label><input class="ag-in" id="fo-email" maxlength="120" value="' + esc(f.email || '') + '"></div></div>' +
      '<div class="ag-f"><label>Observações</label><textarea class="ag-in" id="fo-obs" rows="2" maxlength="500">' + esc(f.observacoes || '') + '</textarea></div>',
      '<button class="btn" id="fo-v">Voltar</button><button class="ag-btn-novo" id="fo-ok">Salvar</button>', 620)
    el('fo-v').onclick = gerenciarFornecedores
    el('fo-ok').onclick = async function () {
      var r = await apiPost('fin-fornecedores', { id: f.id, nome: el('fo-nome').value, documento: el('fo-doc').value, telefone: el('fo-tel').value, email: el('fo-email').value, observacoes: el('fo-obs').value })
      if (!r.success) return erro(r.error || 'Erro')
      FN.cache.forn = null; gerenciarFornecedores()
    }
  }

  // ════════════════════════════════════════════════════════════════
  // CONTAS A RECEBER
  // ════════════════════════════════════════════════════════════════
  var SIT_R = { vencido: ['Vencido', 'err'], a_vencer: ['A vencer', 'pend'], pago: ['Pago', 'ok'] }
  async function renderCReceber() {
    var box = sub('contasreceber'); if (!box) return
    var F = FN.f.cr = FN.f.cr || { de: inicioMes(), ate: fimMes(), situacao: 'todos', q: '' }
    box.innerHTML = '<div class="fn-pg"><div class="fn-head"><div><div class="gpage-title">Contas a receber</div><div class="gpage-sub">Parcelas de tratamento e cobranças avulsas por vencimento.</div></div>' +
      '<div class="fn-acoes"><button class="btn" id="cr-exp">Exportar</button></div></div>' +
      '<div class="fn-filtros"><div class="ag-f"><label>Vencimento de</label><input class="ag-in" type="date" id="cr-de" value="' + F.de + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="cr-ate" value="' + F.ate + '"></div>' +
      '<div class="ag-f"><label>Situação</label><select class="ag-in" id="cr-sit">' + [['todos', 'Todas'], ['vencido', 'Vencidas'], ['a_vencer', 'A vencer'], ['pago', 'Pagas']].map(function (t) { return '<option value="' + t[0] + '"' + (F.situacao === t[0] ? ' selected' : '') + '>' + t[1] + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f" style="flex:2"><label>Buscar</label><input class="ag-in" id="cr-q" placeholder="Paciente ou descrição" value="' + esc(F.q) + '"></div>' +
      '<div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" id="cr-ok">Listar</button></div></div><div id="cr-res">' + carregando() + '</div></div>'
    el('cr-ok').onclick = function () { F.de = el('cr-de').value; F.ate = el('cr-ate').value; F.situacao = el('cr-sit').value; F.q = el('cr-q').value; renderCReceber() }
    el('cr-q').onkeydown = function (e) { if (e.key === 'Enter') el('cr-ok').click() }
    var d = await apiData('fin-receber', F).catch(function (e) { return { success: false, error: e.message } })
    var res = el('cr-res'); if (!res) return
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    el('cr-exp').onclick = function () { csv('contas-a-receber', [['Vencimento', 'Situação', 'Paciente', 'Descrição', 'Forma', 'Pagamento', 'Valor']].concat(d.itens.map(function (i) { return [br(i.vencimento), SIT_R[i.situacao][0], i.paciente_nome || '', i.descricao, i.forma, br(i.pagamento), i.valor.toFixed(2).replace('.', ',')] }))) }
    var t = d.totais, total = t.vencido + t.a_vencer + t.pago
    res.innerHTML = '<div class="fn-kpis">' + kpi('Vencido', t.vencido, null, 'err') + kpi('A vencer', t.a_vencer) + kpi('Recebido', t.pago, null, 'ok') + kpi('Total do período', total) + '</div>' +
      (d.itens.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Situação</th><th>Vencimento</th><th>Paciente</th><th class="hide-sm">Descrição</th><th class="hide-sm">Forma</th><th style="text-align:right">Valor</th><th></th></tr></thead><tbody>' +
        d.itens.map(function (i) {
          var s = SIT_R[i.situacao]
          return '<tr><td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span>' + (i.pagamento ? '<div class="ag-hint" style="margin:2px 0 0">em ' + br(i.pagamento) + '</div>' : '') + '</td><td>' + br(i.vencimento) + '</td><td>' + linkPac(i.paciente_id, i.paciente_nome) + '</td>' +
            '<td class="hide-sm">' + esc(i.descricao) + '</td><td class="hide-sm">' + esc(i.forma) + '</td><td class="fn-num">' + moeda(i.valor) + '</td><td style="text-align:right;white-space:nowrap">' +
            (i.situacao !== 'pago' ? ((i.origem === 'parcela' || i.origem === 'avulso') && pode('financeiro.dar_baixa') ? '<button class="btn btn-sm btn-primary" data-rec="' + i.id + '" data-org="' + i.origem + '">Receber</button>' : i.origem === 'cobranca' ? '<span class="ag-hint" style="margin:0">via Asaas</span>' : '') : '') + '</td></tr>'
        }).join('') + '</tbody><tfoot><tr><td colspan="5"><b>Total</b></td><td class="fn-num"><b>' + moeda(total) + '</b></td><td></td></tr></tfoot></table></div></div>' : vazio('Nada a receber no período.'))
    ligarPacientes(res)
    res.querySelectorAll('[data-rec]').forEach(function (b) { b.onclick = function () { receberParcela(d.itens.filter(function (i) { return i.origem === b.getAttribute('data-org') && i.id === +b.getAttribute('data-rec') })[0]) } })
  }
  async function receberParcela(i) {
    var cs = await contas()
    modal('Receber parcela', '<div id="fn-err"></div><div class="ag-hint" style="margin:0 0 12px">' + esc(i.paciente_nome || '') + ' · ' + esc(i.descricao) + ' · ' + moeda(i.valor) + '</div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="rc-data" value="' + hoje() + '"></div><div class="ag-f"><label>Forma</label><select class="ag-in" id="rc-forma">' + opcoesTexto(FORMAS, 'PIX') + '</select></div>' +
      '<div class="ag-f"><label>Conta</label><select class="ag-in" id="rc-conta">' + opcoes(cs, FN.cache.caixa) + '</select></div></div>' +
      (i.origem === 'parcela' ? '<div id="rc-enc"></div>' : '') + '<div id="rc-det"></div>' +
      (i.cobranca_id ? '<p class="ag-hint">Esta parcela tem cobrança no Asaas. Se o paciente pagou por fora, lembre de cancelar a cobrança no Asaas.</p>' : ''),
      '<button class="btn" id="rc-c">Cancelar</button><button class="ag-btn-novo" id="rc-ok">Confirmar recebimento</button>', 640)
    el('rc-forma').onchange = function () { el('rc-det').innerHTML = camposRecebivel(this.value, i.paciente_nome) }
    if (i.origem === 'parcela' && window.encargosBaixa) { encargosBaixa(i.id, 'rc-data', 'rc-enc'); el('rc-data').onchange = function () { encargosBaixa(i.id, 'rc-data', 'rc-enc') } }
    el('rc-c').onclick = fechar
    el('rc-ok').onclick = async function () {
      var r = await apiPost('fin-receber-baixa', { id: i.id, origem: i.origem, acrescimo: el('enc-acr') ? el('enc-acr').value : 0, desconto: el('enc-desc') ? el('enc-desc').value : 0, data: el('rc-data').value, forma_pagamento: el('rc-forma').value, conta_id: el('rc-conta').value, detalhe: lerRecebivel(el('rc-forma').value) })
      if (!r.success) return erro(r.error || 'Erro')
      fechar(); renderCReceber()
    }
  }

  // Campos extras quando o pagamento é em cheque ou cartão (geram o controle de recebíveis)
  function camposRecebivel(forma, titular) {
    if (forma === 'Cheque') return '<div class="pc-box-h" style="margin-top:8px">Dados do cheque</div><div class="ag-row c3"><div class="ag-f"><label>Número</label><input class="ag-in" id="rv-num" maxlength="30"></div><div class="ag-f"><label>Banco</label><input class="ag-in" id="rv-banco" maxlength="60"></div><div class="ag-f"><label>Agência</label><input class="ag-in" id="rv-ag" maxlength="20"></div></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Emitente</label><input class="ag-in" id="rv-tit" maxlength="120" value="' + esc(titular || '') + '"></div><div class="ag-f"><label>CPF/CNPJ</label><input class="ag-in" id="rv-cpf" maxlength="20"></div><div class="ag-f"><label>Bom para</label><input class="ag-in" type="date" id="rv-bom" value="' + hoje() + '"></div></div>'
    if (forma === 'Cartão de crédito' || forma === 'Cartão de débito') {
      var cred = forma === 'Cartão de crédito'
      return '<div class="pc-box-h" style="margin-top:8px">Dados do cartão</div><div class="ag-row c' + (cred ? 4 : 3) + '"><div class="ag-f"><label>Bandeira</label><select class="ag-in" id="rv-band">' + opcoesTexto(['Visa', 'Mastercard', 'Elo', 'Hipercard', 'American Express', 'Outra'], 'Visa') + '</select></div>' +
        '<div class="ag-f"><label>4 últimos dígitos</label><input class="ag-in" id="rv-4" maxlength="4" inputmode="numeric"></div><div class="ag-f"><label>Autorização</label><input class="ag-in" id="rv-aut" maxlength="30"></div>' +
        (cred ? '<div class="ag-f"><label>Parcelas</label><input class="ag-in" type="number" min="1" max="24" id="rv-parc" value="1"></div>' : '') + '</div><p class="ag-hint">A taxa e a previsão de recebimento seguem o que está em Configurações › Taxas e encargos.</p>'
    }
    return ''
  }
  function lerRecebivel(forma) {
    function v(id) { var e = el(id); return e ? e.value : '' }
    if (forma === 'Cheque') return { tipo: 'cheque', numero: v('rv-num'), banco: v('rv-banco'), agencia: v('rv-ag'), titular: v('rv-tit'), cpf: v('rv-cpf'), bom_para: v('rv-bom') }
    if (forma === 'Cartão de crédito' || forma === 'Cartão de débito') return { tipo: 'cartao', cartao_tipo: forma === 'Cartão de débito' ? 'debito' : 'credito', bandeira: v('rv-band'), ultimos4: v('rv-4'), autorizacao: v('rv-aut'), parcelas: v('rv-parc') || 1 }
    return null
  }

  // ════════════════════════════════════════════════════════════════
  // EXTRATO (por conta, com saldo dia a dia)
  // ════════════════════════════════════════════════════════════════
  async function renderExtrato() {
    var box = sub('extrato'); if (!box) return
    var F = FN.f.ex = FN.f.ex || { de: inicioMes(), ate: hoje(), conta_id: '', q: '' }
    var cs = await contas()
    box.innerHTML = '<div class="fn-pg"><div class="fn-head"><div><div class="gpage-title">Extrato</div><div class="gpage-sub">Saldo inicial, movimentos e saldo de cada dia.</div></div><div class="fn-acoes"><button class="btn" id="ex-exp">Exportar</button></div></div>' +
      '<div class="fn-filtros"><div class="ag-f"><label>De</label><input class="ag-in" type="date" id="ex-de" value="' + F.de + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="ex-ate" value="' + F.ate + '"></div>' +
      '<div class="ag-f"><label>Conta</label><select class="ag-in" id="ex-conta">' + opcoes(cs, F.conta_id, 'Todas as contas') + '</select></div>' +
      '<div class="ag-f" style="flex:2"><label>Buscar</label><input class="ag-in" id="ex-q" value="' + esc(F.q) + '" placeholder="Descrição ou paciente"></div>' +
      '<div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" id="ex-ok">Listar</button></div></div><div id="ex-res">' + carregando() + '</div></div>'
    el('ex-ok').onclick = function () { F.de = el('ex-de').value; F.ate = el('ex-ate').value; F.conta_id = el('ex-conta').value; F.q = el('ex-q').value; renderExtrato() }
    var d = await apiData('fin-movimentos', { de: F.de, ate: F.ate, conta_id: F.conta_id, q: F.q, extrato: 1 }).catch(function (e) { return { success: false, error: e.message } })
    var res = el('ex-res'); if (!res) return
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    FN.ex = d
    var mv = d.movimentos.filter(function (m) { return m.tipo === 'entrada' || m.tipo === 'saida' }).sort(function (a, b) { return (a.data + a.hora).localeCompare(b.data + b.hora) })
    var saldo = d.saldo_inicial, linhas = [], diaAtual = null
    mv.forEach(function (m) {
      if (m.data !== diaAtual) { if (diaAtual) linhas.push('<tr class="fn-ex-saldo"><td colspan="4">Saldo do dia</td><td class="fn-num">' + moeda(saldo) + '</td></tr>'); diaAtual = m.data; linhas.push('<tr class="fn-ex-dia"><td colspan="5">' + br(m.data) + ' · ' + diaSemana(m.data) + '</td></tr>') }
      saldo += m.tipo === 'entrada' ? m.valor : -m.valor
      linhas.push('<tr><td><span class="pc-badge ' + TIPO_COR[m.tipo] + '">' + TIPO_NOME[m.tipo] + '</span></td><td>' + esc(m.descricao || '') + (m.paciente_nome ? ' · ' + linkPac(m.paciente_id, m.paciente_nome) : '') + '</td><td class="hide-sm">' + esc(m.forma || '') + '</td><td class="hide-sm">' + esc(m.hora || '') + '</td>' +
        '<td class="fn-num ' + (m.tipo === 'saida' ? 'err' : 'ok') + '">' + (m.tipo === 'saida' ? '- ' : '') + moeda(m.valor) + '</td></tr>')
    })
    if (diaAtual) linhas.push('<tr class="fn-ex-saldo"><td colspan="4">Saldo do dia</td><td class="fn-num">' + moeda(saldo) + '</td></tr>')
    el('ex-exp').onclick = function () { var s = d.saldo_inicial; csv('extrato', [['Data', 'Hora', 'Tipo', 'Descrição', 'Paciente', 'Forma', 'Valor', 'Saldo']].concat(mv.map(function (m) { s += m.tipo === 'entrada' ? m.valor : -m.valor; return [br(m.data), m.hora, TIPO_NOME[m.tipo], m.descricao, m.paciente_nome || '', m.forma, (m.tipo === 'saida' ? '-' : '') + m.valor.toFixed(2).replace('.', ','), s.toFixed(2).replace('.', ',')] }))) }
    res.innerHTML = '<div class="fn-kpis">' + kpi('Saldo inicial', d.saldo_inicial, 'em ' + br(d.de)) + kpi('Entradas', d.kpis.entradas, null, 'ok') + kpi('Saídas', d.kpis.saidas, null, 'err') + kpi('Saldo final', saldo, 'em ' + br(d.ate)) + '</div>' +
      (mv.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl fn-ex"><tbody>' + linhas.join('') + '</tbody></table></div></div>' : vazio('Nenhum movimento no período.')) +
      (F.q ? '<p class="ag-hint">Com busca ativa, o saldo do dia considera só os movimentos encontrados.</p>' : '')
    ligarPacientes(res)
  }

  // Utilitários compartilhados com public/financeiro-controles.js
  window.KFIN = { modal: modal, fechar: fechar, erro: erro, esc: esc, moeda: moeda, br: br, hoje: hoje, inicioMes: inicioMes, fimMes: fimMes, diaSemana: diaSemana, contas: contas, categorias: categorias,
    opcoes: opcoes, opcoesTexto: opcoesTexto, sub: sub, linkPac: linkPac, ligarPacientes: ligarPacientes, csv: csv, kpi: kpi, vazio: vazio, carregando: carregando, pode: pode, isAdmin: isAdmin,
    camposRecebivel: camposRecebivel, lerRecebivel: lerRecebivel, gerenciarContas: gerenciarContas, FORMAS: FORMAS, cache: FN.cache }
  window.renderCC = renderCC
  window.renderFDC = renderFDC
  window.renderCPagar = renderCPagar
  window.renderCReceber = renderCReceber
  window.renderExtrato = renderExtrato
})()
