// public/lote4.js — Caixa do dia, procedimentos no agendamento, encargos na baixa, tarefas,
// comparação de fotos e preferência de contato (inspirado nos serviços do Clinicorp)
// Klinov — Campo Grande, MS
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function v(id) { var e = el(id); return e ? e.value : '' }
  function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function hora(d) { return String(d || '').slice(11, 16) }
  function hoje() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
  function moeda(x) { return 'R$ ' + Number(x || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function numBr(x) { return Number(x || 0).toFixed(2).replace('.', ',') }
  function isAdmin() { return (window.KLINOV_USER && KLINOV_USER.perfil === 'admin') || ST.perfil === 'admin' }
  function pode(r) { return isAdmin() || !ST.permissoes || ST.permissoes[r] === 1 }

  function modal(titulo, corpo, botoes, largura) {
    var ov = el('l4-modal-ov')
    if (!ov) { ov = document.createElement('div'); ov.id = 'l4-modal-ov'; ov.className = 'ag-modal-ov'; ov.style.zIndex = '10014'; document.body.appendChild(ov) }
    ov.innerHTML = '<div class="ag-modal" style="max-width:' + (largura || 620) + 'px"><div class="ag-modal-h"><h3>' + esc(titulo) + '</h3><button class="ag-ico" id="l4-x">✕</button></div><div class="ag-modal-b"><div id="l4-err"></div>' + corpo + '</div><div class="ag-modal-f">' + (botoes || '') + '</div></div>'
    ov.classList.add('open')
    el('l4-x').onclick = fechar
    ov.onmousedown = function (e) { if (e.target === ov) fechar() }
  }
  function fechar() { var ov = el('l4-modal-ov'); if (ov) { ov.classList.remove('open'); ov.innerHTML = '' } }
  function erro(m) { var e = el('l4-err'); if (e) e.innerHTML = m ? '<div class="ag-err">' + esc(m) + '</div>' : '' }

  // Páginas novas + itens no menu lateral (antes do equipe.js montar o "Mais acessados")
  function criarPagina(id, titulo) {
    if (el('p-' + id)) return
    var ref = el('p-estoque'); if (!ref) return
    var pg = document.createElement('div'); pg.className = 'page gpage'; pg.id = 'p-' + id
    ref.parentNode.appendChild(pg)
    var mod = el('sb-modulos')
    if (mod) {
      var it = document.createElement('div'); it.className = 'sidebar-item'; it.setAttribute('onclick', "nav('" + id + "');toggleSidebar()"); it.textContent = titulo
      var depois = Array.prototype.filter.call(mod.querySelectorAll('.sidebar-item'), function (x) { return x.textContent.localeCompare(titulo, 'pt-BR') > 0 && !/Configura/.test(x.textContent) })[0]
      mod.insertBefore(it, depois || mod.lastElementChild)
    }
  }
  criarPagina('caixa', 'Caixa do dia')
  criarPagina('tarefas', 'Tarefas')

  // ════════════════════════════════════════════════════════════════
  // CAIXA DO DIA
  // ════════════════════════════════════════════════════════════════
  async function loadCaixa() {
    var pg = el('p-caixa'); if (!pg) return
    if (!pode('caixa.operar')) { pg.innerHTML = '<div class="gpage-body"><div class="pc-vazio">Seu perfil não opera o caixa.</div></div>'; return }
    pg.innerHTML = '<div class="gpage-header"><div><div class="gpage-title">Caixa do dia</div><div class="gpage-sub">Abertura, sangria, suprimento e fechamento com conferência</div></div><div class="fn-acoes"><button class="btn" id="cx-hist">Fechamentos anteriores</button></div></div><div class="gpage-body"><div id="cx-body"><div class="crc-sk" style="height:200px"></div></div></div>'
    el('cx-hist').onclick = historicoCaixa
    var d = await apiData('caixa', {}).catch(function (e) { return { success: false, error: e.message } })
    var b = el('cx-body'); if (!b) return
    if (!d.success) { b.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    if (!d.aberto) {
      b.innerHTML = '<div class="pc-box" style="max-width:480px"><div class="pc-box-h">Caixa fechado</div><p class="ag-hint" style="margin-top:0">' + (d.ultimo_fechamento ? 'Último fechamento em ' + br(d.ultimo_fechamento.fechado_em) + ' às ' + hora(d.ultimo_fechamento.fechado_em) + ', com ' + moeda(d.ultimo_fechamento.contado) + ' contados.' : 'Nenhum caixa aberto ainda.') + '</p>' +
        '<div class="ag-f"><label>Troco inicial em dinheiro (R$)</label><input class="ag-in" id="cx-ini" inputmode="decimal" value="' + (d.ultimo_fechamento ? numBr(d.ultimo_fechamento.contado) : '0,00') + '"></div><div style="text-align:right"><button class="ag-btn-novo" id="cx-abrir">Abrir caixa</button></div></div>'
      el('cx-abrir').onclick = async function () { var r = await apiPost('caixa', { action: 'abrir', saldo_inicial: v('cx-ini') }); if (!r.success) return alert(r.error); loadCaixa() }
      return
    }
    var s = d.sessao, r = d.resumo
    b.innerHTML = '<div class="fn-kpis">' + [['Troco inicial', moeda(r.saldo_inicial)], ['Dinheiro recebido', moeda(r.entradas_dinheiro)], ['Sangrias / suprimentos', '− ' + moeda(r.sangrias) + ' / + ' + moeda(r.suprimentos)], ['Esperado na gaveta', moeda(r.esperado)]].map(function (k) { return '<div class="pc-box fn-kpi"><div class="pc-box-h" style="margin-bottom:8px">' + k[0] + '</div><div class="fn-kpi-v">' + k[1] + '</div></div>' }).join('') + '</div>' +
      '<div class="l4-cx"><div class="pc-box"><div class="pc-box-h">Recebido por forma de pagamento</div>' + (r.por_forma.length ? '<table class="pc-tbl"><tbody>' + r.por_forma.map(function (f) { return '<tr><td>' + esc(f.forma) + '</td><td class="fn-num">' + moeda(f.valor) + '</td></tr>' }).join('') + '<tr><td><b>Total</b></td><td class="fn-num"><b>' + moeda(r.total_recebido) + '</b></td></tr></tbody></table>' : '<div class="pc-vazio" style="padding:8px 0;text-align:left">Nenhum recebimento ainda.</div>') +
      '<p class="ag-hint">Use para conferir a maquininha e os PIX. Saídas pagas em dinheiro (' + moeda(r.saidas_dinheiro) + ') já foram descontadas do esperado.</p></div>' +
      '<div class="pc-box"><div class="pc-box-h">Movimentações da gaveta</div>' + (r.manuais.length ? r.manuais.map(function (m) { return '<div class="pc-nota"><div>' + esc(m.descricao) + '<small>' + hora(m.criado_em) + (m.usuario_nome ? ' · ' + esc(m.usuario_nome) : '') + '</small></div><b style="color:' + (m.tipo === 'sangria' ? 'var(--red)' : 'var(--green)') + '">' + (m.tipo === 'sangria' ? '− ' : '+ ') + moeda(m.valor) + '</b></div>' }).join('') : '<div class="pc-vazio" style="padding:8px 0;text-align:left">Nenhuma sangria ou suprimento.</div>') +
      '<div class="fn-acoes" style="justify-content:flex-start;margin-top:12px"><button class="btn btn-sm" data-mv="suprimento">+ Suprimento</button><button class="btn btn-sm" data-mv="sangria">− Sangria</button></div></div></div>' +
      '<div class="pc-box" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div class="ag-hint" style="margin:0">Aberto em ' + br(s.aberto_em) + ' às ' + hora(s.aberto_em) + ' por ' + esc(s.aberto_por_nome || '—') + '</div><button class="ag-btn-novo" id="cx-fechar">Fechar caixa</button></div></div>'
    b.querySelectorAll('[data-mv]').forEach(function (bt) {
      bt.onclick = function () {
        var tp = this.getAttribute('data-mv')
        modal(tp === 'sangria' ? 'Sangria (retirada da gaveta)' : 'Suprimento (dinheiro colocado na gaveta)', '<div class="ag-row c2"><div class="ag-f"><label>Valor (R$)</label><input class="ag-in" id="cx-v" inputmode="decimal"></div><div class="ag-f"><label>Motivo</label><input class="ag-in" id="cx-d" maxlength="140" placeholder="' + (tp === 'sangria' ? 'Ex.: depósito no banco' : 'Ex.: troco extra') + '"></div></div>',
          '<button class="btn" id="cx-c">Cancelar</button><button class="ag-btn-novo" id="cx-ok">Registrar</button>', 520)
        el('cx-c').onclick = fechar
        el('cx-ok').onclick = async function () { var x = await apiPost('caixa', { action: 'movimento', tipo: tp, valor: v('cx-v'), descricao: v('cx-d') }); if (!x.success) return erro(x.error); fechar(); loadCaixa() }
      }
    })
    el('cx-fechar').onclick = function () {
      modal('Fechar caixa', '<p style="margin-top:0">Conte o dinheiro da gaveta e informe o total. O sistema compara com o esperado (<b>' + moeda(r.esperado) + '</b>).</p><div class="ag-f"><label>Dinheiro contado (R$)</label><input class="ag-in" id="cx-cont" inputmode="decimal"></div><div id="cx-dif" class="ag-hint"></div><div class="ag-f"><label>Observação</label><textarea class="ag-in" id="cx-obs" rows="2" maxlength="300" placeholder="Obrigatória se houver diferença"></textarea></div>',
        '<button class="btn" id="cx-c">Cancelar</button><button class="ag-btn-novo" id="cx-ok">Fechar caixa</button>', 520)
      el('cx-cont').oninput = function () { var c = Number(String(this.value).replace(/\./g, '').replace(',', '.')); if (!isFinite(c) || this.value === '') { el('cx-dif').textContent = ''; return } var df = Math.round((c - r.esperado) * 100) / 100; el('cx-dif').innerHTML = Math.abs(df) < 0.01 ? '<b style="color:var(--green)">Caixa confere.</b>' : '<b style="color:var(--red)">' + (df > 0 ? 'Sobra' : 'Falta') + ' de ' + moeda(Math.abs(df)) + '</b>' }
      el('cx-c').onclick = fechar
      el('cx-ok').onclick = async function () { var x = await apiPost('caixa', { action: 'fechar', contado: v('cx-cont'), observacao: v('cx-obs') }); if (!x.success) return erro(x.error); fechar(); loadCaixa() }
    }
  }
  async function historicoCaixa() {
    var d = await apiData('caixa', { historico: 1 }).catch(function () { return { data: [] } })
    modal('Fechamentos de caixa', d.data.length ? '<div class="oc-scroll"><table class="pc-tbl"><thead><tr><th>Aberto</th><th>Fechado</th><th style="text-align:right">Esperado</th><th style="text-align:right">Contado</th><th style="text-align:right">Diferença</th><th class="hide-sm">Observação</th></tr></thead><tbody>' + d.data.map(function (x) {
      return '<tr><td>' + br(x.aberto_em) + ' ' + hora(x.aberto_em) + '<div class="ag-hint" style="margin:0">' + esc(x.aberto_por_nome || '') + '</div></td><td>' + (x.fechado_em ? br(x.fechado_em) + ' ' + hora(x.fechado_em) + '<div class="ag-hint" style="margin:0">' + esc(x.fechado_por_nome || '') + '</div>' : '<span class="pc-badge pend">Aberto</span>') + '</td>' +
        '<td class="fn-num">' + (x.esperado != null ? moeda(x.esperado) : '—') + '</td><td class="fn-num">' + (x.contado != null ? moeda(x.contado) : '—') + '</td><td class="fn-num" style="color:' + (Math.abs(x.diferenca || 0) >= 0.01 ? 'var(--red)' : 'inherit') + '">' + (x.diferenca != null ? moeda(x.diferenca) : '—') + '</td><td class="hide-sm">' + esc(x.observacao || '') + '</td></tr>'
    }).join('') + '</tbody></table></div>' : '<div class="pc-vazio">Nenhum fechamento ainda.</div>', '<button class="ag-btn-novo" id="cx-f">Fechar</button>', 860)
    el('cx-f').onclick = fechar
  }

  // ════════════════════════════════════════════════════════════════
  // TAREFAS DA EQUIPE
  // ════════════════════════════════════════════════════════════════
  var TF = { escopo: 'minhas', status: 'aberta' }
  var PRI = { alta: ['Alta', 'err'], normal: ['Normal', 'off'], baixa: ['Baixa', 'off'] }
  async function loadTarefas() {
    var pg = el('p-tarefas'); if (!pg) return
    pg.innerHTML = '<div class="gpage-header"><div><div class="gpage-title">Tarefas</div><div class="gpage-sub">Combinados da equipe com responsável, prazo e checklist</div></div><div class="fn-acoes"><button class="ag-btn-novo" id="tf-novo">+ Nova tarefa</button></div></div>' +
      '<div class="gpage-body"><div class="ag-chips" style="margin-bottom:16px"><span class="ag-chip' + (TF.escopo === 'minhas' ? ' on' : '') + '" data-e="minhas">Minhas</span><span class="ag-chip' + (TF.escopo === 'todas' ? ' on' : '') + '" data-e="todas">Toda a equipe</span><span style="width:16px"></span><span class="ag-chip' + (TF.status === 'aberta' ? ' on' : '') + '" data-s="aberta">Abertas</span><span class="ag-chip' + (TF.status === 'concluida' ? ' on' : '') + '" data-s="concluida">Concluídas</span></div><div id="tf-lista"><div class="crc-sk" style="height:160px"></div></div></div>'
    pg.querySelectorAll('[data-e]').forEach(function (c) { c.onclick = function () { TF.escopo = this.getAttribute('data-e'); loadTarefas() } })
    pg.querySelectorAll('[data-s]').forEach(function (c) { c.onclick = function () { TF.status = this.getAttribute('data-s'); loadTarefas() } })
    var d = await apiData('tarefas', { minhas: TF.escopo === 'minhas' ? 1 : '', status: TF.status }).catch(function (e) { return { success: false, error: e.message } })
    el('tf-novo').onclick = function () { editarTarefa(null, d.usuarios || []) }
    var box = el('tf-lista'); if (!box) return
    if (!d.success) { box.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    box.innerHTML = d.data.length ? d.data.map(function (t) {
      var feitos = t.checklist.filter(function (c) { return c.feito }).length, p = PRI[t.prioridade] || PRI.normal
      return '<div class="pc-box l4-tf' + (t.atrasada ? ' atrasada' : '') + '"><div class="l4-tf-h"><label class="ag-chk" style="margin:0"><input type="checkbox" data-ok="' + t.id + '"' + (t.status === 'concluida' ? ' checked' : '') + '> <b style="color:var(--text);font-weight:500">' + esc(t.titulo) + '</b></label>' +
        (t.prioridade !== 'normal' ? '<span class="pc-badge ' + p[1] + '">' + p[0] + '</span>' : '') + '<a href="#" data-ed="' + t.id + '" style="margin-left:auto;color:var(--blue);font-size:13px">Editar</a></div>' +
        '<div class="ag-hint" style="margin:4px 0 0 28px">' + [t.responsavel_nome ? 'Para ' + esc(t.responsavel_nome) : 'Sem responsável', t.prazo ? (t.atrasada ? '<b style="color:var(--red)">venceu ' + br(t.prazo) + '</b>' : 'até ' + br(t.prazo)) : '', t.paciente_nome ? 'Paciente: <a href="#" data-pac="' + t.paciente_id + '">' + esc(t.paciente_nome) + '</a>' : '', t.checklist.length ? feitos + '/' + t.checklist.length + ' itens' : '', t.status === 'concluida' ? 'concluída ' + br(t.concluida_em) + (t.concluida_por_nome ? ' por ' + esc(t.concluida_por_nome) : '') : ''].filter(Boolean).join(' · ') + '</div>' +
        (t.descricao ? '<div style="margin:8px 0 0 28px;color:var(--text2)">' + esc(t.descricao) + '</div>' : '') +
        (t.checklist.length ? '<div style="margin:8px 0 0 28px">' + t.checklist.map(function (c, i) { return '<label class="ag-chk" style="display:flex;margin:4px 0"><input type="checkbox" data-ck="' + t.id + ':' + i + '"' + (c.feito ? ' checked' : '') + '> <span' + (c.feito ? ' style="text-decoration:line-through;color:var(--text3)"' : '') + '>' + esc(c.texto) + '</span></label>' }).join('') + '</div>' : '') + '</div>'
    }).join('') : '<div class="pc-vazio" style="padding:40px 0">' + (TF.status === 'aberta' ? 'Nenhuma tarefa aberta.' : 'Nenhuma tarefa concluída.') + '</div>'
    box.querySelectorAll('[data-ok]').forEach(function (c) { c.onchange = async function () { await apiPost('tarefas', { action: this.checked ? 'concluir' : 'reabrir', id: +this.getAttribute('data-ok') }); loadTarefas() } })
    box.querySelectorAll('[data-ck]').forEach(function (c) { c.onchange = async function () { var x = this.getAttribute('data-ck').split(':'); await apiPost('tarefas', { action: 'checklist', id: +x[0], indice: +x[1], feito: this.checked }); loadTarefas() } })
    box.querySelectorAll('[data-ed]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var id = +this.getAttribute('data-ed'); editarTarefa(d.data.filter(function (t) { return t.id === id })[0], d.usuarios) } })
    box.querySelectorAll('[data-pac]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); abrirProntuario('', +this.getAttribute('data-pac')) } })
  }
  function editarTarefa(t, usuarios) {
    t = t || { prioridade: 'normal', responsavel_id: window.KLINOV_USER ? KLINOV_USER.id : '', checklist: [] }
    modal(t.id ? 'Editar tarefa' : 'Nova tarefa', '<div class="ag-f"><label>Título</label><input class="ag-in" id="tf-tit" maxlength="160" value="' + esc(t.titulo || '') + '"></div>' +
      '<div class="ag-row c3"><div class="ag-f"><label>Responsável</label><select class="ag-in" id="tf-resp"><option value="">Ninguém</option>' + usuarios.map(function (u) { return '<option value="' + u.id + '"' + (String(u.id) === String(t.responsavel_id) ? ' selected' : '') + '>' + esc(u.nome) + '</option>' }).join('') + '</select></div>' +
      '<div class="ag-f"><label>Prazo</label><input class="ag-in" type="date" id="tf-prazo" value="' + esc(t.prazo || '') + '"></div><div class="ag-f"><label>Prioridade</label><select class="ag-in" id="tf-pri"><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option></select></div></div>' +
      '<div class="ag-f"><label>Descrição</label><textarea class="ag-in" id="tf-desc" rows="2" maxlength="2000">' + esc(t.descricao || '') + '</textarea></div>' +
      '<div class="ag-f"><label>Checklist (um item por linha)</label><textarea class="ag-in" id="tf-chk" rows="3">' + esc((t.checklist || []).map(function (c) { return c.texto }).join('\n')) + '</textarea></div>',
      (t.id ? '<button class="btn" id="tf-del" style="color:var(--red);margin-right:auto">Excluir</button>' : '') + '<button class="btn" id="tf-c">Cancelar</button><button class="ag-btn-novo" id="tf-ok">Salvar</button>', 640)
    el('tf-pri').value = t.prioridade || 'normal'
    el('tf-c').onclick = fechar
    if (el('tf-del')) el('tf-del').onclick = async function () { if (!confirm('Excluir esta tarefa?')) return; var r = await apiPost('tarefas', { action: 'excluir', id: t.id }); if (!r.success) return erro(r.error); fechar(); loadTarefas() }
    el('tf-ok').onclick = async function () {
      var antigos = {}; (t.checklist || []).forEach(function (c) { antigos[c.texto] = c.feito })
      var chk = v('tf-chk').split('\n').map(function (s) { return s.trim() }).filter(Boolean).map(function (s) { return { texto: s, feito: !!antigos[s] } })
      var r = await apiPost('tarefas', { id: t.id, titulo: v('tf-tit'), responsavel_id: v('tf-resp'), prazo: v('tf-prazo'), prioridade: v('tf-pri'), descricao: v('tf-desc'), checklist: chk, paciente_id: t.paciente_id || window._l4PacTarefa || null })
      if (!r.success) return erro(r.error)
      window._l4PacTarefa = null; fechar(); if (el('p-tarefas').classList.contains('active')) loadTarefas()
    }
  }
  window.novaTarefaPaciente = function (pacId) { window._l4PacTarefa = pacId; apiData('tarefas', { minhas: 1, status: 'aberta' }).then(function (d) { editarTarefa(null, d.usuarios || []) }) }

  // ════════════════════════════════════════════════════════════════
  // AGENDA: procedimentos do tratamento no agendamento
  // ════════════════════════════════════════════════════════════════
  window.procedimentosPop = async function (a) {
    var box = el('ag-pop-procs'); if (!box) return
    if (!a.paciente_id) { box.remove(); return }
    var d = await apiData('agendamento-procedimentos', { agendamento_id: a.id }).catch(function () { return null })
    if (!d || !el('ag-pop-procs')) return
    var lig = d.itens.filter(function (i) { return i.vinculado })
    if (!d.itens.length) { box.remove(); return }
    box.innerHTML = '<div class="lbl">Procedimentos do tratamento</div>' + (lig.length ? lig.map(function (i) { return '<div>' + (i.executado ? '✓ ' : '') + esc(i.procedimento_nome) + (i.dente ? ' · ' + esc(i.dente) : '') + '</div>' }).join('') : '<span style="color:var(--text3)">Nenhum escolhido</span>') +
      ' <a href="#" id="ag-proc-ed" style="color:var(--green3);font-size:13px">Escolher</a>'
    el('ag-proc-ed').onclick = function (e) {
      e.preventDefault()
      modal('Procedimentos desta consulta', '<p class="ag-hint" style="margin-top:0">Itens aprovados e ainda não executados. Ao marcar a consulta como Atendido, o sistema oferece registrar a execução.</p>' + d.itens.map(function (i) {
        return '<label class="ag-chk" style="display:flex;margin:8px 0"><input type="checkbox" value="' + i.id + '"' + (i.vinculado ? ' checked' : '') + (i.executado ? ' disabled' : '') + '> <span>' + esc(i.procedimento_nome) + (i.dente ? ' · dente ' + esc(i.dente) : '') + ' <span class="ag-hint" style="margin:0">orç. #' + i.orcamento_id + (i.executado ? ' · executado' : '') + (i.em_outro ? ' · já previsto para ' + br(i.em_outro) : '') + '</span></span></label>'
      }).join(''), '<button class="btn" id="ap-c">Cancelar</button><button class="ag-btn-novo" id="ap-ok">Salvar</button>', 600)
      el('ap-c').onclick = fechar
      el('ap-ok').onclick = async function () {
        var ids = Array.prototype.map.call(document.querySelectorAll('#l4-modal-ov input[type=checkbox]:checked'), function (c) { return +c.value })
        var r = await apiPost('agendamento-procedimentos', { agendamento_id: a.id, item_ids: ids }); if (!r.success) return erro(r.error)
        fechar(); window.procedimentosPop(a)
      }
    }
  }
  window.aposStatusAgenda = async function (a, st) {
    if (st !== 'atendido' || !a.paciente_id) return
    var d = await apiData('agendamento-procedimentos', { agendamento_id: a.id }).catch(function () { return null })
    var pend = d ? d.itens.filter(function (i) { return i.vinculado && !i.executado }) : []
    if (!pend.length || !pode('pacientes.ficha_clinica')) return
    if (!confirm('Registrar como executado(s)?\n\n' + pend.map(function (i) { return '• ' + i.procedimento_nome + (i.dente ? ' (dente ' + i.dente + ')' : '') }).join('\n'))) return
    for (var k = 0; k < pend.length; k++) await apiPost('marcar-executado', { orcamento_item_id: pend[k].id, data_execucao: a.date, profissional_id: a.ProfessionalId || pend[k].profissional_id || null, profissional_nome: a.ProfessionalName || pend[k].profissional_nome || '' })
    if (typeof toast === 'function') toast(pend.length + ' procedimento(s) registrado(s) na ficha clínica')
  }

  // ════════════════════════════════════════════════════════════════
  // BAIXA MANUAL COM MULTA, JUROS E DESCONTO (ficha do paciente)
  // ════════════════════════════════════════════════════════════════
  async function blocoEncargos(parcelaId, dataId, alvoId) {
    var alvo = el(alvoId); if (!alvo) return
    var d = await apiData('parcela-encargos', { id: parcelaId, data: v(dataId) }).catch(function () { return null })
    if (!d || !el(alvoId)) return
    alvo.innerHTML = '<div class="ag-row c3"><div class="ag-f"><label>Acréscimo (multa + juros)</label><input class="ag-in" id="enc-acr" inputmode="decimal" value="' + numBr(d.acrescimo) + '"></div><div class="ag-f"><label>Desconto</label><input class="ag-in" id="enc-desc" inputmode="decimal" value="' + numBr(d.desconto) + '"></div><div class="ag-f"><label>Total a receber</label><input class="ag-in" id="enc-tot" readonly value="' + moeda(d.total) + '"></div></div>' +
      '<p class="ag-hint" style="margin-top:0">' + (d.dias_atraso ? d.dias_atraso + ' dia(s) de atraso: multa ' + moeda(d.multa) + ' + juros ' + moeda(d.juros) + ' (Configurações › Taxas e encargos).' : (d.desconto ? 'Desconto por pagamento antecipado.' : 'Parcela em dia.')) + ' Você pode ajustar os valores.</p>'
    function recalc() { var a = Number(String(v('enc-acr')).replace(/\./g, '').replace(',', '.')) || 0, ds = Number(String(v('enc-desc')).replace(/\./g, '').replace(',', '.')) || 0; el('enc-tot').value = moeda(d.valor + a - ds) }
    el('enc-acr').oninput = recalc; el('enc-desc').oninput = recalc
  }
  window.encargosBaixa = blocoEncargos
  window.darBaixaParcela = function (parcelaId, pacId) {
    var FORMAS = [['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['debito', 'Cartão de débito'], ['credito', 'Cartão de crédito'], ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['cheque', 'Cheque']]
    modal('Receber parcela', '<div class="ag-row c2"><div class="ag-f"><label>Data do pagamento</label><input class="ag-in" type="date" id="bx-data" value="' + hoje() + '"></div><div class="ag-f"><label>Forma</label><select class="ag-in" id="bx-forma">' + FORMAS.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>' }).join('') + '</select></div></div><div id="bx-enc"><div class="crc-sk" style="height:60px"></div></div>',
      '<button class="btn" id="bx-c">Cancelar</button><button class="ag-btn-novo" id="bx-ok">Confirmar recebimento</button>', 600)
    blocoEncargos(parcelaId, 'bx-data', 'bx-enc')
    el('bx-data').onchange = function () { blocoEncargos(parcelaId, 'bx-data', 'bx-enc') }
    el('bx-c').onclick = fechar
    el('bx-ok').onclick = async function () {
      var r = await apiPost('parcela-baixa', { id: parcelaId, data_pagamento: v('bx-data'), forma_pagamento: v('bx-forma'), acrescimo: v('enc-acr'), desconto: v('enc-desc') })
      if (!r.success) return erro(r.error || 'Erro ao dar baixa')
      fechar(); if (typeof loadFinanceiroPaciente === 'function') loadFinanceiroPaciente(pacId)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // FOTOS: comparar antes e depois
  // ════════════════════════════════════════════════════════════════
  window.compararFotos = function (fotos) {
    if (fotos.length < 2) return alert('São necessárias pelo menos duas fotos.')
    var ops = fotos.map(function (f, i) { return '<option value="' + i + '">' + esc((f.pasta ? f.pasta + ' · ' : '') + (f.nome || 'Foto') + ' · ' + br(f.created_at)) + '</option>' }).join('')
    modal('Comparar fotos', '<div class="ag-row c2"><div class="ag-f"><label>Antes</label><select class="ag-in" id="cmp-a">' + ops + '</select></div><div class="ag-f"><label>Depois</label><select class="ag-in" id="cmp-b">' + ops + '</select></div></div>' +
      '<div class="l4-cmp" id="cmp-box"><img id="cmp-ia" alt="Antes"><div class="l4-cmp-dep" id="cmp-dep"><img id="cmp-ib" alt="Depois"></div><div class="l4-cmp-linha" id="cmp-lin"></div></div>' +
      '<input type="range" min="0" max="100" value="50" id="cmp-r" style="width:100%;margin-top:8px"><div class="ag-hint" style="display:flex;justify-content:space-between;margin:0"><span>Antes</span><span>Arraste para comparar</span><span>Depois</span></div>',
      '<button class="ag-btn-novo" id="cmp-f">Fechar</button>', 900)
    el('cmp-b').value = String(fotos.length > 1 ? 1 : 0)
    function trocar() { el('cmp-ia').src = fotos[+v('cmp-a')].url; el('cmp-ib').src = fotos[+v('cmp-b')].url }
    function deslizar() { var p = v('cmp-r') + '%'; el('cmp-dep').style.clipPath = 'inset(0 0 0 ' + p + ')'; el('cmp-lin').style.left = p }
    el('cmp-a').onchange = trocar; el('cmp-b').onchange = trocar; el('cmp-r').oninput = deslizar
    el('cmp-f').onclick = fechar
    trocar(); deslizar()
  }

  // ════════════════════════════════════════════════════════════════
  // INÍCIO
  // ════════════════════════════════════════════════════════════════
  if (typeof window.nav === 'function') {
    var navAnt = window.nav
    window.nav = function (id) {
      var r = navAnt.apply(this, arguments)
      if (id === 'caixa') loadCaixa()
      if (id === 'tarefas') loadTarefas()
      return r
    }
  }
  window.loadCaixa = loadCaixa
  window.loadTarefas = loadTarefas
})()
