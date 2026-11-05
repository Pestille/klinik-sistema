// public/assinaturas.js — Portal de Assinatura: pedidos pendentes e assinados da clínica
// Klinov — Campo Grande, MS
//
// Substitui a tela "em desenvolvimento" de #p-portal. Pedir, reenviar e cancelar
// continuam em lote2.js (abrirAssinatura).
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function br(d) { if (!d) return '—'; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }

  var F = { aba: 'pendente', de: '', ate: '' }

  function aba(id, rotulo) {
    return '<div class="fin-htab' + (F.aba === id ? ' active' : '') + '" data-aba="' + id + '">' + rotulo + '</div>'
  }

  function selo(status) {
    if (status === 'expirado') return '<span class="badge" style="border-radius:4px;background:var(--border);color:var(--text3)">Expirado</span>'
    if (status === 'assinado') return '<span class="badge" style="border-radius:4px;background:var(--green-light);color:var(--green)">Assinado</span>'
    return '<span class="badge" style="border-radius:4px;background:var(--orange-light);color:var(--orange)">Pendente</span>'
  }

  async function carregar() {
    var res = el('pa-res'); if (!res) return
    res.innerHTML = '<div style="padding:24px;color:var(--text3)">Carregando...</div>'
    var d = await apiData('assinaturas-portal', { status: F.aba, de: F.de, ate: F.ate }).catch(function (e) { return { success: false, error: e.message } })
    if (!el('pa-res')) return
    if (!d.success) { res.innerHTML = '<div style="padding:24px;color:var(--red)">' + esc(d.error || 'Não foi possível carregar.') + '</div>'; return }
    var assinados = F.aba === 'assinado'
    if (!d.data.length) { res.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text3)">' + (assinados ? 'Nenhum documento assinado neste período.' : 'Nenhum documento pendente.') + '</div>'; return }
    res.innerHTML = '<table class="tbl"><thead><tr><th>Paciente</th><th>Documento</th><th>Tipo</th><th>Pedido em</th><th>' + (assinados ? 'Assinado em' : 'Válido até') + '</th><th>Situação</th><th></th></tr></thead><tbody>' +
      d.data.map(function (a, i) {
        return '<tr><td class="pname">' + esc(a.paciente_nome || '—') + '</td><td>' + esc(a.titulo || '—') + '</td><td>' + esc(a.tipo_rotulo) + '</td>' +
          '<td>' + br(a.criado_em) + (a.criado_por ? '<div style="font-size:12px;color:var(--text3)">' + esc(a.criado_por) + '</div>' : '') + '</td>' +
          '<td>' + br(assinados ? a.assinado_em : a.expira_em) + '</td><td>' + selo(a.status) + '</td>' +
          '<td style="text-align:right"><button class="btn" data-i="' + i + '">' + (assinados ? 'Ver' : 'Abrir') + '</button></td></tr>'
      }).join('') + '</tbody></table>'
    res.querySelectorAll('[data-i]').forEach(function (b) {
      b.onclick = function () {
        var a = d.data[+b.getAttribute('data-i')]
        window.abrirAssinatura(a.tipo, a.ref_id, carregar)
      }
    })
  }

  function desenhar() {
    var pg = el('p-portal'); if (!pg) return
    var corpo = pg.querySelector('.gpage-body'); if (!corpo) return
    corpo.style.maxWidth = '1100px'
    corpo.innerHTML =
      '<div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">' + aba('pendente', 'Documentos pendentes') + aba('assinado', 'Documentos assinados') + '</div>' +
      '<div class="fn-filtros"><div class="ag-f"><label for="pa-de">De</label><input class="ag-in" type="date" id="pa-de" value="' + esc(F.de) + '"></div>' +
      '<div class="ag-f"><label for="pa-ate">Até</label><input class="ag-in" type="date" id="pa-ate" value="' + esc(F.ate) + '"></div>' +
      '<button class="ag-btn-novo" id="pa-ok">Listar</button><button class="btn" id="pa-todos">Listar todos</button></div>' +
      '<div class="card" style="padding:0;margin-top:16px" id="pa-res"></div>'
    corpo.querySelectorAll('[data-aba]').forEach(function (t) { t.onclick = function () { F.aba = t.getAttribute('data-aba'); desenhar() } })
    el('pa-ok').onclick = function () { F.de = el('pa-de').value; F.ate = el('pa-ate').value; carregar() }
    el('pa-todos').onclick = function () { F.de = ''; F.ate = ''; el('pa-de').value = ''; el('pa-ate').value = ''; carregar() }
    carregar()
  }

  if (typeof window.nav === 'function') {
    var navAnt = window.nav
    window.nav = function (id) {
      var r = navAnt.apply(this, arguments)
      if (id === 'portal') desenhar()
      return r
    }
  }
})()
