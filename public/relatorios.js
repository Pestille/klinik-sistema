// public/relatorios.js — Relatórios, metas e dashboard analítico (Fase 7)
// Klinov — Campo Grande, MS
//
// Substitui as telas antigas do app.html: Relatórios (#/relatorios[/id]),
// Metas (loadMetas) e Dashboard analítico (loadAnalytics). Os relatórios vêm
// prontos do servidor (relatorios-catalogo / relatorio) e a tela é genérica.
;(function () {
  'use strict'

  // Paleta categórica validada (azul, laranja, verde, vermelho) — sempre com legenda
  var COR = { azul: '#1565C0', laranja: '#E65100', verde: '#2E7D52', vermelho: '#C62828', cinza: '#BDBDBD' }
  var RL = { catalogo: null, atual: null, f: {}, dados: null, aberta: {} }

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function moeda(v) { var n = Number(v || 0); return (n < 0 ? '- ' : '') + 'R$ ' + Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function numero(v) { return Number(v || 0).toLocaleString('pt-BR') }
  function pctf(v) { return String(Math.round(Number(v || 0) * 10) / 10).replace('.', ',') + '%' }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function fmt(v, tipo) {
    if (v == null || v === '') return tipo === 'moeda' || tipo === 'num' ? '' : '—'
    if (tipo === 'moeda') return moeda(v)
    if (tipo === 'num') return numero(v)
    if (tipo === 'pct') return pctf(v)
    if (tipo === 'data') return br(v)
    return String(v)
  }
  function isAdmin() { return (KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }
  function faixas() {
    var h = new Date(), y = h.getFullYear(), m = h.getMonth()
    return [['mes', 'Este mês', ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))], ['mes_passado', 'Mês passado', ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))],
      ['3m', 'Últimos 3 meses', ymd(new Date(y, m - 2, 1)), ymd(new Date(y, m + 1, 0))], ['ano', 'Este ano', y + '-01-01', y + '-12-31'], ['ano_passado', 'Ano passado', (y - 1) + '-01-01', (y - 1) + '-12-31']]
  }

  // ════════════════════════════════════════════════════════════════
  // RELATÓRIOS
  // ════════════════════════════════════════════════════════════════
  async function abrirRelatorios(id) {
    var pg = el('p-relatorios'); if (!pg) return
    if (!RL.catalogo) {
      pg.innerHTML = '<div class="gpage-header"><div><div class="gpage-title">Relatórios</div></div></div><div class="gpage-body"><div class="fn-sk"></div></div>'
      var d = await apiData('relatorios-catalogo', {}).catch(function (e) { return { success: false, error: e.message } })
      if (!d.success) { pg.innerHTML = '<div class="gpage-body"><div class="ag-err">' + esc(d.error || 'Erro') + '</div></div>'; return }
      RL.catalogo = d
    }
    var cat = RL.catalogo
    if (!id) { var p = (location.hash || '').replace(/^#\/?/, '').split('/'); if (p[0] === 'relatorios' && p[1]) id = p[1] }
    var atual = cat.relatorios.filter(function (r) { return r.id === id })[0] || null
    RL.atual = atual
    if (atual) RL.aberta[atual.cat] = true
    pg.innerHTML = '<div class="rl-wrap"><aside class="rl-menu" id="rl-menu"><div class="rl-menu-h">Relatórios</div>' +
      cat.categorias.map(function (c) {
        var rs = cat.relatorios.filter(function (r) { return r.cat === c })
        if (!rs.length) return ''
        return '<div class="rl-cat' + (RL.aberta[c] ? ' aberta' : '') + '"><div class="rl-cat-h" data-cat="' + esc(c) + '">' + esc(c) + ' <span>' + rs.length + '</span></div><div class="rl-cat-b">' +
          rs.map(function (r) { return '<a class="rl-item' + (atual && atual.id === r.id ? ' on' : '') + '" data-rel="' + r.id + '">' + esc(r.nome) + '</a>' }).join('') + '</div></div>'
      }).join('') + '</aside><section class="rl-main" id="rl-main"></section></div>'
    pg.querySelectorAll('[data-cat]').forEach(function (h) { h.onclick = function () { var c = this.getAttribute('data-cat'); RL.aberta[c] = !RL.aberta[c]; this.parentNode.classList.toggle('aberta') } })
    pg.querySelectorAll('[data-rel]').forEach(function (a) { a.onclick = function () { var rid = this.getAttribute('data-rel'); if (typeof setRouteHash === 'function') setRouteHash('relatorios/' + rid); abrirRelatorios(rid) } })
    if (!atual) {
      el('rl-main').innerHTML = '<div class="gpage-title">Relatórios</div><div class="gpage-sub" style="margin-bottom:24px">Escolha um relatório no menu. Todos têm filtros, impressão e exportação para planilha.</div>' +
        '<div class="rl-grade">' + cat.categorias.map(function (c) { var rs = cat.relatorios.filter(function (r) { return r.cat === c }); return rs.length ? '<div class="pc-box"><div class="pc-box-h">' + esc(c) + '</div>' + rs.map(function (r) { return '<a class="rl-link" data-rel2="' + r.id + '">' + esc(r.nome) + '<small>' + esc(r.desc) + '</small></a>' }).join('') + '</div>' : '' }).join('') + '</div>'
      el('rl-main').querySelectorAll('[data-rel2]').forEach(function (a) { a.onclick = function () { var rid = this.getAttribute('data-rel2'); if (typeof setRouteHash === 'function') setRouteHash('relatorios/' + rid); abrirRelatorios(rid) } })
      return
    }
    desenharFiltros(atual)
  }

  async function desenharFiltros(r) {
    var F = RL.f[r.id] = RL.f[r.id] || { faixa: 'mes', de: faixas()[0][2], ate: faixas()[0][3], profissional_id: '', status: '', dias_min: 180 }
    var profs = []
    if (r.filtros.indexOf('profissional') >= 0) { try { profs = ((await apiData('profissionais')).data || []).filter(function (p) { return p.ativo !== 0 }) } catch (e) {} }
    var STATUS = {
      status_agenda: [['', 'Todas'], ['agendado', 'Agendado'], ['confirmado', 'Confirmado'], ['atendido', 'Atendido'], ['faltou', 'Faltou'], ['desmarcado', 'Desmarcado']],
      status_conta: [['', 'Todas'], ['aberta', 'Em aberto'], ['paga', 'Pagas']],
      status_orcamento: [['', 'Todas'], ['aberto', 'Em aberto'], ['aprovado', 'Aprovado'], ['reprovado', 'Reprovado'], ['desaprovado', 'Desaprovado']],
      status_parcela: [['', 'Todas'], ['vencido', 'Vencidas'], ['a_vencer', 'A vencer'], ['pago', 'Pagas']]
    }
    var stKey = r.filtros.filter(function (x) { return STATUS[x] })[0]
    el('rl-main').innerHTML = '<div class="fn-head"><div><div class="gpage-title">' + esc(r.nome) + '</div><div class="gpage-sub">' + esc(r.cat) + ' · ' + esc(r.desc) + '</div></div>' +
      '<div class="fn-acoes rl-acoes"><button class="btn" id="rl-print" disabled>Imprimir</button><button class="btn" id="rl-csv" disabled>Exportar</button></div></div>' +
      '<div class="fn-filtros">' +
        (r.filtros.indexOf('periodo') >= 0 ? '<div class="ag-f"><label>Período</label><select class="ag-in" id="rl-faixa">' + faixas().map(function (x) { return '<option value="' + x[0] + '"' + (F.faixa === x[0] ? ' selected' : '') + '>' + x[1] + '</option>' }).join('') + '<option value="custom"' + (F.faixa === 'custom' ? ' selected' : '') + '>Personalizado</option></select></div>' +
          '<div class="ag-f"><label>De</label><input class="ag-in" type="date" id="rl-de" value="' + F.de + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="rl-ate" value="' + F.ate + '"></div>' : '') +
        (r.filtros.indexOf('profissional') >= 0 ? '<div class="ag-f"><label>Profissional</label><select class="ag-in" id="rl-prof"><option value="">Todos</option>' + profs.map(function (p) { return '<option value="' + p.id + '"' + (String(F.profissional_id) === String(p.id) ? ' selected' : '') + '>' + esc(p.nome) + '</option>' }).join('') + '</select></div>' : '') +
        (stKey ? '<div class="ag-f"><label>Situação</label><select class="ag-in" id="rl-st">' + STATUS[stKey].map(function (x) { return '<option value="' + x[0] + '"' + (F.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>' }).join('') + '</select></div>' : '') +
        (r.filtros.indexOf('dias_min') >= 0 ? '<div class="ag-f"><label>Sem vir há pelo menos (dias)</label><input class="ag-in" type="number" min="0" id="rl-dias" value="' + F.dias_min + '"></div>' : '') +
        '<div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" id="rl-ok">Listar</button></div></div>' +
      '<div id="rl-res"><div class="pc-vazio" style="padding:40px 0">Ajuste os filtros e clique em Listar.</div></div>'
    if (el('rl-faixa')) el('rl-faixa').onchange = function () { var x = faixas().filter(function (k) { return k[0] === el('rl-faixa').value })[0]; if (x) { el('rl-de').value = x[2]; el('rl-ate').value = x[3] } }
    ;['rl-de', 'rl-ate'].forEach(function (i) { if (el(i)) el(i).onchange = function () { el('rl-faixa').value = 'custom' } })
    el('rl-ok').onclick = function () {
      if (el('rl-faixa')) { F.faixa = el('rl-faixa').value; F.de = el('rl-de').value; F.ate = el('rl-ate').value }
      if (el('rl-prof')) F.profissional_id = el('rl-prof').value
      if (el('rl-st')) F.status = el('rl-st').value
      if (el('rl-dias')) F.dias_min = el('rl-dias').value
      listar(r, F)
    }
    listar(r, F)
  }

  async function listar(r, F) {
    var res = el('rl-res'); if (!res) return
    res.innerHTML = '<div class="fn-sk"></div><div class="fn-sk" style="height:220px"></div>'
    var d = await apiData('relatorio', { id: r.id, de: F.de, ate: F.ate, profissional_id: F.profissional_id, status: F.status, dias_min: F.dias_min }).catch(function (e) { return { success: false, error: e.message } })
    if (RL.atual !== r || !el('rl-res')) return
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    RL.dados = d
    var cols = d.colunas || [], linhas = d.linhas || []
    var g = grafico(d)
    res.innerHTML = '<div class="rl-periodo">' + (r.filtros.indexOf('periodo') >= 0 ? 'Período: ' + br(d.de) + ' a ' + br(d.ate) + ' · ' : '') + numero(linhas.length) + ' linha(s)' + (d.cortado ? ' (mostrando as 5.000 primeiras)' : '') + '</div>' +
      (d.resumo && d.resumo.length ? '<div class="fn-kpis rl-kpis">' + d.resumo.map(function (k) { return '<div class="pc-box fn-kpi"><div class="pc-box-h" style="margin-bottom:8px">' + esc(k.rotulo) + '</div><div class="fn-kpi-v">' + fmt(k.valor, k.tipo) + '</div></div>' }).join('') + '</div>' : '') +
      g +
      (linhas.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl rl-tbl"><thead><tr>' + cols.map(function (c) { return '<th' + (/moeda|num|pct/.test(c.tipo) ? ' style="text-align:right"' : '') + '>' + esc(c.t) + '</th>' }).join('') + '</tr></thead><tbody>' +
        linhas.map(function (l) { return '<tr' + (l._destaque ? ' class="rl-dest"' : '') + '>' + cols.map(function (c) { return celula(l, c) }).join('') + '</tr>' }).join('') + '</tbody>' +
        (d.totais ? '<tfoot><tr>' + cols.map(function (c, i) { return i === 0 ? '<td><b>Total</b></td>' : '<td' + (/moeda|num|pct/.test(c.tipo) ? ' class="fn-num"' : '') + '><b>' + (d.totais[c.k] != null ? fmt(d.totais[c.k], c.tipo) : '') + '</b></td>' }).join('') + '</tr></tfoot>' : '') +
        '</table></div></div>' : '<div class="pc-vazio" style="padding:40px 0">Nada encontrado com esses filtros.</div>')
    res.querySelectorAll('[data-pac]').forEach(function (a) { a.onclick = function () { abrirProntuario('', +this.getAttribute('data-pac')) } })
    el('rl-csv').disabled = !linhas.length; el('rl-print').disabled = !linhas.length
    el('rl-csv').onclick = function () { exportar(r, d) }
    el('rl-print').onclick = function () { imprimir(r, d) }
  }
  function celula(l, c) {
    var v = l[c.k], num = /moeda|num|pct/.test(c.tipo)
    if (c.tipo === 'paciente') return '<td>' + (l.paciente_id ? '<a class="fn-pac" data-pac="' + l.paciente_id + '">' + esc(v || 'Paciente') + '</a>' : esc(v || '—')) + '</td>'
    return '<td' + (num ? ' class="fn-num' + (c.tipo === 'moeda' && Number(v) < 0 ? ' rl-neg' : '') + '"' : '') + '>' + esc(fmt(v, c.tipo)) + '</td>'
  }
  function grafico(d) {
    if (!d.grafico) return ''
    var dados = d.grafico.dados || (d.linhas || []).map(function (l) { return { rotulo: l[d.grafico.rotulo], valor: Number(l[d.grafico.valor]) || 0 } })
    dados = dados.filter(function (x) { return x.valor }).slice(0, 12)
    if (dados.length < 2) return ''
    var col = (d.colunas || []).filter(function (c) { return c.k === d.grafico.valor })[0], tipo = col ? col.tipo : 'num'
    var max = Math.max.apply(null, dados.map(function (x) { return Math.abs(x.valor) })) || 1
    return '<div class="pc-box rl-graf"><div class="pc-box-h">' + esc(col ? col.t : 'Total') + '</div>' + dados.map(function (x) {
      return '<div class="rl-bar"><span title="' + esc(x.rotulo) + '">' + esc(x.rotulo) + '</span><div class="rl-bar-t"><i style="width:' + Math.max(1, Math.round(Math.abs(x.valor) / max * 100)) + '%"' + (x.valor < 0 ? ' class="neg"' : '') + '></i></div><b>' + fmt(x.valor, tipo) + '</b></div>'
    }).join('') + '</div>'
  }
  function exportar(r, d) {
    var cols = d.colunas
    var linhas = [cols.map(function (c) { return c.t })].concat(d.linhas.map(function (l) { return cols.map(function (c) { var v = l[c.k]; return /moeda|num|pct/.test(c.tipo) && v !== '' && v != null ? String(v).replace('.', ',') : c.tipo === 'data' ? br(v) : (v == null ? '' : v) }) }))
    var csv = '﻿' + linhas.map(function (l) { return l.map(function (v) { v = String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }).join(';') }).join('\r\n')
    var a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = r.id + '-' + d.de + '-a-' + d.ate + '.csv'
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }
  function imprimir(r, d) {
    var w = window.open('', '_blank'); if (!w) return alert('Permita pop-ups para imprimir.')
    var cols = d.colunas
    w.document.write('<html><head><title>' + esc(r.nome) + '</title><style>@page{margin:1.2cm;size:landscape}body{font-family:Roboto,Arial,sans-serif;color:#212121;font-size:11px}h1{font-size:16px;margin:0 0 4px;color:#1B5E3B}.sub{color:#757575;margin-bottom:12px}' +
      '.k{display:inline-block;margin:0 16px 8px 0}.k b{display:block;font-size:14px}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;text-transform:uppercase;color:#757575;border-bottom:2px solid #E0E0E0;padding:4px}td{padding:4px;border-bottom:1px solid #EEE}.n{text-align:right;white-space:nowrap}tfoot td{border-top:2px solid #E0E0E0;font-weight:600}</style></head><body>' +
      '<h1>' + esc(r.nome) + '</h1><div class="sub">' + esc(r.cat) + ' · ' + (r.filtros.indexOf('periodo') >= 0 ? 'Período ' + br(d.de) + ' a ' + br(d.ate) + ' · ' : '') + 'emitido em ' + new Date().toLocaleString('pt-BR') + '</div>' +
      (d.resumo || []).map(function (k) { return '<span class="k">' + esc(k.rotulo) + '<b>' + fmt(k.valor, k.tipo) + '</b></span>' }).join('') +
      '<table><thead><tr>' + cols.map(function (c) { return '<th' + (/moeda|num|pct/.test(c.tipo) ? ' class="n"' : '') + '>' + esc(c.t) + '</th>' }).join('') + '</tr></thead><tbody>' +
      d.linhas.map(function (l) { return '<tr>' + cols.map(function (c) { return '<td' + (/moeda|num|pct/.test(c.tipo) ? ' class="n"' : '') + '>' + esc(fmt(l[c.k], c.tipo === 'paciente' ? 'texto' : c.tipo)) + '</td>' }).join('') + '</tr>' }).join('') + '</tbody>' +
      (d.totais ? '<tfoot><tr>' + cols.map(function (c, i) { return '<td' + (/moeda|num|pct/.test(c.tipo) ? ' class="n"' : '') + '>' + (i === 0 ? 'Total' : d.totais[c.k] != null ? fmt(d.totais[c.k], c.tipo) : '') + '</td>' }).join('') + '</tr></tfoot>' : '') + '</table></body></html>')
    w.document.close(); w.focus(); setTimeout(function () { w.print() }, 250)
  }

  // ════════════════════════════════════════════════════════════════
  // METAS
  // ════════════════════════════════════════════════════════════════
  var MT = { aba: 'ver', periodo: 'vigentes', tipo: '' }
  var SIT_META = { atingida: ['Atingida', 'ok'], ok: ['No ritmo', 'ok'], atencao: ['Abaixo do esperado', 'err'], estourou: ['Acima do limite', 'err'], nao_iniciada: ['Não iniciada', 'off'] }
  async function loadMetas() {
    var pg = el('p-metas'); if (!pg) return
    var podeEditar = pode('metas.editar')
    var ano = new Date().getFullYear()
    pg.innerHTML = '<div class="gpage-header"><div><div class="gpage-title">Metas</div><div class="gpage-sub">Metas da clínica e de cada profissional, com o ritmo esperado até hoje.</div></div>' +
      (podeEditar ? '<div class="flex"><button class="ag-btn-novo" id="mt-nova">+ Nova meta</button></div>' : '') + '</div>' +
      '<div class="gpage-body"><div class="ag-tabs" style="margin-bottom:16px"><div class="ag-tab' + (MT.aba === 'ver' ? ' on' : '') + '" data-aba="ver">Visualizar metas</div><div class="ag-tab' + (MT.aba === 'config' ? ' on' : '') + '" data-aba="config">Configuração de metas</div></div><div id="mt-c"></div></div>'
    pg.querySelectorAll('[data-aba]').forEach(function (t) { t.onclick = function () { MT.aba = this.getAttribute('data-aba'); loadMetas() } })
    if (el('mt-nova')) el('mt-nova').onclick = function () { editarMeta(null) }
    if (MT.aba === 'config') return metasConfig(podeEditar)
    var c = el('mt-c')
    c.innerHTML = '<div class="fn-filtros"><div class="ag-f"><label>Período</label><select class="ag-in" id="mt-per"><option value="vigentes">Vigentes hoje</option><option value="' + ano + '">Ano ' + ano + '</option><option value="' + (ano - 1) + '">Ano ' + (ano - 1) + '</option><option value="">Todas</option></select></div>' +
      '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="mt-tipo"><option value="">Todos</option></select></div><div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" id="mt-ok">Visualizar</button></div></div><div id="mt-res">' + '<div class="fn-sk"></div>' + '</div>'
    el('mt-per').value = MT.periodo
    var cfg = await apiData('metas-config', {}).catch(function () { return { tipos: [] } })
    el('mt-tipo').innerHTML = '<option value="">Todos</option>' + (cfg.tipos || []).map(function (t) { return '<option value="' + t.id + '"' + (MT.tipo === t.id ? ' selected' : '') + '>' + esc(t.nome) + '</option>' }).join('')
    el('mt-ok').onclick = function () { MT.periodo = el('mt-per').value; MT.tipo = el('mt-tipo').value; loadMetas() }
    var d = await apiData('metas-visualizar', { periodo: MT.periodo, tipo: MT.tipo }).catch(function (e) { return { success: false, error: e.message } })
    var res = el('mt-res'); if (!res) return
    if (!d.success) { res.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    if (!d.metas.length) { res.innerHTML = '<div class="pc-vazio" style="padding:40px 0">Nenhuma meta neste período.' + (podeEditar ? ' Use "+ Nova meta".' : '') + '</div>'; return }
    var grupos = { clinica: [], profissional: [] }
    d.metas.forEach(function (m) { grupos[m.analise === 'profissional' ? 'profissional' : 'clinica'].push(m) })
    res.innerHTML = ['clinica', 'profissional'].filter(function (k) { return grupos[k].length }).map(function (k) {
      return '<div class="pc-box-h" style="margin-top:8px">' + (k === 'clinica' ? 'Clínica' : 'Por profissional') + '</div><div class="mt-grade">' + grupos[k].map(cardMeta).join('') + '</div>'
    }).join('')
  }
  function valorMeta(m, v) { return m.moeda ? moeda(v) : numero(Math.round(v)) }
  function cardMeta(m) {
    var s = m.inversa && m.situacao === 'atencao' ? ['Acima do ritmo', 'err'] : m.inversa && m.situacao === 'ok' ? ['Dentro do limite', 'ok'] : (SIT_META[m.situacao] || SIT_META.ok), larg = Math.min(100, m.percentual), esp = m.valor ? Math.min(100, m.esperado / m.valor * 100) : 0
    var corBarra = m.inversa ? (m.situacao === 'ok' ? 'ok' : 'err') : (m.situacao === 'atencao' ? 'err' : 'ok')
    return '<div class="pc-box mt-card"><div class="mt-card-h"><div><b>' + esc(m.tipo_nome) + '</b><div class="ag-hint" style="margin:2px 0 0">' + (m.referencia_nome ? esc(m.referencia_nome) + ' · ' : '') + br(m.data_inicio) + ' a ' + br(m.data_fim) + '</div></div><span class="pc-badge ' + s[1] + '">' + (m.encerrada && m.situacao !== 'atingida' && !m.inversa ? 'Não atingida' : s[0]) + '</span></div>' +
      '<div class="mt-nums"><div><small>' + (m.inversa ? 'Ocorridas' : 'Alcançado') + '</small><b>' + valorMeta(m, m.alcancado) + '</b></div><div><small>' + (m.inversa ? 'Limite' : 'Meta') + '</small><b>' + valorMeta(m, m.valor) + '</b></div><div><small>' + (m.inversa ? 'do limite' : 'Atingido') + '</small><b>' + pctf(m.percentual) + '</b></div></div>' +
      '<div class="mt-barra" title="Marca = esperado até hoje (' + m.tempo + '% do período)"><i class="' + corBarra + '" style="width:' + larg + '%"></i><em style="left:' + esp + '%"></em></div>' +
      '<div class="ag-hint" style="margin:8px 0 0">' + (m.encerrada ? 'Período encerrado.' : m.situacao === 'nao_iniciada' ? 'Começa em ' + br(m.data_inicio) + '.' : 'Esperado até hoje: ' + valorMeta(m, m.esperado) + ' · projeção para o fim: ' + valorMeta(m, m.projecao) + '.') + '</div></div>'
  }
  async function metasConfig(podeEditar) {
    var d = await apiData('metas-config', {}).catch(function (e) { return { success: false, error: e.message } })
    var c = el('mt-c'); if (!c) return
    if (!d.success) { c.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    var tipos = {}; d.tipos.forEach(function (t) { tipos[t.id] = t })
    c.innerHTML = d.metas.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Tipo</th><th>Análise</th><th>De</th><th>Até</th><th style="text-align:right">Meta</th><th></th></tr></thead><tbody>' +
      d.metas.map(function (m) { var t = tipos[m.tipo] || { nome: m.tipo }; return '<tr><td>' + esc(t.nome) + '</td><td>' + (m.analise === 'profissional' ? esc(m.referencia_nome || 'Profissional') : 'Clínica') + '</td><td>' + br(m.data_inicio) + '</td><td>' + br(m.data_fim) + '</td><td class="fn-num">' + (t.moeda ? moeda(m.valor) : numero(m.valor)) + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' + (podeEditar ? '<button class="btn btn-sm" data-ed="' + m.id + '">Editar</button> <button class="btn btn-sm" data-rm="' + m.id + '" style="color:var(--red)">Excluir</button>' : '') + '</td></tr>' }).join('') + '</tbody></table></div></div>'
      : '<div class="pc-vazio" style="padding:40px 0">Nenhuma meta configurada.</div>'
    c.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { editarMeta(d.metas.filter(function (m) { return m.id === +b.getAttribute('data-ed') })[0], d.tipos) } })
    c.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = async function () { if (!confirm('Excluir esta meta? Ela vai para a Administração de Dados.')) return; var r = await apiPost('metas-config', { action: 'delete', id: +b.getAttribute('data-rm') }); if (!r.success) return alert(r.error); loadMetas() } })
  }
  async function editarMeta(m, tipos) {
    if (!tipos) tipos = (await apiData('metas-config', {})).tipos || []
    var profs = []
    try { profs = ((await apiData('profissionais')).data || []).filter(function (p) { return p.ativo !== 0 }) } catch (e) {}
    m = m || {}
    var h = new Date(), ini = m.data_inicio || ymd(new Date(h.getFullYear(), h.getMonth(), 1)), fim = m.data_fim || ymd(new Date(h.getFullYear(), h.getMonth() + 1, 0))
    var ov = el('mt-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'mt-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10010'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:560px"><div class="ag-modal-h"><h3>' + (m.id ? 'Editar meta' : 'Nova meta') + '</h3><button class="ag-ico" id="mm-x">✕</button></div><div class="ag-modal-b"><div id="mm-err"></div>' +
      '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="mm-tipo">' + tipos.map(function (t) { return '<option value="' + t.id + '"' + (m.tipo === t.id ? ' selected' : '') + '>' + esc(t.nome) + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Análise</label><select class="ag-in" id="mm-an"><option value="clinica">Clínica toda</option><option value="profissional"' + (m.analise === 'profissional' ? ' selected' : '') + '>Por profissional</option></select></div>' +
      '<div class="ag-f" id="mm-prof-box"><label>Profissional</label><select class="ag-in" id="mm-prof">' + profs.map(function (p) { return '<option value="' + p.id + '"' + (m.referencia_id === p.id ? ' selected' : '') + '>' + esc(p.nome) + '</option>' }).join('') + '</select></div></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>De</label><input class="ag-in" type="date" id="mm-de" value="' + ini + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="mm-ate" value="' + fim + '"></div>' +
      '<div class="ag-f"><label id="mm-vrot">Meta</label><input class="ag-in" id="mm-valor" inputmode="decimal" value="' + (m.valor != null ? String(m.valor).replace('.', ',') : '') + '"></div></div>' +
      '<p class="ag-hint" id="mm-hint"></p></div><div class="ag-modal-f"><button class="btn" id="mm-c">Cancelar</button><button class="ag-btn-novo" id="mm-ok">Salvar</button></div></div>'
    ov.classList.add('open')
    function fechar() { ov.classList.remove('open'); ov.innerHTML = '' }
    function ajustar() {
      var t = tipos.filter(function (x) { return x.id === el('mm-tipo').value })[0] || {}
      if (!t.prof) el('mm-an').value = 'clinica'
      el('mm-an').disabled = !t.prof
      el('mm-prof-box').style.visibility = el('mm-an').value === 'profissional' ? 'visible' : 'hidden'
      el('mm-vrot').textContent = t.inversa ? 'Limite máximo' : t.moeda ? 'Meta (R$)' : 'Meta (quantidade)'
      el('mm-hint').textContent = t.inversa ? 'Para faltas, o número é um teto: a meta vai bem enquanto as faltas ficam abaixo do esperado para a data.' : t.id === 'recebimentos' ? 'Recebimentos da clínica: todo o dinheiro que entrou. Por profissional: parcelas pagas dos tratamentos dele.' : t.id === 'producao' ? 'Valor dos procedimentos marcados como executados (particular + convênio).' : ''
    }
    el('mm-tipo').onchange = ajustar; el('mm-an').onchange = ajustar; ajustar()
    el('mm-x').onclick = fechar; el('mm-c').onclick = fechar
    ov.onmousedown = function (e) { if (e.target === ov) fechar() }
    el('mm-ok').onclick = async function () {
      var r = await apiPost('metas-config', { id: m.id, tipo: el('mm-tipo').value, analise: el('mm-an').value, referencia_id: el('mm-prof').value, data_inicio: el('mm-de').value, data_fim: el('mm-ate').value, valor: el('mm-valor').value })
      if (!r.success) { el('mm-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      fechar(); loadMetas()
    }
  }

  // ════════════════════════════════════════════════════════════════
  // DASHBOARD ANALÍTICO
  // ════════════════════════════════════════════════════════════════
  var DA = { mes: '', meses: 3, charts: [] }
  function limparCharts() { DA.charts.forEach(function (c) { try { c.destroy() } catch (e) {} }); DA.charts = [] }
  function chart(id, cfg) {
    var cv = el(id); if (!cv || typeof Chart === 'undefined') return
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } }, tooltip: { callbacks: {} } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { beginAtZero: true, grid: { color: '#F0F0F0' }, ticks: { font: { size: 11 }, precision: 0 } } } }, cfg.options || {})
    DA.charts.push(new Chart(cv, cfg))
  }
  function serie(rot, dados, cor, extra) { return Object.assign({ label: rot, data: dados, backgroundColor: cor, borderColor: cor, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 28, categoryPercentage: 0.7, barPercentage: 0.9 }, extra || {}) }
  function linha(rot, dados, cor) { return { type: 'line', label: rot, data: dados, borderColor: cor, backgroundColor: cor, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.2 } }
  function moedaTicks() { return { y: { beginAtZero: true, grid: { color: '#F0F0F0' }, ticks: { font: { size: 11 }, callback: function (v) { return Math.abs(v) >= 1000 ? 'R$ ' + String(Math.round(v / 100) / 10).replace('.', ',') + ' mil' : 'R$ ' + v } } }, x: { grid: { display: false }, ticks: { font: { size: 11 } } } } }
  function tipMoeda() { return { label: function (c) { return c.dataset.label + ': ' + moeda(c.parsed.y != null ? c.parsed.y : c.parsed) } } }

  async function loadAnalytics() {
    var pg = el('p-dashboard'); if (!pg) return
    if (!DA.mes) DA.mes = ymd(new Date()).slice(0, 7)
    pg.innerHTML = '<div class="gpage-header" style="padding:16px 24px"><div><div class="gpage-title">Dashboard analítico</div><div class="gpage-sub">Indicadores do mês de referência e dos anteriores, calculados com os dados do sistema.</div></div>' +
      '<div class="fn-acoes"><input class="ag-in" type="month" id="da-mes" value="' + DA.mes + '" style="width:auto"><select class="ag-in" id="da-n" style="width:auto">' + [[1, 'Só o mês'], [3, '3 meses'], [6, '6 meses'], [12, '12 meses']].map(function (x) { return '<option value="' + x[0] + '"' + (DA.meses === x[0] ? ' selected' : '') + '>' + x[1] + '</option>' }).join('') + '</select><button class="btn btn-primary" id="da-ok">Listar</button></div></div>' +
      '<div class="gpage-body" style="padding:0 24px 24px" id="da-body"><div class="fn-sk"></div><div class="fn-sk" style="height:300px"></div></div>'
    el('da-ok').onclick = function () { DA.mes = el('da-mes').value || DA.mes; DA.meses = +el('da-n').value; loadAnalytics() }
    var d = await apiData('analitico', { mes: DA.mes, meses: DA.meses }).catch(function (e) { return { success: false, error: e.message } })
    var b = el('da-body'); if (!b) return
    if (!d.success) { b.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    limparCharts()
    var L = d.meses.map(function (m) { return m.rotulo }), last = d.meses.length - 1, ip = d.inadimplencia_ref
    function card(id, titulo, sub, extra) { return '<div class="pc-box da-card"><div class="pc-box-h" style="margin-bottom:4px">' + titulo + '</div><div class="ag-hint" style="margin:0 0 8px">' + (sub || '') + '</div>' + (extra || '<div class="da-cv"><canvas id="' + id + '"></canvas></div>') + '</div>' }
    var orcRef = d.orcamentos[last]
    b.innerHTML = (d.oportunidade.qtd ? '<div class="da-insight"><div><b>Oportunidade parada:</b> ' + d.oportunidade.qtd + ' orçamento(s) em aberto nos últimos 30 dias, somando ' + moeda(d.oportunidade.valor) + '.</div><button class="btn btn-sm" id="da-crc">Ver no CRC</button></div>' : '') +
      '<div class="da-grade">' +
      card('da-fluxo', 'Fluxo de caixa', 'Entradas, saídas e resultado (regime de caixa)') +
      card('da-inad', 'Inadimplência do mês', 'Parcelas que vencem em ' + d.meses[last].rotulo + ': ' + moeda(ip.pago + ip.inadimplente + ip.a_vencer)) +
      card('da-prev', 'Previsto, recebido e inadimplente', 'Parcelas de tratamento por mês de vencimento') +
      card('da-desm', 'Desmarcações', 'Taxa no mês: ' + pctf(d.agenda[last].taxa_desm)) +
      card('da-faltas', 'Faltas', 'Taxa no mês: ' + pctf(d.agenda[last].taxa_falta)) +
      card('da-prim', 'Primeiras consultas e faltas na 1ª', 'Taxa de falta na 1ª no mês: ' + pctf(d.agenda[last].taxa_falta_primeira)) +
      card('da-cat', 'Categorias mais agendadas', 'No período', d.categorias.length ? barrasHtml(d.categorias.map(function (x) { return [x.nome, x.total] }), numero) : '<div class="pc-vazio">Sem agendamentos.</div>') +
      card('da-ocup', 'Ocupação da agenda', 'Horas agendadas ÷ horas de atendimento cadastradas', d.ocupacao ? null : '<div class="pc-vazio" style="padding:24px 0">Cadastre os horários de atendimento (Configurações › Agenda) para medir a ocupação.</div>') +
      card('da-esp', 'Vendas por especialidade', 'Tratamentos aprovados no período', d.especialidades.length ? barrasHtml(d.especialidades.map(function (x) { return [x.nome, x.valor] }), moeda) : '<div class="pc-vazio">Sem vendas no período.</div>') +
      '</div>' +
      '<div class="pc-box-h" style="margin-top:24px">Orçamentos e conversão</div><div class="da-orc">' + d.orcamentos.map(function (o, i) {
        return '<div class="pc-box"><div class="pc-box-h" style="margin-bottom:8px">' + d.meses[i].rotulo + '</div>' + [['Aprovados', o.aprovados, o.valor_aprovado], ['Em aberto', o.abertos, o.valor_aberto], ['Reprovados', o.reprovados, o.valor_reprovado], ['Total', o.total, o.valor_total]].map(function (x) { return '<div class="fn-lin"><span>' + x[0] + ' (' + x[1] + ')</span><b>' + moeda(x[2]) + '</b></div>' }).join('') +
          '<div class="fn-sep"></div><div class="fn-lin"><span>Conversão</span><b>' + pctf(o.conversao) + '</b></div><div class="fn-lin"><span>Ticket médio</span><b>' + moeda(o.ticket) + '</b></div><div class="fn-lin"><span>Parcelamento médio</span><b>' + (o.parcelas_media ? String(o.parcelas_media).replace('.', ',') + 'x' : '—') + '</b></div></div>'
      }).join('') + '</div>' +
      '<div class="pc-box-h" style="margin-top:24px">Metas da clínica em ' + d.meses[last].rotulo + '</div>' +
      (d.metas.length ? '<div class="mt-grade">' + d.metas.map(cardMeta).join('') + '</div>' : '<div class="pc-vazio">Nenhuma meta da clínica cobre este mês. <a class="fn-pac" id="da-metas">Configurar metas</a></div>')
    if (el('da-crc')) el('da-crc').onclick = function () { if (window.abrirFilaCrc) { nav('crc'); abrirFilaCrc('orcamentos_abertos') } }
    if (el('da-metas')) el('da-metas').onclick = function () { nav('metas') }

    chart('da-fluxo', { type: 'bar', data: { labels: L, datasets: [serie('Entradas', d.fluxo.map(function (x) { return x.entradas }), COR.verde), serie('Saídas', d.fluxo.map(function (x) { return x.saidas }), COR.vermelho), linha('Resultado', d.fluxo.map(function (x) { return x.resultado }), COR.azul)] }, options: { scales: moedaTicks(), plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: tipMoeda() } } } })
    chart('da-inad', { type: 'doughnut', data: { labels: ['Pago', 'Inadimplente', 'A vencer'], datasets: [{ data: [ip.pago, ip.inadimplente, ip.a_vencer], backgroundColor: [COR.verde, COR.vermelho, COR.azul], borderColor: '#fff', borderWidth: 2 }] },
      options: { scales: {}, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, generateLabels: function (ch) { var ds = ch.data.datasets[0], tot = ds.data.reduce(function (s, v) { return s + v }, 0) || 1; return ch.data.labels.map(function (l, i) { return { text: l + ' ' + moeda(ds.data[i]) + ' (' + Math.round(ds.data[i] / tot * 100) + '%)', fillStyle: ds.backgroundColor[i], strokeStyle: ds.backgroundColor[i], index: i } }) } } }, tooltip: { callbacks: { label: function (c) { return c.label + ': ' + moeda(c.parsed) } } } } } })
    chart('da-prev', { type: 'bar', data: { labels: L, datasets: [serie('Previsto', d.parcelas.map(function (x) { return x.previsto }), COR.azul), serie('Recebido', d.parcelas.map(function (x) { return x.pago }), COR.verde), serie('Inadimplente', d.parcelas.map(function (x) { return x.inadimplente }), COR.vermelho)] }, options: { scales: moedaTicks(), plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: tipMoeda() } } } })
    chart('da-desm', { type: 'bar', data: { labels: L, datasets: [serie('Agendamentos', d.agenda.map(function (x) { return x.total + x.desmarcados }), COR.azul), serie('Desmarcados', d.agenda.map(function (x) { return x.desmarcados }), COR.laranja)] } })
    chart('da-faltas', { type: 'bar', data: { labels: L, datasets: [serie('Agendamentos', d.agenda.map(function (x) { return x.total }), COR.azul), serie('Faltas', d.agenda.map(function (x) { return x.faltas }), COR.vermelho)] } })
    chart('da-prim', { type: 'bar', data: { labels: L, datasets: [serie('Primeiras consultas', d.agenda.map(function (x) { return x.primeiras }), COR.azul), serie('Faltas na 1ª', d.agenda.map(function (x) { return x.faltas_primeiras }), COR.vermelho)] } })
    if (d.ocupacao) chart('da-ocup', { type: 'bar', data: { labels: L, datasets: [serie('Ocupação', d.ocupacao.map(function (x) { return x.taxa }), COR.azul)] }, options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var o = d.ocupacao[c.dataIndex]; return pctf(o.taxa) + ' · ' + o.agendado_h + 'h de ' + o.disponivel_h + 'h' } } } }, scales: { y: { beginAtZero: true, suggestedMax: 100, grid: { color: '#F0F0F0' }, ticks: { callback: function (v) { return v + '%' }, font: { size: 11 } } }, x: { grid: { display: false } } } } })
  }
  function barrasHtml(lista, f) {
    var max = Math.max.apply(null, lista.map(function (x) { return x[1] })) || 1
    return lista.map(function (x) { return '<div class="rl-bar"><span title="' + esc(x[0]) + '">' + esc(x[0]) + '</span><div class="rl-bar-t"><i style="width:' + Math.max(1, Math.round(x[1] / max * 100)) + '%"></i></div><b>' + f(x[1]) + '</b></div>' }).join('')
  }

  window.loadRelatoriosNovo = abrirRelatorios
  window.renderRelatorios = function () {} // tela antiga (chamada pelo loadDashboard) foi substituída
  window.loadMetas = loadMetas
  window.loadAnalytics = loadAnalytics
})()
