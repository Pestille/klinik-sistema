// public/planos.js — Planos Recorrentes (etapa 1: cadastro e controle, sem cobrança automática)
// Klinov — Campo Grande, MS
//
// Substitui a tela "em desenvolvimento" de #p-planos e acrescenta o quadro de
// planos no financeiro do paciente. A baixa reaproveita o modal de Contas a Receber.
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function isAdm() { return typeof isAdmin === 'function' ? isAdmin() : false }
  function pode(r) { return isAdm() || !window.ST || !ST.permissoes || ST.permissoes[r] === 1 }
  function K() { return window.KFIN }
  function moeda(v) { return K().moeda(v) }
  function br(d) { return d ? K().br(String(d).slice(0, 10)) : '—' }

  var PERIODOS = [['mensal', 'Mensal'], ['bimestral', 'Bimestral'], ['trimestral', 'Trimestral'], ['semestral', 'Semestral'], ['outros', 'Outros']]
  var SIT = { em_dia: ['Em dia', 'ok'], atrasado: ['Em atraso', 'err'], concluido: ['Concluído', 'info'], cancelado: ['Cancelado', 'off'] }
  // Pontos de partida: a clínica define o próprio preço e os procedimentos.
  var MODELOS = [
    { nome: 'Prevenção', obs: 'Avaliação e profilaxia periódicas para manter a saúde bucal em dia.', a_cada: 6 },
    { nome: 'Check-up infantil', obs: 'Acompanhamento periódico da criança, com avaliação e profilaxia.', a_cada: 6 },
    { nome: 'Controle de implantes', obs: 'Manutenção periódica de implantes e próteses sobre implante.', a_cada: 6 },
    { nome: 'Toxina botulínica', obs: 'Sessão de aplicação liberada depois de um número de mensalidades pagas.', a_cada: 5 }
  ]
  var F = { aba: 'planos', plano_id: '', situacao: 'todos' }
  var CACHE = { planos: [], tabelas: [] }

  function rotuloPeriodo(p) {
    if (p.periodicidade === 'outros') return 'A cada ' + Number(p.intervalo_meses) + (Number(p.intervalo_meses) === 1 ? ' mês' : ' meses')
    var e = PERIODOS.filter(function (x) { return x[0] === p.periodicidade })[0]
    return e ? e[1] : '—'
  }
  function rotuloLiberacao(n) { return Number(n) === 1 ? 'A cada pagamento' : 'A cada ' + Number(n) + ' pagamentos' }
  function kpi(rot, valor, cor) { return '<div class="pc-box fn-kpi' + (cor ? ' ' + cor : '') + '"><div class="pc-box-h" style="margin-bottom:8px">' + esc(rot) + '</div><div class="fn-kpi-v">' + esc(valor) + '</div></div>' }
  function falha(box, e) { box.innerHTML = '<div class="ag-err">' + esc((e && (e.error || e.message)) || 'Não foi possível carregar.') + '</div>' }
  function postar(rota, corpo) { return apiPost(rota, corpo).catch(function (e) { return { success: false, error: e.message } }) }

  // ── Tela ──────────────────────────────────────────────────────
  function desenhar() {
    var pg = el('p-planos'); if (!pg) return
    var corpo = pg.querySelector('.gpage-body'); if (!corpo) return
    corpo.style.maxWidth = '1100px'
    corpo.innerHTML =
      '<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">' +
        '<div class="fin-htab' + (F.aba === 'planos' ? ' active' : '') + '" data-aba="planos">Planos</div>' +
        '<div class="fin-htab' + (F.aba === 'pacientes' ? ' active' : '') + '" data-aba="pacientes">Pacientes nos planos</div></div>' +
      '<p class="ag-hint" style="margin:0 0 16px">As mensalidades são recebidas manualmente, em Contas a Receber ou aqui. Nenhuma cobrança é enviada ao paciente.</p>' +
      '<div id="pr-res"><div class="pc-vazio" style="padding:32px 0">Carregando...</div></div>'
    corpo.querySelectorAll('[data-aba]').forEach(function (t) { t.onclick = function () { F.aba = t.getAttribute('data-aba'); desenhar() } })
    if (F.aba === 'planos') carregarPlanos(); else carregarPacientes()
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
    var lista = CACHE.planos
    box.innerHTML = '<div class="fn-acoes" style="margin-bottom:16px"><button class="ag-btn-novo" id="pr-novo">Novo plano</button></div>' +
      (lista.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Ativo</th><th>Plano</th><th>Cobrança</th><th class="fn-num">Valor</th><th class="hide-sm">Liberação</th><th class="fn-num">Pacientes</th><th></th></tr></thead><tbody>' +
        lista.map(function (p, i) {
          return '<tr><td><input type="checkbox" data-ativo="' + i + '" aria-label="Plano ' + esc(p.nome) + ' ativo"' + (Number(p.ativo) ? ' checked' : '') + '></td>' +
            '<td class="pname">' + esc(p.nome) + '<div class="ag-hint" style="margin:2px 0 0">' + esc(p.procedimentos.join(', ')) + '</div></td>' +
            '<td>' + esc(rotuloPeriodo(p)) + '<div class="ag-hint" style="margin:2px 0 0">' + (p.duracao_meses ? esc(p.duracao_meses) + ' meses' : 'Indeterminado') + '</div></td>' +
            '<td class="fn-num">' + moeda(p.valor) + '</td><td class="hide-sm">' + esc(rotuloLiberacao(p.liberar_a_cada)) + '</td><td class="fn-num">' + Number(p.adesoes_ativas) + '</td>' +
            '<td style="text-align:right;white-space:nowrap">' + (Number(p.ativo) ? '<button class="btn btn-sm btn-primary" data-add="' + i + '">Adicionar paciente</button> ' : '') +
              '<button class="btn btn-sm" data-ver="' + i + '">Pacientes</button> <button class="btn btn-sm" data-edit="' + i + '">Editar</button>' +
              (Number(p.adesoes_total) ? '' : ' <button class="btn btn-sm" data-del="' + i + '">Excluir</button>') + '</td></tr>'
        }).join('') + '</tbody></table></div></div>'
        : '<div class="pc-box"><div class="pc-vazio" style="padding:32px 0">Nenhum plano cadastrado.</div></div>')
    el('pr-novo').onclick = function () { formPlano(null) }
    box.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { formPlano(lista[+b.getAttribute('data-edit')]) } })
    box.querySelectorAll('[data-add]').forEach(function (b) { b.onclick = function () { formAdesao(lista[+b.getAttribute('data-add')], null, carregarPlanos) } })
    box.querySelectorAll('[data-ver]').forEach(function (b) { b.onclick = function () { F.plano_id = String(lista[+b.getAttribute('data-ver')].id); F.situacao = 'todos'; F.aba = 'pacientes'; desenhar() } })
    box.querySelectorAll('[data-ativo]').forEach(function (c) {
      c.onchange = async function () {
        var r = await postar('planos-recorrentes', { action: 'ativo', id: lista[+c.getAttribute('data-ativo')].id, ativo: c.checked })
        if (!r.success) alert(r.error || 'Erro')
        carregarPlanos()
      }
    })
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        var p = lista[+b.getAttribute('data-del')]
        if (!confirm('Excluir o plano ' + p.nome + '? Ele vai para a lixeira.')) return
        var r = await postar('planos-recorrentes', { action: 'excluir', id: p.id })
        if (!r.success) alert(r.error || 'Erro')
        carregarPlanos()
      }
    })
  }

  // ── Formulário do plano ───────────────────────────────────────
  function formPlano(p) {
    var novo = !p
    var d = p || { nome: '', observacoes: '', tabela_preco: CACHE.tabelas.indexOf('PARTICULAR') >= 0 ? 'PARTICULAR' : CACHE.tabelas[0], periodicidade: 'mensal', intervalo_meses: 1, valor: '', duracao_meses: null, liberar_a_cada: 1, alerta_retorno: 1, procedimentos: [] }
    var procs = d.procedimentos.slice()
    var temAdesao = p && Number(p.adesoes_ativas) > 0
    K().modal(novo ? 'Novo plano' : 'Editar plano', '<div id="fn-err"></div>' +
      (novo ? '<div class="ag-f"><label>Começar de um modelo</label><div class="fn-acoes" style="flex-wrap:wrap">' + MODELOS.map(function (m, i) { return '<button class="btn btn-sm" data-mod="' + i + '" type="button">' + esc(m.nome) + '</button>' }).join('') + '</div></div>' : '') +
      '<div class="ag-f"><label for="pf-nome">Nome</label><input class="ag-in" id="pf-nome" maxlength="120" value="' + esc(d.nome) + '"></div>' +
      '<div class="ag-f"><label for="pf-obs">Observações</label><textarea class="ag-in" id="pf-obs" rows="2" maxlength="1000">' + esc(d.observacoes || '') + '</textarea></div>' +
      '<div class="pc-box-h" style="margin-top:16px">Procedimentos</div>' +
      '<div class="ag-row c2"><div class="ag-f"><label for="pf-tab">Lista de preços</label><select class="ag-in" id="pf-tab">' + CACHE.tabelas.map(function (t) { return '<option' + (t === d.tabela_preco ? ' selected' : '') + '>' + esc(t) + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f" style="position:relative"><label for="pf-pq">Adicionar procedimento</label><input class="ag-in" id="pf-pq" autocomplete="off" placeholder="Digite ao menos 2 letras"><div id="pf-pd"></div></div></div>' +
      '<div id="pf-procs" style="margin-bottom:8px"></div>' +
      '<div class="pc-box-h" style="margin-top:16px">Cobrança</div>' +
      '<div class="ag-row c3"><div class="ag-f"><label for="pf-per">Tipo de cobrança</label><select class="ag-in" id="pf-per">' + PERIODOS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === d.periodicidade ? ' selected' : '') + '>' + x[1] + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f" id="pf-int-box"><label for="pf-int">A cada quantos meses</label><input class="ag-in" id="pf-int" type="number" min="1" max="24" value="' + Number(d.intervalo_meses) + '"></div>' +
      '<div class="ag-f"><label for="pf-val">Valor da cobrança (R$)</label><input class="ag-in" id="pf-val" type="number" min="0" step="0.01" value="' + esc(d.valor) + '"></div></div>' +
      (temAdesao ? '<label class="ag-chk cf-chk" id="pf-apl-box" style="display:none"><input type="checkbox" id="pf-apl"> <span>Aplicar o novo valor aos ' + Number(p.adesoes_ativas) + ' pacientes deste plano, nas mensalidades ainda não vencidas</span></label>' : '') +
      '<div class="ag-row c2" style="margin-top:12px"><div class="ag-f"><label for="pf-dur-t">Duração do plano</label><select class="ag-in" id="pf-dur-t"><option value="">Indeterminado</option><option value="m"' + (d.duracao_meses ? ' selected' : '') + '>Número de meses</option></select></div>' +
      '<div class="ag-f" id="pf-dur-box"><label for="pf-dur">Meses</label><input class="ag-in" id="pf-dur" type="number" min="1" max="60" value="' + esc(d.duracao_meses || 12) + '"></div></div>' +
      '<div class="pc-box-h" style="margin-top:16px">Liberar execução do procedimento</div>' +
      '<div class="ag-row c2"><div class="ag-f"><label for="pf-lib">A cada quantos pagamentos</label><input class="ag-in" id="pf-lib" type="number" min="1" max="60" value="' + Number(d.liberar_a_cada) + '"></div></div>' +
      '<label class="ag-chk cf-chk"><input type="checkbox" id="pf-ret"' + (Number(d.alerta_retorno) ? ' checked' : '') + '> <span>Ao liberar, criar um alerta de retorno na agenda para a recepção</span></label>',
      '<button class="btn" id="pf-c">Cancelar</button><button class="ag-btn-novo" id="pf-ok">' + (novo ? 'Criar plano' : 'Salvar') + '</button>', 680)

    function desenharProcs() {
      el('pf-procs').innerHTML = procs.length ? procs.map(function (n, i) { return '<span class="pc-badge off" style="margin:0 4px 4px 0;text-transform:none;letter-spacing:0">' + esc(n) + ' <a href="#" data-rm="' + i + '" aria-label="Remover ' + esc(n) + '" style="color:var(--red);margin-left:4px">✕</a></span>' }).join('') : '<div class="ag-hint" style="margin:0">Nenhum procedimento escolhido.</div>'
      el('pf-procs').querySelectorAll('[data-rm]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); procs.splice(+a.getAttribute('data-rm'), 1); desenharProcs() } })
    }
    function visiveis() {
      el('pf-int-box').style.display = el('pf-per').value === 'outros' ? '' : 'none'
      el('pf-dur-box').style.display = el('pf-dur-t').value ? '' : 'none'
      var ap = el('pf-apl-box'); if (ap) ap.style.display = Number(el('pf-val').value) !== Number(d.valor) ? '' : 'none'
    }
    desenharProcs(); visiveis()
    el('pf-per').onchange = visiveis; el('pf-dur-t').onchange = visiveis; el('pf-val').oninput = visiveis
    el('pf-tab').onchange = function () { el('pf-pd').innerHTML = ''; el('pf-pq').value = '' }
    var t = null
    el('pf-pq').oninput = function () {
      var q = this.value.trim(); clearTimeout(t)
      var dr = el('pf-pd')
      if (q.length < 2) { dr.innerHTML = ''; return }
      t = setTimeout(async function () {
        var r = await apiData('buscar-procedimento', { q: q, tabela: el('pf-tab').value }).catch(function (e) { return { falha: e.message } })
        if (r.falha) { dr.innerHTML = '<div class="ag-err">Não foi possível buscar. Tente de novo.</div>'; return }
        var ps = r.procedimentos || []
        dr.innerHTML = '<div class="ag-pac-drop">' + (ps.length ? ps.map(function (x, i) { return '<div class="ag-pac-it" data-pi="' + i + '">' + esc(x.nome) + '<small>' + moeda(x.valor) + '</small></div>' }).join('') : '<div class="ag-pac-it" style="color:var(--text3)">Nenhum procedimento encontrado nesta lista</div>') + '</div>'
        dr.querySelectorAll('[data-pi]').forEach(function (it) { it.onclick = function () { var n = ps[+it.getAttribute('data-pi')].nome; if (procs.indexOf(n) < 0) procs.push(n); desenharProcs(); dr.innerHTML = ''; el('pf-pq').value = ''; el('pf-pq').focus() } })
      }, 250)
    }
    document.querySelectorAll('[data-mod]').forEach(function (b) {
      b.onclick = function () { var m = MODELOS[+b.getAttribute('data-mod')]; el('pf-nome').value = m.nome; el('pf-obs').value = m.obs; el('pf-lib').value = m.a_cada; el('pf-val').focus() }
    })
    el('pf-c').onclick = K().fechar
    el('pf-ok').onclick = async function () {
      var btn = this; btn.disabled = true
      var r = await postar('planos-recorrentes', { id: p ? p.id : undefined, nome: el('pf-nome').value, observacoes: el('pf-obs').value, tabela_preco: el('pf-tab').value, periodicidade: el('pf-per').value, intervalo_meses: el('pf-int').value, valor: el('pf-val').value,
        duracao_meses: el('pf-dur-t').value ? el('pf-dur').value : null, liberar_a_cada: el('pf-lib').value, alerta_retorno: el('pf-ret').checked, procedimentos: procs, aplicar_adesoes: el('pf-apl') ? el('pf-apl').checked && el('pf-apl-box').style.display !== 'none' : false })
      if (!r.success) { btn.disabled = false; return K().erro(r.error || 'Erro ao salvar') }
      K().fechar(); carregarPlanos()
    }
  }

  // ── Adesão ────────────────────────────────────────────────────
  // plano e/ou paciente podem vir prontos; o que faltar o usuário escolhe.
  async function formAdesao(plano, paciente, depois) {
    if (!plano && !CACHE.planos.length) { try { await buscarPlanos() } catch (e) { return alert(e.message) } }
    var ativos = CACHE.planos.filter(function (p) { return Number(p.ativo) })
    if (!plano && !ativos.length) return alert('Nenhum plano ativo. Cadastre um plano primeiro.')
    var sel = paciente
    K().modal('Adicionar paciente ao plano', '<div id="fn-err"></div>' +
      '<div class="ag-f"><label for="ad-pl">Plano</label>' + (plano ? '<input class="ag-in" id="ad-pl-t" readonly value="' + esc(plano.nome) + '">' : '<select class="ag-in" id="ad-pl">' + ativos.map(function (p) { return '<option value="' + Number(p.id) + '">' + esc(p.nome) + '</option>' }).join('') + '</select>') + '</div>' +
      '<div class="ag-f"><label>Paciente</label><div id="ad-pac"></div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label for="ad-dt">Primeiro vencimento</label><input class="ag-in" id="ad-dt" type="date" value="' + K().hoje() + '"></div>' +
      '<div class="ag-f"><label for="ad-val">Valor (R$)</label><input class="ag-in" id="ad-val" type="number" min="0" step="0.01"></div></div>' +
      '<div class="ag-f"><label for="ad-obs">Observações</label><input class="ag-in" id="ad-obs" maxlength="500"></div>' +
      '<p class="ag-hint" id="ad-res"></p>',
      '<button class="btn" id="ad-c">Cancelar</button><button class="ag-btn-novo" id="ad-ok">Adicionar</button>', 560)
    function planoAtual() { return plano || ativos.filter(function (p) { return String(p.id) === el('ad-pl').value })[0] }
    function resumo() {
      var p = planoAtual()
      el('ad-res').textContent = rotuloPeriodo(p) + ' · ' + (p.duracao_meses ? p.duracao_meses + ' meses' : 'prazo indeterminado') + ' · liberação ' + rotuloLiberacao(p.liberar_a_cada).toLowerCase() + '. Nada será cobrado automaticamente.'
    }
    function aoTrocarPlano() { el('ad-val').value = Number(planoAtual().valor).toFixed(2); resumo() }
    aoTrocarPlano()
    if (el('ad-pl')) el('ad-pl').onchange = aoTrocarPlano
    var box = el('ad-pac')
    function desenharPac() {
      if (sel) {
        box.innerHTML = '<div class="ag-pac-sel"><span><b>' + esc(sel.nome) + '</b></span>' + (paciente ? '' : '<button class="ag-ico" id="ad-pac-x" aria-label="Trocar paciente">✕</button>') + '</div>'
        if (el('ad-pac-x')) el('ad-pac-x').onclick = function () { sel = null; desenharPac() }
        return
      }
      box.innerHTML = '<input class="ag-in" id="ad-pq" placeholder="Buscar paciente por nome ou telefone" autocomplete="off"><div id="ad-pd"></div>'
      var t = null
      el('ad-pq').oninput = function () {
        var q = this.value.trim(); clearTimeout(t)
        var dr = el('ad-pd')
        if (q.length < 2) { dr.innerHTML = ''; return }
        t = setTimeout(async function () {
          var r = await apiData('busca', { q: q }).catch(function (e) { return { falha: e.message } })
          if (r.falha) { dr.innerHTML = '<div class="ag-err">Não foi possível buscar. Tente de novo.</div>'; return }
          var ps = r.pacientes || []
          dr.innerHTML ='<div class="ag-pac-drop">' + (ps.length ? ps.map(function (x, i) { return '<div class="ag-pac-it" data-i="' + i + '">' + esc(x.nome) + '<small>' + esc(x.telefone || '') + '</small></div>' }).join('') : '<div class="ag-pac-it" style="color:var(--text3)">Nenhum paciente encontrado</div>') + '</div>'
          dr.querySelectorAll('[data-i]').forEach(function (it) { it.onclick = function () { sel = ps[+it.getAttribute('data-i')]; desenharPac() } })
        }, 250)
      }
    }
    desenharPac()
    el('ad-c').onclick = K().fechar
    el('ad-ok').onclick = async function () {
      if (!sel) return K().erro('Escolha o paciente.')
      var btn = this; btn.disabled = true
      var r = await postar('planos-adesoes', { action: 'aderir', plano_id: planoAtual().id, paciente_id: sel.id, data_inicio: el('ad-dt').value, valor: el('ad-val').value, observacoes: el('ad-obs').value })
      if (!r.success) { btn.disabled = false; return K().erro(r.error || 'Erro') }
      K().fechar(); if (depois) depois()
    }
  }

  // ── Pacientes nos planos ──────────────────────────────────────
  async function carregarPacientes() {
    var box = el('pr-res'); if (!box) return
    if (!CACHE.planos.length) { try { await buscarPlanos() } catch (e) { return falha(box, e) } }
    box.innerHTML = '<div class="fn-filtros"><div class="ag-f"><label for="pp-pl">Plano</label><select class="ag-in" id="pp-pl"><option value="">Todos</option>' + CACHE.planos.map(function (p) { return '<option value="' + Number(p.id) + '"' + (String(p.id) === String(F.plano_id) ? ' selected' : '') + '>' + esc(p.nome) + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label for="pp-sit">Situação</label><select class="ag-in" id="pp-sit"><option value="todos">Todas</option>' + Object.keys(SIT).map(function (k) { return '<option value="' + k + '"' + (k === F.situacao ? ' selected' : '') + '>' + SIT[k][0] + '</option>' }).join('') + '</select></div>' +
      '<button class="ag-btn-novo" id="pp-add">Adicionar paciente</button></div><div id="pp-lista" style="margin-top:16px"></div>'
    el('pp-pl').onchange = function () { F.plano_id = this.value; listarPacientes() }
    el('pp-sit').onchange = function () { F.situacao = this.value; listarPacientes() }
    el('pp-add').onclick = function () {
      var p = CACHE.planos.filter(function (x) { return String(x.id) === String(F.plano_id) && Number(x.ativo) })[0]
      formAdesao(p || null, null, listarPacientes)
    }
    listarPacientes()
  }

  async function listarPacientes() {
    var box = el('pp-lista'); if (!box) return
    var d = await apiData('planos-adesoes', { plano_id: F.plano_id, situacao: F.situacao }).catch(function (e) { return { success: false, error: e.message } })
    if (!el('pp-lista')) return
    if (!d.success) return falha(box, d)
    var ativos = d.data.filter(function (a) { return a.status === 'ativo' && a.situacao !== 'concluido' })
    var mensal = ativos.reduce(function (s, a) { return s + Number(a.valor) / Number(a.intervalo_meses) }, 0)
    box.innerHTML = '<div class="fn-kpis">' + kpi('Pacientes ativos', String(ativos.length)) + kpi('Receita mensal prevista', moeda(mensal)) + kpi('Com mensalidade em atraso', String(ativos.filter(function (a) { return Number(a.atrasadas) }).length), ativos.some(function (a) { return Number(a.atrasadas) }) ? 'err' : '') + kpi('Procedimentos liberados', String(ativos.reduce(function (s, a) { return s + a.liberacoes.disponiveis }, 0))) + '</div>' +
      (d.data.length ? tabelaAdesoes(d.data) : '<div class="pc-box"><div class="pc-vazio" style="padding:32px 0">Nenhum paciente encontrado.</div></div>')
    ligarAdesoes(box, d.data, listarPacientes)
  }

  function tabelaAdesoes(lista) {
    return '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Situação</th><th>Paciente</th><th>Plano</th><th class="fn-num">Valor</th><th class="hide-sm">Próximo vencimento</th><th class="fn-num hide-sm">Pagas</th><th class="fn-num">Liberados</th><th></th></tr></thead><tbody>' +
      lista.map(function (a, i) {
        var s = SIT[a.situacao]
        return '<tr><td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span></td><td class="pname">' + esc(a.paciente_nome || '—') + '</td><td>' + esc(a.plano_nome) + '</td><td class="fn-num">' + moeda(a.valor) + '</td>' +
          '<td class="hide-sm">' + br(a.proximo) + '</td><td class="fn-num hide-sm">' + Number(a.pagos) + (a.total_parcelas ? '/' + Number(a.total_parcelas) : '') + '</td><td class="fn-num">' + Number(a.liberacoes.disponiveis) + '</td>' +
          '<td style="text-align:right"><button class="btn btn-sm" data-abrir="' + i + '">Abrir</button></td></tr>'
      }).join('') + '</tbody></table></div></div>'
  }
  function ligarAdesoes(box, lista, depois) {
    box.querySelectorAll('[data-abrir]').forEach(function (b) { b.onclick = function () { abrirAdesao(lista[+b.getAttribute('data-abrir')].id, depois) } })
  }

  // ── Detalhe ───────────────────────────────────────────────────
  async function abrirAdesao(id, depois) {
    var d = await apiData('plano-adesao', { id: id }).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro')
    var a = d.adesao, s = SIT[a.situacao], ativo = a.status === 'ativo', baixa = pode('financeiro.dar_baixa')
    function reabrir() { abrirAdesao(id, depois); if (depois) depois() }
    // Mostra o que está em aberto até o próximo a vencer e esconde a fila distante.
    var abertas = d.parcelas.filter(function (p) { return p.status === 'pendente' })
    var corte = abertas.length ? abertas[Math.min(2, abertas.length - 1)].numero : 0
    var visiveis = d.parcelas.filter(function (p) { return p.status !== 'pendente' || p.numero <= corte })
    var ocultas = d.parcelas.length - visiveis.length
    K().modal(a.paciente_nome + ' · ' + a.plano_nome, '<div id="fn-err"></div>' +
      '<div class="fn-acoes" style="align-items:center;margin-bottom:12px"><span class="pc-badge ' + s[1] + '">' + s[0] + '</span><span class="ag-hint" style="margin:0">' + moeda(a.valor) + ' · início em ' + br(a.data_inicio) + (a.duracao_meses ? ' · ' + Number(a.duracao_meses) + ' meses' : ' · prazo indeterminado') + (a.cancelado_em ? ' · cancelado em ' + br(a.cancelado_em) : '') + '</span></div>' +
      (a.motivo_cancelamento ? '<p class="ag-hint" style="margin:0 0 12px">Motivo: ' + esc(a.motivo_cancelamento) + '</p>' : '') +
      '<div class="pc-box-h">Mensalidades</div><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Nº</th><th>Vencimento</th><th>Situação</th><th class="fn-num">Valor</th><th></th></tr></thead><tbody>' +
      visiveis.map(function (p) {
        var venc = p.status === 'pendente' && String(p.vencimento) < d.hoje
        var sel = p.status === 'pago' ? '<span class="pc-badge ok">Pago</span><div class="ag-hint" style="margin:2px 0 0">em ' + br(p.data_pagamento) + '</div>' : p.status === 'cancelado' ? '<span class="pc-badge off">Cancelada</span>' : venc ? '<span class="pc-badge err">Vencida</span>' : '<span class="pc-badge pend">A vencer</span>'
        return '<tr><td>' + Number(p.numero) + '</td><td>' + br(p.vencimento) + '</td><td>' + sel + '</td><td class="fn-num">' + moeda(p.valor_pago != null ? p.valor_pago : p.valor) + '</td><td style="text-align:right;white-space:nowrap">' +
          (baixa && p.status === 'pendente' ? '<button class="btn btn-sm btn-primary" data-rec="' + p.id + '">Receber</button> <button class="btn btn-sm" data-dis="' + p.id + '">Dispensar</button>' : '') +
          (baixa && p.status === 'pago' ? '<button class="btn btn-sm" data-est="' + p.id + '">Estornar</button>' : '') + '</td></tr>'
      }).join('') + '</tbody></table></div>' +
      (ocultas > 0 ? '<p class="ag-hint">Mais ' + ocultas + ' mensalidades futuras já estão previstas.</p>' : '') +
      '<div class="pc-box-h" style="margin-top:16px">Procedimentos liberados: ' + Number(a.liberacoes.disponiveis) + '</div>' +
      '<p class="ag-hint" style="margin:0 0 8px">' + esc(rotuloLiberacao(a.liberar_a_cada)) + ' · ' + Number(a.liberacoes.ganhas) + ' liberados, ' + Number(a.liberacoes.usadas) + ' usados · ' + esc(d.procedimentos.join(', ')) + '</p>' +
      (ativo && a.liberacoes.disponiveis > 0 ? '<div class="ag-row c3"><div class="ag-f"><label for="uso-p">Procedimento</label><select class="ag-in" id="uso-p">' + d.procedimentos.map(function (n) { return '<option>' + esc(n) + '</option>' }).join('') + '</select></div><div class="ag-f"><label for="uso-d">Data</label><input class="ag-in" id="uso-d" type="date" value="' + esc(d.hoje) + '"></div><div class="ag-f"><label>&nbsp;</label><button class="btn" id="uso-ok">Registrar uso</button></div></div>' : '') +
      (d.usos.length ? d.usos.map(function (u) { return '<div class="pc-item">' + br(u.data) + ' · ' + esc(u.procedimento_nome) + (u.criado_por_nome ? ' · ' + esc(u.criado_por_nome) : '') + ' <a href="#" data-udel="' + u.id + '" style="color:var(--red)">Remover</a></div>' }).join('') : '') +
      (ativo ? '<div class="pc-box-h" style="margin-top:16px">Reajuste</div><div class="ag-row c3"><div class="ag-f"><label for="aj-v">Novo valor (R$)</label><input class="ag-in" id="aj-v" type="number" min="0" step="0.01" value="' + Number(a.valor).toFixed(2) + '"></div><div class="ag-f"><label>&nbsp;</label><button class="btn" id="aj-ok">Reajustar</button></div></div><p class="ag-hint" style="margin:0">Vale para as mensalidades ainda não vencidas deste paciente.</p>' : ''),
      ativo ? '<button class="btn" id="ad-can" style="color:var(--red)">Cancelar plano do paciente</button><button class="ag-btn-novo" id="ad-f">Fechar</button>' : '<button class="btn" id="ad-rea">Reativar</button><button class="ag-btn-novo" id="ad-f">Fechar</button>', 720)

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
        K().receberParcela({ id: p.id, origem: 'plano', paciente_nome: a.paciente_nome, descricao: 'Mensalidade ' + p.numero + ' · plano ' + a.plano_nome, valor: p.valor }, reabrir)
      }
    })
    m.querySelectorAll('[data-est]').forEach(function (b) { b.onclick = function () { if (confirm('Estornar esta mensalidade? Ela volta a ficar em aberto e sai do extrato.')) agir('plano-parcela', { action: 'estornar', id: +b.getAttribute('data-est') }) } })
    m.querySelectorAll('[data-dis]').forEach(function (b) { b.onclick = function () { if (confirm('Dispensar esta mensalidade? Ela deixa de ser cobrada.')) agir('plano-parcela', { action: 'cancelar', id: +b.getAttribute('data-dis') }) } })
    m.querySelectorAll('[data-udel]').forEach(function (l) { l.onclick = function (e) { e.preventDefault(); if (confirm('Remover este uso? O procedimento volta a ficar liberado.')) agir('plano-uso', { action: 'excluir', id: +l.getAttribute('data-udel') }) } })
    if (el('uso-ok')) el('uso-ok').onclick = function () { agir('plano-uso', { adesao_id: a.id, procedimento_nome: el('uso-p').value, data: el('uso-d').value }) }
    if (el('aj-ok')) el('aj-ok').onclick = function () { agir('planos-adesoes', { action: 'valor', id: a.id, valor: el('aj-v').value }) }
    if (el('ad-rea')) el('ad-rea').onclick = function () { agir('planos-adesoes', { action: 'reativar', id: a.id }) }
    if (el('ad-can')) el('ad-can').onclick = function () {
      var motivo = prompt('Cancelar o plano de ' + a.paciente_nome + '? As mensalidades futuras deixam de existir; as vencidas continuam em aberto.\n\nMotivo (opcional):')
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
    box.innerHTML = '<div class="pc-box"><div class="pc-box-h">Planos recorrentes <a href="#" id="pr-qp-add" style="float:right;text-transform:none;letter-spacing:0;color:var(--green3)">Adicionar ao plano</a></div>' +
      (d.data.length ? tabelaAdesoes(d.data) : '<div class="ag-hint" style="margin:0">Este paciente não participa de nenhum plano.</div>') + '</div>'
    cont.appendChild(box)
    function atualizar() { quadroPaciente(pacId) }
    ligarAdesoes(box, d.data, atualizar)
    el('pr-qp-add').onclick = async function (e) {
      e.preventDefault()
      var nome = (d.data[0] && d.data[0].paciente_nome) || ''
      if (!nome) { var pr = await apiData('paciente', { id: pacId }).catch(function () { return {} }); nome = (pr.data && pr.data.nome) || (pr.paciente && pr.paciente.nome) || 'Paciente' }
      formAdesao(null, { id: pacId, nome: nome }, atualizar)
    }
  }

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
