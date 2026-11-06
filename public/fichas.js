// public/fichas.js — Aba "Fichas Especialidades" do prontuário (ortodontia e implante)
// Klinov — Campo Grande, MS
//
// Lista as fichas do paciente, cria a partir de um modelo, edita e registra as
// visitas de acompanhamento. Regras e validação no servidor (lib/rotas/fichas.js).
// Depende de apiData, apiPost, escHtml, isAdmin, ST (app.html) e das classes
// .ag-* / .pc-* de agenda.css e paciente.css.
;(function () {
  'use strict'

  var OP = null // opções que o servidor devolve (status, filosofias, etapas…)
  function MOD(t) { return (window.FICHAS_MODELOS || {})[t] } // endodontia, periodontia, alinhadores, toxina (fichas-modelos.js)
  function rotVisita(t) { return MOD(t) ? MOD(t).visita : t === 'ortodontia' ? '+ Manutenção' : '+ Retorno' }
  function rotVisitas(t) { return MOD(t) ? MOD(t).visitas : t === 'ortodontia' ? 'Manutenções' : 'Retornos' }
  var filtro = 'todas'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function br(d) { if (!d) return '—'; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function hoje() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function isAdmin() { return (window.KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function meuId() { return window.KLINOV_USER ? Number(KLINOV_USER.id) : null }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }
  function num(v) { return v == null || v === '' ? '' : String(v).replace('.', ',') }
  function opts(mapa, sel, vazio) {
    return (vazio !== undefined ? '<option value="">' + esc(vazio) + '</option>' : '') +
      Object.keys(mapa).map(function (k) { return '<option value="' + esc(k) + '"' + (String(sel || '') === k ? ' selected' : '') + '>' + esc(mapa[k]) + '</option>' }).join('')
  }
  var COR_ST = { avaliacao: 'blue', tratamento: 'green', suspenso: 'orange', finalizado: 'gray' }
  function badge(st) { return '<span class="badge badge-' + (COR_ST[st] || 'gray') + '">' + esc((OP && OP.status[st]) || st) + '</span>' }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('fe-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'fe-modal-ov'; ov.className = 'ag-modal-ov'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 760) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="fe-m-x">✕</button></div>' +
      '<div class="ag-modal-b">' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('fe-m-x').onclick = fechar
    ov.onmousedown = function (e) { if (e.target === ov) fechar() }
  }
  function fechar() { var ov = el('fe-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  function erro(msg) { var b = el('fe-err'); if (b) { b.innerHTML = msg ? '<div class="ag-err">' + esc(msg) + '</div>' : ''; if (msg) b.scrollIntoView({ block: 'nearest' }) } }

  async function profissionais() {
    var profs = (ST.profissionais || []).map(function (x) { return { id: x.id, nome: x.nome } })
    if (!profs.length) { try { profs = ((await apiData('profissionais')).data || []).filter(function (x) { return x.ativo !== 0 }).map(function (x) { return { id: x.id, nome: x.nome } }) } catch (e) {} }
    return profs
  }

  // ── Aba ──────────────────────────────────────────────────────────
  async function aba(box, p) {
    box.innerHTML = '<div style="color:var(--text3)">Carregando…</div>'
    var r
    try { r = await apiData('fichas-especialidade', { paciente_id: p.id }) } catch (e) { box.innerHTML = '<div class="ag-err">' + esc(e.message) + '</div>'; return }
    if (!r.success) { box.innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro') + '</div>'; return }
    OP = r.opcoes
    var todas = r.data || [], edita = pode('pacientes.ficha_clinica')
    var lista = todas.filter(function (f) { return filtro === 'todas' || f.tipo === filtro })
    function cont(t) { return todas.filter(function (f) { return t === 'todas' || f.tipo === t }).length }
    var recarregar = function () { aba(box, p) }

    box.innerHTML = '<div style="max-width:980px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px">' +
        '<div class="pc-seg" id="fe-seg" style="margin:0;min-width:320px;flex-wrap:wrap">' + [['todas', 'Todas'], ['ortodontia', 'Ortodontia'], ['implante', 'Implante'], ['endodontia', 'Endodontia'], ['periodontia', 'Periodontia'], ['alinhadores', 'Alinhadores'], ['toxina', 'Toxina']].filter(function (x) { return x[0] === 'todas' || x[0] === 'ortodontia' || x[0] === 'implante' || cont(x[0]) || filtro === x[0] }).map(function (x) {
          return '<div data-f="' + x[0] + '"' + (filtro === x[0] ? ' class="on"' : '') + '>' + x[1] + ' (' + cont(x[0]) + ')</div>' }).join('') + '</div>' +
        (edita ? '<button class="ag-btn-novo" id="fe-nova">+ Nova ficha</button>' : '') + '</div>' +
      (lista.length ? lista.map(cartao).join('') : '<div class="pc-vazio" style="padding:40px 0;text-align:center">' + (todas.length ? 'Nenhuma ficha deste tipo.' : 'Nenhuma ficha de especialidade. Use "+ Nova ficha" para abrir uma ficha de ortodontia, implante, endodontia, periodontia, alinhadores ou toxina botulínica.') + '</div>') +
      '</div>'

    el('fe-seg').querySelectorAll('[data-f]').forEach(function (d) { d.onclick = function () { filtro = this.getAttribute('data-f'); recarregar() } })
    if (el('fe-nova')) el('fe-nova').onclick = function () { escolherModelo(p, recarregar) }
    box.querySelectorAll('[data-abrir]').forEach(function (b) { b.onclick = function () { var f = todas.filter(function (x) { return x.id === +b.getAttribute('data-abrir') })[0]; editar(p, f.tipo, f, recarregar, !edita) } })
    box.querySelectorAll('[data-visita]').forEach(function (b) { b.onclick = function () { var f = todas.filter(function (x) { return x.id === +b.getAttribute('data-visita') })[0]; novaVisita(f, recarregar) } })
    box.querySelectorAll('[data-excluir]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('Excluir esta ficha e as visitas registradas nela? Ela vai para a lixeira.')) return
        var x = await apiPost('fichas-especialidade', { action: 'delete', id: +b.getAttribute('data-excluir') })
        if (!x.success) return alert(x.error || 'Erro'); recarregar()
      }
    })
    box.querySelectorAll('[data-rmv]').forEach(function (a) {
      a.onclick = async function (e) {
        e.preventDefault(); if (!confirm('Remover esta visita?')) return
        var x = await apiPost('fichas-especialidade', { action: 'visita-remover', id: +a.getAttribute('data-rmv') })
        if (!x.success) return alert(x.error || 'Erro'); recarregar()
      }
    })

    function cartao(f) {
      var d = f.dados || {}, titulo, corpo
      if (MOD(f.tipo)) { var c = MOD(f.tipo).cartao(f, OP); titulo = c.titulo; corpo = c.corpo }
      else if (f.tipo === 'ortodontia') {
        titulo = 'Ortodontia' + (d.filosofia ? ' · ' + esc(OP.filosofias[d.filosofia]) : '')
        var atrasada = f.proxima_manutencao && f.proxima_manutencao < hoje()
        corpo = '<div class="fe-kv">' +
          kv('Arcada', OP.arcadas[d.arcada]) + kv('Classe', OP.classes[d.classe]) + kv('Previsão de término', d.previsao_termino ? br(d.previsao_termino) : '') +
          kv('Manutenção a cada', d.intervalo_dias ? d.intervalo_dias + ' dias' : '') + kv('Última visita', f.ultima_visita ? br(f.ultima_visita) : 'Nenhuma') +
          (f.proxima_manutencao ? '<div><span>Próxima manutenção</span><b style="color:' + (atrasada ? 'var(--orange)' : 'var(--text)') + '">' + br(f.proxima_manutencao) + (atrasada ? ' · atrasada' : '') + '</b></div>' : '') +
          '</div>' + (d.plano ? '<div class="ag-hint" style="margin-top:8px"><b>Plano:</b> ' + esc(d.plano) + '</div>' : '')
      } else {
        var imps = d.implantes || []
        titulo = 'Implante · ' + imps.length + (imps.length === 1 ? ' implante' : ' implantes')
        corpo = imps.length ? '<table class="pc-tbl" style="margin-top:4px"><thead><tr><th>Dente</th><th>Implante</th><th class="hide-sm">Ø × comp. (mm)</th><th class="hide-sm">Torque</th><th>Etapa atual</th></tr></thead><tbody>' +
          imps.map(function (i) {
            var et = i.etapa_atual ? OP.etapas.filter(function (e) { return e[0] === i.etapa_atual })[0][1] : 'Concluído'
            var prev = i.etapa_atual && i.etapas[i.etapa_atual] && i.etapas[i.etapa_atual].prevista
            return '<tr><td><b>' + esc(i.dente) + '</b></td><td>' + (esc([i.marca, i.modelo].filter(Boolean).join(' ')) || '—') + '</td><td class="hide-sm">' + (i.diametro || i.comprimento ? num(i.diametro) + ' × ' + num(i.comprimento) : '—') + '</td><td class="hide-sm">' + (i.torque != null ? num(i.torque) + ' Ncm' : '—') + '</td>' +
              '<td>' + (i.etapa_atual ? esc(et) + (prev ? '<div class="ag-hint" style="margin:0;color:' + (prev < hoje() ? 'var(--orange)' : 'var(--text3)') + '">prevista ' + br(prev) + '</div>' : '') : '<span class="badge badge-green">Concluído</span>') + '</td></tr>'
          }).join('') + '</tbody></table>' : '<div class="pc-vazio">Nenhum implante cadastrado na ficha.</div>'
      }
      var vis = f.visitas || []
      return '<div class="pc-box" style="margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px">' +
          '<div><div style="font-size:15px;font-weight:500;color:var(--text)">' + titulo + ' ' + badge(f.status) + '</div>' +
          '<div class="ag-hint" style="margin:4px 0 0">Início ' + br(f.data_inicio) + (f.profissional_nome ? ' · ' + esc(f.profissional_nome) : '') + (f.criado_por_nome ? ' · aberta por ' + esc(f.criado_por_nome) : '') + '</div></div>' +
          '<div class="fn-acoes"><button class="btn btn-sm" data-abrir="' + f.id + '">' + (edita ? 'Abrir / editar' : 'Abrir') + '</button>' +
            (edita ? '<button class="btn btn-sm" data-visita="' + f.id + '">' + rotVisita(f.tipo) + '</button>' : '') +
            (edita && (isAdmin() || Number(f.criado_por_id) === meuId()) ? '<button class="btn btn-sm" data-excluir="' + f.id + '" style="color:var(--red)">Excluir</button>' : '') + '</div></div>' +
        corpo +
        (vis.length ? '<div class="pc-box-h" style="margin:16px 0 8px">' + rotVisitas(f.tipo) + ' (' + vis.length + ')</div>' + vis.slice(0, 5).map(function (v) {
          return '<div class="pc-nota"><div>' + esc(v.descricao) + '<small>' + br(v.data) + (v.profissional_nome ? ' · ' + esc(v.profissional_nome) : '') + (v.usuario_nome ? ' · registrado por ' + esc(v.usuario_nome) : '') +
            (edita ? ' · <a href="#" data-rmv="' + v.id + '" style="color:var(--red)">Remover</a>' : '') + '</small></div></div>'
        }).join('') + (vis.length > 5 ? '<div class="ag-hint">+ ' + (vis.length - 5) + ' anterior(es) — veja em "Abrir".</div>' : '') : '') +
        '</div>'
    }
    function kv(k, v) { return '<div><span>' + esc(k) + '</span><b>' + (v ? esc(v) : '—') + '</b></div>' }
  }

  // ── Novo: escolher o modelo ──────────────────────────────────────
  function escolherModelo(p, depois) {
    modal('Nova ficha de especialidade', '<p style="margin-top:0">Escolha o modelo da ficha.</p>' +
      '<div class="ag-row c2"><button class="pc-box fe-modelo" data-t="ortodontia" style="text-align:left;cursor:pointer"><b style="color:var(--text)">Ortodontia</b><div class="ag-hint" style="margin:4px 0 0">Aparelho, arcada, classe, plano, previsão de término e manutenções.</div></button>' +
      '<button class="pc-box fe-modelo" data-t="implante" style="text-align:left;cursor:pointer"><b style="color:var(--text)">Implante</b><div class="ag-hint" style="margin:4px 0 0">Um ou mais implantes por dente, com medidas, torque e as etapas do tratamento.</div></button>' +
      Object.keys(window.FICHAS_MODELOS || {}).map(function (t) { var m = FICHAS_MODELOS[t]; return '<button class="pc-box fe-modelo" data-t="' + t + '" style="text-align:left;cursor:pointer"><b style="color:var(--text)">' + esc(m.nome) + '</b><div class="ag-hint" style="margin:4px 0 0">' + esc(m.descricao) + '</div></button>' }).join('') + '</div>',
      '<button class="btn" id="fe-c">Cancelar</button>', 620)
    el('fe-c').onclick = fechar
    document.querySelectorAll('.fe-modelo').forEach(function (b) { b.onclick = function () { editar(p, this.getAttribute('data-t'), null, depois) } })
  }

  // ── Formulário (novo ou edição) ──────────────────────────────────
  async function editar(p, tipo, f, depois, soLeitura) {
    var profs = await profissionais()
    var M = MOD(tipo)
    var d = (f && f.dados) || (M ? M.novo() : tipo === 'ortodontia' ? { intervalo_dias: 30 } : { implantes: [{ etapas: {} }] })
    var implantes = JSON.parse(JSON.stringify(d.implantes || []))
    var dis = soLeitura ? ' disabled' : ''
    var topo = '<div id="fe-err"></div><div class="ag-row c3">' +
      '<div class="ag-f"><label>Situação</label><select class="ag-in" id="fe-st"' + dis + '>' + opts(OP.status, f ? f.status : 'avaliacao') + '</select></div>' +
      '<div class="ag-f"><label>Profissional responsável</label><select class="ag-in" id="fe-prof"' + dis + '><option value="">—</option>' + profs.map(function (x) { return '<option value="' + x.id + '"' + (f && String(f.profissional_id) === String(x.id) ? ' selected' : '') + '>' + esc(x.nome) + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label>Início do tratamento</label><input class="ag-in" type="date" id="fe-ini" value="' + ((f && f.data_inicio) || hoje()) + '"' + dis + '></div></div>'
    var corpo
    if (M) corpo = topo + M.form(d, dis, OP)
    else if (tipo === 'ortodontia') {
      corpo = topo + '<div class="ag-row c3">' +
        '<div class="ag-f"><label>Aparelho / técnica</label><select class="ag-in" id="fe-fil"' + dis + '>' + opts(OP.filosofias, d.filosofia, '—') + '</select></div>' +
        '<div class="ag-f"><label>Arcada</label><select class="ag-in" id="fe-arc"' + dis + '>' + opts(OP.arcadas, d.arcada, '—') + '</select></div>' +
        '<div class="ag-f"><label>Classe (Angle)</label><select class="ag-in" id="fe-cla"' + dis + '>' + opts(OP.classes, d.classe, '—') + '</select></div></div>' +
        '<div class="ag-row c3"><div class="ag-f"><label>Previsão de término</label><input class="ag-in" type="date" id="fe-prev" value="' + (d.previsao_termino || '') + '"' + dis + '></div>' +
        '<div class="ag-f"><label>Manutenção a cada (dias)</label><input class="ag-in" type="number" min="7" max="180" id="fe-int" value="' + (d.intervalo_dias || 30) + '"' + dis + '></div><div></div></div>' +
        '<div class="ag-f"><label>Queixa principal</label><textarea class="ag-in" id="fe-qx" rows="2" maxlength="1000"' + dis + '>' + esc(d.queixa || '') + '</textarea></div>' +
        '<div class="ag-f"><label>Plano de tratamento</label><textarea class="ag-in" id="fe-pl" rows="3" maxlength="3000"' + dis + '>' + esc(d.plano || '') + '</textarea></div>' +
        '<div class="ag-f"><label>Contenção</label><input class="ag-in" id="fe-ct" maxlength="500" placeholder="Ex.: fixa 3×3 inferior + placa superior"' + dis + ' value="' + esc(d.contencao || '') + '"></div>' +
        '<div class="ag-f"><label>Observações</label><textarea class="ag-in" id="fe-obs" rows="2" maxlength="3000"' + dis + '>' + esc(d.observacoes || '') + '</textarea></div>'
    } else {
      corpo = topo + '<div id="fe-imps"></div>' + (soLeitura ? '' : '<button class="btn btn-sm" id="fe-add" style="margin-bottom:16px">+ Adicionar implante</button>') +
        '<div class="ag-f"><label>Enxerto / regeneração</label><input class="ag-in" id="fe-enx" maxlength="500" placeholder="Ex.: levantamento de seio, enxerto ósseo particulado"' + dis + ' value="' + esc(d.enxerto || '') + '"></div>' +
        '<div class="ag-f"><label>Observações</label><textarea class="ag-in" id="fe-obs" rows="2" maxlength="3000"' + dis + '>' + esc(d.observacoes || '') + '</textarea></div>'
    }
    if (f && f.visitas && f.visitas.length) corpo += '<div class="pc-box-h" style="margin:16px 0 8px">' + rotVisitas(tipo) + '</div>' +
      f.visitas.map(function (v) { return '<div class="pc-nota"><div>' + esc(v.descricao) + '<small>' + br(v.data) + (v.profissional_nome ? ' · ' + esc(v.profissional_nome) : '') + '</small></div></div>' }).join('')

    modal((f ? '' : 'Nova ficha · ') + (M ? M.nome : tipo === 'ortodontia' ? 'Ortodontia' : 'Implante'), corpo,
      '<button class="btn" id="fe-c">' + (soLeitura ? 'Fechar' : 'Cancelar') + '</button>' + (soLeitura ? '' : '<button class="ag-btn-novo" id="fe-ok">Salvar ficha</button>'), 860)
    el('fe-c').onclick = fechar

    if (M) M.montar(d, dis, OP)
    if (tipo === 'implante') { desenharImplantes(); if (el('fe-add')) el('fe-add').onclick = function () { lerImplantes(); implantes.push({ etapas: {} }); desenharImplantes() } }

    function desenharImplantes() {
      el('fe-imps').innerHTML = implantes.length ? implantes.map(function (i, n) {
        var et = i.etapas || {}
        return '<div class="pc-box" style="margin-bottom:12px" data-imp="' + n + '"><div class="pc-box-h">Implante ' + (n + 1) + (soLeitura ? '' : ' <a href="#" data-rm="' + n + '" style="color:var(--red)">Remover</a>') + '</div>' +
          '<div class="ag-row c4"><div class="ag-f"><label>Dente (FDI)</label><input class="ag-in" data-k="dente" maxlength="2" inputmode="numeric" placeholder="36" value="' + esc(i.dente || '') + '"' + dis + '></div>' +
          '<div class="ag-f"><label>Marca</label><input class="ag-in" data-k="marca" maxlength="60" value="' + esc(i.marca || '') + '"' + dis + '></div>' +
          '<div class="ag-f"><label>Modelo / conexão</label><input class="ag-in" data-k="modelo" maxlength="60" placeholder="Ex.: cone morse" value="' + esc(i.modelo || '') + '"' + dis + '></div>' +
          '<div class="ag-f"><label>Carga</label><select class="ag-in" data-k="carga"' + dis + '>' + opts(OP.cargas, i.carga, '—') + '</select></div></div>' +
          '<div class="ag-row c4"><div class="ag-f"><label>Diâmetro (mm)</label><input class="ag-in" data-k="diametro" inputmode="decimal" placeholder="3,5" value="' + num(i.diametro) + '"' + dis + '></div>' +
          '<div class="ag-f"><label>Comprimento (mm)</label><input class="ag-in" data-k="comprimento" inputmode="decimal" placeholder="11,5" value="' + num(i.comprimento) + '"' + dis + '></div>' +
          '<div class="ag-f"><label>Torque (Ncm)</label><input class="ag-in" data-k="torque" inputmode="decimal" placeholder="35" value="' + num(i.torque) + '"' + dis + '></div><div></div></div>' +
          '<table class="pc-tbl fe-etapas"><thead><tr><th>Etapa</th><th>Prevista para</th><th>Feita em</th></tr></thead><tbody>' + OP.etapas.map(function (e) {
            var x = et[e[0]] || {}
            return '<tr><td>' + esc(e[1]) + '</td><td><input class="ag-in" type="date" data-e="' + e[0] + '" data-c="prevista" value="' + (x.prevista || '') + '"' + dis + '></td><td><input class="ag-in" type="date" max="' + hoje() + '" data-e="' + e[0] + '" data-c="executada" value="' + (x.executada || '') + '"' + dis + '></td></tr>'
          }).join('') + '</tbody></table></div>'
      }).join('') : '<div class="pc-vazio" style="margin-bottom:12px">Nenhum implante. Use "+ Adicionar implante".</div>'
      el('fe-imps').querySelectorAll('[data-rm]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); lerImplantes(); implantes.splice(+a.getAttribute('data-rm'), 1); desenharImplantes() } })
    }
    function lerImplantes() {
      if (!el('fe-imps')) return
      implantes = Array.prototype.map.call(el('fe-imps').querySelectorAll('[data-imp]'), function (b) {
        var i = { etapas: {} }
        b.querySelectorAll('[data-k]').forEach(function (x) { var v = x.value.trim(); i[x.getAttribute('data-k')] = /diametro|comprimento|torque/.test(x.getAttribute('data-k')) ? v.replace(',', '.') : v })
        b.querySelectorAll('[data-e]').forEach(function (x) { var k = x.getAttribute('data-e'); i.etapas[k] = i.etapas[k] || {}; i.etapas[k][x.getAttribute('data-c')] = x.value || null })
        return i
      })
    }

    if (soLeitura) return
    el('fe-ok').onclick = async function () {
      var dados
      if (M) dados = M.ler()
      else if (tipo === 'ortodontia') dados = { filosofia: el('fe-fil').value, arcada: el('fe-arc').value, classe: el('fe-cla').value, previsao_termino: el('fe-prev').value || null, intervalo_dias: el('fe-int').value === '' ? '' : +el('fe-int').value, queixa: el('fe-qx').value, plano: el('fe-pl').value, contencao: el('fe-ct').value, observacoes: el('fe-obs').value }
      else { lerImplantes(); dados = { implantes: implantes, enxerto: el('fe-enx').value, observacoes: el('fe-obs').value } }
      var bt = this; bt.disabled = true
      var r = await apiPost('fichas-especialidade', { id: f ? f.id : undefined, paciente_id: p.id, tipo: tipo, status: el('fe-st').value, profissional_id: el('fe-prof').value || null, data_inicio: el('fe-ini').value, dados: dados })
      bt.disabled = false
      if (!r.success) return erro(r.error || 'Erro ao salvar')
      fechar(); depois()
    }
  }

  // ── Visita de acompanhamento ─────────────────────────────────────
  async function novaVisita(f, depois) {
    var profs = await profissionais(), orto = f.tipo === 'ortodontia'
    modal(orto ? 'Registrar manutenção' : MOD(f.tipo) ? 'Registrar ' + MOD(f.tipo).visita.replace('+ ', '').toLowerCase() : 'Registrar retorno', '<div id="fe-err"></div><div class="ag-row c2">' +
      '<div class="ag-f"><label>Data</label><input class="ag-in" type="date" id="fe-vd" max="' + hoje() + '" value="' + hoje() + '"></div>' +
      '<div class="ag-f"><label>Profissional</label><select class="ag-in" id="fe-vp"><option value="">—</option>' + profs.map(function (x) { return '<option value="' + x.id + '"' + (String(f.profissional_id) === String(x.id) ? ' selected' : '') + '>' + esc(x.nome) + '</option>' }).join('') + '</select></div></div>' +
      '<div class="ag-f"><label>O que foi feito</label><textarea class="ag-in" id="fe-vt" rows="3" maxlength="2000" placeholder="' + (orto ? 'Ex.: troca de fio 0.16 NiTi superior, ativação, elásticos classe II' : f.tipo === 'implante' ? 'Ex.: controle pós-cirúrgico, remoção de sutura' : 'Descreva o que foi feito') + '"></textarea></div>',
      '<button class="btn" id="fe-c">Cancelar</button><button class="ag-btn-novo" id="fe-ok">Registrar</button>', 560)
    el('fe-c').onclick = fechar
    el('fe-ok').onclick = async function () {
      var r = await apiPost('fichas-especialidade', { action: 'visita', ficha_id: f.id, data: el('fe-vd').value, profissional_id: el('fe-vp').value || null, descricao: el('fe-vt').value.trim() })
      if (!r.success) return erro(r.error || 'Erro ao registrar')
      fechar(); depois()
    }
  }

  // Estilo da lista de dados da ficha (rótulo em cima, valor embaixo)
  var css = document.createElement('style')
  css.textContent = '.fe-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px 24px}.fe-kv div{display:flex;flex-direction:column;gap:4px}.fe-kv span{font-size:12px;color:var(--text3)}.fe-kv b{font-size:14px;font-weight:500;color:var(--text)}' +
    '.fe-etapas{table-layout:fixed;width:100%}.fe-etapas th:first-child{width:30%}.fe-etapas td,.fe-etapas th{padding:8px 4px}.fe-etapas .ag-in{width:100%;min-width:0;padding:6px 4px;font-size:13px}.fe-modelo{border:1.5px solid var(--border);background:var(--surface);font-family:inherit;transition:border-color .12s ease,background .12s ease}.fe-modelo:hover{border-color:var(--green3);background:var(--green-light)}'
  document.head.appendChild(css)

  window.PRONT_TABS = window.PRONT_TABS || {}
  window.PRONT_TABS['fichas-esp'] = aba
})()
