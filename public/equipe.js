// public/equipe.js — CliniChat, notificações, menu lateral, filtros de listas e Receita Saúde em lote
// Klinov — Campo Grande, MS
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function logado() { return !!(window.KLINOV_USER && localStorage.getItem('klinov_token')) }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function quando(s) {
    if (!s) return ''
    var hoje = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10)
    return String(s).slice(0, 10) === hoje ? String(s).slice(11, 16) : br(s) + ' ' + String(s).slice(11, 16)
  }
  function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  var ICO_CHAT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>'

  // ════════════════════════════════════════════════════════════════
  // TOPO: chat, notificações, vídeos e suporte
  // ════════════════════════════════════════════════════════════════
  function botaoTopo(titulo) { return Array.prototype.filter.call(document.querySelectorAll('.topbar-right .icon-btn'), function (b) { return b.title === titulo })[0] }
  function badge(btn, n) {
    if (!btn) return
    var b = btn.querySelector('.tb-badge')
    if (!b) { b = document.createElement('span'); b.className = 'tb-badge'; btn.style.position = 'relative'; btn.appendChild(b) }
    b.textContent = n > 9 ? '9+' : String(n); b.style.display = n ? '' : 'none'
  }
  function montarTopo() {
    var sino = botaoTopo('Notificações'); if (!sino || el('btn-chat')) return
    var chat = document.createElement('button'); chat.className = 'icon-btn'; chat.id = 'btn-chat'; chat.title = 'Chat da equipe'; chat.innerHTML = ICO_CHAT
    sino.parentNode.insertBefore(chat, sino)
    sino.id = 'btn-notif'
    chat.onclick = function (e) { e.stopPropagation(); alternarChat() }
    sino.onclick = function (e) { e.stopPropagation(); alternarNotif() }
    var vid = botaoTopo('Vídeos'); if (vid) { vid.title = 'Tutoriais'; vid.onclick = function () { nav('tutoriais') } }
    var sup = botaoTopo('Suporte')
    if (sup) sup.onclick = function () { window.open('https://wa.me/5567999315131?text=' + encodeURIComponent('Olá! Preciso de ajuda com o Klinov (' + ((window.KLINOV_USER && KLINOV_USER.nome) || '') + ').'), '_blank') }
  }

  // ════════════════════════════════════════════════════════════════
  // CLINICHAT
  // ════════════════════════════════════════════════════════════════
  var CH = { aberto: false, com: null, ultimo: 0, timer: null }
  function painelChat() {
    var p = el('kc-chat')
    if (!p) { p = document.createElement('div'); p.id = 'kc-chat'; p.className = 'kc-painel'; document.body.appendChild(p) }
    return p
  }
  function alternarChat() { CH.aberto ? fecharChat() : abrirChat() }
  function fecharChat() { CH.aberto = false; CH.com = null; clearInterval(CH.timer); var p = el('kc-chat'); if (p) p.classList.remove('open') }
  async function abrirChat(usuarioId) {
    fecharNotif()
    CH.aberto = true; clearInterval(CH.timer)
    var p = painelChat(); p.classList.add('open')
    if (usuarioId) return conversa(usuarioId)
    CH.com = null
    p.innerHTML = '<div class="kc-h"><b>Chat da equipe</b><button class="ag-ico" id="kc-x" title="Fechar">✕</button></div><div class="kc-b" id="kc-lista"><div class="crc-sk" style="height:120px;margin:12px"></div></div>'
    el('kc-x').onclick = fecharChat
    var d = await apiData('chat-contatos', {}).catch(function () { return { data: [] } })
    var l = el('kc-lista'); if (!l) return
    l.innerHTML = d.data.length ? d.data.map(function (u) {
      return '<a class="kc-contato" data-u="' + u.id + '"><span class="kc-av">' + esc(String(u.nome || '?').split(' ').map(function (x) { return x[0] }).slice(0, 2).join('').toUpperCase()) + '</span><span class="kc-ct"><b>' + esc(u.nome) + '</b>' +
        '<small>' + (u.ultima ? (u.ultima.minha ? 'Você: ' : '') + esc(u.ultima.texto) : esc(u.perfil || '')) + '</small></span>' + (u.nao_lidas ? '<span class="kc-n">' + u.nao_lidas + '</span>' : (u.ultima ? '<small class="kc-q">' + quando(u.ultima.em) + '</small>' : '')) + '</a>'
    }).join('') : '<div class="pc-vazio" style="padding:24px">Nenhum outro usuário ativo na clínica. Cadastre a equipe em Usuários e Permissões.</div>'
    l.querySelectorAll('[data-u]').forEach(function (a) { a.onclick = function () { conversa(+this.getAttribute('data-u')) } })
  }
  async function conversa(uid) {
    var p = painelChat(); CH.com = uid; CH.ultimo = 0
    p.innerHTML = '<div class="kc-h"><button class="ag-ico" id="kc-v" title="Voltar">‹</button><b id="kc-nome">…</b><button class="ag-ico" id="kc-x" title="Fechar">✕</button></div><div class="kc-b kc-msgs" id="kc-msgs"></div>' +
      '<form class="kc-f" id="kc-f"><textarea class="ag-in" id="kc-t" rows="1" maxlength="2000" placeholder="Escreva uma mensagem"></textarea><button class="ag-btn-novo" type="submit">Enviar</button></form>'
    el('kc-x').onclick = fecharChat
    el('kc-v').onclick = function () { abrirChat() }
    el('kc-t').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el('kc-f').requestSubmit() } }
    el('kc-f').onsubmit = async function (e) {
      e.preventDefault(); var t = el('kc-t'), v = t.value.trim(); if (!v) return
      t.value = ''; var r = await apiPost('chat-mensagens', { para: uid, texto: v }).catch(function (er) { return { success: false, error: er.message } })
      if (!r.success) { t.value = v; return alert(r.error || 'Erro ao enviar') }
      novas()
    }
    await novas(true)
    el('kc-t').focus()
    clearInterval(CH.timer); CH.timer = setInterval(function () { if (!document.hidden) novas() }, 5000)
  }
  async function novas(primeira) {
    if (!CH.com) return
    var uid = CH.com
    var d = await apiData('chat-mensagens', { com: uid, depois: primeira ? '' : CH.ultimo }).catch(function () { return null })
    if (!d || CH.com !== uid) return
    if (el('kc-nome')) el('kc-nome').textContent = d.com.nome
    var box = el('kc-msgs'); if (!box) return
    if (primeira && !d.data.length) box.innerHTML = '<div class="pc-vazio" style="padding:24px">Nenhuma mensagem ainda.</div>'
    if (d.data.length) {
      if (primeira || box.querySelector('.pc-vazio')) box.innerHTML = ''
      d.data.forEach(function (m) { if (m.id <= CH.ultimo) return; var div = document.createElement('div'); div.className = 'kc-m' + (m.minha ? ' minha' : ''); div.innerHTML = esc(m.texto).replace(/\n/g, '<br>') + '<small>' + quando(m.em) + '</small>'; box.appendChild(div) })
      CH.ultimo = d.data[d.data.length - 1].id
      box.scrollTop = box.scrollHeight
    }
    contarChat()
  }
  async function contarChat() {
    if (!logado()) return
    var d = await apiData('chat-nao-lidas', {}).catch(function () { return null })
    if (d) badge(el('btn-chat'), d.nao_lidas)
  }

  // ════════════════════════════════════════════════════════════════
  // NOTIFICAÇÕES
  // ════════════════════════════════════════════════════════════════
  var NT = { aberto: false }
  function fecharNotif() { NT.aberto = false; var p = el('kc-notif'); if (p) p.classList.remove('open') }
  async function alternarNotif() {
    if (NT.aberto) return fecharNotif()
    fecharChat(); NT.aberto = true
    var p = el('kc-notif')
    if (!p) { p = document.createElement('div'); p.id = 'kc-notif'; p.className = 'kc-drop'; document.body.appendChild(p) }
    p.classList.add('open')
    p.innerHTML = '<div class="kc-h"><b>Notificações</b></div><div class="crc-sk" style="height:80px;margin:12px"></div>'
    var d = await apiData('notificacoes', {}).catch(function () { return { data: [] } })
    if (!NT.aberto) return
    p.innerHTML = '<div class="kc-h"><b>Notificações</b></div><div class="kc-b">' + (d.data.length ? d.data.map(function (n, i) {
      return '<a class="kc-nt' + (n.nova ? ' nova' : '') + '" data-i="' + i + '"><b>' + esc(n.titulo) + '</b><span>' + esc(n.texto) + (n.valor ? ' · ' + moeda(n.valor) : '') + '</span><small>' + quando(n.em) + '</small></a>'
    }).join('') : '<div class="pc-vazio" style="padding:24px">Nada novo por aqui.</div>') + '</div>'
    p.querySelectorAll('[data-i]').forEach(function (a) {
      a.onclick = function () {
        var n = d.data[+this.getAttribute('data-i')]; fecharNotif()
        if (n.abrir === 'chat') return abrirChat()
        if (/^paciente:/.test(n.abrir)) return abrirProntuario('', +n.abrir.split(':')[1])
        nav(n.abrir)
      }
    })
    if (d.novas) { apiPost('notificacoes', {}).catch(function () {}); badge(el('btn-notif'), 0) }
  }
  async function contarNotif() {
    if (!logado()) return
    var d = await apiData('notificacoes', {}).catch(function () { return null })
    if (d) badge(el('btn-notif'), d.novas)
  }
  document.addEventListener('click', function (e) {
    var n = el('kc-notif'); if (NT.aberto && n && !n.contains(e.target)) fecharNotif()
  })

  // ════════════════════════════════════════════════════════════════
  // MENU LATERAL: "Mais acessados" pelo uso real e busca de módulos
  // ════════════════════════════════════════════════════════════════
  var NOMES = {}
  function lerUso() { try { return JSON.parse(localStorage.getItem('klinov_uso_menu') || '{}') } catch (e) { return {} } }
  function montarMenu() {
    var mais = el('sb-mais'); if (!mais) return
    var itens = Array.prototype.slice.call(document.querySelectorAll('#sb-modulos .sidebar-item'))
    itens.forEach(function (it) { var m = /nav\('([^']+)'\)/.exec(it.getAttribute('onclick') || ''); if (m) NOMES[m[1]] = it.textContent.trim() })
    var uso = lerUso(), top = Object.keys(uso).filter(function (k) { return NOMES[k] }).sort(function (a, b) { return uso[b] - uso[a] }).slice(0, 5)
    if (top.length < 3) top = ['agenda', 'pacientes', 'financeiro', 'crc', 'relatorios'].filter(function (k) { return NOMES[k] })
    mais.innerHTML = top.map(function (k) { return '<div class="sidebar-item" onclick="nav(\'' + k + '\');toggleSidebar()">' + esc(NOMES[k]) + '</div>' }).join('')
    var busca = el('sb-busca')
    if (busca && !busca._ok) {
      busca._ok = true
      busca.oninput = function () {
        var t = this.value.trim().toLowerCase()
        itens.forEach(function (it) { it.style.display = !t || it.textContent.toLowerCase().indexOf(t) >= 0 ? '' : 'none' })
        el('sb-mais-bloco').style.display = t ? 'none' : ''
      }
    }
  }
  if (typeof window.nav === 'function') {
    var navOrig = window.nav
    window.nav = function (id) {
      if (NOMES[id]) { try { var u = lerUso(); u[id] = (u[id] || 0) + 1; localStorage.setItem('klinov_uso_menu', JSON.stringify(u)) } catch (e) {} }
      var r = navOrig.apply(this, arguments)
      if (NOMES[id]) montarMenu()
      return r
    }
  }

  // ════════════════════════════════════════════════════════════════
  // FILTROS: Profissionais e Usuários (busca + "só ativos")
  // ════════════════════════════════════════════════════════════════
  function barraFiltro(antesDe, id, aplicar) {
    if (!antesDe || el(id)) return
    var b = document.createElement('div'); b.id = id; b.className = 'kc-filtro'
    b.innerHTML = '<input class="ag-in" placeholder="Buscar por nome, e-mail ou especialidade"><label class="ag-chk"><input type="checkbox" checked> Mostrar só ativos</label>'
    antesDe.parentNode.insertBefore(b, antesDe)
    var inp = b.querySelector('input.ag-in'), chk = b.querySelector('input[type=checkbox]')
    function rodar() { aplicar(inp.value.trim().toLowerCase(), chk.checked) }
    inp.oninput = rodar; chk.onchange = rodar
    new MutationObserver(rodar).observe(antesDe, { childList: true, subtree: true })
    rodar()
  }
  function filtrosListas() {
    barraFiltro(el('prof-data'), 'kc-f-prof', function (t, ativos) {
      document.querySelectorAll('#prof-grid .prof-card').forEach(function (c) {
        var inativo = /opacity:\s*\.6/.test(c.getAttribute('style') || '')
        c.style.display = (!t || c.textContent.toLowerCase().indexOf(t) >= 0) && (!ativos || !inativo) ? '' : 'none'
      })
    })
    barraFiltro(el('usr-list'), 'kc-f-usr', function (t, ativos) {
      document.querySelectorAll('#usr-list tbody tr').forEach(function (r) {
        var inativo = /Inativo/.test(r.textContent)
        r.style.display = (!t || r.textContent.toLowerCase().indexOf(t) >= 0) && (!ativos || !inativo) ? '' : 'none'
      })
    })
  }

  // ════════════════════════════════════════════════════════════════
  // RECEITA SAÚDE — exportação em lote (CSV)
  // ════════════════════════════════════════════════════════════════
  var RS = { de: '', ate: '', status: 'nao', dados: null }
  function csvCampo(v) { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }
  async function receitaLote() {
    var alvo = el('receita-saude-list'); if (!alvo) return
    var box = el('rs-lote')
    if (!box) { box = document.createElement('div'); box.id = 'rs-lote'; alvo.parentNode.insertBefore(box, alvo) }
    if (!RS.de) { var h = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); RS.de = h.slice(0, 8) + '01'; RS.ate = h }
    box.innerHTML = '<div class="pc-box" style="margin-bottom:24px"><div class="pc-box-h">Exportação em lote</div><p class="ag-hint" style="margin-top:0">Recebimentos de pacientes do período, com CPF do paciente e do pagador (o responsável, quando houver). Marque e exporte o CSV para importar no Receita Saúde; os exportados ficam sinalizados.</p>' +
      '<div class="fn-filtros"><div class="ag-f"><label>De</label><input class="ag-in" type="date" id="rs-de" value="' + RS.de + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="rs-ate" value="' + RS.ate + '"></div>' +
      '<div class="ag-f"><label>Mostrar</label><select class="ag-in" id="rs-st"><option value="nao">Não exportados</option><option value="exportado">Exportados</option><option value="">Todos</option></select></div><div class="ag-f" style="flex:none;align-self:flex-end"><button class="ag-btn-novo" id="rs-listar">Listar</button></div></div><div id="rs-res"></div></div>'
    el('rs-st').value = RS.status
    el('rs-listar').onclick = function () { RS.de = el('rs-de').value; RS.ate = el('rs-ate').value; RS.status = el('rs-st').value; listarLote() }
    listarLote()
  }
  async function listarLote() {
    var res = el('rs-res'); if (!res) return
    res.innerHTML = '<div class="crc-sk" style="height:80px"></div>'
    var d = await apiData('receita-saude', { de: RS.de, ate: RS.ate, status: RS.status }).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    RS.dados = d
    if (!d.data.length) { res.innerHTML = '<div class="pc-vazio" style="padding:24px 0">Nenhum recebimento de paciente no período.</div>'; return }
    res.innerHTML = (d.clinica_documento ? '' : '<div class="ag-err">Cadastre o CNPJ ou CPF da clínica em Configurações › Dados da clínica antes de exportar.</div>') +
      '<div class="oc-scroll"><table class="pc-tbl"><thead><tr><th><input type="checkbox" id="rs-todos"></th><th>Data</th><th>Paciente</th><th class="hide-sm">CPF paciente</th><th class="hide-sm">CPF pagador</th><th class="hide-sm">Descrição</th><th style="text-align:right">Valor</th><th>Exportado</th></tr></thead><tbody>' +
      d.data.map(function (l, i) {
        return '<tr><td>' + (l.pendencia ? '' : '<input type="checkbox" data-i="' + i + '"' + (l.exportado_em ? '' : ' checked') + '>') + '</td><td>' + br(l.data) + '</td><td>' + esc(l.paciente) + (l.pendencia ? '<div class="ag-hint" style="margin:0;color:var(--red)">' + esc(l.pendencia) + '</div>' : '') + '</td>' +
          '<td class="hide-sm">' + esc(l.cpf_paciente || '—') + '</td><td class="hide-sm">' + esc(l.cpf_pagador || '—') + (l.pagador && l.cpf_pagador !== l.cpf_paciente ? '<div class="ag-hint" style="margin:0">' + esc(l.pagador) + '</div>' : '') + '</td><td class="hide-sm">' + esc(l.descricao) + '</td>' +
          '<td class="fn-num">' + moeda(l.valor) + '</td><td>' + (l.exportado_em ? '<span class="pc-badge ok">' + br(l.exportado_em) + '</span>' : '<span class="pc-badge off">Não</span>') + '</td></tr>'
      }).join('') + '</tbody></table></div><div class="fn-acoes" style="margin-top:12px"><span class="ag-hint" id="rs-sel" style="margin:0 auto 0 0"></span><button class="ag-btn-novo" id="rs-exp">Exportar CSV</button></div>'
    function sel() { return Array.prototype.map.call(res.querySelectorAll('[data-i]:checked'), function (c) { return d.data[+c.getAttribute('data-i')] }) }
    function contar() { var s = sel(); el('rs-sel').textContent = s.length + ' selecionado(s) · ' + moeda(s.reduce(function (t, l) { return t + l.valor }, 0)) }
    res.querySelectorAll('[data-i]').forEach(function (c) { c.onchange = contar })
    el('rs-todos').onchange = function () { var on = this.checked; res.querySelectorAll('[data-i]').forEach(function (c) { c.checked = on }); contar() }
    contar()
    el('rs-exp').onclick = async function () {
      var s = sel(); if (!s.length) return alert('Marque ao menos um recebimento.')
      if (!d.clinica_documento) return alert('Cadastre o CNPJ ou CPF da clínica antes de exportar.')
      var linhas = [['CPF/CNPJ do emitente', 'CPF do pagador', 'CPF do beneficiário', 'Data do pagamento', 'Valor', 'Descrição'].join(';')].concat(s.map(function (l) {
        return [d.clinica_documento, l.cpf_pagador, l.cpf_paciente || l.cpf_pagador, br(l.data), l.valor.toFixed(2).replace('.', ','), l.descricao].map(csvCampo).join(';')
      }))
      var blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = 'receita-saude-' + RS.de + '-a-' + RS.ate + '.csv'; document.body.appendChild(a); a.click(); a.remove()
      var r = await apiPost('receita-saude', { ids: s.map(function (l) { return l.id }) })
      if (!r.success) return alert(r.error || 'O arquivo foi gerado, mas não foi possível marcar como exportado.')
      listarLote()
    }
  }
  if (typeof window.loadReceitaSaude === 'function') {
    var rsOrig = window.loadReceitaSaude
    window.loadReceitaSaude = async function () { receitaLote(); return rsOrig.apply(this, arguments) }
  }

  // ════════════════════════════════════════════════════════════════
  // INÍCIO
  // ════════════════════════════════════════════════════════════════
  function iniciar() {
    montarTopo(); montarMenu(); filtrosListas()
    contarChat(); contarNotif()
    setInterval(function () { if (!document.hidden) contarChat() }, 30000)
    setInterval(function () { if (!document.hidden) contarNotif() }, 120000)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar)
  else iniciar()

  window.abrirChat = abrirChat
})()
