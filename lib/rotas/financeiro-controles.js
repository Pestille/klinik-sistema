// lib/rotas/financeiro-controles.js — Financeiro, parte 2 (Fase 6)
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
//   recebíveis   cheques e cartões a compensar (nascem na baixa da parcela ou à mão)
//   taxas        taxa por forma/parcelas, prazo de recebimento, multa/juros/desconto (Asaas)
//   convênios    repasse dos procedimentos executados cobertos por plano
//   conciliação  importação de extrato OFX/CSV e casamento com os movimentos
//   boletos      cobranças Asaas por vencimento
//   régua        lembretes de cobrança antes/depois do vencimento (executarRegua, no cron)
// O dinheiro continua sendo lido por movimentos() em ./financeiro.js: taxas de
// cartão, cheques devolvidos e repasses recebidos viram linhas em lancamentos.

var fin = require('./financeiro')
var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var CANAIS = ['whatsapp', 'email']

function num(v) { var n = typeof v === 'string' ? Number(v.replace(/R\$\s?/i, '').replace(/%/, '').replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0 }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function difDias(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
function br(d) { return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '' }
function ids(v) { return (Array.isArray(v) ? v : [v]).map(function (x) { return parseInt(x, 10) }).filter(function (x) { return x > 0 }).slice(0, 500) }
function marcas(lista) { return lista.map(function () { return '?' }).join(',') }

async function tentar(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args || [] })).rows }
    catch (e) { if (/no such (table|column)/i.test(e.message || '')) return []; throw e }
}

async function caixaGeral(client, clinica_id) {
    var r = await client.execute({ sql: "SELECT id FROM contas_bancarias WHERE clinica_id=? AND tipo='caixa' AND ativo=1 ORDER BY id LIMIT 1", args: [clinica_id] })
    if (r.rows.length) return Number(r.rows[0].id)
    var ins = await client.execute({ sql: "INSERT INTO contas_bancarias(clinica_id,nome,tipo) VALUES(?,'Caixa geral','caixa')", args: [clinica_id] })
    return Number(ins.lastInsertRowid)
}
async function contaValida(client, clinica_id, id) {
    var cid = parseInt(id, 10)
    if (!cid) return await caixaGeral(client, clinica_id)
    var r = await client.execute({ sql: "SELECT id FROM contas_bancarias WHERE id=? AND clinica_id=?", args: [cid, clinica_id] })
    return r.rows.length ? cid : null
}

// Lançamento gerado pelo sistema (taxa, cheque devolvido, repasse de convênio)
async function lancar(client, clinica_id, auth, o) {
    var r = await client.execute({
        sql: "INSERT INTO lancamentos(clinica_id,data,tipo,forma_pagamento,descricao,paciente_id,paciente_nome,valor,classificacao,categoria,conta_id,status,criado_por_nome) VALUES(?,?,?,?,?,?,?,?,?,?,?,'realizado',?)",
        args: [clinica_id, o.data, o.tipo, o.forma || null, txt(o.descricao, 140), o.paciente_id || null, o.paciente_nome || null, r2(o.valor), o.classificacao, o.categoria || null, o.conta_id || null, (auth && auth.nome) || 'Sistema']
    })
    return Number(r.lastInsertRowid)
}

// ── Taxas ─────────────────────────────────────────────────────────
async function faixasTaxa(client, clinica_id) {
    return await tentar(client, "SELECT * FROM taxas_pagamento WHERE clinica_id=? ORDER BY forma, parcelas_de", [clinica_id])
}
function taxaPara(faixas, forma, parcelas) {
    var f = faixas.filter(function (x) { return x.forma === forma && parcelas >= Number(x.parcelas_de || 1) && parcelas <= Number(x.parcelas_ate || 1) })[0]
    if (f) return { percentual: Number(f.percentual) || 0, fixo: Number(f.fixo) || 0, prazo: Number(f.prazo_dias) || 0 }
    return { percentual: 0, fixo: 0, prazo: forma === 'debito' ? 1 : forma === 'credito' ? 30 : 0 }
}

// Multa, juros e desconto no formato da API do Asaas (para gerar-cobranca/gerar-parcelas)
async function encargosAsaas(client, clinica_id) {
    var c = (await tentar(client, "SELECT * FROM taxas_config WHERE clinica_id=?", [clinica_id]))[0]
    var o = {}
    if (!c) return o
    if (Number(c.multa_percent) > 0) o.fine = { value: Number(c.multa_percent), type: 'PERCENTAGE' }
    if (Number(c.juros_mes_percent) > 0) o.interest = { value: Number(c.juros_mes_percent) }
    if (Number(c.desconto_percent) > 0) o.discount = { value: Number(c.desconto_percent), dueDateLimitDays: Math.max(parseInt(c.desconto_dias, 10) || 0, 0), type: 'PERCENTAGE' }
    return o
}

// ── Recebíveis (cheques e cartões) ────────────────────────────────
// Cria as linhas de um cheque ou de uma venda no cartão (uma por parcela).
async function criarRecebiveis(client, clinica_id, base, det) {
    var criados = []
    if (det.tipo === 'cheque') {
        var bomPara = DATA_RE.test(det.bom_para || '') ? det.bom_para : base.data
        var r = await client.execute({
            sql: "INSERT INTO recebiveis(clinica_id,tipo,origem,origem_id,paciente_id,paciente_nome,titular,cpf,banco,agencia,numero,data_venda,vencimento,valor,taxa,valor_final,status,conta_id,observacoes) VALUES(?,'cheque',?,?,?,?,?,?,?,?,?,?,?,?,0,?,'pendente',?,?)",
            args: [clinica_id, base.origem, base.origem_id || null, base.paciente_id || null, base.paciente_nome || null, txt(det.titular, 120) || base.paciente_nome || null, txt(det.cpf, 20) || null, txt(det.banco, 60) || null, txt(det.agencia, 20) || null, txt(det.numero, 30) || null, base.data, bomPara, r2(base.valor), r2(base.valor), base.conta_id || null, txt(det.observacoes, 300) || null]
        })
        criados.push(Number(r.lastInsertRowid))
        return criados
    }
    var ct = det.cartao_tipo === 'debito' ? 'debito' : 'credito'
    var np = ct === 'debito' ? 1 : Math.min(Math.max(parseInt(det.parcelas, 10) || 1, 1), 24)
    var tx = taxaPara(await faixasTaxa(client, clinica_id), ct, np)
    var valorParc = r2(base.valor / np), resto = r2(base.valor - valorParc * np)
    for (var i = 0; i < np; i++) {
        var v = r2(valorParc + (i === 0 ? resto : 0))
        var taxa = r2(v * tx.percentual / 100 + tx.fixo / np)
        var venc = addDias(base.data, ct === 'debito' ? tx.prazo : tx.prazo * (i + 1))
        var ri = await client.execute({
            sql: "INSERT INTO recebiveis(clinica_id,tipo,cartao_tipo,origem,origem_id,paciente_id,paciente_nome,titular,cpf,bandeira,ultimos4,autorizacao,parcela,total_parcelas,data_venda,vencimento,valor,taxa,valor_final,status,conta_id) VALUES(?,'cartao',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pendente',?)",
            args: [clinica_id, ct, base.origem, base.origem_id || null, base.paciente_id || null, base.paciente_nome || null, txt(det.titular, 120) || base.paciente_nome || null, txt(det.cpf, 20) || null, txt(det.bandeira, 30) || null, String(det.ultimos4 || '').replace(/\D/g, '').slice(-4) || null, txt(det.autorizacao, 30) || null, i + 1, np, base.data, venc, v, taxa, r2(v - taxa), base.conta_id || null]
        })
        criados.push(Number(ri.lastInsertRowid))
    }
    return criados
}
function detalheValido(det) {
    if (!det || (det.tipo !== 'cheque' && det.tipo !== 'cartao')) return null
    if (det.tipo === 'cheque' && !txt(det.numero, 30)) return 'Informe o número do cheque'
    if (det.bom_para && !DATA_RE.test(det.bom_para)) return 'Data "bom para" inválida'
    return ''
}

// ── Conciliação: leitura de OFX e CSV ─────────────────────────────
function lerOFX(texto) {
    var itens = [], re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi, m
    function campo(bloco, tag) { var x = new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i').exec(bloco); return x ? x[1].trim() : '' }
    while ((m = re.exec(texto))) {
        var b = m[1], dt = campo(b, 'DTPOSTED'), v = Number(campo(b, 'TRNAMT').replace(',', '.'))
        if (!/^\d{8}/.test(dt) || !isFinite(v) || !v) continue
        itens.push({ data: dt.slice(0, 4) + '-' + dt.slice(4, 6) + '-' + dt.slice(6, 8), valor: r2(Math.abs(v)), tipo: v < 0 ? 'debito' : 'credito', descricao: (campo(b, 'MEMO') || campo(b, 'NAME') || campo(b, 'TRNTYPE')).slice(0, 200), fitid: campo(b, 'FITID').slice(0, 80) || null })
    }
    return itens
}
function lerCSV(texto) {
    var itens = []
    String(texto).split(/\r?\n/).forEach(function (l) {
        var c = l.split(/;|\t/).map(function (x) { return x.trim().replace(/^"|"$/g, '') })
        if (c.length < 3) return
        var d = c[0], data = /^\d{2}\/\d{2}\/\d{4}$/.test(d) ? d.slice(6) + '-' + d.slice(3, 5) + '-' + d.slice(0, 2) : DATA_RE.test(d) ? d : null
        if (!data) return
        var bruto = c[c.length - 1], neg = /^-|\(|D$/i.test(bruto), v = num(bruto.replace(/[()DC\s]/gi, '').replace(/^-/, ''))
        if (!v) return
        itens.push({ data: data, valor: r2(v), tipo: neg ? 'debito' : 'credito', descricao: c.slice(1, c.length - 1).join(' ').slice(0, 200), fitid: null })
    })
    return itens
}

// Casa os itens pendentes de uma importação com os movimentos da conta (±3 dias, mesmo valor e sentido)
async function casar(client, clinica_id, concId) {
    var conc = (await client.execute({ sql: "SELECT * FROM conciliacoes WHERE id=? AND clinica_id=?", args: [concId, clinica_id] })).rows[0]
    if (!conc) return 0
    var itens = (await client.execute({ sql: "SELECT * FROM conciliacao_itens WHERE conciliacao_id=? AND clinica_id=? AND status='pendente'", args: [concId, clinica_id] })).rows
    if (!itens.length) return 0
    var caixa = await caixaGeral(client, clinica_id)
    var mvs = (await fin.movimentos(client, clinica_id, addDias(conc.periodo_de, -3), addDias(conc.periodo_ate, 3))).filter(function (m) {
        return !m.conta_id || Number(m.conta_id) === Number(conc.conta_id) || (!conc.conta_id && Number(m.conta_id) === caixa)
    })
    var usados = {}
    ;(await client.execute({ sql: "SELECT movimento_id FROM conciliacao_itens WHERE clinica_id=? AND movimento_id IS NOT NULL", args: [clinica_id] })).rows.forEach(function (x) { usados[x.movimento_id] = 1 })
    var n = 0
    for (var i = 0; i < itens.length; i++) {
        var it = itens[i], sentido = it.tipo === 'debito' ? 'saida' : 'entrada', melhor = null
        mvs.forEach(function (m) {
            if (usados[m.id] || m.tipo !== sentido || Math.abs(m.valor - Number(it.valor)) >= 0.01) return
            var dd = Math.abs(difDias(m.data, String(it.data).slice(0, 10)))
            if (dd <= 3 && (!melhor || dd < melhor.dd)) melhor = { m: m, dd: dd }
        })
        if (melhor) {
            usados[melhor.m.id] = 1
            await client.execute({ sql: "UPDATE conciliacao_itens SET status='conciliado', movimento_id=? WHERE id=? AND clinica_id=?", args: [melhor.m.id, it.id, clinica_id] })
            if (!melhor.m.conta_id) await fixarConta(client, clinica_id, melhor.m.id, conc.conta_id)
            n++
        }
    }
    await atualizarConciliacao(client, clinica_id, concId)
    return n
}
async function atualizarConciliacao(client, clinica_id, concId) {
    await client.execute({ sql: "UPDATE conciliacoes SET total_itens=(SELECT COUNT(*) FROM conciliacao_itens WHERE conciliacao_id=? AND clinica_id=?), total_conciliados=(SELECT COUNT(*) FROM conciliacao_itens WHERE conciliacao_id=? AND clinica_id=? AND status<>'pendente') WHERE id=? AND clinica_id=?", args: [concId, clinica_id, concId, clinica_id, concId, clinica_id] })
    await client.execute({ sql: "UPDATE conciliacoes SET status=CASE WHEN total_conciliados>=total_itens THEN 'concluida' ELSE 'pendente' END WHERE id=? AND clinica_id=?", args: [concId, clinica_id] })
}
// Ao conciliar com um movimento sem conta (ou lançado no caixa geral), a conta do
// extrato passa a valer para ele: o banco mostra que o dinheiro passou por ali.
async function fixarConta(client, clinica_id, movId, contaId) {
    if (!contaId) return
    var caixa = await caixaGeral(client, clinica_id)
    if (Number(contaId) === caixa) return
    var p = String(movId).split(':'), id = parseInt(p[1], 10), tab = { lancamento: 'lancamentos', parcela: 'parcelas_orcamento', conta_pagar: 'contas_pagar' }[p[0]]
    if (tab && id) await client.execute({ sql: "UPDATE " + tab + " SET conta_id=? WHERE id=? AND clinica_id=? AND (conta_id IS NULL OR conta_id=?)", args: [contaId, id, clinica_id, caixa] })
}

// ── Régua de cobrança ─────────────────────────────────────────────
var VARS = ['nome', 'valor', 'vencimento', 'link', 'clinica', 'parcela']
function montarMensagem(t, v) { return String(t || '').replace(/\{(\w+)\}/g, function (a, k) { return VARS.indexOf(k) >= 0 ? (v[k] == null ? '' : v[k]) : a }) }

// enviar(canal, destino, texto, vars) → { ok, erro, status }. Devolve contagens.
async function executarRegua(client, clinica_id, hoje, enviar) {
    var regras = await tentar(client, "SELECT * FROM regua_regras WHERE clinica_id=? AND ativo=1", [clinica_id])
    var res = { enviados: 0, erros: 0, ignorados: 0 }
    if (!regras.length) return res
    var cli = (await tentar(client, "SELECT nome FROM clinicas WHERE id=?", [clinica_id]))[0] || {}
    for (var i = 0; i < regras.length; i++) {
        var rg = regras[i], alvo = addDias(hoje, -Number(rg.dias))
        var ps = await tentar(client, "SELECT po.*, p.nome paciente_nome, p.email, COALESCE(p.whatsapp,p.telefone) fone FROM parcelas_orcamento po LEFT JOIN pacientes p ON p.id=po.paciente_id AND p.clinica_id=po.clinica_id WHERE po.clinica_id=? AND po.status IN ('pendente','vencido') AND substr(po.data_vencimento,1,10)=? AND NOT EXISTS (SELECT 1 FROM regua_envios e WHERE e.regra_id=? AND e.parcela_id=po.id) LIMIT 200", [clinica_id, alvo, rg.id])
        for (var j = 0; j < ps.length; j++) {
            var p = ps[j], link = ''
            if (p.cobranca_id) {
                var cb = (await tentar(client, "SELECT * FROM cobrancas WHERE id=? AND clinica_id=?", [p.cobranca_id, clinica_id]))[0]
                if (cb) link = cb.invoice_url || cb.boleto_url || ''
            }
            var nome = String(p.paciente_nome || '').trim().split(' ')[0]
            var v = { nome: nome ? nome.charAt(0) + nome.slice(1).toLowerCase() : '', valor: moeda(p.valor), vencimento: br(p.data_vencimento), link: link, clinica: cli.nome || '', parcela: p.numero_parcela + '/' + p.total_parcelas }
            var destino = rg.canal === 'email' ? (p.email || '') : String(p.fone || '').replace(/\D/g, '')
            var r
            if (!destino || (rg.canal === 'whatsapp' && destino.length < 10)) r = { ok: false, status: 'sem_destino', erro: 'Paciente sem ' + (rg.canal === 'email' ? 'e-mail' : 'celular') }
            else { try { r = await enviar(rg.canal, destino, montarMensagem(rg.mensagem, v), v) } catch (e) { r = { ok: false, erro: e.message } } }
            var st = r.ok ? 'enviado' : (r.status || 'erro')
            try {
                await client.execute({ sql: "INSERT INTO regua_envios(clinica_id,regra_id,parcela_id,canal,destino,status,erro,enviado_em) VALUES(?,?,?,?,?,?,?,datetime('now','-4 hours'))", args: [clinica_id, rg.id, p.id, rg.canal, destino || null, st, r.erro ? String(r.erro).slice(0, 300) : null] })
            } catch (e) { if (!/UNIQUE/i.test(e.message)) throw e }
            if (r.ok) res.enviados++; else if (st === 'erro') res.erros++; else res.ignorados++
        }
    }
    return res
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }

    // ── Baixa de parcela com cheque/cartão (Contas a receber) ─────
    if (route === 'fin-receber-baixa') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (b.origem === 'avulso') {
            var ra = await require('./paciente-fin').receberAvulso(client, clinica_id, b)
            return ra.erro ? json(ra.erro, { success: false, error: ra.error }) : json(200, { success: true })
        }
        var parc = (await client.execute({ sql: "SELECT po.*, p.nome paciente_nome FROM parcelas_orcamento po LEFT JOIN pacientes p ON p.id=po.paciente_id AND p.clinica_id=po.clinica_id WHERE po.id=? AND po.clinica_id=?", args: [b.id, clinica_id] })).rows[0]
        if (!parc) return json(404, { success: false, error: 'Parcela não encontrada' })
        if (parc.status === 'pago') return json(400, { success: false, error: 'Parcela já está paga' })
        var data = DATA_RE.test(b.data || '') ? b.data : hojeCG()
        var conta = await contaValida(client, clinica_id, b.conta_id)
        if (!conta) return json(400, { success: false, error: 'Conta inválida' })
        var dv = detalheValido(b.detalhe)
        if (dv) return json(400, { success: false, error: dv })
        var vb = require('./operacao').valoresBaixa(parc, b)
        if (vb.erro) return json(400, { success: false, error: vb.erro })
        await client.execute({ sql: "UPDATE parcelas_orcamento SET status='pago', data_pagamento=?, forma_pagamento=?, conta_id=?, valor_pago=?, acrescimo=?, desconto_baixa=?, updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [data, txt(b.forma_pagamento, 40) || null, conta, vb.valor_pago, vb.acrescimo, vb.desconto, parc.id, clinica_id] })
        var rec = []
        if (dv === '') rec = await criarRecebiveis(client, clinica_id, { origem: 'parcela', origem_id: parc.id, paciente_id: parc.paciente_id, paciente_nome: parc.paciente_nome, data: data, valor: vb.valor_pago, conta_id: conta }, b.detalhe)
        return json(200, { success: true, recebiveis: rec })
    }

    // ── Controle de cheques e cartões ─────────────────────────────
    if (route === 'fin-recebiveis') {
        var hoje = hojeCG()
        if (req.method === 'POST') {
            if (b.action === 'novo') {
                var dn = detalheValido(b.detalhe)
                if (dn === null) return json(400, { success: false, error: 'Escolha cheque ou cartão' })
                if (dn) return json(400, { success: false, error: dn })
                var vn = num(b.valor)
                if (vn <= 0) return json(400, { success: false, error: 'Informe o valor' })
                var pac = null
                if (b.paciente_id) { pac = (await client.execute({ sql: "SELECT id,nome FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })).rows[0]; if (!pac) return json(404, { success: false, error: 'Paciente não encontrado' }) }
                var cn = await contaValida(client, clinica_id, b.conta_id)
                if (!cn) return json(400, { success: false, error: 'Conta inválida' })
                var criados = await criarRecebiveis(client, clinica_id, { origem: 'manual', paciente_id: pac && pac.id, paciente_nome: pac ? pac.nome : txt(b.paciente_nome, 120), data: DATA_RE.test(b.data || '') ? b.data : hoje, valor: vn, conta_id: cn }, b.detalhe)
                return json(200, { success: true, ids: criados })
            }
            var lista = ids(b.ids || b.id)
            if (!lista.length) return json(400, { success: false, error: 'Nenhum item selecionado' })
            var rows = (await client.execute({ sql: "SELECT * FROM recebiveis WHERE clinica_id=? AND id IN (" + marcas(lista) + ")", args: [clinica_id].concat(lista) })).rows
            if (rows.length !== lista.length) return json(404, { success: false, error: 'Item não encontrado' })
            if (b.action === 'confirmar') {
                var dc = DATA_RE.test(b.data || '') ? b.data : hoje
                var cc = b.conta_id ? await contaValida(client, clinica_id, b.conta_id) : null
                if (b.conta_id && !cc) return json(400, { success: false, error: 'Conta inválida' })
                for (var i = 0; i < rows.length; i++) {
                    var r = rows[i]
                    if (r.status !== 'pendente') continue
                    var lid = null
                    if (Number(r.taxa) > 0) lid = await lancar(client, clinica_id, auth, { data: dc, tipo: 'Saída', descricao: 'Taxa ' + (r.tipo === 'cartao' ? 'de cartão ' + (r.cartao_tipo === 'debito' ? 'débito' : 'crédito') + (r.bandeira ? ' ' + r.bandeira : '') + (r.total_parcelas > 1 ? ' ' + r.parcela + '/' + r.total_parcelas : '') : 'de cheque'), paciente_id: r.paciente_id, paciente_nome: r.paciente_nome, valor: r.taxa, classificacao: 'Custo Variável', categoria: 'Taxas de cartão e boleto', conta_id: cc || r.conta_id })
                    await client.execute({ sql: "UPDATE recebiveis SET status='recebido', recebido_em=?, conta_id=COALESCE(?,conta_id), lancamento_id=? WHERE id=? AND clinica_id=?", args: [dc, cc, lid, r.id, clinica_id] })
                }
                return json(200, { success: true })
            }
            if (b.action === 'devolvido') {
                for (var k = 0; k < rows.length; k++) {
                    var d = rows[k]
                    if (d.tipo !== 'cheque' || d.status === 'devolvido') continue
                    if (d.lancamento_id) await client.execute({ sql: "DELETE FROM lancamentos WHERE id=? AND clinica_id=?", args: [d.lancamento_id, clinica_id] })
                    var ld = await lancar(client, clinica_id, auth, { data: DATA_RE.test(b.data || '') ? b.data : hoje, tipo: 'Estorno', descricao: 'Cheque devolvido nº ' + (d.numero || '') + (b.motivo ? ' · ' + txt(b.motivo, 80) : ''), paciente_id: d.paciente_id, paciente_nome: d.paciente_nome, valor: d.valor, classificacao: 'Outros', categoria: 'Cheque devolvido', conta_id: d.conta_id })
                    await client.execute({ sql: "UPDATE recebiveis SET status='devolvido', lancamento_id=?, observacoes=TRIM(COALESCE(observacoes,'')||' '||?) WHERE id=? AND clinica_id=?", args: [ld, b.motivo ? 'Devolvido: ' + txt(b.motivo, 120) : 'Devolvido', d.id, clinica_id] })
                }
                return json(200, { success: true })
            }
            if (b.action === 'desfazer') {
                for (var j = 0; j < rows.length; j++) {
                    if (rows[j].lancamento_id) await client.execute({ sql: "DELETE FROM lancamentos WHERE id=? AND clinica_id=?", args: [rows[j].lancamento_id, clinica_id] })
                    await client.execute({ sql: "UPDATE recebiveis SET status='pendente', recebido_em=NULL, lancamento_id=NULL WHERE id=? AND clinica_id=?", args: [rows[j].id, clinica_id] })
                }
                return json(200, { success: true })
            }
            if (b.action === 'excluir') {
                if (rows.some(function (x) { return x.status !== 'pendente' || x.origem !== 'manual' })) return json(400, { success: false, error: 'Só dá para excluir lançamentos manuais ainda não compensados' })
                await client.execute({ sql: "DELETE FROM recebiveis WHERE clinica_id=? AND id IN (" + marcas(lista) + ")", args: [clinica_id].concat(lista) })
                return json(200, { success: true })
            }
            return json(400, { success: false, error: 'Ação inválida' })
        }
        var tipo = q.tipo === 'cheque' ? 'cheque' : 'cartao'
        var de = DATA_RE.test(q.de || '') ? q.de : hoje.slice(0, 8) + '01', ate = DATA_RE.test(q.ate || '') ? q.ate : addDias(hoje, 60)
        var w = ["clinica_id=?", "tipo=?", "substr(vencimento,1,10) BETWEEN ? AND ?"], a = [clinica_id, tipo, de, ate]
        if (q.status === 'aberto') w.push("status='pendente'")
        else if (q.status === 'recebido') w.push("status='recebido'")
        else if (q.status === 'devolvido') w.push("status='devolvido'")
        if (tipo === 'cartao' && (q.cartao_tipo === 'credito' || q.cartao_tipo === 'debito')) { w.push('cartao_tipo=?'); a.push(q.cartao_tipo) }
        var lst = (await tentar(client, "SELECT * FROM recebiveis WHERE " + w.join(' AND ') + " ORDER BY vencimento, id LIMIT 2000", a)).map(function (x) { return Object.assign({}, x, { vencido: x.status === 'pendente' && x.vencimento < hoje }) })
        var tot = { aberto: 0, recebido: 0, devolvido: 0, taxas: 0 }
        lst.forEach(function (x) { tot[x.status === 'pendente' ? 'aberto' : x.status] += Number(x.valor_final); tot.taxas += Number(x.taxa) || 0 })
        Object.keys(tot).forEach(function (k) { tot[k] = r2(tot[k]) })
        return json(200, { success: true, de: de, ate: ate, itens: lst, totais: tot })
    }

    // ── Taxas e encargos ──────────────────────────────────────────
    if (route === 'fin-taxas') {
        if (req.method === 'POST') {
            var fx = (Array.isArray(b.faixas) ? b.faixas : []).slice(0, 60)
            var limpas = []
            for (var f = 0; f < fx.length; f++) {
                var x = fx[f]
                if (['credito', 'debito', 'pix', 'boleto'].indexOf(x.forma) < 0) return json(400, { success: false, error: 'Forma inválida' })
                var de2 = Math.max(parseInt(x.parcelas_de, 10) || 1, 1), ate2 = Math.max(parseInt(x.parcelas_ate, 10) || de2, de2)
                var pc = num(x.percentual)
                if (pc < 0 || pc > 30) return json(400, { success: false, error: 'Percentual de taxa fora do esperado (0 a 30%)' })
                limpas.push([x.forma, x.forma === 'credito' ? de2 : 1, x.forma === 'credito' ? Math.min(ate2, 24) : 1, pc, Math.max(num(x.fixo), 0), Math.min(Math.max(parseInt(x.prazo_dias, 10) || 0, 0), 120)])
            }
            var cf = b.config || {}
            var multa = num(cf.multa_percent), juros = num(cf.juros_mes_percent), desc = num(cf.desconto_percent)
            if (multa < 0 || multa > 2) return json(400, { success: false, error: 'A multa por atraso é limitada a 2% (Código de Defesa do Consumidor)' })
            if (juros < 0 || juros > 1) return json(400, { success: false, error: 'Use juros de até 1% ao mês' })
            if (desc < 0 || desc > 50) return json(400, { success: false, error: 'Desconto fora do esperado' })
            await client.execute({ sql: "DELETE FROM taxas_pagamento WHERE clinica_id=?", args: [clinica_id] })
            for (var g = 0; g < limpas.length; g++) await client.execute({ sql: "INSERT INTO taxas_pagamento(clinica_id,forma,parcelas_de,parcelas_ate,percentual,fixo,prazo_dias) VALUES(?,?,?,?,?,?,?)", args: [clinica_id].concat(limpas[g]) })
            await client.execute({ sql: "INSERT INTO taxas_config(clinica_id,multa_percent,juros_mes_percent,desconto_percent,desconto_dias) VALUES(?,?,?,?,?) ON CONFLICT(clinica_id) DO UPDATE SET multa_percent=excluded.multa_percent, juros_mes_percent=excluded.juros_mes_percent, desconto_percent=excluded.desconto_percent, desconto_dias=excluded.desconto_dias", args: [clinica_id, multa, juros, desc, Math.min(Math.max(parseInt(cf.desconto_dias, 10) || 0, 0), 30)] })
            return json(200, { success: true })
        }
        var cfg = (await tentar(client, "SELECT * FROM taxas_config WHERE clinica_id=?", [clinica_id]))[0] || { multa_percent: 0, juros_mes_percent: 0, desconto_percent: 0, desconto_dias: 0 }
        return json(200, { success: true, faixas: await faixasTaxa(client, clinica_id), config: cfg })
    }

    // ── Controle de convênios (repasse) ───────────────────────────
    if (route === 'fin-convenios') {
        var hj = hojeCG()
        if (req.method === 'POST') {
            var li = ids(b.ids || b.id)
            if (!li.length) return json(400, { success: false, error: 'Nenhum procedimento selecionado' })
            var its = (await client.execute({ sql: "SELECT oi.*, o.tabela_preco, o.paciente_id, p.nome paciente_nome FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE oi.clinica_id=? AND oi.id IN (" + marcas(li) + ")", args: [clinica_id].concat(li) })).rows
            if (its.length !== li.length) return json(404, { success: false, error: 'Procedimento não encontrado' })
            if (b.action === 'guia') {
                await client.execute({ sql: "UPDATE orcamento_itens SET guia=? WHERE id=? AND clinica_id=?", args: [txt(b.guia, 40) || null, li[0], clinica_id] })
                return json(200, { success: true })
            }
            if (its.some(function (x) { return (x.convenio_status || 'a_faturar') === 'recebido' }) && b.action !== 'receber') return json(400, { success: false, error: 'Há procedimentos já recebidos na seleção' })
            if (b.action === 'faturar' || b.action === 'reabrir' || b.action === 'glosar') {
                var st = b.action === 'faturar' ? 'faturado' : b.action === 'glosar' ? 'glosado' : 'a_faturar'
                await client.execute({ sql: "UPDATE orcamento_itens SET convenio_status=?, convenio_obs=COALESCE(?,convenio_obs) WHERE clinica_id=? AND id IN (" + marcas(li) + ")", args: [st, b.action === 'glosar' ? txt(b.motivo, 200) || 'Glosado' : null, clinica_id].concat(li) })
                return json(200, { success: true })
            }
            if (b.action === 'receber') {
                if (its.some(function (x) { return x.convenio_status === 'recebido' })) return json(400, { success: false, error: 'Há procedimentos já recebidos na seleção' })
                var dr = DATA_RE.test(b.data || '') ? b.data : hj
                var cr = await contaValida(client, clinica_id, b.conta_id)
                if (!cr) return json(400, { success: false, error: 'Conta inválida' })
                var valores = b.valores || {}, porConv = {}
                for (var y = 0; y < its.length; y++) {
                    var it = its[y], esperado = r2(Number(it.valor_plano) * (Number(it.quantidade) || 1))
                    var recebido = valores[it.id] != null && valores[it.id] !== '' ? num(valores[it.id]) : esperado
                    if (recebido < 0) return json(400, { success: false, error: 'Valor recebido inválido' })
                    await client.execute({ sql: "UPDATE orcamento_itens SET convenio_status='recebido', convenio_recebido_em=?, convenio_valor_recebido=?, convenio_obs=CASE WHEN ?<? THEN 'Glosa parcial de " + "' || printf('%.2f', ?-?) ELSE convenio_obs END WHERE id=? AND clinica_id=?", args: [dr, recebido, recebido, esperado, esperado, recebido, it.id, clinica_id] })
                    var k2 = it.tabela_preco || 'Convênio'
                    porConv[k2] = porConv[k2] || { total: 0, n: 0 }
                    porConv[k2].total += recebido; porConv[k2].n++
                }
                var lids = []
                for (var conv in porConv) if (porConv[conv].total > 0) lids.push(await lancar(client, clinica_id, auth, { data: dr, tipo: 'Entrada', forma: 'Convênio', descricao: 'Repasse ' + conv + ' (' + porConv[conv].n + ' procedimento' + (porConv[conv].n > 1 ? 's' : '') + ')', valor: porConv[conv].total, classificacao: 'Receita', categoria: 'Convênio/Plano', conta_id: cr }))
                return json(200, { success: true, lancamentos: lids })
            }
            return json(400, { success: false, error: 'Ação inválida' })
        }
        var de3 = DATA_RE.test(q.de || '') ? q.de : addDias(hj, -90), ate3 = DATA_RE.test(q.ate || '') ? q.ate : hj
        var w3 = ["oi.clinica_id=?", "COALESCE(oi.executado,0)=1", "COALESCE(oi.valor_plano,0)>0", "substr(COALESCE(oi.data_execucao,o.data_aprovacao),1,10) BETWEEN ? AND ?"], a3 = [clinica_id, de3, ate3]
        if (q.status && q.status !== 'todos') { w3.push("COALESCE(oi.convenio_status,'a_faturar')=?"); a3.push(q.status) }
        if (q.convenio) { w3.push("UPPER(o.tabela_preco)=UPPER(?)"); a3.push(q.convenio) }
        if (q.guia) { w3.push("oi.guia LIKE ?"); a3.push('%' + q.guia + '%') }
        var rowsC = await tentar(client, "SELECT oi.id, oi.orcamento_id, oi.procedimento_nome, oi.procedimento_codigo, oi.dente, oi.faces, oi.quantidade, oi.valor_plano, oi.data_execucao, oi.profissional_nome, oi.guia, COALESCE(oi.convenio_status,'a_faturar') convenio_status, oi.convenio_recebido_em, oi.convenio_valor_recebido, oi.convenio_obs, o.tabela_preco convenio, o.paciente_id, p.nome paciente_nome FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE " + w3.join(' AND ') + " ORDER BY oi.data_execucao DESC, oi.id DESC LIMIT 2000", a3)
        var tc = { a_faturar: 0, faturado: 0, recebido: 0, glosado: 0 }
        rowsC.forEach(function (x) { var v = x.convenio_status === 'recebido' ? Number(x.convenio_valor_recebido) || 0 : Number(x.valor_plano) * (Number(x.quantidade) || 1); x.valor = r2(Number(x.valor_plano) * (Number(x.quantidade) || 1)); tc[x.convenio_status] = r2((tc[x.convenio_status] || 0) + v) })
        var convs = (await tentar(client, "SELECT nome FROM precos_tabelas WHERE clinica_id=? AND tipo='convenio' ORDER BY nome", [clinica_id])).map(function (x) { return x.nome })
        return json(200, { success: true, de: de3, ate: ate3, itens: rowsC, totais: tc, convenios: convs })
    }

    // ── Boletos e cobranças Asaas ─────────────────────────────────
    if (route === 'fin-boletos') {
        var h4 = hojeCG(), de4 = DATA_RE.test(q.de || '') ? q.de : h4.slice(0, 8) + '01', ate4 = DATA_RE.test(q.ate || '') ? q.ate : addDias(h4, 60)
        var w4 = ["clinica_id=?", "substr(data_vencimento,1,10) BETWEEN ? AND ?"], a4 = [clinica_id, de4, ate4]
        if (q.forma && q.forma !== 'todas') { w4.push("tipo=?"); a4.push(q.forma) }
        if (q.status === 'aberto') w4.push("status IN ('pendente','vencido')")
        else if (q.status === 'pago') w4.push("status IN ('pago','recebido','confirmado')")
        var cbs = (await tentar(client, "SELECT * FROM cobrancas WHERE " + w4.join(' AND ') + " ORDER BY data_vencimento, id LIMIT 2000", a4)).map(function (c) {
            var pago = /pago|recebido|confirmado/.test(c.status || '')
            return { id: c.id, paciente_id: c.paciente_id, paciente_nome: c.paciente_nome, tipo: c.tipo, descricao: c.descricao, valor: r2(c.valor), vencimento: String(c.data_vencimento || '').slice(0, 10), pagamento: c.data_pagamento ? String(c.data_pagamento).slice(0, 10) : null,
                situacao: pago ? 'pago' : c.status === 'cancelado' ? 'cancelado' : String(c.data_vencimento).slice(0, 10) < h4 ? 'vencido' : 'aberto', link: c.invoice_url || c.boleto_url || null, codigo: c.boleto_codigo || null, asaas_id: c.asaas_id }
        })
        var tb = { aberto: 0, vencido: 0, pago: 0 }
        cbs.forEach(function (c) { if (tb[c.situacao] !== undefined) tb[c.situacao] = r2(tb[c.situacao] + c.valor) })
        return json(200, { success: true, de: de4, ate: ate4, itens: cbs, totais: tb })
    }

    // ── Conciliação bancária (OFX / CSV) ──────────────────────────
    if (route === 'fin-conciliacao') {
        if (req.method === 'POST') {
            if (b.action === 'importar') {
                var ct = await contaValida(client, clinica_id, b.conta_id)
                if (!ct) return json(400, { success: false, error: 'Escolha a conta do extrato' })
                var conteudo = String(b.conteudo || '')
                if (conteudo.length > 3000000) return json(400, { success: false, error: 'Arquivo muito grande' })
                var lidos = /<OFX>|<STMTTRN>/i.test(conteudo) ? lerOFX(conteudo) : lerCSV(conteudo)
                if (!lidos.length) return json(400, { success: false, error: 'Nenhuma transação encontrada no arquivo (use OFX ou CSV com data;descrição;valor)' })
                var ja = {}
                ;(await client.execute({ sql: "SELECT ci.fitid FROM conciliacao_itens ci JOIN conciliacoes c ON c.id=ci.conciliacao_id AND c.clinica_id=ci.clinica_id WHERE ci.clinica_id=? AND c.conta_id=? AND ci.fitid IS NOT NULL", args: [clinica_id, ct] })).rows.forEach(function (x) { ja[x.fitid] = 1 })
                var novos = lidos.filter(function (x) { return !x.fitid || !ja[x.fitid] })
                if (!novos.length) return json(400, { success: false, error: 'Todas as transações deste arquivo já foram importadas' })
                var datas = novos.map(function (x) { return x.data }).sort()
                var cins = await client.execute({ sql: "INSERT INTO conciliacoes(clinica_id,conta_id,descricao,periodo_de,periodo_ate,status,total_itens,total_conciliados) VALUES(?,?,?,?,?,'pendente',?,0)", args: [clinica_id, ct, txt(b.nome, 120) || 'Extrato importado', datas[0], datas[datas.length - 1], novos.length] })
                var cid = Number(cins.lastInsertRowid)
                for (var t = 0; t < novos.length; t++) await client.execute({ sql: "INSERT INTO conciliacao_itens(clinica_id,conciliacao_id,data,descricao,valor,tipo,fitid,status) VALUES(?,?,?,?,?,?,?,'pendente')", args: [clinica_id, cid, novos[t].data, novos[t].descricao, novos[t].valor, novos[t].tipo, novos[t].fitid] })
                var casados = await casar(client, clinica_id, cid)
                return json(200, { success: true, id: cid, importados: novos.length, repetidos: lidos.length - novos.length, conciliados: casados })
            }
            var item = (await client.execute({ sql: "SELECT ci.*, c.conta_id FROM conciliacao_itens ci JOIN conciliacoes c ON c.id=ci.conciliacao_id AND c.clinica_id=ci.clinica_id WHERE ci.id=? AND ci.clinica_id=?", args: [b.item_id, clinica_id] })).rows[0]
            if (b.action === 'excluir') {
                var cx = (await client.execute({ sql: "SELECT id FROM conciliacoes WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })).rows[0]
                if (!cx) return json(404, { success: false, error: 'Importação não encontrada' })
                await client.execute({ sql: "DELETE FROM conciliacao_itens WHERE conciliacao_id=? AND clinica_id=?", args: [cx.id, clinica_id] })
                await client.execute({ sql: "DELETE FROM conciliacoes WHERE id=? AND clinica_id=?", args: [cx.id, clinica_id] })
                return json(200, { success: true })
            }
            if (!item) return json(404, { success: false, error: 'Item não encontrado' })
            if (b.action === 'conciliar') {
                var mid = String(b.movimento_id || '')
                if (!/^(lancamento|parcela|cobranca|financeiro|pagamento|conta_pagar):\d+$/.test(mid)) return json(400, { success: false, error: 'Movimento inválido' })
                var dt0 = String(item.data).slice(0, 10)
                var existe = (await fin.movimentos(client, clinica_id, addDias(dt0, -40), addDias(dt0, 40))).some(function (m) { return m.id === mid })
                if (!existe) return json(404, { success: false, error: 'Movimento não encontrado perto desta data' })
                var dup = (await client.execute({ sql: "SELECT id FROM conciliacao_itens WHERE clinica_id=? AND movimento_id=? AND id<>?", args: [clinica_id, mid, item.id] })).rows
                if (dup.length) return json(409, { success: false, error: 'Este movimento já foi conciliado com outro item' })
                await client.execute({ sql: "UPDATE conciliacao_itens SET status='conciliado', movimento_id=? WHERE id=? AND clinica_id=?", args: [mid, item.id, clinica_id] })
                await fixarConta(client, clinica_id, mid, item.conta_id)
            } else if (b.action === 'criar_lancamento') {
                var cat = null
                if (b.categoria_id) cat = (await client.execute({ sql: "SELECT * FROM categorias_financeiras WHERE id=? AND (clinica_id IS NULL OR clinica_id=?)", args: [b.categoria_id, clinica_id] })).rows[0]
                var lid2 = await lancar(client, clinica_id, auth, { data: String(item.data).slice(0, 10), tipo: item.tipo === 'debito' ? 'Saída' : 'Entrada', descricao: txt(b.descricao, 140) || item.descricao || 'Lançamento do extrato', valor: item.valor, classificacao: cat ? cat.classificacao : (item.tipo === 'debito' ? 'Outros' : 'Receita'), categoria: cat ? cat.nome : null, conta_id: item.conta_id })
                if (cat) await client.execute({ sql: "UPDATE lancamentos SET categoria_id=? WHERE id=? AND clinica_id=?", args: [cat.id, lid2, clinica_id] })
                await client.execute({ sql: "UPDATE conciliacao_itens SET status='conciliado', movimento_id=? WHERE id=? AND clinica_id=?", args: ['lancamento:' + lid2, item.id, clinica_id] })
            } else if (b.action === 'ignorar') {
                await client.execute({ sql: "UPDATE conciliacao_itens SET status='ignorado', movimento_id=NULL WHERE id=? AND clinica_id=?", args: [item.id, clinica_id] })
            } else if (b.action === 'desfazer') {
                await client.execute({ sql: "UPDATE conciliacao_itens SET status='pendente', movimento_id=NULL WHERE id=? AND clinica_id=?", args: [item.id, clinica_id] })
            } else return json(400, { success: false, error: 'Ação inválida' })
            await atualizarConciliacao(client, clinica_id, item.conciliacao_id)
            return json(200, { success: true })
        }
        if (q.id) {
            var conc = (await client.execute({ sql: "SELECT c.*, cb.nome conta_nome FROM conciliacoes c LEFT JOIN contas_bancarias cb ON cb.id=c.conta_id AND cb.clinica_id=c.clinica_id WHERE c.id=? AND c.clinica_id=?", args: [q.id, clinica_id] })).rows[0]
            if (!conc) return json(404, { success: false, error: 'Importação não encontrada' })
            var its2 = (await client.execute({ sql: "SELECT * FROM conciliacao_itens WHERE conciliacao_id=? AND clinica_id=? ORDER BY data, id", args: [conc.id, clinica_id] })).rows
            // movimentos do período para sugestão manual e para mostrar o casamento
            var mv = await fin.movimentos(client, clinica_id, addDias(conc.periodo_de, -10), addDias(conc.periodo_ate, 10))
            var porId = {}
            mv.forEach(function (m) { porId[m.id] = m })
            var usados2 = {}
            its2.forEach(function (x) { if (x.movimento_id) usados2[x.movimento_id] = 1 })
            return json(200, { success: true, conciliacao: conc, itens: its2.map(function (x) { return Object.assign({}, x, { movimento: x.movimento_id ? porId[x.movimento_id] || null : null }) }),
                livres: mv.filter(function (m) { return !usados2[m.id] }), contas: (await client.execute({ sql: "SELECT id,nome FROM contas_bancarias WHERE clinica_id=?", args: [clinica_id] })).rows })
        }
        var lista2 = (await tentar(client, "SELECT c.*, cb.nome conta_nome FROM conciliacoes c LEFT JOIN contas_bancarias cb ON cb.id=c.conta_id AND cb.clinica_id=c.clinica_id WHERE c.clinica_id=? ORDER BY c.id DESC LIMIT 100", [clinica_id]))
        return json(200, { success: true, data: lista2 })
    }

    // ── Régua de cobrança ─────────────────────────────────────────
    if (route === 'fin-regua') {
        if (req.method === 'POST') {
            if (b.action === 'excluir') { await client.execute({ sql: "DELETE FROM regua_regras WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] }); return json(200, { success: true }) }
            var dias = parseInt(b.dias, 10)
            if (!(dias >= -10 && dias <= 30)) return json(400, { success: false, error: 'Escolha um dia entre 10 antes e 30 depois do vencimento' })
            if (CANAIS.indexOf(b.canal) < 0) return json(400, { success: false, error: 'Canal inválido' })
            var msg = txt(b.mensagem, 1000)
            if (!msg) return json(400, { success: false, error: 'Escreva a mensagem' })
            if (b.id) {
                var up = await client.execute({ sql: "UPDATE regua_regras SET dias=?,canal=?,mensagem=?,ativo=? WHERE id=? AND clinica_id=?", args: [dias, b.canal, msg, b.ativo === false || b.ativo === 0 ? 0 : 1, b.id, clinica_id] })
                return up.rowsAffected ? json(200, { success: true, id: b.id }) : json(404, { success: false, error: 'Regra não encontrada' })
            }
            var ri2 = await client.execute({ sql: "INSERT INTO regua_regras(clinica_id,dias,canal,mensagem,ativo) VALUES(?,?,?,?,1)", args: [clinica_id, dias, b.canal, msg] })
            return json(200, { success: true, id: Number(ri2.lastInsertRowid) })
        }
        var regras = await tentar(client, "SELECT * FROM regua_regras WHERE clinica_id=? ORDER BY dias, id", [clinica_id])
        var envios = await tentar(client, "SELECT e.*, r.dias, p.nome paciente_nome, po.valor, po.data_vencimento FROM regua_envios e LEFT JOIN regua_regras r ON r.id=e.regra_id AND r.clinica_id=e.clinica_id LEFT JOIN parcelas_orcamento po ON po.id=e.parcela_id AND po.clinica_id=e.clinica_id LEFT JOIN pacientes p ON p.id=po.paciente_id AND p.clinica_id=e.clinica_id WHERE e.clinica_id=? ORDER BY e.id DESC LIMIT 50", [clinica_id])
        return json(200, { success: true, regras: regras, envios: envios, variaveis: VARS, whatsapp_template: !!process.env.WHATSAPP_TEMPLATE_COBRANCA, email: !!process.env.RESEND_API_KEY })
    }

    return false
}

module.exports = { handle, executarRegua, encargosAsaas, lerOFX, lerCSV, montarMensagem }
