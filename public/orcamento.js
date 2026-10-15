// public/orcamento.js — Orçamentos e tabelas de preço (Fase 4)
// Klinov — Campo Grande, MS
//
// Lista de orçamentos do prontuário, impressão/envio, duplicar, seletor de
// dentes e faces, painel de procedimentos no odontograma e a tela de tabelas
// de preço (Configurações). O editor e o fluxo de aprovação/parcelas continuam
// em app.html (abrirOrcamentoModal, aprovarOrcamento, abrirConfigParcelas…).
;(function () {
  'use strict'

  var TIPO_TAB = { particular: 'Particular', convenio: 'Convênio', proprio: 'Plano próprio' }
  var FACES = [['M', 'Mesial'], ['D', 'Distal'], ['O', 'Oclusal/Incisal'], ['V', 'Vestibular'], ['L', 'Lingual/Palatina']]
  var PERM_SUP = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], PERM_INF = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]
  var DEC_SUP = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65], DEC_INF = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75]
  var REGIOES = ['Arcada superior', 'Arcada inferior', 'Arcadas', 'Hemiarcada sup. dir.', 'Hemiarcada sup. esq.', 'Hemiarcada inf. dir.', 'Hemiarcada inf. esq.', 'Boca toda']

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function hojeYmd() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function num(v) { var n = typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? n : 0 }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('oc-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'oc-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10010'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 760) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="oc-m-x">✕</button></div>' +
      '<div class="ag-modal-b" id="oc-m-b">' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('oc-m-x').onclick = fecharModal
    ov.onmousedown = function (e) { if (e.target === ov) fecharModal() }
  }
  function fecharModal() { var ov = el('oc-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  function erro(id, msg) { var b = el(id); if (b) b.innerHTML = msg ? '<div class="ag-err">' + esc(msg) + '</div>' : '' }

  // ── Tabelas de preço em memória (usadas pelo editor do app.html) ─
  async function carregarTabelasPreco(forcar) {
    if (ST.tabelasPreco && !forcar) return ST.tabelasPreco
    try { var d = await apiData('precos-tabelas', {}); ST.tabelasPreco = d.data || [] } catch (e) { ST.tabelasPreco = ST.tabelasPreco || [] }
    return ST.tabelasPreco
  }
  function tipoTabela(nome) {
    var t = (ST.tabelasPreco || []).filter(function (x) { return String(x.nome).toUpperCase() === String(nome || '').toUpperCase() })[0]
    return t ? t.tipo : 'particular'
  }

  // ════════════════════════════════════════════════════════════════
  // SELETOR DE DENTES E FACES
  // ════════════════════════════════════════════════════════════════
  // aoConfirmar({dente:'11, 21', faces:'MO', regiao:''})
  function abrirSeletorDentes(atual, aoConfirmar) {
    var sel = {}, faces = {}, regiao = (atual && atual.regiao) || '', decidua = false
    String((atual && atual.dente) || '').split(/[,\s]+/).forEach(function (d) { if (/^\d{2}$/.test(d)) sel[d] = 1 })
    String((atual && atual.faces) || '').split('').forEach(function (f) { faces[f] = 1 })
    function linha(ds) { return '<div class="oc-dentes">' + ds.map(function (d) { return '<span class="oc-dente' + (sel[d] ? ' on' : '') + '" data-d="' + d + '">' + d + '</span>' }).join('') + '</div>' }
    function corpo() {
      return '<div class="ag-tabs"><div class="ag-tab' + (decidua ? '' : ' on') + '" data-arc="p">Permanente</div><div class="ag-tab' + (decidua ? ' on' : '') + '" data-arc="d">Decídua</div></div>' +
        (decidua ? linha(DEC_SUP) + linha(DEC_INF) : linha(PERM_SUP) + linha(PERM_INF)) +
        '<div class="ag-f" style="margin-top:12px"><label>Faces</label><div class="ag-chips">' + FACES.map(function (f) { return '<span class="ag-chip' + (faces[f[0]] ? ' on' : '') + '" data-f="' + f[0] + '" title="' + f[1] + '">' + f[0] + ' · ' + f[1] + '</span>' }).join('') + '</div></div>' +
        '<div class="ag-f"><label>Ou região</label><div class="ag-chips">' + REGIOES.map(function (r) { return '<span class="ag-chip' + (regiao === r ? ' on' : '') + '" data-r="' + r + '">' + r + '</span>' }).join('') + '</div></div>'
    }
    function ligar() {
      var b = el('oc-m-b')
      b.querySelectorAll('[data-arc]').forEach(function (t) { t.onclick = function () { decidua = this.getAttribute('data-arc') === 'd'; b.innerHTML = corpo(); ligar() } })
      b.querySelectorAll('[data-d]').forEach(function (t) { t.onclick = function () { var d = this.getAttribute('data-d'); if (sel[d]) delete sel[d]; else { sel[d] = 1; regiao = '' } b.innerHTML = corpo(); ligar() } })
      b.querySelectorAll('[data-f]').forEach(function (t) { t.onclick = function () { var f = this.getAttribute('data-f'); if (faces[f]) delete faces[f]; else faces[f] = 1; this.classList.toggle('on') } })
      b.querySelectorAll('[data-r]').forEach(function (t) { t.onclick = function () { var r = this.getAttribute('data-r'); regiao = regiao === r ? '' : r; if (regiao) { sel = {}; faces = {} } b.innerHTML = corpo(); ligar() } })
    }
    modal('Dentes e faces', corpo(), '<button class="btn" id="oc-d-limpar">Limpar</button><button class="ag-btn-novo" id="oc-d-ok">Aplicar</button>', 720)
    ligar()
    el('oc-d-limpar').onclick = function () { sel = {}; faces = {}; regiao = ''; el('oc-m-b').innerHTML = corpo(); ligar() }
    el('oc-d-ok').onclick = function () {
      var ds = Object.keys(sel).sort(function (a, b) { return +a - +b })
      var fs = FACES.map(function (f) { return f[0] }).filter(function (f) { return faces[f] }).join('')
      fecharModal()
      aoConfirmar({ dente: ds.join(', '), faces: ds.length ? fs : '', regiao: ds.length ? '' : regiao })
    }
  }

  // ════════════════════════════════════════════════════════════════
  // LISTA DE ORÇAMENTOS (aba do prontuário)
  // ════════════════════════════════════════════════════════════════
  var STATUS_ORC = { aberto: ['Em aberto', 'pend'], aprovado: ['Aprovado', 'ok'], reprovado: ['Reprovado', 'off'], desaprovado: ['Desaprovado', 'off'] }
  var abertos = {}

  window.PRONT_TABS = window.PRONT_TABS || {}
  window.PRONT_TABS.orcamentos = function (box, p) {
    var orcs = (_prontData.orcamentos || []).slice()
    var hoje = hojeYmd()
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">' +
      '<div class="pc-box-h" style="margin:0">Orçamentos (' + orcs.length + ')</div><button class="ag-btn-novo" id="oc-novo">+ Novo orçamento</button></div>' +
      (orcs.length ? orcs.map(function (o) {
        var st = STATUS_ORC[o.status] || STATUS_ORC.aberto, itens = o.itens || []
        var totPlano = itens.reduce(function (s, i) { return s + num(i.valor_plano) * (i.quantidade || 1) }, 0)
        var vencido = o.validade && o.validade < hoje && (o.status === 'aberto' || !o.status)
        var exec = itens.filter(function (i) { return i.executado }).length
        return '<div class="pc-box" style="margin-bottom:10px;padding:0">' +
          '<div class="oc-orc-h" data-tg="' + o.id + '"><span class="pc-badge ' + st[1] + '">' + st[0] + '</span>' +
            '<div style="flex:1;min-width:0"><b style="color:var(--text);font-weight:500">' + esc(o.titulo || ('Orçamento #' + o.id)) + '</b>' +
              '<div class="ag-hint" style="margin:2px 0 0">' + br(o.data_criacao) + ' · ' + esc(o.tabela_preco || '') + (o.profissional_nome ? ' · ' + esc(o.profissional_nome) : '') +
              (o.validade ? ' · <span style="color:' + (vencido ? 'var(--red)' : 'inherit') + '">válido até ' + br(o.validade) + (vencido ? ' (vencido)' : '') + '</span>' : '') +
              (o.status === 'aprovado' && itens.length ? ' · ' + exec + '/' + itens.length + ' executado(s)' : '') + '</div></div>' +
            '<div style="text-align:right"><b style="color:var(--green);font-size:15px">' + moeda(o.valor_total - (o.desconto || 0)) + '</b>' + (totPlano ? '<div class="ag-hint" style="margin:0">Plano ' + moeda(totPlano) + '</div>' : '') + '</div></div>' +
          (abertos[o.id] ? '<div style="padding:0 16px 14px;border-top:1px solid var(--border2)">' +
            '<div class="oc-scroll"><table class="pc-tbl" style="margin-top:8px"><thead><tr><th>Procedimento</th><th>Dente / região</th><th class="hide-sm">Profissional</th><th style="text-align:right">Particular</th><th style="text-align:right">Plano</th></tr></thead><tbody>' +
            itens.map(function (i) {
              return '<tr><td>' + esc(i.procedimento_nome) + (i.executado ? ' <span class="pc-badge ok">Executado</span>' : '') + '</td><td>' + esc([i.dente, i.faces ? '(' + i.faces + ')' : '', i.regiao].filter(Boolean).join(' ') || '—') + '</td>' +
                '<td class="hide-sm">' + esc(i.profissional_nome || '—') + '</td><td style="text-align:right">' + (num(i.valor_unitario) || !num(i.valor_plano) ? moeda(num(i.valor_unitario) * (i.quantidade || 1)) : '—') + '</td><td style="text-align:right">' + (num(i.valor_plano) ? moeda(num(i.valor_plano) * (i.quantidade || 1)) : '—') + '</td></tr>'
            }).join('') + '</tbody></table></div>' +
            (o.observacoes ? '<div class="ag-hint">' + esc(o.observacoes) + '</div>' : '') +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-sm" data-ac="editar" data-id="' + o.id + '">' + (o.status === 'aprovado' ? 'Abrir' : 'Editar') + '</button>' +
              '<button class="btn btn-sm" data-ac="imprimir" data-id="' + o.id + '">Imprimir</button><button class="btn btn-sm" data-ac="whatsapp" data-id="' + o.id + '">Enviar por WhatsApp</button>' +
              '<button class="btn btn-sm" data-ac="duplicar" data-id="' + o.id + '">Duplicar</button>' +
              (itens.length ? '<button class="btn btn-sm" data-ac="contrato" data-id="' + o.id + '">Gerar contrato</button>' : '') +
              (o.status !== 'aprovado' ? '<button class="btn btn-sm" data-ac="excluir" data-id="' + o.id + '" style="color:var(--red)">Excluir</button>' : '') + '</div></div>' : '') +
          '</div>'
      }).join('') : '<div class="pc-vazio">Nenhum orçamento. Use "+ Novo orçamento".</div>')
    el('oc-novo').onclick = function () { abrirOrcamentoModal(null) }
    box.querySelectorAll('[data-tg]').forEach(function (h) { h.onclick = function () { var id = +this.getAttribute('data-tg'); abertos[id] = !abertos[id]; window.PRONT_TABS.orcamentos(box, p) } })
    box.querySelectorAll('[data-ac]').forEach(function (b) {
      b.onclick = async function (e) {
        e.stopPropagation()
        var id = +this.getAttribute('data-id'), ac = this.getAttribute('data-ac')
        if (ac === 'editar') return abrirOrcamentoModal(id)
        if (ac === 'imprimir') return imprimirOrcamento(id)
        if (ac === 'whatsapp') return enviarOrcamentoWhatsApp(id)
        if (ac === 'duplicar') return duplicarOrcamento(id)
        if (ac === 'contrato') return window.gerarContratoOrcamento && gerarContratoOrcamento(id)
        if (ac === 'excluir') return excluirOrcamento(id)
      }
    })
  }

  async function duplicarOrcamento(id) {
    if (!confirm('Criar uma cópia deste orçamento (em aberto, com a data de hoje)?')) return
    var r = await apiPost('orcamento-duplicar', { id: id })
    if (!r.success) return alert(r.error || 'Erro ao duplicar')
    if (typeof fecharOrcModal === 'function' && el('orc-modal')) fecharOrcModal()
    abertos[r.id] = true
    await reloadOrcamentos()
  }

  function linhasDocumento(d) {
    var tot = d.itens.reduce(function (s, i) { return s + num(i.valor_unitario) * (i.quantidade || 1) }, 0)
    var plano = d.itens.reduce(function (s, i) { return s + num(i.valor_plano) * (i.quantidade || 1) }, 0)
    return { tot: tot, plano: plano, desconto: num(d.orcamento.desconto), liquido: tot - num(d.orcamento.desconto) }
  }

  async function imprimirOrcamento(id) {
    var d = await apiData('orcamento-documento', { id: id })
    if (!d.success) return alert(d.error || 'Erro')
    var o = d.orcamento, c = d.clinica, t = linhasDocumento(d)
    var w = window.open('', '_blank'); if (!w) return alert('Permita pop-ups para imprimir.')
    w.document.write('<html><head><title>Orçamento ' + esc(d.paciente.nome) + '</title><style>@page{margin:1.6cm}body{font-family:Roboto,Arial,sans-serif;color:#212121;font-size:13px}' +
      '.cab{display:flex;justify-content:space-between;border-bottom:2px solid #1B5E3B;padding-bottom:8px;margin-bottom:16px}.cab b{font-size:16px;color:#1B5E3B}small{color:#757575}' +
      'table{width:100%;border-collapse:collapse;margin-top:12px}th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#757575;text-align:left;border-bottom:2px solid #E0E0E0;padding:6px}td{padding:7px 6px;border-bottom:1px solid #EEE}.n{text-align:right;font-variant-numeric:tabular-nums}' +
      '.tot{margin-top:12px;margin-left:auto;width:300px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .g{font-size:15px;font-weight:600;border-top:1px solid #E0E0E0;padding-top:8px}.ass{margin-top:64px;display:flex;gap:48px}.ass div{flex:1;border-top:1px solid #212121;text-align:center;padding-top:6px}</style></head><body>' +
      '<div class="cab"><div><b>' + esc(c.nome || '') + '</b><br><small>' + esc([c.endereco, c.cidade, c.estado].filter(Boolean).join(' · ')) + (c.telefone ? ' · ' + esc(c.telefone) : '') + '</small></div>' +
        '<div style="text-align:right"><b style="color:#212121">Orçamento #' + o.id + '</b><br><small>' + br(o.data_criacao) + (o.validade ? ' · válido até ' + br(o.validade) : '') + '</small></div></div>' +
      '<div><b>Paciente:</b> ' + esc(d.paciente.nome) + (d.paciente.cpf ? ' · CPF ' + esc(d.paciente.cpf) : '') + '</div>' +
      (o.titulo ? '<div><b>Tratamento:</b> ' + esc(o.titulo) + '</div>' : '') + '<div><b>Tabela:</b> ' + esc(o.tabela_preco || '') + (o.profissional_nome ? ' · <b>Profissional:</b> ' + esc(o.profissional_nome) : '') + '</div>' +
      '<table><thead><tr><th>Procedimento</th><th>Dente / região</th><th class="n">Qtd</th><th class="n">Particular</th><th class="n">Plano</th></tr></thead><tbody>' +
      d.itens.map(function (i) {
        return '<tr><td>' + esc(i.procedimento_nome) + '</td><td>' + esc([i.dente, i.faces ? '(' + i.faces + ')' : '', i.regiao].filter(Boolean).join(' ') || '—') + '</td><td class="n">' + (i.quantidade || 1) + '</td>' +
          '<td class="n">' + (num(i.valor_unitario) || !num(i.valor_plano) ? moeda(num(i.valor_unitario) * (i.quantidade || 1)) : '—') + '</td><td class="n">' + (num(i.valor_plano) ? moeda(num(i.valor_plano) * (i.quantidade || 1)) : '—') + '</td></tr>'
      }).join('') + '</tbody></table>' +
      '<div class="tot"><div><span>Total particular</span><span>' + moeda(t.tot) + '</span></div>' + (t.desconto ? '<div><span>Desconto</span><span>- ' + moeda(t.desconto) + '</span></div>' : '') +
        (t.plano ? '<div><span>Coberto pelo plano</span><span>' + moeda(t.plano) + '</span></div>' : '') + '<div class="g"><span>Valor do paciente</span><span>' + moeda(t.liquido) + '</span></div></div>' +
      (o.forma_pagamento ? '<div style="margin-top:12px"><b>Forma de pagamento:</b> ' + esc(o.forma_pagamento) + (o.parcelas > 1 ? ' em ' + o.parcelas + 'x' : '') + '</div>' : '') +
      (o.observacoes ? '<div style="margin-top:8px"><b>Observações:</b> ' + esc(o.observacoes) + '</div>' : '') +
      '<div class="ass"><div>' + esc(d.paciente.nome) + '</div><div>' + esc(o.profissional_nome || c.nome || '') + '</div></div></body></html>')
    w.document.close(); w.focus(); setTimeout(function () { w.print() }, 200)
  }

  async function enviarOrcamentoWhatsApp(id) {
    var d = await apiData('orcamento-documento', { id: id })
    if (!d.success) return alert(d.error || 'Erro')
    var o = d.orcamento, t = linhasDocumento(d)
    var fone = String(d.paciente.whatsapp || d.paciente.telefone || '').replace(/\D/g, '')
    if (fone.length < 10) return alert('O paciente não tem celular cadastrado.')
    if (fone.slice(0, 2) !== '55') fone = '55' + fone
    var primeiro = String(d.paciente.nome || '').split(' ')[0]
    primeiro = primeiro.charAt(0) + primeiro.slice(1).toLowerCase()
    var txt = 'Olá, ' + primeiro + '! Segue o seu orçamento da ' + (d.clinica.nome || 'clínica') + ':\n\n' +
      d.itens.map(function (i) { return '• ' + i.procedimento_nome + ([i.dente, i.regiao].filter(Boolean).length ? ' (' + [i.dente, i.regiao].filter(Boolean).join(' ') + ')' : '') + ' — ' + (num(i.valor_plano) && !num(i.valor_unitario) ? 'coberto pelo plano' : moeda(num(i.valor_unitario) * (i.quantidade || 1))) }).join('\n') +
      '\n\n*Total: ' + moeda(t.liquido) + '*' + (t.desconto ? ' (já com desconto de ' + moeda(t.desconto) + ')' : '') +
      (o.validade ? '\nVálido até ' + br(o.validade) + '.' : '') + '\n\nQualquer dúvida, estamos à disposição.'
    window.open('https://wa.me/' + fone + '?text=' + encodeURIComponent(txt), '_blank')
  }

  // ════════════════════════════════════════════════════════════════
  // ODONTOGRAMA: painel de procedimentos dos orçamentos por dente
  // ════════════════════════════════════════════════════════════════
  window.PRONT_TABS.odontograma = function (box, p, d) {
    box.innerHTML = '<div class="oc-odo"><div id="oc-odo-esq" style="min-width:0"></div><div class="pc-box" id="oc-odo-dir"></div></div>'
    if (typeof renderOdontograma === 'function') renderOdontograma(el('oc-odo-esq'), p, (d && d.agendamentos) || [])
    var itens = []
    ;(_prontData.orcamentos || []).forEach(function (o) {
      if (o.status === 'reprovado' || o.status === 'desaprovado') return
      ;(o.itens || []).forEach(function (i) { itens.push({ i: i, o: o }) })
    })
    function situacao(x) { return x.i.executado ? ['Executado', 'ok'] : (x.o.status === 'aprovado' ? ['A realizar', 'err'] : ['Orçado', 'pend']) }
    itens.sort(function (a, b) { return String(a.i.dente || 'zz').localeCompare(String(b.i.dente || 'zz'), undefined, { numeric: true }) })
    el('oc-odo-dir').innerHTML = '<div class="pc-box-h">Procedimentos orçados <a id="oc-odo-novo">+ Orçamento</a></div>' +
      (itens.length ? itens.map(function (x) {
        var s = situacao(x)
        return '<div class="pc-nota"><div><b style="color:var(--text);font-weight:500">' + esc(x.i.dente || x.i.regiao || '—') + (x.i.faces ? ' (' + esc(x.i.faces) + ')' : '') + '</b> · ' + esc(x.i.procedimento_nome) +
          '<small>Orç. #' + x.o.id + ' · ' + br(x.o.data_criacao) + (x.i.profissional_nome ? ' · ' + esc(x.i.profissional_nome) : '') + '</small></div><span class="pc-badge ' + s[1] + '">' + s[0] + '</span></div>'
      }).join('') + '<div class="ag-hint">Vermelho: aprovado e ainda não executado · Verde: executado · Laranja: orçamento em aberto.</div>'
        : '<div class="pc-vazio">Nenhum procedimento orçado.</div>')
    el('oc-odo-novo').onclick = function () { abrirOrcamentoModal(null) }
  }

  // ════════════════════════════════════════════════════════════════
  // CONFIGURAÇÕES › TABELAS DE PREÇO
  // ════════════════════════════════════════════════════════════════
  async function abrirTabelasPreco() {
    var d = await apiData('precos-tabelas', { todas: 1 }), tabs = d.data || []
    modal('Tabelas de preço', '<div id="oc-t-err"></div><div class="oc-cards">' + tabs.map(function (t) {
      return '<div class="pc-box oc-card' + (t.ativo ? '' : ' inativa') + '"><div class="pc-box-h" style="margin-bottom:6px">' + esc(t.nome) + '</div>' +
        '<div><span class="pc-badge ' + (t.tipo === 'convenio' ? 'pend' : 'ok') + '">' + TIPO_TAB[t.tipo] + '</span>' + (t.ativo ? '' : ' <span class="pc-badge off">Inativa</span>') + '</div>' +
        '<div class="ag-hint">' + t.itens + ' procedimento(s)</div><div style="margin-top:auto;padding-top:8px"><button class="btn btn-sm" data-ver="' + t.id + '">Ver detalhes</button></div></div>'
    }).join('') + '</div>', '<button class="btn" id="oc-t-f">Fechar</button><button class="ag-btn-novo" id="oc-t-novo">+ Nova tabela</button>', 900)
    el('oc-t-f').onclick = fecharModal
    el('oc-t-novo').onclick = function () { editarTabela(null) }
    document.querySelectorAll('#oc-m-b [data-ver]').forEach(function (b) { b.onclick = function () { detalheTabela(tabs.filter(function (t) { return t.id === +b.getAttribute('data-ver') })[0]) } })
  }

  function editarTabela(t) {
    modal(t ? 'Editar tabela' : 'Nova tabela de preço', '<div id="oc-e-err"></div><div class="ag-row c2"><div class="ag-f"><label>Nome</label><input class="ag-in" id="oc-e-nome" maxlength="60" value="' + esc(t ? t.nome : '') + '"></div>' +
      '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="oc-e-tipo">' + Object.keys(TIPO_TAB).map(function (k) { return '<option value="' + k + '"' + (t && t.tipo === k ? ' selected' : '') + '>' + TIPO_TAB[k] + '</option>' }).join('') + '</select></div></div>' +
      '<p class="ag-hint">Nas tabelas de <b>convênio</b>, o valor dos procedimentos entra no orçamento como "coberto pelo plano" e não soma no total do paciente.</p>' +
      (t ? '<label class="ag-chk"><input type="checkbox" id="oc-e-ativo"' + (t.ativo ? ' checked' : '') + '> Tabela ativa</label>' : ''),
      '<button class="btn" id="oc-e-v">Voltar</button><button class="ag-btn-novo" id="oc-e-ok">Salvar</button>', 560)
    el('oc-e-v').onclick = function () { t ? detalheTabela(t) : abrirTabelasPreco() }
    el('oc-e-ok').onclick = async function () {
      var r = await apiPost('precos-tabelas', { id: t ? t.id : undefined, nome: el('oc-e-nome').value, tipo: el('oc-e-tipo').value, ativo: t ? el('oc-e-ativo').checked : undefined })
      if (!r.success) return erro('oc-e-err', r.error || 'Erro')
      await carregarTabelasPreco(true); abrirTabelasPreco()
    }
  }

  async function detalheTabela(t, pagina, q) {
    pagina = pagina || 1
    var d = await apiData('precos-itens', { tabela_id: t.id, pagina: pagina, limit: 50, q: q || '' })
    if (!d.success) return alert(d.error || 'Erro')
    var paginas = Math.max(1, Math.ceil(d.total / d.limite))
    modal(t.nome + ' — ' + TIPO_TAB[t.tipo], '<div id="oc-p-err"></div><div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">' +
      '<input class="ag-in" id="oc-p-q" placeholder="Buscar procedimento ou código" value="' + esc(q || '') + '" style="flex:1;min-width:200px">' +
      '<button class="btn" id="oc-p-novo">+ Procedimento</button><button class="btn" id="oc-p-imp">Importar lista</button><button class="btn" id="oc-p-dup">Duplicar tabela</button><button class="btn" id="oc-p-edit">Editar tabela</button></div>' +
      (d.data.length ? '<table class="pc-tbl"><thead><tr><th>Código</th><th>Procedimento</th><th class="hide-sm">Especialidade</th><th style="text-align:right">Valor</th><th></th></tr></thead><tbody>' +
        d.data.map(function (i) {
          return '<tr><td>' + esc(i.codigo_interno || '—') + '</td><td>' + esc(i.procedimento) + '</td><td class="hide-sm">' + esc(i.especialidade || '—') + '</td><td style="text-align:right">' + moeda(i.valor) + '</td>' +
            '<td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-ed="' + i.id + '">Editar</button> <button class="btn btn-sm" data-rm="' + i.id + '" style="color:var(--red)">Remover</button></td></tr>'
        }).join('') + '</tbody></table>' +
        '<div class="pc-pag"><span>' + d.total + ' procedimento(s)</span><span><button class="btn btn-sm" id="oc-p-prev"' + (pagina <= 1 ? ' disabled' : '') + '>‹</button> ' + pagina + ' / ' + paginas + ' <button class="btn btn-sm" id="oc-p-next"' + (pagina >= paginas ? ' disabled' : '') + '>›</button></span></div>'
        : '<div class="pc-vazio">Nenhum procedimento' + (q ? ' encontrado' : ' nesta tabela') + '.</div>'),
      '<button class="btn" id="oc-p-v">Voltar às tabelas</button>', 960)
    var tq = null
    el('oc-p-q').oninput = function () { var v = this.value; clearTimeout(tq); tq = setTimeout(function () { detalheTabela(t, 1, v) }, 350) }
    el('oc-p-v').onclick = abrirTabelasPreco
    el('oc-p-edit').onclick = function () { editarTabela(t) }
    el('oc-p-novo').onclick = function () { editarProcedimento(t, null) }
    el('oc-p-imp').onclick = function () { importarProcedimentos(t) }
    el('oc-p-dup').onclick = async function () {
      var nome = prompt('Nome da nova tabela (cópia de ' + t.nome + '):', t.nome + ' ' + (new Date().getFullYear() + 1)); if (!nome) return
      var aj = prompt('Reajuste em % sobre os valores (ex.: 8 para +8%, 0 para manter):', '0'); if (aj === null) return
      var r = await apiPost('precos-tabelas', { action: 'duplicar', id: t.id, nome: nome, ajuste_percent: aj })
      if (!r.success) return erro('oc-p-err', r.error || 'Erro')
      await carregarTabelasPreco(true); abrirTabelasPreco()
    }
    if (el('oc-p-prev')) { el('oc-p-prev').onclick = function () { detalheTabela(t, pagina - 1, q) }; el('oc-p-next').onclick = function () { detalheTabela(t, pagina + 1, q) } }
    document.querySelectorAll('#oc-m-b [data-ed]').forEach(function (b) { b.onclick = function () { editarProcedimento(t, d.data.filter(function (i) { return i.id === +b.getAttribute('data-ed') })[0], pagina, q) } })
    document.querySelectorAll('#oc-m-b [data-rm]').forEach(function (b) {
      b.onclick = async function () { if (!confirm('Remover este procedimento da tabela?')) return; var r = await apiPost('precos-itens', { tabela_id: t.id, action: 'delete', id: +b.getAttribute('data-rm') }); if (!r.success) return erro('oc-p-err', r.error || 'Erro'); detalheTabela(t, pagina, q) }
    })
  }

  function editarProcedimento(t, i, pagina, q) {
    i = i || {}
    modal(i.id ? 'Editar procedimento' : 'Novo procedimento — ' + t.nome, '<div id="oc-i-err"></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Procedimento</label><input class="ag-in" id="oc-i-proc" maxlength="200" value="' + esc(i.procedimento || '') + '"></div>' +
      '<div class="ag-f"><label>Código (TUSS ou interno)</label><input class="ag-in" id="oc-i-cod" maxlength="40" value="' + esc(i.codigo_interno || '') + '"></div></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Especialidade</label><input class="ag-in" id="oc-i-esp" maxlength="80" value="' + esc(i.especialidade || '') + '"></div>' +
      '<div class="ag-f"><label>Valor (R$)</label><input class="ag-in" id="oc-i-val" inputmode="decimal" value="' + (i.valor != null ? String(i.valor).replace('.', ',') : '') + '"></div>' +
      '<div class="ag-f"><label>Sessões</label><input class="ag-in" id="oc-i-ses" type="number" min="1" value="' + (i.sessoes || 1) + '"></div></div>',
      '<button class="btn" id="oc-i-v">Voltar</button><button class="ag-btn-novo" id="oc-i-ok">Salvar</button>', 640)
    el('oc-i-v').onclick = function () { detalheTabela(t, pagina, q) }
    el('oc-i-ok').onclick = async function () {
      var r = await apiPost('precos-itens', { tabela_id: t.id, id: i.id, procedimento: el('oc-i-proc').value, codigo_interno: el('oc-i-cod').value, especialidade: el('oc-i-esp').value, valor: el('oc-i-val').value, sessoes: el('oc-i-ses').value, comissao: i.comissao || 0 })
      if (!r.success) return erro('oc-i-err', r.error || 'Erro')
      detalheTabela(t, pagina, q)
    }
  }

  function importarProcedimentos(t) {
    modal('Importar procedimentos — ' + t.nome, '<div id="oc-imp-err"></div><p class="ag-hint" style="margin-top:0">Cole aqui as linhas copiadas da planilha, uma por procedimento, com as colunas: <b>procedimento ; valor ; código ; especialidade</b> (separadas por ponto e vírgula ou tabulação; código e especialidade são opcionais). Procedimentos com o mesmo nome têm o valor atualizado.</p>' +
      '<textarea class="ag-in" id="oc-imp-txt" rows="12" placeholder="RESTAURAÇÃO EM RESINA 1 FACE;180,00;85100099;Dentística"></textarea><div id="oc-imp-prev" class="ag-hint"></div>',
      '<button class="btn" id="oc-imp-v">Voltar</button><button class="ag-btn-novo" id="oc-imp-ok">Importar</button>', 760)
    function ler() {
      return el('oc-imp-txt').value.split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean).map(function (l) {
        var c = l.split(/\t|;/).map(function (x) { return x.trim() })
        return { procedimento: c[0], valor: (c[1] || '0').replace(/R\$\s?/i, ''), codigo: c[2] || '', especialidade: c[3] || '' }
      })
    }
    el('oc-imp-txt').oninput = function () { var it = ler(); el('oc-imp-prev').textContent = it.length + ' linha(s) · exemplo: ' + (it[0] ? it[0].procedimento + ' = R$ ' + it[0].valor : '—') }
    el('oc-imp-v').onclick = function () { detalheTabela(t) }
    el('oc-imp-ok').onclick = async function () {
      var it = ler(); if (!it.length) return erro('oc-imp-err', 'Cole ao menos uma linha.')
      this.disabled = true
      var r = await apiPost('precos-itens', { tabela_id: t.id, action: 'importar', itens: it })
      if (!r.success) { this.disabled = false; return erro('oc-imp-err', r.error || 'Erro') }
      alert(r.novos + ' novo(s), ' + r.atualizados + ' atualizado(s)' + (r.ignorados ? ', ' + r.ignorados + ' linha(s) ignorada(s)' : '') + '.')
      detalheTabela(t)
    }
  }

  window.carregarTabelasPreco = carregarTabelasPreco
  window.tipoTabelaPreco = tipoTabela
  window.abrirSeletorDentes = abrirSeletorDentes
  window.imprimirOrcamento = imprimirOrcamento
  window.enviarOrcamentoWhatsApp = enviarOrcamentoWhatsApp
  window.duplicarOrcamento = duplicarOrcamento
  window.abrirTabelasPreco = abrirTabelasPreco
})()
