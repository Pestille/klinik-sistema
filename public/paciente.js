// public/paciente.js — Pacientes e prontuário (Fase 3)
// Klinov — Campo Grande, MS
//
// Lista de pacientes, cadastro completo, Visão Geral do prontuário e as abas
// Cadastro, Evolução, Documentos, Agendamentos e Indicações. As demais abas
// (orçamentos, financeiro, odontograma, anamnese…) continuam em app.html.
// Abas novas entram por window.PRONT_TABS[id] = function(el, paciente, dados).
// Depende de apiData, apiPost, escHtml, abrirProntuario, nav, _prontData (app.html)
// e das classes .ag-* de agenda.css.
;(function () {
  'use strict'

  var COMO_CONHECEU = ['Google', 'Instagram', 'Facebook', 'TikTok', 'Indicado por', 'Plano/Convênio', 'Escola', 'Outdoor', 'Panfleto', 'Placa', 'Rádio', 'TV', 'Revista', 'Outros']
  var UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
  var STATUS_AG = { agendado: ['Agendado', '#757575'], confirmado: ['Confirmado', '#00695C'], em_espera: ['Em espera', '#FF6D00'], em_atendimento: ['Em atendimento', '#1976D2'],
    atendido: ['Atendido', '#2E7D52'], atrasado: ['Atrasado', '#D32F2F'], faltou: ['Faltou', '#212121'], desmarcado: ['Desmarcado', '#9E9E9E'], cancelado: ['Desmarcado', '#9E9E9E'], nao_confirmado: ['Não confirmado', '#D32F2F'] }
  var TIPOS_DOC = { atestado: 'Atestado', receituario: 'Receituário', declaracao: 'Declaração', contrato: 'Contrato', termo: 'Termo', orientacao: 'Orientação', solicitacao: 'Solicitação de exame', outro: 'Outro' }

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function hojeYmd() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function idade(n) { if (!n) return ''; var d = new Date(n + 'T12:00:00'), h = new Date(); var a = h.getFullYear() - d.getFullYear(); if (h < new Date(h.getFullYear(), d.getMonth(), d.getDate())) a--; return isNaN(a) ? '' : a + ' anos' }
  function fone(t) { return String(t || '').replace(/\D/g, '') }
  function waLink(t) { var d = fone(t); if (d.length < 10) return ''; if (d.slice(0, 2) !== '55') d = '55' + d; return 'https://wa.me/' + d }
  function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function cpfValido(c) {
    c = fone(c); if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
    for (var t = 9; t < 11; t++) { var s = 0; for (var i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if (((10 * s) % 11) % 10 !== +c[t]) return false }
    return true
  }
  function mascCpf(v) { v = fone(v).slice(0, 11); return v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2') }
  function mascTel(v) { v = fone(v).slice(0, 11); return v.length > 10 ? v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '') }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('pc-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'pc-modal-ov'; ov.className = 'ag-modal-ov'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 760) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="pc-m-x">✕</button></div>' +
      '<div class="ag-modal-b" id="pc-m-b">' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('pc-m-x').onclick = fecharModal
    ov.onmousedown = function (e) { if (e.target === ov) fecharModal() }
  }
  function fecharModal() { var ov = el('pc-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  function erro(boxId, msg) { var b = el(boxId); if (b) b.innerHTML = msg ? '<div class="ag-err">' + esc(msg) + '</div>' : '' }

  // ════════════════════════════════════════════════════════════════
  // LISTA DE PACIENTES
  // ════════════════════════════════════════════════════════════════
  var LST = { q: '', status: 'ativo', como: '', pagina: 1 }

  function loadPacientesLista() {
    var pg = el('p-pacientes'); if (!pg) return
    if (!el('pc-lista')) {
      pg.innerHTML = '<div class="pc-wrap"><div class="pc-head"><div><h1 class="pc-h1">Pacientes</h1><div class="pc-sub">Busque, cadastre e acompanhe os pacientes da clínica.</div></div>' +
        '<button class="ag-btn-novo" onclick="abrirCadastroPaciente()">+ Novo paciente</button></div>' +
        '<div class="pc-card"><div class="pc-filtros">' +
          '<div style="flex:1;min-width:240px"><div class="ag-f" style="margin:0"><label>Buscar</label><input class="ag-in" id="pc-q" placeholder="Nome, CPF ou telefone (use % para sobrenome)" style="width:100%"></div></div>' +
          '<div class="ag-f" style="margin:0"><label>Situação</label><select class="ag-in" id="pc-st"><option value="ativo">Ativos</option><option value="inativo">Inativos</option><option value="todos">Todos</option></select></div>' +
          '<div class="ag-f" style="margin:0"><label>Como conheceu</label><select class="ag-in" id="pc-como"><option value="">Todos</option>' + COMO_CONHECEU.map(function (c) { return '<option>' + c + '</option>' }).join('') + '</select></div>' +
        '</div><div id="pc-lista"></div></div></div>'
      var t = null
      el('pc-q').oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { LST.q = v.trim(); LST.pagina = 1; buscar() }, 300) }
      el('pc-st').onchange = function () { LST.status = this.value; LST.pagina = 1; buscar() }
      el('pc-como').onchange = function () { LST.como = this.value; LST.pagina = 1; buscar() }
    }
    buscar()
  }

  async function buscar() {
    var box = el('pc-lista'); if (!box) return
    box.innerHTML = '<div style="padding:24px;color:var(--text3)">Carregando…</div>'
    try {
      var d = await apiData('pacientes-lista', { q: LST.q, status: LST.status, como_conheceu: LST.como, pagina: LST.pagina, limit: 25 })
      var rows = d.data || []
      if (!rows.length) { box.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">' + (LST.q ? 'Nenhum paciente encontrado para "' + esc(LST.q) + '".' : 'Nenhum paciente cadastrado.') + '</div>'; return }
      var paginas = Math.max(1, Math.ceil(d.total / d.limite))
      box.innerHTML = '<div style="overflow-x:auto"><table class="pc-tbl"><thead><tr><th>Nome</th><th>Celular / WhatsApp</th><th class="hide-sm">Nascimento</th><th class="hide-sm">E-mail</th><th class="hide-sm">Como conheceu</th><th>Situação</th></tr></thead><tbody>' +
        rows.map(function (p) {
          var tel = p.whatsapp || p.telefone, wa = waLink(tel)
          return '<tr class="clk" data-id="' + p.id + '" data-nome="' + esc(p.nome) + '"><td class="nome">' + esc(p.nome) + '</td>' +
            '<td>' + (tel ? esc(tel) + (wa ? '<a class="pc-wa" href="' + wa + '" target="_blank" rel="noopener" data-stop>WhatsApp</a>' : '') : '—') + '</td>' +
            '<td class="hide-sm">' + (br(p.data_nascimento) || '—') + '</td><td class="hide-sm">' + esc(p.email || '—') + '</td><td class="hide-sm">' + esc(p.como_conheceu || '—') + '</td>' +
            '<td><span class="pc-badge ' + (p.ativo === 0 ? 'off">Inativo' : 'ok">Ativo') + '</span></td></tr>'
        }).join('') + '</tbody></table></div>' +
        '<div class="pc-pag"><span>' + d.total + ' paciente' + (d.total === 1 ? '' : 's') + '</span><span>' +
          '<button class="btn btn-sm" id="pc-prev"' + (LST.pagina <= 1 ? ' disabled' : '') + '>‹ Anterior</button> Página ' + LST.pagina + ' de ' + paginas +
          ' <button class="btn btn-sm" id="pc-next"' + (LST.pagina >= paginas ? ' disabled' : '') + '>Próxima ›</button></span></div>'
      box.querySelectorAll('tr.clk').forEach(function (tr) {
        tr.onclick = function (e) { if (e.target.closest('[data-stop]')) return; abrirProntuario(this.getAttribute('data-nome'), +this.getAttribute('data-id')) }
      })
      el('pc-prev').onclick = function () { LST.pagina--; buscar() }
      el('pc-next').onclick = function () { LST.pagina++; buscar() }
    } catch (e) { box.innerHTML = '<div class="ag-err" style="margin:16px">' + esc(e.message) + '</div>' }
  }

  // ════════════════════════════════════════════════════════════════
  // CADASTRO (modal de novo paciente e aba Cadastro)
  // ════════════════════════════════════════════════════════════════
  function formCadastro(p, pre) {
    p = p || {}
    function inp(id, rot, val, extra) { return '<div class="ag-f"><label>' + rot + '</label><input class="ag-in" id="' + pre + id + '" value="' + esc(val || '') + '"' + (extra || '') + '></div>' }
    function sel(id, rot, val, ops, vazio) { return '<div class="ag-f"><label>' + rot + '</label><select class="ag-in" id="' + pre + id + '">' + (vazio != null ? '<option value="">' + vazio + '</option>' : '') + ops.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(v) === String(val || '') ? ' selected' : '') + '>' + esc(t) + '</option>' }).join('') + '</select></div>' }
    return '<div id="' + pre + 'root"><div id="' + pre + 'err"></div>' +
      '<div class="ag-tabs" id="' + pre + 'tabs"><div class="ag-tab on" data-sec="dados">Dados pessoais</div><div class="ag-tab" data-sec="contato">Contato e endereço</div><div class="ag-tab" data-sec="comp">Complemento</div></div>' +
      '<div data-secbox="dados">' +
        '<div class="ag-row c2">' + inp('nome', 'Nome *', p.nome, ' maxlength="120"') + inp('apelido', 'Apelido', p.apelido, ' placeholder="Como prefere ser chamado"') + '</div>' +
        '<div class="ag-row c3">' + inp('cpf', 'CPF', p.cpf, ' placeholder="000.000.000-00"') + inp('rg', 'RG', p.rg) + inp('data_nascimento', 'Data de nascimento', p.data_nascimento, ' type="date"') + '</div>' +
        '<div class="ag-row c3">' + sel('sexo', 'Gênero', p.sexo, [['M', 'Masculino'], ['F', 'Feminino'], ['O', 'Outro']], '—') +
          sel('estado_civil', 'Estado civil', p.estado_civil, ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'], '—') +
          sel('como_conheceu', 'Como conheceu', p.como_conheceu, COMO_CONHECEU, 'Selecione') + '</div>' +
        '<div class="ag-f" id="' + pre + 'ind-box"' + (p.como_conheceu === 'Indicado por' ? '' : ' style="display:none"') + '><label>Indicado por</label><div id="' + pre + 'ind"></div></div>' +
        '<div class="ag-row c2">' + inp('convenio', 'Plano / convênio', p.convenio) + inp('numero_convenio', 'Nº da carteirinha', p.numero_convenio) + '</div>' +
        '<div class="ag-f"><label>Alerta médico</label><input class="ag-in" id="' + pre + 'alerta_medico" value="' + esc(p.alerta_medico || '') + '" placeholder="Alergias, medicamentos, condições importantes"></div>' +
        '<div class="ag-f"><label>Observações</label><textarea class="ag-in" id="' + pre + 'observacoes" rows="2">' + esc(p.observacoes || '') + '</textarea></div>' +
      '</div>' +
      '<div data-secbox="contato" style="display:none">' +
        '<div class="ag-row c3">' + inp('telefone', 'Celular', p.telefone, ' placeholder="(67) 9 9999-9999"') + inp('whatsapp', 'WhatsApp (se diferente)', p.whatsapp) + inp('fone_fixo', 'Telefone fixo', p.fone_fixo) + '</div>' +
        '<div class="ag-row c2">' + inp('email', 'E-mail', p.email, ' type="email"') + '<div class="ag-f"><label>&nbsp;</label><label class="ag-chk"><input type="checkbox" id="' + pre + 'sem_email"' + (p.sem_email ? ' checked' : '') + '> Não possui e-mail</label></div></div>' +
        '<div class="ag-row c4">' + inp('cep', 'CEP', p.cep) + '<div style="grid-column:span 2">' + inp('endereco', 'Endereço', p.endereco) + '</div>' + inp('numero', 'Número', p.numero) + '</div>' +
        '<div class="ag-row c4">' + inp('complemento', 'Complemento', p.complemento) + inp('bairro', 'Bairro', p.bairro) + inp('cidade', 'Cidade', p.cidade) + sel('uf', 'UF', p.uf, UFS, '—') + '</div>' +
      '</div>' +
      '<div data-secbox="comp" style="display:none">' +
        '<div class="ag-row c2">' + inp('profissao', 'Profissão', p.profissao) + inp('local_trabalho', 'Local de trabalho', p.local_trabalho) + '</div>' +
        '<div class="ag-row c2">' + inp('mae', 'Nome da mãe', p.mae) + inp('pai', 'Nome do pai', p.pai) + '</div>' +
        '<div class="ag-row c2">' + inp('responsavel_nome', 'Responsável legal', p.responsavel_nome, ' placeholder="Para menores ou tutelados"') + inp('responsavel_cpf', 'CPF do responsável', p.responsavel_cpf) + '</div>' +
      '</div></div>'
  }

  function ligarForm(pre, p) {
    var tabs = el(pre + 'tabs')
    tabs.querySelectorAll('[data-sec]').forEach(function (t) {
      t.onclick = function () {
        tabs.querySelectorAll('.ag-tab').forEach(function (x) { x.classList.remove('on') }); this.classList.add('on')
        var s = this.getAttribute('data-sec')
        el(pre + 'root').querySelectorAll('[data-secbox]').forEach(function (b) { b.style.display = b.getAttribute('data-secbox') === s ? '' : 'none' })
      }
    })
    ;['cpf', 'responsavel_cpf'].forEach(function (f) { var i = el(pre + f); if (i) i.oninput = function () { this.value = mascCpf(this.value) } })
    ;['telefone', 'whatsapp', 'fone_fixo'].forEach(function (f) { var i = el(pre + f); if (i) i.oninput = function () { this.value = mascTel(this.value) } })
    el(pre + 'como_conheceu').onchange = function () { el(pre + 'ind-box').style.display = this.value === 'Indicado por' ? '' : 'none' }
    el(pre + 'cep').onblur = async function () {
      var c = fone(this.value); if (c.length !== 8) return
      try {
        var r = await fetch('https://viacep.com.br/ws/' + c + '/json/'); var j = await r.json(); if (j.erro) return
        if (!el(pre + 'endereco').value) el(pre + 'endereco').value = j.logradouro || ''
        if (!el(pre + 'bairro').value) el(pre + 'bairro').value = j.bairro || ''
        el(pre + 'cidade').value = j.localidade || el(pre + 'cidade').value
        el(pre + 'uf').value = j.uf || el(pre + 'uf').value
      } catch (e) {}
    }
    // indicado por: busca de paciente
    var indSel = p && p.indicado_por_id ? { id: p.indicado_por_id, nome: p.indicado_por_nome } : null
    var box = el(pre + 'ind')
    function desenharInd() {
      if (indSel) { box.innerHTML = '<div class="ag-pac-sel"><span>' + esc(indSel.nome) + '</span><button class="ag-ico" type="button" id="' + pre + 'ind-x">✕</button></div>'; el(pre + 'ind-x').onclick = function () { indSel = null; desenharInd() }; return }
      box.innerHTML = '<input class="ag-in" id="' + pre + 'ind-q" placeholder="Buscar paciente que indicou"><div id="' + pre + 'ind-d"></div>'
      var t = null
      el(pre + 'ind-q').oninput = function () {
        var q = this.value.trim(); clearTimeout(t); var d = el(pre + 'ind-d')
        if (q.length < 2) { d.innerHTML = ''; return }
        t = setTimeout(async function () {
          var r = await apiData('busca', { q: q }); var ps = (r.pacientes || []).filter(function (x) { return !p || x.id !== p.id })
          d.innerHTML = '<div class="ag-pac-drop">' + (ps.map(function (x, i) { return '<div class="ag-pac-it" data-i="' + i + '">' + esc(x.nome) + '<small>' + esc(x.telefone || '') + '</small></div>' }).join('') || '<div class="ag-pac-it" style="color:var(--text3)">Nenhum paciente encontrado</div>') + '</div>'
          d.querySelectorAll('[data-i]').forEach(function (it) { it.onclick = function () { indSel = ps[+this.getAttribute('data-i')]; desenharInd() } })
        }, 250)
      }
    }
    desenharInd()
    return function () { return indSel }
  }

  function coletar(pre, getInd) {
    var campos = ['nome', 'apelido', 'cpf', 'rg', 'data_nascimento', 'sexo', 'estado_civil', 'como_conheceu', 'convenio', 'numero_convenio', 'alerta_medico', 'observacoes',
      'telefone', 'whatsapp', 'fone_fixo', 'email', 'cep', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'profissao', 'local_trabalho', 'mae', 'pai', 'responsavel_nome', 'responsavel_cpf']
    var o = {}
    campos.forEach(function (c) { var i = el(pre + c); if (i) o[c] = i.value.trim() })
    o.sem_email = el(pre + 'sem_email').checked
    var ind = o.como_conheceu === 'Indicado por' ? getInd() : null
    o.indicado_por_id = ind ? ind.id : null
    o.indicado_por_nome = ind ? ind.nome : ''
    return o
  }

  function validar(o) {
    if (!o.nome) return 'Informe o nome do paciente.'
    if (o.cpf && !cpfValido(o.cpf)) return 'CPF inválido.'
    if (o.responsavel_cpf && !cpfValido(o.responsavel_cpf)) return 'CPF do responsável inválido.'
    if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) return 'E-mail inválido.'
    return null
  }

  function abrirCadastroPaciente(depois) {
    modal('Novo paciente', formCadastro({}, 'pcn-'), '<button class="btn" id="pcn-cancel">Cancelar</button><button class="ag-btn-novo" id="pcn-ok">Cadastrar paciente</button>')
    var getInd = ligarForm('pcn-', null)
    setTimeout(function () { el('pcn-nome').focus() }, 30)
    el('pcn-cancel').onclick = fecharModal
    el('pcn-ok').onclick = async function () {
      var o = coletar('pcn-', getInd), v = validar(o)
      if (v) return erro('pcn-err', v)
      this.disabled = true
      try {
        var r = await apiPost('paciente-salvar', o)
        if (!r.success) { erro('pcn-err', r.error || 'Erro ao cadastrar'); return }
        fecharModal()
        if (typeof depois === 'function') depois({ id: r.id, nome: o.nome.toUpperCase(), telefone: o.telefone })
        else abrirProntuario(o.nome.toUpperCase(), r.id)
      } catch (e) { erro('pcn-err', e.message) } finally { var b = el('pcn-ok'); if (b) b.disabled = false }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // AÇÕES DO CABEÇALHO DO PRONTUÁRIO
  // ════════════════════════════════════════════════════════════════
  function pacAtual() { return (window._prontData && _prontData.paciente) || null }

  async function pacAlternarAtivo() {
    var p = pacAtual(); if (!p) return
    var ativar = p.ativo === 0
    if (!confirm(ativar ? 'Reativar este paciente?' : 'Inativar este paciente? Ele sai das listas de ativos, mas o histórico é mantido.')) return
    var r = await apiPost('paciente-status', { id: p.id, ativo: ativar ? 1 : 0 })
    if (!r.success) return alert(r.error || 'Erro')
    abrirProntuario(p.nome, p.id)
  }

  async function pacExcluir() {
    var p = pacAtual(); if (!p) return
    if (!confirm('Excluir o cadastro de ' + p.nome + '? Só é possível sem histórico; o cadastro vai para a lixeira.')) return
    var r = await apiPost('excluir-paciente', { id: p.id })
    if (!r.success) return alert(r.error || 'Erro ao excluir')
    nav('pacientes')
  }

  function pacImprimir() {
    var p = pacAtual(); if (!p) return
    var linhas = [['Nome', p.nome], ['Apelido', p.apelido], ['CPF', p.cpf], ['RG', p.rg], ['Nascimento', br(p.data_nascimento) + (p.data_nascimento ? ' (' + idade(p.data_nascimento) + ')' : '')],
      ['Celular', p.telefone], ['WhatsApp', p.whatsapp], ['Telefone fixo', p.fone_fixo], ['E-mail', p.email],
      ['Endereço', [p.endereco, p.numero, p.complemento, p.bairro, p.cidade && (p.cidade + (p.uf ? '/' + p.uf : '')), p.cep].filter(Boolean).join(', ')],
      ['Convênio', [p.convenio, p.numero_convenio].filter(Boolean).join(' — ')], ['Como conheceu', p.como_conheceu + (p.indicado_por_nome ? ': ' + p.indicado_por_nome : '')],
      ['Profissão', p.profissao], ['Mãe', p.mae], ['Pai', p.pai], ['Responsável legal', [p.responsavel_nome, p.responsavel_cpf].filter(Boolean).join(' — ')],
      ['Alerta médico', p.alerta_medico], ['Observações', p.observacoes]].filter(function (l) { return l[1] })
    var w = window.open('', '_blank'); if (!w) return alert('Permita pop-ups para imprimir.')
    w.document.write('<html><head><title>' + esc(p.nome) + '</title><style>body{font-family:Roboto,Arial,sans-serif;color:#212121;padding:24px}h2{font-weight:500}td{padding:6px 10px;border-bottom:1px solid #EEE;font-size:13px;vertical-align:top}td:first-child{color:#757575;width:180px}</style></head><body>' +
      '<h2>Ficha cadastral</h2><table>' + linhas.map(function (l) { return '<tr><td>' + esc(l[0]) + '</td><td>' + esc(l[1]) + '</td></tr>' }).join('') + '</table></body></html>')
    w.document.close(); w.focus(); w.print()
  }

  // ════════════════════════════════════════════════════════════════
  // ABAS DO PRONTUÁRIO
  // ════════════════════════════════════════════════════════════════
  var TABS = window.PRONT_TABS = window.PRONT_TABS || {}

  // ── Visão geral ──────────────────────────────────────────────────
  TABS['visao-geral'] = async function (box, p) {
    box.innerHTML = '<div style="color:var(--text3)">Carregando…</div>'
    var r
    try { r = await apiData('paciente-resumo', { id: p.id }) } catch (e) { box.innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>'; return }
    if (!r.success) { box.innerHTML = '<div class="ag-err">' + esc(r.error) + '</div>'; return }
    var sec = 'cad'
    function kv(k, v) { return '<div class="pc-kv"><span>' + k + '</span><span>' + (v ? esc(v) : '—') + '</span></div>' }
    function infos() {
      if (sec === 'cad') return kv('Nascimento', br(p.data_nascimento) + (p.data_nascimento ? ' · ' + idade(p.data_nascimento) : '')) + kv('CPF', p.cpf) + kv('RG', p.rg) + kv('Como conheceu', (p.como_conheceu || '') + (p.indicado_por_nome ? ' — ' + p.indicado_por_nome : '')) +
        kv('Convênio', [p.convenio, p.numero_convenio].filter(Boolean).join(' · ')) + kv('Cadastrado em', br(p.criado_em)) + kv('Observações', p.observacoes)
      if (sec === 'con') return kv('Celular', p.telefone) + kv('WhatsApp', p.whatsapp) + kv('Telefone fixo', p.fone_fixo) + kv('E-mail', p.email || (p.sem_email ? 'Não possui' : '')) +
        kv('Endereço', [p.endereco, p.numero].filter(Boolean).join(', ')) + kv('Bairro / cidade', [p.bairro, p.cidade && (p.cidade + (p.uf ? '/' + p.uf : ''))].filter(Boolean).join(' · ')) + kv('CEP', p.cep)
      return kv('Profissão', p.profissao) + kv('Local de trabalho', p.local_trabalho) + kv('Mãe', p.mae) + kv('Pai', p.pai) + kv('Responsável legal', [p.responsavel_nome, p.responsavel_cpf].filter(Boolean).join(' · '))
    }
    var prox = r.proximos[0]
    box.innerHTML =
      (p.alerta_medico ? '<div class="pc-alerta"><b>Alerta médico:</b> ' + esc(p.alerta_medico) + '</div>' : '') +
      (r.vencido.parcelas ? '<div class="pc-alerta" style="background:#FFF3E0;color:var(--orange)">' + r.vencido.parcelas + ' parcela(s) vencida(s) · ' + moeda(r.vencido.valor) + '</div>' : '') +
      '<div class="pc-grid">' +
        '<div class="pc-box" style="grid-row:span 2"><div class="pc-box-h">Informações do paciente <a id="pcv-edit">Editar</a></div>' +
          '<div class="pc-seg" id="pcv-seg"><div data-s="cad" class="on">Cadastro</div><div data-s="con">Contato</div><div data-s="comp">Complemento</div></div><div id="pcv-info">' + infos() + '</div></div>' +
        '<div class="pc-box"><div class="pc-box-h">Próximo agendamento <a id="pcv-agendar">+ Agendar</a></div>' +
          (prox ? '<div class="pc-item"><b>' + br(prox.data_hora) + ' · ' + String(prox.data_hora).slice(11, 16) + (prox.hora_fim ? '–' + prox.hora_fim : '') + '</b><br>' + esc(prox.profissional_nome || '') + (prox.tipo ? ' · ' + esc(prox.tipo) : '') + '</div>' +
            (r.proximos.length > 1 ? '<div class="ag-hint">+ ' + (r.proximos.length - 1) + ' agendado(s)</div>' : '') : '<div class="pc-vazio">Sem próximo agendamento.</div>') +
          (r.ultimo ? '<div class="ag-hint" style="margin-top:8px">Último atendimento: ' + br(r.ultimo.data_hora) + ' · ' + esc(r.ultimo.profissional_nome || '') + '</div>' : '') + '</div>' +
        '<div class="pc-box"><div class="pc-box-h">Anamnese <a data-tab="anamnese">Abrir</a></div>' +
          (r.anamnese.respostas ? '<div class="pc-item"><b>Preenchida</b><br>' + (r.anamnese.quando ? 'em ' + br(r.anamnese.quando) : '') + '</div>' : '<div class="pc-vazio">Anamnese ainda não preenchida.</div>') + '</div>' +
        '<div class="pc-box"><div class="pc-box-h">Alerta de retorno <a id="pcv-alerta">+ Novo</a></div>' +
          (r.alertas.length ? r.alertas.map(function (a) { return '<div class="pc-item"><b>' + br(a.data_retorno) + '</b>' + (a.motivo ? ' · ' + esc(a.motivo) : '') + '</div>' }).join('') : '<div class="pc-vazio">Sem alerta de retorno.</div>') + '</div>' +
        '<div class="pc-box"><div class="pc-box-h">Orçamentos em aberto <a data-tab="orcamentos">Ver todos</a></div>' +
          (r.orcamentos_abertos.length ? r.orcamentos_abertos.map(function (o) { return '<div class="pc-item"><b>' + moeda(o.valor_total) + '</b> · ' + br(o.data_criacao) + '</div>' }).join('') : '<div class="pc-vazio">Nenhum orçamento em aberto.</div>') + '</div>' +
      '</div>' +
      '<div class="pc-box" style="margin-top:16px"><div class="pc-box-h">Notas gerais</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px"><input class="ag-in" id="pcv-nota" maxlength="2000" placeholder="Registre uma observação importante sobre o paciente"><button class="btn btn-primary" id="pcv-nota-ok">Adicionar</button></div>' +
        '<div id="pcv-notas">' + (r.notas.length ? r.notas.map(function (n) {
          return '<div class="pc-nota"><div>' + esc(n.texto) + '<small>' + esc(n.autor_nome || '') + ' · ' + br(n.criado_em) + ' ' + String(n.criado_em || '').slice(11, 16) + '</small></div><button class="ag-ico" data-nota="' + n.id + '" title="Remover">✕</button></div>'
        }).join('') : '<div class="ag-empty">Sem notas.</div>') + '</div></div>' +
      (r.indicados ? '<div class="ag-hint" style="margin-top:12px">Este paciente indicou ' + r.indicados + ' paciente(s). <a href="#" data-tab="indicacoes" style="color:var(--blue)">Ver indicações</a></div>' : '') +
      '<div id="pcv-crc"></div>'
    el('pcv-seg').querySelectorAll('[data-s]').forEach(function (s) {
      s.onclick = function () { sec = this.getAttribute('data-s'); el('pcv-seg').querySelectorAll('div').forEach(function (x) { x.classList.toggle('on', x === s) }); el('pcv-info').innerHTML = infos() }
    })
    box.querySelectorAll('[data-tab]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); irAba(this.getAttribute('data-tab')) } })
    if (window.crcHistoricoPaciente) crcHistoricoPaciente(el('pcv-crc'), p.id)
    el('pcv-edit').onclick = function () { irAba('cadastro') }
    el('pcv-agendar').onclick = function () { novoAgendamentoPaciente({ id: p.id, nome: p.nome, telefone: p.telefone }) }
    el('pcv-alerta').onclick = function () { novoAlertaRetorno({ id: p.id, nome: p.nome, telefone: p.telefone }) }
    el('pcv-nota-ok').onclick = async function () {
      var t = el('pcv-nota').value.trim(); if (!t) return
      var x = await apiPost('paciente-notas', { paciente_id: p.id, texto: t }); if (!x.success) return alert(x.error || 'Erro')
      TABS['visao-geral'](box, p)
    }
    el('pcv-nota').onkeydown = function (e) { if (e.key === 'Enter') el('pcv-nota-ok').click() }
    box.querySelectorAll('[data-nota]').forEach(function (b) {
      b.onclick = async function () { if (!confirm('Remover esta nota?')) return; var x = await apiPost('paciente-notas', { action: 'delete', id: +this.getAttribute('data-nota') }); if (!x.success) return alert(x.error || 'Erro'); TABS['visao-geral'](box, p) }
    })
  }

  function irAba(id) {
    var tab = document.querySelector('#pront-tabs [data-tab="' + id + '"]') || Array.prototype.filter.call(document.querySelectorAll('#pront-tabs .pdt-tab'), function (t) { return (t.getAttribute('onclick') || '').indexOf("'" + id + "'") !== -1 })[0]
    if (tab) prontTab(id, tab)
  }

  // ── Cadastro (edição completa) ───────────────────────────────────
  TABS.cadastro = function (box, p) {
    box.innerHTML = '<div style="max-width:900px">' + formCadastro(p, 'pce-') + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px"><button class="ag-btn-novo" id="pce-ok">Salvar cadastro</button></div></div>'
    var getInd = ligarForm('pce-', p)
    el('pce-ok').onclick = async function () {
      var o = coletar('pce-', getInd), v = validar(o)
      if (v) return erro('pce-err', v)
      o.id = p.id
      this.disabled = true
      try {
        var r = await apiPost('paciente-salvar', o)
        if (!r.success) { erro('pce-err', r.error || 'Erro ao salvar'); return }
        await abrirProntuario(o.nome.toUpperCase(), p.id)
      } catch (e) { erro('pce-err', e.message) } finally { var b = el('pce-ok'); if (b) b.disabled = false }
    }
  }

  // ── Evolução clínica ─────────────────────────────────────────────
  TABS.evolucao = async function (box, p) {
    var profs = ST.profissionais || []
    if (!profs.length) { try { var pd = await apiData('profissionais'); profs = (pd.data || []).map(function (x) { return { id: x.id, nome: x.nome } }) } catch (e) {} }
    box.innerHTML = '<div style="max-width:900px"><div class="pc-box" style="margin-bottom:16px"><div class="pc-box-h">Registrar atendimento</div><div id="pce-ev-err"></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="pce-ev-data" value="' + hojeYmd() + '"></div>' +
        '<div class="ag-f"><label>Profissional</label><select class="ag-in" id="pce-ev-prof"><option value="">—</option>' + profs.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + '</option>' }).join('') + '</select></div>' +
        '<div class="ag-f"><label>Dente / região</label><input class="ag-in" id="pce-ev-dente" maxlength="60" placeholder="Ex.: 36, arcada superior"></div></div>' +
      '<div class="ag-f"><label>Descrição do atendimento</label><textarea class="ag-in" id="pce-ev-txt" rows="4" maxlength="10000" placeholder="Procedimentos realizados, materiais, intercorrências, orientações"></textarea></div>' +
      '<div class="ag-f"><label>Próxima consulta</label><input class="ag-in" id="pce-ev-prox" maxlength="500" placeholder="O que fazer na próxima sessão"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px"><input type="hidden" id="pce-ev-id"><button class="btn" id="pce-ev-limpar" style="display:none">Cancelar edição</button><button class="ag-btn-novo" id="pce-ev-ok">Salvar evolução</button></div></div>' +
      '<div id="pce-ev-lista"><div style="color:var(--text3)">Carregando…</div></div></div>'
    var lista = []
    async function carregar() {
      try { var d = await apiData('paciente-evolucoes', { paciente_id: p.id }); lista = d.data || [] } catch (e) { el('pce-ev-lista').innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>'; return }
      el('pce-ev-lista').innerHTML = lista.length ? lista.map(function (e) {
        return '<div class="pc-ev"><div class="pc-ev-h"><span><b style="color:var(--text)">' + br(e.data) + '</b>' + (e.profissional_nome ? ' · ' + esc(e.profissional_nome) : '') + (e.dente ? ' · Dente/região ' + esc(e.dente) : '') + '</span>' +
          '<span>' + esc(e.autor_nome || '') + (e.editado_em ? ' (editado)' : '') + ' <a href="#" data-ed="' + e.id + '" style="color:var(--blue)">Editar</a> · <a href="#" data-del="' + e.id + '" style="color:var(--red)">Excluir</a></span></div>' +
          '<div class="pc-ev-t">' + esc(e.texto) + '</div>' + (e.proxima_consulta ? '<div class="ag-hint" style="margin-top:6px"><b>Próxima consulta:</b> ' + esc(e.proxima_consulta) + '</div>' : '') + '</div>'
      }).join('') : '<div class="pc-vazio">Nenhuma evolução registrada.</div>'
      el('pce-ev-lista').querySelectorAll('[data-ed]').forEach(function (a) {
        a.onclick = function (ev) {
          ev.preventDefault(); var e = lista.filter(function (x) { return x.id === +a.getAttribute('data-ed') })[0]; if (!e) return
          el('pce-ev-id').value = e.id; el('pce-ev-data').value = e.data; el('pce-ev-prof').value = e.profissional_id || ''; el('pce-ev-dente').value = e.dente || ''
          el('pce-ev-txt').value = e.texto; el('pce-ev-prox').value = e.proxima_consulta || ''; el('pce-ev-limpar').style.display = ''; el('pce-ev-txt').focus()
        }
      })
      el('pce-ev-lista').querySelectorAll('[data-del]').forEach(function (a) {
        a.onclick = async function (ev) { ev.preventDefault(); if (!confirm('Excluir este registro? Ele vai para a lixeira.')) return; var r = await apiPost('paciente-evolucoes', { action: 'delete', id: +a.getAttribute('data-del') }); if (!r.success) return alert(r.error || 'Erro'); carregar() }
      })
    }
    function limpar() { el('pce-ev-id').value = ''; el('pce-ev-txt').value = ''; el('pce-ev-prox').value = ''; el('pce-ev-dente').value = ''; el('pce-ev-limpar').style.display = 'none'; erro('pce-ev-err') }
    el('pce-ev-limpar').onclick = limpar
    el('pce-ev-ok').onclick = async function () {
      var body = { paciente_id: p.id, id: el('pce-ev-id').value ? +el('pce-ev-id').value : undefined, data: el('pce-ev-data').value, profissional_id: el('pce-ev-prof').value || null,
        dente: el('pce-ev-dente').value, texto: el('pce-ev-txt').value.trim(), proxima_consulta: el('pce-ev-prox').value }
      if (!body.texto) return erro('pce-ev-err', 'Descreva o atendimento.')
      var r = await apiPost('paciente-evolucoes', body)
      if (!r.success) return erro('pce-ev-err', r.error || 'Erro ao salvar')
      limpar(); carregar()
    }
    carregar()
  }

  // ── Documentos (emitidos por modelo + arquivos) ──────────────────
  TABS.documentos = async function (box, p) {
    box.innerHTML = '<div class="pc-box" style="margin-bottom:16px"><div class="pc-box-h">Documentos emitidos <a id="pcd-novo">+ Emitir documento</a></div><div id="pcd-lista"><div style="color:var(--text3)">Carregando…</div></div></div>' +
      '<div class="pc-box"><div class="pc-box-h">Arquivos</div><div id="pcd-arquivos"></div></div>'
    if (typeof renderDocumentosTab === 'function') renderDocumentosTab(el('pcd-arquivos'), p, 'documentos')
    el('pcd-novo').onclick = function () { emitirDocumento(p, function () { TABS.documentos(box, p) }) }
    try {
      var d = await apiData('documentos-emitidos', { paciente_id: p.id }), docs = d.data || []
      el('pcd-lista').innerHTML = docs.length ? '<table class="pc-tbl"><thead><tr><th>Data</th><th>Documento</th><th class="hide-sm">Tipo</th><th class="hide-sm">Profissional</th><th></th></tr></thead><tbody>' +
        docs.map(function (x) {
          return '<tr><td>' + br(x.criado_em) + '</td><td>' + esc(x.titulo) + '</td><td class="hide-sm">' + esc(TIPOS_DOC[x.tipo] || x.tipo || '') + '</td><td class="hide-sm">' + esc(x.profissional_nome || '—') + '</td>' +
            '<td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-imp="' + x.id + '">Imprimir</button> <button class="btn btn-sm" data-exc="' + x.id + '" style="color:var(--red)">Excluir</button></td></tr>'
        }).join('') + '</tbody></table>' : '<div class="pc-vazio">Nenhum documento emitido. Use "+ Emitir documento" para gerar atestados, receitas, termos e contratos a partir dos modelos.</div>'
      el('pcd-lista').querySelectorAll('[data-imp]').forEach(function (b) { b.onclick = function () { var x = docs.filter(function (k) { return k.id === +b.getAttribute('data-imp') })[0]; imprimirDocumento(x.titulo, x.conteudo, x.profissional_nome) } })
      el('pcd-lista').querySelectorAll('[data-exc]').forEach(function (b) {
        b.onclick = async function () { if (!confirm('Excluir este documento? Ele vai para a lixeira.')) return; var r = await apiPost('documentos-emitidos', { action: 'delete', id: +b.getAttribute('data-exc') }); if (!r.success) return alert(r.error || 'Erro'); TABS.documentos(box, p) }
      })
    } catch (e) { el('pcd-lista').innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>' }
  }
  TABS.fotos = function (box, p) { if (typeof renderDocumentosTab === 'function') renderDocumentosTab(box, p, 'fotos') }

  async function emitirDocumento(p, depois) {
    var m = await apiData('documento-modelos', {}), mods = m.data || []
    var profs = ST.profissionais || []
    if (!profs.length) { try { var pd = await apiData('profissionais'); profs = (pd.data || []).map(function (x) { return { id: x.id, nome: x.nome } }) } catch (e) {} }
    modal('Emitir documento', '<div id="pcd-err"></div><div class="ag-row c2"><div class="ag-f"><label>Modelo</label><select class="ag-in" id="pcd-mod"><option value="">Selecione</option>' +
      mods.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label>Profissional responsável</label><select class="ag-in" id="pcd-prof"><option value="">—</option>' + profs.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nome) + '</option>' }).join('') + '</select></div></div>' +
      '<div class="ag-f"><label>Título</label><input class="ag-in" id="pcd-tit" maxlength="160"></div>' +
      '<div class="ag-f"><label>Conteúdo <span style="text-transform:none;letter-spacing:0">(edite livremente; os campos ________ ficam para preencher)</span></label><div class="pc-doc-ed" id="pcd-ed" contenteditable="true"><span style="color:var(--text3)">Escolha um modelo.</span></div></div>',
      '<button class="btn" id="pcd-med" style="margin-right:auto">+ Medicamentos</button><button class="btn" id="pcd-cancel">Cancelar</button><button class="btn" id="pcd-salvar">Salvar</button><button class="ag-btn-novo" id="pcd-imp">Salvar e imprimir</button>', 860)
    var tipo = 'outro', modId = null
    async function preparar() {
      modId = el('pcd-mod').value; if (!modId) return
      var r = await apiData('documento-preparar', { modelo_id: modId, paciente_id: p.id, profissional_id: el('pcd-prof').value })
      if (!r.success) return erro('pcd-err', r.error || 'Erro')
      el('pcd-ed').innerHTML = r.conteudo; el('pcd-tit').value = r.titulo; tipo = r.tipo
    }
    el('pcd-mod').onchange = preparar
    el('pcd-prof').onchange = function () { if (modId && confirm('Recarregar o modelo com este profissional? As edições feitas serão perdidas.')) preparar() }
    el('pcd-cancel').onclick = fecharModal
    // Receituário: a lista de medicamentos substitui as linhas em branco do modelo
    el('pcd-med').onclick = function () {
      if (!modId) return erro('pcd-err', 'Escolha o modelo (ex.: Receituário simples) antes de inserir medicamentos.')
      window.escolherMedicamentos(function (html) {
        var ed = el('pcd-ed'), vazia = Array.prototype.filter.call(ed.querySelectorAll('ol'), function (o) { return !o.textContent.replace(/[\s\u00a0]/g, '') })[0]
        Array.prototype.forEach.call(ed.querySelectorAll('p'), function (p) { if (/^Uso:[\s\u00a0]*_+$/.test(p.textContent.trim())) p.remove() })
        var tmp = document.createElement('div'); tmp.innerHTML = html
        if (vazia) { while (tmp.firstChild) vazia.parentNode.insertBefore(tmp.firstChild, vazia); vazia.remove() } else { while (tmp.firstChild) ed.appendChild(tmp.firstChild) }
      })
    }
    async function salvar(imprimir) {
      var tit = el('pcd-tit').value.trim(), cont = el('pcd-ed').innerHTML
      if (!modId || !tit) return erro('pcd-err', 'Escolha o modelo e informe o título.')
      var r = await apiPost('documentos-emitidos', { paciente_id: p.id, modelo_id: +modId, titulo: tit, tipo: tipo, conteudo: cont, profissional_id: el('pcd-prof').value || null })
      if (!r.success) return erro('pcd-err', r.error || 'Erro ao salvar')
      var profNome = el('pcd-prof').selectedOptions[0] && el('pcd-prof').value ? el('pcd-prof').selectedOptions[0].textContent : ''
      fecharModal()
      if (imprimir) imprimirDocumento(tit, cont, profNome)
      if (depois) depois()
    }
    el('pcd-salvar').onclick = function () { salvar(false) }
    el('pcd-imp').onclick = function () { salvar(true) }
  }

  async function imprimirDocumento(titulo, conteudo, profissional) {
    var cli = {}
    try { var d = await apiData('dados-clinica', {}); cli = d.data || d.clinica || d || {} } catch (e) {}
    var w = window.open('', '_blank'); if (!w) return alert('Permita pop-ups para imprimir.')
    var hoje = new Date(), meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
    w.document.write('<html><head><title>' + esc(titulo) + '</title><style>@page{margin:2cm}body{font-family:Roboto,Arial,sans-serif;color:#212121;line-height:1.6;font-size:14px}' +
      '.cab{border-bottom:2px solid #1B5E3B;padding-bottom:8px;margin-bottom:24px}.cab b{font-size:16px;color:#1B5E3B}.cab small{display:block;color:#757575}.ass{margin-top:72px;text-align:center}.ass div{border-top:1px solid #212121;width:300px;margin:0 auto;padding-top:6px}</style></head><body>' +
      '<div class="cab"><b>' + esc(cli.nome || '') + '</b><small>' + esc([cli.endereco, cli.cidade, cli.estado].filter(Boolean).join(' · ')) + '</small></div>' +
      conteudo +
      '<p style="margin-top:32px">' + esc(cli.cidade || '') + (cli.cidade ? ', ' : '') + hoje.getDate() + ' de ' + meses[hoje.getMonth()] + ' de ' + hoje.getFullYear() + '.</p>' +
      '<div class="ass"><div>' + esc(profissional || 'Assinatura') + '</div></div></body></html>')
    w.document.close(); w.focus(); setTimeout(function () { w.print() }, 200)
  }

  // ── Agendamentos do paciente ─────────────────────────────────────
  TABS['agendamentos-pac'] = function (box, p, dados) {
    var ag = ((dados && dados.agendamentos) || []).slice().sort(function (a, b) { return a.data_hora < b.data_hora ? 1 : -1 })
    var agora = new Date().toISOString().slice(0, 16).replace('T', ' ')
    function linha(a) {
      var s = STATUS_AG[a.status] || STATUS_AG.agendado
      return '<tr><td>' + br(a.data_hora) + '</td><td>' + String(a.data_hora || '').slice(11, 16) + (a.hora_fim ? '–' + String(a.hora_fim).slice(0, 5) : '') + '</td><td>' + esc(a.prof_nome || a.profissional_nome || '—') + '</td>' +
        '<td class="hide-sm">' + esc([a.tipo, a.procedimento].filter(Boolean).join(' · ') || '—') + '</td><td class="hide-sm" style="color:var(--text3)">' + esc(a.observacoes || '') + '</td>' +
        '<td><span class="pc-badge" style="background:' + s[1] + '1A;color:' + s[1] + '">' + s[0] + '</span></td></tr>'
    }
    var futuros = ag.filter(function (a) { return a.data_hora >= agora }).reverse(), passados = ag.filter(function (a) { return a.data_hora < agora })
    var cab = '<thead><tr><th>Data</th><th>Horário</th><th>Profissional</th><th class="hide-sm">Categoria / procedimento</th><th class="hide-sm">Observação</th><th>Status</th></tr></thead>'
    var faltas = passados.filter(function (a) { return a.status === 'faltou' }).length
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px"><div class="ag-hint" style="margin:0">' + ag.length + ' agendamento(s) · ' + faltas + ' falta(s)</div>' +
      '<button class="ag-btn-novo" id="pca-novo">+ Agendar</button></div>' +
      (futuros.length ? '<div class="pc-box-h">Próximos</div><table class="pc-tbl" style="margin-bottom:16px">' + cab + '<tbody>' + futuros.map(linha).join('') + '</tbody></table>' : '') +
      '<div class="pc-box-h">Histórico</div>' + (passados.length ? '<table class="pc-tbl">' + cab + '<tbody>' + passados.map(linha).join('') + '</tbody></table>' : '<div class="pc-vazio">Sem histórico.</div>')
    el('pca-novo').onclick = function () { novoAgendamentoPaciente({ id: p.id, nome: p.nome, telefone: p.telefone }) }
  }

  // ── Indicações ───────────────────────────────────────────────────
  TABS.indicacoes = async function (box, p) {
    box.innerHTML = '<div style="color:var(--text3)">Carregando…</div>'
    try {
      var d = await apiData('paciente-indicacoes', { paciente_id: p.id }), rows = d.data || []
      box.innerHTML = (p.indicado_por_nome ? '<div class="pc-item" style="margin-bottom:16px">Este paciente foi indicado por <b>' + (p.indicado_por_id ? '<a href="#" id="pci-ind" style="color:var(--green)">' + esc(p.indicado_por_nome) + '</a>' : esc(p.indicado_por_nome)) + '</b>.</div>' : '') +
        '<div class="pc-box-h">Pacientes indicados por ' + esc(p.nome) + '</div>' +
        (rows.length ? '<table class="pc-tbl"><thead><tr><th>Paciente</th><th>Telefone</th><th>Cadastrado em</th><th>Situação</th></tr></thead><tbody>' + rows.map(function (x) {
          return '<tr class="clk" data-id="' + x.id + '" data-nome="' + esc(x.nome) + '"><td class="nome">' + esc(x.nome) + '</td><td>' + esc(x.telefone || '—') + '</td><td>' + br(x.criado_em) + '</td><td><span class="pc-badge ' + (x.ativo === 0 ? 'off">Inativo' : 'ok">Ativo') + '</span></td></tr>'
        }).join('') + '</tbody></table>' : '<div class="pc-vazio">Nenhuma indicação registrada. Ao cadastrar um paciente, escolha "Indicado por" para vincular.</div>')
      box.querySelectorAll('tr.clk').forEach(function (tr) { tr.onclick = function () { abrirProntuario(this.getAttribute('data-nome'), +this.getAttribute('data-id')) } })
      if (el('pci-ind')) el('pci-ind').onclick = function (e) { e.preventDefault(); abrirProntuario(p.indicado_por_nome, p.indicado_por_id) }
    } catch (e) { box.innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>' }
  }

  // ════════════════════════════════════════════════════════════════
  // CONFIGURAÇÕES › MODELOS DE DOCUMENTO
  // ════════════════════════════════════════════════════════════════
  var VARIAVEIS = ['paciente.nome', 'paciente.cpf', 'paciente.rg', 'paciente.data_nascimento', 'paciente.telefone', 'paciente.endereco_completo', 'paciente.responsavel',
    'profissional.nome', 'profissional.cro', 'profissional.especialidade', 'clinica.nome', 'clinica.razao_social', 'clinica.cnpj', 'clinica.endereco', 'clinica.cidade', 'clinica.telefone', 'data', 'data_extenso', 'hora']

  async function abrirModelosDocumento() {
    var d = await apiData('documento-modelos', {}), mods = d.data || []
    modal('Modelos de documento', '<div id="pcm-err"></div><table class="pc-tbl"><thead><tr><th>Modelo</th><th>Tipo</th><th></th></tr></thead><tbody>' +
      mods.map(function (m) { return '<tr><td>' + esc(m.nome) + '</td><td>' + esc(TIPOS_DOC[m.tipo] || m.tipo) + '</td><td style="text-align:right"><button class="btn btn-sm" data-ed="' + m.id + '">Editar</button></td></tr>' }).join('') +
      '</tbody></table>', '<button class="btn" id="pcm-f">Fechar</button><button class="ag-btn-novo" id="pcm-novo">+ Novo modelo</button>', 720)
    el('pcm-f').onclick = fecharModal
    el('pcm-novo').onclick = function () { editarModelo({ nome: '', tipo: 'outro', conteudo: '<p></p>' }) }
    document.querySelectorAll('#pc-m-b [data-ed]').forEach(function (b) { b.onclick = function () { editarModelo(mods.filter(function (m) { return m.id === +b.getAttribute('data-ed') })[0]) } })
  }

  function editarModelo(m) {
    modal(m.id ? 'Editar modelo' : 'Novo modelo', '<div id="pcm-err"></div><div class="ag-row c2"><div class="ag-f"><label>Nome</label><input class="ag-in" id="pcm-nome" maxlength="120" value="' + esc(m.nome) + '"></div>' +
      '<div class="ag-f"><label>Tipo</label><select class="ag-in" id="pcm-tipo">' + Object.keys(TIPOS_DOC).map(function (k) { return '<option value="' + k + '"' + (k === m.tipo ? ' selected' : '') + '>' + TIPOS_DOC[k] + '</option>' }).join('') + '</select></div></div>' +
      '<div class="ag-f"><label>Conteúdo</label><div class="pc-doc-ed" id="pcm-ed" contenteditable="true">' + m.conteudo + '</div></div>' +
      '<div class="ag-f"><label>Inserir campo</label><div class="ag-chips">' + VARIAVEIS.map(function (v) { return '<span class="ag-chip" data-var="' + v + '">' + v + '</span>' }).join('') + '</div><div class="ag-hint">Clique no texto onde o campo deve entrar e depois no campo. Ele é preenchido com os dados do paciente ao emitir.</div></div>',
      (m.id ? '<button class="btn" id="pcm-del" style="color:var(--red);margin-right:auto">Remover modelo</button>' : '') + '<button class="btn" id="pcm-voltar">Voltar</button><button class="ag-btn-novo" id="pcm-ok">Salvar modelo</button>', 860)
    var ed = el('pcm-ed'), range = null
    ed.addEventListener('keyup', guardar); ed.addEventListener('mouseup', guardar)
    function guardar() { var s = window.getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange() }
    document.querySelectorAll('#pc-m-b [data-var]').forEach(function (c) {
      c.onmousedown = function (e) { e.preventDefault() }
      c.onclick = function () {
        var txt = document.createTextNode('{{' + this.getAttribute('data-var') + '}}')
        if (range) { range.deleteContents(); range.insertNode(txt); range.setStartAfter(txt); range.collapse(true) } else ed.appendChild(txt)
      }
    })
    el('pcm-voltar').onclick = abrirModelosDocumento
    if (el('pcm-del')) el('pcm-del').onclick = async function () { if (!confirm('Remover este modelo? Documentos já emitidos continuam no prontuário.')) return; var r = await apiPost('documento-modelos', { action: 'delete', id: m.id }); if (!r.success) return erro('pcm-err', r.error || 'Erro'); abrirModelosDocumento() }
    el('pcm-ok').onclick = async function () {
      var r = await apiPost('documento-modelos', { id: m.id || undefined, nome: el('pcm-nome').value.trim(), tipo: el('pcm-tipo').value, conteudo: ed.innerHTML })
      if (!r.success) return erro('pcm-err', r.error || 'Erro ao salvar')
      abrirModelosDocumento()
    }
  }

  // ── Exportações ──────────────────────────────────────────────────
  window.loadPacientesLista = loadPacientesLista
  window.abrirCadastroPaciente = abrirCadastroPaciente
  window.pacAlternarAtivo = pacAlternarAtivo
  window.pacExcluir = pacExcluir
  window.pacImprimir = pacImprimir
  window.abrirModelosDocumento = abrirModelosDocumento
})()
