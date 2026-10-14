// public/agenda.js — Agenda (Fase 2)
// Klinov — Campo Grande, MS
//
// Substitui a agenda antiga de app.html. Mantém os nomes que o resto do app
// chama: loadAgenda, renderAgendaGrid, renderProfsList, renderMiniCal,
// openNovaConsulta, editarAgendamento, openApptPanel, closeApptPanel e o
// estado ST.agendamentos / ST.profissionais. Depende de apiData, apiPost,
// escHtml, escCssUrl, abrirProntuario, nav, KLINOV_USER e ST (app.html).
;(function () {
  'use strict'

  // ── Constantes ────────────────────────────────────────────────────
  var DIAS_C = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  var DIAS_L = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  var CORES_PROF = ['#1B5E3B', '#E65100', '#1976D2', '#00695C', '#D32F2F', '#7B1FA2', '#2E7D52', '#FF6D00', '#616161']
  var STATUS = [
    ['agendado', 'Agendado', '#757575'], ['confirmado', 'Confirmado', '#00695C'], ['em_espera', 'Em espera', '#FF6D00'],
    ['em_atendimento', 'Em atendimento', '#1976D2'], ['atendido', 'Atendido', '#2E7D52'], ['atrasado', 'Atrasado', '#D32F2F'],
    ['faltou', 'Faltou', '#212121'], ['desmarcado', 'Desmarcado', '#9E9E9E']
  ]
  var STATUS_MAP = {}
  STATUS.forEach(function (s) { STATUS_MAP[s[0]] = { rot: s[1], cor: s[2] } })
  STATUS_MAP.cancelado = STATUS_MAP.desmarcado
  STATUS_MAP.nao_confirmado = { rot: 'Não confirmado', cor: '#D32F2F' }
  var PX_MIN = 1.6 // altura por minuto na grade

  // ── Estado ────────────────────────────────────────────────────────
  var AG = {
    view: 'dia', data: hojeLocal(), mini: null, off: {}, cfg: null, cfgKey: '', meses: {},
    prefs: null, ed: null, popId: null
  }
  AG.mini = new Date(AG.data.getFullYear(), AG.data.getMonth(), 1)

  function hojeLocal() { var d = new Date(); d.setHours(0, 0, 0, 0); return d }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]) }
  function addDias(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x }
  function min(h) { if (!h) return 0; var p = String(h).split(':'); return (+p[0]) * 60 + (+p[1] || 0) }
  function hm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') }
  function br(s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0] }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function ini(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (x) { return x[0] }).join('').toUpperCase() }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() }
  function el(id) { return document.getElementById(id) }
  function toast(msg) { alert(msg) }

  // ── Preferências (por usuário, no navegador — como no Clinicorp) ──
  function prefKey() { return 'klinov_agenda_prefs_' + ((window.KLINOV_USER && KLINOV_USER.id) || 'x') }
  function loadPrefs() {
    var p = { sabado: true, domingo: false, desmarcados: true, foraExpediente: true, corCategoria: false, apagarPassados: true, intervalo: 15, inicio: '', fim: '' }
    try { var s = JSON.parse(localStorage.getItem(prefKey()) || '{}'); Object.keys(s).forEach(function (k) { p[k] = s[k] }) } catch (e) {}
    AG.prefs = p
  }
  function savePrefs() { try { localStorage.setItem(prefKey(), JSON.stringify(AG.prefs)) } catch (e) {} }

  // ── Dados ─────────────────────────────────────────────────────────
  function mapAg(a) {
    var dh = a.data_hora || ''
    return {
      id: a.id, date: dh.slice(0, 10), fromTime: dh.slice(11, 16), toTime: (a.hora_fim || '').slice(0, 5),
      paciente_id: a.paciente_id, PatientName: a.paciente_nome || '', patientName: a.paciente_nome || '',
      MobilePhone: a.paciente_telefone || '', paciente_foto: a.paciente_foto || '',
      ProfessionalId: a.profissional_id, professionalId: a.profissional_id, ProfessionalName: a.profissional_nome || '',
      CategoryDescription: a.tipo || '', categoria_id: a.categoria_id, status: a.status || 'agendado',
      procedureName: a.procedimento || '', observations: a.observacoes || '', primeira_consulta: a.primeira_consulta,
      serie_id: a.serie_id, criado_por_nome: a.criado_por_nome, criado_em: a.criado_em,
      confirmacao_envio: a.confirmacao_envio, canal_envio: a.canal_envio
    }
  }

  async function carregarMes(mes, forcar) {
    if (AG.meses[mes] && !forcar) return
    var d = await apiData('agendamentos', { mes: mes, limit: 5000 })
    var rows = (d.agendamentos || []).map(mapAg)
    ST.agendamentos = (ST.agendamentos || []).filter(function (a) { return (a.date || '').slice(0, 7) !== mes }).concat(rows)
    AG.meses[mes] = true
  }

  function intervaloVisivel() {
    if (AG.view === 'mes') {
      var a = new Date(AG.data.getFullYear(), AG.data.getMonth(), 1)
      return [addDias(a, -a.getDay()), addDias(new Date(AG.data.getFullYear(), AG.data.getMonth() + 1, 0), 6)]
    }
    if (AG.view === 'semana') { var s = addDias(AG.data, -AG.data.getDay()); return [s, addDias(s, 6)] }
    return [AG.data, AG.data]
  }

  async function carregarConfig(forcar) {
    var iv = intervaloVisivel()
    var de = ymd(addDias(iv[0], -7)), ate = ymd(addDias(iv[1], 35))
    var key = de.slice(0, 7)
    if (AG.cfg && AG.cfgKey === key && !forcar) return
    var c = await apiData('agenda-config', { de: de, ate: ate })
    AG.cfg = c
    AG.cfgKey = key
    // ST.profissionais no formato que o resto do app espera
    var cores = {}
    ;(c.profissionais || []).forEach(function (p, i) { cores[p.id] = p.cor_agenda || CORES_PROF[i % CORES_PROF.length] })
    AG.corProf = cores
    if (!ST.profissionais || !ST.profissionais.length || forcar) {
      ST.profissionais = (c.profissionais || []).filter(function (p) { return p.ativo !== 0 }).map(function (p) {
        return { id: p.id, nome: p.nome, name: p.nome, Name: p.nome, especialidade: p.especialidade, specialty: p.especialidade, cor_agenda: p.cor_agenda }
      })
    }
  }

  async function garantirDados(forcar) {
    var iv = intervaloVisivel()
    var meses = {}
    for (var d = new Date(iv[0]); d <= iv[1]; d = addDias(d, 7)) meses[ymd(d).slice(0, 7)] = 1
    meses[ymd(iv[1]).slice(0, 7)] = 1
    await carregarConfig(forcar)
    await Promise.all(Object.keys(meses).map(function (m) { return carregarMes(m, forcar) }))
  }

  function profsVisiveis() {
    return (ST.profissionais || []).filter(function (p) { return !AG.off[p.id] })
  }
  function corProf(id) { return (AG.corProf && AG.corProf[id]) || '#616161' }
  function categoriaDe(a) {
    var cats = (AG.cfg && AG.cfg.categorias) || []
    var c = null
    if (a.categoria_id) c = cats.filter(function (x) { return x.id === a.categoria_id })[0]
    if (!c && a.CategoryDescription) { var n = norm(a.CategoryDescription); c = cats.filter(function (x) { return norm(x.nome) === n })[0] }
    return c || null
  }
  function corEvento(a) {
    if (AG.prefs.corCategoria) { var c = categoriaDe(a); if (c) return c.cor }
    return corProf(a.ProfessionalId)
  }
  function desmarcado(a) { return a.status === 'desmarcado' || a.status === 'cancelado' }

  // ── Disponibilidade (horário da clínica e do profissional) ───────
  function intervalosDia(lista, dow) { return lista.filter(function (h) { return h.dia_semana === dow }) }
  function dentro(ints, m1, m2) { return ints.some(function (h) { return min(h.hora_inicio) <= m1 && m2 <= min(h.hora_fim) }) }
  function disponivel(profId, data, m1, m2) {
    if (!AG.cfg) return true
    var dow = data.getDay()
    var hc = AG.cfg.horarios_clinica || []
    if (hc.length && !dentro(intervalosDia(hc, dow), m1, m2)) return false
    if (profId) {
      var hp = (AG.cfg.horarios_profissionais || []).filter(function (h) { return h.profissional_id === profId })
      if (hp.length && !dentro(intervalosDia(hp, dow), m1, m2)) return false
    }
    return true
  }
  function bloqueiosDe(profId, dataStr) {
    return ((AG.cfg && AG.cfg.bloqueios) || []).filter(function (b) {
      return b.data === dataStr && (b.profissional_id == null || !profId || b.profissional_id === profId)
    })
  }
  function janelaDia() {
    var ini = AG.prefs.inicio ? min(AG.prefs.inicio) : null, fim = AG.prefs.fim ? min(AG.prefs.fim) : null
    var hc = (AG.cfg && AG.cfg.horarios_clinica) || []
    if (ini == null) ini = hc.length ? Math.min.apply(null, hc.map(function (h) { return min(h.hora_inicio) })) : 7 * 60
    if (fim == null) fim = hc.length ? Math.max.apply(null, hc.map(function (h) { return min(h.hora_fim) })) : 21 * 60
    ini = Math.floor(ini / 60) * 60; fim = Math.ceil(fim / 60) * 60
    if (fim <= ini) fim = ini + 60
    return [ini, fim]
  }

  // ── Render principal ─────────────────────────────────────────────
  function montarTela() {
    var pg = el('p-agenda')
    if (!pg || el('ag-main')) return
    pg.innerHTML =
      '<div class="ag-top">' +
        '<div class="ag-novo"><button class="ag-btn-novo" id="ag-btn-novo">+ Novo <span style="font-size:10px">▼</span></button>' +
          '<div class="ag-drop" id="novo-drop">' +
            '<div class="ag-drop-item" data-novo="consulta">Novo agendamento</div>' +
            '<div class="ag-drop-item" data-novo="compromisso">Novo compromisso / bloqueio</div>' +
            '<div class="ag-drop-item" data-novo="retorno">Alerta de retorno</div>' +
            '<div class="ag-drop-item" data-novo="espera">Lista de espera</div>' +
          '</div></div>' +
        '<button class="ag-ico" title="Anterior" id="ag-prev">‹</button>' +
        '<button class="ag-hoje" id="ag-hoje">Hoje</button>' +
        '<button class="ag-ico" title="Próximo" id="ag-next">›</button>' +
        '<div class="ag-title" id="ag-title"></div>' +
        '<button class="ag-ico" title="Atualizar" id="ag-refresh">⟳</button>' +
        '<div class="ag-spacer"></div>' +
        '<select class="ag-sel" id="ag-view"><option value="dia">Dia</option><option value="semana">Semana</option><option value="mes">Mês</option></select>' +
        '<button class="ag-ico" title="Imprimir agenda do dia" id="ag-print-btn">⎙</button>' +
        '<button class="ag-ico" title="Configurações da agenda" id="ag-prefs-btn">⚙</button>' +
      '</div>' +
      '<div class="ag-body">' +
        '<div class="ag-left">' +
          '<div class="ag-mini" id="ag-mini"></div>' +
          '<div class="ag-sec"><div class="ag-sec-h">Profissionais <a id="ag-todos">Todos</a></div><div id="ag-profs"></div></div>' +
          '<div class="ag-sec"><div class="ag-sec-h">Alertas de retorno <a data-novo="retorno">+ Novo</a></div><div id="ag-alertas"></div></div>' +
          '<div class="ag-sec"><div class="ag-sec-h">Lista de espera <a data-novo="espera">+ Novo</a></div><div id="ag-espera"></div></div>' +
        '</div>' +
        '<div class="ag-main" id="ag-main"><div style="padding:40px;text-align:center;color:var(--text3)">Carregando agenda...</div></div>' +
      '</div>'

    el('ag-btn-novo').onclick = function (e) { e.stopPropagation(); el('novo-drop').classList.toggle('open') }
    pg.addEventListener('click', function (e) {
      var n = e.target.closest('[data-novo]')
      if (n) { el('novo-drop').classList.remove('open'); abrirNovo(n.getAttribute('data-novo')); return }
      if (!e.target.closest('.ag-novo')) el('novo-drop').classList.remove('open')
    })
    el('ag-prev').onclick = function () { mover(-1) }
    el('ag-next').onclick = function () { mover(1) }
    el('ag-hoje').onclick = function () { AG.data = hojeLocal(); AG.mini = new Date(AG.data.getFullYear(), AG.data.getMonth(), 1); atualizar() }
    el('ag-refresh').onclick = function () { AG.meses = {}; atualizar(true) }
    el('ag-view').onchange = function () { AG.view = this.value; window.agendaView = AG.view; atualizar() }
    el('ag-todos').onclick = function () {
      var todos = (ST.profissionais || []).every(function (p) { return !AG.off[p.id] })
      ;(ST.profissionais || []).forEach(function (p) { AG.off[p.id] = todos })
      renderTudo()
    }
    el('ag-print-btn').onclick = imprimir
    el('ag-prefs-btn').onclick = abrirPrefs
  }

  function mover(n) {
    if (AG.view === 'mes') AG.data = new Date(AG.data.getFullYear(), AG.data.getMonth() + n, 1)
    else AG.data = addDias(AG.data, AG.view === 'semana' ? 7 * n : n)
    AG.mini = new Date(AG.data.getFullYear(), AG.data.getMonth(), 1)
    atualizar()
  }

  async function atualizar(forcar) {
    window.agendaDate = AG.data
    try { await garantirDados(forcar) } catch (e) {
      var m = el('ag-main'); if (m) m.innerHTML = '<div class="ag-err" style="margin:24px">' + esc(e.message) + '</div>'
      return
    }
    renderTudo()
  }

  function renderTudo() {
    if (!el('ag-main')) return
    el('ag-view').value = AG.view
    el('ag-title').textContent = tituloPeriodo()
    renderMini(); renderProfs(); renderAlertas(); renderEspera()
    if (AG.view === 'mes') renderMes(); else renderGrade()
  }

  function tituloPeriodo() {
    if (AG.view === 'mes') return MESES[AG.data.getMonth()].replace(/^./, function (c) { return c.toUpperCase() }) + ' de ' + AG.data.getFullYear()
    if (AG.view === 'semana') {
      var s = addDias(AG.data, -AG.data.getDay()), f = addDias(s, 6)
      return 'De ' + s.getDate() + (s.getMonth() !== f.getMonth() ? ' de ' + MESES[s.getMonth()] : '') + ' a ' + f.getDate() + ' de ' + MESES[f.getMonth()] + ' de ' + f.getFullYear()
    }
    return DIAS_L[AG.data.getDay()] + ', ' + AG.data.getDate() + ' de ' + MESES[AG.data.getMonth()] + ' de ' + AG.data.getFullYear()
  }

  // ── Coluna esquerda ──────────────────────────────────────────────
  function renderMini() {
    var box = el('ag-mini'); if (!box) return
    var m = AG.mini, hoje = ymd(hojeLocal()), sel = ymd(AG.data)
    var semIni = addDias(AG.data, -AG.data.getDay()), semFim = addDias(semIni, 6)
    var first = new Date(m.getFullYear(), m.getMonth(), 1), start = addDias(first, -first.getDay())
    var h = '<div class="ag-mini-nav"><button class="ag-ico" data-mini="-1">‹</button>' + MESES[m.getMonth()] + ' ' + m.getFullYear() + '<button class="ag-ico" data-mini="1">›</button></div><div class="ag-mini-grid">'
    DIAS_C.forEach(function (d) { h += '<div class="ag-mini-dh">' + d.slice(0, 1) + '</div>' })
    for (var i = 0; i < 42; i++) {
      var d = addDias(start, i), s = ymd(d)
      var cls = 'ag-mini-d' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (s === hoje ? ' hoje' : '') + (s === sel ? ' sel' : '') +
        (AG.view === 'semana' && d >= semIni && d <= semFim && s !== sel ? ' wk' : '')
      h += '<div class="' + cls + '" data-dia="' + s + '">' + d.getDate() + '</div>'
    }
    box.innerHTML = h + '</div>'
    box.querySelectorAll('[data-mini]').forEach(function (b) { b.onclick = function () { AG.mini = new Date(AG.mini.getFullYear(), AG.mini.getMonth() + (+this.getAttribute('data-mini')), 1); renderMini() } })
    box.querySelectorAll('[data-dia]').forEach(function (b) {
      b.onclick = function () { AG.data = parseYmd(this.getAttribute('data-dia')); if (AG.view === 'mes') AG.view = 'dia'; atualizar() }
    })
  }

  function renderProfs() {
    var box = el('ag-profs'); if (!box) return
    var ps = ST.profissionais || []
    if (!ps.length) { box.innerHTML = '<div class="ag-empty">Nenhum profissional cadastrado.</div>'; return }
    box.innerHTML = ps.map(function (p) {
      var on = !AG.off[p.id], c = corProf(p.id)
      return '<div class="ag-prof" data-prof="' + p.id + '"><div class="ag-prof-box" style="border-color:' + c + ';background:' + (on ? c : 'transparent') + '">' +
        (on ? '<svg width="9" height="9" viewBox="0 0 12 12"><path d="M1 6l4 4 6-6" stroke="#fff" stroke-width="2" fill="none"/></svg>' : '') +
        '</div><span class="ag-prof-nome">' + esc(p.nome) + '</span></div>'
    }).join('')
    box.querySelectorAll('[data-prof]').forEach(function (b) { b.onclick = function () { var id = +this.getAttribute('data-prof'); AG.off[id] = !AG.off[id]; renderTudo() } })
  }

  function renderAlertas() {
    var box = el('ag-alertas'); if (!box) return
    var lista = (AG.cfg && AG.cfg.alertas_retorno) || [], hoje = ymd(hojeLocal())
    if (!lista.length) { box.innerHTML = '<div class="ag-empty">Nenhum alerta pendente.</div>'; return }
    box.innerHTML = lista.slice(0, 30).map(function (a) {
      return '<div class="ag-list-item" data-alerta="' + a.id + '" title="Clique para agendar"><b>' + esc(a.paciente_nome) + '</b>' +
        '<span class="' + (a.data_retorno < hoje ? 'late' : '') + '">' + br(a.data_retorno) + '</span>' + (a.motivo ? ' · ' + esc(a.motivo) : '') + '</div>'
    }).join('') + (lista.length > 30 ? '<div class="ag-empty">+ ' + (lista.length - 30) + ' alertas</div>' : '')
    box.querySelectorAll('[data-alerta]').forEach(function (b) { b.onclick = function () { acaoAlerta(+this.getAttribute('data-alerta')) } })
  }

  function renderEspera() {
    var box = el('ag-espera'); if (!box) return
    var lista = (AG.cfg && AG.cfg.lista_espera) || []
    if (!lista.length) { box.innerHTML = '<div class="ag-empty">Ninguém na lista de espera.</div>'; return }
    box.innerHTML = lista.map(function (l) {
      return '<div class="ag-list-item" data-espera="' + l.id + '" title="Clique para agendar"><b>' + esc(l.paciente_nome) + '</b>' +
        esc(l.preferencia || 'Qualquer horário') + '</div>'
    }).join('')
    box.querySelectorAll('[data-espera]').forEach(function (b) { b.onclick = function () { acaoEspera(+this.getAttribute('data-espera')) } })
  }

  // ── Grade dia / semana ───────────────────────────────────────────
  function colunas() {
    if (AG.view === 'dia') {
      return profsVisiveis().map(function (p) {
        return { titulo: p.nome, sub: '', data: AG.data, prof: p.id, cor: corProf(p.id), clk: null }
      })
    }
    var s = addDias(AG.data, -AG.data.getDay()), cols = []
    for (var i = 0; i < 7; i++) {
      var d = addDias(s, i)
      if ((d.getDay() === 0 && !AG.prefs.domingo) || (d.getDay() === 6 && !AG.prefs.sabado)) continue
      cols.push({ titulo: DIAS_L[d.getDay()] + ', ' + d.getDate(), sub: '', data: d, prof: null, cor: null, clk: ymd(d) })
    }
    return cols
  }

  function eventosDa(col) {
    var ds = ymd(col.data), visiveis = {}
    profsVisiveis().forEach(function (p) { visiveis[p.id] = 1 })
    return (ST.agendamentos || []).filter(function (a) {
      if (a.date !== ds) return false
      if (!AG.prefs.desmarcados && desmarcado(a)) return false
      if (col.prof) return a.ProfessionalId === col.prof
      return !a.ProfessionalId || visiveis[a.ProfessionalId]
    })
  }

  // distribui eventos sobrepostos em faixas lado a lado
  function faixas(evs) {
    var items = evs.map(function (a) { var i = min(a.fromTime), f = min(a.toTime) || i + 30; return { a: a, i: i, f: Math.max(f, i + 10) } })
      .sort(function (x, y) { return x.i - y.i || y.f - x.f })
    var grupos = [], atual = [], fimGrupo = -1
    items.forEach(function (it) {
      if (it.i >= fimGrupo && atual.length) { grupos.push(atual); atual = [] }
      atual.push(it); fimGrupo = Math.max(fimGrupo, it.f)
    })
    if (atual.length) grupos.push(atual)
    grupos.forEach(function (g) {
      var lanes = []
      g.forEach(function (it) {
        var l = 0
        while (lanes[l] != null && lanes[l] > it.i) l++
        lanes[l] = it.f; it.lane = l
      })
      g.forEach(function (it) { it.lanes = lanes.length })
    })
    return items
  }

  function renderGrade() {
    var main = el('ag-main'), cols = colunas()
    if (!cols.length) { main.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Nenhum profissional selecionado.</div>'; return }
    var jan = janelaDia(), passo = +AG.prefs.intervalo || 15, H = Math.round(passo * PX_MIN)
    var agora = new Date(), hojeS = ymd(hojeLocal()), agoraMin = agora.getHours() * 60 + agora.getMinutes()
    var h = '<div class="ag-grid" style="grid-template-columns:56px repeat(' + cols.length + ',minmax(150px,1fr))">'
    h += '<div class="ag-corner"></div>'
    cols.forEach(function (c) {
      var n = eventosDa(c).filter(function (a) { return !desmarcado(a) }).length
      h += '<div class="ag-head' + (ymd(c.data) === hojeS && !c.prof ? ' hoje' : '') + (c.clk ? ' clk" data-irdia="' + c.clk : '') + '">' + esc(c.titulo) +
        '<small>' + n + ' paciente' + (n === 1 ? '' : 's') + '</small>' + (c.cor ? '<div class="ag-head-bar" style="background:' + c.cor + '"></div>' : '') + '</div>'
    })
    // eixo de horário
    h += '<div class="ag-times">'
    for (var t = jan[0]; t < jan[1]; t += passo) h += '<div class="ag-time" style="height:' + H + 'px;line-height:' + (t % 60 === 0 ? H : H) + 'px">' + (t % 60 === 0 ? hm(t) : '<span style="opacity:.6">' + hm(t) + '</span>') + '</div>'
    h += '</div>'
    // colunas
    cols.forEach(function (c, ci) {
      var ds = ymd(c.data)
      h += '<div class="ag-col" data-col="' + ci + '" style="height:' + ((jan[1] - jan[0]) / passo * H) + 'px">'
      for (var s = jan[0]; s < jan[1]; s += passo) {
        var off = AG.prefs.foraExpediente && !disponivel(c.prof, c.data, s, s + passo)
        h += '<div class="ag-slot' + ((s + passo) % 60 === 0 ? ' h' : '') + (off ? ' off' : '') + '" style="height:' + H + 'px" data-slot="' + hm(s) + '"></div>'
      }
      bloqueiosDe(c.prof, ds).forEach(function (b) {
        var top = (min(b.hora_inicio) - jan[0]) * PX_MIN, alt = (min(b.hora_fim) - min(b.hora_inicio)) * PX_MIN
        if (top + alt <= 0 || top >= (jan[1] - jan[0]) * PX_MIN) return
        h += '<div class="ag-blk" data-blk="' + b.id + '" style="top:' + Math.max(0, top) + 'px;height:' + Math.max(16, alt) + 'px" title="' + esc(b.titulo) + '"><b>' + esc(b.titulo) + '</b> ' + b.hora_inicio + '–' + b.hora_fim +
          (b.profissional_id == null ? '' : '') + '</div>'
      })
      faixas(eventosDa(c)).forEach(function (it) {
        var a = it.a, top = (it.i - jan[0]) * PX_MIN, alt = Math.max(18, (it.f - it.i) * PX_MIN - 1)
        var larg = 100 / it.lanes, esq = larg * it.lane
        var st = STATUS_MAP[a.status] || STATUS_MAP.agendado
        var passado = AG.prefs.apagarPassados && (a.date < hojeS || (a.date === hojeS && it.f < agoraMin))
        h += '<div class="ag-ev' + (passado ? ' past' : '') + (desmarcado(a) ? ' desm' : '') + '" data-ev="' + a.id + '" style="top:' + top + 'px;height:' + alt + 'px;left:calc(' + esq + '% + 2px);width:calc(' + larg + '% - 4px);background:' + corEvento(a) + '">' +
          '<b><span class="st" style="background:' + st.cor + '"></span>' + esc(a.PatientName || 'Paciente') + '</b>' +
          (alt > 30 ? '<span>' + a.fromTime + (a.toTime ? '–' + a.toTime : '') + (AG.view === 'semana' && a.ProfessionalName ? ' · ' + esc(a.ProfessionalName.split(' ')[0]) : '') + '</span>' : '') +
          (alt > 46 && a.CategoryDescription ? '<br><span style="opacity:.85">' + esc(a.CategoryDescription) + '</span>' : '') + '</div>'
      })
      if (ds === hojeS && agoraMin >= jan[0] && agoraMin < jan[1]) h += '<div class="ag-now" style="top:' + ((agoraMin - jan[0]) * PX_MIN) + 'px"></div>'
      h += '</div>'
    })
    main.innerHTML = h + '</div>'

    main.querySelectorAll('[data-irdia]').forEach(function (x) { x.onclick = function () { AG.data = parseYmd(this.getAttribute('data-irdia')); AG.view = 'dia'; atualizar() } })
    main.querySelectorAll('.ag-col').forEach(function (colEl) {
      var c = cols[+colEl.getAttribute('data-col')]
      colEl.addEventListener('click', function (e) {
        var ev = e.target.closest('[data-ev]')
        if (ev) { e.stopPropagation(); openApptPanel(+ev.getAttribute('data-ev'), ev); return }
        var blk = e.target.closest('[data-blk]')
        if (blk) { e.stopPropagation(); acaoBloqueio(+blk.getAttribute('data-blk')); return }
        var slot = e.target.closest('[data-slot]')
        if (slot && !slot.classList.contains('off')) abrirConsulta({ data: ymd(c.data), hora: slot.getAttribute('data-slot'), profissional_id: c.prof })
      })
    })
    // rola para o horário atual ou para o início do expediente
    var alvo = ymd(AG.data) === hojeS ? agoraMin - 60 : jan[0]
    main.scrollTop = Math.max(0, (alvo - jan[0]) * PX_MIN)
  }

  // ── Mês ──────────────────────────────────────────────────────────
  function renderMes() {
    var main = el('ag-main'), first = new Date(AG.data.getFullYear(), AG.data.getMonth(), 1), start = addDias(first, -first.getDay())
    var hojeS = ymd(hojeLocal()), visiveis = {}
    profsVisiveis().forEach(function (p) { visiveis[p.id] = 1 })
    var porDia = {}
    ;(ST.agendamentos || []).forEach(function (a) {
      if (desmarcado(a) || (a.ProfessionalId && !visiveis[a.ProfessionalId])) return
      ;(porDia[a.date] = porDia[a.date] || []).push(a)
    })
    var h = '<div class="ag-month">'
    DIAS_C.forEach(function (d) { h += '<div class="mh">' + d + '</div>' })
    var semanas = Math.ceil((first.getDay() + new Date(AG.data.getFullYear(), AG.data.getMonth() + 1, 0).getDate()) / 7)
    for (var i = 0; i < semanas * 7; i++) {
      var d = addDias(start, i), s = ymd(d), evs = (porDia[s] || []).sort(function (x, y) { return x.fromTime < y.fromTime ? -1 : 1 })
      var bls = bloqueiosDe(null, s).filter(function (b) { return b.profissional_id == null })
      h += '<div class="mc' + (d.getMonth() !== first.getMonth() ? ' out' : '') + (s === hojeS ? ' hoje' : '') + '" data-irdia="' + s + '"><div class="md">' + d.getDate() + '</div>'
      bls.forEach(function (b) { h += '<div class="mi" style="background:var(--gray6)">' + esc(b.titulo) + '</div>' })
      evs.slice(0, 3).forEach(function (a) { h += '<div class="mi" style="background:' + corEvento(a) + '">' + a.fromTime + ' ' + esc((a.PatientName || '').split(' ')[0]) + '</div>' })
      if (evs.length > 3) h += '<div class="mm">+ ' + (evs.length - 3) + ' agendamentos</div>'
      h += '</div>'
    }
    main.innerHTML = h + '</div>'
    main.querySelectorAll('[data-irdia]').forEach(function (x) { x.onclick = function () { AG.data = parseYmd(this.getAttribute('data-irdia')); AG.view = 'dia'; atualizar() } })
  }

  // ── Popover do agendamento ───────────────────────────────────────
  function achar(id) { return (ST.agendamentos || []).filter(function (a) { return a.id === id })[0] }

  function openApptPanel(id, ancora) {
    var a = achar(id); if (!a) return
    AG.popId = id
    var ov = el('ag-pop-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'ag-pop-ov'; ov.className = 'ag-pop-ov'; document.body.appendChild(ov) }
    var cor = corEvento(a), st = STATUS_MAP[a.status] || STATUS_MAP.agendado, cat = categoriaDe(a)
    var tel = (a.MobilePhone || '').replace(/\D/g, '')
    var d = parseYmd(a.date)
    ov.innerHTML = '<div class="ag-pop" id="ag-pop">' +
      '<div class="ag-pop-bar" style="background:' + cor + '"></div>' +
      '<div class="ag-pop-h"><div class="ag-av" style="' + (a.paciente_foto ? 'background-image:url(' + escCssUrl(a.paciente_foto) + ')' : 'background:' + cor) + '">' + (a.paciente_foto ? '' : esc(ini(a.PatientName))) + '</div>' +
        '<div style="flex:1;min-width:0"><div class="ag-pop-nome">' + esc(a.PatientName) + (a.primeira_consulta ? ' <span class="ag-badge" style="background:#FFF3E0;color:var(--orange)">1ª consulta</span>' : '') + '</div>' +
        '<div class="ag-pop-tel">' + (a.MobilePhone ? esc(a.MobilePhone) : 'Sem telefone') + '</div></div>' +
        '<button class="ag-ico" data-pop="fechar" title="Fechar">✕</button></div>' +
      '<div class="ag-pop-acts">' +
        (a.paciente_id ? '<button class="btn btn-sm" data-pop="prontuario">Prontuário</button>' : '') +
        (tel ? '<button class="btn btn-sm" data-pop="whatsapp">WhatsApp</button>' : '') +
        '<button class="btn btn-sm" data-pop="editar">Editar</button>' +
        (!desmarcado(a) ? '<button class="btn btn-sm" data-pop="desmarcar">Desmarcar</button>' : '') +
        '<button class="btn btn-sm" data-pop="excluir" style="color:var(--red)">Excluir</button>' +
      '</div>' +
      '<div class="ag-fin" id="ag-pop-fin" style="background:var(--gray2);color:var(--text3)">Verificando financeiro…</div>' +
      '<div class="ag-pop-row"><div class="lbl">Quando</div>' + DIAS_L[d.getDay()] + ', ' + br(a.date) + ' · ' + a.fromTime + (a.toTime ? '–' + a.toTime : '') + '<br><span style="color:var(--text3)">' + esc(a.ProfessionalName || 'Sem profissional') + '</span></div>' +
      (cat || a.CategoryDescription || a.procedureName ? '<div class="ag-pop-row"><div class="lbl">Categoria</div>' +
        (cat ? '<span class="ag-badge" style="background:' + cat.cor + ';color:#fff">' + esc(cat.nome) + '</span>' : esc(a.CategoryDescription)) +
        (a.procedureName ? '<div style="margin-top:4px">' + esc(a.procedureName) + '</div>' : '') + '</div>' : '') +
      (a.observations ? '<div class="ag-pop-row"><div class="lbl">Observações</div>' + esc(a.observations) + '</div>' : '') +
      '<div class="ag-pop-foot"><span>' + (a.criado_por_nome ? 'Agendado por ' + esc(a.criado_por_nome) + (a.criado_em ? ' em ' + br(a.criado_em) + ' ' + String(a.criado_em).slice(11, 16) : '') : 'Agendamento #' + a.id) + (a.serie_id ? ' · série' : '') + '</span>' +
        '<select class="ag-sel" id="ag-pop-status" style="border-color:' + st.cor + '">' +
        STATUS.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === a.status || (s[0] === 'desmarcado' && a.status === 'cancelado') ? ' selected' : '') + '>' + s[1] + '</option>' }).join('') +
        '</select></div></div>'
    ov.classList.add('open')
    posicionarPop(ancora)
    ov.onclick = function (e) { if (e.target === ov) closeApptPanel() }
    ov.querySelectorAll('[data-pop]').forEach(function (b) { b.onclick = function () { acaoPop(this.getAttribute('data-pop'), a) } })
    el('ag-pop-status').onchange = function () { mudarStatus(a.id, this.value) }
    if (a.paciente_id) {
      apiData('agenda-situacao-paciente', { paciente_id: a.paciente_id }).then(function (s) {
        var f = el('ag-pop-fin'); if (!f || AG.popId !== a.id) return
        if (s.parcelas_vencidas > 0) { f.className = 'ag-fin pend'; f.textContent = s.parcelas_vencidas + ' parcela' + (s.parcelas_vencidas > 1 ? 's' : '') + ' vencida' + (s.parcelas_vencidas > 1 ? 's' : '') + ' · R$ ' + s.valor_vencido.toFixed(2).replace('.', ',') }
        else { f.className = 'ag-fin ok'; f.textContent = 'Financeiro OK' }
      }).catch(function () { var f = el('ag-pop-fin'); if (f) f.remove() })
    } else { var f0 = el('ag-pop-fin'); if (f0) f0.remove() }
  }

  function posicionarPop(ancora) {
    var pop = el('ag-pop'); if (!pop) return
    var w = pop.offsetWidth, hgt = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight
    var x = (vw - w) / 2, y = 80
    if (ancora && ancora.getBoundingClientRect) {
      var r = ancora.getBoundingClientRect()
      x = r.right + 8; if (x + w > vw - 16) x = r.left - w - 8; if (x < 16) x = Math.max(16, (vw - w) / 2)
      y = Math.min(Math.max(16, r.top), vh - hgt - 16)
    }
    pop.style.left = x + 'px'; pop.style.top = Math.max(16, y) + 'px'
  }

  function closeApptPanel() { var ov = el('ag-pop-ov'); if (ov) ov.classList.remove('open'); AG.popId = null }

  async function acaoPop(acao, a) {
    if (acao === 'fechar') return closeApptPanel()
    if (acao === 'prontuario') { closeApptPanel(); return abrirProntuario(a.PatientName, a.paciente_id) }
    if (acao === 'whatsapp') return window.open('https://wa.me/55' + (a.MobilePhone || '').replace(/\D/g, '').replace(/^55/, ''), '_blank')
    if (acao === 'editar') { closeApptPanel(); return editarAgendamento(a.id) }
    if (acao === 'desmarcar') return mudarStatus(a.id, 'desmarcado')
    if (acao === 'excluir') {
      if (!confirm('Excluir este agendamento? Ele vai para a lixeira (Configurações › Administração de Dados).')) return
      var r = await apiPost('excluir-agendamento', { id: a.id })
      if (!r.success) return toast(r.error || 'Erro ao excluir')
      ST.agendamentos = ST.agendamentos.filter(function (x) { return x.id !== a.id })
      closeApptPanel(); renderTudo()
    }
  }

  async function mudarStatus(id, st) {
    var r = await apiPost('salvar-agendamento', { id: id, paciente_nome: '_keep_', status: st })
    if (!r.success) return toast(r.error || 'Erro ao mudar status')
    var a = achar(id); if (a) a.status = st
    renderTudo(); if (AG.popId === id) openApptPanel(id, document.querySelector('[data-ev="' + id + '"]'))
  }

  // ── Modal genérico ───────────────────────────────────────────────
  function modal(titulo, corpo, botoes, largura) {
    var ov = el('ag-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'ag-modal-ov'; ov.className = 'ag-modal-ov'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 720) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="ag-m-x">✕</button></div>' +
      '<div class="ag-modal-b" id="ag-m-b">' + corpo + '</div><div class="ag-modal-f" id="ag-m-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('ag-m-x').onclick = fecharModal
    ov.onmousedown = function (e) { if (e.target === ov) fecharModal() }
    return ov
  }
  function fecharModal() { var ov = el('ag-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }

  // busca de paciente reutilizável: monta em #<prefixo>-pac
  function campoPaciente(prefixo, aoEscolher, permitirNovo) {
    var box = el(prefixo + '-pac')
    function desenhar(sel) {
      if (sel) {
        box.innerHTML = '<div class="ag-pac-sel"><span><b>' + esc(sel.nome) + '</b>' + (sel.telefone ? ' <small style="color:var(--text3)">' + esc(sel.telefone) + '</small>' : '') + '</span><button class="ag-ico" id="' + prefixo + '-pac-x">✕</button></div>'
        el(prefixo + '-pac-x').onclick = function () { aoEscolher(null); desenhar(null) }
        return
      }
      box.innerHTML = '<input class="ag-in" id="' + prefixo + '-pac-q" placeholder="Buscar paciente por nome ou telefone" autocomplete="off"><div id="' + prefixo + '-pac-d"></div>'
      var t = null
      el(prefixo + '-pac-q').oninput = function () {
        var q = this.value.trim(); clearTimeout(t)
        var d = el(prefixo + '-pac-d')
        if (q.length < 2) { d.innerHTML = ''; return }
        t = setTimeout(async function () {
          try {
            var r = await apiData('busca', { q: q })
            var ps = r.pacientes || []
            d.innerHTML = '<div class="ag-pac-drop">' +
              (permitirNovo ? '<div class="ag-pac-it" data-novo-pac="1" style="color:var(--green);font-weight:500">+ Cadastrar novo paciente: ' + esc(q.toUpperCase()) + '</div>' : '') +
              ps.map(function (p, i) { return '<div class="ag-pac-it" data-i="' + i + '">' + esc(p.nome) + '<small>' + esc(p.telefone || '') + '</small></div>' }).join('') +
              (!ps.length && !permitirNovo ? '<div class="ag-pac-it" style="color:var(--text3)">Nenhum paciente encontrado</div>' : '') + '</div>'
            d.querySelectorAll('[data-i]').forEach(function (it) { it.onclick = function () { var p = ps[+this.getAttribute('data-i')]; aoEscolher(p); desenhar(p) } })
            var nv = d.querySelector('[data-novo-pac]')
            if (nv) nv.onclick = function () { cadastroRapido(q.toUpperCase(), function (p) { aoEscolher(p); desenhar(p) }) }
          } catch (e) { d.innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>' }
        }, 250)
      }
      setTimeout(function () { var i = el(prefixo + '-pac-q'); if (i) i.focus() }, 30)
    }
    return desenhar
  }

  function cadastroRapido(nome, pronto) {
    // cadastro completo (paciente.js) quando disponível
    if (window.abrirCadastroPaciente) { abrirCadastroPaciente(pronto); var n = document.getElementById('pcn-nome'); if (n) n.value = nome; return }
    var tel = prompt('Celular / WhatsApp de ' + nome + ' (opcional):', '')
    if (tel === null) return
    apiPost('salvar-paciente', { nome: nome, telefone: tel, whatsapp: tel }).then(function (r) {
      if (!r.success) return toast(r.error || 'Erro ao cadastrar paciente')
      pronto({ id: r.id, nome: nome, telefone: tel })
    })
  }

  function optsProf(sel, rotuloVazio) {
    return (rotuloVazio ? '<option value="">' + rotuloVazio + '</option>' : '') + (ST.profissionais || []).map(function (p) {
      return '<option value="' + p.id + '"' + (String(sel) === String(p.id) ? ' selected' : '') + '>' + esc(p.nome) + '</option>'
    }).join('')
  }

  // ── Novo / editar agendamento ────────────────────────────────────
  function abrirNovo(tipo) {
    if (tipo === 'compromisso') return abrirCompromisso({})
    if (tipo === 'retorno') return abrirRetorno({})
    if (tipo === 'espera') return abrirEspera()
    abrirConsulta({})
  }

  function openNovaConsulta(profId, hora) {
    abrirConsulta({ profissional_id: profId ? +profId : null, hora: hora || '', data: ymd(AG.data) })
  }

  function editarAgendamento(id) {
    var a = achar(id); if (!a) return
    abrirConsulta({
      id: a.id, paciente: a.paciente_id ? { id: a.paciente_id, nome: a.PatientName, telefone: a.MobilePhone } : { id: null, nome: a.PatientName },
      data: a.date, hora: a.fromTime, duracao: Math.max(5, (min(a.toTime) || min(a.fromTime) + 30) - min(a.fromTime)),
      profissional_id: a.ProfessionalId, categoria_id: (categoriaDe(a) || {}).id, observacoes: a.observations, procedimento: a.procedureName,
      primeira_consulta: a.primeira_consulta, status: a.status, confirmacao_envio: a.confirmacao_envio, canal_envio: a.canal_envio
    })
  }

  function abrirConsulta(o) {
    var ed = AG.ed = {
      id: o.id || null, paciente: o.paciente || null, data: o.data || ymd(AG.data), hora: o.hora || '',
      duracao: o.duracao || 30, profissional_id: o.profissional_id || (profsVisiveis()[0] || {}).id || '',
      categoria_id: o.categoria_id || '', alerta_retorno_id: o.alerta_retorno_id || null, lista_espera_id: o.lista_espera_id || null
    }
    var cats = (AG.cfg && AG.cfg.categorias) || []
    var corpo =
      (ed.id ? '' : '<div class="ag-tabs"><div class="ag-tab on">Consulta</div><div class="ag-tab" id="ag-tab-comp">Compromisso</div></div>') +
      '<div id="ag-c-err"></div>' +
      '<div class="ag-f"><label>Paciente</label><div id="agc-pac"></div></div>' +
      '<div class="ag-f"><label class="ag-chk"><input type="checkbox" id="agc-primeira"' + (o.primeira_consulta ? ' checked' : '') + '> Primeira consulta</label>' +
        (ed.id ? '' : '<label class="ag-chk"><input type="checkbox" id="agc-rep"> Repetir (múltiplos agendamentos)</label>') + '</div>' +
      (ed.id ? '' : '<div class="ag-row c2 ag-f" id="agc-rep-box" style="display:none"><div><label>Quantas vezes</label><input class="ag-in" type="number" min="2" max="52" value="4" id="agc-rep-n"></div>' +
        '<div><label>A cada</label><select class="ag-in" id="agc-rep-c"><option value="7">1 semana</option><option value="14">2 semanas</option><option value="21">3 semanas</option><option value="28">4 semanas</option><option value="30">30 dias</option><option value="1">1 dia</option></select></div></div>') +
      '<div class="ag-row c4 ag-f">' +
        '<div><label>Data</label><input class="ag-in" type="date" id="agc-data" value="' + ed.data + '"></div>' +
        '<div><label>Profissional</label><select class="ag-in" id="agc-prof">' + optsProf(ed.profissional_id, 'Sem profissional') + '</select></div>' +
        '<div><label>Categoria</label><select class="ag-in" id="agc-cat"><option value="">Selecione</option>' + cats.map(function (c) { return '<option value="' + c.id + '"' + (String(c.id) === String(ed.categoria_id) ? ' selected' : '') + '>' + esc(c.nome) + '</option>' }).join('') + '</select>' +
          '<div class="ag-hint"><a href="#" id="agc-cats" style="color:var(--blue)">Editar categorias</a></div></div>' +
        '<div><label>Duração</label><select class="ag-in" id="agc-dur">' + [10, 15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240].map(function (m) { return '<option value="' + m + '"' + (m === ed.duracao ? ' selected' : '') + '>' + (m < 60 ? m + ' min' : (m / 60) + ' h') + '</option>' }).join('') +
          (([10, 15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240].indexOf(ed.duracao) === -1) ? '<option value="' + ed.duracao + '" selected>' + ed.duracao + ' min</option>' : '') + '</select></div>' +
      '</div>' +
      '<div class="ag-f"><label>Horário <span id="agc-hora-sel" style="text-transform:none;letter-spacing:0;color:var(--text)"></span></label><div class="ag-chips" id="agc-chips"></div>' +
        '<div class="ag-hint">Outro horário: <input type="time" id="agc-hora-livre" class="ag-in" style="width:120px;padding:4px 8px;display:inline-block" value="' + ed.hora + '"></div></div>' +
      '<div class="ag-row c2 ag-f"><div><label>Procedimento</label><input class="ag-in" id="agc-proc" maxlength="200" value="' + esc(o.procedimento || '') + '"></div>' +
        '<div><label>Observações</label><input class="ag-in" id="agc-obs" maxlength="1000" value="' + esc(o.observacoes || '') + '"></div></div>' +
      '<div class="ag-row c2 ag-f"><div><label>Confirmação</label><select class="ag-in" id="agc-conf">' +
        [['1_dia', '1 dia antes (7h)'], ['mesmo_dia', 'No mesmo dia (7h)'], ['2_dias', '2 dias antes (7h)'], ['nao', 'Não enviar']].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === (o.confirmacao_envio || '1_dia') ? ' selected' : '') + '>' + x[1] + '</option>' }).join('') + '</select></div>' +
        '<div><label>Enviar por</label><select class="ag-in" id="agc-canal">' +
        [['', 'Padrão da clínica'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['ambos', 'WhatsApp e e-mail']].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === (o.canal_envio || '') ? ' selected' : '') + '>' + x[1] + '</option>' }).join('') + '</select></div></div>'
    modal(ed.id ? 'Editar agendamento' : 'Novo agendamento', corpo,
      '<button class="btn" id="agc-cancel">Cancelar</button><button class="ag-btn-novo" id="agc-ok">' + (ed.id ? 'Salvar alterações' : 'Confirmar agendamento') + '</button>')
    var desenharPac = campoPaciente('agc', function (p) { ed.paciente = p }, true)
    desenharPac(ed.paciente)
    if (el('ag-tab-comp')) el('ag-tab-comp').onclick = function () { abrirCompromisso({ data: el('agc-data').value, hora_inicio: ed.hora, profissional_id: el('agc-prof').value }) }
    if (el('agc-rep')) el('agc-rep').onchange = function () { el('agc-rep-box').style.display = this.checked ? '' : 'none' }
    el('agc-cats').onclick = function (e) { e.preventDefault(); abrirCategorias(function () { abrirConsulta(Object.assign({}, o, coletarConsulta(true))) }) }
    ;['agc-data', 'agc-prof', 'agc-dur'].forEach(function (id) { el(id).onchange = chipsHorario })
    el('agc-hora-livre').onchange = function () { ed.hora = this.value; chipsHorario() }
    el('agc-cancel').onclick = fecharModal
    el('agc-ok').onclick = function () { salvarConsulta(false) }
    chipsHorario()
  }

  function coletarConsulta(parcial) {
    var ed = AG.ed
    return {
      id: ed.id, paciente: ed.paciente, data: el('agc-data').value, hora: ed.hora, duracao: +el('agc-dur').value,
      profissional_id: el('agc-prof').value ? +el('agc-prof').value : null, categoria_id: el('agc-cat').value ? +el('agc-cat').value : '',
      observacoes: el('agc-obs').value, procedimento: el('agc-proc').value, primeira_consulta: el('agc-primeira').checked,
      confirmacao_envio: el('agc-conf').value, canal_envio: el('agc-canal').value,
      alerta_retorno_id: ed.alerta_retorno_id, lista_espera_id: ed.lista_espera_id
    }
  }

  async function chipsHorario() {
    var ed = AG.ed, dataS = el('agc-data').value, prof = el('agc-prof').value ? +el('agc-prof').value : null, dur = +el('agc-dur').value
    if (!dataS) return
    var mes = dataS.slice(0, 7)
    if (!AG.meses[mes]) { try { await carregarMes(mes) } catch (e) {} }
    var d = parseYmd(dataS), jan = janelaDia(), passo = +AG.prefs.intervalo || 15
    var ocup = (ST.agendamentos || []).filter(function (a) { return a.date === dataS && prof && a.ProfessionalId === prof && !desmarcado(a) && a.status !== 'faltou' && a.id !== ed.id })
    var bls = bloqueiosDe(prof, dataS).filter(function (b) { return b.bloqueia !== 0 })
    var h = ''
    for (var m = jan[0]; m + dur <= jan[1]; m += passo) {
      var f = m + dur
      if (!disponivel(prof, d, m, f)) continue
      var busy = ocup.some(function (a) { var i = min(a.fromTime), e = min(a.toTime) || i + 30; return m < e && i < f }) ||
        bls.some(function (b) { return m < min(b.hora_fim) && min(b.hora_inicio) < f })
      h += '<span class="ag-chip' + (busy ? ' busy' : '') + (hm(m) === ed.hora ? ' on' : '') + '" data-h="' + hm(m) + '">' + hm(m) + '</span>'
    }
    var box = el('agc-chips'); if (!box) return
    box.innerHTML = h || '<span class="ag-empty">Sem horários livres nesse dia para esse profissional. Use "Outro horário".</span>'
    box.querySelectorAll('[data-h]').forEach(function (c) {
      c.onclick = function () { if (this.classList.contains('busy')) return; ed.hora = this.getAttribute('data-h'); el('agc-hora-livre').value = ed.hora; chipsHorario() }
    })
    el('agc-hora-sel').textContent = ed.hora ? '— ' + ed.hora + ' às ' + hm(min(ed.hora) + dur) : ''
  }

  async function salvarConsulta(forcar) {
    var c = coletarConsulta(), err = el('ag-c-err')
    err.innerHTML = ''
    if (!c.paciente || !c.paciente.nome) { err.innerHTML = '<div class="ag-err">Selecione o paciente.</div>'; return }
    if (!c.data || !c.hora) { err.innerHTML = '<div class="ag-err">Escolha a data e o horário.</div>'; return }
    var body = {
      id: c.id || undefined, paciente_id: c.paciente.id || null, paciente_nome: c.paciente.nome, data: c.data, hora: c.hora,
      hora_fim: hm(min(c.hora) + c.duracao), profissional_id: c.profissional_id, categoria_id: c.categoria_id || null,
      observacoes: c.observacoes, procedimento: c.procedimento, primeira_consulta: c.primeira_consulta,
      confirmacao_envio: c.confirmacao_envio, canal_envio: c.canal_envio || null, permitir_conflito: !!forcar,
      alerta_retorno_id: c.alerta_retorno_id, lista_espera_id: c.lista_espera_id
    }
    if (c.id) { var antigo = achar(c.id); body.status = antigo ? antigo.status : 'agendado' }
    if (!c.id && el('agc-rep') && el('agc-rep').checked) { body.repetir_vezes = +el('agc-rep-n').value || 1; body.repetir_cada_dias = +el('agc-rep-c').value || 7 }
    var btn = el('agc-ok'); btn.disabled = true
    try {
      var r = await apiPost('salvar-agendamento', body)
      if (!r.success) {
        err.innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro ao salvar') + (r.conflito ? ' <a href="#" id="agc-forcar" style="color:var(--red);font-weight:500;margin-left:8px">Agendar mesmo assim</a>' : '') + '</div>'
        if (el('agc-forcar')) el('agc-forcar').onclick = function (e) { e.preventDefault(); salvarConsulta(true) }
        return
      }
      fecharModal()
      delete AG.meses[c.data.slice(0, 7)]
      if (c.alerta_retorno_id || c.lista_espera_id) AG.cfg = null
      AG.data = parseYmd(c.data)
      await atualizar(!!(c.alerta_retorno_id || c.lista_espera_id))
    } catch (e) { err.innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>' } finally { if (el('agc-ok')) el('agc-ok').disabled = false }
  }

  // ── Compromisso / bloqueio ───────────────────────────────────────
  function abrirCompromisso(o) {
    var dataI = o.data || ymd(AG.data), hi = o.hora_inicio || '12:00'
    var corpo = '<div class="ag-tabs"><div class="ag-tab" id="ag-tab-cons">Consulta</div><div class="ag-tab on">Compromisso</div></div><div id="ag-b-err"></div>' +
      '<div class="ag-f"><label>Título</label><input class="ag-in" id="agb-tit" maxlength="80" placeholder="Ex.: Feriado, Almoço, Curso, Agenda fechada"></div>' +
      '<div class="ag-row c4 ag-f"><div><label>Profissional</label><select class="ag-in" id="agb-prof">' + optsProf(o.profissional_id || '', 'Toda a clínica') + '</select></div>' +
        '<div><label>Data</label><input class="ag-in" type="date" id="agb-data" value="' + dataI + '"></div>' +
        '<div><label>Início</label><input class="ag-in" type="time" id="agb-ini" value="' + hi + '"></div>' +
        '<div><label>Fim</label><input class="ag-in" type="time" id="agb-fim" value="' + hm(Math.min(min(hi) + 60, 23 * 60 + 59)) + '"></div></div>' +
      '<div class="ag-f"><label class="ag-chk"><input type="checkbox" id="agb-bloq" checked> Bloquear agendamentos nesse horário</label>' +
        '<label class="ag-chk"><input type="checkbox" id="agb-dia"> Dia inteiro</label></div>' +
      '<div class="ag-row c2 ag-f"><div><label>Repetir</label><select class="ag-in" id="agb-rep-c"><option value="0">Não repetir</option><option value="1">Todo dia</option><option value="7">Toda semana</option><option value="14">A cada 2 semanas</option><option value="30">A cada 30 dias</option></select></div>' +
        '<div><label>Quantas vezes</label><input class="ag-in" type="number" min="1" max="52" value="1" id="agb-rep-n"></div></div>' +
      '<div class="ag-f"><label>Observação</label><input class="ag-in" id="agb-obs" maxlength="500"></div>'
    modal('Novo compromisso', corpo, '<button class="btn" id="agb-cancel">Cancelar</button><button class="ag-btn-novo" id="agb-ok">Salvar compromisso</button>')
    el('ag-tab-cons').onclick = function () { abrirConsulta({ data: el('agb-data').value, hora: el('agb-ini').value, profissional_id: el('agb-prof').value ? +el('agb-prof').value : null }) }
    el('agb-dia').onchange = function () { if (this.checked) { var j = janelaDia(); el('agb-ini').value = hm(j[0]); el('agb-fim').value = hm(Math.min(j[1], 23 * 60 + 59)) } }
    el('agb-cancel').onclick = fecharModal
    el('agb-ok').onclick = async function () {
      var rc = +el('agb-rep-c').value
      var body = {
        titulo: el('agb-tit').value.trim(), profissional_id: el('agb-prof').value || null, data: el('agb-data').value,
        hora_inicio: el('agb-ini').value, hora_fim: el('agb-fim').value, bloqueia: el('agb-bloq').checked ? 1 : 0,
        observacao: el('agb-obs').value, repetir_vezes: rc ? (+el('agb-rep-n').value || 1) : 1, repetir_cada_dias: rc || 7
      }
      if (!body.titulo) { el('ag-b-err').innerHTML = '<div class="ag-err">Informe o título.</div>'; return }
      var r = await apiPost('agenda-bloqueio', body)
      if (!r.success) { el('ag-b-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      fecharModal(); AG.data = parseYmd(body.data); await atualizar(true)
    }
    setTimeout(function () { el('agb-tit').focus() }, 30)
  }

  async function acaoBloqueio(id) {
    var b = ((AG.cfg && AG.cfg.bloqueios) || []).filter(function (x) { return x.id === id })[0]; if (!b) return
    var quem = b.profissional_id ? ((ST.profissionais || []).filter(function (p) { return p.id === b.profissional_id })[0] || {}).nome : 'Toda a clínica'
    modal('Compromisso', '<div class="ag-pop-row" style="border:none;padding:0"><div class="lbl">' + esc(quem || '') + '</div><b>' + esc(b.titulo) + '</b><br>' + br(b.data) + ' · ' + b.hora_inicio + '–' + b.hora_fim +
      (b.bloqueia ? ' · bloqueia agendamentos' : '') + (b.observacao ? '<p style="margin:8px 0 0">' + esc(b.observacao) + '</p>' : '') +
      (b.criado_por_nome ? '<p class="ag-hint">Criado por ' + esc(b.criado_por_nome) + '</p>' : '') + '</div>',
      '<button class="btn" id="agb-x" style="color:var(--red)">Excluir compromisso</button><button class="btn" id="agb-f">Fechar</button>', 460)
    el('agb-f').onclick = fecharModal
    el('agb-x').onclick = async function () {
      if (!confirm('Excluir este compromisso?')) return
      var r = await apiPost('agenda-bloqueio', { action: 'delete', id: id })
      if (!r.success) return toast(r.error || 'Erro')
      fecharModal(); await atualizar(true)
    }
  }

  // ── Alerta de retorno ────────────────────────────────────────────
  function abrirRetorno(o) {
    var pac = o.paciente || null
    var corpo = '<div id="ag-r-err"></div><div class="ag-f"><label>Paciente</label><div id="agr-pac"></div></div>' +
      '<div class="ag-f"><label>Retorno em</label><div class="ag-chips" id="agr-prazos">' +
        [[1, '1 mês'], [3, '3 meses'], [6, '6 meses'], [12, '1 ano']].map(function (x) { return '<span class="ag-chip" data-m="' + x[0] + '">' + x[1] + '</span>' }).join('') +
        '</div><input class="ag-in" type="date" id="agr-data" style="margin-top:8px;max-width:200px"></div>' +
      '<div class="ag-row c2 ag-f"><div><label>Profissional</label><select class="ag-in" id="agr-prof">' + optsProf(o.profissional_id || '', 'Qualquer') + '</select></div>' +
        '<div><label>Motivo</label><input class="ag-in" id="agr-mot" maxlength="200" placeholder="Ex.: Profilaxia, manutenção"></div></div>'
    modal('Alerta de retorno', corpo, '<button class="btn" id="agr-cancel">Cancelar</button><button class="ag-btn-novo" id="agr-ok">Criar alerta</button>', 560)
    campoPaciente('agr', function (p) { pac = p }, false)(pac)
    el('agr-prazos').querySelectorAll('[data-m]').forEach(function (c) {
      c.onclick = function () {
        var d = hojeLocal(); d.setMonth(d.getMonth() + (+this.getAttribute('data-m')))
        el('agr-data').value = ymd(d)
        el('agr-prazos').querySelectorAll('.ag-chip').forEach(function (x) { x.classList.remove('on') }); this.classList.add('on')
      }
    })
    el('agr-cancel').onclick = fecharModal
    el('agr-ok').onclick = async function () {
      if (!pac || !pac.id) { el('ag-r-err').innerHTML = '<div class="ag-err">Selecione o paciente.</div>'; return }
      if (!el('agr-data').value) { el('ag-r-err').innerHTML = '<div class="ag-err">Escolha a data do retorno.</div>'; return }
      var r = await apiPost('alertas-retorno', { paciente_id: pac.id, data_retorno: el('agr-data').value, profissional_id: el('agr-prof').value || null, motivo: el('agr-mot').value })
      if (!r.success) { el('ag-r-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      fecharModal(); await atualizar(true)
    }
  }

  function acaoAlerta(id) {
    var a = ((AG.cfg && AG.cfg.alertas_retorno) || []).filter(function (x) { return x.id === id })[0]; if (!a) return
    modal('Alerta de retorno', '<b>' + esc(a.paciente_nome) + '</b>' + (a.telefone ? ' · ' + esc(a.telefone) : '') + '<br>Retorno previsto para ' + br(a.data_retorno) + (a.motivo ? '<br>' + esc(a.motivo) : ''),
      '<button class="btn" id="aga-x" style="color:var(--red)">Descartar alerta</button><button class="btn" id="aga-f">Fechar</button><button class="ag-btn-novo" id="aga-ag">Agendar retorno</button>', 480)
    el('aga-f').onclick = fecharModal
    el('aga-ag').onclick = function () {
      abrirConsulta({ paciente: { id: a.paciente_id, nome: a.paciente_nome, telefone: a.telefone }, profissional_id: a.profissional_id, data: a.data_retorno > ymd(hojeLocal()) ? a.data_retorno : ymd(AG.data), alerta_retorno_id: a.id })
    }
    el('aga-x').onclick = async function () {
      var r = await apiPost('alertas-retorno', { action: 'status', id: a.id, status: 'cancelado' })
      if (!r.success) return toast(r.error || 'Erro')
      fecharModal(); await atualizar(true)
    }
  }

  // ── Lista de espera ──────────────────────────────────────────────
  function abrirEspera() {
    var pac = null
    modal('Lista de espera', '<div id="ag-e-err"></div><div class="ag-f"><label>Paciente</label><div id="age-pac"></div></div>' +
      '<div class="ag-row c2 ag-f"><div><label>Profissional</label><select class="ag-in" id="age-prof">' + optsProf('', 'Qualquer') + '</select></div>' +
      '<div><label>Preferência de horário</label><input class="ag-in" id="age-pref" maxlength="120" placeholder="Ex.: manhãs, sextas à tarde"></div></div>' +
      '<div class="ag-f"><label>Observação</label><input class="ag-in" id="age-obs" maxlength="500"></div>',
      '<button class="btn" id="age-cancel">Cancelar</button><button class="ag-btn-novo" id="age-ok">Adicionar</button>', 560)
    campoPaciente('age', function (p) { pac = p }, true)(null)
    el('age-cancel').onclick = fecharModal
    el('age-ok').onclick = async function () {
      if (!pac || !pac.id) { el('ag-e-err').innerHTML = '<div class="ag-err">Selecione o paciente.</div>'; return }
      var r = await apiPost('lista-espera', { paciente_id: pac.id, profissional_id: el('age-prof').value || null, preferencia: el('age-pref').value, observacao: el('age-obs').value })
      if (!r.success) { el('ag-e-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      fecharModal(); await atualizar(true)
    }
  }

  function acaoEspera(id) {
    var l = ((AG.cfg && AG.cfg.lista_espera) || []).filter(function (x) { return x.id === id })[0]; if (!l) return
    modal('Lista de espera', '<b>' + esc(l.paciente_nome) + '</b>' + (l.telefone ? ' · ' + esc(l.telefone) : '') + '<br>' + esc(l.preferencia || 'Qualquer horário') + (l.observacao ? '<br>' + esc(l.observacao) : '') +
      '<p class="ag-hint">Na lista desde ' + br(l.criado_em) + '</p>',
      '<button class="btn" id="age-x" style="color:var(--red)">Remover da lista</button><button class="btn" id="age-f">Fechar</button><button class="ag-btn-novo" id="age-ag">Agendar</button>', 480)
    el('age-f').onclick = fecharModal
    el('age-ag').onclick = function () { abrirConsulta({ paciente: { id: l.paciente_id, nome: l.paciente_nome, telefone: l.telefone }, profissional_id: l.profissional_id, lista_espera_id: l.id }) }
    el('age-x').onclick = async function () {
      var r = await apiPost('lista-espera', { action: 'status', id: l.id, status: 'removido' })
      if (!r.success) return toast(r.error || 'Erro')
      fecharModal(); await atualizar(true)
    }
  }

  // ── Categorias ───────────────────────────────────────────────────
  function abrirCategorias(depois) {
    var cats = ((AG.cfg && AG.cfg.categorias) || []).slice()
    function linha(c) {
      return '<div class="ag-cat-row" data-cat="' + (c.id || '') + '"><input type="color" value="' + (c.cor || '#1B5E3B') + '"><input class="ag-in" value="' + esc(c.nome || '') + '" maxlength="60" placeholder="Nome da categoria">' +
        (c.id ? '<button class="ag-ico" data-del title="Remover" style="color:var(--red)">✕</button>' : '') + '</div>'
    }
    modal('Categorias da agenda', '<div id="ag-cat-err"></div><div id="ag-cat-list">' + cats.map(linha).join('') + linha({}) + '</div><p class="ag-hint">A cor aparece na agenda quando "Colorir por categoria" está ligado (⚙).</p>',
      '<button class="btn" id="agk-f">Fechar</button><button class="ag-btn-novo" id="agk-ok">Salvar</button>', 520)
    el('ag-cat-list').querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        var row = this.closest('[data-cat]'), id = +row.getAttribute('data-cat')
        if (!confirm('Remover esta categoria? Agendamentos antigos mantêm o nome.')) return
        var r = await apiPost('agenda-categorias', { action: 'delete', id: id })
        if (!r.success) return toast(r.error || 'Erro')
        row.remove()
      }
    })
    el('agk-f').onclick = async function () { fecharModal(); await carregarConfig(true); renderTudo(); if (depois) depois() }
    el('agk-ok').onclick = async function () {
      var rows = el('ag-cat-list').querySelectorAll('[data-cat]')
      for (var i = 0; i < rows.length; i++) {
        var id = rows[i].getAttribute('data-cat'), cor = rows[i].querySelector('input[type=color]').value, nome = rows[i].querySelector('.ag-in').value.trim()
        if (!nome) continue
        var orig = cats.filter(function (c) { return String(c.id) === id })[0]
        if (orig && orig.nome === nome && orig.cor.toLowerCase() === cor.toLowerCase()) continue
        var r = await apiPost('agenda-categorias', { id: id ? +id : undefined, nome: nome, cor: cor })
        if (!r.success) { el('ag-cat-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      }
      fecharModal(); await carregarConfig(true); renderTudo(); if (depois) depois()
    }
  }

  // ── Preferências, cores e horários ───────────────────────────────
  function abrirPrefs() {
    var p = AG.prefs
    function chk(k, t) { return '<label class="ag-chk"><input type="checkbox" data-pref="' + k + '"' + (p[k] ? ' checked' : '') + '> ' + t + '</label>' }
    modal('Configurações da agenda', '<div class="ag-pref">' +
      chk('sabado', 'Mostrar sábado') + chk('domingo', 'Mostrar domingo') + chk('desmarcados', 'Mostrar desmarcações') +
      chk('foraExpediente', 'Hachurar fora do horário de atendimento') + chk('corCategoria', 'Colorir agendamentos pela categoria (em vez do profissional)') +
      chk('apagarPassados', 'Reduzir brilho de horários passados') +
      '<div class="ag-row c3"><div><label class="ag-f" style="display:block"><span style="font-size:12px;color:var(--text3)">INTERVALO</span></label><select class="ag-in" id="agp-int">' + [10, 15, 20, 30, 60].map(function (m) { return '<option value="' + m + '"' + (+p.intervalo === m ? ' selected' : '') + '>' + m + ' min</option>' }).join('') + '</select></div>' +
        '<div><span style="font-size:12px;color:var(--text3)">INÍCIO DA GRADE</span><input class="ag-in" type="time" id="agp-ini" value="' + (p.inicio || '') + '"></div>' +
        '<div><span style="font-size:12px;color:var(--text3)">FIM DA GRADE</span><input class="ag-in" type="time" id="agp-fim" value="' + (p.fim || '') + '"></div></div>' +
      '<p class="ag-hint" style="margin:0">Sem início/fim, a grade usa o horário de funcionamento da clínica. Estas preferências valem só para você.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border2);padding-top:12px">' +
        '<button class="btn" id="agp-cats">Categorias</button><button class="btn" id="agp-hor">Horários de atendimento</button><button class="btn" id="agp-cores">Cores dos profissionais</button></div>' +
      '</div>', '<button class="ag-btn-novo" id="agp-ok">Aplicar</button>', 560)
    el('agp-cats').onclick = function () { abrirCategorias() }
    el('agp-hor').onclick = function () { abrirHorarios() }
    el('agp-cores').onclick = abrirCores
    el('agp-ok').onclick = function () {
      document.querySelectorAll('[data-pref]').forEach(function (c) { p[c.getAttribute('data-pref')] = c.checked })
      p.intervalo = +el('agp-int').value; p.inicio = el('agp-ini').value; p.fim = el('agp-fim').value
      savePrefs(); fecharModal(); renderTudo()
    }
  }

  function abrirCores() {
    modal('Cores dos profissionais', (ST.profissionais || []).map(function (pr) {
      return '<div class="ag-cat-row" data-pc="' + pr.id + '"><input type="color" value="' + corProf(pr.id) + '"><span style="font-size:14px;color:var(--text2)">' + esc(pr.nome) + '</span></div>'
    }).join('') + '<div id="ag-cor-err"></div>', '<button class="btn" id="agco-f">Cancelar</button><button class="ag-btn-novo" id="agco-ok">Salvar</button>', 460)
    el('agco-f').onclick = fecharModal
    el('agco-ok').onclick = async function () {
      var rows = document.querySelectorAll('[data-pc]')
      for (var i = 0; i < rows.length; i++) {
        var id = +rows[i].getAttribute('data-pc'), cor = rows[i].querySelector('input').value
        if (cor.toLowerCase() === corProf(id).toLowerCase()) continue
        var r = await apiPost('agenda-cor-profissional', { profissional_id: id, cor: cor })
        if (!r.success) { el('ag-cor-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      }
      fecharModal(); await carregarConfig(true); renderTudo()
    }
  }

  // Horário de funcionamento (clínica) e agenda de trabalho (profissional)
  function abrirHorarios(profIdInicial) {
    if (!AG.cfg) { carregarConfig().then(function () { abrirHorarios(profIdInicial) }); return }
    var alvo = profIdInicial ? String(profIdInicial) : ''
    function lista() {
      return alvo ? (AG.cfg.horarios_profissionais || []).filter(function (h) { return String(h.profissional_id) === alvo }) : (AG.cfg.horarios_clinica || [])
    }
    function corpo() {
      var hs = lista(), h = '<div class="ag-f"><label>Horários de</label><select class="ag-in" id="agh-alvo"><option value="">Clínica (horário de funcionamento)</option>' + optsProf(alvo) + '</select>' +
        '<p class="ag-hint">' + (alvo ? 'Fora destes horários a agenda deste profissional fica hachurada. Sem nenhum horário, vale o da clínica.' : 'Sem nenhum horário, a agenda fica aberta o dia todo.') + ' Use dois períodos para marcar o almoço.</p></div>'
      for (var d = 0; d < 7; d++) {
        var ints = hs.filter(function (x) { return x.dia_semana === d })
        var on = ints.length > 0
        var i1 = ints[0] || { hora_inicio: '08:00', hora_fim: '12:00' }, i2 = ints[1]
        h += '<div class="ag-cat-row" data-dow="' + d + '" style="flex-wrap:wrap"><label class="ag-chk" style="width:150px;margin:0"><input type="checkbox" data-on' + (on ? ' checked' : '') + '> ' + DIAS_L[d] + '</label>' +
          '<input class="ag-in" type="time" data-i1 value="' + i1.hora_inicio + '" style="width:110px"> às <input class="ag-in" type="time" data-f1 value="' + i1.hora_fim + '" style="width:110px">' +
          '<span style="margin:0 6px;color:var(--text3)">e</span><input class="ag-in" type="time" data-i2 value="' + (i2 ? i2.hora_inicio : '') + '" style="width:110px"> às <input class="ag-in" type="time" data-f2 value="' + (i2 ? i2.hora_fim : '') + '" style="width:110px"></div>'
      }
      return h + '<div id="agh-err"></div>'
    }
    modal('Horários de atendimento', corpo(), '<button class="btn" id="agh-f">Cancelar</button><button class="ag-btn-novo" id="agh-ok">Salvar horários</button>', 760)
    function ligar() {
      el('agh-alvo').onchange = function () { alvo = this.value; el('ag-m-b').innerHTML = corpo(); ligar() }
    }
    ligar()
    el('agh-f').onclick = fecharModal
    el('agh-ok').onclick = async function () {
      var hs = []
      document.querySelectorAll('[data-dow]').forEach(function (r) {
        if (!r.querySelector('[data-on]').checked) return
        var d = +r.getAttribute('data-dow')
        var i1 = r.querySelector('[data-i1]').value, f1 = r.querySelector('[data-f1]').value, i2 = r.querySelector('[data-i2]').value, f2 = r.querySelector('[data-f2]').value
        if (i1 && f1) hs.push({ dia_semana: d, hora_inicio: i1, hora_fim: f1 })
        if (i2 && f2) hs.push({ dia_semana: d, hora_inicio: i2, hora_fim: f2 })
      })
      var r = await apiPost('agenda-horarios', { profissional_id: alvo ? +alvo : undefined, horarios: hs })
      if (!r.success) { el('agh-err').innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
      fecharModal(); await carregarConfig(true); renderTudo()
    }
  }

  // ── Impressão (agenda do dia por profissional) ───────────────────
  function imprimir() {
    var ds = ymd(AG.data), profs = profsVisiveis()
    var h = '<div id="ag-print" style="font-family:Roboto,Arial,sans-serif;color:#212121;background:#fff"><h2 style="font-weight:500;margin:0 0 4px">Agenda — ' + esc(tituloPeriodo()) + '</h2>'
    profs.forEach(function (p) {
      var evs = (ST.agendamentos || []).filter(function (a) { return a.date === ds && a.ProfessionalId === p.id && !desmarcado(a) }).sort(function (x, y) { return x.fromTime < y.fromTime ? -1 : 1 })
      var bls = bloqueiosDe(p.id, ds)
      if (!evs.length && !bls.length) return
      h += '<h3 style="font-weight:500;margin:16px 0 6px;border-bottom:2px solid #E0E0E0;padding-bottom:4px">' + esc(p.nome) + ' — ' + evs.length + ' paciente(s)</h3><table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<tr><th style="text-align:left;padding:4px">Horário</th><th style="text-align:left;padding:4px">Paciente</th><th style="text-align:left;padding:4px">Telefone</th><th style="text-align:left;padding:4px">Categoria / procedimento</th><th style="text-align:left;padding:4px">Status</th></tr>' +
        bls.map(function (b) { return '<tr><td style="padding:4px;border-top:1px solid #EEE">' + b.hora_inicio + '–' + b.hora_fim + '</td><td colspan="4" style="padding:4px;border-top:1px solid #EEE;color:#757575">' + esc(b.titulo) + '</td></tr>' }).join('') +
        evs.map(function (a) {
          return '<tr><td style="padding:4px;border-top:1px solid #EEE">' + a.fromTime + (a.toTime ? '–' + a.toTime : '') + '</td><td style="padding:4px;border-top:1px solid #EEE">' + esc(a.PatientName) + '</td><td style="padding:4px;border-top:1px solid #EEE">' + esc(a.MobilePhone) + '</td>' +
            '<td style="padding:4px;border-top:1px solid #EEE">' + esc([a.CategoryDescription, a.procedureName].filter(Boolean).join(' · ')) + '</td><td style="padding:4px;border-top:1px solid #EEE">' + esc((STATUS_MAP[a.status] || STATUS_MAP.agendado).rot) + '</td></tr>'
        }).join('') + '</table>'
    })
    h += '</div>'
    var old = el('ag-print'); if (old) old.remove()
    document.body.insertAdjacentHTML('beforeend', h)
    setTimeout(function () { window.print(); setTimeout(function () { var x = el('ag-print'); if (x) x.remove() }, 500) }, 50)
  }

  // ── API pública (nomes usados pelo resto do app) ─────────────────
  async function loadAgenda() {
    loadPrefs()
    montarTela()
    if (window.agendaView && ['dia', 'semana', 'mes'].indexOf(window.agendaView) !== -1) AG.view = window.agendaView
    await atualizar(true)
  }

  window.loadAgenda = loadAgenda
  window.renderAgendaGrid = function () { if (el('ag-main')) renderTudo() }
  window.renderProfsList = function () { AG.cfg = null; if (el('ag-main')) atualizar(true) }
  window.renderMiniCal = function () { if (el('ag-main')) renderMini() }
  window.openNovaConsulta = function (profId, hora) { if (!AG.prefs) loadPrefs(); if (!AG.cfg) { carregarConfig().then(function () { openNovaConsulta(profId, hora) }); return } openNovaConsulta(profId, hora) }
  window.editarAgendamento = function (id) { editarAgendamento(id) }
  window.openApptPanel = openApptPanel
  window.closeApptPanel = closeApptPanel
  window.agendaDblClick = function (profId, hora) { window.openNovaConsulta(profId, hora) }
  window.abrirHorariosAgenda = function (profId) { if (!AG.prefs) loadPrefs(); abrirHorarios(profId) }
  window.abrirCategoriasAgenda = function () { if (!AG.prefs) loadPrefs(); var go = function () { abrirCategorias() }; if (!AG.cfg) carregarConfig().then(go); else go() }
  window.novoAlertaRetorno = function (paciente) { if (!AG.prefs) loadPrefs(); var go = function () { abrirRetorno({ paciente: paciente }) }; if (!AG.cfg) carregarConfig().then(go); else go() }
  window.novoAgendamentoPaciente = function (paciente) {
    if (!AG.prefs) loadPrefs()
    var go = function () { abrirConsulta({ paciente: paciente }) }
    if (!AG.cfg) carregarConfig().then(go); else go()
  }
})()
