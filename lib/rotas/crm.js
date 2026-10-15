// lib/rotas/crm.js — Funil de leads (CRM) e contrato gerado a partir do orçamento
// Klinov — Campo Grande, MS
//
//   leads               quadro do primeiro contato ao tratamento fechado; converte em paciente
//   lead-interacoes     histórico de contatos de um lead
//   orcamento-contrato  gera o contrato do orçamento (modelo "contrato" da clínica + anexo
//                       com procedimentos e forma de pagamento) como documento emitido,
//                       pronto para imprimir ou pedir assinatura eletrônica

var { pode } = require('../permissoes')

var ETAPAS = [['novo', 'Novo lead'], ['contato', 'Em contato'], ['avaliacao', 'Avaliação agendada'], ['orcamento', 'Orçamento apresentado'], ['fechado', 'Tratamento fechado'], ['perdido', 'Perdido']]
var ORIGENS = ['Instagram', 'Facebook', 'Google', 'Site', 'WhatsApp', 'Indicação', 'Campanha', 'Passou na frente', 'Outros']
var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function num(v) { var n = typeof v === 'string' ? Number(v.replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? n : 0 }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
function digitos(v) { return String(v || '').replace(/\D/g, '') }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
function moeda(v) { return 'R$ ' + r2(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }

async function lead(client, cid, id) { return (await client.execute({ sql: "SELECT * FROM crm_leads WHERE id=? AND clinica_id=?", args: [id, cid] })).rows[0] || null }

var CONTRATO_PADRAO = '<h2 style="text-align:center">CONTRATO DE PRESTAÇÃO DE SERVIÇOS ODONTOLÓGICOS</h2>' +
    '<p><b>CONTRATADA:</b> {{clinica.razao_social}}, CNPJ {{clinica.cnpj}}, com endereço em {{clinica.endereco}}.</p>' +
    '<p><b>CONTRATANTE:</b> {{paciente.nome}}, CPF {{paciente.cpf}}, residente em {{paciente.endereco_completo}}.</p>' +
    '<p><b>1. Objeto.</b> A CONTRATADA prestará ao CONTRATANTE os serviços odontológicos descritos no orçamento nº {{orcamento.numero}}, listados no anexo deste contrato.</p>' +
    '<p><b>2. Valor e pagamento.</b> O valor total é de {{orcamento.valor}}, pago conforme o anexo. O atraso sujeita o valor devido a multa e juros previstos em lei.</p>' +
    '<p><b>3. Obrigações.</b> O CONTRATANTE compromete-se a comparecer às consultas marcadas, seguir as orientações recebidas e informar qualquer alteração em sua saúde.</p>' +
    '<p><b>4. Prazo.</b> O tratamento pode ter o prazo alterado por fatores biológicos ou pelo não comparecimento do CONTRATANTE.</p>' +
    '<p><b>5. Foro.</b> Fica eleito o foro da comarca de {{clinica.cidade}} para dirimir dúvidas deste contrato.</p>' +
    '<p>{{clinica.cidade}}, {{data_extenso}}.</p>'

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }

    // ── Funil de leads ───────────────────────────────────────────
    if (route === 'leads') {
        if (req.method === 'GET') {
            var w = ["l.clinica_id=?", "COALESCE(l.arquivado,0)=?"], a = [clinica_id, q.arquivados ? 1 : 0]
            if (q.origem) { w.push("l.origem=?"); a.push(q.origem) }
            if (q.q) { w.push("(l.nome LIKE ? OR l.telefone LIKE ? OR l.campanha LIKE ?)"); var t = '%' + txt(q.q, 60) + '%'; a.push(t, t, t) }
            var rows = await client.execute({ sql: "SELECT l.*, (SELECT COUNT(*) FROM crm_lead_interacoes i WHERE i.lead_id=l.id AND i.clinica_id=l.clinica_id) interacoes, (SELECT MAX(criado_em) FROM crm_lead_interacoes i WHERE i.lead_id=l.id AND i.clinica_id=l.clinica_id) ultimo_contato FROM crm_leads l WHERE " + w.join(' AND ') + " ORDER BY l.atualizado_em DESC LIMIT 1000", args: a })
            var itens = rows.rows.map(function (l) {
                var ref = l.ultimo_contato || l.criado_em
                var dias = Math.floor((Date.now() - 4 * 3600 * 1000 - new Date(String(ref).replace(' ', 'T') + 'Z').getTime()) / 86400000)
                return Object.assign({}, l, { valor_estimado: r2(l.valor_estimado), interacoes: Number(l.interacoes), dias_sem_contato: dias, parado: ['novo', 'contato', 'avaliacao', 'orcamento'].indexOf(l.etapa) >= 0 && dias >= 3 })
            })
            var tot = { leads: itens.length, abertos: 0, valor_aberto: 0, fechados: 0, perdidos: 0 }
            itens.forEach(function (l) { if (l.etapa === 'fechado') tot.fechados++; else if (l.etapa === 'perdido') tot.perdidos++; else { tot.abertos++; tot.valor_aberto += l.valor_estimado } })
            tot.valor_aberto = r2(tot.valor_aberto)
            tot.conversao = tot.fechados + tot.perdidos ? Math.round(tot.fechados / (tot.fechados + tot.perdidos) * 1000) / 10 : 0
            return json(200, { success: true, etapas: ETAPAS.map(function (e) { return { id: e[0], nome: e[1] } }), origens: ORIGENS, itens: itens, totais: tot })
        }
        var ac = b.action
        if (ac === 'excluir') {
            if (!await pode(client, auth, 'crm.excluir')) return json(403, { success: false, error: 'Seu perfil não tem permissão para excluir leads' })
            var ex = await client.execute({ sql: "DELETE FROM crm_leads WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!ex.rowsAffected) return json(404, { success: false, error: 'Lead não encontrado' })
            await client.execute({ sql: "DELETE FROM crm_lead_interacoes WHERE lead_id=? AND clinica_id=?", args: [b.id, clinica_id] })
            return json(200, { success: true })
        }
        if (ac === 'mover' || ac === 'arquivar' || ac === 'desarquivar' || ac === 'interacao' || ac === 'converter') {
            var L = await lead(client, clinica_id, b.id)
            if (!L) return json(404, { success: false, error: 'Lead não encontrado' })
            if (ac === 'mover') {
                var et = ETAPAS.map(function (e) { return e[0] }).indexOf(b.etapa) >= 0 ? b.etapa : null
                if (!et) return json(400, { success: false, error: 'Etapa inválida' })
                if (et === 'perdido' && !txt(b.motivo, 200) && !L.perdido_motivo) return json(400, { success: false, error: 'Informe o motivo da perda' })
                await client.execute({ sql: "UPDATE crm_leads SET etapa=?, perdido_motivo=CASE WHEN ?='perdido' THEN COALESCE(NULLIF(?,''),perdido_motivo) ELSE NULL END, atualizado_em=? WHERE id=? AND clinica_id=?", args: [et, et, txt(b.motivo, 200), agoraCG(), L.id, clinica_id] })
                await client.execute({ sql: "INSERT INTO crm_lead_interacoes(clinica_id,lead_id,tipo,texto,criado_por_nome,criado_em) VALUES(?,?,'etapa',?,?,?)", args: [clinica_id, L.id, 'Movido para ' + ETAPAS.filter(function (e) { return e[0] === et })[0][1] + (et === 'perdido' && b.motivo ? ': ' + txt(b.motivo, 200) : ''), auth.nome || null, agoraCG()] })
                return json(200, { success: true })
            }
            if (ac === 'arquivar' || ac === 'desarquivar') {
                await client.execute({ sql: "UPDATE crm_leads SET arquivado=?, atualizado_em=? WHERE id=? AND clinica_id=?", args: [ac === 'arquivar' ? 1 : 0, agoraCG(), L.id, clinica_id] })
                return json(200, { success: true })
            }
            if (ac === 'interacao') {
                var tx = txt(b.texto, 1000), tp = ['ligacao', 'whatsapp', 'email', 'presencial', 'nota'].indexOf(b.tipo) >= 0 ? b.tipo : 'nota'
                if (!tx) return json(400, { success: false, error: 'Descreva o contato' })
                await client.execute({ sql: "INSERT INTO crm_lead_interacoes(clinica_id,lead_id,tipo,texto,criado_por_nome,criado_em) VALUES(?,?,?,?,?,?)", args: [clinica_id, L.id, tp, tx, auth.nome || null, agoraCG()] })
                var novaEt = L.etapa === 'novo' ? 'contato' : L.etapa
                await client.execute({ sql: "UPDATE crm_leads SET etapa=?, atualizado_em=? WHERE id=? AND clinica_id=?", args: [novaEt, agoraCG(), L.id, clinica_id] })
                return json(200, { success: true, etapa: novaEt })
            }
            // converter em paciente: reaproveita cadastro com o mesmo telefone
            if (L.paciente_id) return json(409, { success: false, error: 'Este lead já é paciente', paciente_id: L.paciente_id })
            var fone = digitos(L.telefone), existe = null
            if (fone.length >= 10) existe = (await client.execute({ sql: "SELECT id, nome FROM pacientes WHERE clinica_id=? AND (substr(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(telefone,''),'(',''),')',''),'-',''),' ',''),-8)=? OR substr(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(whatsapp,''),'(',''),')',''),'-',''),' ',''),-8)=?) LIMIT 1", args: [clinica_id, fone.slice(-8), fone.slice(-8)] })).rows[0] || null
            var pid
            if (existe) pid = existe.id
            else {
                var ip = await client.execute({ sql: "INSERT INTO pacientes(nome,telefone,whatsapp,email,como_conheceu,ativo,criado_em,clinica_id) VALUES(?,?,?,?,?,1,?,?)", args: [String(L.nome).toUpperCase(), L.telefone || '', L.telefone || '', L.email || '', L.origem || 'Outros', agoraCG(), clinica_id] })
                pid = Number(ip.lastInsertRowid)
            }
            await client.execute({ sql: "UPDATE crm_leads SET paciente_id=?, etapa=CASE WHEN etapa IN ('novo','contato') THEN 'avaliacao' ELSE etapa END, atualizado_em=? WHERE id=? AND clinica_id=?", args: [pid, agoraCG(), L.id, clinica_id] })
            await client.execute({ sql: "INSERT INTO crm_lead_interacoes(clinica_id,lead_id,tipo,texto,criado_por_nome,criado_em) VALUES(?,?,'etapa',?,?,?)", args: [clinica_id, L.id, existe ? 'Vinculado ao paciente já cadastrado' : 'Cadastrado como paciente', auth.nome || null, agoraCG()] })
            return json(200, { success: true, paciente_id: pid, existente: !!existe })
        }
        // criar / editar
        var nome = txt(b.nome, 120)
        if (!nome) return json(400, { success: false, error: 'Informe o nome' })
        if (!digitos(b.telefone) && !txt(b.email, 120)) return json(400, { success: false, error: 'Informe telefone ou e-mail' })
        var vals = [nome, txt(b.telefone, 30), txt(b.email, 120), ORIGENS.indexOf(b.origem) >= 0 ? b.origem : 'Outros', txt(b.campanha, 80), txt(b.interesse, 120), r2(num(b.valor_estimado)), txt(b.observacoes, 1000)]
        if (b.id) {
            var up = await client.execute({ sql: "UPDATE crm_leads SET nome=?,telefone=?,email=?,origem=?,campanha=?,interesse=?,valor_estimado=?,observacoes=?,atualizado_em=? WHERE id=? AND clinica_id=?", args: vals.concat([agoraCG(), b.id, clinica_id]) })
            if (!up.rowsAffected) return json(404, { success: false, error: 'Lead não encontrado' })
            return json(200, { success: true, id: Number(b.id) })
        }
        var ins = await client.execute({ sql: "INSERT INTO crm_leads(clinica_id,nome,telefone,email,origem,campanha,interesse,valor_estimado,observacoes,etapa,criado_por_nome,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,'novo',?,?,?)", args: [clinica_id].concat(vals).concat([auth.nome || null, agoraCG(), agoraCG()]) })
        return json(200, { success: true, id: Number(ins.lastInsertRowid) })
    }
    if (route === 'lead-interacoes') {
        var LL = await lead(client, clinica_id, q.lead_id)
        if (!LL) return json(404, { success: false, error: 'Lead não encontrado' })
        var it = await client.execute({ sql: "SELECT tipo, texto, criado_por_nome, criado_em FROM crm_lead_interacoes WHERE lead_id=? AND clinica_id=? ORDER BY id DESC LIMIT 200", args: [LL.id, clinica_id] })
        return json(200, { success: true, data: it.rows })
    }

    // ── Contrato do orçamento ────────────────────────────────────
    if (route === 'orcamento-contrato') {
        var o = (await client.execute({ sql: "SELECT * FROM orcamentos WHERE id=? AND clinica_id=?", args: [b.orcamento_id, clinica_id] })).rows[0]
        if (!o) return json(404, { success: false, error: 'Orçamento não encontrado' })
        var pac = (await client.execute({ sql: "SELECT * FROM pacientes WHERE id=? AND clinica_id=?", args: [o.paciente_id, clinica_id] })).rows[0]
        if (!pac) return json(404, { success: false, error: 'Paciente do orçamento não encontrado' })
        var itens = (await client.execute({ sql: "SELECT * FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=? ORDER BY id", args: [o.id, clinica_id] })).rows
        if (!itens.length) return json(400, { success: false, error: 'O orçamento não tem procedimentos' })
        var parc = (await client.execute({ sql: "SELECT * FROM parcelas_orcamento WHERE orcamento_id=? AND clinica_id=? AND COALESCE(status,'')<>'cancelado' ORDER BY data_vencimento, numero_parcela", args: [o.id, clinica_id] }).catch(function () { return { rows: [] } })).rows
        var cli = (await client.execute({ sql: "SELECT * FROM clinicas WHERE id=?", args: [clinica_id] })).rows[0] || {}
        var modelo = (await client.execute({ sql: "SELECT conteudo FROM documento_modelos WHERE clinica_id=? AND tipo='contrato' AND COALESCE(ativo,1)=1 ORDER BY id LIMIT 1", args: [clinica_id] }).catch(function () { return { rows: [] } })).rows[0]
        var total = r2(Number(o.valor_total || 0) - Number(o.desconto || 0))
        var agora = new Date(Date.now() - 4 * 3600 * 1000)
        var tabela = '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;border-bottom:1px solid #999;padding:4px">Procedimento</th><th style="text-align:left;border-bottom:1px solid #999;padding:4px">Dente/região</th><th style="text-align:right;border-bottom:1px solid #999;padding:4px">Valor</th></tr></thead><tbody>' +
            itens.map(function (i) { var qt = Number(i.quantidade) || 1; return '<tr><td style="padding:4px">' + esc(i.procedimento_nome) + (qt > 1 ? ' (' + qt + 'x)' : '') + '</td><td style="padding:4px">' + esc([i.dente, i.faces ? '(' + i.faces + ')' : '', i.regiao].filter(Boolean).join(' ') || '—') + '</td><td style="padding:4px;text-align:right">' + moeda(Number(i.valor_unitario || 0) * qt) + '</td></tr>' }).join('') +
            (Number(o.desconto) ? '<tr><td colspan="2" style="padding:4px;text-align:right">Desconto</td><td style="padding:4px;text-align:right">− ' + moeda(o.desconto) + '</td></tr>' : '') +
            '<tr><td colspan="2" style="padding:4px;text-align:right"><b>Total</b></td><td style="padding:4px;text-align:right"><b>' + moeda(total) + '</b></td></tr></tbody></table>'
        var pagamento = parc.length ? '<ul>' + parc.map(function (p) { return '<li>' + (p.tipo === 'entrada' ? 'Entrada' : 'Parcela ' + p.numero_parcela + '/' + p.total_parcelas) + ': ' + moeda(p.valor) + ' com vencimento em ' + br(p.data_vencimento) + (p.forma_pagamento ? ' (' + esc(p.forma_pagamento) + ')' : '') + '</li>' }).join('') + '</ul>' : '<p>' + esc(o.forma_pagamento || 'Forma de pagamento a combinar') + '.</p>'
        var vars = {
            'paciente.nome': pac.nome, 'paciente.cpf': pac.cpf, 'paciente.rg': pac.rg, 'paciente.data_nascimento': br(pac.data_nascimento), 'paciente.telefone': pac.telefone, 'paciente.email': pac.email,
            'paciente.endereco_completo': [pac.endereco, pac.numero, pac.complemento, pac.bairro, pac.cidade && (pac.cidade + (pac.uf ? '/' + pac.uf : '')), pac.cep && ('CEP ' + pac.cep)].filter(Boolean).join(', '),
            'paciente.responsavel': pac.responsavel_nome,
            'clinica.nome': cli.nome, 'clinica.razao_social': cli.razao_social || cli.nome, 'clinica.cnpj': cli.cnpj || cli.documento_numero,
            'clinica.endereco': [cli.endereco, cli.cidade, cli.estado].filter(Boolean).join(', '), 'clinica.cidade': cli.cidade, 'clinica.telefone': cli.telefone,
            'orcamento.numero': String(o.id), 'orcamento.valor': moeda(total), 'orcamento.data': br(o.data_aprovacao || o.data_criacao),
            'data': br(agora.toISOString().slice(0, 10)), 'data_extenso': agora.getUTCDate() + ' de ' + MESES[agora.getUTCMonth()] + ' de ' + agora.getUTCFullYear()
        }
        var html = String(modelo ? modelo.conteudo : CONTRATO_PADRAO)
        var usouItens = /\{\{\s*orcamento\.itens\s*\}\}/.test(html), usouPag = /\{\{\s*orcamento\.pagamento\s*\}\}/.test(html)
        html = html.replace(/\{\{\s*orcamento\.itens\s*\}\}/g, tabela).replace(/\{\{\s*orcamento\.pagamento\s*\}\}/g, pagamento)
            .replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, function (_, k) { return vars[k] != null && vars[k] !== '' ? esc(vars[k]) : '________' })
        if (!usouItens || !usouPag) html += '<h3>ANEXO — Orçamento nº ' + o.id + '</h3>' + (usouItens ? '' : tabela) + (usouPag ? '' : '<p><b>Forma de pagamento</b></p>' + pagamento)
        html = require('./pacientes').sanitizar(html)
        var titulo = 'Contrato — orçamento #' + o.id
        var di = await client.execute({ sql: "INSERT INTO documentos_emitidos(clinica_id,paciente_id,modelo_id,titulo,tipo,conteudo,profissional_id,criado_por_nome) VALUES(?,?,NULL,?,'contrato',?,?,?)", args: [clinica_id, pac.id, titulo, html, o.profissional_id || null, auth.nome || null] })
        var docId = Number(di.lastInsertRowid)
        return json(200, { success: true, documento_id: docId, titulo: titulo, paciente_id: pac.id })
    }

    return false
}

module.exports = { handle, ETAPAS, ORIGENS }
