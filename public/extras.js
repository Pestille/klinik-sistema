// public/extras.js — Estoque, controle protético, controle de indicação, anamnese por link,
// medicamentos do receituário e check-in por QR (Fase 9)
// Klinov — Campo Grande, MS
//
// Substitui as telas "em breve" do app.html (#p-estoque, #p-protético,
// #p-indicacao). Os quadros usam o mesmo visual de kanban do CRC (crc.css).
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function qtd(v) { return String(Math.round(Number(v || 0) * 1000) / 1000).replace('.', ',') }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function hoje() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function isAdmin() { return (KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }
  function v(id) { var e = el(id); return e ? e.value : '' }
  function foneWa(f) { var d = String(f || '').replace(/\D/g, ''); if (d.length < 10) return ''; return d.slice(0, 2) === '55' ? d : '55' + d }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('ex-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'ex-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10010'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 620) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="ex-m-x">✕</button></div><div class="ag-modal-b" id="ex-m-b"><div id="ex-err"></div>' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('ex-m-x').onclick = fechar
    ov.onmousedown = function (e) { if (e.target === ov) fechar() }
  }
  function fechar() { var ov = el('ex-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  function erro(m) { var e = el('ex-err'); if (e) e.innerHTML = m ? '<div class="ag-err">' + esc(m) + '</div>' : '' }
  function cab(titulo, sub, acoes) { return '<div class="gpage-header"><div><div class="gpage-title">' + titulo + '</div><div class="gpage-sub">' + sub + '</div></div><div class="fn-acoes">' + (acoes || '') + '</div></div>' }
  async function fornecedores() { try { return (await apiData('fin-fornecedores', {})).data || [] } catch (e) { return [] } }
  function opcoes(lista, sel, vazio) { return (vazio != null ? '<option value="">' + esc(vazio) + '</option>' : '') + lista.map(function (x) { return '<option value="' + x.id + '"' + (String(sel) === String(x.id) ? ' selected' : '') + '>' + esc(x.nome) + '</option>' }).join('') }

  // Busca de paciente (campo texto + lista) usada nos formulários
  function campoPaciente(id, atualNome) {
    return '<div class="ag-f ex-pac"><label>Paciente</label><input class="ag-in" id="' + id + '-q" autocomplete="off" placeholder="Digite o nome" value="' + esc(atualNome || '') + '"><input type="hidden" id="' + id + '"><div class="ex-pac-lista" id="' + id + '-l"></div></div>'
  }
  function ligarPaciente(id, atualId) {
    var inp = el(id + '-q'), hid = el(id), lst = el(id + '-l'), t = null
    if (atualId) hid.value = atualId
    inp.oninput = function () {
      hid.value = ''; clearTimeout(t); var termo = this.value.trim()
      if (termo.length < 2) { lst.innerHTML = ''; return }
      t = setTimeout(async function () {
        var d = await apiData('pacientes-lista', { q: termo, limit: 8 }).catch(function () { return { data: [] } })
        lst.innerHTML = (d.data || d.pacientes || []).slice(0, 8).map(function (p) { return '<a data-id="' + p.id + '">' + esc(p.nome) + '</a>' }).join('')
        lst.querySelectorAll('[data-id]').forEach(function (a) { a.onclick = function () { hid.value = this.getAttribute('data-id'); inp.value = this.textContent; lst.innerHTML = '' } })
      }, 250)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ESTOQUE
  // ════════════════════════════════════════════════════════════════
  var ES = { q: '', categoria: '', situacao: '' }
  var SIT_E = { ok: ['Em estoque', 'ok'], baixo: ['Repor', 'pend'], zerado: ['Zerado', 'err'], vencendo: ['Vence em breve', 'pend'], vencido: ['Vencido', 'err'] }
  async function loadEstoque() {
    var pg = el('p-estoque'); if (!pg) return
    var edita = pode('estoque.editar')
    pg.innerHTML = cab('Controle de estoque', 'Materiais e insumos: entradas, saídas, mínimo para repor e validade.', '<button class="btn" id="es-hist">Movimentações</button>' + (edita ? '<button class="ag-btn-novo" id="es-novo">+ Adicionar produto</button>' : '')) +
      '<div class="gpage-body"><div class="fn-pg" style="padding:0 0 24px"><div id="es-kpis"></div><div class="fn-filtros"><div class="ag-f" style="flex:2"><label>Buscar</label><input class="ag-in" id="es-q" value="' + esc(ES.q) + '" placeholder="Nome, código ou categoria"></div>' +
      '<div class="ag-f"><label>Categoria</label><select class="ag-in" id="es-cat"><option value="">Todas</option></select></div><div class="ag-f"><label>Mostrar</label><select class="ag-in" id="es-sit"><option value="">Todos</option><option value="repor">Para repor</option><option value="validade">Validade próxima</option></select></div></div>' +
      '<div id="es-res"><div class="fn-sk"></div></div></div></div>'
    el('es-sit').value = ES.situacao
    if (el('es-novo')) el('es-novo').onclick = function () { editarProduto(null) }
    el('es-hist').onclick = function () { historico(null) }
    var t = null
    el('es-q').oninput = function () { var x = this.value; clearTimeout(t); t = setTimeout(function () { ES.q = x; listar() }, 300) }
    el('es-cat').onchange = function () { ES.categoria = this.value; listar() }
    el('es-sit').onchange = function () { ES.situacao = this.value; listar() }
    listar()
  }
  async function listar() {
    var d = await apiData('estoque-produtos', ES).catch(function (e) { return { success: false, error: e.message } })
    var res = el('es-res'); if (!res) return
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    ES.dados = d
    var cat = el('es-cat'); if (cat.options.length <= 1) d.categorias.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; if (c === ES.categoria) o.selected = true; cat.appendChild(o) })
    var t = d.totais
    el('es-kpis').innerHTML = '<div class="fn-kpis">' + [['Produtos', String(t.produtos)], ['Valor em estoque', moeda(t.valor)], ['Para repor', String(t.repor), t.repor ? 'err' : ''], ['Validade em 30 dias', String(t.validade), t.validade ? 'err' : '']].map(function (k) { return '<div class="pc-box fn-kpi ' + (k[2] || '') + '"><div class="pc-box-h" style="margin-bottom:8px">' + k[0] + '</div><div class="fn-kpi-v">' + k[1] + '</div></div>' }).join('') + '</div>'
    var edita = pode('estoque.editar')
    res.innerHTML = d.data.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Produto</th><th class="hide-sm">Categoria</th><th style="text-align:right">Quantidade</th><th style="text-align:right" class="hide-sm">Mínimo</th><th class="hide-sm">Validade</th><th>Situação</th><th></th></tr></thead><tbody>' +
      d.data.map(function (p) {
        var s = SIT_E[p.situacao] || SIT_E.ok
        return '<tr><td>' + esc(p.nome) + (p.codigo || p.localizacao ? '<div class="ag-hint" style="margin:0">' + esc([p.codigo, p.localizacao].filter(Boolean).join(' · ')) + '</div>' : '') + '</td><td class="hide-sm">' + esc(p.categoria || '—') + '</td>' +
          '<td class="fn-num"><b>' + qtd(p.quantidade) + '</b> ' + esc(p.unidade) + '</td><td class="fn-num hide-sm">' + (p.minimo ? qtd(p.minimo) : '—') + '</td><td class="hide-sm">' + (br(p.validade) || '—') + '</td><td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span></td>' +
          '<td style="text-align:right;white-space:nowrap"><button class="btn btn-sm btn-primary" data-mv="entrada" data-id="' + p.id + '" title="Entrada">+</button> <button class="btn btn-sm" data-mv="saida" data-id="' + p.id + '" title="Saída">−</button> <button class="btn btn-sm" data-ac="hist" data-id="' + p.id + '">Histórico</button>' + (edita ? ' <button class="btn btn-sm" data-ac="editar" data-id="' + p.id + '">Editar</button>' : '') + '</td></tr>'
      }).join('') + '</tbody></table></div></div>' : '<div class="pc-vazio" style="padding:40px 0">Nenhum produto' + (ES.q || ES.situacao ? ' encontrado' : ' cadastrado. Use "+ Adicionar produto".') + '</div>'
    res.querySelectorAll('[data-mv]').forEach(function (b) { b.onclick = function () { movimentar(produto(+this.getAttribute('data-id')), this.getAttribute('data-mv')) } })
    res.querySelectorAll('[data-ac]').forEach(function (b) { b.onclick = function () { var p = produto(+this.getAttribute('data-id')); if (this.getAttribute('data-ac') === 'hist') historico(p); else editarProduto(p) } })
  }
  function produto(id) { return ES.dados.data.filter(function (p) { return p.id === id })[0] }
  async function editarProduto(p) {
    var fs = await fornecedores(), un = (ES.dados && ES.dados.unidades) || ['UN']
    p = p || {}
    modal(p.id ? 'Editar produto' : 'Novo produto', '<div class="ag-f"><label>Nome</label><input class="ag-in" id="ep-nome" maxlength="120" value="' + esc(p.nome || '') + '"></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Categoria</label><input class="ag-in" id="ep-cat" maxlength="60" list="ep-cats" value="' + esc(p.categoria || '') + '"><datalist id="ep-cats">' + ((ES.dados && ES.dados.categorias) || []).concat(['EPI', 'Dentística', 'Endodontia', 'Cirurgia', 'Prótese', 'Higiene', 'Escritório']).filter(function (x, i, a) { return a.indexOf(x) === i }).map(function (c) { return '<option value="' + esc(c) + '">' }).join('') + '</datalist></div>' +
      '<div class="ag-f"><label>Unidade</label><select class="ag-in" id="ep-un">' + un.map(function (u) { return '<option' + ((p.unidade || 'UN') === u ? ' selected' : '') + '>' + u + '</option>' }).join('') + '</select></div><div class="ag-f"><label>Estoque mínimo</label><input class="ag-in" id="ep-min" inputmode="decimal" value="' + (p.minimo ? qtd(p.minimo) : '') + '"></div></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Código</label><input class="ag-in" id="ep-cod" maxlength="40" value="' + esc(p.codigo || '') + '"></div><div class="ag-f"><label>Localização</label><input class="ag-in" id="ep-loc" maxlength="60" placeholder="Ex.: Armário 2" value="' + esc(p.localizacao || '') + '"></div><div class="ag-f"><label>Validade</label><input class="ag-in" type="date" id="ep-val" value="' + esc(p.validade || '') + '"></div></div>' +
      '<div class="ag-f"><label>Fornecedor</label><select class="ag-in" id="ep-forn">' + opcoes(fs, p.fornecedor_id, 'Nenhum') + '</select></div>' +
      (p.id ? '' : '<div class="ag-row c2"><div class="ag-f"><label>Quantidade inicial</label><input class="ag-in" id="ep-qi" inputmode="decimal"></div><div class="ag-f"><label>Custo unitário (R$)</label><input class="ag-in" id="ep-cu" inputmode="decimal"></div></div>'),
      (p.id ? '<button class="btn" id="ep-del" style="color:var(--red);margin-right:auto">Remover</button>' : '') + '<button class="btn" id="ep-c">Cancelar</button><button class="ag-btn-novo" id="ep-ok">Salvar</button>', 640)
    el('ep-c').onclick = fechar
    if (el('ep-del')) el('ep-del').onclick = async function () { if (!confirm('Remover ' + p.nome + ' do estoque? O histórico fica guardado.')) return; var r = await apiPost('estoque-produtos', { action: 'excluir', id: p.id }); if (!r.success) return erro(r.error); fechar(); listar() }
    el('ep-ok').onclick = async function () {
      var r = await apiPost('estoque-produtos', { id: p.id, nome: v('ep-nome'), categoria: v('ep-cat'), unidade: v('ep-un'), minimo: v('ep-min'), codigo: v('ep-cod'), localizacao: v('ep-loc'), validade: v('ep-val'), fornecedor_id: v('ep-forn'), quantidade_inicial: v('ep-qi'), custo_unitario: v('ep-cu') })
      if (!r.success) return erro(r.error || 'Erro')
      fechar(); listar()
    }
  }
  async function movimentar(p, tipo) {
    var fs = tipo === 'entrada' ? await fornecedores() : []
    var titulos = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste de inventário' }
    modal(titulos[tipo] + ' — ' + p.nome, '<p class="ag-hint" style="margin:0 0 12px">Em estoque: <b>' + qtd(p.quantidade) + ' ' + esc(p.unidade) + '</b>' + (p.custo_medio ? ' · custo médio ' + moeda(p.custo_medio) : '') + '</p>' +
      '<div class="ag-chips" id="mv-tipo">' + ['entrada', 'saida', 'ajuste'].map(function (t) { return '<span class="ag-chip' + (t === tipo ? ' on' : '') + '" data-t="' + t + '">' + titulos[t] + '</span>' }).join('') + '</div>' +
      '<div class="ag-row c2" style="margin-top:12px"><div class="ag-f"><label id="mv-qrot">' + (tipo === 'ajuste' ? 'Quantidade contada' : 'Quantidade') + ' (' + esc(p.unidade) + ')</label><input class="ag-in" id="mv-q" inputmode="decimal"></div><div class="ag-f" id="mv-cu-box"><label>Custo unitário (R$)</label><input class="ag-in" id="mv-cu" inputmode="decimal"></div></div>' +
      '<div id="mv-ent"><div class="ag-row c2"><div class="ag-f"><label>Lote</label><input class="ag-in" id="mv-lote" maxlength="40"></div><div class="ag-f"><label>Validade</label><input class="ag-in" type="date" id="mv-val"></div></div>' +
        '<label class="ag-chk" style="margin:4px 0 12px"><input type="checkbox" id="mv-conta"> Lançar em contas a pagar</label><div class="ag-row c2" id="mv-conta-box" style="display:none"><div class="ag-f"><label>Fornecedor</label><select class="ag-in" id="mv-forn">' + opcoes(fs, p.fornecedor_id, 'Nenhum') + '</select></div><div class="ag-f"><label>Vencimento</label><input class="ag-in" type="date" id="mv-venc" value="' + hoje() + '"></div></div></div>' +
      '<div id="mv-sai">' + '<div class="ag-f"><label>Paciente (opcional)</label>' + campoPaciente('mv-pac').replace('<div class="ag-f ex-pac"><label>Paciente</label>', '<div class="ex-pac">') + '</div></div>' +
      '<div class="ag-f"><label>Motivo / observação</label><input class="ag-in" id="mv-mot" maxlength="200"></div>',
      '<button class="btn" id="mv-c">Cancelar</button><button class="ag-btn-novo" id="mv-ok">Confirmar</button>', 620)
    ligarPaciente('mv-pac')
    function ajustar() {
      el('mv-ent').style.display = tipo === 'entrada' ? '' : 'none'; el('mv-cu-box').style.visibility = tipo === 'entrada' ? 'visible' : 'hidden'
      el('mv-sai').style.display = tipo === 'saida' ? '' : 'none'
      el('mv-qrot').textContent = (tipo === 'ajuste' ? 'Quantidade contada' : 'Quantidade') + ' (' + p.unidade + ')'
    }
    el('mv-tipo').querySelectorAll('[data-t]').forEach(function (s) { s.onclick = function () { tipo = this.getAttribute('data-t'); el('mv-tipo').querySelectorAll('[data-t]').forEach(function (x) { x.classList.toggle('on', x === s) }); ajustar() } })
    el('mv-conta').onchange = function () { el('mv-conta-box').style.display = this.checked ? '' : 'none' }
    ajustar()
    el('mv-c').onclick = fechar
    el('mv-ok').onclick = async function () {
      var r = await apiPost('estoque-movimentar', { produto_id: p.id, tipo: tipo, quantidade: v('mv-q'), custo_unitario: v('mv-cu'), lote: v('mv-lote'), validade: v('mv-val'), motivo: v('mv-mot'), paciente_id: tipo === 'saida' ? v('mv-pac') : '', gerar_conta: tipo === 'entrada' && el('mv-conta').checked, fornecedor_id: v('mv-forn'), vencimento: v('mv-venc') })
      if (!r.success) return erro(r.error || 'Erro')
      fechar(); listar()
    }
  }
  async function historico(p) {
    var d = await apiData('estoque-movimentos', p ? { produto_id: p.id } : {}).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro')
    var N = { entrada: ['Entrada', 'ok'], saida: ['Saída', 'err'], ajuste: ['Ajuste', 'off'] }
    modal(p ? 'Histórico — ' + p.nome : 'Movimentações recentes', d.data.length ? '<div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Data</th>' + (p ? '' : '<th>Produto</th>') + '<th>Tipo</th><th style="text-align:right">Qtd</th><th style="text-align:right">Saldo</th><th class="hide-sm">Detalhe</th><th class="hide-sm">Por</th></tr></thead><tbody>' +
      d.data.map(function (m) { var n = N[m.tipo] || N.ajuste; return '<tr><td>' + br(m.criado_em) + ' ' + String(m.criado_em || '').slice(11, 16) + '</td>' + (p ? '' : '<td>' + esc(m.produto) + '</td>') + '<td><span class="pc-badge ' + n[1] + '">' + n[0] + '</span></td><td class="fn-num">' + qtd(m.quantidade) + ' ' + esc(m.unidade) + '</td><td class="fn-num">' + qtd(m.saldo) + '</td>' +
        '<td class="hide-sm">' + esc([m.motivo, m.paciente_nome, m.lote ? 'lote ' + m.lote : '', m.custo_unitario ? moeda(m.custo_unitario) + '/un' : '', m.conta_pagar_id ? 'conta a pagar lançada' : ''].filter(Boolean).join(' · ') || '—') + '</td><td class="hide-sm">' + esc(m.usuario_nome || '') + '</td></tr>' }).join('') + '</tbody></table></div>' : '<div class="pc-vazio">Nenhuma movimentação.</div>',
      '<button class="btn" id="hs-f">Fechar</button>', 860)
    el('hs-f').onclick = fechar
  }

  // ════════════════════════════════════════════════════════════════
  // CONTROLE PROTÉTICO (kanban)
  // ════════════════════════════════════════════════════════════════
  var PT = { q: '', profissional_id: '', arquivados: false, arrastando: null }
  async function loadProtetico() {
    var pg = el('p-protético'); if (!pg) return
    var profs = []
    try { profs = ((await apiData('profissionais')).data || []).filter(function (p) { return p.ativo !== 0 }) } catch (e) {}
    pg.innerHTML = cab('Controle protético', 'Próteses e trabalhos de laboratório, do envio à instalação.', '<button class="btn" id="pt-arq">' + (PT.arquivados ? 'Ver ativos' : 'Arquivados') + '</button><button class="ag-btn-novo" id="pt-novo">+ Adicionar serviço</button>') +
      '<div class="gpage-body"><div class="crc-filtros"><div class="ag-f"><label>Profissional</label><select class="ag-in" id="pt-prof">' + opcoes(profs, PT.profissional_id, 'Todos') + '</select></div><div class="ag-f" style="flex:2"><label>Buscar</label><input class="ag-in" id="pt-q" value="' + esc(PT.q) + '" placeholder="Paciente, serviço ou laboratório"></div></div><div class="crc-board" id="pt-board"><div class="crc-sk" style="height:200px"></div></div></div>'
    el('pt-novo').onclick = function () { editarServico(null) }
    el('pt-arq').onclick = function () { PT.arquivados = !PT.arquivados; loadProtetico() }
    el('pt-prof').onchange = function () { PT.profissional_id = this.value; quadroProt() }
    var t = null
    el('pt-q').oninput = function () { var x = this.value; clearTimeout(t); t = setTimeout(function () { PT.q = x; quadroProt() }, 300) }
    quadroProt()
  }
  async function quadroProt() {
    var d = await apiData('protetico', { q: PT.q, profissional_id: PT.profissional_id, arquivados: PT.arquivados ? 1 : '' }).catch(function (e) { return { success: false, error: e.message } })
    var board = el('pt-board'); if (!board) return
    if (!d.success) { board.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    PT.dados = d
    board.innerHTML = d.etapas.map(function (e) {
      var cs = d.itens.filter(function (x) { return x.etapa === e.id })
      return '<div class="crc-col" data-etapa="' + e.id + '"><div class="crc-col-h"><b>' + esc(e.nome) + '</b><span>' + cs.length + '</span></div><div class="crc-col-b">' + (cs.length ? cs.map(function (x) {
        return '<div class="crc-cartao' + (x.atrasado ? ' atrasado' : '') + '" draggable="' + (PT.arquivados ? 'false' : 'true') + '" data-id="' + x.id + '"><div class="crc-c-top"><a class="crc-c-nome">' + esc(x.servico) + '</a>' + (x.valor ? '<span class="crc-c-dias">' + moeda(x.valor) + '</span>' : '') + '</div>' +
          '<div class="crc-c-data">' + esc([x.paciente_nome, x.dentes ? 'dente ' + x.dentes : '', x.cor ? 'cor ' + x.cor : ''].filter(Boolean).join(' · ') || '—') + '</div>' +
          '<div class="crc-c-ctx">' + esc(x.laboratorio_nome || 'Sem laboratório') + '</div>' +
          (x.data_prevista && x.etapa === 'laboratorio' ? '<div class="crc-c-ret' + (x.atrasado ? ' err' : '') + '">Retorno previsto ' + br(x.data_prevista) + (x.atrasado ? ' (atrasado)' : '') + '</div>' : '') +
          (x.data_instalacao ? '<div class="crc-c-data">Instalado em ' + br(x.data_instalacao) + '</div>' : '') +
          '<div class="crc-c-acoes"><button class="btn btn-sm" data-ed="' + x.id + '">Abrir</button>' + (PT.arquivados ? '<button class="btn btn-sm" data-un="' + x.id + '">Desarquivar</button>' : (x.etapa === 'instalado' ? '<button class="btn btn-sm" data-arq="' + x.id + '">Arquivar</button>' : '')) + '</div></div>'
      }).join('') : '<div class="crc-vazio">Nenhum serviço</div>') + '</div></div>'
    }).join('')
    function item(id) { return d.itens.filter(function (x) { return x.id === id })[0] }
    board.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { editarServico(item(+this.getAttribute('data-ed'))) } })
    board.querySelectorAll('[data-arq]').forEach(function (b) { b.onclick = async function () { await apiPost('protetico', { id: +this.getAttribute('data-arq'), action: 'arquivar' }); quadroProt() } })
    board.querySelectorAll('[data-un]').forEach(function (b) { b.onclick = async function () { await apiPost('protetico', { id: +this.getAttribute('data-un'), action: 'desarquivar' }); quadroProt() } })
    board.querySelectorAll('.crc-cartao[draggable="true"]').forEach(function (n) {
      n.addEventListener('dragstart', function (ev) { PT.arrastando = +n.getAttribute('data-id'); n.classList.add('arrastando'); try { ev.dataTransfer.setData('text/plain', String(PT.arrastando)) } catch (e) {} })
      n.addEventListener('dragend', function () { n.classList.remove('arrastando'); PT.arrastando = null })
    })
    board.querySelectorAll('.crc-col').forEach(function (col) {
      col.addEventListener('dragover', function (ev) { if (PT.arrastando) { ev.preventDefault(); col.classList.add('alvo') } })
      col.addEventListener('dragleave', function (ev) { if (!col.contains(ev.relatedTarget)) col.classList.remove('alvo') })
      col.addEventListener('drop', async function (ev) { ev.preventDefault(); col.classList.remove('alvo'); var id = PT.arrastando; PT.arrastando = null; if (!id) return; var r = await apiPost('protetico', { id: id, action: 'mover', etapa: col.getAttribute('data-etapa') }); if (!r.success) alert(r.error); quadroProt() })
    })
  }
  async function editarServico(x) {
    var fs = await fornecedores(), profs = []
    try { profs = ((await apiData('profissionais')).data || []).filter(function (p) { return p.ativo !== 0 }) } catch (e) {}
    x = x || {}
    var etapas = (PT.dados && PT.dados.etapas) || []
    modal(x.id ? 'Serviço protético' : 'Novo serviço protético', campoPaciente('ps-pac', x.paciente_nome) +
      '<div class="ag-row c3"><div class="ag-f"><label>Serviço</label><input class="ag-in" id="ps-serv" maxlength="120" placeholder="Ex.: Coroa metalocerâmica" value="' + esc(x.servico || '') + '"></div><div class="ag-f"><label>Dente(s)</label><input class="ag-in" id="ps-dentes" maxlength="60" value="' + esc(x.dentes || '') + '"></div><div class="ag-f"><label>Cor</label><input class="ag-in" id="ps-cor" maxlength="30" placeholder="Ex.: A2" value="' + esc(x.cor || '') + '"></div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Laboratório</label><select class="ag-in" id="ps-lab">' + opcoes(fs, x.laboratorio_id, 'Escolha (cadastre em Contas a pagar › Fornecedores)') + '</select></div><div class="ag-f"><label>Profissional</label><select class="ag-in" id="ps-prof">' + opcoes(profs, x.profissional_id, 'Nenhum') + '</select></div></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Envio</label><input class="ag-in" type="date" id="ps-env" value="' + esc(x.data_envio || '') + '"></div><div class="ag-f"><label>Retorno previsto</label><input class="ag-in" type="date" id="ps-prev" value="' + esc(x.data_prevista || '') + '"></div><div class="ag-f"><label>Valor do laboratório (R$)</label><input class="ag-in" id="ps-val" inputmode="decimal" value="' + (x.valor ? String(x.valor).replace('.', ',') : '') + '"></div></div>' +
      (x.id ? '' : '<div class="ag-f"><label>Etapa</label><select class="ag-in" id="ps-etapa">' + etapas.map(function (e) { return '<option value="' + e.id + '">' + esc(e.nome) + '</option>' }).join('') + '</select></div>') +
      '<div class="ag-f"><label>Observações</label><textarea class="ag-in" id="ps-obs" rows="2" maxlength="1000">' + esc(x.observacoes || '') + '</textarea></div>' +
      (x.id ? '<p class="ag-hint">' + [x.data_retorno ? 'Retornou em ' + br(x.data_retorno) : '', x.data_instalacao ? 'Instalado em ' + br(x.data_instalacao) : '', x.conta_pagar_id ? 'Conta a pagar já lançada' : ''].filter(Boolean).join(' · ') + '</p>' : ''),
      (x.id ? (pode('protetico.excluir') ? '<button class="btn" id="ps-del" style="color:var(--red);margin-right:auto">Excluir</button>' : '') + (!x.conta_pagar_id && pode('financeiro.contas') ? '<button class="btn" id="ps-conta">Lançar a pagar</button>' : '') : '') + '<button class="btn" id="ps-c">Cancelar</button><button class="ag-btn-novo" id="ps-ok">Salvar</button>', 720)
    ligarPaciente('ps-pac', x.paciente_id)
    el('ps-c').onclick = fechar
    if (el('ps-del')) el('ps-del').onclick = async function () { if (!confirm('Excluir este serviço? Ele vai para a Administração de Dados.')) return; var r = await apiPost('protetico', { id: x.id, action: 'excluir' }); if (!r.success) return erro(r.error); fechar(); quadroProt() }
    if (el('ps-conta')) el('ps-conta').onclick = async function () { var venc = prompt('Vencimento da conta (dd/mm/aaaa):', br(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))); if (!venc) return; var p = venc.split('/'); var r = await apiPost('protetico', { id: x.id, action: 'conta', vencimento: p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : '' }); if (!r.success) return erro(r.error); fechar(); quadroProt() }
    el('ps-ok').onclick = async function () {
      var r = await apiPost('protetico', { id: x.id, paciente_id: v('ps-pac'), paciente_nome: v('ps-pac-q'), servico: v('ps-serv'), dentes: v('ps-dentes'), cor: v('ps-cor'), laboratorio_id: v('ps-lab'), profissional_id: v('ps-prof'), data_envio: v('ps-env'), data_prevista: v('ps-prev'), valor: v('ps-val'), observacoes: v('ps-obs'), etapa: v('ps-etapa') })
      if (!r.success) return erro(r.error || 'Erro')
      fechar(); quadroProt()
    }
  }

  // ════════════════════════════════════════════════════════════════
  // CONTROLE DE INDICAÇÃO (kanban calculado)
  // ════════════════════════════════════════════════════════════════
  var IN = { q: '', arquivados: false }
  async function loadIndicacao() {
    var pg = el('p-indicacao'); if (!pg) return
    pg.innerHTML = cab('Controle de indicação', 'Pacientes indicados por outros pacientes, do primeiro contato à recompensa de quem indicou.', '<button class="btn" id="in-arq">' + (IN.arquivados ? 'Ver ativos' : 'Arquivados') + '</button>') +
      '<div class="gpage-body"><div class="crc-filtros"><div class="ag-f" style="flex:2"><label>Buscar</label><input class="ag-in" id="in-q" value="' + esc(IN.q) + '" placeholder="Paciente ou quem indicou"></div></div><div id="in-rank"></div><div class="crc-board" id="in-board"><div class="crc-sk" style="height:200px"></div></div>' +
      '<p class="ag-hint">O cartão anda sozinho: orçamento criado → "Orçamento em aberto"; aprovado → "Tratamento aprovado"; com pagamento ou procedimento executado → "Indicação confirmada". Para indicar, preencha "Indicado por" no cadastro do paciente.</p></div>'
    el('in-arq').onclick = function () { IN.arquivados = !IN.arquivados; loadIndicacao() }
    var t = null
    el('in-q').oninput = function () { var x = this.value; clearTimeout(t); t = setTimeout(function () { IN.q = x; quadroInd() }, 300) }
    quadroInd()
  }
  async function quadroInd() {
    var d = await apiData('indicacoes', { q: IN.q, arquivados: IN.arquivados ? 1 : '' }).catch(function (e) { return { success: false, error: e.message } })
    var board = el('in-board'); if (!board) return
    if (!d.success) { board.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    el('in-rank').innerHTML = d.ranking.length ? '<div class="pc-box" style="margin-bottom:16px"><div class="pc-box-h">Quem mais indica</div><div class="cf-chips">' + d.ranking.map(function (r) { return '<span class="cf-chip"><b style="font-weight:500;color:var(--text)">' + esc(r.nome || '—') + '</b> ' + r.indicacoes + ' indicação(ões) · ' + r.confirmadas + ' confirmada(s)' + (r.valor ? ' · ' + moeda(r.valor) : '') + '</span>' }).join('') + '</div></div>' : ''
    board.innerHTML = d.etapas.map(function (e) {
      var cs = d.cartoes.filter(function (x) { return x.etapa === e.id })
      return '<div class="crc-col"><div class="crc-col-h"><b>' + esc(e.nome) + '</b><span>' + cs.length + '</span></div><div class="crc-col-b">' + (cs.length ? cs.map(function (x) {
        var wa = foneWa(x.indicador_tel)
        return '<div class="crc-cartao" draggable="false"><div class="crc-c-top"><a class="crc-c-nome" data-pac="' + x.paciente_id + '">' + esc(x.paciente_nome) + '</a><span class="crc-c-dias">' + br(x.cadastro) + '</span></div>' +
          '<div class="crc-c-data">Indicado por <a class="fn-pac" data-pac="' + (x.indicador_id || '') + '">' + esc(x.indicador_nome || '—') + '</a></div>' +
          (x.valor_aprovado ? '<div class="crc-c-ctx">Tratamento ' + moeda(x.valor_aprovado) + '</div>' : '') +
          (x.recompensa ? '<div class="crc-c-ret" style="color:var(--green)">' + esc(x.recompensa) + ' · ' + br(x.recompensa_em) + '</div>' : '') +
          '<div class="crc-c-acoes">' + (x.etapa === 'confirmada' ? '<button class="btn btn-sm btn-primary" data-rec="' + x.paciente_id + '">Registrar recompensa</button>' : '') + (x.etapa === 'recompensa' ? '<button class="btn btn-sm" data-desf="' + x.paciente_id + '">Desfazer</button>' : '') +
            (wa && (x.etapa === 'confirmada' || x.etapa === 'recompensa') ? '<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Olá, ' + String(x.indicador_nome || '').split(' ')[0] + '! Obrigado por indicar ' + String(x.paciente_nome || '').split(' ')[0] + ' para a nossa clínica.') + '">Agradecer</a>' : '') +
            '<button class="btn btn-sm" data-arq="' + x.paciente_id + '">' + (IN.arquivados ? 'Desarquivar' : 'Arquivar') + '</button></div></div>'
      }).join('') : '<div class="crc-vazio">Ninguém aqui</div>') + '</div></div>'
    }).join('')
    board.querySelectorAll('[data-pac]').forEach(function (a) { a.onclick = function () { var id = +this.getAttribute('data-pac'); if (id) abrirProntuario('', id) } })
    board.querySelectorAll('[data-rec]').forEach(function (b) { b.onclick = async function () { var r = prompt('Qual foi a recompensa para quem indicou? (ex.: limpeza grátis, 10% de desconto)'); if (!r) return; var x = await apiPost('indicacoes', { paciente_id: +this.getAttribute('data-rec'), action: 'recompensa', recompensa: r }); if (!x.success) return alert(x.error); quadroInd() } })
    board.querySelectorAll('[data-desf]').forEach(function (b) { b.onclick = async function () { await apiPost('indicacoes', { paciente_id: +this.getAttribute('data-desf'), action: 'desfazer_recompensa' }); quadroInd() } })
    board.querySelectorAll('[data-arq]').forEach(function (b) { b.onclick = async function () { await apiPost('indicacoes', { paciente_id: +this.getAttribute('data-arq'), action: IN.arquivados ? 'desarquivar' : 'arquivar' }); quadroInd() } })
  }

  // ════════════════════════════════════════════════════════════════
  // ANAMNESE POR LINK (aba Anamnese do prontuário)
  // ════════════════════════════════════════════════════════════════
  async function enviarLinkAnamnese(p) {
    var r = await apiPost('anamnese-link', { paciente_id: p.id })
    if (!r.success) return alert(r.error || 'Erro ao gerar o link')
    var url = location.origin + r.caminho, wa = foneWa(r.telefone)
    var texto = 'Olá, ' + String(r.paciente || '').split(' ')[0].charAt(0) + String(r.paciente || '').split(' ')[0].slice(1).toLowerCase() + '! Para agilizar seu atendimento, responda nosso questionário de saúde antes da consulta: ' + url
    var hist = await apiData('anamnese-link', { paciente_id: p.id }).catch(function () { return { data: [] } })
    modal('Anamnese por link', '<p class="ag-hint" style="margin:0 0 12px">O paciente responde pelo celular e as respostas entram nesta aba. O link vale até ' + br(r.expira_em) + ' e só pode ser respondido uma vez; gerar outro cancela o anterior.</p>' +
      '<div class="ag-f"><label>Link</label><input class="ag-in" id="al-url" readonly value="' + esc(url) + '"></div>' +
      ((hist.data || []).length > 1 ? '<div class="pc-box-h" style="margin-top:16px">Envios anteriores</div>' + hist.data.slice(1).map(function (x) { return '<div class="ag-hint" style="margin:4px 0">' + br(x.criado_em) + (x.criado_por_nome ? ' por ' + esc(x.criado_por_nome) : '') + ' — ' + (x.usado_em ? '<b style="color:var(--green)">respondido em ' + br(x.usado_em) + '</b>' : 'não respondido') + '</div>' }).join('') : ''),
      '<button class="btn" id="al-copiar">Copiar link</button>' + (wa ? '<a class="ag-btn-novo" id="al-wa" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(texto) + '">Enviar no WhatsApp</a>' : '<span class="ag-hint" style="margin:0">Paciente sem telefone cadastrado</span>'), 600)
    el('al-copiar').onclick = function () { var i = el('al-url'); i.select(); try { navigator.clipboard.writeText(i.value) } catch (e) { document.execCommand('copy') } this.textContent = 'Copiado' }
  }
  if (typeof window.renderAnamneseTab === 'function') {
    var renderAnamOrig = window.renderAnamneseTab
    window.renderAnamneseTab = async function (box, p) {
      await renderAnamOrig(box, p)
      if (_anamneseEditMode) return
      var bt = Array.prototype.filter.call(box.querySelectorAll('button'), function (b) { return b.textContent === 'Editar' })[0]
      if (!bt) return
      var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:8px'
      bt.parentNode.insertBefore(wrap, bt); wrap.appendChild(bt)
      var link = document.createElement('button'); link.className = 'ag-btn-novo'; link.textContent = 'Enviar por link'
      link.onclick = function () { enviarLinkAnamnese(p) }
      wrap.insertBefore(link, bt)
      // Destaque das respostas que pedem atenção (perguntas marcadas como alerta)
      var resp = (_prontData && _prontData.anamnese) || [], pergs = _anamnesePerguntas || [], porId = {}
      resp.forEach(function (r) { porId[r.pergunta_id] = r })
      var alertas = pergs.filter(function (q) { return q.alerta && porId[q.id] && porId[q.id].resposta === 'Sim' })
      var doPaciente = resp.some(function (r) { return r.preenchido_por === 'Paciente (link)' })
      if (alertas.length || doPaciente) {
        var aviso = document.createElement('div'); aviso.className = 'pc-box'; aviso.style.marginBottom = '16px'
        aviso.innerHTML = (alertas.length ? '<div class="pc-box-h" style="color:var(--red)">Atenção antes do atendimento</div>' + alertas.map(function (q) { var r = porId[q.id]; return '<div class="pc-item"><b>' + esc(q.pergunta) + '</b> Sim' + (r.descricao ? ' — ' + esc(r.descricao) : '') + '</div>' }).join('') : '') +
          (doPaciente ? '<div class="ag-hint" style="margin:' + (alertas.length ? '8px' : '0') + ' 0 0">Respondida pelo próprio paciente, pelo link.</div>' : '')
        wrap.parentNode.parentNode.insertBefore(aviso, wrap.parentNode.nextSibling)
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // MEDICAMENTOS NO RECEITUÁRIO
  // ════════════════════════════════════════════════════════════════
  function htmlReceita(itens) {
    var grupos = [['interno', 'Uso interno'], ['externo', 'Uso externo']]
    return grupos.map(function (g) {
      var xs = itens.filter(function (m) { return m.uso === g[0] })
      if (!xs.length) return ''
      return '<p><b>' + g[1] + '</b></p><ol>' + xs.map(function (m) { return '<li><b>' + esc(m.nome) + '</b>' + (m.quantidade ? ' — ' + esc(m.quantidade) : '') + (m.posologia ? '<br>' + esc(m.posologia) : '') + '</li>' }).join('') + '</ol>'
    }).join('')
  }
  // Abre a lista; ao confirmar, devolve o HTML pronto para o editor do documento
  async function escolherMedicamentos(aoInserir) {
    var d = await apiData('medicamentos', {}).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro ao carregar medicamentos')
    var lista = d.data, sel = {}
    modal('Medicamentos', '<div class="ag-f"><input class="ag-in" id="md-q" placeholder="Buscar medicamento"></div><div id="md-l" class="ex-med-lista"></div>' +
      '<p class="ag-hint">Ajuste quantidade e posologia só para esta receita. Para mudar a lista da clínica, use Configurações › Prontuário › Medicamentos.</p>',
      '<span class="ag-hint" id="md-n" style="margin:0 auto 0 0">Nenhum selecionado</span><button class="btn" id="md-c">Cancelar</button><button class="ag-btn-novo" id="md-ok">Inserir na receita</button>', 720)
    function desenhar() {
      var t = v('md-q').toLowerCase()
      el('md-l').innerHTML = lista.filter(function (m) { return !t || m.nome.toLowerCase().indexOf(t) >= 0 }).map(function (m) {
        var s = sel[m.id]
        return '<div class="ex-med' + (s ? ' on' : '') + '"><label class="ag-chk" style="margin:0"><input type="checkbox" data-id="' + m.id + '"' + (s ? ' checked' : '') + '> <span><b style="color:var(--text);font-weight:500">' + esc(m.nome) + '</b> <span class="ag-hint" style="margin:0">' + esc([m.apresentacao, m.uso === 'externo' ? 'uso externo' : ''].filter(Boolean).join(' · ')) + '</span></span></label>' +
          (s ? '<div class="ag-row c2" style="margin-top:8px"><div class="ag-f"><label>Quantidade</label><input class="ag-in" data-q="' + m.id + '" value="' + esc(s.quantidade) + '"></div><div class="ag-f"><label>Posologia</label><input class="ag-in" data-p="' + m.id + '" value="' + esc(s.posologia) + '"></div></div>' : '') + '</div>'
      }).join('') || '<div class="pc-vazio">Nenhum medicamento encontrado.</div>'
      el('md-l').querySelectorAll('[data-id]').forEach(function (c) { c.onchange = function () { var id = +this.getAttribute('data-id'), m = lista.filter(function (x) { return x.id === id })[0]; if (this.checked) sel[id] = Object.assign({}, m); else delete sel[id]; desenhar() } })
      el('md-l').querySelectorAll('[data-q]').forEach(function (i) { i.oninput = function () { sel[+this.getAttribute('data-q')].quantidade = this.value } })
      el('md-l').querySelectorAll('[data-p]').forEach(function (i) { i.oninput = function () { sel[+this.getAttribute('data-p')].posologia = this.value } })
      var n = Object.keys(sel).length
      el('md-n').textContent = n ? n + ' selecionado(s)' : 'Nenhum selecionado'
    }
    el('md-q').oninput = desenhar
    el('md-c').onclick = fechar
    el('md-ok').onclick = function () {
      var itens = lista.filter(function (m) { return sel[m.id] }).map(function (m) { return sel[m.id] })
      if (!itens.length) return erro('Marque ao menos um medicamento.')
      fechar(); aoInserir(htmlReceita(itens))
    }
    desenhar()
  }

  // ════════════════════════════════════════════════════════════════
  // CONFIGURAÇÕES › Prontuário (anamnese, medicamentos) e Agenda (check-in)
  // ════════════════════════════════════════════════════════════════
  async function cfgAnamnese(box) {
    var d = await apiData('anamnese-modelo', {}).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) { box.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    var ps = d.data
    box.innerHTML = '<div class="pc-box"><p class="ag-hint" style="margin-top:0">Vale para o preenchimento na clínica e pelo link enviado ao paciente. Marque "Alerta" nas perguntas em que um "Sim" precisa ser visto antes do atendimento.</p>' +
      (ps.length ? ps.map(function (p, i) {
        return '<div class="ex-perg"><span class="ex-perg-n">' + (i + 1) + '</span><input class="ag-in" data-txt="' + p.id + '" value="' + esc(p.pergunta) + '" maxlength="300">' +
          '<select class="ag-in" data-tipo="' + p.id + '"><option value="YES_NO"' + (p.tipo === 'YES_NO' ? ' selected' : '') + '>Sim / Não</option><option value="DESC"' + (p.tipo === 'DESC' ? ' selected' : '') + '>Texto livre</option></select>' +
          '<label class="ag-chk" style="margin:0"><input type="checkbox" data-al="' + p.id + '"' + (p.alerta ? ' checked' : '') + '> Alerta</label>' +
          '<span class="ex-perg-ac"><button class="ag-ico" data-sobe="' + i + '" title="Subir"' + (i ? '' : ' disabled') + '>↑</button><button class="ag-ico" data-desce="' + i + '" title="Descer"' + (i < ps.length - 1 ? '' : ' disabled') + '>↓</button><button class="ag-ico" data-rm="' + p.id + '" title="Remover" style="color:var(--red)">✕</button></span></div>'
      }).join('') : '<div class="pc-vazio">Nenhuma pergunta.</div>') +
      '<div class="ex-perg" style="margin-top:16px"><span class="ex-perg-n">+</span><input class="ag-in" id="ap-nova" placeholder="Nova pergunta" maxlength="300"><select class="ag-in" id="ap-tipo"><option value="YES_NO">Sim / Não</option><option value="DESC">Texto livre</option></select><label class="ag-chk" style="margin:0"><input type="checkbox" id="ap-al"> Alerta</label><span class="ex-perg-ac"><button class="ag-btn-novo" id="ap-add">Adicionar</button></span></div></div>'
    function recarregar() { cfgAnamnese(box) }
    async function salvarP(id) { var r = await apiPost('anamnese-modelo', { id: id, pergunta: box.querySelector('[data-txt="' + id + '"]').value, tipo: box.querySelector('[data-tipo="' + id + '"]').value, alerta: box.querySelector('[data-al="' + id + '"]').checked }); if (!r.success) alert(r.error) }
    box.querySelectorAll('[data-txt]').forEach(function (i) { i.onchange = function () { salvarP(+this.getAttribute('data-txt')) } })
    box.querySelectorAll('[data-tipo],[data-al]').forEach(function (i) { i.onchange = function () { salvarP(+(this.getAttribute('data-tipo') || this.getAttribute('data-al'))) } })
    function mover(i, j) { var ids = ps.map(function (p) { return p.id }), t = ids[i]; ids[i] = ids[j]; ids[j] = t; apiPost('anamnese-modelo', { action: 'ordenar', ids: ids }).then(recarregar) }
    box.querySelectorAll('[data-sobe]').forEach(function (b) { b.onclick = function () { var i = +this.getAttribute('data-sobe'); mover(i, i - 1) } })
    box.querySelectorAll('[data-desce]').forEach(function (b) { b.onclick = function () { var i = +this.getAttribute('data-desce'); mover(i, i + 1) } })
    box.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = async function () { if (!confirm('Remover esta pergunta? As respostas já dadas continuam no prontuário.')) return; await apiPost('anamnese-modelo', { action: 'excluir', id: +this.getAttribute('data-rm') }); recarregar() } })
    el('ap-add').onclick = async function () { var r = await apiPost('anamnese-modelo', { pergunta: v('ap-nova'), tipo: v('ap-tipo'), alerta: el('ap-al').checked }); if (!r.success) return alert(r.error); _anamnesePerguntas = null; recarregar() }
    _anamnesePerguntas = null // a aba do prontuário recarrega o questionário atualizado
  }

  async function cfgMedicamentos(box) {
    var d = await apiData('medicamentos', {}).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) { box.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    var edita = pode('pacientes.prescricoes')
    box.innerHTML = '<div class="pc-box" style="padding:0"><div style="padding:16px 16px 0;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><p class="ag-hint" style="margin:0;flex:1">Lista usada ao emitir receituários. A lista inicial traz sugestões para adultos; revise as posologias conforme a sua prática.</p>' + (edita ? '<button class="ag-btn-novo" id="md-novo">+ Medicamento</button>' : '') + '</div>' +
      '<div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Medicamento</th><th class="hide-sm">Quantidade</th><th class="hide-sm">Posologia</th><th>Uso</th><th></th></tr></thead><tbody>' +
      d.data.map(function (m) { return '<tr><td>' + esc(m.nome) + (m.apresentacao ? '<div class="ag-hint" style="margin:0">' + esc(m.apresentacao) + '</div>' : '') + '</td><td class="hide-sm">' + esc(m.quantidade || '—') + '</td><td class="hide-sm">' + esc(m.posologia || '—') + '</td><td>' + (m.uso === 'externo' ? 'Externo' : 'Interno') + '</td><td style="text-align:right;white-space:nowrap">' + (edita ? '<button class="btn btn-sm" data-ed="' + m.id + '">Editar</button>' : '') + '</td></tr>' }).join('') +
      '</tbody></table></div></div>'
    function editar(m) {
      m = m || { uso: 'interno' }
      modal(m.id ? 'Editar medicamento' : 'Novo medicamento', '<div class="ag-f"><label>Nome e concentração</label><input class="ag-in" id="me-nome" maxlength="160" placeholder="Ex.: Amoxicilina 500 mg" value="' + esc(m.nome || '') + '"></div>' +
        '<div class="ag-row c3"><div class="ag-f"><label>Apresentação</label><input class="ag-in" id="me-apr" maxlength="80" placeholder="Comprimido" value="' + esc(m.apresentacao || '') + '"></div><div class="ag-f"><label>Quantidade</label><input class="ag-in" id="me-qtd" maxlength="80" placeholder="21 cápsulas" value="' + esc(m.quantidade || '') + '"></div><div class="ag-f"><label>Uso</label><select class="ag-in" id="me-uso"><option value="interno">Interno</option><option value="externo"' + (m.uso === 'externo' ? ' selected' : '') + '>Externo</option></select></div></div>' +
        '<div class="ag-f"><label>Posologia</label><textarea class="ag-in" id="me-pos" rows="2" maxlength="500">' + esc(m.posologia || '') + '</textarea></div>',
        (m.id ? '<button class="btn" id="me-del" style="color:var(--red);margin-right:auto">Remover</button>' : '') + '<button class="btn" id="me-c">Cancelar</button><button class="ag-btn-novo" id="me-ok">Salvar</button>', 620)
      el('me-c').onclick = fechar
      if (el('me-del')) el('me-del').onclick = async function () { if (!confirm('Remover ' + m.nome + ' da lista?')) return; await apiPost('medicamentos', { action: 'excluir', id: m.id }); fechar(); cfgMedicamentos(box) }
      el('me-ok').onclick = async function () { var r = await apiPost('medicamentos', { id: m.id, nome: v('me-nome'), apresentacao: v('me-apr'), quantidade: v('me-qtd'), uso: v('me-uso'), posologia: v('me-pos') }); if (!r.success) return erro(r.error); fechar(); cfgMedicamentos(box) }
    }
    if (el('md-novo')) el('md-novo').onclick = function () { editar(null) }
    box.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { var id = +this.getAttribute('data-ed'); editar(d.data.filter(function (m) { return m.id === id })[0]) } })
  }

  function svgQr(url, cel) {
    if (typeof qrcode !== 'function') return '<div class="ag-err">Não foi possível gerar o QR Code (biblioteca não carregou).</div>'
    var qr = qrcode(0, 'M'); qr.addData(url); qr.make()
    return qr.createSvgTag({ cellSize: cel || 6, margin: 2, scalable: true })
  }
  async function cfgCheckin(box) {
    var d = await apiData('checkin-config', {}).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) { box.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    var url = location.origin + d.caminho
    box.innerHTML = '<div class="ex-ck"><div class="pc-box ex-ck-qr"><div class="ex-ck-svg">' + svgQr(url) + '</div><div class="fn-acoes" style="justify-content:center;margin-top:12px"><button class="ag-btn-novo" id="ck-imp">Imprimir cartaz</button><button class="btn" id="ck-cop">Copiar link</button></div></div>' +
      '<div class="pc-box" style="flex:1;min-width:0"><div class="pc-box-h">Como funciona</div><p class="ag-hint" style="margin-top:0">Deixe o cartaz na recepção. O paciente aponta a câmera do celular, informa o CPF (ou a data de nascimento e o final do telefone) e a consulta de hoje passa para <b>Em espera</b> na agenda, com a hora de chegada.</p>' +
      '<div class="pc-box-h" style="margin-top:20px">Chegadas de hoje</div>' + (d.chegadas.length ? d.chegadas.map(function (x) { return '<div class="pc-item"><b>' + esc(x.paciente_nome) + '</b> chegou às ' + esc(x.chegada) + ' · consulta ' + esc(x.hora) + (x.profissional ? ' com ' + esc(x.profissional) : '') + '</div>' }).join('') : '<div class="pc-vazio" style="padding:8px 0;text-align:left">Ninguém fez check-in hoje.</div>') +
      (isAdmin() ? '<p class="ag-hint" style="margin-top:20px">Se o cartaz vazar para fora da clínica, gere um novo: o QR antigo para de funcionar. <a href="#" id="ck-ren" style="color:var(--red)">Gerar novo QR Code</a></p>' : '') + '</div></div>'
    el('ck-cop').onclick = function () { try { navigator.clipboard.writeText(url) } catch (e) {} this.textContent = 'Copiado' }
    if (el('ck-ren')) el('ck-ren').onclick = async function (e) { e.preventDefault(); if (!confirm('Gerar um novo QR Code? O cartaz atual deixa de funcionar.')) return; var r = await apiPost('checkin-config', { action: 'renovar' }); if (!r.success) return alert(r.error); cfgCheckin(box) }
    el('ck-imp').onclick = function () {
      var w = window.open('', '_blank'); if (!w) return alert('Permita pop-ups para imprimir.')
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Check-in</title><style>body{font-family:Roboto,Arial,sans-serif;text-align:center;color:#1A1A1A;padding:48px 24px}h1{font-size:40px;font-weight:500;margin:0 0 8px;color:#034030}p{font-size:20px;color:#424242;margin:0 0 32px}.q{width:420px;max-width:90%;margin:0 auto}.q svg{width:100%;height:auto}small{display:block;margin-top:32px;font-size:16px;color:#757575}</style></head><body>' +
        '<h1>Faça seu check-in</h1><p>Aponte a câmera do celular para o código e avise que chegou.</p><div class="q">' + svgQr(url, 10) + '</div><small>' + esc(d.clinica) + '</small><script>window.onload=function(){window.print()}<\/script></body></html>')
      w.document.close()
    }
  }

  window.enviarLinkAnamnese = enviarLinkAnamnese
  window.escolherMedicamentos = escolherMedicamentos
  window.cfgAnamnese = cfgAnamnese
  window.cfgMedicamentos = cfgMedicamentos
  window.cfgCheckin = cfgCheckin

  window.loadEstoque = loadEstoque
  window.loadProtetico = loadProtetico
  window.loadIndicacao = loadIndicacao
})()
