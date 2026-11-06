// public/agenda-online.js — Configurações › Agenda › Agendamento online
// Klinov — Campo Grande, MS
;(function () {
  'use strict'

  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function brHora(d) { var s = String(d || ''); var p = s.slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] + ' ' + s.slice(11, 16) : s }

  async function cfgAgendaOnline(box) {
    var d = await apiData('agenda-online-config', {}).catch(function (e) { return { success: false, error: e.message } })
    if (!d.success) { box.innerHTML = '<div class="ag-err">' + esc(d.error || 'Erro') + '</div>'; return }
    var url = location.origin + d.caminho, c = d.cfg

    box.innerHTML =
      '<div class="pc-box"><div class="pc-box-h">Link público</div>' +
        '<label class="ag-chk cf-chk"><input type="checkbox" id="ao-ativo"' + (c.ativo ? ' checked' : '') + '> <span>Permitir que pacientes agendem pela internet</span></label>' +
        '<label class="ag-chk cf-chk" style="margin-top:8px"><input type="checkbox" id="ao-aprov"' + (c.exigir_aprovacao ? ' checked' : '') + '> <span>Exigir aprovação da clínica (o pedido aparece em Agenda › Pedidos online)</span></label>' +
        '<div class="ag-f" style="margin-top:12px"><label for="ao-url">Link para divulgar</label><input class="ag-in" id="ao-url" readonly value="' + esc(url) + '"></div>' +
        '<div class="fn-acoes" style="margin-top:8px"><button class="btn" id="ao-copiar">Copiar link</button><button class="btn" id="ao-abrir">Abrir</button><button class="btn" id="ao-qr">Ver QR Code</button></div>' +
        '<div id="ao-qr-box" style="margin-top:12px"></div>' +
        '<div class="ag-row c2" style="margin-top:12px">' +
          '<div class="ag-f"><label for="ao-ant">Antecedência mínima (horas)</label><input class="ag-in" id="ao-ant" type="number" min="0" max="168" value="' + Number(c.antecedencia_horas) + '"></div>' +
          '<div class="ag-f"><label for="ao-dias">Agendar até quantos dias à frente</label><input class="ag-in" id="ao-dias" type="number" min="1" max="90" value="' + Number(c.dias_max) + '"></div>' +
        '</div>' +
        '<p class="ag-hint">O paciente só vê horários livres, dentro do horário de atendimento de cada profissional e sem bloqueios. Sem aprovação, a consulta entra na agenda como "Agendado" e segue a confirmação padrão da clínica. Com aprovação, entra como "Aguardando aprovação", segura o horário e não recebe confirmação até ser aprovada.</p>' +
      '</div>' +
      '<div class="pc-box" style="margin-top:16px"><div class="pc-box-h">Profissionais no link</div>' +
        (d.profissionais.length ? '<table class="tbl"><thead><tr><th>Profissional</th><th style="width:120px">No link</th><th style="width:160px">Duração (min)</th></tr></thead><tbody>' + d.profissionais.map(function (p) {
          return '<tr><td class="pname">' + esc(p.nome) + '</td><td><input type="checkbox" data-on="' + Number(p.id) + '" aria-label="Mostrar ' + esc(p.nome) + ' no link"' + (Number(p.online) ? ' checked' : '') + '></td>' +
            '<td><input class="ag-in" type="number" min="10" max="240" step="5" data-dur="' + Number(p.id) + '" aria-label="Duração da consulta de ' + esc(p.nome) + '" value="' + Number(p.duracao_min) + '"></td></tr>'
        }).join('') + '</tbody></table>' : '<p class="ag-hint">Nenhum profissional ativo.</p>') +
        '<div id="ao-msg" style="margin-top:8px"></div><div style="text-align:right;margin-top:16px"><button class="ag-btn-novo" id="ao-ok">Salvar</button></div>' +
      '</div>' +
      '<div class="pc-box" style="margin-top:16px"><div class="pc-box-h">Últimos agendamentos pelo link</div>' +
        (d.recentes.length ? d.recentes.map(function (r) { return '<div class="pc-item"><b>' + esc(r.paciente_nome) + '</b> · ' + esc(brHora(r.data_hora)) + ' · ' + esc(r.profissional_nome || '') + ' · ' + esc(r.status === 'solicitado' ? 'aguardando aprovação' : (r.status || '')) + '</div>' }).join('') : '<p class="ag-hint" style="margin:0">Nenhum agendamento pelo link até agora.</p>') +
        '<p class="ag-hint" style="margin:16px 0 0">Se o link for parar onde não deve, gere outro: o atual para de funcionar. <a href="#" id="ao-ren" style="color:var(--red)">Gerar novo link</a></p>' +
      '</div>'

    el('ao-copiar').onclick = function () { try { navigator.clipboard.writeText(url) } catch (e) {} this.textContent = 'Copiado' }
    el('ao-abrir').onclick = function () { window.open(url, '_blank', 'noopener') }
    el('ao-qr').onclick = function () { var q = el('ao-qr-box'); q.innerHTML = q.innerHTML ? '' : '<div style="max-width:220px">' + window.svgQr(url) + '</div>' }
    el('ao-ok').onclick = async function () {
      var lista = d.profissionais.map(function (p) {
        return { id: p.id, ativo: box.querySelector('[data-on="' + Number(p.id) + '"]').checked, duracao_min: box.querySelector('[data-dur="' + Number(p.id) + '"]').value }
      })
      var ativo = el('ao-ativo').checked
      var m = el('ao-msg')
      if (ativo && !lista.some(function (x) { return x.ativo })) { m.innerHTML = '<div class="ag-err">Escolha ao menos um profissional para ligar o link.</div>'; return }
      var r = await apiPost('agenda-online-config', { ativo: ativo, exigir_aprovacao: el('ao-aprov').checked, antecedencia_horas: el('ao-ant').value, dias_max: el('ao-dias').value, profissionais: lista }).catch(function (e) { return { success: false, error: e.message } })
      if (!r.success) { m.innerHTML = '<div class="ag-err">' + esc(r.error || 'Erro ao salvar') + '</div>'; return }
      cfgAgendaOnline(box)
    }
    el('ao-ren').onclick = async function (e) {
      e.preventDefault()
      if (!confirm('Gerar um novo link? O link atual deixa de funcionar.')) return
      var r = await apiPost('agenda-online-config', { action: 'renovar' }).catch(function (x) { return { success: false, error: x.message } })
      if (!r.success) return alert(r.error || 'Erro')
      cfgAgendaOnline(box)
    }
  }

  window.cfgAgendaOnline = cfgAgendaOnline
})()
