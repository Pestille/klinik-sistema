// public/fichas-modelos.js — Telas das fichas de endodontia, periodontia (periograma),
// alinhadores e toxina botulínica. Cada modelo tem: form (HTML), montar (eventos),
// ler (dados para o servidor) e cartao (resumo na lista). Usado por fichas.js.
// Campos e textos iguais aos das fichas do Clinicorp; regras em lib/fichas-modelos.js.
;(function () {
  'use strict'
  function el(id) { return document.getElementById(id) }
  function esc(s) { return escHtml(s == null ? '' : s) }
  function br(d) { if (!d) return '—'; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
  function hoje() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  function num(v) { return v == null || v === '' ? '' : String(v).replace('.', ',') }
  function opts(mapa, sel, vazio) {
    return (vazio !== undefined ? '<option value="">' + esc(vazio) + '</option>' : '') +
      Object.keys(mapa).map(function (k) { return '<option value="' + esc(k) + '"' + (String(sel == null ? '' : sel) === k ? ' selected' : '') + '>' + esc(mapa[k]) + '</option>' }).join('')
  }
  function checks(nome, mapa, sel, dis) {
    sel = sel || []
    return '<div class="fm-chk">' + Object.keys(mapa).map(function (k) {
      return '<label><input type="checkbox" data-g="' + nome + '" value="' + k + '"' + (sel.indexOf(k) >= 0 ? ' checked' : '') + dis + '> ' + esc(mapa[k]) + '</label>' }).join('') + '</div>'
  }
  function lerChecks(box, nome) { return Array.prototype.map.call(box.querySelectorAll('[data-g="' + nome + '"]:checked'), function (x) { return x.value }) }
  function f(label, html, cls) { return '<div class="ag-f' + (cls ? ' ' + cls : '') + '"><label>' + label + '</label>' + html + '</div>' }
  function sec(t) { return '<div class="pc-box-h" style="margin:16px 0 8px">' + t + '</div>' }
  function lista(mapa, ks) { return (ks || []).map(function (k) { return mapa[k] }).filter(Boolean).join(', ') }

  var M = {}

  // ── Endodontia ───────────────────────────────────────────────────
  M.endodontia = {
    nome: 'Endodontia', visita: '+ Sessão', visitas: 'Sessões',
    descricao: 'Ficha Endodôntica por dente: diagnóstico, odontometria (canais) e finalização.',
    novo: function () { return { dentes: [] } },
    form: function (d, dis, OP) { return '<div id="fm-endo"></div>' + (dis ? '' : '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:16px">' + f('Dente (FDI)', '<input class="ag-in" id="fm-e-novo" maxlength="2" inputmode="numeric" placeholder="36" style="width:90px">') + '<button class="btn btn-sm" id="fm-e-add" style="margin-bottom:12px">+ Adicionar Dente</button></div>') + f('Observações', '<textarea class="ag-in" id="fe-obs" rows="2" maxlength="3000"' + dis + '>' + esc(d.observacoes || '') + '</textarea>') },
    montar: function (d, dis, OP) {
      var E = OP.endo, dentes = JSON.parse(JSON.stringify(d.dentes || [])), self = this
      self._ler = function () {
        Array.prototype.forEach.call(el('fm-endo').querySelectorAll('[data-dt]'), function (b, i) {
          var x = dentes[i]
          b.querySelectorAll('[data-k]').forEach(function (inp) { x[inp.getAttribute('data-k')] = inp.value })
          ;['condicao', 'sintomas', 'vitalidade', 'canais', 'proposto', 'final', 'intercorrencias'].forEach(function (g) { x[g] = lerChecks(b, g) })
          x.odontometria = Array.prototype.map.call(b.querySelectorAll('[data-od]'), function (r) { var o = {}; r.querySelectorAll('[data-c]').forEach(function (c) { o[c.getAttribute('data-c')] = c.value }); return o }).filter(function (o) { return o.canal })
        })
        return dentes
      }
      function desenhar() {
        el('fm-endo').innerHTML = dentes.length ? dentes.map(function (x, i) {
          var od = (x.odontometria || []).concat(dis ? [] : [{}])
          return '<div class="pc-box" style="margin-bottom:12px" data-dt="' + i + '"><div class="pc-box-h">Dente ' + esc(x.dente) + (dis ? '' : ' <a href="#" data-rmd="' + i + '" style="color:var(--red)">Remover Dente da Ficha</a>') + '</div>' +
            '<div class="ag-row c4">' + f('Situação', '<select class="ag-in" data-k="situacao"' + dis + '>' + opts(E.situacao, x.situacao || 'a_realizar') + '</select>') + f('Status', '<select class="ag-in" data-k="status"' + dis + '>' + opts(E.status, x.status || 'avaliacao') + '</select>') +
              f('Início', '<input class="ag-in" type="date" data-k="inicio" value="' + (x.inicio || '') + '"' + dis + '>') + f('Fim', '<input class="ag-in" type="date" data-k="fim" value="' + (x.fim || '') + '"' + dis + '>') + '</div>' +
            '<div class="pc-seg fm-tabs" style="margin:8px 0 12px"><div data-tab="d" class="on">Diagnóstico</div><div data-tab="o">Odontometria</div><div data-tab="f">Finalização</div></div>' +
            '<div data-p="d">' + sec('Condição do Elemento') + checks('condicao', E.condicao, x.condicao, dis) + sec('Sinais/Sintomas') + checks('sintomas', E.sintomas, x.sintomas, dis) +
              sec('Vitalidade') + checks('vitalidade', E.vitalidade, x.vitalidade, dis) + f('Observações Clinicas', '<textarea class="ag-in" data-k="obs_clinicas" rows="2" maxlength="2000"' + dis + '>' + esc(x.obs_clinicas || '') + '</textarea>') +
              sec('Exame') + '<div class="ag-row c3">' + f('Data do Raio-x', '<input class="ag-in" type="date" max="' + hoje() + '" data-k="data_raio_x" value="' + (x.data_raio_x || '') + '"' + dis + '>') + '<div></div><div></div></div>' +
              sec('Canais Radiculares') + checks('canais', E.canais, x.canais, dis) + f('Outro', '<input class="ag-in" data-k="canais_outro" maxlength="120" value="' + esc(x.canais_outro || '') + '"' + dis + '>') +
              f('Observações Radiograficas', '<textarea class="ag-in" data-k="obs_radiograficas" rows="2" maxlength="2000"' + dis + '>' + esc(x.obs_radiograficas || '') + '</textarea>') +
              sec('Tratamento Proposto') + checks('proposto', E.proposto, x.proposto, dis) + f('Outro', '<input class="ag-in" data-k="proposto_outro" maxlength="120" value="' + esc(x.proposto_outro || '') + '"' + dis + '>') + '</div>' +
            '<div data-p="o" style="display:none"><table class="pc-tbl fe-etapas"><thead><tr><th>Canal</th><th>Milímetro</th><th>Referência</th><th>Inst. Inicial</th><th>Inst. Final</th><th>Tipo Lima</th></tr></thead><tbody>' +
              od.map(function (c) { return '<tr data-od><td><select class="ag-in" data-c="canal"' + dis + '>' + opts(E.canal, c.canal, '—') + '</select></td><td><input class="ag-in" data-c="mm" inputmode="decimal" value="' + num(c.mm) + '"' + dis + '></td><td><input class="ag-in" data-c="referencia" maxlength="40" value="' + esc(c.referencia || '') + '"' + dis + '></td><td><input class="ag-in" data-c="inst_inicial" maxlength="20" value="' + esc(c.inst_inicial || '') + '"' + dis + '></td><td><input class="ag-in" data-c="inst_final" maxlength="20" value="' + esc(c.inst_final || '') + '"' + dis + '></td><td><input class="ag-in" data-c="lima" maxlength="40" value="' + esc(c.lima || '') + '"' + dis + '></td></tr>' }).join('') +
              '</tbody></table>' + (dis ? '' : '<button class="btn btn-sm" data-addc="' + i + '" style="margin:8px 0">+ Canal</button>') +
              f('Prescrição Terapeutica', '<textarea class="ag-in" data-k="prescricao" rows="2" maxlength="2000"' + dis + '>' + esc(x.prescricao || '') + '</textarea>') + f('Observações', '<textarea class="ag-in" data-k="obs_odontometria" rows="2" maxlength="2000"' + dis + '>' + esc(x.obs_odontometria || '') + '</textarea>') + '</div>' +
            '<div data-p="f" style="display:none">' + sec('Sinais/Sintomas Final') + checks('final', E.final, x.final, dis) + sec('Intercorrências') + checks('intercorrencias', E.intercorrencias, x.intercorrencias, dis) +
              f('Outro', '<input class="ag-in" data-k="intercorrencias_outro" maxlength="120" value="' + esc(x.intercorrencias_outro || '') + '"' + dis + '>') + f('Observações', '<textarea class="ag-in" data-k="obs_finalizacao" rows="2" maxlength="2000"' + dis + '>' + esc(x.obs_finalizacao || '') + '</textarea>') + '</div></div>'
        }).join('') : '<div class="pc-vazio" style="margin-bottom:12px">Selecione um Elemento: informe o dente e use "+ Adicionar Dente".</div>'
        el('fm-endo').querySelectorAll('[data-dt]').forEach(function (b) {
          b.querySelectorAll('[data-tab]').forEach(function (t) { t.onclick = function () { b.querySelectorAll('[data-tab]').forEach(function (z) { z.classList.toggle('on', z === t) }); b.querySelectorAll('[data-p]').forEach(function (p) { p.style.display = p.getAttribute('data-p') === t.getAttribute('data-tab') ? '' : 'none' }) } })
        })
        el('fm-endo').querySelectorAll('[data-rmd]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); self._ler(); dentes.splice(+a.getAttribute('data-rmd'), 1); desenhar() } })
        el('fm-endo').querySelectorAll('[data-addc]').forEach(function (a) { a.onclick = function () { self._ler(); var x = dentes[+a.getAttribute('data-addc')]; x.odontometria = (x.odontometria || []).concat([{ canal: '' }]); desenhar() } })
      }
      desenhar()
      if (el('fm-e-add')) el('fm-e-add').onclick = function () {
        var v = el('fm-e-novo').value.trim()
        if (!/^([1-4][1-8]|[5-8][1-5])$/.test(v)) return alert('Selecione um Elemento: informe o dente na notação FDI (ex.: 36).')
        self._ler()
        if (dentes.some(function (x) { return x.dente === v })) return alert('O dente ' + v + ' já está na ficha.')
        if (!confirm('Deseja criar uma nova ficha para o Dente ' + v + '?')) return
        dentes.push({ dente: v, situacao: 'a_realizar', status: 'avaliacao', inicio: hoje(), odontometria: [] }); el('fm-e-novo').value = ''; desenhar()
      }
    },
    ler: function () { return { dentes: this._ler(), observacoes: el('fe-obs').value } },
    cartao: function (fc, OP) {
      var ds = (fc.dados || {}).dentes || [], E = OP.endo
      return { titulo: 'Endodontia · ' + ds.length + (ds.length === 1 ? ' dente' : ' dentes'), corpo: ds.length ? '<table class="pc-tbl"><thead><tr><th>Dente</th><th>Status</th><th class="hide-sm">Tratamento Proposto</th><th class="hide-sm">Canais</th></tr></thead><tbody>' +
        ds.map(function (x) { return '<tr><td><b>' + esc(x.dente) + '</b> <span class="ag-hint" style="margin:0">' + esc(E.situacao[x.situacao] || '') + '</span></td><td>' + esc(E.status[x.status] || '') + '</td><td class="hide-sm">' + (esc(lista(E.proposto, x.proposto)) || '—') + '</td><td class="hide-sm">' + ((x.odontometria || []).map(function (c) { return esc(E.canal[c.canal]) + (c.mm != null ? ' ' + num(c.mm) + ' mm' : '') }).join(' · ') || '—') + '</td></tr>' }).join('') + '</tbody></table>' : '<div class="pc-vazio">Nenhum dente na ficha.</div>' }
    }
  }

  // ── Periodontia ──────────────────────────────────────────────────
  var SUP = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'], INF = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38']
  function temFurca(d) { return /^[1-4][678]$/.test(d) || /^[12]4$/.test(d) }
  M.periodontia = {
    nome: 'Periodontia', visita: '+ Sessão', visitas: 'Histórico de Sessões do Tratamento',
    descricao: 'Avaliações com sessões e Periograma: sondagem, margem gengival, sangramento, placa, mobilidade e furca.',
    novo: function () { return { avaliacoes: [] } },
    form: function (d, dis) {
      return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><select class="ag-in" id="fm-p-sel" style="width:auto;min-width:240px"></select>' + (dis ? '' : '<button class="btn btn-sm" id="fm-p-nova">+ Nova Avaliação</button><button class="btn btn-sm" id="fm-p-exc" style="color:var(--red)">Excluir Avaliação</button>') + '</div>' +
        '<div id="fm-p-av"></div>' + f('Observações', '<textarea class="ag-in" id="fe-obs" rows="2" maxlength="3000"' + dis + '>' + esc(d.observacoes || '') + '</textarea>')
    },
    montar: function (d, dis, OP) {
      var avs = JSON.parse(JSON.stringify(d.avaliacoes || [])), cur = avs.length ? avs.length - 1 : -1, arc = 'sup', self = this
      function lerAtual() {
        var av = avs[cur]; if (!av || !el('fm-p-av')) return
        var b = el('fm-p-av')
        if (b.querySelector('[data-a="nome"]')) { av.nome = b.querySelector('[data-a="nome"]').value; av.data = b.querySelector('[data-a="data"]').value; av.sessoes_qtd = b.querySelector('[data-a="qtd"]').value }
        b.querySelectorAll('[data-ses]').forEach(function (x) { var n = +x.getAttribute('data-ses'); av.sessoes[n] = av.sessoes[n] || { numero: n + 1 }; av.sessoes[n].finalizada_em = x.value || null })
        b.querySelectorAll('[data-dn]').forEach(function (col) {
          var dn = col.getAttribute('data-dn'), t = av.periograma[dn] || (av.periograma[dn] = { faces: {} })
          t.ausente = !!(col.querySelector('[data-t="ausente"]') || {}).checked
          t.implante = !!(col.querySelector('[data-t="implante"]') || {}).checked
          var mo = col.querySelector('[data-t="mobilidade"]'); if (mo) t.mobilidade = mo.value
          var fu = col.querySelector('[data-t="furca"]'); if (fu) t.furca = fu.value
          ;['vestibular', 'lingual'].forEach(function (fc) {
            var o = t.faces[fc] = t.faces[fc] || {}
            ;['sondagem', 'margem'].forEach(function (k) { o[k] = [0, 1, 2].map(function (i) { var x = col.querySelector('[data-f="' + fc + '"][data-m="' + k + '"][data-i="' + i + '"]'); return x && x.value !== '' ? x.value : null }) })
            ;['sangramento', 'placa'].forEach(function (k) { o[k] = [0, 1, 2].map(function (i) { var x = col.querySelector('[data-f="' + fc + '"][data-m="' + k + '"][data-i="' + i + '"]'); return !!(x && x.checked) }) })
          })
        })
      }
      self._ler = function () { lerAtual(); return avs }
      function sitio(dn, fc, k, i, t, desab) {
        var o = ((t.faces || {})[fc] || {})[k] || []
        if (k === 'sangramento' || k === 'placa') return '<input type="checkbox" class="fm-pc fm-' + k + '" title="' + (k === 'sangramento' ? 'Sangramento à sondagem' : 'Placa') + '" data-f="' + fc + '" data-m="' + k + '" data-i="' + i + '"' + (o[i] ? ' checked' : '') + desab + '>'
        return '<input class="fm-pn' + (k === 'sondagem' && Number(o[i]) >= 4 ? ' fm-bolsa' : '') + '" inputmode="numeric" maxlength="3" title="' + (k === 'sondagem' ? 'Profundidade de sondagem' : 'Margem gengival') + '" data-f="' + fc + '" data-m="' + k + '" data-i="' + i + '" value="' + (o[i] == null ? '' : o[i]) + '"' + desab + '>'
      }
      function linha(dentes, fc, k, rot, av) {
        return '<tr><th>' + rot + '</th>' + dentes.map(function (dn) { var t = av.periograma[dn] || {}, desab = dis || t.ausente ? ' disabled' : ''; return '<td data-dn-c="' + dn + '">' + [0, 1, 2].map(function (i) { return sitio(dn, fc, k, i, t, desab) }).join('') + '</td>' }).join('') + '</tr>'
      }
      function periograma(av) {
        var ds = arc === 'sup' ? SUP : INF, lin = arc === 'sup' ? 'Palatina' : 'Lingual'
        var cab = '<tr><th></th>' + ds.map(function (dn) { var t = av.periograma[dn] || {}; return '<th class="' + (t.ausente ? 'fm-aus' : '') + '">' + dn + '</th>' }).join('') + '</tr>'
        var extra = '<tr><th>Mobilidade</th>' + ds.map(function (dn) { var t = av.periograma[dn] || {}; return '<td><select class="fm-ps" data-t="mobilidade"' + (dis || t.ausente ? ' disabled' : '') + '>' + opts(OP.perio.mobilidade, t.mobilidade, '') + '</select></td>' }).join('') + '</tr>' +
          '<tr><th>Furca</th>' + ds.map(function (dn) { var t = av.periograma[dn] || {}, ok = temFurca(dn) && !t.implante; return '<td>' + (ok ? '<select class="fm-ps" data-t="furca"' + (dis || t.ausente ? ' disabled' : '') + '>' + opts(OP.perio.furca, t.furca) + '</select>' : '<span class="ag-hint" style="margin:0" title="' + (t.implante ? 'Furca não se aplica a implantes' : 'Furca não se aplica a este dente') + '">—</span>') + '</td>' }).join('') + '</tr>' +
          '<tr><th>Ausente / Implante</th>' + ds.map(function (dn) { var t = av.periograma[dn] || {}; return '<td><label title="Dente Removido"><input type="checkbox" data-t="ausente"' + (t.ausente ? ' checked' : '') + (dis ? ' disabled' : '') + '>A</label> <label title="Implante"><input type="checkbox" data-t="implante"' + (t.implante ? ' checked' : '') + (dis ? ' disabled' : '') + '>I</label></td>' }).join('') + '</tr>'
        var html = '<div style="overflow-x:auto"><table class="fm-perio"><thead>' + cab + '</thead><tbody>' +
          '<tr class="fm-face"><th colspan="17">Vestibular</th></tr>' + linha(ds, 'vestibular', 'sangramento', 'Sangramento à sondagem', av) + linha(ds, 'vestibular', 'placa', 'Placa', av) + linha(ds, 'vestibular', 'margem', 'Margem gengival', av) + linha(ds, 'vestibular', 'sondagem', 'Profundidade de sondagem', av) +
          extra +
          '<tr class="fm-face"><th colspan="17">' + lin + '</th></tr>' + linha(ds, 'lingual', 'sondagem', 'Profundidade de sondagem', av) + linha(ds, 'lingual', 'margem', 'Margem gengival', av) + linha(ds, 'lingual', 'placa', 'Placa', av) + linha(ds, 'lingual', 'sangramento', 'Sangramento à sondagem', av) +
          '</tbody></table></div>'
        // Agrupa as células por dente para a leitura
        return html
      }
      function desenhar() {
        var sel = el('fm-p-sel')
        sel.innerHTML = avs.length ? avs.map(function (a, i) { return '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>Avaliação ' + (i + 1) + ' · ' + esc(a.nome || 'Sem nome') + ' · ' + br(a.data) + '</option>' }).join('') : '<option>Selecione uma avaliação</option>'
        var box = el('fm-p-av'), av = avs[cur]
        if (!av) { box.innerHTML = '<div class="pc-vazio" style="text-align:center;padding:24px">Para iniciar, crie uma Nova Avaliação.</div>'; return }
        av.sessoes = av.sessoes || []; av.periograma = av.periograma || {}
        var qtd = Number(av.sessoes_qtd) || 0, r = av.resumo
        box.innerHTML = '<div class="ag-row c3">' + f('Nome do Tratamento *', '<input class="ag-in" data-a="nome" maxlength="120" placeholder="Ex.: Tratamento Periodontal" value="' + esc(av.nome || '') + '"' + dis + '>') +
          f('Data *', '<input class="ag-in" type="date" max="' + hoje() + '" data-a="data" value="' + (av.data || '') + '"' + dis + '>') + f('Quantidade de Sessões *', '<input class="ag-in" type="number" min="1" max="20" data-a="qtd" value="' + (av.sessoes_qtd || '') + '"' + dis + '><div class="ag-hint" style="margin:4px 0 0">Máximo de 20 sessões</div>') + '</div>' +
          (qtd ? sec('Sessões') + '<div class="fm-ses">' + Array.from({ length: qtd }, function (_, i) { var s = av.sessoes[i] || {}; return '<div class="fm-s' + (s.finalizada_em ? ' ok' : '') + '"><b>Sessão ' + (i + 1) + '</b>' + (s.finalizada_em ? '<span>Finalizada em ' + br(s.finalizada_em) + '</span>' : '<span>A realizar</span>') + '<input class="ag-in" type="date" max="' + hoje() + '" data-ses="' + i + '" value="' + (s.finalizada_em || '') + '" title="Finalizar Sessão"' + dis + '></div>' }).join('') + '</div>' : '') +
          sec('Periograma') + '<div class="ag-hint" style="margin:-4px 0 8px">Registro clínico detalhado dos parâmetros periodontais.' + (r && r.sitios ? ' · ' + r.sitios + ' sítios · sangramento ' + Math.round(r.sangramento * 100 / r.sitios) + '% · bolsas ≥ 4 mm: ' + r.bolsas : '') + '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><div class="pc-seg" id="fm-p-arc" style="margin:0"><div data-arc="sup"' + (arc === 'sup' ? ' class="on"' : '') + '>Arcada Superior</div><div data-arc="inf"' + (arc === 'inf' ? ' class="on"' : '') + '>Arcada Inferior</div></div>' +
          (dis || cur === 0 ? '' : '<button class="btn btn-sm" id="fm-p-rep">Replicar dados periodontais</button>') + '</div>' +
          '<div id="fm-p-pg">' + periograma(av) + '</div>'
        // marca cada célula com o dente da coluna
        var tb = box.querySelector('.fm-perio'), ds = arc === 'sup' ? SUP : INF
        tb.querySelectorAll('tbody tr').forEach(function (tr) { Array.prototype.forEach.call(tr.children, function (td, j) { if (j > 0 && td.tagName === 'TD') td.setAttribute('data-col', ds[j - 1]) }) })
        // colunas virtuais: um container por dente
        ds.forEach(function (dn) { var v = document.createElement('div'); v.setAttribute('data-dn', dn); v.style.display = 'none'; box.appendChild(v) })
        box.querySelectorAll('[data-dn]').forEach(function (v) {
          var dn = v.getAttribute('data-dn')
          v.querySelectorAll = function (q) { return tb.querySelectorAll('td[data-col="' + dn + '"] ' + q) }
          v.querySelector = function (q) { return tb.querySelector('td[data-col="' + dn + '"] ' + q) }
        })
        el('fm-p-arc').querySelectorAll('[data-arc]').forEach(function (x) { x.onclick = function () { lerAtual(); arc = x.getAttribute('data-arc'); desenhar() } })
        tb.querySelectorAll('[data-t="ausente"],[data-t="implante"]').forEach(function (x) { x.onchange = function () { lerAtual(); desenhar() } })
        if (el('fm-p-rep')) el('fm-p-rep').onclick = function () {
          if (!confirm('Replicar dados periodontais da avaliação anterior para esta?')) return
          lerAtual(); av.periograma = JSON.parse(JSON.stringify(avs[cur - 1].periograma || {})); desenhar()
        }
      }
      desenhar()
      el('fm-p-sel').onchange = function () { lerAtual(); cur = +this.value; desenhar() }
      if (el('fm-p-nova')) el('fm-p-nova').onclick = function () { lerAtual(); avs.push({ nome: '', data: hoje(), sessoes_qtd: 1, sessoes: [], periograma: {} }); cur = avs.length - 1; desenhar() }
      if (el('fm-p-exc')) el('fm-p-exc').onclick = function () { if (cur < 0 || !confirm('Deseja realmente excluir este registro da ficha?')) return; avs.splice(cur, 1); cur = avs.length - 1; desenhar() }
    },
    ler: function () { return { avaliacoes: this._ler(), observacoes: el('fe-obs').value } },
    cartao: function (fc) {
      var avs = (fc.dados || {}).avaliacoes || [], a = avs[avs.length - 1]
      if (!a) return { titulo: 'Periodontia', corpo: '<div class="pc-vazio">Para iniciar, crie uma Nova Avaliação.</div>' }
      var feitas = (a.sessoes || []).filter(function (s) { return s.finalizada_em }).length, r = a.resumo || {}
      return { titulo: 'Periodontia · ' + esc(a.nome), corpo: '<div class="fe-kv"><div><span>Avaliação</span><b>' + br(a.data) + (avs.length > 1 ? ' (' + avs.length + ' avaliações)' : '') + '</b></div><div><span>Sessões</span><b>' + feitas + ' de ' + a.sessoes_qtd + '</b></div>' +
        '<div><span>Sangramento à sondagem</span><b>' + (r.sitios ? Math.round(r.sangramento * 100 / r.sitios) + '%' : '—') + '</b></div><div><span>Bolsas ≥ 4 mm</span><b>' + (r.sitios ? r.bolsas + ' sítios' : '—') + '</b></div></div>' }
    }
  }

  // ── Alinhadores ──────────────────────────────────────────────────
  M.alinhadores = {
    nome: 'Alinhadores', visita: '+ Troca', visitas: 'Trocas e retornos',
    descricao: 'Quantidade de alinhadores, troca a cada N dias, alinhador atual e refinamentos.',
    novo: function () { return { trocar_dias: 14, refinamentos: [] } },
    form: function (d, dis) {
      return '<div class="ag-row c3">' + f('Empresa de alinhadores', '<input class="ag-in" id="fm-a-emp" maxlength="60" value="' + esc(d.empresa || '') + '"' + dis + '>') +
          f('Utilizar alinhador na arcada', '<select class="ag-in" id="fm-a-arc"' + dis + '>' + opts({ ambas: 'Superior e inferior', superior: 'Superior', inferior: 'Inferior' }, d.arcada, '—') + '</select>') + f('Link do Tratamento', '<input class="ag-in" id="fm-a-link" maxlength="300" placeholder="https://" value="' + esc(d.link || '') + '"' + dis + '>') + '</div>' +
        '<div class="ag-row c4">' + f('Quantidade de Alinhadores', '<input class="ag-in" type="number" min="1" max="120" id="fm-a-q" value="' + (d.quantidade || '') + '"' + dis + '>') + f('Trocar Alinhadores a Cada (dias)', '<input class="ag-in" type="number" min="1" max="60" id="fm-a-t" value="' + (d.trocar_dias || '') + '"' + dis + '>') +
          f('Data de Início', '<input class="ag-in" type="date" id="fm-a-ini" value="' + (d.inicio || '') + '"' + dis + '>') + f('Data de Fim', '<input class="ag-in" type="date" id="fm-a-fim" value="' + (d.fim || '') + '"' + dis + '>') + '</div>' +
        sec('Alinhador Atual') + '<div class="ag-row c4">' + f('Alinhador Atual', '<input class="ag-in" type="number" min="1" id="fm-a-at" value="' + (d.alinhador_atual || '') + '"' + dis + '>') + f('Início do Alinhador Atual', '<input class="ag-in" type="date" id="fm-a-iat" value="' + (d.inicio_atual || '') + '"' + dis + '>') + '<div id="fm-a-calc" style="grid-column:span 2"></div></div>' +
        sec('Refinamentos') + '<div id="fm-a-refs"></div>' + (dis ? '' : '<button class="btn btn-sm" id="fm-a-addr" style="margin-bottom:16px">+ Novos Alinhadores</button>') +
        f('Observações', '<textarea class="ag-in" id="fe-obs" rows="2" maxlength="3000"' + dis + '>' + esc(d.observacoes || '') + '</textarea>')
    },
    montar: function (d, dis) {
      var refs = JSON.parse(JSON.stringify(d.refinamentos || [])), self = this
      function addD(ymd, n) { var x = new Date(ymd + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
      function calc() {
        var at = +el('fm-a-at').value, ini = el('fm-a-iat').value, tr = +el('fm-a-t').value || 14
        var total = (+el('fm-a-q').value || 0) + refs.reduce(function (a, r) { return a + (+r.quantidade || 0) }, 0)
        el('fm-a-calc').innerHTML = at && ini ? '<div class="fe-kv" style="padding-top:20px"><div><span>Fim do Alinhador Atual</span><b>' + br(addD(ini, tr)) + '</b></div><div><span>Início do Próximo Alinhador</span><b>' + (at < total ? br(addD(ini, tr)) + ' (nº ' + (at + 1) + ')' : 'Último alinhador') + '</b></div></div>' : ''
      }
      function lerRefs() { refs = Array.prototype.map.call(el('fm-a-refs').querySelectorAll('[data-r]'), function (b) { var o = {}; b.querySelectorAll('[data-c]').forEach(function (c) { o[c.getAttribute('data-c')] = c.value }); return o }) }
      function desenhar() {
        el('fm-a-refs').innerHTML = refs.length ? refs.map(function (r, i) {
          return '<div class="ag-row c4" data-r="' + i + '">' + f('Quantidade de Novos Alinhadores', '<input class="ag-in" type="number" min="1" max="120" data-c="quantidade" value="' + (r.quantidade || '') + '"' + dis + '>') + f('Trocar a Cada (dias)', '<input class="ag-in" type="number" min="1" max="60" data-c="trocar_dias" value="' + (r.trocar_dias || '') + '"' + dis + '>') +
            f('Início', '<input class="ag-in" type="date" data-c="inicio" value="' + (r.inicio || '') + '"' + dis + '>') + (dis ? '<div></div>' : '<div style="padding-top:24px"><a href="#" data-rmr="' + i + '" style="color:var(--red)">Remover</a></div>') + '</div>' }).join('') : '<div class="ag-hint">Nenhum refinamento.</div>'
        el('fm-a-refs').querySelectorAll('[data-rmr]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); lerRefs(); refs.splice(+a.getAttribute('data-rmr'), 1); desenhar() } })
        el('fm-a-refs').querySelectorAll('input').forEach(function (x) { x.oninput = function () { lerRefs(); calc() } })
        calc()
      }
      desenhar()
      ;['fm-a-at', 'fm-a-iat', 'fm-a-t', 'fm-a-q'].forEach(function (id) { el(id).oninput = calc })
      if (el('fm-a-addr')) el('fm-a-addr').onclick = function () { lerRefs(); refs.push({ trocar_dias: el('fm-a-t').value }); desenhar() }
      self._ler = function () { lerRefs(); return refs }
    },
    ler: function () { return { empresa: el('fm-a-emp').value, arcada: el('fm-a-arc').value, link: el('fm-a-link').value, quantidade: el('fm-a-q').value, trocar_dias: el('fm-a-t').value, inicio: el('fm-a-ini').value || null, fim: el('fm-a-fim').value || null, alinhador_atual: el('fm-a-at').value, inicio_atual: el('fm-a-iat').value || null, refinamentos: this._ler(), observacoes: el('fe-obs').value } },
    cartao: function (fc) {
      var d = fc.dados || {}, an = fc.andamento
      return { titulo: 'Alinhadores' + (d.empresa ? ' · ' + esc(d.empresa) : ''), corpo: '<div class="fe-kv"><div><span>Alinhadores</span><b>' + (an ? an.total : (d.quantidade || '—')) + '</b></div><div><span>Trocar a cada</span><b>' + (d.trocar_dias ? d.trocar_dias + ' dias' : '—') + '</b></div>' +
        '<div><span>Alinhador Atual</span><b>' + (d.alinhador_atual || '—') + '</b></div><div><span>Fim do Alinhador Atual</span><b style="color:' + (an && an.fim_atual < hoje() ? 'var(--orange)' : 'var(--text)') + '">' + (an ? br(an.fim_atual) + (an.fim_atual < hoje() ? ' · trocar' : '') : '—') + '</b></div></div>' }
    }
  }

  // ── Toxina botulínica ────────────────────────────────────────────
  M.toxina = {
    nome: 'Toxina Botulínica', visita: '+ Retorno', visitas: 'Retornos',
    descricao: 'Lotes utilizados, aplicações por região (UI), retoques e cuidados pós-aplicação. Estética ou terapêutica.',
    novo: function () { return { finalidade: 'estetica', lotes: [{}], aplicacoes: [], cuidados: 'Não deitar nas próximas 4 horas.\nNão massagear a região aplicada.\nEvitar exercícios físicos intensos por 24 horas.\nEvitar exposição ao sol e calor intenso por 48 horas.' } },
    form: function (d, dis) {
      return '<div class="ag-row c3">' + f('Finalidade', '<select class="ag-in" id="fm-t-fin"' + dis + '>' + opts({ estetica: 'Toxina Botulínica Estética', terapeutica: 'Toxina Botulínica Terapêutica' }, d.finalidade || 'estetica') + '</select>') + '<div></div><div></div></div>' +
        sec('Lotes Utilizados') + '<div id="fm-t-lotes"></div>' + (dis ? '' : '<button class="btn btn-sm" id="fm-t-addl" style="margin-bottom:8px">+ Lote</button>') +
        sec('Aplicar Toxina') + '<div id="fm-t-aps"></div>' + (dis ? '' : '<div style="display:flex;gap:8px;margin-bottom:8px"><button class="btn btn-sm" id="fm-t-adda">+ Aplicação</button><button class="btn btn-sm" id="fm-t-addr">+ Aplicar Retoque</button></div>') +
        '<div id="fm-t-tot" class="ag-hint"></div>' +
        f('Cuidados Pós-Aplicação', '<textarea class="ag-in" id="fm-t-cui" rows="4" maxlength="3000"' + dis + '>' + esc(d.cuidados || '') + '</textarea>') +
        f('Observações', '<textarea class="ag-in" id="fe-obs" rows="2" maxlength="3000"' + dis + '>' + esc(d.observacoes || '') + '</textarea>')
    },
    montar: function (d, dis, OP) {
      var lotes = JSON.parse(JSON.stringify(d.lotes || [])), aps = JSON.parse(JSON.stringify(d.aplicacoes || [])), R = OP.toxina.regioes, self = this
      function lerTudo() {
        lotes = Array.prototype.map.call(el('fm-t-lotes').querySelectorAll('[data-l]'), function (b) { var o = {}; b.querySelectorAll('[data-c]').forEach(function (c) { o[c.getAttribute('data-c')] = c.value }); return o })
        aps = Array.prototype.map.call(el('fm-t-aps').querySelectorAll('[data-ap]'), function (b) { var o = { retoque: b.getAttribute('data-rt') === '1' }; b.querySelectorAll('[data-c]').forEach(function (c) { o[c.getAttribute('data-c')] = c.value }); return o })
      }
      function total() {
        var u = 0, p = 0
        aps.forEach(function (a) { u += Number(String(a.unidades || 0).replace(',', '.')) || 0; p += Number(String(a.preco || 0).replace(',', '.')) || 0 })
        el('fm-t-tot').innerHTML = aps.length ? 'Total dos Procedimentos: <b>' + num(Math.round(u * 10) / 10) + ' UI</b>' + (p ? ' · Preço total <b>R$ ' + p.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '</b>' : '') : ''
      }
      function desenhar() {
        var prods = lotes.map(function (l) { return l.produto }).filter(Boolean)
        el('fm-t-lotes').innerHTML = '<table class="pc-tbl fe-etapas"><thead><tr><th>Produto</th><th>Válidade</th><th>Núm do Lote</th><th>Volume Diluição (ml)</th><th></th></tr></thead><tbody>' + lotes.map(function (l, i) {
          return '<tr data-l="' + i + '"><td><input class="ag-in" data-c="produto" maxlength="80" placeholder="Ex.: Botox 100U" value="' + esc(l.produto || '') + '"' + dis + '></td><td><input class="ag-in" type="date" data-c="validade" value="' + esc(l.validade || '') + '"' + dis + '></td><td><input class="ag-in" data-c="lote" maxlength="40" value="' + esc(l.lote || '') + '"' + dis + '></td><td><input class="ag-in" data-c="diluicao" inputmode="decimal" value="' + num(l.diluicao) + '"' + dis + '></td><td>' + (dis ? '' : '<a href="#" data-rml="' + i + '" style="color:var(--red)">✕</a>') + '</td></tr>' }).join('') + '</tbody></table>'
        el('fm-t-aps').innerHTML = aps.length ? '<table class="pc-tbl fe-etapas"><thead><tr><th>Região</th><th>Produto</th><th>Quantidade (UI)</th><th>Preço</th><th>Data</th><th></th></tr></thead><tbody>' + aps.map(function (a, i) {
          return '<tr data-ap="' + i + '" data-rt="' + (a.retoque ? 1 : 0) + '"><td>' + (a.retoque ? '<span class="badge badge-orange" style="margin-bottom:4px">Retoque Facial</span>' : '') + '<select class="ag-in" data-c="regiao"' + dis + '>' + opts(R, a.regiao) + '</select></td>' +
            '<td><select class="ag-in" data-c="produto"' + dis + '>' + '<option value="">—</option>' + prods.map(function (p) { return '<option' + (p === a.produto ? ' selected' : '') + '>' + esc(p) + '</option>' }).join('') + '</select></td>' +
            '<td><input class="ag-in" data-c="unidades" inputmode="decimal" value="' + num(a.unidades) + '"' + dis + '></td><td><input class="ag-in" data-c="preco" inputmode="decimal" value="' + num(a.preco) + '"' + dis + '></td>' +
            '<td><input class="ag-in" type="date" max="' + hoje() + '" data-c="data" value="' + (a.data || hoje()) + '"' + dis + '></td><td>' + (dis ? '' : '<a href="#" data-rma="' + i + '" style="color:var(--red)">✕</a>') + '</td></tr>' }).join('') + '</tbody></table>' : '<div class="ag-hint">Nenhuma aplicação registrada.</div>'
        el('fm-t-lotes').querySelectorAll('[data-rml]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); lerTudo(); lotes.splice(+a.getAttribute('data-rml'), 1); desenhar() } })
        el('fm-t-aps').querySelectorAll('[data-rma]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); lerTudo(); aps.splice(+a.getAttribute('data-rma'), 1); desenhar() } })
        el('fm-t-lotes').querySelectorAll('[data-c="produto"]').forEach(function (x) { x.onchange = function () { lerTudo(); desenhar() } })
        el('fm-t-aps').querySelectorAll('input').forEach(function (x) { x.oninput = function () { lerTudo(); total() } })
        total()
      }
      desenhar()
      if (el('fm-t-addl')) el('fm-t-addl').onclick = function () { lerTudo(); lotes.push({}); desenhar() }
      if (el('fm-t-adda')) el('fm-t-adda').onclick = function () { lerTudo(); if (!lotes.some(function (l) { return l.produto })) alert('Antes de começar o procedimento adicione os produtos (Lotes Utilizados).'); aps.push({ regiao: 'glabelares', produto: (lotes[0] || {}).produto || '', data: hoje() }); desenhar() }
      if (el('fm-t-addr')) el('fm-t-addr').onclick = function () { lerTudo(); aps.push({ regiao: 'glabelares', produto: (lotes[0] || {}).produto || '', data: hoje(), retoque: true }); desenhar() }
      self._ler = function () { lerTudo(); return { lotes: lotes, aplicacoes: aps } }
    },
    ler: function () { var x = this._ler(); return { finalidade: el('fm-t-fin').value, lotes: x.lotes, aplicacoes: x.aplicacoes, cuidados: el('fm-t-cui').value, observacoes: el('fe-obs').value } },
    cartao: function (fc, OP) {
      var d = fc.dados || {}, aps = d.aplicacoes || [], R = OP.toxina.regioes, u = 0
      aps.forEach(function (a) { u += Number(a.unidades) || 0 })
      var ult = aps.map(function (a) { return a.data }).filter(Boolean).sort().pop()
      return { titulo: (d.finalidade === 'terapeutica' ? 'Toxina Botulínica Terapêutica' : 'Toxina Botulínica Estética'), corpo: '<div class="fe-kv"><div><span>Regiões</span><b>' + (esc(Array.from(new Set(aps.map(function (a) { return R[a.regiao] }))).join(', ')) || '—') + '</b></div><div><span>Total</span><b>' + (aps.length ? num(Math.round(u * 10) / 10) + ' UI' : '—') + '</b></div>' +
        '<div><span>Última aplicação</span><b>' + br(ult) + '</b></div><div><span>Lotes</span><b>' + (esc((d.lotes || []).map(function (l) { return l.produto + (l.lote ? ' (' + l.lote + ')' : '') }).join(', ')) || '—') + '</b></div></div>' }
    }
  }

  var css = document.createElement('style')
  css.textContent = '.fm-chk{display:flex;flex-wrap:wrap;gap:8px 20px;margin-bottom:8px}.fm-chk label{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--text2);cursor:pointer}' +
    '.fm-perio{border-collapse:collapse;font-size:12px}.fm-perio th{font-weight:500;color:var(--text3);padding:4px;white-space:nowrap;text-align:left}.fm-perio thead th{text-align:center;color:var(--text)}.fm-perio td{padding:2px 3px;border-bottom:1px solid var(--border2);text-align:center;white-space:nowrap}' +
    '.fm-perio .fm-face th{padding-top:12px;color:var(--green);text-transform:uppercase;letter-spacing:.04em}.fm-pn{width:22px;padding:2px 0;text-align:center;border:1px solid var(--border);border-radius:4px;font-size:12px}.fm-pn.fm-bolsa{border-color:var(--red);color:var(--red);font-weight:500}' +
    '.fm-pc{margin:0 1px}.fm-sangramento{accent-color:#C62828}.fm-placa{accent-color:#1565C0}.fm-ps{font-size:12px;padding:2px;border:1px solid var(--border);border-radius:4px}.fm-aus{text-decoration:line-through;color:var(--text3)!important}' +
    '.fm-ses{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.fm-s{display:flex;flex-direction:column;gap:4px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);font-size:13px;min-width:150px}.fm-s.ok{border-color:var(--green3);background:var(--green-light)}.fm-s span{font-size:12px;color:var(--text3)}'
  document.head.appendChild(css)

  window.FICHAS_MODELOS = M
})()
