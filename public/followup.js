// public/followup.js — Follow-up automático de orçamentos (CRC › Follow-up)
// Klinov — Campo Grande, MS
//
// Três abas: Conversas (funil + lista + conversa com resposta da equipe),
// Mensagens (prévia real das 4 mensagens da régua) e Configuração.
// Os dados vêm de lib/rotas/followup.js.
;(function () {
  'use strict'

  var STATUS = {
    ativo: ['Na régua', 'info'], conversando: ['Conversando', 'pend'], transferido: ['Precisa da equipe', 'err'],
    concluido: ['Régua concluída', 'off'], pausado: ['Pausado', 'off'], perdido: ['Não vai fazer', 'off'],
    optout: ['Pediu para parar', 'off'], convertido: ['Fechou', 'ok'], encerrado: ['Encerrado', 'off']
  }
  var FILTROS = [['', 'Todos'], ['atencao', 'Precisam da equipe'], ['conversando', 'Conversando'], ['ativo', 'Na régua'], ['convertido', 'Fecharam'], ['perdido', 'Não vão fazer'], ['concluido', 'Régua concluída']]
  var OBJ = { preco: 'Preço', medo_dor: 'Medo/dor', tempo: 'Tempo', pensar: 'Vai pensar', familia: 'Família', confianca: 'Confiança', outro_profissional: 'Outro profissional', sem_necessidade: 'Sem necessidade' }
  var AUTOR = { regua: 'Régua automática', ia: 'Assistente virtual', equipe: 'Equipe', sistema: 'Resposta automática', paciente: 'Paciente' }
  var ST_MSG = { enviado: 'enviada', entregue: 'entregue', lido: 'lida', erro: 'erro no envio', recebido: '' }
  var CAT = { implante: 'Implante', ortodontia: 'Ortodontia', estetica: 'Estética', harmonizacao: 'Harmonização', protese: 'Prótese', endodontia: 'Canal', periodontia: 'Gengiva', cirurgia: 'Cirurgia', restauracao: 'Restauração', prevencao: 'Prevenção', geral: 'Geral' }

  var FU = { aba: 'conversas', filtro: '', q: '', dados: null }

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : String(s)) }
  function moeda(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
  function moedaCurta(v) { v = Number(v || 0); return v >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : moeda(v) }
  function quando(dt) {
    if (!dt) return '—'
    var s = String(dt), d = s.slice(0, 10).split('-')
    return d[2] + '/' + d[1] + (s.length > 11 ? ' ' + s.slice(11, 16) : '')
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '—' }
  function badge(st) { var s = STATUS[st] || [st, 'off']; return '<span class="fu-badge ' + s[1] + '">' + esc(s[0]) + '</span>' }
  function etapas(n) { var h = ''; for (var i = 1; i <= 4; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>'; return '<span class="fu-etapas" title="' + n + ' de 4 mensagens enviadas">' + h + '</span>' }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('fu-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'fu-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10010'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 680) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="fu-m-x">✕</button></div>' +
      '<div class="ag-modal-b" id="fu-m-b">' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('fu-m-x').onclick = fecharModal
    ov.onmousedown = function (e) { if (e.target === ov) fecharModal() }
  }
  function fecharModal() { var ov = el('fu-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }

  // ════════════════════════════════════════════════════════════════
  async function abrir() {
    var pg = el('p-crc'); if (!pg) return
    if (typeof setRouteHash === 'function') setRouteHash('crc/followup')
    pg.innerHTML = '<div class="gpage-header"><div><div class="gpage-title"><a class="crc-voltar" id="fu-voltar">CRC</a> › Follow-up de orçamentos</div>' +
      '<div class="gpage-sub">Mensagens automáticas por WhatsApp para quem recebeu orçamento e ainda não fechou</div></div>' +
      '<div class="flex"><button class="btn" id="fu-rodar" style="display:none" title="Envia agora as mensagens que estão no dia">Rodar régua agora</button><button class="btn" id="fu-atualizar">Atualizar</button></div></div>' +
      '<div class="gpage-body"><div id="fu-banner"></div><div class="fu-tabs">' +
      [['conversas', 'Conversas'], ['mensagens', 'Mensagens'], ['config', 'Configuração']].map(function (t) { return '<div class="fu-tab" data-aba="' + t[0] + '">' + t[1] + '</div>' }).join('') +
      '</div><div id="fu-corpo"><div class="crc-sk"></div></div></div>'
    el('fu-voltar').onclick = function () { if (typeof setRouteHash === 'function') setRouteHash('crc'); if (window.loadCrc) loadCrc() }
    el('fu-atualizar').onclick = carregar
    el('fu-rodar').onclick = rodarAgora
    pg.querySelectorAll('.fu-tab').forEach(function (t) { t.onclick = function () { FU.aba = t.getAttribute('data-aba'); render() } })
    await carregar()
  }

  async function carregar() {
    var d
    try { d = await apiData('followup-painel', { status: FU.filtro, q: FU.q }) } catch (e) { el('fu-corpo').innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>'; return }
    if (!d.success) { el('fu-corpo').innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    FU.dados = d
    render()
  }

  function render() {
    var d = FU.dados; if (!d) return
    var c = d.config, ig = d.integracoes, pend = []
    if (!ig.whatsapp) pend.push('WhatsApp (WHATSAPP_TOKEN)')
    if (!ig.ia) pend.push('IA (ANTHROPIC_API_KEY)')
    if (!ig.email) pend.push('e-mail de alerta (RESEND_API_KEY)')
    el('fu-banner').innerHTML = '<div class="fu-banner ' + (!c.ativo ? '' : c.modo_teste ? 'teste' : 'on') + '">' +
      (!c.ativo ? '<b>Desligado.</b> Nenhuma mensagem é enviada. Revise as mensagens e ligue em Configuração.'
        : c.modo_teste ? '<b>Modo teste.</b> Todas as mensagens vão para ' + esc(c.telefone_teste || '(sem telefone)') + ', não para os pacientes.'
          : '<b>Ligado.</b> A régua roda todo dia por volta das 9h' + (c.pular_domingo ? ', exceto domingo' : '') + '.') +
      (pend.length ? '<span class="fu-pend">Falta configurar no servidor: ' + esc(pend.join(', ')) + '</span>' : '') + '</div>'
    el('fu-rodar').style.display = d.admin && c.ativo ? '' : 'none'
    document.querySelectorAll('.fu-tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-aba') === FU.aba) })
    if (FU.aba === 'conversas') renderConversas()
    else if (FU.aba === 'mensagens') renderMensagens()
    else renderConfig()
  }

  // ── Conversas ───────────────────────────────────────────────────
  function renderConversas() {
    var d = FU.dados, k = d.kpis || {}
    var contatados = Number(k.contatados) || 0
    var html = '<div class="fu-kpis">' +
      kpi(k.transferidos || 0, 'Precisam da equipe agora', Number(k.transferidos) ? 'alerta' : '') +
      kpi(k.conversando || 0, 'Conversando com a assistente') +
      kpi(k.em_regua || 0, 'Na régua, aguardando') +
      kpi(pct(Number(k.responderam) || 0, contatados), 'Taxa de resposta') +
      kpi(k.convertidos || 0, 'Fecharam (' + pct(Number(k.convertidos) || 0, contatados) + ')', 'bom') +
      kpi(moedaCurta(k.valor_convertido), 'Valor recuperado', 'bom') +
      kpi(moedaCurta(k.valor_aberto), 'Valor em negociação') +
      '</div>'
    if (d.objecoes && d.objecoes.length) html += '<div class="fu-obj">Objeções mais comuns:' + d.objecoes.map(function (o) { return '<span class="fu-chip">' + esc(OBJ[o.objecao] || o.objecao) + ' <b>' + o.n + '</b></span>' }).join('') + '</div>'
    html += '<div class="fu-filtros">' + FILTROS.map(function (f) { return '<span class="fu-fil' + (FU.filtro === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</span>' }).join('') +
      '<input class="ag-in" id="fu-q" placeholder="Buscar paciente" value="' + esc(FU.q) + '"></div>'
    var lista = d.lista || []
    html += '<div class="fu-tab-wrap">' + (lista.length ? '<table class="fu-table"><thead><tr><th>Paciente</th><th>Tratamento</th><th class="num">Valor</th><th>Régua</th><th>Situação</th><th>Última atividade</th></tr></thead><tbody>' +
      lista.map(function (f) {
        var prev = f.ultima_msg ? String(f.ultima_msg).replace(/^\[TESTE → \d+\] /, '').replace(/\s+/g, ' ') : ''
        return '<tr data-id="' + f.id + '"><td><div class="fu-nome">' + esc(f.paciente_nome) + '</div>' + (prev ? '<div class="fu-prev' + (f.ultima_direcao === 'entrada' ? ' in' : '') + '">' + (f.ultima_direcao === 'entrada' ? 'Paciente: ' : '') + esc(prev) + '</div>' : '') + '</td>' +
          '<td>' + esc(CAT[f.categoria] || '—') + (f.objecao ? '<div class="fu-prev">Objeção: ' + esc(OBJ[f.objecao] || f.objecao) + '</div>' : '') + '</td>' +
          '<td class="num">' + moeda(f.valor) + '</td><td>' + etapas(f.etapa) + '</td><td>' + badge(f.status) + '</td>' +
          '<td>' + quando(f.ultima_resposta && f.ultima_resposta > (f.ultimo_envio || '') ? f.ultima_resposta : f.ultimo_envio) + '</td></tr>'
      }).join('') + '</tbody></table>'
      : '<div class="fu-vazio">' + (FU.filtro || FU.q ? 'Nenhuma conversa com esse filtro.' : d.config.ativo ? 'Ainda não há orçamentos na régua. Eles entram automaticamente na próxima execução.' : 'Ligue o follow-up em Configuração para começar.') + '</div>') + '</div>'
    el('fu-corpo').innerHTML = html
    el('fu-corpo').querySelectorAll('.fu-fil').forEach(function (b) { b.onclick = function () { FU.filtro = b.getAttribute('data-f'); carregar() } })
    var tq = null
    el('fu-q').oninput = function () { var v = this.value; clearTimeout(tq); tq = setTimeout(function () { FU.q = v; carregar() }, 350) }
    el('fu-corpo').querySelectorAll('tr[data-id]').forEach(function (tr) { tr.onclick = function () { abrirConversa(tr.getAttribute('data-id')) } })
  }
  function kpi(n, l, cls) { return '<div class="fu-kpi ' + (cls || '') + '"><div class="fu-kpi-n">' + esc(n) + '</div><div class="fu-kpi-l">' + esc(l) + '</div></div>' }

  async function abrirConversa(id) {
    var d
    try { d = await apiData('followup-conversa', { id: id }) } catch (e) { return alert(e.message) }
    if (!d.success) return alert(d.error || 'Erro')
    var f = d.followup, o = d.orcamento || {}
    var corpo = '<div class="fu-conv-top"><span>' + badge(f.status) + '</span><span><b>Orçamento #' + f.orcamento_id + '</b> · ' + moeda(f.valor) + '</span>' +
      (o.profissional_nome ? '<span>Dentista: <b>' + esc(o.profissional_nome) + '</b></span>' : '') + '<span>Telefone: ' + esc(f.telefone) + '</span>' +
      '<span>Mensagens da régua: ' + f.etapa + ' de 4</span></div>' +
      (d.itens && d.itens.length ? '<div class="ag-hint" style="margin-bottom:12px">' + d.itens.map(function (i) { return esc(i.procedimento_nome) + (i.dente ? ' (' + esc(i.dente) + ')' : '') }).join(' · ') + '</div>' : '') +
      (f.resumo_equipe ? '<div class="fu-resumo"><b>Resumo para a equipe:</b> ' + esc(f.resumo_equipe) + '</div>' : '') +
      (f.motivo_perda ? '<div class="fu-resumo"><b>Motivo informado:</b> ' + esc(f.motivo_perda) + '</div>' : '') +
      '<div class="fu-chat" id="fu-chat">' + (d.mensagens.length ? d.mensagens.map(bolha).join('') : '<div class="fu-msg nota">Nenhuma mensagem ainda</div>') + '</div>' +
      (['convertido', 'encerrado', 'optout'].indexOf(f.status) >= 0 ? '' :
        d.janela_aberta ? '<div class="fu-resp"><textarea class="ag-in" id="fu-txt" placeholder="Escreva como equipe… (ao responder, você assume a conversa)"></textarea><button class="fu-btn-cta" id="fu-enviar">Enviar</button></div>'
          : '<div class="fu-aviso">Para escrever livremente, o paciente precisa ter respondido nas últimas 24h (regra do WhatsApp). Fora disso, ligue para ele ou use o WhatsApp da clínica.</div>')
    var ac = []
    if (['ativo', 'conversando', 'concluido'].indexOf(f.status) >= 0) ac.push(['pausar', 'Pausar'])
    if (f.status === 'pausado') ac.push(['retomar', 'Retomar'])
    if (['ativo', 'conversando', 'concluido', 'pausado', 'perdido'].indexOf(f.status) >= 0) ac.push(['assumir', 'Assumir conversa'])
    if (f.status === 'transferido') ac.push(['devolver_ia', 'Devolver para a assistente'])
    if (['convertido', 'encerrado', 'optout'].indexOf(f.status) < 0) ac.push(['encerrar', 'Encerrar'])
    var botoes = ac.map(function (a) { return '<button class="btn" data-ac="' + a[0] + '">' + a[1] + '</button>' }).join('') +
      '<button class="btn" id="fu-abrir-pac">Abrir paciente</button>'
    modal(f.paciente_nome || 'Conversa', corpo, botoes, 720)
    var chat = el('fu-chat'); if (chat) chat.scrollTop = chat.scrollHeight
    document.querySelectorAll('#fu-modal-ov [data-ac]').forEach(function (b) {
      b.onclick = async function () {
        var acao = b.getAttribute('data-ac')
        if (acao === 'encerrar' && !confirm('Encerrar o follow-up deste orçamento? Nenhuma mensagem automática será enviada.')) return
        var r = await apiPost('followup-acao', { id: f.id, acao: acao })
        if (!r.success) return alert(r.error || 'Erro')
        fecharModal(); carregar()
      }
    })
    el('fu-abrir-pac').onclick = function () { fecharModal(); if (f.paciente_id && typeof abrirProntuario === 'function') abrirProntuario('', f.paciente_id) }
    if (el('fu-enviar')) el('fu-enviar').onclick = async function () {
      var t = el('fu-txt').value.trim(); if (!t) return
      this.disabled = true
      var r = await apiPost('followup-responder', { id: f.id, texto: t })
      this.disabled = false
      if (!r.success) return alert(r.error || 'Erro')
      abrirConversa(f.id); carregar()
    }
  }

  function bolha(m) {
    var txt = String(m.texto || '').replace(/^\[TESTE → (\d+)\] /, function (_, n) { return '' })
    var teste = /^\[TESTE → /.test(m.texto || '')
    if (m.direcao === 'nota') return '<div class="fu-msg nota">' + esc(txt) + ' · ' + quando(m.criado_em) + '</div>'
    var st = ST_MSG[m.status] || ''
    var meta = esc(AUTOR[m.autor] || m.autor) + (m.etapa ? ' · mensagem ' + m.etapa + '/4' : '') + ' · ' + quando(m.criado_em) + (st && m.direcao === 'saida' ? ' · ' + st : '') + (teste ? ' · enviada ao telefone de teste' : '')
    return '<div class="fu-msg ' + m.direcao + '">' + esc(txt) + '<span class="fu-msg-meta' + (m.status === 'erro' ? ' err' : '') + '">' + meta + (m.erro ? ' — ' + esc(m.erro) : '') + '</span></div>'
  }

  async function rodarAgora() {
    if (!confirm('Rodar a régua agora? As mensagens que estão no dia serão enviadas' + (FU.dados.config.modo_teste ? ' (para o telefone de teste)' : ' aos pacientes') + '.')) return
    var b = el('fu-rodar'); b.disabled = true
    var r = await apiPost('followup-executar', {})
    b.disabled = false
    if (!r.success) return alert(r.error || 'Erro')
    var x = r.resultado
    alert((x.msg ? x.msg + '\n' : '') + x.inscritos + ' orçamento(s) entraram na régua · ' + x.enviados + ' mensagem(ns) enviada(s)' + (x.erros ? ' · ' + x.erros + ' erro(s): ' + (x.detalhes[0] && x.detalhes[0].erro) : '') + (x.convertidos ? ' · ' + x.convertidos + ' fecharam' : ''))
    carregar()
  }

  // ── Mensagens (prévia) ──────────────────────────────────────────
  async function renderMensagens() {
    el('fu-corpo').innerHTML = '<div class="crc-sk"></div>'
    var d
    try { d = await apiData('followup-previa', {}) } catch (e) { d = { success: false, error: e.message } }
    var tpls = FU.dados.templates
    var cab = '<div class="ag-hint" style="margin-bottom:16px">' + (d.success
      ? 'Prévia real com o orçamento #' + d.orcamento_id + ' de ' + esc(d.paciente) + ' (tratamento identificado: ' + esc(d.categoria_nome) + '). Cada paciente recebe o texto do próprio tratamento e as formas de pagamento da Configuração.'
      : 'Sem orçamento em aberto para gerar a prévia; abaixo, o texto-modelo de cada mensagem.') + '</div>'
    el('fu-corpo').innerHTML = cab + '<div class="fu-previas">' + tpls.map(function (t, i) {
      var m = d.success ? d.mensagens[i] : null
      return '<div class="fu-previa"><div class="fu-previa-h"><span>' + t.etapa + '. ' + esc(t.papel) + '</span><span>Dia ' + FU.dados.config.dias[i] + '</span></div>' +
        '<div class="fu-bolha">' + esc(m ? m.texto : t.corpo).replace(/\*([^*\n]+)\*/g, '<b>$1</b>') + '</div>' +
        '<div class="fu-botoes">' + t.botoes.map(function (b) { return '<span>' + esc(b) + '</span>' }).join('') + '</div>' +
        '<div class="fu-tpl">Template na Meta: <code>' + esc(t.nome) + '</code> · categoria Marketing · pt_BR</div></div>'
    }).join('') + '</div>'
  }

  // ── Configuração ────────────────────────────────────────────────
  function renderConfig() {
    var c = FU.dados.config, adm = FU.dados.admin, dis = adm ? '' : ' disabled'
    function f(id, label, val, tipo, extra) { return '<div class="ag-f"><label>' + label + '</label><input class="ag-in" id="fc-' + id + '" type="' + (tipo || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + dis + (extra || '') + '></div>' }
    function sw(id, label, on, dica) { return '<label class="fu-sw"><input type="checkbox" id="fc-' + id + '"' + (on ? ' checked' : '') + dis + '><span>' + label + (dica ? '<small>' + dica + '</small>' : '') + '</span></label>' }
    el('fu-corpo').innerHTML = (adm ? '' : '<div class="ag-hint" style="margin-bottom:16px">Somente o administrador altera estas configurações.</div>') +
      '<div class="fu-cfg">' +
      '<div class="pc-box"><div class="fu-cfg-h">Funcionamento</div>' +
        sw('ativo', 'Follow-up ligado', c.ativo, 'A régua roda todo dia por volta das 9h.') +
        sw('modo_teste', 'Modo teste', c.modo_teste, 'Tudo vai para o telefone abaixo (até 3 orçamentos por dia). Ao desligar, os registros de teste são apagados e os pacientes começam do zero.') +
        f('telefone_teste', 'Telefone de teste (com DDD)', c.telefone_teste, 'tel') +
        sw('ia_ativa', 'Assistente virtual responde as dúvidas', c.ia_ativa, 'Desligado: toda resposta do paciente vai direto para a equipe.') +
        f('email_alerta', 'E-mail para avisos de "precisa da equipe"', c.email_alerta, 'email', ' placeholder="padrão: e-mail da clínica"') +
        f('nome_equipe', 'Como a assistente chama quem atende', c.nome_equipe, 'text', ' placeholder="ex.: nossa secretária"') +
        f('telefone_atendimento', 'WhatsApp de quem atende (aparece para o paciente ao transferir)', c.telefone_atendimento, 'tel', ' placeholder="ex.: 67999915131"') +
      '</div>' +
      '<div class="pc-box"><div class="fu-cfg-h">Régua</div>' +
        '<div class="ag-hint" style="margin-bottom:12px">Dias depois do orçamento em que cada mensagem sai.</div>' +
        '<div class="fu-linha">' + c.dias.map(function (d, i) { return f('dia' + i, 'Mensagem ' + (i + 1), d, 'number', ' min="1" max="120"') }).join('') + '</div>' +
        '<div class="fu-linha">' + f('janela_dias', 'Incluir orçamentos de até (dias)', c.janela_dias, 'number') + f('valor_minimo', 'Valor mínimo (R$)', c.valor_minimo, 'number') + '</div>' +
        '<div class="fu-linha">' + f('limite_novos_dia', 'Novos orçamentos por dia', c.limite_novos_dia, 'number') + f('limite_envios_dia', 'Máximo de envios por dia', c.limite_envios_dia, 'number') + '</div>' +
        '<div class="fu-linha">' + f('pausa_apos_resposta_dias', 'Pausa após o paciente responder (dias)', c.pausa_apos_resposta_dias, 'number') + f('carencia_dias', 'Carência entre follow-ups do mesmo paciente (dias)', c.carencia_dias, 'number') + '</div>' +
        sw('pular_domingo', 'Não enviar aos domingos', c.pular_domingo) +
      '</div>' +
      '<div class="pc-box"><div class="fu-cfg-h">Pagamento e argumentos</div>' +
        '<div class="fu-linha">' + f('parcelas_cartao', 'Parcelas no cartão', c.parcelas_cartao, 'number', ' placeholder="ex.: 12"') + f('desconto_pix', 'Desconto no Pix (%)', c.desconto_pix, 'number', ' placeholder="ex.: 15"') + '</div>' +
        sw('sem_juros', 'Parcelamento sem juros', c.sem_juros, 'Ligado: as mensagens mostram o valor de cada parcela. Desligado: só "em até Nx".') +
        sw('klinik_club', 'Mencionar o parcelamento maior para assinantes do clube', c.klinik_club) +
        '<div class="fu-linha">' + f('nome_clube', 'Nome do clube', c.nome_clube) + f('parcelas_clube', 'Parcelas para assinantes', c.parcelas_clube, 'number', ' placeholder="ex.: 21"') + '</div>' +
        '<div class="ag-f"><label>Texto de pagamento personalizado (opcional, substitui o automático)</label><textarea class="ag-in" id="fc-texto_pagamento" rows="2"' + dis + '>' + esc(c.texto_pagamento) + '</textarea></div>' +
        f('prova_social', 'Prova social (mensagem 3)', c.prova_social, 'text', ' placeholder="ex.: mais de 2.500 pacientes já confiaram o sorriso deles a nós"') +
      '</div>' +
      '<div class="pc-box"><div class="fu-cfg-h">Templates aprovados na Meta</div>' +
        '<div class="ag-hint" style="margin-bottom:12px">Nome exato de cada template no WhatsApp Manager. O texto para cadastrar está na aba Mensagens.</div>' +
        ['m1', 'm2', 'm3', 'm4'].map(function (k, i) { return f('tpl_' + k, 'Mensagem ' + (i + 1), c.templates[k]) }).join('') +
      '</div></div>' +
      (adm ? '<div class="fu-salvar"><button class="fu-btn-cta" id="fc-salvar">Salvar configuração</button></div>' : '')
    if (!adm) return
    el('fc-salvar').onclick = async function () {
      function v(id) { return el('fc-' + id).value }
      function ck(id) { return el('fc-' + id).checked }
      var body = {
        ativo: ck('ativo'), modo_teste: ck('modo_teste'), telefone_teste: v('telefone_teste'), ia_ativa: ck('ia_ativa'), email_alerta: v('email_alerta'), nome_equipe: v('nome_equipe'),
        dias: [0, 1, 2, 3].map(function (i) { return v('dia' + i) }), janela_dias: v('janela_dias'), valor_minimo: v('valor_minimo'),
        limite_novos_dia: v('limite_novos_dia'), limite_envios_dia: v('limite_envios_dia'), pausa_apos_resposta_dias: v('pausa_apos_resposta_dias'), carencia_dias: v('carencia_dias'), pular_domingo: ck('pular_domingo'),
        parcelas_cartao: v('parcelas_cartao'), desconto_pix: v('desconto_pix'), klinik_club: ck('klinik_club'), nome_clube: v('nome_clube'), sem_juros: ck('sem_juros'), parcelas_clube: v('parcelas_clube'), telefone_atendimento: v('telefone_atendimento'),
        texto_pagamento: v('texto_pagamento'), prova_social: v('prova_social'),
        templates: { m1: v('tpl_m1'), m2: v('tpl_m2'), m3: v('tpl_m3'), m4: v('tpl_m4') }
      }
      if (FU.dados.config.modo_teste && !body.modo_teste && body.ativo && !confirm('Sair do modo teste vai começar a enviar mensagens para os PACIENTES a partir da próxima execução. Confirma?')) return
      this.disabled = true
      var r = await apiPost('followup-config', body)
      this.disabled = false
      if (!r.success) return alert(r.error || 'Erro')
      alert('Configuração salva.' + (r.testes_removidos ? ' ' + r.testes_removidos + ' registro(s) de teste apagado(s).' : ''))
      carregar()
    }
  }

  window.abrirFollowup = abrir
})()
