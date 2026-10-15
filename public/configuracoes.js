// public/configuracoes.js — Configurações (Fase 8)
// Klinov — Campo Grande, MS
//
// Substitui a tela de Configurações do app.html (renderConfiguracoes) por menu
// lateral com grupos e busca. Também: tema e inatividade da clínica aplicados ao
// entrar, segunda etapa do login (código por e-mail), edição de usuário e
// permissões por usuário, inativar/excluir profissional e exportação com senha.
;(function () {
  'use strict'

  var TEMAS = { verde: ['Verde Klinov', '#034030'], azul: ['Azul', '#1565C0'], petroleo: ['Petróleo', '#00695C'], grafite: ['Grafite', '#424242'] }
  var PERFIL_NOME = { admin: 'Administrador', dentista: 'Dentista', recepcionista: 'Recepcionista', asb: 'ASB', administrativo: 'Administrativo' }
  var CF = { secao: 'clinica-dados', busca: '', dados: null }

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function isAdmin() { return (KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }
  function v(id) { var e = el(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : undefined }
  function msg(txt, ok) { var m = el('cf-msg'); if (m) { m.className = ok ? 'cf-ok' : 'ag-err'; m.textContent = txt; if (ok) setTimeout(function () { if (m.textContent === txt) { m.textContent = ''; m.className = '' } }, 3000) } }
  function campo(id, rot, val, extra) { return '<div class="ag-f"><label>' + rot + '</label><input class="ag-in" id="' + id + '" value="' + esc(val || '') + '"' + (extra || '') + '></div>' }
  function chk(id, rot, on, hint) { return '<label class="ag-chk cf-chk"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '> <span>' + rot + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>' }
  async function salvar(secao, dados) {
    var r = await apiPost('clinica-config', { secao: secao, dados: dados })
    if (!r.success) { msg(r.error || 'Erro ao salvar'); return r }
    CF.dados = null; msg('Salvo.', true); aplicarClinica()
    return r
  }

  // ════════════════════════════════════════════════════════════════
  // MENU
  // ════════════════════════════════════════════════════════════════
  var GRUPOS = [
    ['Clínica', [['clinica-dados', 'Dados da clínica', 'Nome, CNPJ, contato, endereço, responsável técnico e logo', true], ['clinica-cobranca', 'Cobrança e Asaas', 'PIX, conta para recebimento e chave da API do Asaas', true], ['clinica-tema', 'Personalização', 'Cor da barra superior e título do sistema', true]]],
    ['Agenda', [['agenda-horarios', 'Horários e categorias', 'Horário de funcionamento, agenda dos profissionais e categorias'], ['agenda-mensagens', 'Confirmações e lembretes', 'Envio automático e textos das mensagens', true], ['agenda-checkin', 'Check-in por QR Code', 'Cartaz para a recepção e chegadas do dia'], ['agenda-bloqueios', 'Bloqueios', 'O que fazer ao agendar paciente com parcelas vencidas', true]]],
    ['Prontuário', [['pront-documentos', 'Modelos de documento', 'Atestados, receituários, contratos e termos'], ['pront-anamnese', 'Questionário de anamnese', 'Perguntas, ordem e alertas; o paciente também responde por link', true], ['pront-medicamentos', 'Medicamentos', 'Lista usada no receituário, com posologia']]],
    ['Orçamentos', [['orc-tabelas', 'Tabelas de preço', 'Particular, convênios e planos próprios'], ['orc-especialidades', 'Especialidades', 'Lista usada no cadastro de profissionais e procedimentos'], ['orc-regras', 'Regras de orçamento', 'Desconto máximo por perfil', true]]],
    ['Financeiro', [['fin-contas', 'Contas bancárias', 'Caixa e contas usadas nos lançamentos e conciliação'], ['fin-taxas', 'Taxas e encargos', 'Taxas da maquininha, multa, juros e desconto'], ['fin-regua', 'Régua de cobrança', 'Lembretes automáticos de pagamento'], ['fin-recibos', 'Recibos', 'Numeração sequencial dos recibos', true]]],
    ['Equipe', [['eq-usuarios', 'Usuários e permissões', 'Acessos, perfis e exceções por usuário'], ['eq-profissionais', 'Profissionais', 'Cadastro, agenda de trabalho e comissões']]],
    ['Segurança', [['seg-acesso', 'Segurança e acesso', 'Login em duas etapas, duração da sessão e exportação', true], ['seg-auditoria', 'Auditoria', 'Quem fez o quê: acessos, exportações e alterações', true]]],
    ['Dados', [['dados-exportar', 'Exportar dados', 'Planilhas de pacientes, agenda, financeiro e mais', true], ['dados-lixeira', 'Administração de dados', 'Registros excluídos e restauração', true]]]
  ]
  function itensVisiveis() {
    var b = String(CF.busca || '').toLowerCase()
    return GRUPOS.map(function (g) {
      return [g[0], g[1].filter(function (i) { return (!i[3] || isAdmin()) && (!b || (g[0] + ' ' + i[1] + ' ' + i[2]).toLowerCase().indexOf(b) >= 0) })]
    }).filter(function (g) { return g[1].length })
  }

  function renderConfiguracoes() {
    var pg = el('p-configuracoes'); if (!pg) return
    var p = (location.hash || '').replace(/^#\/?/, '').split('/')
    if (p[0] === 'configuracoes' && p[1]) CF.secao = p[1]
    var vis = itensVisiveis(), todos = [].concat.apply([], vis.map(function (g) { return g[1] }))
    if (!todos.some(function (i) { return i[0] === CF.secao }) && todos.length && !CF.busca) CF.secao = todos[0][0]
    pg.innerHTML = '<div class="cf-wrap"><aside class="cf-menu"><input class="ag-in" id="cf-busca" placeholder="Buscar configurações" value="' + esc(CF.busca) + '">' +
      vis.map(function (g) { return '<div class="cf-grupo">' + esc(g[0]) + '</div>' + g[1].map(function (i) { return '<a class="cf-item' + (i[0] === CF.secao ? ' on' : '') + '" data-sec="' + i[0] + '">' + esc(i[1]) + '</a>' }).join('') }).join('') +
      (vis.length ? '' : '<div class="ag-hint" style="padding:8px">Nada encontrado.</div>') + '</aside><section class="cf-main" id="cf-main"></section></div>'
    var bi = el('cf-busca')
    bi.oninput = function () { CF.busca = this.value; var pos = this.selectionStart; renderConfiguracoes(); var n = el('cf-busca'); n.focus(); n.setSelectionRange(pos, pos) }
    pg.querySelectorAll('[data-sec]').forEach(function (a) { a.onclick = function () { CF.secao = this.getAttribute('data-sec'); if (typeof setRouteHash === 'function') setRouteHash('configuracoes/' + CF.secao); renderConfiguracoes() } })
    var item = todos.filter(function (i) { return i[0] === CF.secao })[0]
    if (!item) { el('cf-main').innerHTML = ''; return }
    var grupo = vis.filter(function (g) { return g[1].indexOf(item) >= 0 })[0][0]
    el('cf-main').innerHTML = '<div class="cf-bread">' + esc(grupo) + ' › ' + esc(item[1]) + '</div><div class="gpage-title">' + esc(item[1]) + '</div><div class="gpage-sub" style="margin-bottom:20px">' + esc(item[2]) + '</div><div id="cf-msg"></div><div id="cf-body"><div class="fn-sk"></div></div>'
    var fn = SECOES[CF.secao]
    if (fn) fn(el('cf-body'))
  }

  async function dados() {
    if (!CF.dados) { var d = await apiData('clinica-config', {}); if (!d.success) throw new Error(d.error || 'Erro'); CF.dados = d }
    return CF.dados
  }
  function falha(box, e) { box.innerHTML = '<div class="ag-err">' + esc(e.message || e) + '</div>' }

  // ════════════════════════════════════════════════════════════════
  // SEÇÕES
  // ════════════════════════════════════════════════════════════════
  var SECOES = {}
  SECOES['clinica-dados'] = async function (box) {
    var d; try { d = (await dados()).dados } catch (e) { return falha(box, e) }
    box.innerHTML = '<div class="pc-box"><div class="pc-box-h">Dados cadastrais</div>' +
      '<div class="ag-row c2">' + campo('cd-nome', 'Nome da clínica', d.nome, ' maxlength="120"') + campo('cd-razao', 'Razão social', d.razao_social, ' maxlength="120"') + '</div>' +
      '<div class="ag-row c3">' + campo('cd-cnpj', 'CNPJ', d.cnpj, ' maxlength="20"') + campo('cd-tel', 'Telefone', d.telefone, ' maxlength="20"') + campo('cd-email', 'E-mail', d.email, ' maxlength="120" type="email"') + '</div>' +
      '<div class="ag-row c4">' + campo('cd-cep', 'CEP', d.cep, ' maxlength="9"') + campo('cd-end', 'Endereço', d.endereco) + campo('cd-num', 'Número', d.numero, ' maxlength="10"') + campo('cd-comp', 'Complemento', d.complemento) + '</div>' +
      '<div class="ag-row c3">' + campo('cd-bairro', 'Bairro', d.bairro) + campo('cd-cidade', 'Cidade', d.cidade) + campo('cd-uf', 'UF', d.estado, ' maxlength="2"') + '</div>' +
      '<div class="ag-row c2">' + campo('cd-foro', 'Foro dos contratos', d.foro, ' placeholder="Ex.: Comarca de Campo Grande/MS"') + '<div></div></div>' +
      '<div class="pc-box-h" style="margin-top:16px">Responsável técnico</div><div class="ag-row c2">' + campo('cd-rt', 'Nome', d.resp_tecnico_nome) + campo('cd-cro', 'CRO', d.resp_tecnico_cro, ' placeholder="CRO-MS 0000"') + '</div>' +
      '<div style="text-align:right"><button class="ag-btn-novo" id="cd-ok">Salvar dados</button></div></div>' +
      '<div class="pc-box" style="margin-top:16px"><div class="pc-box-h">Logo</div><div class="cf-logo">' + (d.logo ? '<img src="' + esc(d.logo) + '" alt="Logo da clínica">' : '<div class="ag-hint" style="margin:0">Sem logo. Ela aparece no cabeçalho dos documentos e orçamentos impressos.</div>') + '</div>' +
      '<div class="fn-acoes"><input type="file" id="cd-logo" accept="image/png,image/jpeg,image/webp" style="display:none"><button class="btn" id="cd-logo-b">Escolher imagem</button>' + (d.logo ? '<button class="btn" id="cd-logo-rm" style="color:var(--red)">Remover</button>' : '') + '<span class="ag-hint" style="margin:0">PNG, JPG ou WEBP até 300 KB.</span></div></div>'
    el('cd-ok').onclick = function () {
      salvar('dados', { nome: v('cd-nome'), razao_social: v('cd-razao'), cnpj: v('cd-cnpj'), documento_tipo: v('cd-cnpj') ? 'cnpj' : '', documento_numero: v('cd-cnpj'), telefone: v('cd-tel'), email: v('cd-email'), cep: v('cd-cep'), endereco: v('cd-end'), numero: v('cd-num'), complemento: v('cd-comp'), bairro: v('cd-bairro'), cidade: v('cd-cidade'), estado: String(v('cd-uf') || '').toUpperCase(), foro: v('cd-foro'), resp_tecnico_nome: v('cd-rt'), resp_tecnico_cro: v('cd-cro') })
    }
    el('cd-cep').onblur = async function () {
      var c = String(this.value).replace(/\D/g, ''); if (c.length !== 8) return
      try { var r = await (await fetch('https://viacep.com.br/ws/' + c + '/json/')).json(); if (!r.erro) { if (!v('cd-end')) el('cd-end').value = r.logradouro || ''; if (!v('cd-bairro')) el('cd-bairro').value = r.bairro || ''; el('cd-cidade').value = r.localidade || ''; el('cd-uf').value = r.uf || '' } } catch (e) {}
    }
    el('cd-logo-b').onclick = function () { el('cd-logo').click() }
    el('cd-logo').onchange = function () {
      var f = this.files[0]; if (!f) return
      if (f.size > 300 * 1024) return msg('Imagem muito grande (máximo 300 KB).')
      var fr = new FileReader()
      fr.onload = async function () { var r = await salvar('logo', { logo: fr.result }); if (r.success) SECOES['clinica-dados'](box) }
      fr.readAsDataURL(f)
    }
    if (el('cd-logo-rm')) el('cd-logo-rm').onclick = async function () { var r = await salvar('logo', { logo: '' }); if (r.success) SECOES['clinica-dados'](box) }
  }
  SECOES['clinica-cobranca'] = async function (box) {
    var d; try { d = (await dados()).dados } catch (e) { return falha(box, e) }
    box.innerHTML = '<div class="pc-box"><div class="pc-box-h">PIX e conta para recebimento</div><div class="ag-row c2"><div class="ag-f"><label>Tipo de chave PIX</label><select class="ag-in" id="cb-pixt">' + [['', '—'], ['cnpj', 'CNPJ'], ['cpf', 'CPF'], ['email', 'E-mail'], ['telefone', 'Telefone'], ['aleatoria', 'Aleatória']].map(function (o) { return '<option value="' + o[0] + '"' + (d.pix_tipo === o[0] ? ' selected' : '') + '>' + o[1] + '</option>' }).join('') + '</select></div>' + campo('cb-pix', 'Chave PIX', d.pix_chave) + '</div>' +
      '<div class="ag-row c3">' + campo('cb-banco', 'Banco', d.banco_nome) + campo('cb-ag', 'Agência', d.banco_agencia) + campo('cb-conta', 'Conta', d.banco_conta) + '</div>' +
      '<div class="pc-box-h" style="margin-top:16px">Asaas</div><div class="ag-f"><label>Chave da API ' + (d.asaas_configurado ? '<span class="pc-badge ok">Configurada</span>' : '<span class="pc-badge off">Não configurada</span>') + '</label><input class="ag-in" id="cb-asaas" type="password" autocomplete="new-password" placeholder="' + (d.asaas_configurado ? 'Deixe em branco para manter a atual' : 'Cole aqui a chave ($aact_...)') + '"></div>' +
      '<div style="text-align:right"><button class="ag-btn-novo" id="cb-ok">Salvar</button></div></div>'
    el('cb-ok').onclick = function () { salvar('cobranca', { pix_tipo: v('cb-pixt'), pix_chave: v('cb-pix'), banco_nome: v('cb-banco'), banco_agencia: v('cb-ag'), banco_conta: v('cb-conta'), asaas_api_key: v('cb-asaas') }) }
  }
  SECOES['clinica-tema'] = async function (box) {
    var d; try { d = await dados() } catch (e) { return falha(box, e) }
    var t = d.cfg.tema
    box.innerHTML = '<div class="pc-box"><div class="pc-box-h">Cor da barra superior</div><div class="cf-temas">' + Object.keys(TEMAS).map(function (k) { return '<label class="cf-tema' + (t.cor === k ? ' on' : '') + '"><input type="radio" name="cf-cor" value="' + k + '"' + (t.cor === k ? ' checked' : '') + '><i style="background:' + TEMAS[k][1] + '"></i>' + TEMAS[k][0] + '</label>' }).join('') + '</div>' +
      '<div class="ag-row c2" style="margin-top:16px">' + campo('tm-tit', 'Título na aba do navegador', t.titulo, ' maxlength="40" placeholder="Klinov"') + '<div></div></div>' +
      '<div style="text-align:right"><button class="ag-btn-novo" id="tm-ok">Salvar</button></div></div>'
    box.querySelectorAll('input[name=cf-cor]').forEach(function (r) { r.onchange = function () { box.querySelectorAll('.cf-tema').forEach(function (l) { l.classList.toggle('on', l.contains(r) && r.checked) }); aplicarTema({ cor: r.value }) } })
    el('tm-ok').onclick = function () { var c = box.querySelector('input[name=cf-cor]:checked'); salvar('tema', { cor: c ? c.value : 'verde', titulo: v('tm-tit') }) }
  }
  SECOES['agenda-horarios'] = function (box) {
    box.innerHTML = '<div class="pc-box"><div class="fn-acoes"><button class="ag-btn-novo" onclick="abrirHorariosAgenda()">Horários de atendimento</button><button class="btn" onclick="abrirCategoriasAgenda()">Categorias de agendamento</button></div><p class="ag-hint">Os horários definem a área disponível da agenda e a ocupação no dashboard. A agenda de cada profissional fica na ficha dele (Equipe › Profissionais).</p></div>'
  }
  SECOES['agenda-mensagens'] = async function (box) {
    var d, m; try { d = await dados(); m = await apiData('mensagens-modelos', {}) } catch (e) { return falha(box, e) }
    var x = d.dados, ag = d.cfg.agenda
    box.innerHTML = '<div class="pc-box"><div class="pc-box-h">Envio automático</div>' +
      chk('am-cwa', 'Confirmação de consulta por WhatsApp', x.cfg_confirmacao_wa, 'Usa o modelo de mensagem aprovado na Meta') + chk('am-cem', 'Confirmação de consulta por e-mail', x.cfg_confirmacao_email) +
      chk('am-aniv', 'Parabéns no aniversário (e-mail)', x.cfg_aniversario, 'Enviado de manhã para pacientes ativos com e-mail') + chk('am-ret', 'Lembrete de retorno (e-mail)', x.cfg_lembrete_retorno, 'Enviado 7 dias antes do retorno previsto') +
      '<div class="ag-row c2" style="margin-top:12px"><div class="ag-f"><label>Confirmação padrão em novos agendamentos</label><select class="ag-in" id="am-quando">' + [['mesmo_dia', 'No dia da consulta'], ['1_dia', '1 dia antes'], ['2_dias', '2 dias antes'], ['nao', 'Não enviar']].map(function (o) { return '<option value="' + o[0] + '"' + (ag.confirmacao_padrao === o[0] ? ' selected' : '') + '>' + o[1] + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label>Canal padrão</label><select class="ag-in" id="am-canal">' + [['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['ambos', 'WhatsApp e e-mail']].map(function (o) { return '<option value="' + o[0] + '"' + (ag.canal_padrao === o[0] ? ' selected' : '') + '>' + o[1] + '</option>' }).join('') + '</select></div></div>' +
      '<div style="text-align:right"><button class="ag-btn-novo" id="am-ok">Salvar</button></div></div>' +
      '<div class="pc-box" style="margin-top:16px"><div class="pc-box-h">Textos das mensagens</div><p class="ag-hint" style="margin-top:0">Campos: ' + m.variaveis.map(function (k) { return '{{' + k + '}}' }).join(' · ') + '</p>' +
      m.data.map(function (t) { return '<div class="cf-modelo"><b>' + esc(t.nome) + '</b>' + campo('mm-a-' + t.tipo, 'Assunto do e-mail', t.assunto) + '<div class="ag-f"><label>Mensagem</label><textarea class="ag-in" id="mm-c-' + t.tipo + '" rows="3" maxlength="2000">' + esc(t.corpo) + '</textarea></div><div style="text-align:right"><button class="btn btn-sm" data-mm="' + t.tipo + '">Salvar texto</button></div></div>' }).join('') + '</div>'
    el('am-ok').onclick = function () { salvar('comunicacao', { cfg_confirmacao_wa: v('am-cwa'), cfg_confirmacao_email: v('am-cem'), cfg_aniversario: v('am-aniv'), cfg_lembrete_retorno: v('am-ret'), confirmacao_padrao: v('am-quando'), canal_padrao: v('am-canal') }) }
    box.querySelectorAll('[data-mm]').forEach(function (b) { b.onclick = async function () { var t = this.getAttribute('data-mm'); var r = await apiPost('mensagens-modelos', { tipo: t, assunto: v('mm-a-' + t), corpo: v('mm-c-' + t) }); msg(r.success ? 'Texto salvo.' : r.error, r.success) } })
  }
  SECOES['agenda-bloqueios'] = async function (box) {
    var d; try { d = await dados() } catch (e) { return falha(box, e) }
    var bq = d.cfg.bloqueios
    var ops = [['nao', 'Não bloquear', 'Agenda normalmente.'], ['avisar', 'Avisar e pedir confirmação', 'Mostra o valor vencido e pergunta se quer agendar mesmo assim.'], ['admin', 'Exigir administrador', 'Só um administrador consegue agendar (com confirmação).'], ['bloquear', 'Bloquear', 'Ninguém agenda até o paciente regularizar.']]
    box.innerHTML = '<div class="pc-box"><div class="pc-box-h">Paciente com parcelas vencidas (inadimplência)</div>' + ops.map(function (o) { return '<label class="cf-op' + (bq.inadimplencia === o[0] ? ' on' : '') + '"><input type="radio" name="bq" value="' + o[0] + '"' + (bq.inadimplencia === o[0] ? ' checked' : '') + '><span><b>' + o[1] + '</b><small>' + o[2] + '</small></span></label>' }).join('') +
      '<div class="ag-row c2" style="margin-top:12px"><div class="ag-f"><label>Tolerância (dias após o vencimento)</label><input class="ag-in" type="number" min="0" max="90" id="bq-tol" value="' + (bq.dias_tolerancia || 0) + '"></div><div></div></div>' +
      '<p class="ag-hint">Vale para novos agendamentos. Reagendar ou mudar a situação de uma consulta já marcada não é afetado.</p><div style="text-align:right"><button class="ag-btn-novo" id="bq-ok">Salvar</button></div></div>'
    box.querySelectorAll('input[name=bq]').forEach(function (r) { r.onchange = function () { box.querySelectorAll('.cf-op').forEach(function (l) { l.classList.toggle('on', l.contains(r)) }) } })
    el('bq-ok').onclick = function () { var c = box.querySelector('input[name=bq]:checked'); salvar('bloqueios', { inadimplencia: c ? c.value : 'nao', dias_tolerancia: v('bq-tol') }) }
  }
  SECOES['pront-documentos'] = function (box) { box.innerHTML = '<div class="pc-box"><p class="ag-hint" style="margin-top:0">Os campos {{paciente.nome}}, {{profissional.nome}}, {{clinica.nome}}, {{clinica.telefone}} etc. são preenchidos ao emitir o documento na ficha do paciente.</p><button class="ag-btn-novo" onclick="abrirModelosDocumento()">Editar modelos</button></div>' }
  SECOES['pront-anamnese'] = function (box) { window.cfgAnamnese(box) }
  SECOES['pront-medicamentos'] = function (box) { window.cfgMedicamentos(box) }
  SECOES['agenda-checkin'] = function (box) { window.cfgCheckin(box) }
  SECOES['orc-tabelas'] = function (box) { box.innerHTML = '<div class="pc-box"><p class="ag-hint" style="margin-top:0">Procedimentos, códigos TUSS, valores, importação por planilha e reajuste anual.</p><button class="ag-btn-novo" onclick="abrirTabelasPreco()">Gerenciar tabelas de preço</button></div>' }
  SECOES['orc-especialidades'] = async function (box) {
    var d; try { d = await apiData('especialidades', {}) } catch (e) { return falha(box, e) }
    var edita = pode('configuracoes.editar')
    box.innerHTML = '<div class="pc-box">' + (edita ? '<div class="fn-acoes" style="margin-bottom:12px"><input class="ag-in" id="es-nova" placeholder="Nova especialidade" maxlength="60" style="max-width:320px"><button class="ag-btn-novo" id="es-add">Adicionar</button></div>' : '') +
      '<div class="cf-chips">' + d.data.map(function (e) { return '<span class="cf-chip">' + esc(e.nome) + (edita ? ' <a data-rm="' + e.id + '" title="Remover">✕</a>' : '') + '</span>' }).join('') + '</div></div>'
    if (el('es-add')) el('es-add').onclick = async function () { var r = await apiPost('especialidades', { nome: v('es-nova') }); if (!r.success) return msg(r.error); SECOES['orc-especialidades'](box) }
    box.querySelectorAll('[data-rm]').forEach(function (a) { a.onclick = async function () { await apiPost('especialidades', { action: 'excluir', id: +this.getAttribute('data-rm') }); SECOES['orc-especialidades'](box) } })
  }
  SECOES['orc-regras'] = async function (box) {
    var d; try { d = await dados() } catch (e) { return falha(box, e) }
    var lim = d.cfg.orcamento.desconto_max
    box.innerHTML = '<div class="pc-box"><div class="pc-box-h">Desconto máximo por perfil</div><p class="ag-hint" style="margin-top:0">Percentual sobre o valor particular do orçamento. Em branco = sem limite. O administrador nunca tem limite.</p>' +
      '<div class="ag-row c4">' + ['dentista', 'recepcionista', 'administrativo', 'asb'].map(function (p) { return '<div class="ag-f"><label>' + PERFIL_NOME[p] + ' (%)</label><input class="ag-in" id="or-' + p + '" inputmode="decimal" value="' + (lim[p] != null ? String(lim[p]).replace('.', ',') : '') + '"></div>' }).join('') + '</div>' +
      '<div style="text-align:right"><button class="ag-btn-novo" id="or-ok">Salvar</button></div></div>'
    el('or-ok').onclick = function () { var dm = {}; ['dentista', 'recepcionista', 'administrativo', 'asb'].forEach(function (p) { var x = String(v('or-' + p) || '').trim(); if (x !== '') dm[p] = x.replace(',', '.') }); salvar('orcamento', { desconto_max: dm }) }
  }
  SECOES['fin-contas'] = function (box) { box.innerHTML = '<div class="pc-box"><button class="ag-btn-novo" id="fc-b">Gerenciar contas bancárias</button></div>'; el('fc-b').onclick = function () { window.KFIN && KFIN.gerenciarContas() } }
  SECOES['fin-taxas'] = function (box) { box.innerHTML = '<div class="pc-box"><button class="ag-btn-novo" onclick="abrirTaxasFinanceiro()">Configurar taxas e encargos</button></div>' }
  SECOES['fin-regua'] = function (box) { box.innerHTML = '<div class="pc-box"><button class="ag-btn-novo" onclick="abrirReguaCobranca()">Configurar régua de cobrança</button></div>' }
  SECOES['fin-recibos'] = async function (box) {
    var d; try { d = await dados() } catch (e) { return falha(box, e) }
    box.innerHTML = '<div class="pc-box"><div class="ag-row c2"><div class="ag-f"><label>Próximo número de recibo</label><input class="ag-in" type="number" min="1" id="rc-prox" value="' + (d.cfg.recibos.proximo || 1) + '"></div><div></div></div><p class="ag-hint">Usado quando um recibo (Receita Saúde) é emitido sem número. Para continuar a numeração de outro sistema, informe o próximo número dele.</p><div style="text-align:right"><button class="ag-btn-novo" id="rc-ok">Salvar</button></div></div>'
    el('rc-ok').onclick = function () { salvar('recibos', { proximo: v('rc-prox') }) }
  }
  SECOES['eq-usuarios'] = function (box) { box.innerHTML = '<div class="pc-box"><p class="ag-hint" style="margin-top:0">Criar e editar usuários, perfis e exceções de permissão por pessoa.</p><button class="ag-btn-novo" onclick="nav(\'usuarios\')">Abrir usuários e permissões</button></div>' }
  SECOES['eq-profissionais'] = function (box) { box.innerHTML = '<div class="pc-box"><button class="ag-btn-novo" onclick="nav(\'profissionais\')">Abrir profissionais</button></div>' }
  SECOES['seg-acesso'] = async function (box) {
    var d; try { d = await dados() } catch (e) { return falha(box, e) }
    var s = d.cfg.seguranca
    box.innerHTML = '<div class="pc-box">' + chk('sg-2fa', 'Login em duas etapas', s.dois_fatores, 'Depois da senha, o usuário digita um código de 6 dígitos enviado ao e-mail pessoal dele.') +
      chk('sg-exp', 'Pedir a senha para exportar dados', s.senha_exportar, 'Vale para Configurações › Exportar dados.') +
      '<div class="ag-row c2" style="margin-top:12px"><div class="ag-f"><label>Duração máxima da sessão (horas)</label><input class="ag-in" type="number" min="1" max="24" id="sg-h" value="' + s.sessao_horas + '"></div><div class="ag-f"><label>Sair após inatividade (minutos)</label><input class="ag-in" type="number" min="5" max="240" id="sg-i" value="' + s.inatividade_min + '"></div></div>' +
      '<div style="text-align:right"><button class="ag-btn-novo" id="sg-ok">Salvar</button></div></div>'
    el('sg-ok').onclick = async function () {
      var dd = { dois_fatores: v('sg-2fa'), senha_exportar: v('sg-exp'), sessao_horas: v('sg-h'), inatividade_min: v('sg-i') }
      var r = await apiPost('clinica-config', { secao: 'seguranca', dados: dd })
      if (!r.success && r.sem_email) { if (!confirm(r.error)) return; r = await apiPost('clinica-config', { secao: 'seguranca', dados: Object.assign(dd, { confirmar: true }) }) }
      if (!r.success) return msg(r.error || 'Erro')
      CF.dados = null; msg('Salvo. A duração da sessão vale a partir do próximo login.', true); aplicarClinica()
    }
  }
  var ACAO_NOME = { 'login': 'Entrou', 'login.2fa': 'Entrou (com código)', 'login.falha': 'Senha incorreta', 'login.codigo_errado': 'Código incorreto', 'logout': 'Saiu', 'dados.exportar': 'Exportou dados', 'permissoes.usuario': 'Alterou permissões de usuário',
    'usuario.criar': 'Criou usuário', 'usuario.editar': 'Editou usuário', 'usuario.senha': 'Alterou senha', 'usuario.inativar': 'Inativou usuário', 'usuario.reativar': 'Reativou usuário', 'usuario.excluir': 'Excluiu usuário',
    'config.dados_clinica': 'Alterou dados da clínica', 'config.cobranca': 'Alterou cobrança', 'config.seguranca': 'Alterou segurança', 'config.bloqueios': 'Alterou bloqueios', 'profissional.inativar': 'Inativou profissional', 'profissional.reativar': 'Reativou profissional' }
  SECOES['seg-auditoria'] = async function (box) {
    var hoje = new Date(), de = new Date(hoje.getTime() - 30 * 86400000)
    function ymd(x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') }
    box.innerHTML = '<div class="fn-filtros"><div class="ag-f"><label>De</label><input class="ag-in" type="date" id="au-de" value="' + ymd(de) + '"></div><div class="ag-f"><label>Até</label><input class="ag-in" type="date" id="au-ate" value="' + ymd(hoje) + '"></div>' +
      '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="au-ac"><option value="">Tudo</option><option value="login">Acessos</option><option value="dados">Exportações</option><option value="usuario">Usuários</option><option value="permissoes">Permissões</option><option value="config">Configurações</option></select></div><div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" id="au-ok">Listar</button></div></div><div id="au-res"></div>'
    async function listar() {
      var r = await apiData('auditoria', { de: v('au-de'), ate: v('au-ate'), acao: v('au-ac') }).catch(function (e) { return { success: false, error: e.message } })
      var res = el('au-res'); if (!res) return
      if (!r.success) return falha(res, r.error)
      res.innerHTML = r.data.length ? '<div class="pc-box" style="padding:0"><div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th class="hide-sm">Detalhe</th><th class="hide-sm">IP</th></tr></thead><tbody>' +
        r.data.map(function (x) { return '<tr><td>' + esc(String(x.criado_em || '').slice(0, 16).split(' ').map(function (p, i) { return i === 0 ? p.split('-').reverse().join('/') : p }).join(' ')) + '</td><td>' + esc(x.usuario_nome || '—') + '</td><td>' + (/falha|errado/.test(x.acao) ? '<span class="pc-badge err">' + esc(ACAO_NOME[x.acao] || x.acao) + '</span>' : esc(ACAO_NOME[x.acao] || x.acao)) + '</td><td class="hide-sm">' + esc(x.detalhe || '') + '</td><td class="hide-sm">' + esc(x.ip || '') + '</td></tr>' }).join('') + '</tbody></table></div></div>'
        : '<div class="pc-vazio" style="padding:32px 0">Nada registrado no período.</div>'
    }
    el('au-ok').onclick = listar; listar()
  }
  SECOES['dados-exportar'] = function (box) {
    var tipos = [['pacientes', 'Pacientes'], ['agendamentos', 'Agendamentos'], ['orcamentos', 'Orçamentos'], ['financeiro', 'Recibos (financeiro antigo)'], ['pagamentos', 'Pagamentos (Clinicorp)'], ['profissionais', 'Profissionais'], ['procedimentos', 'Procedimentos']]
    box.innerHTML = '<div class="pc-box"><p class="ag-hint" style="margin-top:0">Planilha CSV (abre no Excel). Toda exportação fica registrada na auditoria.</p><div class="cf-chips">' + tipos.map(function (t) { return '<button class="btn" data-exp="' + t[0] + '">' + t[1] + '</button>' }).join('') + '</div></div>'
    box.querySelectorAll('[data-exp]').forEach(function (b) { b.onclick = function () { exportarDados(this.getAttribute('data-exp')) } })
  }
  SECOES['dados-lixeira'] = function (box) {
    box.innerHTML = '<div class="pc-box"><div class="fn-filtros"><div class="ag-f"><label>Tipo</label><select class="ag-in" id="lx-tipo"><option value="">Todos</option></select></div><div class="ag-f fn-f-btn"><label>&nbsp;</label><button class="btn btn-primary" onclick="loadLixeira()">Listar</button></div></div><div id="lx-lista" class="ag-hint">Carregando…</div></div>'
    if (typeof loadLixeira === 'function') loadLixeira()
  }

  // ════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO (com senha quando a clínica exige)
  // ════════════════════════════════════════════════════════════════
  async function exportarDados(tipo, senha) {
    var r = await fetch('/api/data?r=exportar-dados', { method: 'POST', headers: _apiHeaders(), body: JSON.stringify({ tipo: tipo, senha: senha || undefined }) })
    if (r.status === 401) { forceLogout(); return }
    var d = await r.json().catch(function () { return {} })
    if (d.precisa_senha) { var s = prompt((senha ? 'Senha incorreta. ' : '') + 'Confirme sua senha para exportar:'); if (s) return exportarDados(tipo, s); return }
    if (!d.success) return alert(d.error || 'Erro ao exportar')
    if (!d.data || !d.data.length) return alert('Nenhum dado para exportar.')
    var cols = Object.keys(d.data[0])
    var csv = '﻿' + [cols].concat(d.data.map(function (row) { return cols.map(function (c) { return row[c] == null ? '' : row[c] }) })).map(function (l) { return l.map(function (x) { x = String(x); return /[;"\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x }).join(';') }).join('\r\n')
    var a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'klinov-' + tipo + '-' + new Date().toISOString().slice(0, 10) + '.csv'
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }

  // ════════════════════════════════════════════════════════════════
  // TEMA E LIMITES DA CLÍNICA (aplicados ao entrar)
  // ════════════════════════════════════════════════════════════════
  function aplicarTema(t) {
    var tb = el('topbar'); if (tb) tb.style.background = (TEMAS[t && t.cor] || TEMAS.verde)[1]
    if (t && t.titulo !== undefined) document.title = t.titulo || 'Klinov'
  }
  async function aplicarClinica() {
    if (!localStorage.getItem('klinov_token')) return
    try {
      var d = await apiData('clinica-publico', {})
      if (!d.success) return
      ST.clinica = Object.assign(ST.clinica || {}, { nome: d.nome, logo: d.logo })
      ST.descontoMax = d.desconto_max
      window.KLINOV_INATIVIDADE_MS = (Number(d.inatividade_min) || 30) * 60000
      window.KLINOV_AGENDA_PADRAO = d.agenda || null
      aplicarTema(d.tema)
    } catch (e) {}
  }
  var _upd = window.updateUserInfo
  if (typeof _upd === 'function') window.updateUserInfo = function () { var r = _upd.apply(this, arguments); aplicarClinica(); return r }

  // ════════════════════════════════════════════════════════════════
  // LOGIN EM DUAS ETAPAS
  // ════════════════════════════════════════════════════════════════
  function pedirCodigoLogin(d) {
    var form = el('login-form'); if (!form) return
    var box = el('login-2fa')
    if (!box) { box = document.createElement('div'); box.id = 'login-2fa'; form.parentNode.insertBefore(box, form.nextSibling) }
    form.style.display = 'none'
    box.style.display = 'block'
    box.innerHTML = '<div style="font-size:18px;font-weight:500;color:var(--text);margin-bottom:8px">Código de acesso</div><div style="font-size:13px;color:var(--text3);margin-bottom:16px">Enviamos um código de 6 dígitos para ' + esc(d.email || 'o seu e-mail pessoal') + '. Ele vale por 10 minutos.</div>' +
      '<input class="form-input" id="login-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" style="font-size:22px;letter-spacing:8px;text-align:center;width:100%;box-sizing:border-box">' +
      '<div id="login-codigo-err" style="color:var(--red);font-size:13px;min-height:18px;margin:8px 0"></div><button class="btn btn-primary" id="login-codigo-ok" style="width:100%;justify-content:center;text-align:center">Entrar</button>' +
      '<div style="text-align:center;margin-top:12px"><a href="#" id="login-codigo-v" style="font-size:13px;color:var(--blue)">Voltar</a></div>'
    var inp = el('login-codigo'); inp.focus()
    function voltar() { box.style.display = 'none'; form.style.display = 'block' }
    el('login-codigo-v').onclick = function (e) { e.preventDefault(); voltar() }
    async function enviar() {
      var cod = String(inp.value).replace(/\D/g, ''); if (cod.length !== 6) { el('login-codigo-err').textContent = 'Digite os 6 dígitos'; return }
      var b = el('login-codigo-ok'); b.disabled = true
      try {
        var r = await (await fetch('/api/auth?action=verificar-codigo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ desafio: d.desafio, codigo: cod }) })).json()
        if (r.success) { localStorage.setItem('klinov_token', r.token); KLINOV_USER = r.usuario; voltar(); hideLogin(); updateUserInfo(); routeFromHash(); return }
        el('login-codigo-err').textContent = r.error || 'Código incorreto'
        if (r.expirado) setTimeout(voltar, 1500)
      } catch (e) { el('login-codigo-err').textContent = 'Erro de conexão' }
      b.disabled = false
    }
    el('login-codigo-ok').onclick = enviar
    inp.onkeydown = function (e) { if (e.key === 'Enter') enviar() }
    inp.oninput = function () { if (String(this.value).replace(/\D/g, '').length === 6) enviar() }
  }

  // ════════════════════════════════════════════════════════════════
  // USUÁRIOS: editar e exceções de permissão
  // ════════════════════════════════════════════════════════════════
  var _loadUsuarios = window.loadUsuarios
  window.loadUsuarios = async function () {
    if (typeof _loadUsuarios === 'function') await _loadUsuarios()
    var tbl = document.querySelector('#usr-list table'); if (!tbl) return
    var r = await fetch('/api/auth?action=listar-usuarios', { headers: _apiHeaders() }).then(function (x) { return x.json() }).catch(function () { return {} })
    var users = r.data || []
    tbl.querySelectorAll('tbody tr').forEach(function (tr, i) {
      var u = users[i]; if (!u) return
      var td = tr.lastElementChild
      td.insertAdjacentHTML('afterbegin', '<button class="btn btn-sm" data-ued="' + u.id + '">Editar</button><button class="btn btn-sm" data-upe="' + u.id + '">Permissões</button>')
    })
    tbl.querySelectorAll('[data-ued]').forEach(function (b) { b.onclick = function () { editarUsuario(users.filter(function (u) { return u.id === +b.getAttribute('data-ued') })[0]) } })
    tbl.querySelectorAll('[data-upe]').forEach(function (b) { b.onclick = function () { permissoesUsuario(+b.getAttribute('data-upe')) } })
  }
  function modal(titulo, corpo, botoes, largura) {
    var ov = el('cf-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'cf-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10010'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 560) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="cf-m-x">✕</button></div><div class="ag-modal-b" id="cf-m-b">' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('cf-m-x').onclick = fecharModal
    ov.onmousedown = function (e) { if (e.target === ov) fecharModal() }
  }
  function fecharModal() { var ov = el('cf-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  async function editarUsuario(u) {
    var profs = []
    try { profs = ((await apiData('profissionais')).data || []).filter(function (p) { return p.ativo !== 0 }) } catch (e) {}
    modal('Editar usuário', '<div id="ue-err"></div>' + campo('ue-nome', 'Nome', u.nome, ' maxlength="120"') + '<div class="ag-row c2"><div class="ag-f"><label>Perfil</label><select class="ag-in" id="ue-perfil">' + Object.keys(PERFIL_NOME).map(function (k) { return '<option value="' + k + '"' + (u.perfil === k ? ' selected' : '') + '>' + PERFIL_NOME[k] + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label>Profissional vinculado</label><select class="ag-in" id="ue-prof"><option value="">Nenhum</option>' + profs.map(function (p) { return '<option value="' + p.id + '"' + (u.profissional_id === p.id ? ' selected' : '') + '>' + esc(p.nome) + '</option>' }).join('') + '</select></div></div>' +
      '<div class="ag-row c2">' + campo('ue-email', 'E-mail pessoal', u.email_pessoal, ' type="email" maxlength="150"') + campo('ue-tel', 'Telefone', u.telefone, ' maxlength="20"') + '</div><p class="ag-hint">Login: ' + esc(u.email) + '. O e-mail pessoal recebe o código do login em duas etapas e a recuperação de senha. Mudar o perfil desconecta o usuário.</p>',
      '<button class="btn" id="ue-c">Cancelar</button><button class="ag-btn-novo" id="ue-ok">Salvar</button>')
    el('ue-c').onclick = fecharModal
    el('ue-ok').onclick = async function () {
      var r = await (await fetch('/api/auth?action=editar-usuario', { method: 'POST', headers: _apiHeaders(), body: JSON.stringify({ usuario_id: u.id, nome: v('ue-nome'), perfil: v('ue-perfil'), profissional_id: v('ue-prof'), email_pessoal: v('ue-email'), telefone: v('ue-tel') }) })).json()
      if (!r.success) { el('ue-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      fecharModal(); window.loadUsuarios()
    }
  }
  var GRUPOS_PERM = { agenda: 'Agenda', pacientes: 'Pacientes', financeiro: 'Financeiro', crc: 'CRC', relatorios: 'Relatórios', metas: 'Metas', dashboard: 'Dashboard', configuracoes: 'Configurações', usuarios: 'Usuários', profissionais: 'Profissionais' }
  async function permissoesUsuario(uid) {
    var d = await apiData('usuario-permissoes', { usuario_id: uid }).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) return alert(d.error || 'Erro')
    var ov = Object.assign({}, d.overrides)
    var grupos = {}
    d.recursos.forEach(function (r) { var g = r.split('.')[0]; (grupos[g] = grupos[g] || []).push(r) })
    function linha(r) {
      var base = d.perfil[r] ? 'Permitido' : 'Negado', o = ov[r]
      return '<tr><td>' + esc(r.split('.').slice(1).join('.').replace(/_/g, ' ')) + '</td><td class="ag-hint" style="margin:0">' + base + ' pelo perfil</td><td><select class="ag-in cf-pm" data-r="' + r + '"><option value="">Seguir o perfil</option><option value="1"' + (o === 1 ? ' selected' : '') + '>Permitir</option><option value="0"' + (o === 0 ? ' selected' : '') + '>Negar</option></select></td></tr>'
    }
    modal('Permissões de ' + d.usuario.nome, '<p class="ag-hint" style="margin-top:0">Perfil: <b>' + esc(PERFIL_NOME[d.usuario.perfil] || d.usuario.perfil) + '</b>. Use as exceções só para o que for diferente do perfil desta pessoa.' + (d.usuario.perfil === 'admin' ? ' Administradores têm acesso total; exceções não se aplicam.' : '') + '</p>' +
      Object.keys(grupos).map(function (g) { return '<div class="cf-pgrupo"><div class="pc-box-h" style="margin:12px 0 4px">' + esc(GRUPOS_PERM[g] || g) + '</div><table class="pc-tbl cf-ptbl"><tbody>' + grupos[g].map(linha).join('') + '</tbody></table></div>' }).join(''),
      '<button class="btn" id="up-c">Cancelar</button><button class="ag-btn-novo" id="up-ok">Salvar exceções</button>', 760)
    el('up-c').onclick = fecharModal
    el('up-ok').onclick = async function () {
      var o = {}
      el('cf-m-b').querySelectorAll('.cf-pm').forEach(function (s) { if (s.value !== '') o[s.getAttribute('data-r')] = +s.value })
      var r = await apiPost('usuario-permissoes', { usuario_id: uid, overrides: o })
      if (!r.success) return alert(r.error || 'Erro')
      fecharModal()
    }
  }

  // ════════════════════════════════════════════════════════════════
  // PROFISSIONAIS: inativar e excluir (botões da ficha)
  // ════════════════════════════════════════════════════════════════
  window.profAlternarAtivo = async function () {
    var p = window._profDetData; if (!p) return
    var ativar = p.ativo === 0
    if (!confirm(ativar ? 'Reativar ' + p.nome + '?' : 'Inativar ' + p.nome + '? Ele sai da agenda e das listas, mas o histórico fica.')) return
    var r = await apiPost('profissional-status', { id: p.id, ativo: ativar ? 1 : 0 })
    if (!r.success) return alert(r.error || 'Erro')
    nav('profissionais')
  }
  window.profExcluir = async function () {
    var p = window._profDetData; if (!p) return
    if (!confirm('Excluir ' + p.nome + '? Ele vai para a Administração de Dados.')) return
    var r = await apiPost('excluir-profissional', { id: p.id })
    if (!r.success) return alert(r.error || 'Erro')
    nav('profissionais')
  }

  window.renderConfiguracoes = renderConfiguracoes
  window.exportarDados = exportarDados
  window.pedirCodigoLogin = pedirCodigoLogin
  window.aplicarClinica = aplicarClinica
  if (localStorage.getItem('klinov_token')) aplicarClinica()
})()
