// public/planos.js — Planos: Plano Próprio e Plano Recorrente (sem cobrança automática)
// Klinov — Campo Grande, MS
//
// Tela #p-planos e quadro de planos no financeiro do paciente, com os campos, as
// etapas e os textos do módulo Planos do Clinicorp. A baixa reaproveita o modal de
// Contas a Receber. Regras no servidor (lib/rotas/planos.js).
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function isAdm() { return typeof isAdmin === 'function' ? isAdmin() : false }
  function pode(r) { return isAdm() || !window.ST || !ST.permissoes || ST.permissoes[r] === 1 }
  function K() { return window.KFIN }
  function moeda(v) { return K().moeda(v) }
  function br(d) { return d ? K().br(String(d).slice(0, 10)) : '—' }
  function numBr(v) { return v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ',') }
  function lerNum(v) { var n = Number(String(v == null ? '' : v).replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0 }

  var PERIODOS = [['mensal', 'Mensal', 'A cada 1 mês'], ['bimestral', 'Bimestral', 'A cada 2 meses'], ['trimestral', 'Trimestral', 'A cada 3 meses'], ['semestral', 'Semestral', 'A cada 6 meses'], ['outros', 'Outros', 'Definir intervalo']]
  var MESES_PER = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6 }
  var SIT = { em_dia: ['Em dia', 'ok'], atrasado: ['Inadimplente', 'err'], concluido: ['Finalizado', 'info'], cancelado: ['Inativo', 'off'] }
  var LIB_PROPRIO = [['contratacao', 'Após contratação', 'Liberação imediata ao contratar o plano.'], ['taxa', 'Após pagamento da taxa de adesão', 'Liberado quando a taxa for confirmada.'], ['taxa_parcela', 'Taxa de adesão + 1ª parcela', 'Liberado após ambas as cobranças confirmadas.'], ['parcelas', 'Após pagamento de parcelas', 'Liberado ao confirmar o número de parcelas definido.']]
  var F = { aba: 'planos', plano_id: '', situacao: 'todos', status: 'todos', tipo: 'todos', busca: '' }
  var CACHE = { planos: [], tabelas: [] }

  function tipoNome(t) { return t === 'proprio' ? 'Próprio' : 'Recorrente' }
  function rotuloPeriodo(p) {
    if (p.tipo === 'proprio') return p.modo_cobranca === 'total' ? 'Valor total' : 'Valor mensal'
    if (p.periodicidade === 'outros') return 'A cada ' + Number(p.intervalo_meses) + (Number(p.intervalo_meses) === 1 ? ' mês' : ' meses')
    var e = PERIODOS.filter(function (x) { return x[0] === p.periodicidade })[0]
    return e ? e[1] : '—'
  }
  function rotuloLiberacao(p) {
    var lib = p.liberacao, n = Number(p.liberar_a_cada) || 1
    if (p.tipo === 'proprio' || p.plano_tipo === 'proprio') {
      if (lib === 'parcelas') return 'Após o pagamento de ' + n + (n === 1 ? ' parcela' : ' parcelas')
      var e = LIB_PROPRIO.filter(function (x) { return x[0] === (lib || 'contratacao') })[0]
      return e ? e[1] : 'Após contratação'
    }
    return n === 1 ? 'A cada pagamento' : 'Após o pagamento de ' + n + ' parcelas'
  }
  function nomeParcela(p, proprio) { return Number(p.numero) === 0 ? 'Taxa de adesão' : (proprio ? 'Parcela ' : 'Mensalidade ') + p.numero }
  function kpi(rot, valor, cor) { return '<div class="pc-box fn-kpi' + (cor ? ' ' + cor : '') + '"><div class="pc-box-h" style="margin-bottom:8px">' + esc(rot) + '</div><div class="fn-kpi-v">' + esc(valor) + '</div></div>' }
  function falha(box, e) { box.innerHTML = '<div class="ag-err">' + esc((e && (e.error || e.message)) || 'Não foi possível carregar.') + '</div>' }
  function postar(rota, corpo) { return apiPost(rota, corpo).catch(function (e) { return { success: false, error: e.message } }) }
  function aviso(r) { alert((r.titulo ? r.titulo + '\n\n' : '') + (r.error || 'Erro')) }
  function opcao(nome, valor, marcado, titulo, desc, extra) {
    return '<label class="pl-op' + (marcado ? ' on' : '') + '"><input type="radio" name="' + nome + '" value="' + esc(valor) + '"' + (marcado ? ' checked' : '') + (extra || '') + '><span><b>' + esc(titulo) + '</b>' + (desc ? '<small>' + esc(desc) + '</small>' : '') + '</span></label>'
  }
  function marcarOps(box) { box.querySelectorAll('.pl-op input').forEach(function (i) { i.closest('.pl-op').classList.toggle('on', i.checked) }) }
  function radio(nome) { var x = document.querySelector('input[name="' + nome + '"]:checked'); return x ? x.value : '' }

  // ── Tela ──────────────────────────────────────────────────────
  function desenhar() {
    var pg = el('p-planos'); if (!pg) return
    var corpo = pg.querySelector('.gpage-body'); if (!corpo) return
    corpo.style.maxWidth = '1200px'
    corpo.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:16px"><div><div class="ag-hint" style="margin:0">Crie e gerencie planos próprios e de receita recorrente vinculados aos seus pacientes.</div></div>' +
        '<div class="fn-acoes"><button class="btn" id="pr-sobre">Sobre os Planos Recorrentes</button><button class="ag-btn-novo" id="pr-novo">Criar plano</button></div></div>' +
      '<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">' +
        '<div class="fin-htab' + (F.aba === 'planos' ? ' active' : '') + '" data-aba="planos">Planos</div>' +
        '<div class="fin-htab' + (F.aba === 'pacientes' ? ' active' : '') + '" data-aba="pacientes">Pacientes nos planos</div></div>' +
      '<div id="pr-res"><div class="pc-vazio" style="padding:32px 0">Carregando...</div></div>'
    corpo.querySelectorAll('[data-aba]').forEach(function (t) { t.onclick = function () { F.aba = t.getAttribute('data-aba'); desenhar() } })
    el('pr-novo').onclick = function () { formPlano(null) }
    el('pr-sobre').onclick = sobre
    if (F.aba === 'planos') carregarPlanos(); else carregarPacientes()
  }

  function sobre() {
    K().modal('Sobre os Planos', '<p style="margin-top:0">Como criar e acompanhar seus Planos.</p><div class="pc-box-h">Como funciona</div>' +
      '<div class="pl-passos"><div><b>Crie e associe</b><span>Monte o plano e vincule a um paciente.</span></div><div><b>Cobrança automática</b><span>As parcelas são geradas automaticamente.</span></div><div><b>Definição de procedimentos</b><span>Defina os procedimentos dos Planos.</span></div></div>' +
      '<div class="pc-box-h" style="margin-top:16px">Onde acompanhar</div><div class="pl-passos"><div><b>Financeiro do paciente</b><span>Cobranças e parcelas do plano.</span></div><div><b>Plano de tratamento</b><span>Procedimentos liberados.</span></div><div><b>Visão geral dos planos</b><span>Aba "Pacientes nos planos".</span></div></div>' +
      '<p class="ag-hint">No Klinov as parcelas ficam em Contas a Receber e são recebidas manualmente; nenhuma cobrança é enviada ao paciente.</p>',
      '<button class="ag-btn-novo" id="pl-entendi">Entendi</button>', 620)
    el('pl-entendi').onclick = K().fechar
  }

  async function buscarPlanos() {
    var d = await apiData('planos-recorrentes', {})
    if (!d.success) throw new Error(d.error || 'Erro')
    CACHE.planos = d.data; CACHE.tabelas = d.tabelas
    return d
  }

  async function carregarPlanos() {
    var box = el('pr-res'); if (!box) return
    try { await buscarPlanos() } catch (e) { return falha(box, e) }
    if (!el('pr-res')) return
    if (!CACHE.planos.length) return vazioInicial(box)
    box.innerHTML = '<div class="fn-filtros"><div class="ag-f"><label for="pr-st">Status</label><select class="ag-in" id="pr-st"><option value="todos">Todos os status</option><option value="1">Ativo</option><option value="0">Inativo</option></select></div>' +
      '<div class="ag-f"><label for="pr-tp">Tipo</label><select class="ag-in" id="pr-tp"><option value="todos">Todos os tipos</option><option value="proprio">Próprio</option><option value="recorrente">Recorrente</option></select></div>' +
      '<button class="btn" id="pr-lst">Listar</button></div><div id="pr-tab" style="margin-top:16px"></div>'
    el('pr-st').value = F.status; el('pr-tp').value = F.tipo
    el('pr-lst').onclick = function () { F.status = el('pr-st').value; F.tipo = el('pr-tp').value; tabelaPlanos() }
    tabelaPlanos()
  }

  function vazioInicial(box) {
    box.innerHTML = '<div class="pc-box" style="padding:32px 24px"><div style="font-size:20px;font-weight:500;color:var(--text);text-align:center">Transforme a forma como sua clínica cresce e fatura</div>' +
      '<p class="ag-hint" style="text-align:center;margin:8px 0 24px">Crie planos, feche mais tratamentos e movimente seu fluxo de caixa com uma dinâmica de pagamento versátil e integrada</p><div class="ag-row c2">' +
      '<div class="pc-box"><div class="pc-box-h">Plano Próprio</div><b style="color:var(--text)">Novos públicos, mais tratamentos fechados.</b><p class="ag-hint">Planos com a cara da sua clínica, que facilitam o "sim" do paciente sem depender de convênios ou terceiros.</p>' +
        '<ul class="pl-lista"><li><b>Menos objeção a preço:</b> condições personalizadas que facilitam o fechamento na primeira consulta</li><li><b>Novas fontes de pacientes:</b> empresas, famílias e grupos entram juntos, gerando indicações</li><li><b>Meios de pagamentos integrados:</b> as parcelas entram em Contas a Receber com a baixa no sistema</li></ul>' +
        '<button class="ag-btn-novo" data-cria="proprio">Criar meu plano próprio</button></div>' +
      '<div class="pc-box"><div class="pc-box-h">Plano Recorrente</div><b style="color:var(--text)">Caixa girando todos os meses.</b><p class="ag-hint">Tratamentos longos viram mensalidades que cabem no bolso do paciente, e a clínica recebe todo mês, sem depender de "meses bons".</p>' +
        '<ul class="pl-lista"><li><b>Ticket maior, parcela menor:</b> ideal para ortodontia, prevenção e estética</li><li><b>Menos inadimplência:</b> mensalidades organizadas e atrasos à vista</li><li><b>Pacientes fiéis:</b> quem assina volta, mantém a agenda ocupada e indica a clínica</li></ul>' +
        '<button class="ag-btn-novo" data-cria="recorrente">Criar meu plano recorrente</button></div></div></div>'
    box.querySelectorAll('[data-cria]').forEach(function (b) { b.onclick = function () { formPlano(null, b.getAttribute('data-cria')) } })
  }

  function tabelaPlanos() {
    var box = el('pr-tab'); if (!box) return
    var lista = CACHE.planos.filter(function (p) { return (F.status === 'todos' || String(Number(p.ativo)) === F.status) && (F.tipo === 'todos' || p.tipo === F.tipo) })
    box.innerHTML = lista.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th class="hide-sm">Data criação</th><th class="hide-sm">Data alteração</th><th>Status</th><th>Nome</th><th class="hide-sm">Observações</th><th class="fn-num">Pacientes</th><th class="fn-num">Inadimplentes</th><th>Tipo de plano</th><th></th></tr></thead><tbody>' +
      lista.map(function (p) {
        var i = CACHE.planos.indexOf(p), at = Number(p.ativo)
        return '<tr><td class="hide-sm">' + br(p.criado_em) + '</td><td class="hide-sm">' + br(p.atualizado_em || p.criado_em) + '</td><td><span class="pc-badge ' + (at ? 'ok' : 'off') + '">' + (at ? 'Ativo' : 'Inativo') + '</span></td>' +
          '<td class="pname">' + esc(p.nome) + '<div class="ag-hint" style="margin:2px 0 0">' + esc(rotuloPeriodo(p)) + ' · ' + moeda(p.valor) + (p.tipo === 'proprio' ? ' por pessoa' : '') + '</div></td>' +
          '<td class="hide-sm" style="max-width:220px">' + esc(p.observacoes || '—') + '</td><td class="fn-num">' + Number(p.adesoes_ativas) + '</td><td class="fn-num"' + (Number(p.inadimplentes) ? ' style="color:var(--red)"' : '') + '>' + Number(p.inadimplentes || 0) + '</td>' +
          '<td><span class="pc-badge ' + (p.tipo === 'proprio' ? 'info' : 'pend') + '">' + tipoNome(p.tipo) + '</span></td>' +
          '<td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-ver="' + i + '">Ver pacientes</button> ' + (at ? '<button class="btn btn-sm btn-primary" data-add="' + i + '">Adicionar pacientes</button> ' : '') +
            '<select class="ag-in pl-acoes" data-ac="' + i + '" aria-label="Ações do plano"><option value="">Ações do plano</option><option value="edit">Editar</option><option value="' + (at ? 'off' : 'on') + '">' + (at ? 'Inativar' : 'Ativar') + '</option><option value="del">Excluir</option></select></td></tr>'
      }).join('') + '</tbody></table></div></div>'
      : '<div class="pc-box"><div class="pc-vazio" style="padding:32px 0;text-align:center"><b>Nenhum plano encontrado</b><div class="ag-hint">Ajuste os filtros de status ou tipo e clique em Listar.</div></div></div>'
    box.querySelectorAll('[data-add]').forEach(function (b) { b.onclick = function () { formAdesao(CACHE.planos[+b.getAttribute('data-add')], null, carregarPlanos) } })
    box.querySelectorAll('[data-ver]').forEach(function (b) { b.onclick = function () { F.plano_id = String(CACHE.planos[+b.getAttribute('data-ver')].id); F.situacao = 'todos'; F.aba = 'pacientes'; desenhar() } })
    box.querySelectorAll('[data-ac]').forEach(function (s) {
      s.onchange = async function () {
        var p = CACHE.planos[+s.getAttribute('data-ac')], ac = s.value; s.value = ''
        if (ac === 'edit') return formPlano(p)
        if (ac === 'on' || ac === 'off') {
          if (!confirm((ac === 'on' ? 'Ativar' : 'Inativar') + ' o plano "' + p.nome + '"?')) return
          var r = await postar('planos-recorrentes', { action: 'ativo', id: p.id, ativo: ac === 'on' })
          if (!r.success) aviso(r)
          return carregarPlanos()
        }
        if (ac === 'del') {
          if (!confirm('Excluir plano?\n\nTem certeza que deseja excluir o plano "' + p.nome + '"? Esta ação não pode ser desfeita.')) return
          var x = await postar('planos-recorrentes', { action: 'excluir', id: p.id })
          if (!x.success) aviso(x)
          carregarPlanos()
        }
      }
    })
  }

  // ── Criar / editar plano (4 etapas) ───────────────────────────
  function formPlano(p, tipoInicial) {
    var novo = !p
    var d = p ? JSON.parse(JSON.stringify(p)) : { tipo: tipoInicial || '', nome: '', observacoes: '', tabela_preco: CACHE.tabelas.indexOf('PARTICULAR') >= 0 ? 'PARTICULAR' : CACHE.tabelas[0], periodicidade: 'mensal', intervalo_meses: 1, valor: '', duracao_meses: null, liberar_a_cada: 1, alerta_retorno: 1, procedimentos: [], modo_cobranca: 'mensal', taxa_adesao: 0, valor_taxa: null, juros_atraso: 0, liberacao: 'contratacao', faixas: [] }
    var procs = d.procedimentos.slice(), faixas = (d.faixas || []).slice(), etapa = 0, disponiveis = null
    var ETAPAS = [['Tipo de plano', 'Modelo, nome e observações'], ['Procedimentos', 'Tabela e itens cobertos'], ['Cobrança', 'Valores, parcelas e juros'], ['Outras regras', 'Liberação e vigência']]
    K().modal(novo ? 'Criar plano' : 'Editar plano', '<div id="fn-err"></div><p class="ag-hint" style="margin-top:0">Complete as etapas para configurar o plano.</p>' +
      '<div class="pl-etapas">' + ETAPAS.map(function (e, i) { return '<div data-et="' + i + '"><b>' + (i + 1) + '. ' + e[0] + '</b><small>' + e[1] + '</small></div>' }).join('') + '</div><div id="pl-corpo"></div>',
      '<button class="btn" id="pf-c">Cancelar</button><button class="btn" id="pf-v">Voltar</button><button class="ag-btn-novo" id="pf-ok">Próximo</button>', 820)

    function guardar() {
      if (el('pf-nm')) { d.nome = el('pf-nm').value; d.observacoes = el('pf-obs').value; var t = radio('pf-tipo'); if (t) d.tipo = t }
      if (el('pf-tab')) d.tabela_preco = el('pf-tab').value
      if (el('pf-val')) {
        d.valor = el('pf-val').value
        if (d.tipo === 'proprio') d.modo_cobranca = radio('pf-modo') || 'mensal'
        else { d.periodicidade = radio('pf-per') || 'mensal'; d.intervalo_meses = d.periodicidade === 'outros' ? el('pf-int').value : MESES_PER[d.periodicidade] }
        d.taxa_adesao = el('pf-tx').checked ? 1 : 0; d.valor_taxa = el('pf-vtx').value; d.juros_atraso = el('pf-jur').checked ? 1 : 0
      }
      if (el('pf-dur')) {
        d.duracao_meses = radio('pf-vig') === 'fixo' ? el('pf-dur').value : null
        if (d.tipo === 'proprio') { d.liberacao = radio('pf-lib') || 'contratacao'; d.liberar_a_cada = d.liberacao === 'parcelas' ? el('pf-np').value : 1 }
        else { d.liberacao = radio('pf-lib') || 'cada'; d.liberar_a_cada = d.liberacao === 'parcelas' ? el('pf-np').value : 1 }
        d.alerta_retorno = el('pf-ret').checked ? 1 : 0
        if (el('pl-fx')) faixas = Array.prototype.map.call(el('pl-fx').querySelectorAll('[data-fx]'), function (r) { return { a_partir_de: r.querySelector('[data-c="ap"]').value, valor: r.querySelector('[data-c="v"]').value } })
      }
    }
    function validarEtapa() {
      if (etapa === 0) { if (!d.tipo) return 'Selecione o tipo de plano.'; if (!String(d.nome).trim()) return 'Dê um nome ao plano' }
      if (etapa === 1) { if (!d.tabela_preco) return 'Selecione uma tabela de preços.'; if (!procs.length) return 'Selecione ao menos um procedimento para o plano.' }
      if (etapa === 2) { if (!(lerNum(d.valor) > 0)) return 'Informe o valor da cobrança.' }
      return ''
    }
    function cabecalho() {
      document.querySelectorAll('.pl-etapas [data-et]').forEach(function (x) { var i = +x.getAttribute('data-et'); x.className = i === etapa ? 'on' : (i < etapa ? 'ok' : '') })
      el('pf-v').style.display = etapa ? '' : 'none'
      el('pf-ok').textContent = etapa === 3 ? (novo ? 'Criar plano' : 'Salvar alterações') : 'Próximo'
      K().erro('')
    }
    function render() {
      cabecalho()
      var c = el('pl-corpo'), prop = d.tipo === 'proprio'
      if (etapa === 0) {
        c.innerHTML = '<p>Para começar, selecione o <b>tipo de plano</b> que deseja criar:</p>' + (!CACHE.tabelas.length ? '<div class="ag-err">Para cadastrar esse plano, é necessário ter uma tabela de preço cadastrada.</div>' : '') +
          '<div class="ag-row c2">' + opcao('pf-tipo', 'proprio', d.tipo === 'proprio', 'Plano Próprio', 'Estruture planos exclusivos para empresas, famílias e pacientes fidelizados, sem depender de convênios.', novo ? '' : ' disabled') +
            opcao('pf-tipo', 'recorrente', d.tipo === 'recorrente', 'Plano Recorrente', 'Ideal para tratamentos contínuos, com pagamentos mensais e previsibilidade para a clínica.', novo ? '' : ' disabled') + '</div>' +
          '<div class="ag-f" style="margin-top:12px"><label for="pf-nm">Nome do plano</label><input class="ag-in" id="pf-nm" maxlength="120" placeholder="Ex: Digite o nome do plano" value="' + esc(d.nome) + '"></div>' +
          '<div class="ag-f"><label for="pf-obs">Observações</label><textarea class="ag-in" id="pf-obs" rows="2" maxlength="1000" placeholder="Ex: Descrição do plano">' + esc(d.observacoes || '') + '</textarea></div>'
        c.querySelectorAll('input[name="pf-tipo"]').forEach(function (i) { i.onchange = function () { marcarOps(c) } })
      } else if (etapa === 1) {
        c.innerHTML = '<div class="pc-box-h">Plano ' + esc(d.nome) + '</div><div class="ag-row c2"><div class="ag-f"><label for="pf-tab">Tabela de preço</label><select class="ag-in" id="pf-tab"><option value="">Selecione uma tabela de preços</option>' + CACHE.tabelas.map(function (t) { return '<option' + (t === d.tabela_preco ? ' selected' : '') + '>' + esc(t) + '</option>' }).join('') + '</select></div>' +
          '<div class="ag-f"><label for="pf-flt">Filtrar...</label><input class="ag-in" id="pf-flt" placeholder="Filtrar..." autocomplete="off"></div></div>' +
          (prop ? '' : '<p class="ag-hint" style="margin-top:0">Combine procedimentos de diferentes tabelas para criar um plano personalizado. Os procedimentos já adicionados serão mantidos.</p>') +
          '<div class="pl-dual"><div><div class="pl-dual-h">Disponíveis <a href="#" id="pf-all">Adicionar todos</a></div><div id="pf-disp" class="pl-dual-l"></div></div><div><div class="pl-dual-h">Incluídos <a href="#" id="pf-none">Remover todos</a></div><div id="pf-inc" class="pl-dual-l"></div></div></div><div class="ag-hint" id="pf-sum"></div>'
        async function carregar() {
          disponiveis = null; desenharDual()
          if (!el('pf-tab') || !el('pf-tab').value) return
          var r = await apiData('planos-recorrentes', { tabela_procs: el('pf-tab').value }).catch(function () { return {} })
          if (!el('pf-disp')) return
          disponiveis = (r && r.procedimentos) || []
          desenharDual()
        }
        function desenharDual() {
          if (!el('pf-disp')) return
          var f = (el('pf-flt').value || '').toLowerCase()
          var disp = (disponiveis || []).filter(function (n) { return procs.indexOf(n) < 0 && n.toLowerCase().indexOf(f) >= 0 })
          el('pf-disp').innerHTML = !el('pf-tab').value ? '<div class="ag-hint">Selecione uma tabela de preços para ver os procedimentos.</div>' : disponiveis === null ? '<div class="ag-hint">Carregando...</div>' :
            (disp.length ? disp.slice(0, 300).map(function (n) { return '<div class="pl-it" data-a="' + esc(n) + '">' + esc(n) + '</div>' }).join('') : '<div class="ag-hint">' + ((disponiveis || []).length ? (f ? 'Nenhum procedimento encontrado.' : 'Todos os procedimentos desta tabela já foram incluídos.') : 'Essa tabela de preço não tem procedimentos vinculados.') + '</div>')
          el('pf-inc').innerHTML = procs.length ? procs.map(function (n) { return '<div class="pl-it on" data-r="' + esc(n) + '">' + esc(n) + ' ✕</div>' }).join('') : '<div class="ag-hint">Nenhum incluído ainda. Clique nos itens à esquerda para adicionar.</div>'
          el('pf-sum').textContent = procs.length + ' procedimento(s) selecionado(s)'
          el('pf-disp').querySelectorAll('[data-a]').forEach(function (x) { x.onclick = function () { procs.push(x.getAttribute('data-a')); desenharDual() } })
          el('pf-inc').querySelectorAll('[data-r]').forEach(function (x) { x.onclick = function () { procs.splice(procs.indexOf(x.getAttribute('data-r')), 1); desenharDual() } })
        }
        el('pf-tab').onchange = carregar
        el('pf-flt').oninput = desenharDual
        el('pf-all').onclick = function (e) { e.preventDefault(); var f = (el('pf-flt').value || '').toLowerCase(); (disponiveis || []).forEach(function (n) { if (procs.indexOf(n) < 0 && n.toLowerCase().indexOf(f) >= 0) procs.push(n) }); desenharDual() }
        el('pf-none').onclick = function (e) { e.preventDefault(); procs = []; desenharDual() }
        carregar()
      } else if (etapa === 2) {
        c.innerHTML = '<div class="pc-box-h">Cobrança</div><p class="ag-hint" style="margin-top:0">' + (prop ? 'Defina como o plano será cobrado do paciente.' : 'Defina a frequência das cobranças após o pagamento da primeira parcela.') + '</p>' +
          (prop ? '<div class="ag-row c2">' + opcao('pf-modo', 'mensal', d.modo_cobranca !== 'total', 'Valor mensal', 'Valor recorrente por pessoa, cobrado mensalmente.') + opcao('pf-modo', 'total', d.modo_cobranca === 'total', 'Valor total', 'Pagamento único referente ao plano completo.') + '</div>'
            : '<div class="pc-box-h" style="margin-top:8px">Periodicidade</div><div class="pl-ops5">' + PERIODOS.map(function (x) { return opcao('pf-per', x[0], d.periodicidade === x[0], x[1], x[2]) }).join('') + '</div>' +
              '<div class="ag-row c3" id="pf-int-box"><div class="ag-f"><label for="pf-int">Cobrar a cada (meses)</label><input class="ag-in" id="pf-int" type="number" min="1" max="24" value="' + Number(d.intervalo_meses || 1) + '"></div></div>') +
          '<div class="ag-row c3" style="margin-top:12px"><div class="ag-f"><label for="pf-val" id="pf-val-l"></label><input class="ag-in" id="pf-val" inputmode="decimal" value="' + numBr(d.valor === '' ? null : d.valor) + '"></div></div>' +
          '<div class="pc-box-h" style="margin-top:12px">Opções adicionais</div>' +
          '<label class="ag-chk cf-chk"><input type="checkbox" id="pf-tx"' + (Number(d.taxa_adesao) ? ' checked' : '') + '> <span><b>Gerar taxa de adesão</b> — Cobrança única no início da contratação.</span></label>' +
          '<div class="ag-row c3" id="pf-vtx-box"><div class="ag-f"><label for="pf-vtx">Valor da taxa de adesão</label><input class="ag-in" id="pf-vtx" inputmode="decimal" value="' + numBr(d.valor_taxa) + '"><div class="ag-hint" style="margin:4px 0 0">Padrão: igual ao valor da cobrança. Cobrada por pessoa do plano.</div></div></div>' +
          '<label class="ag-chk cf-chk"><input type="checkbox" id="pf-jur"' + (Number(d.juros_atraso) ? ' checked' : '') + '> <span><b>' + (prop ? 'Cobrar juros por atraso' : 'Cobrar juros a partir do mês seguinte ao vencimento') + '</b> — ' + (prop ? 'Aplicado a partir do mês seguinte ao vencimento.' : 'Aplicado automaticamente em parcelas em atraso.') + ' Multa e juros de Configurações › Taxas e encargos.</span></label>'
        function vis() {
          marcarOps(c)
          el('pf-vtx-box').style.display = el('pf-tx').checked ? '' : 'none'
          if (el('pf-int-box')) el('pf-int-box').style.display = radio('pf-per') === 'outros' ? '' : 'none'
          el('pf-val-l').textContent = prop ? (radio('pf-modo') === 'total' ? 'Valor por pessoa' : 'Mensalidade por pessoa') : 'Valor da cobrança'
        }
        c.querySelectorAll('input').forEach(function (i) { i.addEventListener('change', vis) })
        vis()
      } else {
        var total = prop && d.modo_cobranca === 'total'
        var interv = prop ? (total ? Number(d.duracao_meses) || 1 : 1) : Number(d.intervalo_meses) || 1
        c.innerHTML = '<div class="pc-box-h">Vigência do plano</div><p class="ag-hint" style="margin-top:0">Configure o período de duração do plano.' + (total ? ' Valor total não admite duração indeterminada — defina um período.' : '') + '</p>' +
          '<div class="ag-row c2">' + opcao('pf-vig', 'ind', !d.duracao_meses && !total, 'Indeterminado', 'Renovação contínua sem prazo final.', total ? ' disabled' : '') + opcao('pf-vig', 'fixo', !!d.duracao_meses || total, 'Período definido', 'Encerra após o número de meses configurado.') + '</div>' +
          '<div class="ag-row c3" id="pf-dur-box"><div class="ag-f"><label for="pf-dur">Duração (meses)</label><input class="ag-in" id="pf-dur" type="number" min="' + (prop ? 1 : interv) + '" max="60" value="' + esc(d.duracao_meses || 12) + '">' + (prop ? '' : '<div class="ag-hint" style="margin:4px 0 0">Mínimo de ' + interv + ' meses, conforme a periodicidade de cobrança selecionada.</div>') + '</div></div>' +
          '<div class="pc-box-h" style="margin-top:12px">Liberação de procedimentos</div><p class="ag-hint" style="margin-top:0">' + (prop ? 'Determine quando o paciente poderá iniciar os procedimentos.' : 'Determine após quantos pagamentos os procedimentos estarão disponíveis para utilização.') + '</p>' +
          (prop ? '<div class="ag-row c2">' + LIB_PROPRIO.map(function (x) { return opcao('pf-lib', x[0], (d.liberacao || 'contratacao') === x[0], x[1], x[2]) }).join('') + '</div>'
            : '<div class="ag-row c2">' + opcao('pf-lib', 'cada', Number(d.liberar_a_cada) === 1, 'A cada pagamento', '') + opcao('pf-lib', 'parcelas', Number(d.liberar_a_cada) > 1, 'Após o pagamento de parcelas', '') + '</div>') +
          '<div class="ag-row c3" id="pf-np-box"><div class="ag-f"><label for="pf-np">Parcelas pagas</label><input class="ag-in" id="pf-np" type="number" min="1" max="60" value="' + Math.max(Number(d.liberar_a_cada) || 1, prop ? 1 : 2) + '"><div class="ag-hint" style="margin:4px 0 0" id="pf-np-h"></div></div></div>' +
          (prop ? '<div class="pc-box-h" style="margin-top:12px">Valores por quantidade de pacientes <span style="text-transform:none;letter-spacing:0">(opcional)</span></div><p class="ag-hint" style="margin-top:0">Configure descontos progressivos conforme o número de pacientes. Quanto maior o grupo, menor poderá ser o valor por pessoa.</p><div id="pl-fx"></div><button class="btn btn-sm" id="pf-fx-add" type="button">Adicionar faixa de valor</button>' : '') +
          '<div class="pc-box-h" style="margin-top:16px">Comunicação interna</div><p class="ag-hint" style="margin-top:0">Automações para a operação da clínica após a liberação do procedimento.</p>' +
          '<label class="ag-chk cf-chk"><input type="checkbox" id="pf-ret"' + (Number(d.alerta_retorno) ? ' checked' : '') + '> <span><b>Alerta de retorno na Agenda</b> — Cria automaticamente um lembrete para a secretária reagendar o paciente assim que o procedimento for liberado.</span></label>'
        function desenharFx() {
          var b = el('pl-fx'); if (!b) return
          b.innerHTML = faixas.length ? '<table class="pc-tbl"><thead><tr><th>A partir de (pessoas)</th><th>Valor por pessoa</th><th></th></tr></thead><tbody>' + faixas.map(function (f, i) { return '<tr data-fx="' + i + '"><td><input class="ag-in" data-c="ap" type="number" min="2" max="999" value="' + esc(f.a_partir_de || '') + '"></td><td><input class="ag-in" data-c="v" inputmode="decimal" aria-label="Valor por pessoa" value="' + numBr(f.valor === '' ? null : f.valor) + '"></td><td><a href="#" data-rmf="' + i + '" style="color:var(--red)">Remover faixa</a></td></tr>' }).join('') + '</tbody></table>' : ''
          b.querySelectorAll('[data-rmf]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); guardar(); faixas.splice(+a.getAttribute('data-rmf'), 1); desenharFx() } })
        }
        function vis() {
          marcarOps(c)
          el('pf-dur-box').style.display = radio('pf-vig') === 'fixo' ? '' : 'none'
          el('pf-np-box').style.display = radio('pf-lib') === 'parcelas' ? '' : 'none'
          var dur = radio('pf-vig') === 'fixo' ? Number(el('pf-dur').value) || 0 : 0
          var it = prop ? (total ? dur || 1 : 1) : interv
          el('pf-np-h').textContent = dur ? 'Máximo de ' + Math.ceil(dur / it) + ' parcelas para a vigência' + (prop ? ' definida.' : ' e a periodicidade definidas.') : ''
        }
        c.querySelectorAll('input').forEach(function (i) { i.addEventListener('change', vis); i.addEventListener('input', vis) })
        if (el('pf-fx-add')) el('pf-fx-add').onclick = function () { guardar(); faixas.push({ a_partir_de: (faixas.length ? Number(faixas[faixas.length - 1].a_partir_de) + 1 : 2), valor: '' }); desenharFx() }
        desenharFx(); vis()
      }
    }
    render()
    el('pf-c').onclick = K().fechar
    el('pf-v').onclick = function () { guardar(); etapa--; render() }
    el('pf-ok').onclick = async function () {
      guardar()
      var e = validarEtapa(); if (e) return K().erro(e)
      if (etapa < 3) { etapa++; return render() }
      if (!novo && !confirm('Salvar alterações?\n\n' + (d.tipo === 'proprio' ? 'As alterações serão aplicadas apenas aos novos pacientes. Os pacientes já cadastrados manterão suas condições atuais.' : 'As alterações valerão apenas para os novos pacientes; os já cadastrados mantêm o valor, a menos que você reajuste cada um.'))) return
      var btn = this; btn.disabled = true; btn.textContent = novo ? 'Criando plano…' : 'Salvando…'
      var r = await postar('planos-recorrentes', { id: p ? p.id : undefined, tipo: d.tipo, nome: d.nome, observacoes: d.observacoes, tabela_preco: d.tabela_preco, periodicidade: d.periodicidade, intervalo_meses: d.intervalo_meses, valor: lerNum(d.valor),
        modo_cobranca: d.modo_cobranca, taxa_adesao: !!Number(d.taxa_adesao), valor_taxa: d.valor_taxa === '' || d.valor_taxa == null ? '' : lerNum(d.valor_taxa), juros_atraso: !!Number(d.juros_atraso),
        duracao_meses: d.duracao_meses, liberacao: d.liberacao, liberar_a_cada: d.liberar_a_cada, alerta_retorno: !!Number(d.alerta_retorno), procedimentos: procs,
        faixas: faixas.map(function (f) { return { a_partir_de: f.a_partir_de, valor: f.valor === '' ? '' : lerNum(f.valor) } }) })
      if (!r.success) { btn.disabled = false; btn.textContent = novo ? 'Criar plano' : 'Salvar alterações'; return K().erro(r.error || 'Erro ao salvar') }
      if (!novo) { K().fechar(); return carregarPlanos() }
      await buscarPlanos().catch(function () {})
      var criado = CACHE.planos.filter(function (x) { return x.id === r.id })[0]
      K().modal('Plano criado com sucesso', '<p style="margin-top:0"><b>Plano ' + esc(d.nome) + '</b></p><p>O plano já está disponível. Você pode cadastrar pacientes agora ou acessar o painel de planos. O que deseja fazer?</p>',
        '<button class="btn" id="pc-pain">Acessar painel de planos</button><button class="ag-btn-novo" id="pc-pac">Cadastrar pacientes</button>', 520)
      el('pc-pain').onclick = function () { K().fechar(); carregarPlanos() }
      el('pc-pac').onclick = function () { if (criado) formAdesao(criado, null, carregarPlanos); else K().fechar() }
    }
  }

  // ── Adicionar pacientes ao plano ──────────────────────────────
  // plano e/ou paciente podem vir prontos; o que faltar o usuário escolhe.
  async function formAdesao(plano, paciente, depois) {
    if (!plano && !CACHE.planos.length) { try { await buscarPlanos() } catch (e) { return alert(e.message) } }
    var ativos = CACHE.planos.filter(function (p) { return Number(p.ativo) })
    if (!plano && !ativos.length) return alert('Nenhum plano ativo. Cadastre um plano primeiro.')
    var titular = paciente, deps = [], etapa = 0
    var st = { incluir: true, vendedor: '', prof: '', valor: '', valorManual: false, data: K().hoje(), forma: 'aberto', taxa: null, vtaxa: '', obs: '' }
    var profs = (window.ST && ST.profissionais || []).filter(function (x) { return x.ativo !== 0 })
    function pl() { return plano || ativos.filter(function (p) { return String(p.id) === (el('ad-pl') ? el('ad-pl').value : String(ativos[0].id)) })[0] || ativos[0] }
    function prop() { return pl().tipo === 'proprio' }
    function pessoas() { return (st.incluir || !prop() ? 1 : 0) + (prop() ? deps.length : 0) }
    function valorFaixa() { var p = pl(), v = Number(p.valor); (p.faixas || []).forEach(function (f) { if (pessoas() >= f.a_partir_de) v = f.valor }); return v }
    var ETAPAS = [['Paciente', 'Titular do plano'], ['Dependentes', 'Quem mais será incluído'], ['Cobrança', 'Valores e pagamento'], ['Outras regras e comunicação', 'Alertas e avisos']]
    K().modal('Adicionar pacientes', '<div id="fn-err"></div><p class="ag-hint" style="margin-top:0">Complete as etapas para adicionar os pacientes.</p>' +
      '<div class="ag-f"><label for="ad-pl">Plano</label>' + (plano ? '<input class="ag-in" readonly value="Plano ' + esc(plano.nome) + '">' : '<select class="ag-in" id="ad-pl">' + ativos.map(function (p) { return '<option value="' + Number(p.id) + '">' + esc(p.nome) + ' (' + tipoNome(p.tipo) + ')</option>' }).join('') + '</select>') + '</div>' +
      '<div class="pl-etapas" id="ad-et"></div><div id="ad-corpo"></div>',
      '<button class="btn" id="ad-c">Cancelar</button><button class="btn" id="ad-v">Voltar</button><button class="ag-btn-novo" id="ad-ok">Próximo</button>', 760)
    function ets() { return prop() ? ETAPAS : [ETAPAS[0], ETAPAS[2], ETAPAS[3]] }
    function chave() { return ets()[etapa][0] }
    function guardar() {
      if (el('ad-inc')) st.incluir = el('ad-inc').checked
      if (el('ad-vend')) { st.vendedor = el('ad-vend').value; st.prof = el('ad-prof').value }
      if (el('ad-dl')) deps = deps.map(function (x, i) { if (x.paciente_id) return x; var r = el('ad-dl').querySelector('[data-dp="' + i + '"]'); if (!r) return x; var o = { nome: x.nome }; r.querySelectorAll('[data-c]').forEach(function (c) { o[c.getAttribute('data-c')] = c.value }); return o })
      if (el('ad-val')) { st.valor = el('ad-val').value; st.data = el('ad-dt').value; st.forma = el('ad-forma').value; st.taxa = el('ad-tx') ? el('ad-tx').checked : false; st.vtaxa = el('ad-vtx') ? el('ad-vtx').value : '' }
      if (el('ad-obs')) st.obs = el('ad-obs').value
    }
    function busca(alvo, aoEscolher, permiteNovo) {
      alvo.innerHTML = '<input class="ag-in" id="ad-pq" placeholder="' + (permiteNovo ? 'Buscar ou cadastrar...' : 'Buscar paciente por nome ou CPF...') + '" autocomplete="off"><div id="ad-pd"></div>'
      var t = null
      el('ad-pq').oninput = function () {
        var q = this.value.trim(); clearTimeout(t)
        var dr = el('ad-pd')
        if (q.length < 2) { dr.innerHTML = ''; return }
        t = setTimeout(async function () {
          var r = await apiData('busca', { q: q }).catch(function (e) { return { falha: e.message } })
          if (r.falha) { dr.innerHTML = '<div class="ag-err">Não foi possível buscar. Tente de novo.</div>'; return }
          var ps = r.pacientes || []
          dr.innerHTML = '<div class="ag-pac-drop">' + (ps.length ? '<div class="ag-hint" style="padding:4px 12px;margin:0">Pacientes cadastrados</div>' + ps.map(function (x, i) { return '<div class="ag-pac-it" data-i="' + i + '">' + esc(x.nome) + '<small>' + esc(x.telefone || '') + '</small></div>' }).join('') : '<div class="ag-pac-it" style="color:var(--text3)">Nenhum paciente encontrado</div>') +
            (permiteNovo ? '<div class="ag-hint" style="padding:4px 12px;margin:0">Novo dependente</div><div class="ag-pac-it" data-novo="1">Cadastrar “' + esc(q) + '”<small>Dependente novo — informe telefone, CPF e nascimento ao lado</small></div>' : '') + '</div>'
          dr.querySelectorAll('[data-i]').forEach(function (it) { it.onclick = function () { aoEscolher(ps[+it.getAttribute('data-i')]) } })
          var nv = dr.querySelector('[data-novo]'); if (nv) nv.onclick = function () { aoEscolher({ novo: true, nome: q }) }
        }, 250)
      }
    }
    function render() {
      var E = ets()
      el('ad-et').innerHTML = E.map(function (e, i) { return '<div class="' + (i === etapa ? 'on' : i < etapa ? 'ok' : '') + '"><b>' + (i + 1) + '. ' + e[0] + '</b><small>' + e[1] + '</small></div>' }).join('')
      el('ad-v').style.display = etapa ? '' : 'none'
      el('ad-ok').textContent = etapa === E.length - 1 ? 'Confirmar' : 'Próximo'
      K().erro('')
      var c = el('ad-corpo'), k = chave()
      if (k === 'Paciente') {
        c.innerHTML = '<div class="pc-box-h">Titular do plano</div><p class="ag-hint" style="margin-top:0">Selecione o paciente responsável pelo plano e configure os vínculos iniciais.</p>' +
          '<div class="ag-f"><label>Paciente titular</label><div id="ad-pac"></div><div class="ag-hint" style="margin:4px 0 0">' + (paciente ? 'Titular definido pelo paciente em tela.' : 'Pesquise por nome ou CPF do paciente já cadastrado.') + '</div></div>' +
          (prop() ? '<label class="ag-chk cf-chk"><input type="checkbox" id="ad-inc"' + (st.incluir ? ' checked' : '') + '> <span><b>Incluir o titular como paciente do plano</b> — Conta como 1 paciente na cobrança do plano.</span></label>' : '') +
          '<div class="ag-row c2"><div class="ag-f"><label for="ad-vend">Vendedor</label><select class="ag-in" id="ad-vend"><option value="">Selecionar vendedor</option>' + profs.map(function (x) { return '<option value="' + x.id + '"' + (String(x.id) === st.vendedor ? ' selected' : '') + '>' + esc(x.nome) + '</option>' }).join('') + '</select></div>' +
          '<div class="ag-f"><label for="ad-prof">Profissional favorito</label><select class="ag-in" id="ad-prof"><option value="">Selecionar profissional</option>' + profs.map(function (x) { return '<option value="' + x.id + '"' + (String(x.id) === st.prof ? ' selected' : '') + '>' + esc(x.nome) + '</option>' }).join('') + '</select></div></div>'
        var box = el('ad-pac')
        function desenharTit() {
          if (titular) {
            box.innerHTML = '<div class="ag-pac-sel"><span><b>' + esc(titular.nome) + '</b></span>' + (paciente ? '' : '<button class="ag-ico" id="ad-pac-x" aria-label="Remover titular">✕</button>') + '</div>'
            if (el('ad-pac-x')) el('ad-pac-x').onclick = function () { titular = null; desenharTit() }
          } else busca(box, function (x) { titular = x; desenharTit() }, false)
        }
        desenharTit()
      } else if (k === 'Dependentes') {
        c.innerHTML = '<div class="pc-box-h">Dependentes do plano <span style="text-transform:none;letter-spacing:0">(opcional)</span></div><p class="ag-hint" style="margin-top:0">Adicione os dependentes que farão parte do plano. Você também poderá incluí-los posteriormente.</p>' +
          '<div class="pc-item"><b>' + esc(titular.nome) + '</b> <span class="pc-badge info">Titular do plano</span>' + (st.incluir ? ' <span class="ag-hint" style="margin:0">Incluído como paciente do plano</span>' : '') + '</div>' +
          '<div id="ad-dl"></div><div class="ag-f" style="margin-top:8px"><label>Adicionar dependente</label><div id="ad-db"></div></div>'
        function desenharDeps() {
          el('ad-dl').innerHTML = deps.length ? '<table class="pc-tbl"><thead><tr><th>Nome</th><th>Telefone</th><th>Nascimento</th><th>CPF</th><th></th></tr></thead><tbody>' + deps.map(function (x, i) {
            if (x.paciente_id) return '<tr><td>' + esc(x.nome) + '</td><td colspan="3"><span class="ag-hint" style="margin:0">Dados do cadastro do paciente — não editáveis aqui.</span></td><td><a href="#" data-rmd="' + i + '" style="color:var(--red)">Remover dependente</a></td></tr>'
            return '<tr data-dp="' + i + '"><td>' + esc(x.nome) + '</td><td><input class="ag-in" data-c="telefone" placeholder="(00) 00000-0000" value="' + esc(x.telefone || '') + '"></td><td><input class="ag-in" type="date" data-c="nascimento" value="' + esc(x.nascimento || '') + '"></td><td><input class="ag-in" data-c="cpf" placeholder="000.000.000-00" value="' + esc(x.cpf || '') + '"></td><td><a href="#" data-rmd="' + i + '" style="color:var(--red)">Remover dependente</a></td></tr>'
          }).join('') + '</tbody></table>' : '<div class="ag-hint">Nenhum dependente adicionado.</div>'
          el('ad-dl').querySelectorAll('[data-rmd]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); guardar(); deps.splice(+a.getAttribute('data-rmd'), 1); desenharDeps() } })
          busca(el('ad-db'), function (x) {
            guardar()
            if (x.novo) deps.push({ nome: x.nome })
            else if (String(x.id) === String(titular.id) || deps.some(function (d) { return String(d.paciente_id) === String(x.id) })) return K().erro('Este dependente já está incluído neste plano.')
            else deps.push({ paciente_id: x.id, nome: x.nome })
            desenharDeps()
          }, true)
        }
        desenharDeps()
      } else if (k === 'Cobrança') {
        var p = pl(), tot = p.modo_cobranca === 'total'
        if (!st.valorManual) st.valor = numBr(prop() ? valorFaixa() : p.valor)
        if (st.taxa === null) { st.taxa = !!Number(p.taxa_adesao); st.vtaxa = numBr(p.valor_taxa != null ? p.valor_taxa : p.valor) }
        c.innerHTML = '<div class="pc-box-h">Cobrança</div><p class="ag-hint" style="margin-top:0">Defina o valor e a forma de cobrança aplicados a cada pessoa do plano.</p>' +
          '<div class="ag-row c3"><div class="ag-f"><label for="ad-val">' + (prop() ? 'Valor por pessoa' : 'Valor da cobrança') + '</label><input class="ag-in" id="ad-val" inputmode="decimal" value="' + esc(st.valor) + '"></div>' +
          '<div class="ag-f"><label for="ad-forma">Forma de pagamento</label><select class="ag-in" id="ad-forma"><option value="aberto">Lançamento em aberto</option><option disabled>Boleto (em breve)</option><option disabled>Cartão de crédito (em breve)</option><option disabled>Link de pagamento (em breve)</option></select></div>' +
          '<div class="ag-f"><label for="ad-dt">Primeiro vencimento</label><input class="ag-in" id="ad-dt" type="date" value="' + esc(st.data) + '"></div></div>' +
          '<p class="ag-hint" style="margin-top:0">Sem cobrança automatizada: o plano gera lançamentos em aberto e exige baixa manual a cada parcela.</p>' +
          '<div class="pc-box-h">Opções adicionais</div><label class="ag-chk cf-chk"><input type="checkbox" id="ad-tx"' + (st.taxa ? ' checked' : '') + '> <span><b>Gerar taxa de adesão</b> — Cobrança única no início da contratação.</span></label>' +
          '<div class="ag-row c3" id="ad-vtx-box"><div class="ag-f"><label for="ad-vtx">Valor da taxa de adesão</label><input class="ag-in" id="ad-vtx" inputmode="decimal" value="' + esc(st.vtaxa) + '"></div></div>' +
          '<div class="pc-box" style="margin-top:12px"><div class="pc-box-h">Detalhes da cobrança</div><div class="fe-kv" id="ad-res"></div></div>'
        function resumo() {
          var n = pessoas(), v = lerNum(el('ad-val').value), tx = el('ad-tx').checked ? lerNum(el('ad-vtx').value) : 0, dur = p.duracao_meses
          el('ad-vtx-box').style.display = el('ad-tx').checked ? '' : 'none'
          el('ad-res').innerHTML = '<div><span>Quantidade de pessoas</span><b>' + n + '</b></div><div><span>Vigência</span><b>' + (dur ? dur + (Number(dur) === 1 ? ' mês' : ' meses') : 'Indeterminado') + '</b></div>' +
            '<div><span>Valor por pessoa</span><b>' + moeda(v) + '</b></div>' + (tx ? '<div><span>Taxa de adesão</span><b>' + moeda(tx * n) + '</b></div>' : '') +
            '<div><span>Valor total</span><b>' + moeda(v * n) + (tot ? '' : ' ' + (prop() ? '/ mês' : '/ cobrança')) + '</b></div>'
        }
        el('ad-val').oninput = function () { st.valorManual = true; resumo() }
        ;['ad-tx', 'ad-vtx'].forEach(function (id) { el(id).addEventListener('input', resumo); el(id).addEventListener('change', resumo) })
        resumo()
      } else {
        var pp = pl()
        c.innerHTML = '<div class="pc-box-h">Liberação de procedimentos</div><p style="margin-top:0">' + esc(rotuloLiberacao(pp)) + '</p>' +
          '<div class="pc-box-h">Comunicação interna</div><p class="ag-hint" style="margin-top:0">' + (Number(pp.alerta_retorno) ? 'Alerta de retorno na Agenda: um lembrete é criado para a secretária reagendar o paciente assim que o procedimento for liberado.' : 'Sem alerta de retorno na Agenda (definido no plano).') + '</p>' +
          '<div class="ag-f"><label for="ad-obs">Observações</label><input class="ag-in" id="ad-obs" maxlength="500" placeholder="Opcional" value="' + esc(st.obs) + '"></div>'
      }
    }
    render()
    if (el('ad-pl')) el('ad-pl').onchange = function () { st.valorManual = false; st.taxa = null; etapa = 0; render() }
    el('ad-c').onclick = K().fechar
    el('ad-v').onclick = function () { guardar(); etapa--; render() }
    el('ad-ok').onclick = async function () {
      guardar()
      var k = chave()
      if (k === 'Paciente') { if (!titular) return K().erro('Selecione o paciente titular do plano.') }
      if (k === 'Dependentes') {
        if (!pessoas()) return K().erro('Inclua o titular ou ao menos um dependente.')
        var ruim = deps.filter(function (x) { return !x.paciente_id && String(x.telefone || '').replace(/\D/g, '').length !== 11 })[0]
        if (ruim) return K().erro('Informe o telefone completo do dependente, com DDD e 9 dígitos.')
      }
      if (k === 'Cobrança') { if (!(lerNum(st.valor) > 0)) return K().erro(prop() ? 'Informe o valor por pessoa.' : 'Informe o valor da cobrança.') }
      if (etapa < ets().length - 1) { etapa++; return render() }
      var btn = this; btn.disabled = true; btn.textContent = 'Adicionando pacientes…'
      var r = await postar('planos-adesoes', { action: 'aderir', plano_id: pl().id, paciente_id: titular.id, incluir_titular: st.incluir, dependentes: prop() ? deps : [], vendedor_id: st.vendedor, profissional_id: st.prof,
        valor: lerNum(st.valor), data_inicio: st.data, forma_pagamento: st.forma, taxa_adesao: !!st.taxa, valor_taxa: st.taxa ? lerNum(st.vtaxa) : '', observacoes: st.obs })
      if (!r.success) { btn.disabled = false; btn.textContent = 'Confirmar'; return K().erro('Plano ' + pl().nome + ': ' + (r.error || 'Erro')) }
      var n = r.pessoas || 1
      K().modal(n > 1 ? 'Pacientes adicionados ao plano!' : 'Paciente adicionado ao plano!', '<p style="margin-top:0">' + esc(titular.nome) + ' · Plano ' + esc(pl().nome) + '</p><p>O vínculo foi criado e as cobranças já seguem a configuração definida.</p>', '<button class="ag-btn-novo" id="ad-fim">Concluir</button>', 480)
      el('ad-fim').onclick = function () { K().fechar(); if (depois) depois() }
    }
  }

  // ── Pacientes nos planos ──────────────────────────────────────
  async function carregarPacientes() {
    var box = el('pr-res'); if (!box) return
    if (!CACHE.planos.length) { try { await buscarPlanos() } catch (e) { return falha(box, e) } }
    var plSel = CACHE.planos.filter(function (x) { return String(x.id) === String(F.plano_id) })[0]
    box.innerHTML = (plSel ? '<div style="margin-bottom:12px"><a href="#" id="pp-volta">← Voltar para Planos</a><div style="font-size:16px;font-weight:500;color:var(--text);margin-top:8px">Lista de pacientes do plano ' + esc(plSel.nome) + '</div><div class="ag-hint" style="margin:4px 0 0">Gerencie aqui os pacientes do plano. Adicione novos pacientes, edite os detalhes ou inative o plano.</div></div>' : '') +
      '<div class="fn-filtros"><div class="ag-f"><label for="pp-pl">Plano</label><select class="ag-in" id="pp-pl"><option value="">Todos</option>' + CACHE.planos.map(function (p) { return '<option value="' + Number(p.id) + '"' + (String(p.id) === String(F.plano_id) ? ' selected' : '') + '>' + esc(p.nome) + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label for="pp-q">Buscar paciente</label><input class="ag-in" id="pp-q" placeholder="Buscar paciente" value="' + esc(F.busca) + '"></div>' +
      '<div class="ag-f"><label for="pp-sit">Status</label><select class="ag-in" id="pp-sit"><option value="todos">Todos os status</option>' + Object.keys(SIT).map(function (k) { return '<option value="' + k + '"' + (k === F.situacao ? ' selected' : '') + '>' + SIT[k][0] + '</option>' }).join('') + '</select></div>' +
      '<button class="btn" id="pp-lst">Listar</button><button class="ag-btn-novo" id="pp-add">Adicionar paciente</button></div><div id="pp-lista" style="margin-top:16px"></div>'
    if (el('pp-volta')) el('pp-volta').onclick = function (e) { e.preventDefault(); F.aba = 'planos'; F.plano_id = ''; desenhar() }
    el('pp-pl').onchange = function () { F.plano_id = this.value; carregarPacientes() }
    el('pp-lst').onclick = function () { F.situacao = el('pp-sit').value; F.busca = el('pp-q').value.trim(); listarPacientes() }
    el('pp-add').onclick = function () {
      var p = CACHE.planos.filter(function (x) { return String(x.id) === String(F.plano_id) && Number(x.ativo) })[0]
      formAdesao(p || null, null, listarPacientes)
    }
    listarPacientes()
  }

  async function listarPacientes() {
    var box = el('pp-lista'); if (!box) return
    var d = await apiData('planos-adesoes', { plano_id: F.plano_id, situacao: F.situacao, busca: F.busca }).catch(function (e) { return { success: false, error: e.message } })
    if (!el('pp-lista')) return
    if (!d.success) return falha(box, d)
    var ativos = d.data.filter(function (a) { return a.status === 'ativo' && a.situacao !== 'concluido' })
    var mensal = ativos.reduce(function (s, a) { return s + (a.modo_cobranca === 'total' ? 0 : Number(a.valor_parcela) / Number(a.intervalo_meses)) }, 0)
    box.innerHTML = '<div class="fn-kpis">' + kpi('Pacientes ativos', String(ativos.length)) + kpi('Pessoas nos planos', String(ativos.reduce(function (s, a) { return s + (Number(a.pessoas) || 1) }, 0))) + kpi('Receita mensal prevista', moeda(mensal)) + kpi('Inadimplentes', String(ativos.filter(function (a) { return Number(a.atrasadas) }).length), ativos.some(function (a) { return Number(a.atrasadas) }) ? 'err' : '') + '</div>' +
      (d.data.length ? tabelaAdesoes(d.data, true) : '<div class="pc-box"><div class="pc-vazio" style="padding:32px 0;text-align:center"><b>' + (F.busca || F.situacao !== 'todos' ? 'Nenhum registro encontrado' : 'Nenhum paciente neste plano ainda') + '</b><div class="ag-hint">' + (F.busca || F.situacao !== 'todos' ? 'Ajuste a busca ou o status e clique em Listar.' : 'Use “Adicionar paciente” para vincular o primeiro.') + '</div></div></div>')
    ligarAdesoes(box, d.data, listarPacientes)
  }

  function tabelaAdesoes(lista, acoes) {
    return '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Início</th><th>Paciente Titular</th><th class="hide-sm">Plano</th><th class="fn-num">Pessoas</th><th>Status</th><th class="hide-sm">Últ. lançamento</th><th class="hide-sm">Próx. lançamento</th><th class="hide-sm">Taxa de adesão</th><th>Parcelas</th><th class="fn-num">Valor por Pessoa</th><th class="fn-num">Valor Mensal</th><th></th></tr></thead><tbody>' +
      lista.map(function (a, i) {
        var s = SIT[a.situacao], at = Number(a.atrasadas)
        return '<tr><td>' + br(a.data_inicio) + '</td><td class="pname">' + esc(a.paciente_nome || '—') + (a.sou_dependente ? '<div class="ag-hint" style="margin:2px 0 0">este paciente é dependente</div>' : '') + '</td><td class="hide-sm">' + esc(a.plano_nome) + '</td><td class="fn-num">' + (Number(a.pessoas) || 1) + '</td>' +
          '<td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span></td><td class="hide-sm">' + br(a.ultimo_pagamento) + '</td><td class="hide-sm">' + br(a.proximo) + '</td><td class="hide-sm">' + (a.valor_taxa ? 'Tem taxa de adesão' : '—') + '</td>' +
          '<td>' + (at ? '<span style="color:var(--red)">' + at + (at === 1 ? ' Pendente' : ' Pendentes') + '</span>' : 'Em dia') + '</td><td class="fn-num">' + moeda(a.valor) + '</td><td class="fn-num">' + (a.modo_cobranca === 'total' ? '—' : moeda(Number(a.valor_parcela) / Number(a.intervalo_meses || 1))) + '</td>' +
          '<td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-abrir="' + i + '">Abrir</button>' + (acoes ? ' <select class="ag-in pl-acoes" data-pa="' + i + '" aria-label="Ações do paciente"><option value="">Ações do paciente</option><option value="edit">Editar plano</option>' + (a.plano_tipo === 'proprio' ? '<option value="deps">Ver dependentes</option>' : '') + '<option value="' + (a.status === 'ativo' ? 'off' : 'on') + '">' + (a.status === 'ativo' ? 'Inativar plano' : 'Ativar plano') + '</option><option value="del">Excluir plano</option></select>' : '') + '</td></tr>'
      }).join('') + '</tbody></table></div></div>'
  }
  function ligarAdesoes(box, lista, depois) {
    box.querySelectorAll('[data-abrir]').forEach(function (b) { b.onclick = function () { abrirAdesao(lista[+b.getAttribute('data-abrir')].id, depois) } })
    box.querySelectorAll('[data-pa]').forEach(function (s) {
      s.onchange = async function () {
        var a = lista[+s.getAttribute('data-pa')], ac = s.value; s.value = ''
        if (ac === 'edit') return editarAdesao(a, depois)
        if (ac === 'deps') return dependentes(a.id, depois)
        var nome = a.paciente_nome, r
        if (ac === 'off') { var mot = prompt('Inativar plano do paciente?\n\nTem certeza que deseja inativar o plano de "' + nome + '"? As parcelas futuras deixam de existir; as vencidas continuam em aberto.\n\nMotivo (opcional):'); if (mot === null) return; r = await postar('planos-adesoes', { action: 'cancelar', id: a.id, motivo: mot }) }
        if (ac === 'on') { if (!confirm('Ativar plano do paciente?\n\nTem certeza que deseja ativar o plano de "' + nome + '"?')) return; r = await postar('planos-adesoes', { action: 'reativar', id: a.id }) }
        if (ac === 'del') { if (!confirm('Excluir plano do paciente?\n\nTem certeza que deseja excluir o plano de "' + nome + '"? Esta ação não pode ser desfeita.')) return; r = await postar('planos-adesoes', { action: 'excluir', id: a.id }) }
        if (r && !r.success) alert('Não foi possível concluir para "' + nome + '". ' + (r.error || ''))
        if (depois) depois()
      }
    })
  }

  function editarAdesao(a, depois) {
    K().modal('Editar Plano', '<div id="fn-err"></div><div class="ag-f"><label for="ea-v">Valor da Cobrança</label><input class="ag-in" id="ea-v" inputmode="decimal" value="' + numBr(a.valor) + '">' +
      '<div class="ag-hint" style="margin:4px 0 0"><b>O que é o valor da cobrança:</b> será o valor de cada parcela do plano' + (a.plano_tipo === 'proprio' ? ' por pessoa' : '') + ' — não necessariamente o valor integral do procedimento (pode ter relação com a quantidade de parcelas pagas para liberar a execução). Vale para as parcelas ainda não vencidas.</div></div>' +
      '<div class="ag-f"><label for="ea-o">Observações</label><input class="ag-in" id="ea-o" maxlength="500" placeholder="Opcional" value="' + esc(a.observacoes || '') + '"></div>',
      '<button class="btn" id="ea-c">Cancelar</button><button class="ag-btn-novo" id="ea-ok">Salvar</button>', 520)
    el('ea-c').onclick = K().fechar
    el('ea-ok').onclick = async function () {
      if (!(lerNum(el('ea-v').value) > 0)) return K().erro('Informe um valor maior que zero')
      this.disabled = true; this.textContent = 'Salvando…'
      var r = await postar('planos-adesoes', { action: 'valor', id: a.id, valor: lerNum(el('ea-v').value), observacoes: el('ea-o').value })
      if (!r.success) { this.disabled = false; this.textContent = 'Salvar'; return K().erro(r.error || 'Erro') }
      K().fechar(); if (depois) depois()
    }
  }

  async function dependentes(id, depois) {
    var d = await apiData('plano-adesao', { id: id }).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro')
    var a = d.adesao, sel = {}
    K().modal('Dependentes do paciente ' + a.paciente_nome, '<div id="fn-err"></div><div id="dp-lista"></div>' + (a.status === 'ativo' ? '<div class="pc-box-h" style="margin-top:16px">Cadastrar novo dependente</div><div class="ag-row c3"><div class="ag-f"><label for="dp-n">Nome</label><input class="ag-in" id="dp-n" placeholder="Nome do dependente"></div><div class="ag-f"><label for="dp-t">Telefone</label><input class="ag-in" id="dp-t" placeholder="(00) 00000-0000"></div><div class="ag-f"><label>&nbsp;</label><button class="btn" id="dp-add">Adicionar</button></div></div><div class="ag-f"><label>Ou um paciente já cadastrado</label><div id="dp-busca"></div></div>' : ''),
      '<button class="btn" id="dp-rm" style="color:var(--red)">Remover dependentes</button><button class="ag-btn-novo" id="dp-f">Fechar</button>', 680)
    function lista() {
      el('dp-lista').innerHTML = d.dependentes.length ? '<table class="pc-tbl"><thead><tr><th><input type="checkbox" id="dp-all" aria-label="Selecionar todos"></th><th>Nome</th><th>Telefone</th><th>Data de inclusão no plano</th></tr></thead><tbody>' + d.dependentes.map(function (x) { return '<tr><td><input type="checkbox" data-sd="' + x.id + '" aria-label="Selecionar ' + esc(x.nome) + '"' + (sel[x.id] ? ' checked' : '') + '></td><td>' + esc(x.nome) + '</td><td>' + esc(x.telefone || '—') + '</td><td>' + br(x.incluido_em) + '</td></tr>' }).join('') + '</tbody></table>' : '<div class="pc-vazio">Nenhum dependente cadastrado.</div>'
      el('dp-lista').querySelectorAll('[data-sd]').forEach(function (c) { c.onchange = function () { sel[c.getAttribute('data-sd')] = c.checked; rot() } })
      if (el('dp-all')) el('dp-all').onchange = function () { var v = this.checked; d.dependentes.forEach(function (x) { sel[x.id] = v }); lista() }
      rot()
    }
    function rot() { var n = Object.keys(sel).filter(function (k) { return sel[k] }).length; el('dp-rm').textContent = 'Remover dependentes' + (n ? ' (' + n + ')' : ''); el('dp-rm').style.display = d.dependentes.length && a.status === 'ativo' ? '' : 'none' }
    async function recarregar() { var r = await apiData('plano-adesao', { id: id }); if (r.success) { d = r; sel = {}; lista() } if (depois) depois() }
    async function incluir(dep) {
      var r = await postar('planos-adesoes', { action: 'dependentes-add', id: id, dependentes: [dep] })
      if (!r.success) return K().erro(r.error || 'Erro')
      K().erro(''); recarregar()
    }
    lista()
    el('dp-f').onclick = K().fechar
    if (el('dp-add')) el('dp-add').onclick = function () {
      var t = el('dp-t').value
      if (String(t).replace(/\D/g, '').length !== 11) return K().erro('Informe o telefone completo, com DDD e 9 dígitos.')
      incluir({ nome: el('dp-n').value, telefone: t }); el('dp-n').value = ''; el('dp-t').value = ''
    }
    if (el('dp-busca')) {
      var bx = el('dp-busca'), tm = null
      bx.innerHTML = '<input class="ag-in" id="dp-q" placeholder="Buscar dependente" autocomplete="off"><div id="dp-d"></div>'
      el('dp-q').oninput = function () {
        var q = this.value.trim(); clearTimeout(tm)
        if (q.length < 2) { el('dp-d').innerHTML = ''; return }
        tm = setTimeout(async function () {
          var r = await apiData('busca', { q: q }).catch(function () { return {} }), ps = r.pacientes || []
          el('dp-d').innerHTML = '<div class="ag-pac-drop">' + (ps.length ? ps.map(function (x, i) { return '<div class="ag-pac-it" data-i="' + i + '">' + esc(x.nome) + '<small>' + esc(x.telefone || '') + '</small></div>' }).join('') : '<div class="ag-pac-it" style="color:var(--text3)">Nenhum dependente encontrado.</div>') + '</div>'
          el('dp-d').querySelectorAll('[data-i]').forEach(function (it) { it.onclick = function () { el('dp-d').innerHTML = ''; el('dp-q').value = ''; incluir({ paciente_id: ps[+it.getAttribute('data-i')].id }) } })
        }, 250)
      }
    }
    el('dp-rm').onclick = async function () {
      var ids = Object.keys(sel).filter(function (k) { return sel[k] }).map(Number)
      if (!ids.length) return K().erro('Selecione os dependentes.')
      if (!confirm('Remover ' + ids.length + ' dependente(s)?\n\nOs dependentes selecionados serão removidos do plano deste paciente. Esta ação não pode ser desfeita.')) return
      var r = await postar('planos-adesoes', { action: 'dependentes-remover', id: id, ids: ids })
      if (!r.success) return K().erro(r.error || 'Erro')
      recarregar()
    }
  }

  // ── Detalhe ───────────────────────────────────────────────────
  async function abrirAdesao(id, depois) {
    var d = await apiData('plano-adesao', { id: id }).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro')
    var a = d.adesao, s = SIT[a.situacao], ativo = a.status === 'ativo', baixa = pode('financeiro.dar_baixa'), prop = a.plano_tipo === 'proprio', L = a.liberacoes
    function reabrir() { abrirAdesao(id, depois); if (depois) depois() }
    // Mostra o que está em aberto até o próximo a vencer e esconde a fila distante.
    var abertas = d.parcelas.filter(function (p) { return p.status === 'pendente' && Number(p.numero) > 0 })
    var corte = abertas.length ? abertas[Math.min(2, abertas.length - 1)].numero : 0
    var visiveis = d.parcelas.filter(function (p) { return p.status !== 'pendente' || Number(p.numero) <= corte })
    var ocultas = d.parcelas.length - visiveis.length
    var pessoasPlano = [{ id: a.paciente_id, nome: a.paciente_nome }].concat((d.dependentes || []).map(function (x) { return { id: x.paciente_id, nome: x.nome } }))
    if (prop && Number(a.incluir_titular) === 0) pessoasPlano.shift()
    K().modal(a.paciente_nome + ' · ' + a.plano_nome, '<div id="fn-err"></div>' +
      '<div class="fn-acoes" style="align-items:center;margin-bottom:12px"><span class="pc-badge ' + s[1] + '">' + s[0] + '</span><span class="ag-hint" style="margin:0">' + (prop ? moeda(a.valor) + ' por pessoa × ' + (Number(a.pessoas) || 1) + ' = ' + moeda(a.valor_parcela) : moeda(a.valor)) + ' · início em ' + br(a.data_inicio) + (a.duracao_meses ? ' · ' + Number(a.duracao_meses) + ' meses' : ' · prazo indeterminado') + (a.cancelado_em ? ' · inativado em ' + br(a.cancelado_em) : '') + '</span></div>' +
      (a.motivo_cancelamento ? '<p class="ag-hint" style="margin:0 0 12px">Motivo: ' + esc(a.motivo_cancelamento) + '</p>' : '') +
      (prop ? '<p class="ag-hint" style="margin:0 0 12px">Pessoas: ' + esc(pessoasPlano.map(function (x) { return x.nome }).join(', ')) + (ativo ? ' · <a href="#" id="ad-deps">Ver dependentes</a>' : '') + '</p>' : '') +
      '<div class="pc-box-h">' + (prop ? 'Parcelas' : 'Mensalidades') + '</div><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Nº</th><th>Vencimento</th><th>Situação</th><th class="fn-num">Valor</th><th></th></tr></thead><tbody>' +
      visiveis.map(function (p) {
        var venc = p.status === 'pendente' && String(p.vencimento) < d.hoje
        var sel = p.status === 'pago' ? '<span class="pc-badge ok">Pago</span><div class="ag-hint" style="margin:2px 0 0">em ' + br(p.data_pagamento) + '</div>' : p.status === 'cancelado' ? '<span class="pc-badge off">Cancelada</span>' : venc ? '<span class="pc-badge err">Vencida</span>' : '<span class="pc-badge pend">A vencer</span>'
        return '<tr><td>' + (Number(p.numero) === 0 ? 'Taxa de adesão' : Number(p.numero)) + '</td><td>' + br(p.vencimento) + '</td><td>' + sel + '</td><td class="fn-num">' + moeda(p.valor_pago != null ? p.valor_pago : p.valor) + '</td><td style="text-align:right;white-space:nowrap">' +
          (baixa && p.status === 'pendente' ? '<button class="btn btn-sm btn-primary" data-rec="' + p.id + '">Receber</button> <button class="btn btn-sm" data-dis="' + p.id + '">Dispensar</button>' : '') +
          (baixa && p.status === 'pago' ? '<button class="btn btn-sm" data-est="' + p.id + '">Estornar</button>' : '') + '</td></tr>'
      }).join('') + '</tbody></table></div>' +
      (ocultas > 0 ? '<p class="ag-hint">Mais ' + ocultas + ' parcelas futuras já estão previstas.</p>' : '') +
      '<div class="pc-box-h" style="margin-top:16px">' + (prop ? 'Procedimentos: ' + (L.liberado ? 'liberados' : 'aguardando liberação') : 'Procedimentos liberados: ' + Number(L.disponiveis)) + '</div>' +
      '<p class="ag-hint" style="margin:0 0 8px">' + esc(rotuloLiberacao(a)) + (prop ? '' : ' · ' + Number(L.ganhas) + ' liberados') + ' · ' + Number(L.usadas) + ' usados · ' + esc(d.procedimentos.join(', ')) + '</p>' +
      (ativo && L.disponiveis > 0 ? '<div class="ag-row c' + (prop ? 4 : 3) + '"><div class="ag-f"><label for="uso-p">Procedimento</label><select class="ag-in" id="uso-p">' + d.procedimentos.map(function (n) { return '<option>' + esc(n) + '</option>' }).join('') + '</select></div>' +
        (prop ? '<div class="ag-f"><label for="uso-q">Paciente</label><select class="ag-in" id="uso-q">' + pessoasPlano.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + '</option>' }).join('') + '</select></div>' : '') +
        '<div class="ag-f"><label for="uso-d">Data</label><input class="ag-in" id="uso-d" type="date" value="' + esc(d.hoje) + '"></div><div class="ag-f"><label>&nbsp;</label><button class="btn" id="uso-ok">Registrar uso</button></div></div>' : '') +
      (d.usos.length ? d.usos.map(function (u) { var q = pessoasPlano.filter(function (x) { return String(x.id) === String(u.paciente_id) })[0]; return '<div class="pc-item">' + br(u.data) + ' · ' + esc(u.procedimento_nome) + (prop && q ? ' · ' + esc(q.nome) : '') + (u.criado_por_nome ? ' · ' + esc(u.criado_por_nome) : '') + ' <a href="#" data-udel="' + u.id + '" style="color:var(--red)">Remover</a></div>' }).join('') : ''),
      ativo ? '<button class="btn" id="ad-can" style="color:var(--red)">Inativar plano</button><button class="btn" id="ad-ed">Editar plano</button><button class="ag-btn-novo" id="ad-f">Fechar</button>' : '<button class="btn" id="ad-rea">Ativar plano</button><button class="ag-btn-novo" id="ad-f">Fechar</button>', 760)

    var m = el('fn-m-b')
    el('ad-f').onclick = K().fechar
    async function agir(rota, corpo) {
      var r = await postar(rota, corpo)
      if (!r.success) return K().erro(r.error || 'Erro')
      reabrir()
    }
    m.querySelectorAll('[data-rec]').forEach(function (b) {
      b.onclick = function () {
        var p = d.parcelas.filter(function (x) { return x.id === +b.getAttribute('data-rec') })[0]
        K().receberParcela({ id: p.id, origem: 'plano', paciente_nome: a.paciente_nome, descricao: nomeParcela(p, prop) + ' · plano ' + a.plano_nome, valor: p.valor }, reabrir)
      }
    })
    m.querySelectorAll('[data-est]').forEach(function (b) { b.onclick = function () { if (confirm('Estornar este pagamento? A parcela volta a ficar em aberto e sai do extrato.')) agir('plano-parcela', { action: 'estornar', id: +b.getAttribute('data-est') }) } })
    m.querySelectorAll('[data-dis]').forEach(function (b) { b.onclick = function () { if (confirm('Dispensar esta parcela? Ela deixa de ser cobrada.')) agir('plano-parcela', { action: 'cancelar', id: +b.getAttribute('data-dis') }) } })
    m.querySelectorAll('[data-udel]').forEach(function (l) { l.onclick = function (e) { e.preventDefault(); if (confirm('Remover este uso? O procedimento volta a ficar liberado.')) agir('plano-uso', { action: 'excluir', id: +l.getAttribute('data-udel') }) } })
    if (el('uso-ok')) el('uso-ok').onclick = function () { agir('plano-uso', { adesao_id: a.id, procedimento_nome: el('uso-p').value, data: el('uso-d').value, paciente_id: el('uso-q') ? el('uso-q').value : undefined }) }
    if (el('ad-ed')) el('ad-ed').onclick = function () { editarAdesao(a, reabrir) }
    if (el('ad-deps')) el('ad-deps').onclick = function (e) { e.preventDefault(); dependentes(a.id, depois) }
    if (el('ad-rea')) el('ad-rea').onclick = function () { if (confirm('Ativar plano do paciente?\n\nTem certeza que deseja ativar o plano de "' + a.paciente_nome + '"?')) agir('planos-adesoes', { action: 'reativar', id: a.id }) }
    if (el('ad-can')) el('ad-can').onclick = function () {
      var motivo = prompt('Inativar plano do paciente?\n\nTem certeza que deseja inativar o plano de "' + a.paciente_nome + '"? As parcelas futuras deixam de existir; as vencidas continuam em aberto.\n\nMotivo (opcional):')
      if (motivo === null) return
      agir('planos-adesoes', { action: 'cancelar', id: a.id, motivo: motivo })
    }
  }

  // ── Quadro no financeiro do paciente ──────────────────────────
  async function quadroPaciente(pacId) {
    if (!pode('financeiro.planos')) return
    var cont = el('fin-pac-container'); if (!cont) return
    var d = await apiData('planos-adesoes', { paciente_id: pacId }).catch(function () { return null })
    if (!d || !d.success) return
    cont = el('fin-pac-container'); if (!cont) return
    var antigo = el('pr-quadro-pac'); if (antigo) antigo.remove()
    var box = document.createElement('div')
    box.id = 'pr-quadro-pac'; box.style.marginTop = '16px'
    box.innerHTML = '<div class="pc-box"><div class="pc-box-h">Planos <a href="#" id="pr-qp-add" style="float:right;text-transform:none;letter-spacing:0;color:var(--green3)">Adicionar ao plano</a></div>' +
      (d.data.length ? tabelaAdesoes(d.data, false) : '<div class="ag-hint" style="margin:0">Este paciente não participa de nenhum plano.</div>') + '</div>'
    cont.appendChild(box)
    function atualizar() { quadroPaciente(pacId) }
    ligarAdesoes(box, d.data, atualizar)
    el('pr-qp-add').onclick = async function (e) {
      e.preventDefault()
      var tit = d.data.filter(function (x) { return !x.sou_dependente })[0]
      var nome = (tit && tit.paciente_nome) || ''
      if (!nome) { var pr = await apiData('paciente', { id: pacId }).catch(function () { return {} }); nome = (pr.data && pr.data.nome) || (pr.paciente && pr.paciente.nome) || 'Paciente' }
      formAdesao(null, { id: pacId, nome: nome }, atualizar)
    }
  }

  var css = document.createElement('style')
  css.textContent = '.pl-op{display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);cursor:pointer;transition:border-color .12s ease,background .12s ease}.pl-op.on{border-color:var(--green3);background:var(--green-light)}.pl-op input{margin-top:3px}.pl-op span{display:flex;flex-direction:column;gap:4px;font-size:14px;color:var(--text)}.pl-op small{font-size:12px;color:var(--text3)}.pl-op b{font-weight:500}' +
    '.pl-ops5{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.pl-etapas{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:16px}.pl-etapas div{padding:8px 12px;border-top:3px solid var(--border);display:flex;flex-direction:column;gap:2px}.pl-etapas div.on{border-color:var(--orange)}.pl-etapas div.ok{border-color:var(--green3)}.pl-etapas b{font-size:13px;font-weight:500;color:var(--text)}.pl-etapas small{font-size:12px;color:var(--text3)}' +
    '.pl-dual{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pl-dual-h{display:flex;justify-content:space-between;font-size:13px;font-weight:500;color:var(--text3);margin-bottom:4px}.pl-dual-l{border:1px solid var(--border);border-radius:6px;height:260px;overflow:auto;padding:4px}.pl-it{padding:6px 8px;border-radius:4px;font-size:13px;cursor:pointer;color:var(--text2)}.pl-it:hover{background:var(--surface2)}.pl-it.on{color:var(--green)}' +
    '.pl-acoes{width:auto;display:inline-block;padding:5px 8px;font-size:13px}.pl-passos{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.pl-passos div{display:flex;flex-direction:column;gap:4px;font-size:13px}.pl-passos span{color:var(--text3)}.pl-lista{padding-left:18px;font-size:13px;color:var(--text2);line-height:1.6}@media(max-width:640px){.pl-dual,.pl-passos{grid-template-columns:1fr}}'
  document.head.appendChild(css)

  if (typeof window.loadFinanceiroPaciente === 'function') {
    var carregarFinAnt = window.loadFinanceiroPaciente
    window.loadFinanceiroPaciente = async function (pacId) {
      var r = await carregarFinAnt.apply(this, arguments)
      quadroPaciente(pacId)
      return r
    }
  }

  if (typeof window.nav === 'function') {
    var navAnt = window.nav
    window.nav = function (id) {
      var r = navAnt.apply(this, arguments)
      if (id === 'planos') desenhar()
      return r
    }
  }
})()
