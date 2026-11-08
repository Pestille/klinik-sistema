// public/lote2.js — Assinatura eletrônica, crédito e avulsos na ficha, anexos de contas,
// pastas de fotos e especialidades múltiplas do profissional
// Klinov — Campo Grande, MS
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function v(id) { var e = el(id); return e ? e.value : '' }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function hora(d) { return String(d || '').slice(11, 16) }
  function hoje() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
  function moeda(x) { return 'R$ ' + Number(x || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function foneWa(f) { var d = String(f || '').replace(/\D/g, ''); if (d.length < 10) return ''; return d.slice(0, 2) === '55' ? d : '55' + d }
  function isAdmin() { return (window.KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }
  function pacAtual() { return ((window._prontData || {}).paciente) || {} }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('l2-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'l2-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10012'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 620) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="l2-x">✕</button></div><div class="ag-modal-b"><div id="l2-err"></div>' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('l2-x').onclick = fechar
    ov.onmousedown = function (e) { if (e.target === ov) fechar() }
  }
  function fechar() { var ov = el('l2-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  function erro(m) { var e = el('l2-err'); if (e) e.innerHTML = m ? '<div class="ag-err">' + esc(m) + '</div>' : '' }
  function lerArquivo(f) { return new Promise(function (ok, nok) { var r = new FileReader(); r.onload = function () { ok(r.result) }; r.onerror = function () { nok(new Error('Não foi possível ler o arquivo')) }; r.readAsDataURL(f) }) }

  // ════════════════════════════════════════════════════════════════
  // ASSINATURA ELETRÔNICA
  // ════════════════════════════════════════════════════════════════
  var ROT = { documento: 'documento', evolucao: 'evolução', procedimento: 'procedimento', anamnese: 'anamnese' }
  async function abrirAssinatura(tipo, refId, depois) {
    var d = await apiData('assinaturas', { tipo: tipo, ref_id: refId }).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro')
    var assinado = d.data.filter(function (a) { return a.status === 'assinado' })[0]
    var pend = d.data.filter(function (a) { return a.status === 'pendente' })[0]
    if (assinado) return mostrarAssinada(assinado, tipo, refId, depois)
    if (pend) return mostrarPendente(pend, null, depois)
    modal('Assinatura do paciente', '<p style="margin-top:0">Gere um link para o paciente ler e assinar este ' + ROT[tipo] + ' pelo celular, ou abra o link aqui mesmo para ele assinar no tablet da clínica.</p>' +
      '<p class="ag-hint">O conteúdo é congelado no momento do pedido. O paciente confirma a data de nascimento (ou o início do CPF), digita o nome, desenha a assinatura e aceita o termo. Ficam registrados data, hora, IP e aparelho.</p>',
      '<button class="btn" id="l2-c">Cancelar</button><button class="ag-btn-novo" id="l2-gerar">Gerar link de assinatura</button>', 560)
    el('l2-c').onclick = fechar
    el('l2-gerar').onclick = function () { gerar(tipo, refId, false, depois) }
  }
  async function gerar(tipo, refId, nova, depois) {
    var r = await apiPost('assinatura-solicitar', { tipo: tipo, ref_id: refId, nova: nova }).catch(function (e) { return { success: false, error: e.message } })
    if (!r.success) return erro(r.error || 'Erro ao gerar o link')
    mostrarPendente({ id: r.id, expira_em: r.expira_em }, r, depois)
    if (depois) depois()
  }
  function mostrarPendente(a, r, depois) {
    var url = r ? location.origin + r.caminho : '', wa = r ? foneWa(r.telefone) : ''
    var nome1 = r ? String(r.paciente || '').split(' ')[0] : ''
    modal('Assinatura pendente', (url ? '<div class="ag-f"><label>Link para o paciente</label><input class="ag-in" id="l2-url" readonly value="' + esc(url) + '"></div>' :
      '<p style="margin-top:0">Já existe um pedido aguardando a assinatura do paciente (válido até ' + br(a.expira_em) + '). Por segurança o link não é mostrado de novo; gere outro se o paciente não o encontrar.</p>') +
      '<p class="ag-hint">O link vale até ' + br(a.expira_em) + ' e só pode ser usado uma vez.</p>',
      '<button class="btn" id="l2-cancelar" style="color:var(--red);margin-right:auto">Cancelar pedido</button>' + (url ? '<button class="btn" id="l2-copiar">Copiar link</button><button class="btn" id="l2-aqui">Assinar neste aparelho</button>' + (wa ? '<a class="ag-btn-novo" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Olá, ' + nome1.charAt(0) + nome1.slice(1).toLowerCase() + '! Segue o link para você ler e assinar seu documento: ' + url) + '">Enviar no WhatsApp</a>' : '') : '<button class="ag-btn-novo" id="l2-novo">Gerar novo link</button>'), 720)
    if (el('l2-copiar')) el('l2-copiar').onclick = function () { var i = el('l2-url'); i.select(); try { navigator.clipboard.writeText(i.value) } catch (e) { document.execCommand('copy') } this.textContent = 'Copiado' }
    if (el('l2-aqui')) el('l2-aqui').onclick = function () { window.open(url, '_blank') }
    if (el('l2-novo')) el('l2-novo').onclick = function () { gerar(a.tipo, a.ref_id, false, depois) }
    el('l2-cancelar').onclick = async function () { if (!confirm('Cancelar o pedido de assinatura? O link para de funcionar.')) return; var x = await apiPost('assinatura-cancelar', { id: a.id }); if (!x.success) return erro(x.error); fechar(); if (depois) depois() }
  }
  function mostrarAssinada(a, tipo, refId, depois) {
    modal('Assinado pelo paciente', '<div class="l2-ass"><img src="' + esc(a.assinatura_img || '') + '" alt="Assinatura"></div>' +
      '<table class="pc-tbl l2-evid"><tbody>' + [['Assinado por', a.assinatura_nome], ['Data e hora', br(a.assinado_em) + ' às ' + hora(a.assinado_em)], ['IP', a.ip], ['Aparelho', a.navegador], ['Pedido por', (a.criado_por || '—') + ' em ' + br(a.criado_em)], ['Código de verificação', a.verificacao], ['Integridade (SHA-256)', a.hash]].map(function (x) { return '<tr><td style="width:160px;color:var(--text3)">' + x[0] + '</td><td style="word-break:break-all">' + esc(x[1] || '—') + '</td></tr>' }).join('') + '</tbody></table>',
      '<button class="btn" id="l2-nova" style="margin-right:auto">Pedir nova assinatura</button><button class="ag-btn-novo" id="l2-ok">Fechar</button>', 620)
    el('l2-ok').onclick = fechar
    el('l2-nova').onclick = function () { if (confirm('Pedir nova assinatura? A atual continua registrada.')) gerar(tipo, refId, true, depois) }
  }
  // Marca botões/links [data-ass="ID"] de uma lista com a situação da assinatura
  async function ligarAssinaturas(box, tipo, pacienteId) {
    if (!box) return
    var alvos = box.querySelectorAll('[data-ass]'); if (!alvos.length) return
    var d = await apiData('assinaturas', { paciente_id: pacienteId, tipo: tipo, sem_imagem: 1 }).catch(function () { return { data: [] } })
    var st = {}
    ;(d.data || []).forEach(function (a) { if (!st[a.ref_id] || a.status === 'assinado') st[a.ref_id] = a.status })
    function aplicar() {
      box.querySelectorAll('[data-ass]').forEach(function (b) {
        var id = +b.getAttribute('data-ass'), s = st[id]
        b.textContent = s === 'assinado' ? 'Assinado ✓' : s === 'pendente' ? 'Aguardando assinatura' : 'Pedir assinatura'
        b.style.color = s === 'assinado' ? 'var(--green)' : s === 'pendente' ? 'var(--orange)' : ''
        b.onclick = function (e) { e.preventDefault(); abrirAssinatura(tipo, id, function () { ligarAssinaturas(box, tipo, pacienteId) }) }
      })
    }
    aplicar()
  }
  // Para imprimir um documento já assinado
  async function assinaturaDoDocumento(docId) {
    var d = await apiData('assinaturas', { tipo: 'documento', ref_id: docId }).catch(function () { return { data: [] } })
    return (d.data || []).filter(function (a) { return a.status === 'assinado' })[0] || null
  }

  window.abrirAssinatura = abrirAssinatura

  // Ficha clínica (procedimentos executados): botão "Solicitar" do app.html
  window.solicitarAssinatura = function (procId) { abrirAssinatura('procedimento', procId, marcarFicha) }
  var marcando = false
  async function marcarFicha() {
    var box = el('pront-content'), p = pacAtual(); if (!box || !p.id || marcando) return
    var bts = Array.prototype.filter.call(box.querySelectorAll('button[onclick^="solicitarAssinatura("]'), function (b) { return !b.hasAttribute('data-ass') })
    if (!bts.length) return
    marcando = true
    bts.forEach(function (b) { var m = /solicitarAssinatura\((\d+)\)/.exec(b.getAttribute('onclick')); if (m) { b.setAttribute('data-ass', m[1]); b.removeAttribute('onclick'); b.style.background = 'transparent'; b.style.color = 'var(--blue)'; b.style.border = '1px solid var(--border)' } })
    await ligarAssinaturas(box, 'procedimento', p.id)
    marcando = false
  }
  function observarFicha() { var pc = el('pront-content'); if (pc) new MutationObserver(function () { marcarFicha() }).observe(pc, { childList: true, subtree: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observarFicha); else observarFicha()

  // Anamnese: "Pedir assinatura" ao lado de "Enviar por link"
  if (typeof window.renderAnamneseTab === 'function') {
    var anamAnt = window.renderAnamneseTab
    window.renderAnamneseTab = async function (box, p) {
      await anamAnt(box, p)
      if (window._anamneseEditMode) return
      var editar = Array.prototype.filter.call(box.querySelectorAll('button'), function (b) { return b.textContent === 'Editar' })[0]
      if (!editar || !((_prontData && _prontData.anamnese) || []).length) return
      var b = document.createElement('button'); b.className = 'btn'; b.setAttribute('data-ass', p.id); b.textContent = 'Pedir assinatura'
      editar.parentNode.insertBefore(b, editar)
      ligarAssinaturas(editar.parentNode, 'anamnese', p.id)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // FINANCEIRO DO PACIENTE: crédito e lançamentos avulsos
  // ════════════════════════════════════════════════════════════════
  var FORMAS = [['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['debito', 'Cartão de débito'], ['credito', 'Cartão de crédito'], ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['cheque', 'Cheque']]
  function selFormas(id) { return '<select class="ag-in" id="' + id + '">' + FORMAS.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>' }).join('') + '</select>' }
  async function caixaFinanceira(box, pacId) {
    var alvo = el('l2-fin'); if (!alvo) { alvo = document.createElement('div'); alvo.id = 'l2-fin'; box.insertBefore(alvo, box.firstChild) }
    var c = await apiData('paciente-credito', { paciente_id: pacId }).catch(function () { return null })
    var a = await apiData('paciente-avulso', { paciente_id: pacId }).catch(function () { return null })
    if (!c || !a) { alvo.remove(); return }
    var pend = []
    ;(window._finPacData || []).forEach(function (o) { (o.parcelas || []).forEach(function (x) { if (x.status !== 'pago' && x.status !== 'cancelado') pend.push({ id: x.id, rot: (x.tipo === 'entrada' ? 'Entrada' : 'Parcela ' + x.numero_parcela + '/' + x.total_parcelas) + ' · orç. #' + (o.orcamento_id || o.id) + ' · venc. ' + br(x.data_vencimento) + ' · ' + moeda(x.valor), valor: Number(x.valor) }) }) })
    var avPend = a.data.filter(function (x) { return x.situacao !== 'pago' })
    var SIT = { pago: ['Pago', 'ok'], vencido: ['Vencido', 'err'], a_vencer: ['A vencer', 'pend'] }
    alvo.innerHTML = '<div class="l2-fin-g"><div class="pc-box"><div class="pc-box-h">Crédito do paciente</div><div class="fn-kpi-v" style="margin:4px 0 12px">' + moeda(c.saldo) + '</div>' +
      '<div class="fn-acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn btn-sm btn-primary" id="l2-dep">+ Adicionar crédito</button>' + (c.saldo > 0 && (pend.length || avPend.length) ? '<button class="btn btn-sm" id="l2-usar">Pagar com crédito</button>' : '') + (c.saldo > 0 ? '<button class="btn btn-sm" id="l2-dev">Devolver</button>' : '') + (c.extrato.length ? '<button class="btn btn-sm" id="l2-ext">Extrato</button>' : '') + '</div></div>' +
      '<div class="pc-box"><div class="pc-box-h">Lançamentos avulsos <a href="#" id="l2-novo-av">+ Novo</a></div>' + (a.data.length ? '<table class="pc-tbl"><tbody>' + a.data.slice(0, 8).map(function (x) { var s = SIT[x.situacao]; return '<tr><td>' + esc(x.descricao) + '<div class="ag-hint" style="margin:0">' + (x.pagamento ? 'Pago em ' + br(x.pagamento) : 'Vence ' + br(x.vencimento)) + '</div></td><td class="fn-num">' + moeda(x.valor) + '</td><td><span class="pc-badge ' + s[1] + '">' + s[0] + '</span></td><td style="text-align:right;white-space:nowrap">' + (x.situacao !== 'pago' ? '<button class="btn btn-sm" data-rec="' + x.id + '">Receber</button> <a href="#" data-canc="' + x.id + '" style="color:var(--red);font-size:12px">Cancelar</a>' : '') + '</td></tr>' }).join('') + '</tbody></table>' : '<div class="pc-vazio" style="padding:8px 0;text-align:left">Consultas, urgências e outros valores fora de orçamento.</div>') + '</div></div>'
    function recarregar() { caixaFinanceira(box, pacId) }
    el('l2-dep').onclick = function () {
      modal('Adicionar crédito', '<p class="ag-hint" style="margin-top:0">Valor pago antecipadamente pelo paciente. Entra no caixa agora e pode ser usado depois para pagar parcelas ou lançamentos.</p><div class="ag-row c3"><div class="ag-f"><label>Valor (R$)</label><input class="ag-in" id="l2-v" inputmode="decimal"></div><div class="ag-f"><label>Forma</label>' + selFormas('l2-f') + '</div><div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="l2-d" value="' + hoje() + '"></div></div><div class="ag-f"><label>Descrição</label><input class="ag-in" id="l2-ds" maxlength="140" placeholder="Crédito do paciente"></div>',
        '<button class="btn" id="l2-c">Cancelar</button><button class="ag-btn-novo" id="l2-ok">Adicionar</button>')
      el('l2-c').onclick = fechar
      el('l2-ok').onclick = async function () { var r = await apiPost('paciente-credito', { paciente_id: pacId, action: 'depositar', valor: v('l2-v'), forma: v('l2-f'), data: v('l2-d'), descricao: v('l2-ds') }); if (!r.success) return erro(r.error); fechar(); recarregar() }
    }
    if (el('l2-usar')) el('l2-usar').onclick = function () {
      var ops = pend.map(function (x) { return '<option value="p:' + x.id + '">' + esc(x.rot) + '</option>' }).concat(avPend.map(function (x) { return '<option value="a:' + x.id + '">' + esc(x.descricao + ' · ' + moeda(x.valor)) + '</option>' }))
      modal('Pagar com crédito', '<p class="ag-hint" style="margin-top:0">Saldo disponível: <b>' + moeda(c.saldo) + '</b>. O pagamento não entra de novo no caixa: o dinheiro já entrou quando o crédito foi adicionado.</p><div class="ag-f"><label>O que pagar</label><select class="ag-in" id="l2-alvo">' + ops.join('') + '</select></div>',
        '<button class="btn" id="l2-c">Cancelar</button><button class="ag-btn-novo" id="l2-ok">Pagar</button>')
      el('l2-c').onclick = fechar
      el('l2-ok').onclick = async function () { var x = v('l2-alvo').split(':'); var r = await apiPost('paciente-credito', x[0] === 'p' ? { paciente_id: pacId, action: 'usar', parcela_id: +x[1] } : { paciente_id: pacId, action: 'usar', avulso_id: +x[1] }); if (!r.success) return erro(r.error); fechar(); if (typeof loadFinanceiroPaciente === 'function') loadFinanceiroPaciente(pacId); else recarregar() }
    }
    if (el('l2-dev')) el('l2-dev').onclick = function () {
      modal('Devolver crédito', '<div class="ag-row c3"><div class="ag-f"><label>Valor (R$)</label><input class="ag-in" id="l2-v" inputmode="decimal" value="' + String(c.saldo.toFixed(2)).replace('.', ',') + '"></div><div class="ag-f"><label>Forma</label>' + selFormas('l2-f') + '</div><div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="l2-d" value="' + hoje() + '"></div></div>',
        '<button class="btn" id="l2-c">Cancelar</button><button class="ag-btn-novo" id="l2-ok">Devolver</button>')
      el('l2-c').onclick = fechar
      el('l2-ok').onclick = async function () { var r = await apiPost('paciente-credito', { paciente_id: pacId, action: 'devolver', valor: v('l2-v'), forma: v('l2-f'), data: v('l2-d') }); if (!r.success) return erro(r.error); fechar(); recarregar() }
    }
    if (el('l2-ext')) el('l2-ext').onclick = function () {
      var T = { deposito: ['Crédito', 'ok'], uso: ['Uso', 'pend'], devolucao: ['Devolução', 'err'] }
      modal('Extrato de crédito', '<table class="pc-tbl"><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th style="text-align:right">Valor</th></tr></thead><tbody>' + c.extrato.map(function (x) { var t = T[x.tipo] || [x.tipo, 'off']; return '<tr><td>' + br(x.data) + '</td><td><span class="pc-badge ' + t[1] + '">' + t[0] + '</span></td><td>' + esc(x.descricao || '') + (x.criado_por_nome ? '<div class="ag-hint" style="margin:0">' + esc(x.criado_por_nome) + '</div>' : '') + '</td><td class="fn-num">' + (x.tipo === 'deposito' ? '' : '− ') + moeda(x.valor) + '</td></tr>' }).join('') + '</tbody></table>', '<button class="ag-btn-novo" id="l2-ok">Fechar</button>', 680)
      el('l2-ok').onclick = fechar
    }
    el('l2-novo-av').onclick = function (e) {
      e.preventDefault()
      modal('Novo lançamento avulso', '<div class="ag-f"><label>Descrição</label><input class="ag-in" id="l2-ds" maxlength="140" placeholder="Ex.: Consulta de urgência"></div><div class="ag-row c2"><div class="ag-f"><label>Valor (R$)</label><input class="ag-in" id="l2-v" inputmode="decimal"></div><div class="ag-f"><label>Vencimento</label><input class="ag-in" type="date" id="l2-d" value="' + hoje() + '"></div></div>' +
        '<label class="ag-chk"><input type="checkbox" id="l2-pago"> Já foi pago</label><div class="ag-f" id="l2-fb" style="display:none;margin-top:8px"><label>Forma</label>' + selFormas('l2-f') + '</div>',
        '<button class="btn" id="l2-c">Cancelar</button><button class="ag-btn-novo" id="l2-ok">Salvar</button>')
      el('l2-pago').onchange = function () { el('l2-fb').style.display = this.checked ? '' : 'none' }
      el('l2-c').onclick = fechar
      el('l2-ok').onclick = async function () { var r = await apiPost('paciente-avulso', { paciente_id: pacId, descricao: v('l2-ds'), valor: v('l2-v'), vencimento: v('l2-d'), pago: el('l2-pago').checked, forma: v('l2-f') }); if (!r.success) return erro(r.error); fechar(); recarregar() }
    }
    alvo.querySelectorAll('[data-rec]').forEach(function (b) {
      b.onclick = function () {
        var id = +this.getAttribute('data-rec')
        modal('Receber lançamento', '<div class="ag-row c2"><div class="ag-f"><label>Forma</label>' + selFormas('l2-f') + '</div><div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="l2-d" value="' + hoje() + '"></div></div>', '<button class="btn" id="l2-c">Cancelar</button><button class="ag-btn-novo" id="l2-ok">Confirmar recebimento</button>', 520)
        el('l2-c').onclick = fechar
        el('l2-ok').onclick = async function () { var r = await apiPost('paciente-avulso', { paciente_id: pacId, action: 'receber', id: id, forma: v('l2-f'), data: v('l2-d') }); if (!r.success) return erro(r.error); fechar(); recarregar() }
      }
    })
    alvo.querySelectorAll('[data-canc]').forEach(function (b) { b.onclick = async function (e) { e.preventDefault(); if (!confirm('Cancelar este lançamento?')) return; var r = await apiPost('paciente-avulso', { paciente_id: pacId, action: 'cancelar', id: +this.getAttribute('data-canc') }); if (!r.success) return alert(r.error); recarregar() } })
  }
  if (typeof window.renderFinanceiroPaciente === 'function') {
    var finAnt = window.renderFinanceiroPaciente
    window.renderFinanceiroPaciente = function (box, pacId) {
      var r = finAnt.apply(this, arguments)
      if (box && pode('pacientes.financeiro')) caixaFinanceira(box, pacId)
      return r
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ANEXOS (contas a pagar)
  // ════════════════════════════════════════════════════════════════
  async function abrirAnexos(entidade, refId, titulo, depois) {
    var d = await apiData('anexos', { entidade: entidade, ref_id: refId }).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro')
    modal('Anexos — ' + titulo, (d.data.length ? '<table class="pc-tbl"><tbody>' + d.data.map(function (x) {
      return '<tr><td>' + esc(x.nome) + (x.comprovante ? ' <span class="pc-badge ok">Comprovante</span>' : '') + '<div class="ag-hint" style="margin:0">' + Math.max(1, Math.round((x.tamanho || 0) / 1024)) + ' KB · ' + br(x.criado_em) + (x.criado_por_nome ? ' · ' + esc(x.criado_por_nome) : '') + '</div></td><td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-ver="' + x.id + '">Abrir</button> <button class="btn btn-sm" data-rm="' + x.id + '" style="color:var(--red)">Remover</button></td></tr>'
    }).join('') + '</tbody></table>' : '<div class="pc-vazio">Nenhum arquivo. Anexe o boleto, a nota fiscal ou o comprovante de pagamento.</div>') +
      '<div class="ag-row c2" style="margin-top:16px;align-items:end"><div class="ag-f"><label>Arquivo (imagem ou PDF, até 1,5 MB)</label><input class="ag-in" type="file" id="l2-arq" accept="image/png,image/jpeg,image/webp,application/pdf"></div><label class="ag-chk" style="margin-bottom:12px"><input type="checkbox" id="l2-comp"> É o comprovante de pagamento</label></div>',
      '<button class="btn" id="l2-c">Fechar</button><button class="ag-btn-novo" id="l2-env">Anexar</button>', 640)
    el('l2-c').onclick = function () { fechar(); if (depois) depois() }
    el('l2-env').onclick = async function () {
      var f = el('l2-arq').files[0]; if (!f) return erro('Escolha um arquivo.')
      if (f.size > 1500000) return erro('Arquivo muito grande (máximo 1,5 MB).')
      var dados = await lerArquivo(f)
      var r = await apiPost('anexos', { entidade: entidade, ref_id: refId, nome: f.name, dados: dados, comprovante: el('l2-comp').checked })
      if (!r.success) return erro(r.error)
      abrirAnexos(entidade, refId, titulo, depois)
    }
    document.querySelectorAll('#l2-modal-ov [data-ver]').forEach(function (b) {
      b.onclick = async function () {
        var w = window.open('', '_blank')
        var r = await apiData('anexos', { entidade: entidade, ref_id: refId, id: +this.getAttribute('data-ver') })
        if (!r.success || !w) return
        w.document.write(/^data:image\/[a-z0-9.+-]+;base64,/i.test(r.anexo.dados) ? '<title>' + esc(r.anexo.nome) + '</title><img src="' + esc(r.anexo.dados) + '" style="max-width:100%">' : '<title>' + esc(r.anexo.nome) + '</title><iframe src="' + esc(r.anexo.dados) + '" style="border:0;width:100%;height:100vh"></iframe>')
        w.document.close()
      }
    })
    document.querySelectorAll('#l2-modal-ov [data-rm]').forEach(function (b) {
      b.onclick = async function () { if (!confirm('Remover este anexo?')) return; var r = await apiPost('anexos', { entidade: entidade, ref_id: refId, action: 'excluir', id: +this.getAttribute('data-rm') }); if (!r.success) return erro(r.error); abrirAnexos(entidade, refId, titulo, depois) }
    })
  }

  // ════════════════════════════════════════════════════════════════
  // FOTOS EM PASTAS (aba Fotos do prontuário)
  // ════════════════════════════════════════════════════════════════
  var FT = { pasta: '', sel: null }   // sel = null (fora do modo seleção) ou {ids}

  // ZIP sem compressão (método store) para "Baixar Selecionadas"
  function _crcTab() { if (_crcTab.t) return _crcTab.t; var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return _crcTab.t = t }
  function _crc32(u8) { var t = _crcTab(), c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
  function _b64bytes(dataUrl) { var b = atob(String(dataUrl).split(',')[1] || ''), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u }
  function montarZip(arquivos) { // [{nome, dados(Uint8Array)}] → Blob
    var pedacos = [], centro = [], off = 0, enc = new TextEncoder()
    function n2(v) { return [v & 255, (v >> 8) & 255] } function n4(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255] }
    arquivos.forEach(function (a) {
      var nome = enc.encode(a.nome), crc = _crc32(a.dados), tam = a.dados.length
      var loc = new Uint8Array([].concat(n4(0x04034b50), n2(20), n2(0), n2(0), n2(0), n2(0), n4(crc), n4(tam), n4(tam), n2(nome.length), n2(0)))
      pedacos.push(loc, nome, a.dados)
      centro.push({ nome: nome, crc: crc, tam: tam, off: off })
      off += loc.length + nome.length + tam
    })
    var cdIni = off, cdTam = 0
    centro.forEach(function (c) {
      var cd = new Uint8Array([].concat(n4(0x02014b50), n2(20), n2(20), n2(0), n2(0), n2(0), n2(0), n4(c.crc), n4(c.tam), n4(c.tam), n2(c.nome.length), n2(0), n2(0), n2(0), n2(0), n4(0), n4(c.off)))
      pedacos.push(cd, c.nome); cdTam += cd.length + c.nome.length
    })
    pedacos.push(new Uint8Array([].concat(n4(0x06054b50), n2(0), n2(0), n2(arquivos.length), n2(arquivos.length), n4(cdTam), n4(cdIni), n2(0))))
    return new Blob(pedacos, { type: 'application/zip' })
  }
  function baixarBlob(blob, nome) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href) }, 5000) }
  function nomeArquivoFoto(f, i) { var n = String(f.nome || 'foto-' + (i + 1)); if (!/\.(jpe?g|png|webp|gif)$/i.test(n)) n += /image\/png/.test(f.url) ? '.png' : '.jpg'; return n.replace(/[\\/:*?"<>|]/g, '_') }

  // Marcadores padrão do Clinicorp ("Adicionar Marcador")
  var MARCADORES_PADRAO = ['Face', 'Frontal', 'Intra-oral', 'Lateral', 'Oclusal', 'Panorâmica', 'Perfil', 'Periapical', 'Sorriso', 'Teleradiografia', 'Tomografia']
  function fotoMarcadores(f) { try { var m = JSON.parse(f.marcadores || '[]'); return Array.isArray(m) ? m : [] } catch (e) { return [] } }

  async function abaFotos(box, p) {
    box.innerHTML = '<div class="crc-sk" style="height:160px"></div>'
    var d = await apiData('documentos-paciente', { paciente_id: p.id, tipo: 'foto' }).catch(function (e) { return { success: false, error: e.message } })
    var ps = await apiData('fotos-pastas', { paciente_id: p.id }).catch(function () { return { pastas: [], total: 0, sem_pasta: 0 } })
    if (!d.success) { box.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    var fotos = d.documentos || [], pastas = ps.pastas || []
    if (FT.pasta && FT.pasta !== '__sem' && !pastas.some(function (x) { return x.nome === FT.pasta })) FT.pasta = ''
    var vis = fotos.filter(function (f) { return !FT.pasta || (FT.pasta === '__sem' ? !f.pasta : f.pasta === FT.pasta) })
    var podeEnviar = pode('pacientes.fotos')
    var sel = FT.sel
    var nomePastaAtual = FT.pasta && FT.pasta !== '__sem' ? FT.pasta : ''
    box.innerHTML = '<div class="l2-ft-h"><div class="gpage-title" style="font-size:16px">Fotos</div><div class="fn-acoes">' +
      (fotos.length > 1 && !sel ? '<button class="btn" id="l2-cmp">Comparar fotos</button>' : '') + (fotos.length && !sel ? '<button class="btn" id="l2-selm">Selecionar</button>' : '') +
      (podeEnviar && !sel ? '<button class="btn" id="l2-pasta">+ Nova Pasta</button><label class="btn" style="cursor:pointer">Câmera Intraoral<input type="file" accept="image/*" capture="environment" id="l2-cam" style="display:none"></label><label class="ag-btn-novo" style="cursor:pointer">+ Adicionar fotos<input type="file" accept="image/*" multiple id="l2-up" style="display:none"></label>' : '') + '</div></div>' +
      (sel ? '<div class="pc-box" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px;margin-bottom:12px"><b id="l2-sel-n" style="font-size:13px">' + sel.ids.length + (sel.ids.length === 1 ? ' Foto Selecionada' : ' fotos selecionadas') + '</b>' +
        '<button class="btn btn-sm" id="l2-sel-todas">Selecionar Todas</button><button class="btn btn-sm" id="l2-sel-cmp">Comparar as 2 fotos selecionadas</button><button class="btn btn-sm" id="l2-sel-bx">Baixar Selecionadas</button>' +
        (podeEnviar ? '<select class="ag-in btn-sm" id="l2-sel-mv" style="width:auto;padding:4px 8px"><option value="">Mover para Pasta…</option><option value="__sem">Tirar da Pasta</option>' + pastas.map(function (x) { return '<option value="' + esc(x.nome) + '">' + esc(x.nome) + '</option>' }).join('') + '</select><button class="btn btn-sm" id="l2-sel-ex" style="color:var(--red)">Excluir Selecionadas</button>' : '') +
        '<button class="btn btn-sm" id="l2-sel-c">Cancelar Seleção</button></div>' : '') +
      '<div class="ag-chips l2-pastas"><span class="ag-chip' + (!FT.pasta ? ' on' : '') + '" data-p="">Todas (' + fotos.length + ')</span>' + pastas.map(function (x) { return '<span class="ag-chip' + (FT.pasta === x.nome ? ' on' : '') + '" data-p="' + esc(x.nome) + '">' + esc(x.nome) + ' (' + x.n + ')</span>' }).join('') + (ps.sem_pasta && pastas.length ? '<span class="ag-chip' + (FT.pasta === '__sem' ? ' on' : '') + '" data-p="__sem">Sem pasta (' + ps.sem_pasta + ')</span>' : '') +
      (nomePastaAtual && podeEnviar ? ' <a href="#" id="l2-p-ren" style="font-size:12px">Renomear Pasta</a> · <a href="#" id="l2-p-exc" style="font-size:12px;color:var(--red)">Excluir pasta</a>' : '') + '</div>' +
      (vis.length ? '<div class="l2-ft-grid">' + vis.map(function (f) {
        var marcada = sel && sel.ids.indexOf(f.id) >= 0
        return '<div class="l2-ft' + (marcada ? ' l2-ft-on' : '') + '">' +
          (sel ? '<label style="display:block;padding:6px 10px;border-bottom:1px solid var(--border2);font-size:12px;cursor:pointer"><input type="checkbox" data-sel="' + f.id + '"' + (marcada ? ' checked' : '') + '> Selecionar</label>' : '') +
          '<div class="l2-ft-img" data-ver="' + f.id + '">' + (/^data:image\/[a-z0-9.+-]+;base64,/i.test(f.url || '') ? '<img src="' + esc(f.url) + '" alt="">' : '') + '</div><div class="l2-ft-i"><div class="l2-ft-n" title="' + esc(f.nome || '') + '">' + esc(f.nome || 'Foto') + '</div>' +
          '<div class="ag-hint" style="margin:0">' + br(f.created_at) + (f.pasta ? ' · ' + esc(f.pasta) : '') + '</div>' +
          '<div class="ag-hint l2-ft-leg" data-leg="' + f.id + '" style="margin:2px 0 0;cursor:pointer;font-style:' + (f.descricao ? 'normal' : 'italic') + '" title="Clique para editar a legenda">' + (f.descricao ? esc(f.descricao) : 'Legenda...') + '</div>' +
          (function () {
            var ms = fotoMarcadores(f)
            if (!ms.length && (!podeEnviar || sel)) return ''
            return '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;align-items:center">' +
              ms.map(function (m2) { return '<span class="l2-ft-tag">' + esc(m2) + (podeEnviar && !sel ? '<a href="#" data-mrm="' + f.id + '" data-nome="' + esc(m2) + '" aria-label="Remover marcador ' + esc(m2) + '">&times;</a>' : '') + '</span>' }).join('') +
              (podeEnviar && !sel ? '<select class="ag-in" data-marc="' + f.id + '" style="width:auto;max-width:140px;padding:2px 6px;font-size:11px"><option value="">Adicionar Marcador</option>' +
                MARCADORES_PADRAO.filter(function (m2) { return !ms.some(function (x) { return x.toLocaleLowerCase('pt-BR') === m2.toLocaleLowerCase('pt-BR') }) }).map(function (m2) { return '<option value="' + esc(m2) + '">' + esc(m2) + '</option>' }).join('') +
                '<option value="__novo">Novo marcador…</option></select>' : '') +
            '</div>'
          })() +
          (podeEnviar && !sel ? '<div class="l2-ft-a"><select class="ag-in" data-mv="' + f.id + '"><option value="">Mover para Pasta</option><option value="__sem">Tirar da Pasta</option>' + pastas.filter(function (x) { return x.nome !== f.pasta }).map(function (x) { return '<option value="' + esc(x.nome) + '">' + esc(x.nome) + '</option>' }).join('') + '</select><a href="#" data-bx="' + f.id + '" style="font-size:12px">Baixar</a><a href="#" data-ex="' + f.id + '" style="color:var(--red);font-size:12px">Excluir</a></div>' : '') + '</div></div>'
      }).join('') + '</div>' : '<div class="pc-vazio" style="padding:40px 0">' + (fotos.length ? 'Nenhuma foto nesta pasta' : 'Adicione fotos, exames ou radiografias para visualizá-los aqui.') + '</div>')
    function recarregar() { abaFotos(box, p) }
    function fotosSel() { return fotos.filter(function (f) { return sel && sel.ids.indexOf(f.id) >= 0 }) }
    if (el('l2-cmp')) el('l2-cmp').onclick = function () { if (window.compararFotos) compararFotos(vis.length > 1 ? vis : fotos) }
    if (el('l2-selm')) el('l2-selm').onclick = function () { FT.sel = { ids: [] }; recarregar() }
    if (el('l2-sel-c')) el('l2-sel-c').onclick = function () { FT.sel = null; recarregar() }
    if (el('l2-sel-todas')) el('l2-sel-todas').onclick = function () { FT.sel = { ids: vis.map(function (f) { return f.id }) }; recarregar() }
    box.querySelectorAll('[data-sel]').forEach(function (c) { c.onchange = function () { var id = +this.getAttribute('data-sel'); var i = sel.ids.indexOf(id); if (this.checked && i < 0) sel.ids.push(id); if (!this.checked && i >= 0) sel.ids.splice(i, 1); recarregar() } })
    if (el('l2-sel-cmp')) el('l2-sel-cmp').onclick = function () { var fs = fotosSel(); if (fs.length !== 2) return alert('Selecione exatamente 2 fotos para comparar'); if (window.compararFotos) compararFotos(fs, true) }
    if (el('l2-sel-bx')) el('l2-sel-bx').onclick = function () {
      var fs = fotosSel(); if (!fs.length) return alert('Nenhuma foto na lista.')
      try {
        var arqs = fs.map(function (f, i) { return { nome: nomeArquivoFoto(f, i), dados: _b64bytes(f.url) } })
        baixarBlob(montarZip(arqs), 'fotos-' + String(p.nome || 'paciente').trim().split(/\s+/)[0].toLowerCase() + '.zip')
        if (typeof toast === 'function') toast('Download realizado com sucesso.')
      } catch (e) { alert('Não foi possível baixar as fotos selecionadas.') }
    }
    if (el('l2-sel-mv')) el('l2-sel-mv').onchange = async function () {
      if (!this.value || !sel.ids.length) return
      var r = await apiPost('foto-pasta', { ids: sel.ids, pasta: this.value === '__sem' ? '' : this.value })
      if (!r.success) return alert(r.error || 'Não foi possível mover as fotos selecionadas.')
      FT.sel = null; recarregar()
    }
    if (el('l2-sel-ex')) el('l2-sel-ex').onclick = async function () {
      var fs = fotosSel(); if (!fs.length) return alert('Nenhuma foto na lista.')
      if (!confirm('Excluir fotos selecionadas?\n\n' + fs.length + (fs.length === 1 ? ' foto será removida permanentemente.' : ' fotos serão removidas permanentemente.') + ' Esta ação não pode ser desfeita.')) return
      for (var i = 0; i < fs.length; i++) await apiPost('excluir-documento', { id: fs[i].id }).catch(function () { })
      FT.sel = null; recarregar()
    }
    box.querySelectorAll('[data-p]').forEach(function (c) { c.onclick = function () { FT.pasta = this.getAttribute('data-p'); recarregar() } })
    if (el('l2-p-ren')) el('l2-p-ren').onclick = async function (e) {
      e.preventDefault()
      var n = prompt('Nome da Pasta:', nomePastaAtual); if (!n || !n.trim() || n.trim() === nomePastaAtual) return
      var r = await apiPost('foto-pasta', { action: 'renomear', paciente_id: p.id, pasta: nomePastaAtual, novo: n.trim() })
      if (!r.success) return alert(r.error || 'Não foi possível renomear a pasta.')
      FT.pasta = n.trim().slice(0, 60); recarregar()
    }
    if (el('l2-p-exc')) el('l2-p-exc').onclick = async function (e) {
      e.preventDefault()
      if (!confirm('Excluir pasta?\n\nAs fotos desta pasta voltarão para "Sem pasta".')) return
      var r = await apiPost('foto-pasta', { action: 'excluir', paciente_id: p.id, pasta: nomePastaAtual })
      if (!r.success) return alert(r.error || 'Não foi possível excluir a pasta.')
      FT.pasta = ''; recarregar()
    }
    box.querySelectorAll('[data-leg]').forEach(function (a) {
      a.onclick = async function () {
        if (!podeEnviar) return
        var f = fotos.filter(function (x) { return x.id === +a.getAttribute('data-leg') })[0] || {}
        var leg = prompt('Legenda:', f.descricao || ''); if (leg == null) return
        var r = await apiPost('foto-pasta', { action: 'legenda', id: f.id, legenda: leg })
        if (!r.success) return alert(r.error || 'Não foi possível atualizar a legenda.')
        if (typeof toast === 'function') toast('Legenda atualizada.')
        recarregar()
      }
    })
    box.querySelectorAll('[data-ver]').forEach(function (c) { c.onclick = function () { if (sel) { var cb = c.parentNode.querySelector('[data-sel]'); if (cb) { cb.checked = !cb.checked; cb.onchange() } return } abrirPreviewDoc(this.getAttribute('data-ver')) } })
    box.querySelectorAll('[data-mv]').forEach(function (s) { s.onchange = async function () { if (!this.value) return; var r = await apiPost('foto-pasta', { id: +this.getAttribute('data-mv'), pasta: this.value === '__sem' ? '' : this.value }); if (!r.success) return alert(r.error); recarregar() } })
    box.querySelectorAll('[data-bx]').forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault()
        var f = fotos.filter(function (x) { return x.id === +a.getAttribute('data-bx') })[0]
        if (!f) return
        try { baixarBlob(new Blob([_b64bytes(f.url)], { type: /png/.test(f.url) ? 'image/png' : 'image/jpeg' }), nomeArquivoFoto(f, 0)); if (typeof toast === 'function') toast('Foto baixada com sucesso.') } catch (x) { alert('Não foi possível baixar a foto.') }
      }
    })
    box.querySelectorAll('[data-ex]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); excluirDocumento(+this.getAttribute('data-ex'), p.id, 'foto') } })
    box.querySelectorAll('[data-marc]').forEach(function (s) {
      s.onchange = async function () {
        var v = this.value
        if (!v) return
        if (v === '__novo') { v = prompt('Nome do marcador:') || ''; v = v.trim().slice(0, 40); if (!v) { this.value = ''; return } }
        var r = await apiPost('foto-pasta', { action: 'marcador', id: +this.getAttribute('data-marc'), nome: v })
        if (!r.success) return alert(r.error || 'Não foi possível adicionar o marcador.')
        recarregar()
      }
    })
    box.querySelectorAll('[data-mrm]').forEach(function (a) {
      a.onclick = async function (e) {
        e.preventDefault()
        var r = await apiPost('foto-pasta', { action: 'marcador', id: +this.getAttribute('data-mrm'), nome: this.getAttribute('data-nome'), remover: 1 })
        if (!r.success) return alert(r.error || 'Não foi possível remover o marcador.')
        recarregar()
      }
    })
    if (el('l2-pasta')) el('l2-pasta').onclick = async function () { var n = prompt('Digite o nome da pasta para organizar os arquivos.'); if (!n || !n.trim()) return; var r = await apiPost('foto-pasta', { action: 'criar', paciente_id: p.id, pasta: n.trim() }); if (!r.success) return alert(r.error); FT.pasta = n.trim().slice(0, 60); recarregar() }
    async function enviar(files) {
      var pasta = FT.pasta && FT.pasta !== '__sem' ? FT.pasta : '', erros = []
      for (var i = 0; i < files.length; i++) {
        if (files[i].size > 1500000) { erros.push(files[i].name + ' (maior que 1,5 MB)'); continue }
        var r = await apiPost('salvar-documento', { paciente_id: p.id, tipo: 'foto', nome: files[i].name, url: await lerArquivo(files[i]), pasta: pasta }).catch(function (e) { return { success: false, error: e.message } })
        if (!r.success) erros.push(files[i].name)
      }
      if (erros.length) alert('Não foi possível enviar: ' + erros.join(', '))
      else if (typeof toast === 'function') toast('Foto(s) salva(s) com sucesso')
      recarregar()
    }
    if (el('l2-up')) el('l2-up').onchange = function () { enviar(this.files) }
    if (el('l2-cam')) el('l2-cam').onchange = function () { enviar(this.files) }
  }
  if (typeof window.renderDocumentosTab === 'function') {
    var docsAnt = window.renderDocumentosTab
    window.renderDocumentosTab = function (box, p, aba) {
      if (aba === 'fotos') return abaFotos(box, p)
      return docsAnt.apply(this, arguments)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // PROFISSIONAL: várias especialidades (campo continua texto separado por vírgula)
  // ════════════════════════════════════════════════════════════════
  var ESPS = null
  async function chipsEspecialidade(inp) {
    if (!inp || inp._l2) return
    inp._l2 = true
    if (!ESPS) { try { ESPS = ((await apiData('especialidades', {})).data || []).map(function (e) { return e.nome }) } catch (e) { ESPS = [] } }
    var atuais = String(inp.value || '').split(/\s*[,;]\s*/).filter(Boolean)
    var todas = ESPS.concat(atuais.filter(function (a) { return ESPS.indexOf(a) < 0 }))
    if (!todas.length) return
    inp.style.display = 'none'
    var box = document.createElement('div'); box.className = 'ag-chips'; box.style.marginTop = '4px'
    box.innerHTML = todas.map(function (n) { return '<span class="ag-chip' + (atuais.indexOf(n) >= 0 ? ' on' : '') + '" data-e="' + esc(n) + '">' + esc(n) + '</span>' }).join('')
    inp.parentNode.appendChild(box)
    box.querySelectorAll('[data-e]').forEach(function (c) {
      c.onclick = function () { this.classList.toggle('on'); inp.value = Array.prototype.filter.call(box.querySelectorAll('.on'), function () { return true }).map(function (x) { return x.getAttribute('data-e') }).join(', ') }
    })
    var lb = inp.parentNode.querySelector('label'); if (lb && lb.textContent === 'Especialidade') lb.textContent = 'Especialidades'
  }
  new MutationObserver(function () { var i = el('np-f-esp'); if (i && !i._l2) chipsEspecialidade(i) }).observe(document.documentElement, { childList: true, subtree: true })

  window.abrirAssinatura = abrirAssinatura
  window.ligarAssinaturas = ligarAssinaturas
  window.assinaturaDoDocumento = assinaturaDoDocumento
  window.abrirAnexos = abrirAnexos
})()
