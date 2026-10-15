// public/lote3.js — Funil de leads (CRM), contrato do orçamento, relatórios do protético e da indicação
// Klinov — Campo Grande, MS
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function v(id) { var e = el(id); return e ? e.value : '' }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function moeda(x) { return 'R$ ' + Number(x || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function foneWa(f) { var d = String(f || '').replace(/\D/g, ''); if (d.length < 10) return ''; return d.slice(0, 2) === '55' ? d : '55' + d }
  function isAdmin() { return (window.KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }
  function abrirRelatorio(id) { nav('relatorios'); setTimeout(function () { if (typeof setRouteHash === 'function') setRouteHash('relatorios/' + id); if (window.loadRelatoriosNovo) loadRelatoriosNovo(id) }, 50) }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('l3-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'l3-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10012'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 620) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="l3-x">✕</button></div><div class="ag-modal-b"><div id="l3-err"></div>' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('l3-x').onclick = fechar
    ov.onmousedown = function (e) { if (e.target === ov) fechar() }
  }
  function fechar() { var ov = el('l3-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  function erro(m) { var e = el('l3-err'); if (e) e.innerHTML = m ? '<div class="ag-err">' + esc(m) + '</div>' : '' }

  // ════════════════════════════════════════════════════════════════
  // CRM: funil de leads (aba nova da página CRM; a lista de inativos continua na outra aba)
  // ════════════════════════════════════════════════════════════════
  var LD = { q: '', origem: '', arquivados: false, aba: 'leads', arrastando: null, dados: null }
  function montarPaginaCrm() {
    var pg = el('p-crm'); if (!pg) return false
    if (!el('crm-abas')) {
      var antigo = document.createElement('div'); antigo.id = 'crm-inativos'
      while (pg.firstChild) antigo.appendChild(pg.firstChild)
      pg.innerHTML = '<div class="gpage-header"><div><div class="gpage-title">CRM</div><div class="gpage-sub">Do primeiro contato ao tratamento fechado</div></div><div class="ag-tabs" id="crm-abas"><div class="ag-tab on" data-a="leads">Funil de leads</div><div class="ag-tab" data-a="inativos">Pacientes inativos</div></div></div><div id="crm-leads"></div>'
      pg.appendChild(antigo)
      var hdr = antigo.querySelector('.gpage-header'); if (hdr) hdr.querySelector('.gpage-title').textContent = 'Pacientes inativos e reativação'
      el('crm-abas').querySelectorAll('[data-a]').forEach(function (t) {
        t.onclick = function () { LD.aba = this.getAttribute('data-a'); mostrarAba(); if (LD.aba === 'inativos' && typeof renderCRM === 'function') renderCRM() }
      })
    }
    mostrarAba()
    return true
  }
  function mostrarAba() {
    el('crm-abas').querySelectorAll('[data-a]').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-a') === LD.aba) })
    el('crm-leads').style.display = LD.aba === 'leads' ? '' : 'none'
    el('crm-inativos').style.display = LD.aba === 'inativos' ? '' : 'none'
    if (LD.aba === 'leads') carregarLeads()
  }
  async function carregarLeads() {
    var box = el('crm-leads'); if (!box) return
    if (!pode('crm.acessar')) { box.innerHTML = '<div class="gpage-body"><div class="pc-vazio">Seu perfil não tem acesso ao CRM.</div></div>'; return }
    if (!box.querySelector('#ld-board')) {
      box.innerHTML = '<div class="gpage-body"><div id="ld-kpis"></div><div class="crc-filtros"><div class="ag-f" style="flex:2"><label>Buscar</label><input class="ag-in" id="ld-q" placeholder="Nome, telefone ou campanha" value="' + esc(LD.q) + '"></div><div class="ag-f"><label>Origem</label><select class="ag-in" id="ld-origem"><option value="">Todas</option></select></div>' +
        '<div class="fn-acoes" style="align-self:flex-end"><button class="btn" id="ld-arq">' + (LD.arquivados ? 'Ver ativos' : 'Arquivados') + '</button><button class="btn" id="ld-rel">Relatório</button><button class="ag-btn-novo" id="ld-novo">+ Novo lead</button></div></div><div class="crc-board" id="ld-board"><div class="crc-sk" style="height:200px"></div></div></div>'
      var t = null
      el('ld-q').oninput = function () { var x = this.value; clearTimeout(t); t = setTimeout(function () { LD.q = x; carregarLeads() }, 300) }
      el('ld-origem').onchange = function () { LD.origem = this.value; carregarLeads() }
      el('ld-arq').onclick = function () { LD.arquivados = !LD.arquivados; this.textContent = LD.arquivados ? 'Ver ativos' : 'Arquivados'; carregarLeads() }
      el('ld-rel').onclick = function () { abrirRelatorio('pac-leads') }
      el('ld-novo').onclick = function () { editarLead(null) }
    }
    var d = await apiData('leads', { q: LD.q, origem: LD.origem, arquivados: LD.arquivados ? 1 : '' }).catch(function (e) { return { success: false, error: e.message } })
    var board = el('ld-board'); if (!board) return
    if (!d.success) { board.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    LD.dados = d
    var so = el('ld-origem'); if (so.options.length <= 1) d.origens.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; if (o === LD.origem) op.selected = true; so.appendChild(op) })
    var t2 = d.totais
    el('ld-kpis').innerHTML = '<div class="fn-kpis">' + [['Leads em aberto', String(t2.abertos)], ['Valor em negociação', moeda(t2.valor_aberto)], ['Fechados', String(t2.fechados)], ['Conversão', String(t2.conversao).replace('.', ',') + '%']].map(function (k) { return '<div class="pc-box fn-kpi"><div class="pc-box-h" style="margin-bottom:8px">' + k[0] + '</div><div class="fn-kpi-v">' + k[1] + '</div></div>' }).join('') + '</div>'
    board.innerHTML = d.etapas.map(function (e) {
      var cs = d.itens.filter(function (x) { return x.etapa === e.id })
      var soma = cs.reduce(function (s, x) { return s + x.valor_estimado }, 0)
      return '<div class="crc-col" data-etapa="' + e.id + '"><div class="crc-col-h"><b>' + esc(e.nome) + '</b><span>' + cs.length + '</span></div>' + (soma ? '<div class="ag-hint" style="margin:0 12px 8px">' + moeda(soma) + '</div>' : '') + '<div class="crc-col-b">' + (cs.length ? cs.map(function (x) {
        var wa = foneWa(x.telefone)
        return '<div class="crc-cartao' + (x.parado ? ' atrasado' : '') + '" draggable="' + (LD.arquivados ? 'false' : 'true') + '" data-id="' + x.id + '"><div class="crc-c-top"><a class="crc-c-nome" data-ab="' + x.id + '">' + esc(x.nome) + '</a>' + (x.valor_estimado ? '<span class="crc-c-dias">' + moeda(x.valor_estimado) + '</span>' : '') + '</div>' +
          '<div class="crc-c-data">' + esc([x.origem, x.campanha].filter(Boolean).join(' · ')) + '</div>' + (x.interesse ? '<div class="crc-c-ctx">' + esc(x.interesse) + '</div>' : '') +
          '<div class="crc-c-data">' + (x.parado ? '<span style="color:var(--red)">' + x.dias_sem_contato + ' dias sem contato</span>' : (x.ultimo_contato ? 'Último contato ' + br(x.ultimo_contato) : 'Chegou em ' + br(x.criado_em))) + (x.paciente_id ? ' · <b style="color:var(--green)">paciente</b>' : '') + '</div>' +
          (x.etapa === 'perdido' && x.perdido_motivo ? '<div class="crc-c-ret err">' + esc(x.perdido_motivo) + '</div>' : '') +
          '<div class="crc-c-acoes"><button class="btn btn-sm" data-ab="' + x.id + '">Abrir</button>' + (wa ? '<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + wa + '">WhatsApp</a>' : '') + '</div></div>'
      }).join('') : '<div class="crc-vazio">Nenhum lead</div>') + '</div></div>'
    }).join('')
    board.querySelectorAll('[data-ab]').forEach(function (a) { a.onclick = function () { abrirLead(+this.getAttribute('data-ab')) } })
    board.querySelectorAll('.crc-cartao[draggable="true"]').forEach(function (n) {
      n.addEventListener('dragstart', function (ev) { LD.arrastando = +n.getAttribute('data-id'); n.classList.add('arrastando'); try { ev.dataTransfer.setData('text/plain', String(LD.arrastando)) } catch (e) {} })
      n.addEventListener('dragend', function () { n.classList.remove('arrastando'); LD.arrastando = null })
    })
    board.querySelectorAll('.crc-col').forEach(function (col) {
      col.addEventListener('dragover', function (ev) { if (LD.arrastando) { ev.preventDefault(); col.classList.add('alvo') } })
      col.addEventListener('dragleave', function (ev) { if (!col.contains(ev.relatedTarget)) col.classList.remove('alvo') })
      col.addEventListener('drop', async function (ev) { ev.preventDefault(); col.classList.remove('alvo'); var id = LD.arrastando; LD.arrastando = null; if (!id) return; mover(id, col.getAttribute('data-etapa')) })
    })
  }
  async function mover(id, etapa) {
    var motivo = ''
    if (etapa === 'perdido') { motivo = prompt('Por que este lead foi perdido? (ex.: achou caro, fechou em outra clínica)'); if (!motivo) return carregarLeads() }
    var r = await apiPost('leads', { action: 'mover', id: id, etapa: etapa, motivo: motivo })
    if (!r.success) alert(r.error || 'Erro')
    carregarLeads()
  }
  function editarLead(x) {
    x = x || {}
    var origens = (LD.dados && LD.dados.origens) || ['Outros']
    modal(x.id ? 'Editar lead' : 'Novo lead', '<div class="ag-f"><label>Nome</label><input class="ag-in" id="ld-nome" maxlength="120" value="' + esc(x.nome || '') + '"></div>' +
      '<div class="ag-row c2"><div class="ag-f"><label>Telefone / WhatsApp</label><input class="ag-in" id="ld-tel" maxlength="30" value="' + esc(x.telefone || '') + '"></div><div class="ag-f"><label>E-mail</label><input class="ag-in" id="ld-email" maxlength="120" value="' + esc(x.email || '') + '"></div></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Origem</label><select class="ag-in" id="ld-org">' + origens.map(function (o) { return '<option' + ((x.origem || '') === o ? ' selected' : '') + '>' + esc(o) + '</option>' }).join('') + '</select></div><div class="ag-f"><label>Campanha</label><input class="ag-in" id="ld-camp" maxlength="80" value="' + esc(x.campanha || '') + '"></div><div class="ag-f"><label>Valor estimado (R$)</label><input class="ag-in" id="ld-val" inputmode="decimal" value="' + (x.valor_estimado ? String(x.valor_estimado).replace('.', ',') : '') + '"></div></div>' +
      '<div class="ag-f"><label>Interesse</label><input class="ag-in" id="ld-int" maxlength="120" placeholder="Ex.: Implante, clareamento" value="' + esc(x.interesse || '') + '"></div>' +
      '<div class="ag-f"><label>Observações</label><textarea class="ag-in" id="ld-obs" rows="2" maxlength="1000">' + esc(x.observacoes || '') + '</textarea></div>',
      '<button class="btn" id="ld-c">Cancelar</button><button class="ag-btn-novo" id="ld-ok">Salvar</button>', 640)
    el('ld-c').onclick = function () { x.id ? abrirLead(x.id) : fechar() }
    el('ld-ok').onclick = async function () {
      var r = await apiPost('leads', { id: x.id, nome: v('ld-nome'), telefone: v('ld-tel'), email: v('ld-email'), origem: v('ld-org'), campanha: v('ld-camp'), valor_estimado: v('ld-val'), interesse: v('ld-int'), observacoes: v('ld-obs') })
      if (!r.success) return erro(r.error || 'Erro')
      fechar(); carregarLeads()
    }
  }
  async function abrirLead(id) {
    var x = ((LD.dados && LD.dados.itens) || []).filter(function (i) { return i.id === id })[0]; if (!x) return
    var h = await apiData('lead-interacoes', { lead_id: id }).catch(function () { return { data: [] } })
    var etapas = (LD.dados && LD.dados.etapas) || []
    var TIP = { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', presencial: 'Presencial', nota: 'Nota', etapa: 'Etapa' }
    modal(x.nome, '<div class="ag-hint" style="margin-top:0">' + esc([x.telefone, x.email, x.origem, x.campanha].filter(Boolean).join(' · ')) + (x.interesse ? '<br>Interesse: ' + esc(x.interesse) : '') + (x.valor_estimado ? ' · ' + moeda(x.valor_estimado) : '') + '</div>' +
      (x.observacoes ? '<p>' + esc(x.observacoes) + '</p>' : '') +
      '<div class="ag-row c2" style="margin-top:12px"><div class="ag-f"><label>Etapa</label><select class="ag-in" id="ld-et">' + etapas.map(function (e) { return '<option value="' + e.id + '"' + (e.id === x.etapa ? ' selected' : '') + '>' + esc(e.nome) + '</option>' }).join('') + '</select></div><div></div></div>' +
      '<div class="pc-box-h" style="margin-top:12px">Registrar contato</div><div class="ag-row c3" style="align-items:end"><div class="ag-f"><label>Forma</label><select class="ag-in" id="ld-tp"><option value="whatsapp">WhatsApp</option><option value="ligacao">Ligação</option><option value="email">E-mail</option><option value="presencial">Presencial</option><option value="nota">Nota</option></select></div><div class="ag-f" style="grid-column:span 2"><label>O que foi conversado</label><input class="ag-in" id="ld-txt" maxlength="1000"></div></div><div style="text-align:right"><button class="btn btn-sm btn-primary" id="ld-reg">Registrar</button></div>' +
      '<div class="pc-box-h" style="margin-top:16px">Histórico</div>' + ((h.data || []).length ? h.data.map(function (i) { return '<div class="pc-nota"><div>' + esc(i.texto) + '<small>' + (TIP[i.tipo] || i.tipo) + ' · ' + br(i.criado_em) + ' ' + String(i.criado_em || '').slice(11, 16) + (i.criado_por_nome ? ' · ' + esc(i.criado_por_nome) : '') + '</small></div></div>' }).join('') : '<div class="pc-vazio" style="padding:8px 0;text-align:left">Nenhum contato registrado.</div>'),
      (pode('crm.excluir') ? '<button class="btn" id="ld-del" style="color:var(--red)">Excluir</button>' : '') + '<button class="btn" id="ld-arqv" style="margin-right:auto">' + (x.arquivado ? 'Desarquivar' : 'Arquivar') + '</button><button class="btn" id="ld-ed">Editar</button>' +
      (x.paciente_id ? '<button class="ag-btn-novo" id="ld-pac">Abrir paciente</button>' : '<button class="ag-btn-novo" id="ld-conv">Cadastrar como paciente</button>'), 720)
    el('ld-et').onchange = async function () { var et = this.value; fechar(); await mover(id, et) }
    el('ld-reg').onclick = async function () { var r = await apiPost('leads', { action: 'interacao', id: id, tipo: v('ld-tp'), texto: v('ld-txt') }); if (!r.success) return erro(r.error); await carregarLeads(); abrirLead(id) }
    el('ld-ed').onclick = function () { editarLead(x) }
    el('ld-arqv').onclick = async function () { await apiPost('leads', { action: x.arquivado ? 'desarquivar' : 'arquivar', id: id }); fechar(); carregarLeads() }
    if (el('ld-del')) el('ld-del').onclick = async function () { if (!confirm('Excluir este lead e o histórico de contatos?')) return; var r = await apiPost('leads', { action: 'excluir', id: id }); if (!r.success) return erro(r.error); fechar(); carregarLeads() }
    if (el('ld-pac')) el('ld-pac').onclick = function () { fechar(); abrirProntuario('', x.paciente_id) }
    if (el('ld-conv')) el('ld-conv').onclick = async function () {
      var r = await apiPost('leads', { action: 'converter', id: id }); if (!r.success) return erro(r.error)
      fechar(); await carregarLeads()
      if (confirm((r.existente ? 'Já havia um paciente com este telefone; o lead foi vinculado a ele.' : 'Paciente cadastrado.') + ' Abrir o cadastro agora?')) abrirProntuario('', r.paciente_id)
    }
  }
  if (typeof window.nav === 'function') {
    var navAnt = window.nav
    window.nav = function (id) {
      if (CHEIA) { CHEIA = false; document.body.style.overflow = '' }
      var r = navAnt.apply(this, arguments)
      if (id === 'crm') montarPaginaCrm()
      return r
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ORÇAMENTO: gerar contrato
  // ════════════════════════════════════════════════════════════════
  async function gerarContrato(orcId) {
    if (!confirm('Gerar o contrato deste orçamento? Ele fica na aba Documentos do paciente.')) return
    var r = await apiPost('orcamento-contrato', { orcamento_id: orcId }).catch(function (e) { return { success: false, error: e.message } })
    if (!r.success) return alert(r.error || 'Erro ao gerar o contrato')
    modal('Contrato gerado', '<p style="margin-top:0"><b>' + esc(r.titulo) + '</b> foi salvo em Documentos, com os procedimentos e a forma de pagamento do orçamento.</p><p class="ag-hint">Para mudar o texto do contrato, edite o modelo do tipo "Contrato" em Configurações › Prontuário › Modelos de documento. Use {{orcamento.itens}} e {{orcamento.pagamento}} para posicionar a lista e o pagamento.</p>',
      '<button class="btn" id="l3-docs">Ver em Documentos</button><button class="ag-btn-novo" id="l3-ass">Pedir assinatura do paciente</button>', 600)
    el('l3-docs').onclick = function () { fechar(); var aba = Array.prototype.filter.call(document.querySelectorAll('#pront-tabs .pdt-tab'), function (t) { return (t.getAttribute('onclick') || '').indexOf("'documentos'") >= 0 })[0]; if (aba) aba.click() }
    el('l3-ass').onclick = function () { fechar(); if (window.abrirAssinatura) abrirAssinatura('documento', r.documento_id) }
  }
  window.gerarContratoOrcamento = gerarContrato

  // ════════════════════════════════════════════════════════════════
  // Relatórios nos quadros do protético e da indicação
  // ════════════════════════════════════════════════════════════════
  function botaoRelatorio(pgId, rotulo, acao) {
    var pg = el(pgId); if (!pg) return
    var acoes = pg.querySelector('.gpage-header .fn-acoes'); if (!acoes || acoes.querySelector('[data-l3rel]')) return
    var b = document.createElement('button'); b.className = 'btn'; b.textContent = rotulo; b.setAttribute('data-l3rel', '1'); b.onclick = acao
    acoes.insertBefore(b, acoes.firstChild)
  }
  function csvIndicacoes() {
    var cards = Array.prototype.map.call(document.querySelectorAll('#in-board .crc-col'), function (col) {
      var etapa = col.querySelector('.crc-col-h b').textContent
      return Array.prototype.map.call(col.querySelectorAll('.crc-cartao'), function (c) {
        return [etapa, c.querySelector('.crc-c-nome').textContent, (c.querySelector('.crc-c-data .fn-pac') || {}).textContent || '', (c.querySelector('.crc-c-dias') || {}).textContent || '', (c.querySelector('.crc-c-ctx') || {}).textContent || '', (c.querySelector('.crc-c-ret') || {}).textContent || '']
      })
    }).reduce(function (a, b) { return a.concat(b) }, [])
    if (!cards.length) return alert('Nenhuma indicação no quadro.')
    var csv = [['Etapa', 'Paciente indicado', 'Indicado por', 'Cadastro', 'Tratamento', 'Recompensa']].concat(cards).map(function (l) { return l.map(function (x) { x = String(x || '').trim(); return /[";\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x }).join(';') }).join('\r\n')
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'controle-de-indicacao.csv'; document.body.appendChild(a); a.click(); a.remove()
  }
  ;['loadProtetico', 'loadIndicacao'].forEach(function (fn) {
    if (typeof window[fn] !== 'function') return
    var ant = window[fn]
    window[fn] = async function () {
      var r = await ant.apply(this, arguments)
      if (fn === 'loadProtetico') botaoRelatorio('p-protético', 'Relatório', function () { abrirRelatorio('tr-protetico') })
      else botaoRelatorio('p-indicacao', 'Exportar planilha', csvIndicacoes)
      return r
    }
  })

  // ════════════════════════════════════════════════════════════════
  // ODONTOGRAMA: dentição mista e tela cheia
  // ════════════════════════════════════════════════════════════════
  function tooth(t, sup, odMap) {
    var st = (odMap[t] || {}).status || '', sel = window._odontSelected === t ? ' selected' : ''
    return '<div class="odont-tooth-col' + sel + '" data-status="' + st + '" data-tooth="' + t + '" onclick="odontSelectTooth(' + t + ')">' + (sup ? '<div class="odont-tooth-num">' + t + '</div>' : '') + '<div class="odont-tooth-svg">' + toothSvg(t, sup) + '</div>' + (!sup ? '<div class="odont-tooth-num">' + t + '</div>' : '') + '</div>'
  }
  function linha(arr, sup, odMap) { return arr.map(function (t) { return tooth(t, sup, odMap) }).join('') }
  var CHEIA = false
  if (typeof window.renderOdontograma === 'function') {
    var odoAnt = window.renderOdontograma
    window.renderOdontograma = function (box, p, ag) {
      var mista = window._odontDenticao === 'mista'
      if (mista) window._odontDenticao = 'permanente'
      odoAnt.apply(this, arguments)
      if (mista) window._odontDenticao = 'mista'
      var dent = box.querySelector('.odont-dentition')
      if (dent && !dent.querySelector('[data-mista]')) {
        dent.querySelectorAll('button').forEach(function (bt) { if (mista) bt.classList.remove('active') })
        var bm = document.createElement('button'); bm.textContent = 'Mista'; bm.setAttribute('data-mista', '1'); if (mista) bm.className = 'active'
        bm.onclick = function () { window._odontDenticao = 'mista'; renderProntTab() }
        dent.appendChild(bm)
      }
      var hdr = box.querySelector('.odont-header')
      if (hdr && !hdr.querySelector('[data-cheia]')) {
        var fc = document.createElement('button'); fc.className = 'pdt-btn-outline'; fc.setAttribute('data-cheia', '1'); fc.style.cssText = 'font-size:12px;padding:5px 12px;margin-left:auto'
        var wrap = box.querySelector('.odont-wrap') || box
        fc.textContent = CHEIA ? 'Sair da tela cheia' : 'Tela cheia'
        fc.onclick = function () { telaCheia() }
        hdr.appendChild(fc)
      }
      if (CHEIA) { var w = box.querySelector('.odont-wrap'); if (w) w.classList.add('l3-cheia') }
      if (!mista) return
      // mista: permanentes por fora e decíduos por dentro (arcada superior e inferior)
      var odMap = {}; ((window._prontData || {}).odontograma || []).forEach(function (o) { odMap[o.dente] = o })
      var chart = box.querySelector('.odont-chart'); if (!chart) return
      chart.innerHTML = '<div class="odont-row">' + linha([18, 17, 16, 15, 14, 13, 12, 11], true, odMap) + '<div class="odont-separator"></div>' + linha([21, 22, 23, 24, 25, 26, 27, 28], true, odMap) + '</div>' +
        '<div class="odont-row l3-dec">' + linha([55, 54, 53, 52, 51], true, odMap) + '<div class="odont-separator"></div>' + linha([61, 62, 63, 64, 65], true, odMap) + '</div>' +
        '<div style="border-top:1px solid var(--border);margin:8px 20px"></div>' +
        '<div class="odont-row l3-dec">' + linha([85, 84, 83, 82, 81], false, odMap) + '<div class="odont-separator"></div>' + linha([71, 72, 73, 74, 75], false, odMap) + '</div>' +
        '<div class="odont-row">' + linha([48, 47, 46, 45, 44, 43, 42, 41], false, odMap) + '<div class="odont-separator"></div>' + linha([31, 32, 33, 34, 35, 36, 37, 38], false, odMap) + '</div>'
    }
  }
  function telaCheia() {
    CHEIA = !CHEIA
    var w = document.querySelector('.odont-wrap'); if (w) w.classList.toggle('l3-cheia', CHEIA)
    document.body.style.overflow = CHEIA ? 'hidden' : ''
    var fc = document.querySelector('[data-cheia]'); if (fc) fc.textContent = CHEIA ? 'Sair da tela cheia' : 'Tela cheia'
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && CHEIA) telaCheia() })
})()
