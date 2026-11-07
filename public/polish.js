// public/polish.js — micro-interações globais do Klinov
// 1) window.toast(msg, tipo): avisos não bloqueantes (vários módulos já chamam
//    toast() quando ela existe, com fallback para alert).
// 2) Paleta de comando (Ctrl+K): pular para qualquer módulo ou paciente.
// 3) Marca o item ativo da sidebar conforme a navegação.
;(function () {
  'use strict'

  // ── Toasts ──────────────────────────────────────────────────────
  function caixaToasts() {
    var c = document.getElementById('pl-toasts')
    if (!c) { c = document.createElement('div'); c.id = 'pl-toasts'; document.body.appendChild(c) }
    return c
  }
  window.toast = function (msg, tipo) {
    if (!msg) return
    var t = document.createElement('div')
    t.className = 'pl-toast' + (tipo === 'erro' ? ' erro' : tipo === 'aviso' ? ' aviso' : '')
    t.innerHTML = '<span class="pl-t-dot"></span><span></span>'
    t.lastChild.textContent = String(msg)
    caixaToasts().appendChild(t)
    setTimeout(function () { t.classList.add('saindo'); setTimeout(function () { t.remove() }, 220) }, 3800)
    t.onclick = function () { t.remove() }
  }

  // ── Sidebar: marca o módulo ativo ───────────────────────────────
  function marcarSidebar(id) {
    document.querySelectorAll('.sidebar-item').forEach(function (it) {
      var m = (it.getAttribute('onclick') || '').match(/nav\('([^']+)'\)/)
      it.classList.toggle('ativo', !!m && m[1] === id)
    })
  }
  if (typeof window.nav === 'function') {
    var navOriginal = window.nav
    window.nav = function (id) { marcarSidebar(id); return navOriginal.apply(this, arguments) }
  }

  // ── Paleta de comando (Ctrl+K) ──────────────────────────────────
  var P = { aberta: false, sel: 0, itens: [], timer: null, seq: 0 }

  function modulos() {
    var lista = []
    document.querySelectorAll('.sidebar-item, .sidebar-home').forEach(function (it) {
      var m = (it.getAttribute('onclick') || '').match(/nav\('([^']+)'\)/)
      if (m) lista.push({ tipo: 'modulo', id: m[1], nome: it.textContent.trim() })
    })
    var vistos = {}
    return lista.filter(function (x) { if (vistos[x.id]) return false; vistos[x.id] = 1; return true })
  }

  function montar() {
    if (document.getElementById('pl-cmd-ov')) return
    var ov = document.createElement('div')
    ov.id = 'pl-cmd-ov'
    ov.innerHTML = '<div id="pl-cmd">' +
      '<input id="pl-cmd-in" placeholder="Para onde? Módulo ou nome do paciente…" autocomplete="off">' +
      '<div id="pl-cmd-lista"></div>' +
      '<div id="pl-cmd-rodape"><span><span class="pl-kbd">↑</span> <span class="pl-kbd">↓</span> navegar</span>' +
      '<span><span class="pl-kbd">Enter</span> abrir</span><span><span class="pl-kbd">Esc</span> fechar</span></div></div>'
    document.body.appendChild(ov)
    ov.onmousedown = function (e) { if (e.target === ov) fechar() }
    var inp = document.getElementById('pl-cmd-in')
    inp.oninput = function () { buscar(inp.value) }
    inp.onkeydown = function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mover(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1) }
      else if (e.key === 'Enter') { e.preventDefault(); abrirSel() }
      else if (e.key === 'Escape') fechar()
    }
  }

  function abrir() {
    montar()
    P.aberta = true
    document.getElementById('pl-cmd-ov').classList.add('open')
    var inp = document.getElementById('pl-cmd-in')
    inp.value = ''
    buscar('')
    setTimeout(function () { inp.focus() }, 30)
  }
  function fechar() {
    P.aberta = false
    var ov = document.getElementById('pl-cmd-ov')
    if (ov) ov.classList.remove('open')
  }

  function desenhar() {
    var box = document.getElementById('pl-cmd-lista')
    if (!box) return
    if (!P.itens.length) { box.innerHTML = '<div class="pl-cmd-sec" style="padding:16px 12px">Nada encontrado</div>'; return }
    var html = '', secAtual = ''
    P.itens.forEach(function (it, i) {
      var sec = it.tipo === 'modulo' ? 'Módulos' : 'Pacientes'
      if (sec !== secAtual) { html += '<div class="pl-cmd-sec">' + sec + '</div>'; secAtual = sec }
      html += '<div class="pl-cmd-item' + (i === P.sel ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span>' + escHtml(it.nome) + '</span>' +
        (it.sub ? '<span class="pl-cmd-sub">' + escHtml(it.sub) + '</span>' : '') + '</div>'
    })
    box.innerHTML = html
    box.querySelectorAll('.pl-cmd-item').forEach(function (n) {
      n.onclick = function () { P.sel = +n.getAttribute('data-i'); abrirSel() }
      n.onmousemove = function () { var i = +n.getAttribute('data-i'); if (P.sel !== i) { P.sel = i; desenhar() } }
    })
    var sel = box.querySelector('.pl-cmd-item.sel')
    if (sel) sel.scrollIntoView({ block: 'nearest' })
  }

  function mover(d) {
    if (!P.itens.length) return
    P.sel = (P.sel + d + P.itens.length) % P.itens.length
    desenhar()
  }

  function abrirSel() {
    var it = P.itens[P.sel]
    if (!it) return
    fechar()
    if (it.tipo === 'modulo' && typeof nav === 'function') nav(it.id)
    if (it.tipo === 'paciente' && typeof abrirProntuario === 'function') abrirProntuario('', it.id)
  }

  function buscar(q) {
    q = String(q || '').trim()
    var ql = q.toLowerCase()
    var mods = modulos().filter(function (m) { return !ql || m.nome.toLowerCase().indexOf(ql) >= 0 })
    P.itens = mods.slice(0, ql ? 5 : 9)
    P.sel = 0
    desenhar()
    clearTimeout(P.timer)
    if (ql.length < 2 || typeof apiData !== 'function') return
    var seq = ++P.seq
    P.timer = setTimeout(function () {
      apiData('busca', { q: q }).then(function (d) {
        if (seq !== P.seq || !P.aberta) return
        var pacs = (d && (d.pacientes || d.data)) || []
        P.itens = P.itens.filter(function (x) { return x.tipo === 'modulo' }).concat(
          pacs.slice(0, 8).map(function (p) {
            return { tipo: 'paciente', id: p.id, nome: p.nome, sub: p.telefone || p.whatsapp || '' }
          }))
        if (P.sel >= P.itens.length) P.sel = 0
        desenhar()
      }).catch(function () {})
    }, 250)
  }

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      P.aberta ? fechar() : abrir()
    }
  })

  // Dica visual no campo de busca do topo
  function dicaAtalho() {
    var sb = document.querySelector('.search-bar')
    if (!sb || document.getElementById('pl-atalho-busca')) return
    var d = document.createElement('span')
    d.id = 'pl-atalho-busca'
    d.innerHTML = '<span class="pl-kbd">Ctrl</span><span class="pl-kbd">K</span>'
    sb.appendChild(d)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dicaAtalho)
  else dicaAtalho()
})()
