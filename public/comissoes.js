// public/comissoes.js — Comissão em valor fixo por procedimento (aba de comissão do profissional)
// Klinov — Campo Grande, MS
;(function () {
  'use strict'

  function esc(s) { return escHtml(s == null ? '' : s) }
  function val(id) { var e = document.getElementById(id); return e ? e.value : '' }
  var INPUT = 'width:100%;box-sizing:border-box;border:1.5px solid var(--border);border-radius:6px;padding:9px 12px;font-size:14px;color:var(--text);background:var(--surface);outline:none'
  var LABEL = 'display:block;font-size:12px;font-weight:500;color:var(--text3);margin-bottom:4px'

  window.renderComissaoProcedimento = async function (raiz, profId, tabelas) {
    var box = document.createElement('div')
    box.style.marginTop = '32px'
    raiz.appendChild(box)

    async function carregar() {
      try {
        var d = await apiData('comissoes-procedimento', { profissional_id: profId })
        desenhar(d.regras || [])
      } catch (e) { box.innerHTML = '<div style="color:var(--red)">' + esc(e.message) + '</div>' }
    }

    function desenhar(regras) {
      var linhas = regras.map(function (r) {
        return '<tr><td>' + esc(r.procedimento_nome) + '</td><td>' + esc(r.tabela_preco) + '</td>' +
          '<td style="text-align:right;font-variant-numeric:tabular-nums">' + esc(fmtBrl(r.valor)) + '</td>' +
          '<td>' + (r.valido_desde ? esc(fmtDt(r.valido_desde)) : '—') + '</td><td>' + (r.valido_ate ? esc(fmtDt(r.valido_ate)) : '—') + '</td>' +
          '<td><button data-excluir="' + Number(r.id) + '" style="background:transparent;color:var(--red);border:1px solid var(--red);border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">Excluir</button></td></tr>'
      }).join('')
      box.innerHTML =
        '<div style="font-size:16px;font-weight:500;color:var(--text);margin-bottom:4px">Valor fixo por procedimento</div>' +
        '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Pago na execução e tem prioridade sobre a regra geral. Valor zero significa que o procedimento não gera comissão.</div>' +
        '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:12px;align-items:end;margin-bottom:16px">' +
          '<div><label style="' + LABEL + '" for="cp-nome">Procedimento</label><input id="cp-nome" maxlength="200" style="' + INPUT + '"></div>' +
          '<div><label style="' + LABEL + '" for="cp-tabela">Tabela</label><select id="cp-tabela" style="' + INPUT + '">' + tabelas.map(function (t) { return '<option' + (t === 'TODAS' ? ' selected' : '') + '>' + esc(t) + '</option>' }).join('') + '</select></div>' +
          '<div><label style="' + LABEL + '" for="cp-valor">Valor (R$)</label><input id="cp-valor" type="number" min="0" step="0.01" style="' + INPUT + '"></div>' +
          '<div><label style="' + LABEL + '" for="cp-desde">Válido desde</label><input id="cp-desde" type="date" style="' + INPUT + '"></div>' +
          '<div><label style="' + LABEL + '" for="cp-ate">Válido até</label><input id="cp-ate" type="date" style="' + INPUT + '"></div>' +
          '<button id="cp-add" style="background:var(--orange);color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:13px;font-weight:500;cursor:pointer">Adicionar</button>' +
        '</div>' +
        '<div id="cp-erro" style="color:var(--red);font-size:13px;margin-bottom:8px"></div>' +
        (regras.length
          ? '<table class="tbl" style="width:100%"><thead><tr><th>Procedimento</th><th>Tabela</th><th style="text-align:right">Valor</th><th>Válido desde</th><th>Válido até</th><th></th></tr></thead><tbody>' + linhas + '</tbody></table>'
          : '<div style="text-align:center;padding:24px;color:var(--text3)">Nenhum valor fixo cadastrado.</div>')

      document.getElementById('cp-add').onclick = async function () {
        var erro = document.getElementById('cp-erro'), nome = val('cp-nome').trim(), valor = val('cp-valor')
        erro.textContent = ''
        if (!nome || valor === '') { erro.textContent = 'Informe o procedimento e o valor.'; return }
        var r = await apiPost('comissoes-procedimento', { profissional_id: profId, procedimento_nome: nome, tabela_preco: val('cp-tabela'), valor: parseFloat(valor), valido_desde: val('cp-desde'), valido_ate: val('cp-ate') })
        if (r.success) carregar(); else erro.textContent = r.error || 'Não foi possível salvar.'
      }
      box.querySelectorAll('[data-excluir]').forEach(function (b) {
        b.onclick = async function () {
          if (!confirm('Excluir este valor fixo?')) return
          await apiPost('comissoes-procedimento', { action: 'delete', id: Number(b.getAttribute('data-excluir')) })
          carregar()
        }
      })
    }

    carregar()
  }
})()
