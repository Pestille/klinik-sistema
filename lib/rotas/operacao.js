// lib/rotas/operacao.js — Caixa do dia, procedimentos no agendamento, encargos na baixa e tarefas
// Klinov — Campo Grande, MS
//
// Inspirado nos serviços teller, appointment/save_treatment, payment/interest_fees e task do Clinicorp.
//   caixa                      abertura com troco, suprimento/sangria e fechamento com conferência.
//                              O esperado em dinheiro sai de movimentos() (forma Dinheiro) — nada é
//                              lançado em dobro; suprimento e sangria são só movimentação física.
//   agendamento-procedimentos  liga itens de tratamento aprovado ao agendamento
//   parcela-encargos           multa, juros (pro rata dia) e desconto antecipado de uma parcela
//   tarefas                    tarefas da equipe com responsável, prazo e checklist

var { movimentos } = require('./financeiro')

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function num(v) { var n = typeof v === 'string' ? Number(v.replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? n : 0 }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
function difDias(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000) }

async function tentar(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args || [] })).rows }
    catch (e) { if (/no such (table|column)/i.test(e.message || '')) return []; throw e }
}

// ── Encargos de uma parcela paga em atraso (ou com desconto antecipado) ──
async function encargos(client, cid, parcela, data) {
    var cfg = (await tentar(client, "SELECT * FROM taxas_config WHERE clinica_id=?", [cid]))[0] || {}
    var venc = String(parcela.data_vencimento || '').slice(0, 10), valor = r2(parcela.valor)
    var dias = DATA_RE.test(venc) ? difDias(venc, data) : 0
    var multa = 0, juros = 0, desconto = 0
    if (dias > 0) {
        multa = r2(valor * Math.min(Number(cfg.multa_percent) || 0, 2) / 100)
        juros = r2(valor * (Math.min(Number(cfg.juros_mes_percent) || 0, 1) / 100 / 30) * dias)
    } else if (Number(cfg.desconto_percent) > 0 && -dias >= (Number(cfg.desconto_dias) || 0)) {
        desconto = r2(valor * Number(cfg.desconto_percent) / 100)
    }
    return { valor: valor, dias_atraso: Math.max(dias, 0), multa: multa, juros: juros, acrescimo: r2(multa + juros), desconto: desconto, total: r2(valor + multa + juros - desconto) }
}
// Usado pelas duas baixas manuais (Contas a receber e ficha do paciente). Sem acréscimo/desconto
// informados, recebe o valor da parcela como antes.
function valoresBaixa(parcela, b) {
    var valor = r2(parcela.valor), acr = r2(Math.max(num(b.acrescimo), 0)), desc = r2(Math.max(num(b.desconto), 0))
    if (desc > valor + acr) return { erro: 'O desconto não pode ser maior que o valor a receber' }
    return { acrescimo: acr, desconto: desc, valor_pago: r2(valor + acr - desc) }
}

async function caixaAberto(client, cid) {
    return (await client.execute({ sql: "SELECT * FROM caixa_sessoes WHERE clinica_id=? AND status='aberto' ORDER BY id DESC LIMIT 1", args: [cid] })).rows[0] || null
}
async function resumoCaixa(client, cid, sess) {
    var de = String(sess.aberto_em).slice(0, 10), ate = hojeCG()
    var mov = await movimentos(client, cid, de, ate)
    var porForma = {}, entDin = 0, saiDin = 0
    mov.forEach(function (m) {
        if (m.tipo === 'entrada') porForma[m.forma] = r2((porForma[m.forma] || 0) + m.valor)
        if (m.forma === 'Dinheiro') { if (m.tipo === 'entrada') entDin += m.valor; else saiDin += m.valor }
    })
    var mans = (await client.execute({ sql: "SELECT id, tipo, valor, descricao, usuario_nome, criado_em FROM caixa_movimentos WHERE sessao_id=? AND clinica_id=? ORDER BY id", args: [sess.id, cid] })).rows
    var sup = mans.filter(function (x) { return x.tipo === 'suprimento' }).reduce(function (s, x) { return s + Number(x.valor) }, 0)
    var san = mans.filter(function (x) { return x.tipo === 'sangria' }).reduce(function (s, x) { return s + Number(x.valor) }, 0)
    return {
        saldo_inicial: r2(sess.saldo_inicial), entradas_dinheiro: r2(entDin), saidas_dinheiro: r2(saiDin), suprimentos: r2(sup), sangrias: r2(san),
        esperado: r2(Number(sess.saldo_inicial) + entDin - saiDin + sup - san),
        por_forma: Object.keys(porForma).sort().map(function (k) { return { forma: k, valor: porForma[k] } }),
        total_recebido: r2(Object.keys(porForma).reduce(function (s, k) { return s + porForma[k] }, 0)),
        manuais: mans
    }
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }

    // ── Caixa do dia ─────────────────────────────────────────────
    if (route === 'caixa') {
        var sess = await caixaAberto(client, clinica_id)
        if (req.method === 'GET') {
            if (q.historico) {
                var hs = await client.execute({ sql: "SELECT id, aberto_em, aberto_por_nome, saldo_inicial, fechado_em, fechado_por_nome, esperado, contado, diferenca, observacao, status FROM caixa_sessoes WHERE clinica_id=? ORDER BY id DESC LIMIT 60", args: [clinica_id] })
                return json(200, { success: true, data: hs.rows })
            }
            if (q.id) {
                var s1 = (await client.execute({ sql: "SELECT * FROM caixa_sessoes WHERE id=? AND clinica_id=?", args: [q.id, clinica_id] })).rows[0]
                if (!s1) return json(404, { success: false, error: 'Caixa não encontrado' })
                return json(200, { success: true, sessao: s1, resumo: s1.resumo_json ? JSON.parse(s1.resumo_json) : null })
            }
            if (!sess) {
                var ult = (await client.execute({ sql: "SELECT contado, fechado_em FROM caixa_sessoes WHERE clinica_id=? AND status='fechado' ORDER BY id DESC LIMIT 1", args: [clinica_id] })).rows[0]
                return json(200, { success: true, aberto: false, ultimo_fechamento: ult || null })
            }
            return json(200, { success: true, aberto: true, sessao: sess, resumo: await resumoCaixa(client, clinica_id, sess) })
        }
        if (b.action === 'abrir') {
            if (sess) return json(409, { success: false, error: 'Já existe um caixa aberto desde ' + String(sess.aberto_em).slice(8, 10) + '/' + String(sess.aberto_em).slice(5, 7) + ' por ' + (sess.aberto_por_nome || '—') })
            var si = r2(num(b.saldo_inicial))
            if (si < 0) return json(400, { success: false, error: 'Troco inicial inválido' })
            var ins = await client.execute({ sql: "INSERT INTO caixa_sessoes(clinica_id,aberto_em,aberto_por_id,aberto_por_nome,saldo_inicial,status) VALUES(?,?,?,?,?,'aberto')", args: [clinica_id, agoraCG(), auth.usuario_id || null, auth.nome || null, si] })
            return json(200, { success: true, id: Number(ins.lastInsertRowid) })
        }
        if (!sess) return json(409, { success: false, error: 'Nenhum caixa aberto' })
        if (b.action === 'movimento') {
            var tp = b.tipo === 'sangria' ? 'sangria' : (b.tipo === 'suprimento' ? 'suprimento' : null)
            var vl = r2(num(b.valor))
            if (!tp || vl <= 0) return json(400, { success: false, error: 'Informe o tipo e o valor' })
            if (tp === 'sangria') { var rs = await resumoCaixa(client, clinica_id, sess); if (vl > rs.esperado + 0.009) return json(400, { success: false, error: 'A sangria é maior que o dinheiro esperado no caixa' }) }
            await client.execute({ sql: "INSERT INTO caixa_movimentos(clinica_id,sessao_id,tipo,valor,descricao,usuario_nome,criado_em) VALUES(?,?,?,?,?,?,?)", args: [clinica_id, sess.id, tp, vl, txt(b.descricao, 140) || (tp === 'sangria' ? 'Sangria' : 'Suprimento'), auth.nome || null, agoraCG()] })
            return json(200, { success: true })
        }
        if (b.action === 'fechar') {
            if (b.contado === '' || b.contado == null) return json(400, { success: false, error: 'Informe o dinheiro contado no caixa' })
            var cont = r2(num(b.contado))
            if (cont < 0) return json(400, { success: false, error: 'Valor contado inválido' })
            var rsf = await resumoCaixa(client, clinica_id, sess), dif = r2(cont - rsf.esperado)
            if (Math.abs(dif) >= 0.01 && !txt(b.observacao, 300)) return json(400, { success: false, error: 'Há diferença de R$ ' + Math.abs(dif).toFixed(2).replace('.', ',') + '. Explique na observação.', diferenca: dif })
            await client.execute({ sql: "UPDATE caixa_sessoes SET status='fechado', fechado_em=?, fechado_por_id=?, fechado_por_nome=?, esperado=?, contado=?, diferenca=?, observacao=?, resumo_json=? WHERE id=? AND clinica_id=?", args: [agoraCG(), auth.usuario_id || null, auth.nome || null, rsf.esperado, cont, dif, txt(b.observacao, 300) || null, JSON.stringify(rsf), sess.id, clinica_id] })
            return json(200, { success: true, esperado: rsf.esperado, contado: cont, diferenca: dif })
        }
        return json(400, { success: false, error: 'Ação inválida' })
    }

    // ── Procedimentos do tratamento no agendamento ──────────────
    if (route === 'agendamento-procedimentos') {
        var ag = (await client.execute({ sql: "SELECT id, paciente_id, profissional_id, data_hora FROM agendamentos WHERE id=? AND clinica_id=?", args: [q.agendamento_id || b.agendamento_id, clinica_id] })).rows[0]
        if (!ag) return json(404, { success: false, error: 'Agendamento não encontrado' })
        if (req.method === 'GET') {
            var lig = (await client.execute({ sql: "SELECT orcamento_item_id FROM agendamento_procedimentos WHERE agendamento_id=? AND clinica_id=?", args: [ag.id, clinica_id] })).rows.map(function (r) { return Number(r.orcamento_item_id) })
            var itens = ag.paciente_id ? (await client.execute({
                sql: "SELECT oi.id, oi.orcamento_id, oi.procedimento_nome, oi.dente, oi.regiao, oi.profissional_id, oi.profissional_nome, COALESCE(oi.executado,0) executado, oi.data_execucao FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id WHERE oi.clinica_id=? AND o.paciente_id=? AND o.status='aprovado' ORDER BY oi.orcamento_id, oi.id",
                args: [clinica_id, ag.paciente_id]
            })).rows : []
            var outros = {}
            ;(await tentar(client, "SELECT ap.orcamento_item_id, a.data_hora FROM agendamento_procedimentos ap JOIN agendamentos a ON a.id=ap.agendamento_id AND a.clinica_id=ap.clinica_id WHERE ap.clinica_id=? AND ap.agendamento_id<>? AND COALESCE(a.status,'') NOT IN ('cancelado','desmarcado','faltou')", [clinica_id, ag.id])).forEach(function (r) { outros[r.orcamento_item_id] = r.data_hora })
            return json(200, { success: true, itens: itens.filter(function (i) { return !Number(i.executado) || lig.indexOf(Number(i.id)) >= 0 }).map(function (i) { return Object.assign({}, i, { executado: !!Number(i.executado), vinculado: lig.indexOf(Number(i.id)) >= 0, em_outro: outros[i.id] || null }) }) })
        }
        var validos = ag.paciente_id ? (await client.execute({ sql: "SELECT oi.id FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id WHERE oi.clinica_id=? AND o.paciente_id=? AND o.status='aprovado'", args: [clinica_id, ag.paciente_id] })).rows.map(function (r) { return Number(r.id) }) : []
        var ids = (Array.isArray(b.item_ids) ? b.item_ids : []).map(Number).filter(function (i, k, arr) { return validos.indexOf(i) >= 0 && arr.indexOf(i) === k })
        await client.execute({ sql: "DELETE FROM agendamento_procedimentos WHERE agendamento_id=? AND clinica_id=?", args: [ag.id, clinica_id] })
        for (var i = 0; i < ids.length; i++) await client.execute({ sql: "INSERT INTO agendamento_procedimentos(clinica_id,agendamento_id,orcamento_item_id) VALUES(?,?,?)", args: [clinica_id, ag.id, ids[i]] })
        return json(200, { success: true, item_ids: ids })
    }

    // ── Encargos sugeridos para receber uma parcela ─────────────
    if (route === 'parcela-encargos') {
        var pc = (await client.execute({ sql: "SELECT * FROM parcelas_orcamento WHERE id=? AND clinica_id=?", args: [q.id, clinica_id] })).rows[0]
        if (!pc) return json(404, { success: false, error: 'Parcela não encontrada' })
        return json(200, Object.assign({ success: true }, await encargos(client, clinica_id, pc, DATA_RE.test(q.data || '') ? q.data : hojeCG())))
    }

    // ── Tarefas da equipe ────────────────────────────────────────
    if (route === 'tarefas') {
        if (req.method === 'GET') {
            var w = ["t.clinica_id=?"], a = [clinica_id]
            if (q.minhas) { w.push("t.responsavel_id=?"); a.push(auth.usuario_id) }
            if (q.status === 'aberta' || q.status === 'concluida') { w.push("t.status=?"); a.push(q.status) }
            if (q.paciente_id) { w.push("t.paciente_id=?"); a.push(q.paciente_id) }
            var rows = await client.execute({ sql: "SELECT t.*, p.nome paciente_nome FROM tarefas t LEFT JOIN pacientes p ON p.id=t.paciente_id AND p.clinica_id=t.clinica_id WHERE " + w.join(' AND ') + " ORDER BY t.status, COALESCE(t.prazo,'9999'), t.id DESC LIMIT 500", args: a })
            var hoje = hojeCG()
            var us = (await client.execute({ sql: "SELECT id, nome FROM usuarios WHERE clinica_id=? AND COALESCE(ativo,1)=1 ORDER BY nome", args: [clinica_id] })).rows
            return json(200, { success: true, usuarios: us, data: rows.rows.map(function (t) { return Object.assign({}, t, { checklist: t.checklist_json ? JSON.parse(t.checklist_json) : [], atrasada: t.status === 'aberta' && t.prazo && t.prazo < hoje }) }) })
        }
        if (b.action === 'excluir') {
            var dl = await client.execute({ sql: "DELETE FROM tarefas WHERE id=? AND clinica_id=? AND (criado_por_id=? OR ?='admin')", args: [b.id, clinica_id, auth.usuario_id, auth.perfil] })
            if (!dl.rowsAffected) return json(404, { success: false, error: 'Tarefa não encontrada ou criada por outra pessoa' })
            return json(200, { success: true })
        }
        if (b.action === 'concluir' || b.action === 'reabrir' || b.action === 'checklist') {
            var t0 = (await client.execute({ sql: "SELECT * FROM tarefas WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })).rows[0]
            if (!t0) return json(404, { success: false, error: 'Tarefa não encontrada' })
            if (b.action === 'checklist') {
                var cl = t0.checklist_json ? JSON.parse(t0.checklist_json) : [], k = Number(b.indice)
                if (!cl[k]) return json(400, { success: false, error: 'Item inválido' })
                cl[k].feito = !!b.feito
                await client.execute({ sql: "UPDATE tarefas SET checklist_json=? WHERE id=? AND clinica_id=?", args: [JSON.stringify(cl), t0.id, clinica_id] })
                return json(200, { success: true, checklist: cl })
            }
            await client.execute({ sql: "UPDATE tarefas SET status=?, concluida_em=?, concluida_por_nome=? WHERE id=? AND clinica_id=?", args: [b.action === 'concluir' ? 'concluida' : 'aberta', b.action === 'concluir' ? agoraCG() : null, b.action === 'concluir' ? (auth.nome || null) : null, t0.id, clinica_id] })
            return json(200, { success: true })
        }
        var tit = txt(b.titulo, 160)
        if (!tit) return json(400, { success: false, error: 'Dê um título à tarefa' })
        var resp = null
        if (b.responsavel_id) { resp = (await client.execute({ sql: "SELECT id, nome FROM usuarios WHERE id=? AND clinica_id=? AND COALESCE(ativo,1)=1", args: [b.responsavel_id, clinica_id] })).rows[0]; if (!resp) return json(400, { success: false, error: 'Responsável inválido' }) }
        var pac = null
        if (b.paciente_id) { pac = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })).rows[0]; if (!pac) return json(400, { success: false, error: 'Paciente inválido' }) }
        var chk = (Array.isArray(b.checklist) ? b.checklist : []).map(function (c) { return { texto: txt(typeof c === 'string' ? c : c.texto, 160), feito: !!(c && c.feito) } }).filter(function (c) { return c.texto }).slice(0, 30)
        var prazo = DATA_RE.test(b.prazo || '') ? b.prazo : null, pri = ['baixa', 'normal', 'alta'].indexOf(b.prioridade) >= 0 ? b.prioridade : 'normal'
        var vals = [tit, txt(b.descricao, 2000), resp ? resp.id : null, resp ? resp.nome : null, prazo, pri, JSON.stringify(chk), pac ? pac.id : null]
        if (b.id) {
            var up = await client.execute({ sql: "UPDATE tarefas SET titulo=?, descricao=?, responsavel_id=?, responsavel_nome=?, prazo=?, prioridade=?, checklist_json=?, paciente_id=? WHERE id=? AND clinica_id=?", args: vals.concat([b.id, clinica_id]) })
            if (!up.rowsAffected) return json(404, { success: false, error: 'Tarefa não encontrada' })
            return json(200, { success: true, id: Number(b.id) })
        }
        var it = await client.execute({ sql: "INSERT INTO tarefas(clinica_id,titulo,descricao,responsavel_id,responsavel_nome,prazo,prioridade,checklist_json,paciente_id,status,criado_por_id,criado_por_nome,criado_em) VALUES(?,?,?,?,?,?,?,?,?,'aberta',?,?,?)", args: [clinica_id].concat(vals).concat([auth.usuario_id || null, auth.nome || null, agoraCG()]) })
        return json(200, { success: true, id: Number(it.lastInsertRowid) })
    }

    return false
}

module.exports = { handle, encargos, valoresBaixa, resumoCaixa }
