// public/financeiro-controles.js — Financeiro, parte 2 (Fase 6)
// Klinov — Campo Grande, MS
//
// Substitui as abas Controle de Boletos, Cheques, Cartões, Planos e Conciliações
// do app.html (renderBoletos, renderCheques, renderCartoes, renderPlanos,
// loadConciliacoes) e abre, em Configurações, "Taxas e encargos" e "Régua de
// cobrança". Usa os utilitários de public/financeiro.js (window.KFIN).
;(function () {
  'use strict'
  var K = window.KFIN
  if (!K) return
  var esc = K.esc, moeda = K.moeda, br = K.br, F = {}

  function el(id) { return document.getElementById(id) }
  function sel(opts, v) { return opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>' }).join('') }
  function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function cab(titulo, sub, acoes) { return '<div class="fn-head"><div><div class="gpage-title">' + titulo + '</div><div class="gpage-sub">' + sub + '</div></div><div class="fn-acoes">' + (acoes || '') + '</div></div>' }
  function filtroData(pref, f, rot) { return '<div class="ag-f"><label>' + (rot || 'Vencimento de') + '</label><input class="ag-in" type="date" id="' + pref + '-de" value="' + f.de + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="' + pref + '-ate" value="' + f.ate + '"></div>' }
  function btnListar(pref) { return '<div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" id="' + pref + '-ok">Listar</button></div>' }
  function falha(box, d) { box.innerHTML = '<div class="ag-err">' + esc((d && d.error) || 'Erro ao carregar') + '</div>' }
  function marcados(box) { return Array.prototype.map.call(box.querySelectorAll('[data-chk]:checked'), function (x) { return +x.getAttribute('data-chk') }) }
  function ligarTodos(box) { var t = box.querySelector('[data-todos]'); if (t) t.onchange = function () { box.querySelectorAll('[data-chk]').forEach(function (c) { if (!c.disabled) c.checked = t.checked }) } }
  var SIT = { pendente: ['Em aberto', 'pend'], recebido: ['Compensado', 'ok'], devolvido: ['Devolvido', 'err'] }

  // ════════════════════════════════════════════════════════════════
  // BOLETOS (cobranças Asaas)
  // ════════════════════════════════════════════════════════════════
  var SIT_B = { aberto: ['Em aberto', 'pend'], vencido: ['Vencido', 'err'], pago: ['Pago', 'ok'], cancelado: ['Cancelado', 'off'] }
  async function renderBoletos() {
    var box = K.sub('boletos'); if (!box) return
    var f = F.bol = F.bol || { de: K.inicioMes(), ate: K.fimMes(), status: 'todos', forma: 'boleto' }
    box.innerHTML = '<div class="fn-pg">' + cab('Controle de boletos', 'Cobranças geradas pelo Asaas, por vencimento. A baixa acontece sozinha quando o Asaas confirma o pagamento.', '<button class="btn" id="bo-sync">Sincronizar Asaas</button>') +
      '<div class="fn-filtros">' + filtroData('bo', f) + '<div class="ag-f"><label>Forma</label><select class="ag-in" id="bo-forma">' + sel([['boleto', 'Boleto'], ['pix', 'PIX'], ['credito', 'Cartão (link)'], ['todas', 'Todas']], f.forma) + '</select></div>' +
      '<div class="ag-f"><label>Situação</label><select class="ag-in" id="bo-st">' + sel([['todos', 'Todas'], ['aberto', 'Em aberto'], ['pago', 'Pagas']], f.status) + '</select></div>' + btnListar('bo') + '</div><div id="bo-res">' + K.carregando() + '</div></div>'
    el('bo-ok').onclick = function () { f.de = el('bo-de').value; f.ate = el('bo-ate').value; f.forma = el('bo-forma').value; f.status = el('bo-st').value; renderBoletos() }
    el('bo-sync').onclick = async function () { this.disabled = true; try { await apiData('sincronizar-cobrancas', {}) } catch (e) {} renderBoletos() }
    var d = await apiData('fin-boletos', f).catch(function (e) { return { success: false, error: e.message } })
    var res = el('bo-res'); if (!res) return
    if (!d.success) return falha(res, d)
    res.innerHTML = '<div class="fn-kpis">' + K.kpi('Em aberto', d.totais.aberto) + K.kpi('Vencido', d.totais.vencido, null, 'err') + K.kpi('Pago', d.totais.pago, null, 'ok') + K.kpi('Total', d.totais.aberto + d.totais.vencido + d.totais.pago) + '</div>' +
      (d.itens.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Situação</th><th>Vencimento</th><th>Pagamento</th><th>Paciente</th><th class="hide-sm">Descrição</th><th style="text-align:right">Valor</th><th></th></tr></thead><tbody>' +
        d.itens.map(function (c) {
          var s = SIT_B[c.situacao] || SIT_B.aberto
          return '<tr><td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span></td><td>' + br(c.vencimento) + '</td><td>' + (br(c.pagamento) || '—') + '</td><td>' + K.linkPac(c.paciente_id, c.paciente_nome) + '</td><td class="hide-sm">' + esc(c.descricao || '') + '</td>' +
            '<td class="fn-num">' + moeda(c.valor) + '</td><td style="text-align:right;white-space:nowrap">' + (c.link ? '<a class="btn btn-sm" href="' + esc(c.link) + '" target="_blank" rel="noopener">Abrir</a>' : '') + (c.codigo ? ' <button class="btn btn-sm" data-cod="' + esc(c.codigo) + '">Copiar linha</button>' : '') + '</td></tr>'
        }).join('') + '</tbody></table></div></div>' : K.vazio('Nenhuma cobrança no período.'))
    K.ligarPacientes(res)
    res.querySelectorAll('[data-cod]').forEach(function (b) { b.onclick = function () { navigator.clipboard && navigator.clipboard.writeText(this.getAttribute('data-cod')); this.textContent = 'Copiado' } })
  }

  // ════════════════════════════════════════════════════════════════
  // CHEQUES e CARTÕES
  // ════════════════════════════════════════════════════════════════
  async function renderRecebiveis(tipo) {
    var id = tipo === 'cheque' ? 'cheques' : 'cartoes', pref = tipo === 'cheque' ? 'ch' : 'ca'
    var box = K.sub(id); if (!box) return
    var f = F[pref] = F[pref] || { de: K.inicioMes(), ate: addDias(K.hoje(), 60), status: 'aberto', cartao_tipo: '' }
    box.innerHTML = '<div class="fn-pg">' + cab(tipo === 'cheque' ? 'Controle de cheques' : 'Controle de cartões', tipo === 'cheque' ? 'Cheques recebidos por data de compensação (bom para).' : 'Vendas no cartão por previsão de recebimento, com a taxa da maquininha.',
        '<button class="btn" id="' + pref + '-exp">Exportar</button>' + (K.pode('financeiro.dar_baixa') ? '<button class="ag-btn-novo" id="' + pref + '-novo">+ ' + (tipo === 'cheque' ? 'Novo cheque' : 'Nova venda no cartão') + '</button>' : '')) +
      '<div class="fn-filtros">' + filtroData(pref, f, tipo === 'cheque' ? 'Bom para de' : 'Previsão de') +
      (tipo === 'cartao' ? '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="' + pref + '-ct">' + sel([['', 'Crédito e débito'], ['credito', 'Crédito'], ['debito', 'Débito']], f.cartao_tipo) + '</select></div>' : '') +
      '<div class="ag-f"><label>Situação</label><select class="ag-in" id="' + pref + '-st">' + sel([['aberto', 'Em aberto'], ['recebido', 'Compensados'], ['devolvido', 'Devolvidos'], ['todos', 'Todos']].filter(function (o) { return tipo === 'cheque' || o[0] !== 'devolvido' }), f.status) + '</select></div>' + btnListar(pref) + '</div>' +
      '<div id="' + pref + '-res">' + K.carregando() + '</div></div>'
    el(pref + '-ok').onclick = function () { f.de = el(pref + '-de').value; f.ate = el(pref + '-ate').value; f.status = el(pref + '-st').value; if (el(pref + '-ct')) f.cartao_tipo = el(pref + '-ct').value; renderRecebiveis(tipo) }
    if (el(pref + '-novo')) el(pref + '-novo').onclick = function () { novoRecebivel(tipo) }
    var d = await apiData('fin-recebiveis', { tipo: tipo, de: f.de, ate: f.ate, status: f.status, cartao_tipo: f.cartao_tipo }).catch(function (e) { return { success: false, error: e.message } })
    var res = el(pref + '-res'); if (!res) return
    if (!d.success) return falha(res, d)
    el(pref + '-exp').onclick = function () {
      K.csv(id, [tipo === 'cheque' ? ['Bom para', 'Compensado em', 'Banco', 'Número', 'Emitente', 'Paciente', 'Valor', 'Situação'] : ['Previsão', 'Venda', 'Recebido em', 'Tipo', 'Bandeira', 'Final', 'Autorização', 'Parcela', 'Titular', 'Valor', 'Taxa', 'Líquido', 'Situação']].concat(d.itens.map(function (x) {
        return tipo === 'cheque' ? [br(x.vencimento), br(x.recebido_em), x.banco || '', x.numero || '', x.titular || '', x.paciente_nome || '', x.valor, SIT[x.status][0]]
          : [br(x.vencimento), br(x.data_venda), br(x.recebido_em), x.cartao_tipo === 'debito' ? 'Débito' : 'Crédito', x.bandeira || '', x.ultimos4 || '', x.autorizacao || '', x.parcela + '/' + x.total_parcelas, x.titular || '', x.valor, x.taxa, x.valor_final, SIT[x.status][0]]
      })))
    }
    var t = d.totais
    res.innerHTML = '<div class="fn-kpis">' + K.kpi('Em aberto', t.aberto) + K.kpi('Compensado', t.recebido, null, 'ok') + (tipo === 'cheque' ? K.kpi('Devolvido', t.devolvido, null, 'err') : K.kpi('Taxas', t.taxas, 'Descontadas pela operadora', 'err')) + '<div class="pc-box fn-kpi"><div class="pc-box-h" style="margin-bottom:8px">Itens</div><div class="fn-kpi-v">' + d.itens.length + '</div></div></div>' +
      (d.itens.length ? '<div class="fn-acoes" style="margin-bottom:8px"><button class="btn btn-sm btn-primary" id="' + pref + '-conf">Confirmar selecionados</button></div><div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th><input type="checkbox" data-todos="1"></th><th>Situação</th><th>' + (tipo === 'cheque' ? 'Bom para' : 'Previsão') + '</th>' +
        (tipo === 'cheque' ? '<th>Banco / nº</th><th class="hide-sm">Emitente</th>' : '<th>Cartão</th><th class="hide-sm">Titular / autorização</th>') + '<th class="hide-sm">Paciente</th><th style="text-align:right">Valor</th>' + (tipo === 'cartao' ? '<th style="text-align:right" class="hide-sm">Taxa</th><th style="text-align:right">Líquido</th>' : '') + '<th></th></tr></thead><tbody>' +
        d.itens.map(function (x) {
          var s = SIT[x.status] || SIT.pendente
          return '<tr><td><input type="checkbox" data-chk="' + x.id + '"' + (x.status !== 'pendente' ? ' disabled' : '') + '></td><td><span class="pc-badge ' + (x.vencido ? 'err' : s[1]) + '">' + (x.vencido ? 'Atrasado' : s[0]) + '</span>' + (x.recebido_em ? '<div class="ag-hint" style="margin:2px 0 0">em ' + br(x.recebido_em) + '</div>' : '') + '</td><td>' + br(x.vencimento) + '</td>' +
            (tipo === 'cheque' ? '<td>' + esc([x.banco, x.numero ? 'nº ' + x.numero : ''].filter(Boolean).join(' · ') || '—') + '</td><td class="hide-sm">' + esc(x.titular || '—') + '</td>'
              : '<td>' + (x.cartao_tipo === 'debito' ? 'Débito' : 'Crédito') + ' ' + esc(x.bandeira || '') + (x.ultimos4 ? ' ···' + esc(x.ultimos4) : '') + (x.total_parcelas > 1 ? '<div class="ag-hint" style="margin:0">parcela ' + x.parcela + '/' + x.total_parcelas + ' · venda ' + br(x.data_venda) + '</div>' : '') + '</td><td class="hide-sm">' + esc(x.titular || '—') + (x.autorizacao ? '<div class="ag-hint" style="margin:0">aut. ' + esc(x.autorizacao) + '</div>' : '') + '</td>') +
            '<td class="hide-sm">' + K.linkPac(x.paciente_id, x.paciente_nome) + '</td><td class="fn-num">' + moeda(x.valor) + '</td>' + (tipo === 'cartao' ? '<td class="fn-num hide-sm">' + moeda(x.taxa) + '</td><td class="fn-num">' + moeda(x.valor_final) + '</td>' : '') +
            '<td style="text-align:right;white-space:nowrap">' + acoesRecebivel(x) + '</td></tr>'
        }).join('') + '</tbody></table></div></div>' : K.vazio('Nada no período.'))
    K.ligarPacientes(res); ligarTodos(res)
    if (el(pref + '-conf')) el(pref + '-conf').onclick = function () { var ids = marcados(res); if (!ids.length) return alert('Marque os itens compensados.'); confirmar(ids, tipo) }
    res.querySelectorAll('[data-rv]').forEach(function (b) {
      b.onclick = async function () {
        var idr = +b.getAttribute('data-id'), ac = b.getAttribute('data-rv')
        if (ac === 'confirmar') return confirmar([idr], tipo)
        if (ac === 'devolvido') { var mot = prompt('Motivo da devolução (ex.: sem fundos):', 'Sem fundos'); if (mot === null) return; var r = await apiPost('fin-recebiveis', { action: 'devolvido', id: idr, motivo: mot }); if (!r.success) return alert(r.error); return renderRecebiveis(tipo) }
        if (ac === 'desfazer') { if (!confirm('Desfazer? O item volta para "em aberto"' + (tipo === 'cartao' ? ' e a taxa lançada é removida.' : '.'))) return; var x = await apiPost('fin-recebiveis', { action: 'desfazer', id: idr }); if (!x.success) return alert(x.error); return renderRecebiveis(tipo) }
        if (ac === 'excluir') { if (!confirm('Excluir este lançamento manual?')) return; var y = await apiPost('fin-recebiveis', { action: 'excluir', id: idr }); if (!y.success) return alert(y.error); return renderRecebiveis(tipo) }
      }
    })
  }
  function acoesRecebivel(x) {
    if (!K.pode('financeiro.dar_baixa')) return ''
    if (x.status === 'pendente') return '<button class="btn btn-sm btn-primary" data-rv="confirmar" data-id="' + x.id + '">Confirmar</button>' + (x.tipo === 'cheque' ? ' <button class="btn btn-sm" data-rv="devolvido" data-id="' + x.id + '">Devolvido</button>' : '') + (x.origem === 'manual' ? ' <button class="btn btn-sm" data-rv="excluir" data-id="' + x.id + '" style="color:var(--red)">Excluir</button>' : '')
    return '<button class="btn btn-sm" data-rv="desfazer" data-id="' + x.id + '">Desfazer</button>'
  }
  async function confirmar(ids, tipo) {
    var cs = await K.contas()
    K.modal('Confirmar ' + (tipo === 'cheque' ? 'compensação' : 'recebimento'), '<div id="fn-err"></div><p class="ag-hint" style="margin:0 0 12px">' + ids.length + ' item(ns).' + (tipo === 'cartao' ? ' A taxa de cada parcela é lançada como despesa (custo variável) na data informada.' : '') + '</p>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="cf-data" value="' + K.hoje() + '"></div><div class="ag-f"><label>Conta que recebeu</label><select class="ag-in" id="cf-conta">' + K.opcoes(cs, '', 'A mesma do recebimento') + '</select></div></div>',
      '<button class="btn" id="cf-c">Cancelar</button><button class="ag-btn-novo" id="cf-ok">Confirmar</button>', 520)
    el('cf-c').onclick = K.fechar
    el('cf-ok').onclick = async function () {
      var r = await apiPost('fin-recebiveis', { action: 'confirmar', ids: ids, data: el('cf-data').value, conta_id: el('cf-conta').value })
      if (!r.success) return K.erro(r.error || 'Erro')
      K.fechar(); renderRecebiveis(tipo)
    }
  }
  async function novoRecebivel(tipo) {
    var cs = await K.contas()
    var formas = tipo === 'cheque' ? ['Cheque'] : ['Cartão de crédito', 'Cartão de débito']
    K.modal(tipo === 'cheque' ? 'Novo cheque' : 'Nova venda no cartão', '<div id="fn-err"></div><p class="ag-hint" style="margin:0 0 12px">Use para registrar o que não entrou pela baixa de uma parcela. Para receber uma parcela de tratamento, use Contas a receber.</p>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="nr-data" value="' + K.hoje() + '"></div><div class="ag-f"><label>Valor (R$)</label><input class="ag-in" id="nr-valor" inputmode="decimal"></div>' +
      '<div class="ag-f"><label>Conta</label><select class="ag-in" id="nr-conta">' + K.opcoes(cs, K.cache.caixa) + '</select></div></div>' +
      (formas.length > 1 ? '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="nr-forma">' + K.opcoesTexto(formas, formas[0]) + '</select></div>' : '') +
      '<div class="ag-f"><label>Paciente / pagador</label><input class="ag-in" id="nr-pac" maxlength="120"></div><div id="nr-det">' + K.camposRecebivel(formas[0], '') + '</div>',
      '<button class="btn" id="nr-c">Cancelar</button><button class="ag-btn-novo" id="nr-ok">Salvar</button>', 660)
    var forma = formas[0]
    if (el('nr-forma')) el('nr-forma').onchange = function () { forma = this.value; el('nr-det').innerHTML = K.camposRecebivel(forma, '') }
    el('nr-c').onclick = K.fechar
    el('nr-ok').onclick = async function () {
      var r = await apiPost('fin-recebiveis', { action: 'novo', data: el('nr-data').value, valor: el('nr-valor').value, conta_id: el('nr-conta').value, paciente_nome: el('nr-pac').value, detalhe: K.lerRecebivel(forma) })
      if (!r.success) return K.erro(r.error || 'Erro')
      K.fechar(); renderRecebiveis(tipo)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // CONVÊNIOS (repasse dos procedimentos executados)
  // ════════════════════════════════════════════════════════════════
  var SIT_C = { a_faturar: ['A faturar', 'pend'], faturado: ['Faturado', 'info'], recebido: ['Recebido', 'ok'], glosado: ['Glosado', 'err'] }
  async function renderPlanos() {
    var box = K.sub('planos'); if (!box) return
    var f = F.pl = F.pl || { de: addDias(K.hoje(), -90), ate: K.hoje(), status: 'todos', convenio: '', guia: '' }
    box.innerHTML = '<div class="fn-pg">' + cab('Controle de planos', 'Procedimentos executados cobertos por convênio: guia, faturamento, repasse recebido e glosas.', '<button class="btn" id="pl-exp">Exportar</button>') +
      '<div class="fn-filtros">' + filtroData('pl', f, 'Execução de') + '<div class="ag-f"><label>Convênio</label><select class="ag-in" id="pl-conv"><option value="">Todos</option></select></div>' +
      '<div class="ag-f"><label>Situação</label><select class="ag-in" id="pl-st">' + sel([['todos', 'Todas'], ['a_faturar', 'A faturar'], ['faturado', 'Faturadas'], ['recebido', 'Recebidas'], ['glosado', 'Glosadas']], f.status) + '</select></div>' +
      '<div class="ag-f"><label>Guia</label><input class="ag-in" id="pl-guia" value="' + esc(f.guia) + '"></div>' + btnListar('pl') + '</div><div id="pl-res">' + K.carregando() + '</div></div>'
    el('pl-ok').onclick = function () { f.de = el('pl-de').value; f.ate = el('pl-ate').value; f.status = el('pl-st').value; f.convenio = el('pl-conv').value; f.guia = el('pl-guia').value; renderPlanos() }
    var d = await apiData('fin-convenios', f).catch(function (e) { return { success: false, error: e.message } })
    var res = el('pl-res'); if (!res) return
    if (!d.success) return falha(res, d)
    el('pl-conv').innerHTML = '<option value="">Todos</option>' + d.convenios.map(function (c) { return '<option' + (c === f.convenio ? ' selected' : '') + '>' + esc(c) + '</option>' }).join('')
    el('pl-exp').onclick = function () { K.csv('convenios', [['Execução', 'Paciente', 'Convênio', 'Guia', 'Procedimento', 'Dente', 'Qtd', 'Valor', 'Situação', 'Recebido em', 'Valor recebido', 'Obs']].concat(d.itens.map(function (x) { return [br(x.data_execucao), x.paciente_nome || '', x.convenio || '', x.guia || '', x.procedimento_nome, x.dente || '', x.quantidade, x.valor, SIT_C[x.convenio_status][0], br(x.convenio_recebido_em), x.convenio_valor_recebido || '', x.convenio_obs || ''] }))) }
    var t = d.totais
    res.innerHTML = '<div class="fn-kpis">' + K.kpi('A faturar', t.a_faturar) + K.kpi('Faturado', t.faturado) + K.kpi('Recebido', t.recebido, null, 'ok') + K.kpi('Glosado', t.glosado, null, 'err') + '</div>' +
      (d.itens.length ? (K.pode('financeiro.dar_baixa') ? '<div class="fn-acoes" style="margin-bottom:8px"><button class="btn btn-sm" data-lote="faturar">Faturar selecionados</button><button class="btn btn-sm btn-primary" data-lote="receber">Receber repasse</button><button class="btn btn-sm" data-lote="glosar">Glosar</button><button class="btn btn-sm" data-lote="reabrir">Reabrir</button></div>' : '') +
        '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th><input type="checkbox" data-todos="1"></th><th>Situação</th><th>Execução</th><th>Paciente</th><th class="hide-sm">Convênio</th><th>Guia</th><th>Procedimento</th><th style="text-align:right">Valor</th></tr></thead><tbody>' +
        d.itens.map(function (x) {
          var s = SIT_C[x.convenio_status] || SIT_C.a_faturar
          return '<tr><td><input type="checkbox" data-chk="' + x.id + '"' + (x.convenio_status === 'recebido' ? ' disabled' : '') + '></td><td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span>' + (x.convenio_obs ? '<div class="ag-hint" style="margin:2px 0 0">' + esc(x.convenio_obs) + '</div>' : '') + '</td>' +
            '<td>' + br(x.data_execucao) + '</td><td>' + K.linkPac(x.paciente_id, x.paciente_nome) + '</td><td class="hide-sm">' + esc(x.convenio || '') + '</td>' +
            '<td><a class="fn-pac" data-guia="' + x.id + '">' + esc(x.guia || 'informar') + '</a></td><td>' + esc(x.procedimento_nome) + (x.dente ? ' · ' + esc(x.dente) : '') + (x.quantidade > 1 ? ' · ' + x.quantidade + 'x' : '') + '</td>' +
            '<td class="fn-num">' + moeda(x.convenio_status === 'recebido' ? x.convenio_valor_recebido : x.valor) + (x.convenio_status === 'recebido' && Number(x.convenio_valor_recebido) !== x.valor ? '<div class="ag-hint" style="margin:0">de ' + moeda(x.valor) + '</div>' : '') + '</td></tr>'
        }).join('') + '</tbody></table></div></div>' : K.vazio('Nenhum procedimento de convênio executado no período.'))
    K.ligarPacientes(res); ligarTodos(res)
    res.querySelectorAll('[data-guia]').forEach(function (a) {
      a.onclick = async function () { var g = prompt('Número da guia:', this.textContent === 'informar' ? '' : this.textContent); if (g === null) return; var r = await apiPost('fin-convenios', { action: 'guia', id: +this.getAttribute('data-guia'), guia: g }); if (!r.success) return alert(r.error); renderPlanos() }
    })
    res.querySelectorAll('[data-lote]').forEach(function (b) {
      b.onclick = async function () {
        var ids = marcados(res), ac = this.getAttribute('data-lote')
        if (!ids.length) return alert('Marque os procedimentos.')
        if (ac === 'receber') return receberRepasse(d.itens.filter(function (x) { return ids.indexOf(x.id) >= 0 }))
        var motivo = null
        if (ac === 'glosar') { motivo = prompt('Motivo da glosa:', ''); if (motivo === null) return }
        var r = await apiPost('fin-convenios', { action: ac, ids: ids, motivo: motivo })
        if (!r.success) return alert(r.error)
        renderPlanos()
      }
    })
  }
  async function receberRepasse(itens) {
    var cs = await K.contas(), total = itens.reduce(function (s, x) { return s + x.valor }, 0)
    K.modal('Receber repasse do convênio', '<div id="fn-err"></div><p class="ag-hint" style="margin:0 0 12px">Ajuste o valor de cada procedimento se o convênio pagou menos (a diferença fica anotada como glosa parcial). É gerada uma entrada por convênio.</p>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Data do crédito</label><input class="ag-in" type="date" id="rp-data" value="' + K.hoje() + '"></div><div class="ag-f"><label>Conta</label><select class="ag-in" id="rp-conta">' + K.opcoes(cs, K.cache.caixa) + '</select></div></div>' +
      '<table class="pc-tbl"><thead><tr><th>Procedimento</th><th>Guia</th><th style="text-align:right">Esperado</th><th style="text-align:right;width:130px">Recebido</th></tr></thead><tbody>' +
      itens.map(function (x) { return '<tr><td>' + esc(x.procedimento_nome) + '<div class="ag-hint" style="margin:0">' + esc(x.paciente_nome || '') + ' · ' + esc(x.convenio || '') + '</div></td><td>' + esc(x.guia || '—') + '</td><td class="fn-num">' + moeda(x.valor) + '</td><td><input class="ag-in" data-val="' + x.id + '" inputmode="decimal" value="' + x.valor.toFixed(2).replace('.', ',') + '"></td></tr>' }).join('') +
      '</tbody><tfoot><tr><td colspan="2"><b>Total</b></td><td class="fn-num"><b>' + moeda(total) + '</b></td><td class="fn-num"><b id="rp-tot">' + moeda(total) + '</b></td></tr></tfoot></table>',
      '<button class="btn" id="rp-c">Cancelar</button><button class="ag-btn-novo" id="rp-ok">Confirmar recebimento</button>', 760)
    var b = el('fn-m-b')
    b.querySelectorAll('[data-val]').forEach(function (i) { i.oninput = function () { var s = 0; b.querySelectorAll('[data-val]').forEach(function (x) { s += Number(String(x.value).replace(/\./g, '').replace(',', '.')) || 0 }); el('rp-tot').textContent = moeda(s) } })
    el('rp-c').onclick = K.fechar
    el('rp-ok').onclick = async function () {
      var valores = {}
      b.querySelectorAll('[data-val]').forEach(function (x) { valores[x.getAttribute('data-val')] = x.value })
      var r = await apiPost('fin-convenios', { action: 'receber', ids: itens.map(function (x) { return x.id }), data: el('rp-data').value, conta_id: el('rp-conta').value, valores: valores })
      if (!r.success) return K.erro(r.error || 'Erro')
      K.fechar(); renderPlanos()
    }
  }

  // ════════════════════════════════════════════════════════════════
  // CONCILIAÇÃO BANCÁRIA
  // ════════════════════════════════════════════════════════════════
  async function loadConciliacoes() {
    var box = K.sub('conciliacoes'); if (!box) return
    box.innerHTML = '<div class="fn-pg">' + cab('Conciliação bancária', 'Importe o extrato do banco (OFX ou CSV) e confira se cada movimento do banco está lançado no sistema.', '<button class="ag-btn-novo" id="co-imp">+ Importar extrato</button>') + '<div id="co-res">' + K.carregando() + '</div></div>'
    el('co-imp').onclick = importarExtrato
    var d = await apiData('fin-conciliacao', {}).catch(function (e) { return { success: false, error: e.message } })
    var res = el('co-res'); if (!res) return
    if (!d.success) return falha(res, d)
    res.innerHTML = d.data.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Importação</th><th>Conta</th><th>Período</th><th>Conciliados</th><th>Situação</th><th></th></tr></thead><tbody>' +
      d.data.map(function (c) {
        return '<tr><td>' + esc(c.descricao || 'Extrato') + '<div class="ag-hint" style="margin:0">' + br(c.created_at) + '</div></td><td>' + esc(c.conta_nome || '—') + '</td><td>' + br(c.periodo_de) + ' a ' + br(c.periodo_ate) + '</td><td>' + c.total_conciliados + ' de ' + c.total_itens + '</td>' +
          '<td><span class="pc-badge ' + (c.status === 'concluida' ? 'ok' : 'pend') + '">' + (c.status === 'concluida' ? 'Concluída' : 'Pendente') + '</span></td><td style="text-align:right;white-space:nowrap"><button class="btn btn-sm btn-primary" data-ab="' + c.id + '">Abrir</button> <button class="btn btn-sm" data-ex="' + c.id + '" style="color:var(--red)">Excluir</button></td></tr>'
      }).join('') + '</tbody></table></div></div>' : K.vazio('Nenhum extrato importado ainda. No internet banking, exporte o extrato em OFX (Money/Quicken) e importe aqui.')
    res.querySelectorAll('[data-ab]').forEach(function (b) { b.onclick = function () { abrirConciliacao(+this.getAttribute('data-ab')) } })
    res.querySelectorAll('[data-ex]').forEach(function (b) { b.onclick = async function () { if (!confirm('Excluir esta importação? Os lançamentos já criados a partir dela continuam no financeiro.')) return; await apiPost('fin-conciliacao', { action: 'excluir', id: +this.getAttribute('data-ex') }); loadConciliacoes() } })
  }
  async function importarExtrato() {
    var cs = (await K.contas()).filter(function (c) { return c.tipo !== 'caixa' })
    if (!cs.length) return alert('Cadastre antes a conta bancária em Conta corrente › Contas bancárias.')
    K.modal('Importar extrato', '<div id="fn-err"></div><div class="ag-row c2"><div class="ag-f"><label>Conta</label><select class="ag-in" id="ie-conta">' + K.opcoes(cs) + '</select></div><div class="ag-f"><label>Arquivo (OFX ou CSV)</label><input class="ag-in" type="file" id="ie-arq" accept=".ofx,.csv,.txt"></div></div>' +
      '<p class="ag-hint">CSV: uma linha por movimento com <b>data;descrição;valor</b> (valor negativo para saídas). Movimentos já importados antes (mesmo identificador do banco) são ignorados.</p>',
      '<button class="btn" id="ie-c">Cancelar</button><button class="ag-btn-novo" id="ie-ok">Importar</button>', 620)
    el('ie-c').onclick = K.fechar
    el('ie-ok').onclick = function () {
      var arq = el('ie-arq').files[0]; if (!arq) return K.erro('Escolha o arquivo')
      if (arq.size > 3e6) return K.erro('Arquivo muito grande (máx. 3 MB)')
      var btn = this; btn.disabled = true
      var fr = new FileReader()
      fr.onload = async function () {
        var r = await apiPost('fin-conciliacao', { action: 'importar', conta_id: el('ie-conta').value, conteudo: fr.result, nome: arq.name })
        btn.disabled = false
        if (!r.success) return K.erro(r.error || 'Erro')
        K.fechar()
        alert(r.importados + ' movimento(s) importado(s), ' + r.conciliados + ' conciliado(s) automaticamente' + (r.repetidos ? ', ' + r.repetidos + ' repetido(s) ignorado(s)' : '') + '.')
        abrirConciliacao(r.id)
      }
      fr.readAsText(arq, /\.ofx$/i.test(arq.name) ? 'ISO-8859-1' : 'UTF-8')
    }
  }
  var SIT_I = { pendente: ['Pendente', 'pend'], conciliado: ['Conciliado', 'ok'], ignorado: ['Ignorado', 'off'] }
  async function abrirConciliacao(id) {
    var box = K.sub('conciliacoes')
    var d = await apiData('fin-conciliacao', { id: id }).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro')
    var c = d.conciliacao
    box.innerHTML = '<div class="fn-pg">' + cab('<a class="crc-voltar" id="cd-v">Conciliação</a> › ' + esc(c.conta_nome || '') + ' · ' + br(c.periodo_de) + ' a ' + br(c.periodo_ate), c.total_conciliados + ' de ' + c.total_itens + ' movimento(s) do banco conferidos.') +
      '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Data</th><th>No banco</th><th style="text-align:right">Valor</th><th>Situação</th><th>No sistema</th><th></th></tr></thead><tbody>' +
      d.itens.map(function (it) {
        var s = SIT_I[it.status] || SIT_I.pendente, m = it.movimento
        return '<tr><td>' + br(it.data) + '</td><td>' + esc(it.descricao || '') + '</td><td class="fn-num ' + (it.tipo === 'debito' ? 'err' : 'ok') + '">' + (it.tipo === 'debito' ? '- ' : '') + moeda(it.valor) + '</td><td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span></td>' +
          '<td>' + (m ? esc(m.descricao || '') + '<div class="ag-hint" style="margin:0">' + br(m.data) + (m.paciente_nome ? ' · ' + esc(m.paciente_nome) : '') + '</div>' : it.movimento_id ? '<span class="ag-hint" style="margin:0">' + esc(it.movimento_id) + '</span>' : '—') + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' + (it.status === 'pendente' ? '<button class="btn btn-sm btn-primary" data-ci="vincular" data-id="' + it.id + '">Vincular</button> <button class="btn btn-sm" data-ci="criar" data-id="' + it.id + '">Lançar</button> <button class="btn btn-sm" data-ci="ignorar" data-id="' + it.id + '">Ignorar</button>' : '<button class="btn btn-sm" data-ci="desfazer" data-id="' + it.id + '">Desfazer</button>') + '</td></tr>'
      }).join('') + '</tbody></table></div></div></div>'
    el('cd-v').onclick = loadConciliacoes
    box.querySelectorAll('[data-ci]').forEach(function (b) {
      b.onclick = async function () {
        var it = d.itens.filter(function (x) { return x.id === +b.getAttribute('data-id') })[0], ac = b.getAttribute('data-ci')
        if (ac === 'vincular') return vincular(it, d.livres, id, d.contas || [])
        if (ac === 'criar') return criarDoExtrato(it, id)
        var r = await apiPost('fin-conciliacao', { action: ac === 'ignorar' ? 'ignorar' : 'desfazer', item_id: it.id })
        if (!r.success) return alert(r.error)
        abrirConciliacao(id)
      }
    })
  }
  function vincular(it, livres, concId, contas) {
    var nomeConta = {}
    contas.forEach(function (c) { nomeConta[c.id] = c.nome })
    var sentido = it.tipo === 'debito' ? 'saida' : 'entrada'
    var cand = livres.filter(function (m) { return m.tipo === sentido }).sort(function (a, b) { return Math.abs(a.valor - it.valor) - Math.abs(b.valor - it.valor) }).slice(0, 40)
    K.modal('Vincular ao movimento do sistema', '<div id="fn-err"></div><p class="ag-hint" style="margin:0 0 12px">' + br(it.data) + ' · ' + esc(it.descricao || '') + ' · <b>' + moeda(it.valor) + '</b><br>Se o movimento escolhido estiver no Caixa geral ou sem conta, ele passa para a conta deste extrato.</p>' +
      (cand.length ? '<table class="pc-tbl"><tbody>' + cand.map(function (m) { return '<tr><td>' + br(m.data) + '</td><td>' + esc(m.descricao || '') + '<div class="ag-hint" style="margin:0">' + esc([m.paciente_nome, nomeConta[m.conta_id] || 'sem conta'].filter(Boolean).join(' · ')) + '</div>' + '</td><td class="fn-num">' + moeda(m.valor) + '</td><td><button class="btn btn-sm btn-primary" data-mv="' + esc(m.id) + '">Vincular</button></td></tr>' }).join('') + '</tbody></table>'
        : K.vazio('Nenhum movimento livre perto desta data. Use "Lançar" para criar o lançamento.')), '<button class="btn" id="vi-c">Cancelar</button>', 760)
    el('vi-c').onclick = K.fechar
    el('fn-m-b').querySelectorAll('[data-mv]').forEach(function (b) {
      b.onclick = async function () { var r = await apiPost('fin-conciliacao', { action: 'conciliar', item_id: it.id, movimento_id: this.getAttribute('data-mv') }); if (!r.success) return K.erro(r.error); K.fechar(); abrirConciliacao(concId) }
    })
  }
  async function criarDoExtrato(it, concId) {
    var cats = (await K.categorias()).filter(function (c) { return it.tipo === 'debito' ? c.tipo !== 'receita' : c.tipo === 'receita' })
    K.modal('Lançar movimento do extrato', '<div id="fn-err"></div><p class="ag-hint" style="margin:0 0 12px">' + br(it.data) + ' · ' + (it.tipo === 'debito' ? 'Saída' : 'Entrada') + ' de <b>' + moeda(it.valor) + '</b></p>' +
      '<div class="ag-f"><label>Descrição</label><input class="ag-in" id="cl-desc" maxlength="140" value="' + esc(it.descricao || '') + '"></div><div class="ag-f"><label>Categoria</label><select class="ag-in" id="cl-cat">' + K.opcoes(cats, '', 'Sem categoria') + '</select></div>',
      '<button class="btn" id="cl-c">Cancelar</button><button class="ag-btn-novo" id="cl-ok">Lançar e conciliar</button>', 560)
    el('cl-c').onclick = K.fechar
    el('cl-ok').onclick = async function () { var r = await apiPost('fin-conciliacao', { action: 'criar_lancamento', item_id: it.id, descricao: el('cl-desc').value, categoria_id: el('cl-cat').value }); if (!r.success) return K.erro(r.error); K.fechar(); abrirConciliacao(concId) }
  }

  // ════════════════════════════════════════════════════════════════
  // CONFIGURAÇÕES › Taxas e encargos
  // ════════════════════════════════════════════════════════════════
  async function abrirTaxas() {
    var d = await apiData('fin-taxas', {})
    if (!d.success) return alert(d.error || 'Erro')
    var fx = d.faixas.length ? d.faixas : [{ forma: 'credito', parcelas_de: 1, parcelas_ate: 1, percentual: 0, fixo: 0, prazo_dias: 30 }, { forma: 'credito', parcelas_de: 2, parcelas_ate: 6, percentual: 0, fixo: 0, prazo_dias: 30 }, { forma: 'credito', parcelas_de: 7, parcelas_ate: 12, percentual: 0, fixo: 0, prazo_dias: 30 }, { forma: 'debito', parcelas_de: 1, parcelas_ate: 1, percentual: 0, fixo: 0, prazo_dias: 1 }]
    var cf = d.config
    function v(n) { return String(Number(n || 0)).replace('.', ',') }
    function linha(x) {
      return '<tr><td><select class="ag-in" data-k="forma">' + sel([['credito', 'Crédito'], ['debito', 'Débito'], ['pix', 'PIX'], ['boleto', 'Boleto']], x.forma) + '</select></td>' +
        '<td><input class="ag-in" data-k="parcelas_de" type="number" min="1" max="24" value="' + (x.parcelas_de || 1) + '" style="width:64px"> a <input class="ag-in" data-k="parcelas_ate" type="number" min="1" max="24" value="' + (x.parcelas_ate || 1) + '" style="width:64px"></td>' +
        '<td><input class="ag-in" data-k="percentual" inputmode="decimal" value="' + v(x.percentual) + '" style="width:80px"></td><td><input class="ag-in" data-k="fixo" inputmode="decimal" value="' + v(x.fixo) + '" style="width:80px"></td>' +
        '<td><input class="ag-in" data-k="prazo_dias" type="number" min="0" max="120" value="' + (x.prazo_dias || 0) + '" style="width:70px"></td><td><button class="ag-ico" data-rm="1" title="Remover">✕</button></td></tr>'
    }
    K.modal('Taxas e encargos', '<div id="fn-err"></div><div class="pc-box-h">Taxas por forma de pagamento</div><p class="ag-hint" style="margin:0 0 12px">Usadas no controle de cartões para calcular o valor líquido e a data prevista de cada parcela. No crédito, o prazo é por parcela (ex.: 30 dias = 1ª parcela em 30, 2ª em 60…).</p>' +
      '<div class="oc-scroll"><table class="pc-tbl" id="tx-tab"><thead><tr><th>Forma</th><th>Parcelas</th><th>Taxa %</th><th>Fixo R$</th><th>Prazo (dias)</th><th></th></tr></thead><tbody>' + fx.map(linha).join('') + '</tbody></table></div>' +
      '<button class="btn btn-sm" id="tx-add" style="margin-top:8px">+ Faixa</button>' +
      '<div class="pc-box-h" style="margin-top:24px">Cobranças pelo Asaas (boleto e PIX)</div><div class="ag-row c4"><div class="ag-f"><label>Multa por atraso (%)</label><input class="ag-in" id="tx-multa" inputmode="decimal" value="' + v(cf.multa_percent) + '"></div>' +
      '<div class="ag-f"><label>Juros ao mês (%)</label><input class="ag-in" id="tx-juros" inputmode="decimal" value="' + v(cf.juros_mes_percent) + '"></div><div class="ag-f"><label>Desconto antecipado (%)</label><input class="ag-in" id="tx-desc" inputmode="decimal" value="' + v(cf.desconto_percent) + '"></div>' +
      '<div class="ag-f"><label>Até quantos dias antes</label><input class="ag-in" id="tx-dias" type="number" min="0" max="30" value="' + (cf.desconto_dias || 0) + '"></div></div>' +
      '<p class="ag-hint">Valem para as cobranças geradas daqui em diante. O Código de Defesa do Consumidor limita a multa a 2%; juros de mora usuais são de até 1% ao mês.</p>',
      '<button class="btn" id="tx-c">Cancelar</button><button class="ag-btn-novo" id="tx-ok">Salvar</button>', 820)
    var tb = el('tx-tab').querySelector('tbody')
    function ligar() { tb.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { this.closest('tr').remove() } }) }
    ligar()
    el('tx-add').onclick = function () { tb.insertAdjacentHTML('beforeend', linha({ forma: 'credito', parcelas_de: 1, parcelas_ate: 1, prazo_dias: 30 })); ligar() }
    el('tx-c').onclick = K.fechar
    el('tx-ok').onclick = async function () {
      var faixas = Array.prototype.map.call(tb.querySelectorAll('tr'), function (tr) { var o = {}; tr.querySelectorAll('[data-k]').forEach(function (i) { o[i.getAttribute('data-k')] = i.value }); return o })
      var r = await apiPost('fin-taxas', { faixas: faixas, config: { multa_percent: el('tx-multa').value, juros_mes_percent: el('tx-juros').value, desconto_percent: el('tx-desc').value, desconto_dias: el('tx-dias').value } })
      if (!r.success) return K.erro(r.error || 'Erro')
      K.fechar()
    }
  }

  // ════════════════════════════════════════════════════════════════
  // CONFIGURAÇÕES › Régua de cobrança
  // ════════════════════════════════════════════════════════════════
  var MSG_PADRAO = {
    antes: 'Olá, {nome}! Passando para lembrar que a parcela {parcela} do seu tratamento, no valor de {valor}, vence em {vencimento}. {link}',
    depois: 'Olá, {nome}! Não identificamos o pagamento da parcela de {valor} que venceu em {vencimento}. Se já pagou, desconsidere. {link}'
  }
  async function abrirRegua() {
    var d = await apiData('fin-regua', {})
    if (!d.success) return alert(d.error || 'Erro')
    var dias = []; for (var i = -10; i <= 10; i++) dias.push(i)
    var porDia = {}
    d.regras.forEach(function (r) { (porDia[r.dias] = porDia[r.dias] || []).push(r) })
    var avisos = (!d.email ? '<div class="ag-err" style="background:#FFF3E0;color:var(--orange)">O envio de e-mail não está configurado no servidor.</div>' : '') +
      (!d.whatsapp_template ? '<div class="ag-hint" style="margin:0 0 12px">WhatsApp: a Meta só permite que a clínica inicie conversa com um <b>modelo de mensagem aprovado</b>. Enquanto o modelo de cobrança não estiver configurado, as regras de WhatsApp ficam registradas como "sem modelo" e nada é enviado; use e-mail ou o botão de WhatsApp da fila de Inadimplência do CRC.</div>' : '')
    K.modal('Régua de cobrança', avisos + '<p class="ag-hint" style="margin:0 0 12px">Clique num dia para criar um lembrete. Todo dia de manhã o sistema envia para as parcelas em aberto que estão naquele ponto da régua (uma vez por parcela e por regra).</p>' +
      '<div class="rg-linha">' + dias.map(function (x) { return '<div class="rg-dia' + (x === 0 ? ' venc' : '') + (porDia[x] ? ' tem' : '') + '" data-d="' + x + '"><span>' + (x === 0 ? 'Venc.' : (x > 0 ? '+' : '') + x) + '</span>' + (porDia[x] ? '<b>' + porDia[x].length + '</b>' : '') + '</div>' }).join('') + '</div>' +
      '<div class="pc-box-h" style="margin-top:16px">Lembretes configurados</div>' +
      (d.regras.length ? d.regras.map(function (r) {
        return '<div class="pc-nota"><div><b style="color:var(--text);font-weight:500">' + (r.dias === 0 ? 'No vencimento' : Math.abs(r.dias) + ' dia(s) ' + (r.dias < 0 ? 'antes' : 'depois')) + '</b> · ' + (r.canal === 'email' ? 'E-mail' : 'WhatsApp') + (r.ativo ? '' : ' · <span class="pc-badge off">Pausado</span>') +
          '<small>' + esc(r.mensagem) + '</small></div><div style="white-space:nowrap"><button class="btn btn-sm" data-ed="' + r.id + '">Editar</button> <button class="btn btn-sm" data-rm="' + r.id + '" style="color:var(--red)">Remover</button></div></div>'
      }).join('') : K.vazio('Nenhum lembrete. Sugestão: 3 dias antes por WhatsApp e 3 dias depois por e-mail.')) +
      '<div class="pc-box-h" style="margin-top:16px">Últimos envios</div>' +
      (d.envios.length ? '<table class="pc-tbl"><tbody>' + d.envios.map(function (e) { return '<tr><td>' + br(e.enviado_em) + '</td><td>' + esc(e.paciente_nome || '') + '</td><td>' + (e.canal === 'email' ? 'E-mail' : 'WhatsApp') + '</td><td><span class="pc-badge ' + (e.status === 'enviado' ? 'ok' : e.status === 'erro' ? 'err' : 'off') + '">' + esc({ enviado: 'Enviado', erro: 'Erro', sem_destino: 'Sem contato', sem_template: 'Sem modelo', sem_canal: 'Sem canal' }[e.status] || e.status) + '</span>' + (e.erro ? '<div class="ag-hint" style="margin:0">' + esc(e.erro) + '</div>' : '') + '</td></tr>' }).join('') + '</tbody></table>' : '<div class="ag-hint">Nenhum envio ainda.</div>'),
      '<button class="btn" id="rg-f">Fechar</button>', 820)
    el('rg-f').onclick = K.fechar
    var b = el('fn-m-b')
    b.querySelectorAll('[data-d]').forEach(function (x) { x.onclick = function () { editarRegra({ dias: +this.getAttribute('data-d'), canal: 'whatsapp' }) } })
    b.querySelectorAll('[data-ed]').forEach(function (x) { x.onclick = function () { editarRegra(d.regras.filter(function (r) { return r.id === +x.getAttribute('data-ed') })[0]) } })
    b.querySelectorAll('[data-rm]').forEach(function (x) { x.onclick = async function () { if (!confirm('Remover este lembrete?')) return; await apiPost('fin-regua', { action: 'excluir', id: +this.getAttribute('data-rm') }); abrirRegua() } })
  }
  function editarRegra(r) {
    var msg = r.mensagem || (r.dias < 0 ? MSG_PADRAO.antes : MSG_PADRAO.depois)
    K.modal(r.id ? 'Editar lembrete' : 'Novo lembrete', '<div id="fn-err"></div><div class="ag-row c3"><div class="ag-f"><label>Quando</label><select class="ag-in" id="rr-dias">' + (function () { var o = []; for (var i = -10; i <= 30; i++) o.push([i, i === 0 ? 'No dia do vencimento' : Math.abs(i) + ' dia(s) ' + (i < 0 ? 'antes' : 'depois')]); return sel(o, r.dias) })() + '</select></div>' +
      '<div class="ag-f"><label>Canal</label><select class="ag-in" id="rr-canal">' + sel([['whatsapp', 'WhatsApp'], ['email', 'E-mail']], r.canal) + '</select></div>' +
      (r.id ? '<div class="ag-f"><label>Situação</label><select class="ag-in" id="rr-ativo">' + sel([[1, 'Ativo'], [0, 'Pausado']], r.ativo ? 1 : 0) + '</select></div>' : '<div></div>') + '</div>' +
      '<div class="ag-f"><label>Mensagem</label><textarea class="ag-in" id="rr-msg" rows="4" maxlength="1000">' + esc(msg) + '</textarea></div>' +
      '<p class="ag-hint">Campos: {nome} · {valor} · {vencimento} · {parcela} · {link} (link da cobrança no Asaas, quando houver) · {clinica}. No WhatsApp, o texto enviado é o do modelo aprovado na Meta, com nome, valor e vencimento.</p>',
      '<button class="btn" id="rr-v">Voltar</button><button class="ag-btn-novo" id="rr-ok">Salvar</button>', 640)
    el('rr-v').onclick = abrirRegua
    el('rr-ok').onclick = async function () {
      var x = await apiPost('fin-regua', { id: r.id, dias: el('rr-dias').value, canal: el('rr-canal').value, mensagem: el('rr-msg').value, ativo: el('rr-ativo') ? el('rr-ativo').value === '1' : true })
      if (!x.success) return K.erro(x.error || 'Erro')
      abrirRegua()
    }
  }

  window.renderBoletos = renderBoletos
  window.renderCheques = function () { return renderRecebiveis('cheque') }
  window.renderCartoes = function () { return renderRecebiveis('cartao') }
  window.renderPlanos = renderPlanos
  window.loadConciliacoes = loadConciliacoes
  window.abrirTaxasFinanceiro = abrirTaxas
  window.abrirReguaCobranca = abrirRegua
})()
