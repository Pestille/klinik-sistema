// public/crc.js — CRC: Central de Relacionamento com o Cliente (Fase 5)
// Klinov — Campo Grande, MS
//
// Home com as filas (#/crc) e quadro kanban por fila (#/crc/<fila>). Os cartões
// vêm prontos do servidor (crc-quadro); aqui só se filtra, move e registra contato.
;(function () {
  'use strict'

  var FORMAS = [['ligacao', 'Ligação'], ['whatsapp', 'WhatsApp'], ['presencial', 'Presencial'], ['email', 'E-mail'], ['sms', 'SMS']]
  var FORMA_NOME = { etapa: 'Mudança de etapa' }
  FORMAS.forEach(function (f) { FORMA_NOME[f[0]] = f[1] })
  var FAIXAS = [['', 'Padrão da fila'], ['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['7', 'Últimos 7 dias'], ['15', 'Últimos 15 dias'], ['30', 'Últimos 30 dias'], ['mes_passado', 'Mês passado'], ['custom', 'Data personalizada']]
  // Texto inicial da mensagem de WhatsApp por fila ({nome} = primeiro nome)
  var MSG = {
    sem_confirmacao: 'Olá, {nome}! Tudo bem? Passando para confirmar a sua consulta {ctx}. Podemos confirmar?',
    aniversariantes: 'Olá, {nome}! A equipe da {clinica} deseja um feliz aniversário! Muita saúde e muitos sorrisos.',
    cancelamentos: 'Olá, {nome}! Vimos que a sua consulta foi desmarcada. Vamos encontrar um novo horário para você?',
    faltas: 'Olá, {nome}! Sentimos sua falta na consulta. Vamos remarcar? Temos horários disponíveis esta semana.',
    faltas_primeira: 'Olá, {nome}! Sentimos sua falta na sua primeira consulta conosco. Podemos remarcar para um horário melhor para você?',
    inadimplencia: 'Olá, {nome}! Tudo bem? Identificamos parcela(s) em aberto do seu tratamento. Podemos ajudar com a regularização?',
    orcamentos_abertos: 'Olá, {nome}! Ficou alguma dúvida sobre o orçamento que preparamos para você? Estamos à disposição.',
    tratamento_sem_agendamento: 'Olá, {nome}! Seu tratamento ainda tem etapas pendentes. Vamos agendar a próxima sessão?',
    alerta_retorno: 'Olá, {nome}! Está chegando a hora do seu retorno. Vamos agendar?'
  }

  var CR = { fila: null, dados: null, filtros: {}, arrastando: null, profs: null }

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function hojeYmd() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function isAdmin() { return (KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }
  function primeiroNome(n) { var s = String(n || '').trim().split(' ')[0]; return s.charAt(0) + s.slice(1).toLowerCase() }
  function foneWa(f) { var d = String(f || '').replace(/\D/g, ''); if (d.length < 10) return ''; return d.slice(0, 2) === '55' ? d : '55' + d }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('crc-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'crc-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10010'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 620) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="crc-m-x">✕</button></div>' +
      '<div class="ag-modal-b" id="crc-m-b">' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('crc-m-x').onclick = fecharModal
    ov.onmousedown = function (e) { if (e.target === ov) fecharModal() }
  }
  function fecharModal() { var ov = el('crc-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }

  function pagina() { return el('p-crc') }

  // ════════════════════════════════════════════════════════════════
  // HOME
  // ════════════════════════════════════════════════════════════════
  async function abrirHome() {
    CR.fila = null
    var pg = pagina(); if (!pg) return
    pg.innerHTML = '<div class="gpage-header"><div><div class="gpage-title">CRC</div><div class="gpage-sub">Central de relacionamento: quem precisa de contato hoje</div></div></div>' +
      '<div class="gpage-body"><div class="crc-home" id="crc-home"><div class="crc-sk"></div><div class="crc-sk"></div><div class="crc-sk"></div></div></div>'
    var d
    try { d = await apiData('crc-filas', {}) } catch (e) { el('crc-home').innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>'; return }
    if (!d.success) { el('crc-home').innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    el('crc-home').innerHTML = d.filas.map(function (f) {
      return '<div class="pc-box crc-card' + (f.ativo ? '' : ' off') + '" data-fila="' + f.id + '">' +
        '<div class="crc-card-t">' + esc(f.nome) + '</div><div class="ag-hint" style="margin:4px 0 12px">' + esc(f.descricao) + '</div>' +
        (f.ativo ? (f.total == null ? '<div class="crc-card-n">Não foi possível calcular agora</div>' : '<div class="crc-card-n"><span>' + f.total + '</span> paciente(s) para contatar</div>') + (f.atrasados ? '<span class="pc-badge err">' + f.atrasados + ' atividade(s) em atraso</span>' : '')
          : '<div class="ag-hint">Fila desativada</div>' + (isAdmin() ? '<button class="btn btn-sm" data-ativar="' + f.id + '" style="margin-top:8px">Ativar</button>' : '')) +
        '</div>'
    }).join('') +
      '<div class="pc-box crc-card" data-followup="1"><div class="crc-card-t">Follow-up automático de orçamentos</div><div class="ag-hint" style="margin:4px 0 12px">Régua de WhatsApp com assistente virtual para quem recebeu orçamento e ainda não fechou.</div><div class="crc-card-n">Abrir painel</div></div>' +
      '<div class="pc-box crc-card" data-inativos="1"><div class="crc-card-t">Pacientes inativos</div><div class="ag-hint" style="margin:4px 0 12px">Sem consulta há mais de 6 meses: reativação por WhatsApp.</div><div class="crc-card-n">Abrir lista</div></div>'
    el('crc-home').querySelectorAll('[data-fila]').forEach(function (c) {
      c.onclick = function (e) { if (e.target.closest('[data-ativar]') || c.classList.contains('off')) return; abrirFila(c.getAttribute('data-fila')) }
    })
    el('crc-home').querySelectorAll('[data-ativar]').forEach(function (b) {
      b.onclick = async function () { var r = await apiPost('crc-filas', { fila: this.getAttribute('data-ativar'), ativo: 1 }); if (!r.success) return alert(r.error || 'Erro'); abrirHome() }
    })
    el('crc-home').querySelector('[data-inativos]').onclick = function () { nav('crm') }
    el('crc-home').querySelector('[data-followup]').onclick = function () { if (window.abrirFollowup) abrirFollowup() }
  }

  // ════════════════════════════════════════════════════════════════
  // QUADRO KANBAN
  // ════════════════════════════════════════════════════════════════
  async function carregarProfs() {
    if (CR.profs) return CR.profs
    try { var d = await apiData('profissionais'); CR.profs = (d.data || []).filter(function (p) { return p.ativo !== 0 }) } catch (e) { CR.profs = [] }
    return CR.profs
  }

  function faixaParaDatas(fx) {
    var h = hojeYmd()
    if (fx === 'hoje') return [h, h]
    if (fx === 'amanha') return [addDias(h, 1), addDias(h, 1)]
    if (fx === '7' || fx === '15' || fx === '30') return [addDias(h, -Number(fx)), h]
    if (fx === 'mes_passado') { var d = new Date(); var i = new Date(d.getFullYear(), d.getMonth() - 1, 1), f = new Date(d.getFullYear(), d.getMonth(), 0); var y = function (x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') }; return [y(i), y(f)] }
    return null
  }

  async function abrirFila(fila) {
    if (CR.fila !== fila) CR.filtros = { faixa: '', ordem: 'recente', q: '', profissional_id: '', de: '', ate: '' }
    CR.fila = fila
    if (typeof setRouteHash === 'function') setRouteHash('crc/' + fila)
    var profs = await carregarProfs(), F = CR.filtros
    var pg = pagina()
    pg.innerHTML = '<div class="gpage-header"><div><div class="gpage-title"><a class="crc-voltar" id="crc-voltar">CRC</a> › <span id="crc-titulo"></span></div><div class="gpage-sub" id="crc-sub"></div></div>' +
      '<div class="flex">' + (pode('crc.exportar_planilha') ? '<button class="btn" id="crc-rel">Relatório</button>' : '') + '<button class="btn" id="crc-atualizar">Atualizar</button>' +
        (isAdmin() ? '<button class="btn" id="crc-desativar" title="Esconde esta fila da home do CRC">Desativar fila</button>' : '') + '</div></div>' +
      '<div class="gpage-body"><div class="crc-filtros">' +
        '<div class="ag-f"><label>Profissional</label><select class="ag-in" id="crc-f-prof"><option value="">Todos</option>' + profs.map(function (p) { return '<option value="' + p.id + '"' + (String(F.profissional_id) === String(p.id) ? ' selected' : '') + '>' + esc(p.nome) + '</option>' }).join('') + '</select></div>' +
        '<div class="ag-f"><label>Ordenar por</label><select class="ag-in" id="crc-f-ordem"><option value="recente">Mais recente</option><option value="antigo"' + (F.ordem === 'antigo' ? ' selected' : '') + '>Mais antigo</option></select></div>' +
        '<div class="ag-f" style="flex:2;min-width:180px"><label>Pesquisar paciente</label><input class="ag-in" id="crc-f-q" placeholder="Nome ou nº do prontuário" value="' + esc(F.q) + '"></div>' +
        '<div class="ag-f"><label>Faixa de tempo</label><select class="ag-in" id="crc-f-faixa">' + FAIXAS.map(function (x) { return '<option value="' + x[0] + '"' + (F.faixa === x[0] ? ' selected' : '') + '>' + x[1] + '</option>' }).join('') + '</select></div>' +
        '<div class="ag-f"><label>De</label><input class="ag-in" type="date" id="crc-f-de" value="' + (F.de || '') + '"></div>' +
        '<div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="crc-f-ate" value="' + (F.ate || '') + '"></div>' +
      '</div><div class="crc-board" id="crc-board"><div class="crc-sk" style="height:240px"></div></div></div>'
    el('crc-voltar').onclick = function () { if (typeof setRouteHash === 'function') setRouteHash('crc'); abrirHome() }
    el('crc-atualizar').onclick = carregarQuadro
    if (el('crc-rel')) el('crc-rel').onclick = exportarRelatorio
    if (el('crc-desativar')) el('crc-desativar').onclick = async function () {
      if (!confirm('Desativar esta fila? Ela some da home do CRC até ser ativada de novo.')) return
      var r = await apiPost('crc-filas', { fila: fila, ativo: 0 }); if (!r.success) return alert(r.error || 'Erro')
      if (typeof setRouteHash === 'function') setRouteHash('crc'); abrirHome()
    }
    el('crc-f-prof').onchange = function () { F.profissional_id = this.value; carregarQuadro() }
    el('crc-f-ordem').onchange = function () { F.ordem = this.value; carregarQuadro() }
    var tq = null
    el('crc-f-q').oninput = function () { var v = this.value; clearTimeout(tq); tq = setTimeout(function () { F.q = v; carregarQuadro() }, 350) }
    el('crc-f-faixa').onchange = function () {
      F.faixa = this.value
      var ds = faixaParaDatas(F.faixa)
      if (ds) { F.de = ds[0]; F.ate = ds[1] } else if (!F.faixa) { F.de = ''; F.ate = '' }
      el('crc-f-de').value = F.de; el('crc-f-ate').value = F.ate
      if (F.faixa !== 'custom') carregarQuadro()
    }
    function datas() { F.de = el('crc-f-de').value; F.ate = el('crc-f-ate').value; F.faixa = 'custom'; el('crc-f-faixa').value = 'custom'; if (F.de && F.ate) carregarQuadro() }
    el('crc-f-de').onchange = datas; el('crc-f-ate').onchange = datas
    carregarQuadro()
  }

  async function carregarQuadro() {
    var F = CR.filtros, fila = CR.fila, d
    try { d = await apiData('crc-quadro', { fila: fila, q: F.q, ordem: F.ordem, profissional_id: F.profissional_id, de: F.de, ate: F.ate }) } catch (e) { el('crc-board').innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>'; return }
    if (CR.fila !== fila || !el('crc-board')) return
    if (!d.success) { el('crc-board').innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    CR.dados = d
    el('crc-titulo').textContent = d.fila.nome
    el('crc-sub').textContent = d.fila.descricao + ' Período: ' + br(d.filtros.de) + ' a ' + br(d.filtros.ate) + '.'
    if (!F.de) { el('crc-f-de').value = d.filtros.de; el('crc-f-ate').value = d.filtros.ate }
    desenharQuadro()
  }

  function prioridade(c) {
    if (c.resolvido) return 'ok'
    if (c.dias >= 7) return 'alta'
    if (c.dias >= 3) return 'media'
    return 'baixa'
  }
  function diasTxt(c) {
    if (c.dias === 0) return 'hoje'
    if (c.dias < 0) return 'em ' + (-c.dias) + ' dia' + (c.dias === -1 ? '' : 's')
    return c.dias + ' dia' + (c.dias === 1 ? '' : 's')
  }

  function desenharQuadro() {
    var d = CR.dados, board = el('crc-board')
    board.innerHTML = d.etapas.map(function (e) {
      var cs = d.cartoes.filter(function (c) { return c.etapa === e.id })
      return '<div class="crc-col" data-etapa="' + e.id + '"><div class="crc-col-h"><b>' + esc(e.nome) + '</b><span>Quantidade ' + cs.length + '</span></div><div class="crc-col-b">' +
        (cs.length ? cs.map(cartaoHtml).join('') : '<div class="crc-vazio">Nenhum paciente</div>') + '</div></div>'
    }).join('')
    board.querySelectorAll('.crc-cartao').forEach(function (n) {
      var c = d.cartoes[+n.getAttribute('data-i')]
      n.addEventListener('dragstart', function (ev) { CR.arrastando = c; n.classList.add('arrastando'); try { ev.dataTransfer.setData('text/plain', c.chave) } catch (e) {} })
      n.addEventListener('dragend', function () { n.classList.remove('arrastando'); CR.arrastando = null; board.querySelectorAll('.crc-col').forEach(function (x) { x.classList.remove('alvo') }) })
      n.querySelector('[data-pac]') && (n.querySelector('[data-pac]').onclick = function (ev) { ev.stopPropagation(); if (c.paciente_id) abrirProntuario('', c.paciente_id) })
      n.querySelector('[data-int]').onclick = function (ev) { ev.stopPropagation(); novaInteracao(c) }
      var wa = n.querySelector('[data-wa]'); if (wa) wa.onclick = function (ev) { ev.stopPropagation(); abrirWhatsApp(c) }
    })
    board.querySelectorAll('.crc-col').forEach(function (col) {
      col.addEventListener('dragover', function (ev) { if (!CR.arrastando) return; ev.preventDefault(); col.classList.add('alvo') })
      col.addEventListener('dragleave', function (ev) { if (!col.contains(ev.relatedTarget)) col.classList.remove('alvo') })
      col.addEventListener('drop', function (ev) {
        ev.preventDefault(); col.classList.remove('alvo')
        var c = CR.arrastando, etapa = col.getAttribute('data-etapa'); CR.arrastando = null
        if (c && etapa !== c.etapa) moverCartao(c, etapa)
      })
    })
  }

  function cartaoHtml(c, i) {
    var idx = CR.dados.cartoes.indexOf(c), pr = prioridade(c)
    return '<div class="crc-cartao' + (c.atrasado ? ' atrasado' : '') + '" draggable="' + (c.resolvido ? 'false' : 'true') + '" data-i="' + idx + '"' + (c.resolvido ? ' title="Movido automaticamente: o evento já foi resolvido"' : '') + '>' +
      '<div class="crc-c-top"><span class="crc-dot ' + pr + '" title="Prioridade"></span><a class="crc-c-nome"' + (c.paciente_id ? ' data-pac="1"' : '') + '>' + esc(c.paciente_nome || 'Paciente sem cadastro') + '</a><span class="crc-c-dias">' + diasTxt(c) + '</span></div>' +
      '<div class="crc-c-data">' + br(c.data_evento) + (c.hora ? ' · ' + esc(c.hora) : '') + (c.profissional_nome ? ' · ' + esc(c.profissional_nome) : '') + '</div>' +
      '<div class="crc-c-ctx">' + esc(c.contexto || '') + '</div>' +
      (c.etapa === 'retornar' && c.retornar_em ? '<div class="crc-c-ret' + (c.atrasado ? ' err' : '') + '">Retornar em ' + br(c.retornar_em) + (c.atrasado ? ' (em atraso)' : '') + '</div>' : '') +
      '<div class="crc-c-acoes">' + (foneWa(c.fone) && pode('crc.enviar_mensagem') ? '<button class="btn btn-sm" data-wa="1">WhatsApp</button>' : '') + '<button class="btn btn-sm" data-int="1">+ Nova interação</button></div></div>'
  }

  function pedirData(titulo, aoOk) {
    modal(titulo, '<div id="crc-d-err"></div><div class="ag-f"><label>Retornar em</label><input class="ag-in" type="date" id="crc-d-dt" value="' + addDias(hojeYmd(), 1) + '"></div>',
      '<button class="btn" id="crc-d-c">Cancelar</button><button class="ag-btn-novo" id="crc-d-ok">Confirmar</button>', 420)
    el('crc-d-c').onclick = fecharModal
    el('crc-d-ok').onclick = function () { var v = el('crc-d-dt').value; if (!v) return; fecharModal(); aoOk(v) }
  }

  async function moverCartao(c, etapa) {
    if (c.resolvido) return alert('Este cartão foi movido automaticamente porque o evento já foi resolvido (ex.: o paciente agendou ou pagou).')
    async function enviar(dt) {
      var r = await apiPost('crc-cartao', { fila: CR.fila, chave: c.chave, paciente_id: c.paciente_id, paciente_nome: c.paciente_nome, etapa: etapa, retornar_em: dt })
      if (!r.success) alert(r.error || 'Erro ao mover')
      carregarQuadro()
    }
    if (etapa === 'retornar') return pedirData('Quando retornar o contato?', enviar)
    enviar(null)
  }

  function abrirWhatsApp(c) {
    var fone = foneWa(c.fone); if (!fone) return
    var clinica = (ST.clinica && ST.clinica.nome) || (KLINOV_USER && KLINOV_USER.clinica_nome) || 'clínica'
    var ctx = /amanhã/.test(c.contexto || '') ? 'de amanhã' : c.data_evento ? 'do dia ' + br(c.data_evento) + (c.hora ? ' às ' + c.hora : '') : ''
    var txt = (MSG[CR.fila] || 'Olá, {nome}!').replace('{nome}', primeiroNome(c.paciente_nome)).replace('{clinica}', clinica).replace('{ctx}', ctx)
    window.open('https://wa.me/' + fone + '?text=' + encodeURIComponent(txt), '_blank')
  }

  // ── Nova interação ──────────────────────────────────────────────
  async function novaInteracao(c) {
    var etapas = CR.dados.etapas
    var sugerida = c.resolvido ? c.etapa : (etapas.some(function (e) { return e.id === 'contato' }) && etapas[0].id === c.etapa ? 'contato' : c.etapa)
    modal('Nova interação — ' + (c.paciente_nome || ''), '<div id="crc-i-err"></div>' +
      '<div class="ag-hint" style="margin:0 0 12px">' + esc(c.contexto || '') + '</div>' +
      '<div class="ag-f"><label>Forma de contato</label><div class="ag-chips" id="crc-i-forma">' + FORMAS.map(function (f, i) { return '<span class="ag-chip' + (i === 0 ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</span>' }).join('') + '</div></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Etapa</label><select class="ag-in" id="crc-i-etapa"' + (c.resolvido ? ' disabled' : '') + '>' + etapas.map(function (e) { return '<option value="' + e.id + '"' + (e.id === sugerida ? ' selected' : '') + '>' + esc(e.nome) + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f" id="crc-i-ret-box"><label>Retornar em</label><input class="ag-in" type="date" id="crc-i-ret" value="' + (c.retornar_em || addDias(hojeYmd(), 1)) + '"></div></div>' +
      '<div class="ag-f"><label>Detalhes da interação</label><textarea class="ag-in" id="crc-i-det" rows="4" maxlength="2000" placeholder="O que foi conversado, próximo passo combinado…"></textarea></div>' +
      '<div class="pc-box-h" style="margin-top:16px">Histórico de contatos</div><div id="crc-i-hist" class="ag-hint">Carregando…</div>',
      '<button class="btn" id="crc-i-c">Cancelar</button><button class="ag-btn-novo" id="crc-i-ok">Salvar</button>', 640)
    var forma = 'ligacao'
    el('crc-i-forma').querySelectorAll('[data-f]').forEach(function (s) {
      s.onclick = function () { forma = this.getAttribute('data-f'); el('crc-i-forma').querySelectorAll('[data-f]').forEach(function (x) { x.classList.toggle('on', x === s) }) }
    })
    function mostraRet() { el('crc-i-ret-box').style.visibility = el('crc-i-etapa').value === 'retornar' ? 'visible' : 'hidden' }
    el('crc-i-etapa').onchange = mostraRet; mostraRet()
    el('crc-i-c').onclick = fecharModal
    el('crc-i-ok').onclick = async function () {
      var etapa = el('crc-i-etapa').value, btn = this
      btn.disabled = true
      var r = await apiPost('crc-interacao', { fila: CR.fila, chave: c.chave, paciente_id: c.paciente_id, paciente_nome: c.paciente_nome, forma: forma, etapa: etapa, retornar_em: etapa === 'retornar' ? el('crc-i-ret').value : null, detalhes: el('crc-i-det').value })
      btn.disabled = false
      if (!r.success) { el('crc-i-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      fecharModal(); carregarQuadro()
    }
    var h = await apiData('crc-interacoes', c.paciente_id ? { paciente_id: c.paciente_id } : { fila: CR.fila, chave: c.chave }).catch(function () { return { data: [] } })
    if (el('crc-i-hist')) el('crc-i-hist').outerHTML = '<div id="crc-i-hist">' + historicoHtml(h.data || []) + '</div>'
  }

  function historicoHtml(lista) {
    if (!lista.length) return '<div class="pc-vazio">Nenhum contato registrado.</div>'
    return lista.map(function (x) {
      return '<div class="pc-nota"><div><b style="color:var(--text);font-weight:500">' + esc(FORMA_NOME[x.forma] || x.forma) + '</b> · ' + esc(x.fila_nome) + ' → ' + esc(x.etapa_nome) + (x.retornar_em ? ' (retornar em ' + br(x.retornar_em) + ')' : '') +
        (x.detalhes ? '<div style="margin-top:2px;color:var(--text2)">' + esc(x.detalhes) + '</div>' : '') +
        '<small>' + esc(x.usuario_nome || '') + ' · ' + br(x.criado_em) + ' ' + String(x.criado_em || '').slice(11, 16) + '</small></div></div>'
    }).join('')
  }

  // Bloco "Contatos do CRC" na Visão Geral do paciente (public/paciente.js)
  async function crcHistoricoPaciente(box, pacienteId) {
    if (!box || !pode('crc.acessar')) return
    var h = await apiData('crc-interacoes', { paciente_id: pacienteId }).catch(function () { return null })
    if (!h || !h.success) return
    box.innerHTML = '<div class="pc-box" style="margin-top:16px"><div class="pc-box-h">Contatos do CRC</div>' + historicoHtml((h.data || []).slice(0, 10)) +
      (h.data.length > 10 ? '<div class="ag-hint">Mostrando os 10 mais recentes de ' + h.data.length + '.</div>' : '') + '</div>'
  }

  // ── Relatório (CSV do quadro filtrado) ──────────────────────────
  function exportarRelatorio() {
    var d = CR.dados; if (!d) return
    var nomes = {}; d.etapas.forEach(function (e) { nomes[e.id] = e.nome })
    var linhas = [['Paciente', 'Prontuário', 'Telefone', 'Data do evento', 'Hora', 'Profissional', 'Contexto', 'Etapa', 'Retornar em', 'Dias']]
    d.cartoes.forEach(function (c) { linhas.push([c.paciente_nome, c.paciente_id || '', c.fone || '', br(c.data_evento), c.hora || '', c.profissional_nome || '', c.contexto || '', nomes[c.etapa] || c.etapa, br(c.retornar_em), c.dias]) })
    var csv = '﻿' + linhas.map(function (l) { return l.map(function (v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }).join(';') }).join('\r\n')
    var a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'crc-' + CR.fila + '-' + hojeYmd() + '.csv'
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }

  // Entrada pelo menu (nav('crc')) e pelo endereço #/crc/<fila>
  function loadCrc() {
    var p = (location.hash || '').replace(/^#\/?/, '').split('/')
    if (p[0] === 'crc' && p[1] === 'followup' && window.abrirFollowup) return abrirFollowup()
    if (p[0] === 'crc' && p[1]) return abrirFila(p[1])
    abrirHome()
  }

  window.loadCrc = loadCrc
  window.abrirFilaCrc = abrirFila
  window.crcHistoricoPaciente = crcHistoricoPaciente
})()
