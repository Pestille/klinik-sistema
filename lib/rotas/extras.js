// lib/rotas/extras.js — Estoque, controle protético e controle de indicação (Fase 9)
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
//   estoque-*    produtos, entradas/saídas com custo médio e conta a pagar opcional
//   protetico    serviços de laboratório em kanban (pré-envio → instalado)
//   indicacoes   quadro calculado a partir de pacientes.indicado_por_id; a equipe
//                registra a recompensa ao indicador e arquiva

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var UNIDADES = ['UN', 'CX', 'PCT', 'FR', 'TB', 'ML', 'L', 'G', 'KG', 'M', 'PAR', 'KIT']
var ETAPAS_PROT = [['pre_envio', 'Pré-envio'], ['laboratorio', 'No laboratório'], ['retorno', 'Retornou à clínica'], ['agendamento', 'Agendar paciente'], ['instalado', 'Instalado']]
var ETAPAS_IND = [['indicado', 'Indicado'], ['orcamento', 'Orçamento em aberto'], ['tratamento', 'Tratamento aprovado'], ['confirmada', 'Indicação confirmada'], ['recompensa', 'Recompensa entregue']]

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function num(v) { var n = typeof v === 'string' ? Number(v.replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? n : 0 }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
function r3(v) { return Math.round((Number(v) || 0) * 1000) / 1000 }

async function tentar(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args || [] })).rows }
    catch (e) { if (/no such (table|column)/i.test(e.message || '')) return []; throw e }
}
async function fornecedor(client, cid, id) {
    if (!id) return null
    return (await client.execute({ sql: "SELECT id, nome FROM fornecedores WHERE id=? AND clinica_id=?", args: [id, cid] })).rows[0] || null
}
async function contaPagar(client, cid, o) {
    var r = await client.execute({
        sql: "INSERT INTO contas_pagar(clinica_id,descricao,fornecedor,fornecedor_id,valor,vencimento,competencia,classificacao,categoria,status,recorrente,total_parcelas,parcela_atual) VALUES(?,?,?,?,?,?,?,?,?,'aberta',0,1,1)",
        args: [cid, txt(o.descricao, 140), o.fornecedor || null, o.fornecedor_id || null, r2(o.valor), o.vencimento, o.vencimento.slice(0, 7), 'Custo Variável', o.categoria]
    })
    return Number(r.lastInsertRowid)
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }
    var hoje = hojeCG()

    // ════════════════════════════════════════════════════════════
    // ESTOQUE
    // ════════════════════════════════════════════════════════════
    if (route === 'estoque-produtos') {
        if (req.method === 'POST') {
            if (b.action === 'excluir') {
                var ex = await client.execute({ sql: "UPDATE estoque_produtos SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
                return ex.rowsAffected ? json(200, { success: true }) : json(404, { success: false, error: 'Produto não encontrado' })
            }
            var nome = txt(b.nome, 120)
            if (!nome) return json(400, { success: false, error: 'Informe o nome do produto' })
            var un = UNIDADES.indexOf(String(b.unidade || '').toUpperCase()) >= 0 ? String(b.unidade).toUpperCase() : 'UN'
            var forn = b.fornecedor_id ? await fornecedor(client, clinica_id, b.fornecedor_id) : null
            if (b.fornecedor_id && !forn) return json(400, { success: false, error: 'Fornecedor inválido' })
            var val = DATA_RE.test(b.validade || '') ? b.validade : null
            var campos = [nome, txt(b.categoria, 60) || null, un, txt(b.codigo, 40) || null, Math.max(num(b.minimo), 0), forn ? forn.id : null, txt(b.localizacao, 60) || null, val]
            if (b.id) {
                var up = await client.execute({ sql: "UPDATE estoque_produtos SET nome=?,categoria=?,unidade=?,codigo=?,minimo=?,fornecedor_id=?,localizacao=?,validade=? WHERE id=? AND clinica_id=? AND ativo=1", args: campos.concat([b.id, clinica_id]) })
                return up.rowsAffected ? json(200, { success: true, id: b.id }) : json(404, { success: false, error: 'Produto não encontrado' })
            }
            var ins = await client.execute({ sql: "INSERT INTO estoque_produtos(nome,categoria,unidade,codigo,minimo,fornecedor_id,localizacao,validade,clinica_id,quantidade,custo_medio) VALUES(?,?,?,?,?,?,?,?,?,0,0)", args: campos.concat([clinica_id]) })
            var pid = Number(ins.lastInsertRowid)
            // estoque inicial informado no cadastro entra como movimento
            var ini = num(b.quantidade_inicial)
            if (ini > 0) {
                var custo = Math.max(num(b.custo_unitario), 0)
                await client.execute({ sql: "UPDATE estoque_produtos SET quantidade=?, custo_medio=? WHERE id=? AND clinica_id=?", args: [r3(ini), r2(custo), pid, clinica_id] })
                await client.execute({ sql: "INSERT INTO estoque_movimentos(clinica_id,produto_id,tipo,quantidade,saldo,custo_unitario,motivo,usuario_nome) VALUES(?,?,'entrada',?,?,?,?,?)", args: [clinica_id, pid, r3(ini), r3(ini), r2(custo), 'Estoque inicial', auth.nome || null] })
            }
            return json(200, { success: true, id: pid })
        }
        var w = ["p.clinica_id=?", "p.ativo=1"], a = [clinica_id]
        if (q.q) { w.push("(p.nome LIKE ? OR p.codigo LIKE ? OR p.categoria LIKE ?)"); a.push('%' + q.q + '%', '%' + q.q + '%', '%' + q.q + '%') }
        if (q.categoria) { w.push("p.categoria=?"); a.push(q.categoria) }
        var rows = (await tentar(client, "SELECT p.*, f.nome fornecedor_nome FROM estoque_produtos p LEFT JOIN fornecedores f ON f.id=p.fornecedor_id AND f.clinica_id=p.clinica_id WHERE " + w.join(' AND ') + " ORDER BY p.nome LIMIT 2000", a)).map(function (p) {
            var qt = Number(p.quantidade) || 0, mi = Number(p.minimo) || 0
            var sit = qt <= 0 ? 'zerado' : mi > 0 && qt <= mi ? 'baixo' : 'ok'
            if (p.validade && p.validade <= addDias(hoje, 30)) sit = p.validade < hoje ? 'vencido' : (sit === 'ok' ? 'vencendo' : sit)
            return Object.assign({}, p, { quantidade: r3(qt), minimo: r3(mi), custo_medio: r2(p.custo_medio), valor_total: r2(qt * (Number(p.custo_medio) || 0)), situacao: sit })
        })
        if (q.situacao === 'repor') rows = rows.filter(function (p) { return p.situacao === 'baixo' || p.situacao === 'zerado' })
        else if (q.situacao === 'validade') rows = rows.filter(function (p) { return p.situacao === 'vencido' || p.situacao === 'vencendo' })
        var cats = (await tentar(client, "SELECT DISTINCT categoria FROM estoque_produtos WHERE clinica_id=? AND ativo=1 AND COALESCE(categoria,'')<>'' ORDER BY categoria", [clinica_id])).map(function (x) { return x.categoria })
        var todos = await tentar(client, "SELECT quantidade, minimo, custo_medio, validade FROM estoque_produtos WHERE clinica_id=? AND ativo=1", [clinica_id])
        var tot = { produtos: todos.length, valor: r2(todos.reduce(function (s, p) { return s + (Number(p.quantidade) || 0) * (Number(p.custo_medio) || 0) }, 0)),
            repor: todos.filter(function (p) { return Number(p.quantidade) <= 0 || (Number(p.minimo) > 0 && Number(p.quantidade) <= Number(p.minimo)) }).length,
            validade: todos.filter(function (p) { return p.validade && p.validade <= addDias(hoje, 30) }).length }
        return json(200, { success: true, data: rows, categorias: cats, unidades: UNIDADES, totais: tot })
    }

    if (route === 'estoque-movimentar') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var p = (await client.execute({ sql: "SELECT * FROM estoque_produtos WHERE id=? AND clinica_id=? AND ativo=1", args: [b.produto_id, clinica_id] })).rows[0]
        if (!p) return json(404, { success: false, error: 'Produto não encontrado' })
        var tipo = ['entrada', 'saida', 'ajuste'].indexOf(b.tipo) >= 0 ? b.tipo : null
        if (!tipo) return json(400, { success: false, error: 'Escolha entrada, saída ou ajuste' })
        var qtd = num(b.quantidade), atual = Number(p.quantidade) || 0, novo, custoMedio = Number(p.custo_medio) || 0
        if (tipo === 'ajuste') { if (qtd < 0) return json(400, { success: false, error: 'Informe a quantidade contada' }); novo = qtd }
        else {
            if (!(qtd > 0)) return json(400, { success: false, error: 'Informe a quantidade' })
            if (tipo === 'saida') { if (qtd > atual + 1e-9) return json(400, { success: false, error: 'Saída maior que o estoque (' + r3(atual) + ' ' + p.unidade + '). Use "ajuste" se a contagem estiver diferente.' }); novo = atual - qtd }
            else {
                var cu = Math.max(num(b.custo_unitario), 0)
                novo = atual + qtd
                if (cu > 0) custoMedio = novo > 0 ? (atual * custoMedio + qtd * cu) / novo : cu
            }
        }
        var pac = null
        if (b.paciente_id) { pac = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })).rows[0]; if (!pac) return json(404, { success: false, error: 'Paciente não encontrado' }) }
        var contaId = null
        if (tipo === 'entrada' && b.gerar_conta) {
            var venc = DATA_RE.test(b.vencimento || '') ? b.vencimento : hoje
            var fo = await fornecedor(client, clinica_id, b.fornecedor_id || p.fornecedor_id)
            var tot2 = r2(qtd * Math.max(num(b.custo_unitario), 0))
            if (!(tot2 > 0)) return json(400, { success: false, error: 'Informe o custo unitário para gerar a conta a pagar' })
            contaId = await contaPagar(client, clinica_id, { descricao: 'Compra: ' + p.nome + ' (' + r3(qtd) + ' ' + p.unidade + ')', fornecedor: fo ? fo.nome : null, fornecedor_id: fo ? fo.id : null, valor: tot2, vencimento: venc, categoria: 'Material Odontológico' })
        }
        await client.execute({ sql: "UPDATE estoque_produtos SET quantidade=?, custo_medio=?, validade=COALESCE(?,validade) WHERE id=? AND clinica_id=?", args: [r3(novo), r2(custoMedio), tipo === 'entrada' && DATA_RE.test(b.validade || '') ? b.validade : null, p.id, clinica_id] })
        var mv = await client.execute({
            sql: "INSERT INTO estoque_movimentos(clinica_id,produto_id,tipo,quantidade,saldo,custo_unitario,motivo,lote,validade,paciente_id,profissional_id,conta_pagar_id,usuario_nome,criado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','-4 hours'))",
            args: [clinica_id, p.id, tipo, tipo === 'ajuste' ? r3(novo - atual) : r3(qtd), r3(novo), tipo === 'entrada' ? r2(num(b.custo_unitario)) : null, txt(b.motivo, 200) || null, txt(b.lote, 40) || null, DATA_RE.test(b.validade || '') ? b.validade : null, pac ? pac.id : null, parseInt(b.profissional_id, 10) || null, contaId, auth.nome || null]
        })
        return json(200, { success: true, id: Number(mv.lastInsertRowid), saldo: r3(novo), conta_pagar_id: contaId })
    }

    if (route === 'estoque-movimentos') {
        var w2 = ["m.clinica_id=?"], a2 = [clinica_id]
        if (q.produto_id) { w2.push("m.produto_id=?"); a2.push(q.produto_id) }
        if (DATA_RE.test(q.de || '')) { w2.push("substr(m.criado_em,1,10)>=?"); a2.push(q.de) }
        if (DATA_RE.test(q.ate || '')) { w2.push("substr(m.criado_em,1,10)<=?"); a2.push(q.ate) }
        var mvs = await tentar(client, "SELECT m.*, p.nome produto, p.unidade, pa.nome paciente_nome FROM estoque_movimentos m JOIN estoque_produtos p ON p.id=m.produto_id AND p.clinica_id=m.clinica_id LEFT JOIN pacientes pa ON pa.id=m.paciente_id AND pa.clinica_id=m.clinica_id WHERE " + w2.join(' AND ') + " ORDER BY m.id DESC LIMIT 500", a2)
        return json(200, { success: true, data: mvs })
    }

    // ════════════════════════════════════════════════════════════
    // CONTROLE PROTÉTICO
    // ════════════════════════════════════════════════════════════
    if (route === 'protetico') {
        var ids = ETAPAS_PROT.map(function (e) { return e[0] })
        if (req.method === 'POST') {
            var at = b.id ? (await client.execute({ sql: "SELECT * FROM proteticos WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })).rows[0] : null
            if (b.id && !at) return json(404, { success: false, error: 'Serviço não encontrado' })
            if (b.action === 'mover') {
                if (ids.indexOf(b.etapa) < 0) return json(400, { success: false, error: 'Etapa inválida' })
                var sets = ["etapa=?", "atualizado_em=datetime('now','-4 hours')"], args = [b.etapa]
                if (b.etapa === 'laboratorio' && !at.data_envio) { sets.push("data_envio=?"); args.push(hoje) }
                if (b.etapa === 'retorno' && !at.data_retorno) { sets.push("data_retorno=?"); args.push(hoje) }
                if (b.etapa === 'instalado' && !at.data_instalacao) { sets.push("data_instalacao=?"); args.push(hoje) }
                await client.execute({ sql: "UPDATE proteticos SET " + sets.join(',') + " WHERE id=? AND clinica_id=?", args: args.concat([at.id, clinica_id]) })
                return json(200, { success: true })
            }
            if (b.action === 'arquivar' || b.action === 'desarquivar') {
                await client.execute({ sql: "UPDATE proteticos SET arquivado=? WHERE id=? AND clinica_id=?", args: [b.action === 'arquivar' ? 1 : 0, at.id, clinica_id] })
                return json(200, { success: true })
            }
            if (b.action === 'excluir') {
                if (!(await require('../permissoes').pode(client, auth, 'protetico.excluir'))) return json(403, { success: false, error: 'Seu perfil não pode excluir serviços protéticos' })
                await require('../lixeira').moverParaLixeira(client, auth, 'protetico', at.id)
                return json(200, { success: true })
            }
            if (b.action === 'conta') {
                if (at.conta_pagar_id) return json(409, { success: false, error: 'Este serviço já tem conta a pagar' })
                if (!(Number(at.valor) > 0)) return json(400, { success: false, error: 'Informe o valor do serviço antes' })
                var venc2 = DATA_RE.test(b.vencimento || '') ? b.vencimento : addDias(hoje, 30)
                var cid2 = await contaPagar(client, clinica_id, { descricao: 'Laboratório: ' + at.servico + (at.paciente_nome ? ' · ' + at.paciente_nome : ''), fornecedor: at.laboratorio_nome, fornecedor_id: at.laboratorio_id, valor: at.valor, vencimento: venc2, categoria: 'Laboratório Protético' })
                await client.execute({ sql: "UPDATE proteticos SET conta_pagar_id=? WHERE id=? AND clinica_id=?", args: [cid2, at.id, clinica_id] })
                return json(200, { success: true, conta_pagar_id: cid2 })
            }
            var serv = txt(b.servico, 120)
            if (!serv) return json(400, { success: false, error: 'Informe o serviço (ex.: coroa de porcelana)' })
            var pc = null
            if (b.paciente_id) { pc = (await client.execute({ sql: "SELECT id, nome FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })).rows[0]; if (!pc) return json(404, { success: false, error: 'Paciente não encontrado' }) }
            var lab = b.laboratorio_id ? await fornecedor(client, clinica_id, b.laboratorio_id) : null
            if (b.laboratorio_id && !lab) return json(400, { success: false, error: 'Laboratório inválido' })
            var pr = null
            if (b.profissional_id) { pr = (await client.execute({ sql: "SELECT id, nome FROM profissionais WHERE id=? AND clinica_id=?", args: [b.profissional_id, clinica_id] })).rows[0]; if (!pr) return json(400, { success: false, error: 'Profissional inválido' }) }
            var dados = [pc ? pc.id : null, pc ? pc.nome : txt(b.paciente_nome, 120) || null, pr ? pr.id : null, pr ? pr.nome : null, serv, txt(b.dentes, 60) || null, txt(b.cor, 30) || null, lab ? lab.id : null, lab ? lab.nome : txt(b.laboratorio_nome, 120) || null,
                DATA_RE.test(b.data_envio || '') ? b.data_envio : null, DATA_RE.test(b.data_prevista || '') ? b.data_prevista : null, Math.max(num(b.valor), 0), txt(b.observacoes, 1000) || null]
            if (at) {
                await client.execute({ sql: "UPDATE proteticos SET paciente_id=?,paciente_nome=?,profissional_id=?,profissional_nome=?,servico=?,dentes=?,cor=?,laboratorio_id=?,laboratorio_nome=?,data_envio=?,data_prevista=?,valor=?,observacoes=?,atualizado_em=datetime('now','-4 hours') WHERE id=? AND clinica_id=?", args: dados.concat([at.id, clinica_id]) })
                return json(200, { success: true, id: at.id })
            }
            var etapa0 = ids.indexOf(b.etapa) >= 0 ? b.etapa : 'pre_envio'
            var ip = await client.execute({ sql: "INSERT INTO proteticos(paciente_id,paciente_nome,profissional_id,profissional_nome,servico,dentes,cor,laboratorio_id,laboratorio_nome,data_envio,data_prevista,valor,observacoes,clinica_id,etapa) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", args: dados.concat([clinica_id, etapa0]) })
            return json(200, { success: true, id: Number(ip.lastInsertRowid) })
        }
        var w3 = ["clinica_id=?", "COALESCE(arquivado,0)=?"], a3 = [clinica_id, q.arquivados ? 1 : 0]
        if (q.profissional_id) { w3.push("profissional_id=?"); a3.push(q.profissional_id) }
        if (q.laboratorio_id) { w3.push("laboratorio_id=?"); a3.push(q.laboratorio_id) }
        if (q.q) { w3.push("(paciente_nome LIKE ? OR servico LIKE ? OR laboratorio_nome LIKE ?)"); a3.push('%' + q.q + '%', '%' + q.q + '%', '%' + q.q + '%') }
        var its = (await tentar(client, "SELECT * FROM proteticos WHERE " + w3.join(' AND ') + " ORDER BY COALESCE(data_prevista,'9999'), id LIMIT 2000", a3)).map(function (x) {
            return Object.assign({}, x, { atrasado: x.etapa === 'laboratorio' && x.data_prevista && x.data_prevista < hoje })
        })
        return json(200, { success: true, etapas: ETAPAS_PROT.map(function (e) { return { id: e[0], nome: e[1] } }), itens: its })
    }

    // ════════════════════════════════════════════════════════════
    // CONTROLE DE INDICAÇÃO
    // ════════════════════════════════════════════════════════════
    if (route === 'indicacoes') {
        if (req.method === 'POST') {
            var ind = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=? AND indicado_por_id IS NOT NULL", args: [b.paciente_id, clinica_id] })).rows[0]
            if (!ind) return json(404, { success: false, error: 'Indicação não encontrada' })
            if (b.action === 'recompensa') {
                var rec = txt(b.recompensa, 200)
                if (!rec) return json(400, { success: false, error: 'Descreva a recompensa (ex.: limpeza grátis, desconto de 10%)' })
                await client.execute({ sql: "INSERT INTO indicacoes_status(clinica_id,paciente_id,recompensa,recompensa_em) VALUES(?,?,?,?) ON CONFLICT(clinica_id,paciente_id) DO UPDATE SET recompensa=excluded.recompensa, recompensa_em=excluded.recompensa_em", args: [clinica_id, ind.id, rec, DATA_RE.test(b.data || '') ? b.data : hoje] })
                return json(200, { success: true })
            }
            if (b.action === 'desfazer_recompensa') { await client.execute({ sql: "UPDATE indicacoes_status SET recompensa=NULL, recompensa_em=NULL WHERE clinica_id=? AND paciente_id=?", args: [clinica_id, ind.id] }); return json(200, { success: true }) }
            if (b.action === 'arquivar' || b.action === 'desarquivar') {
                await client.execute({ sql: "INSERT INTO indicacoes_status(clinica_id,paciente_id,arquivado) VALUES(?,?,?) ON CONFLICT(clinica_id,paciente_id) DO UPDATE SET arquivado=excluded.arquivado", args: [clinica_id, ind.id, b.action === 'arquivar' ? 1 : 0] })
                return json(200, { success: true })
            }
            return json(400, { success: false, error: 'Ação inválida' })
        }
        var ps = await tentar(client, "SELECT p.id, p.nome, COALESCE(p.whatsapp,p.telefone) telefone, substr(COALESCE(p.criado_em,''),1,10) cadastro, p.indicado_por_id, COALESCE(i.nome,p.indicado_por_nome) indicador, COALESCE(i.whatsapp,i.telefone) indicador_tel, s.recompensa, s.recompensa_em, COALESCE(s.arquivado,0) arquivado FROM pacientes p LEFT JOIN pacientes i ON i.id=p.indicado_por_id AND i.clinica_id=p.clinica_id LEFT JOIN indicacoes_status s ON s.paciente_id=p.id AND s.clinica_id=p.clinica_id WHERE p.clinica_id=? AND p.indicado_por_id IS NOT NULL ORDER BY p.criado_em DESC LIMIT 2000", [clinica_id])
        var orc = {}
        ;(await tentar(client, "SELECT paciente_id, MAX(CASE WHEN status='aprovado' THEN 1 ELSE 0 END) aprovado, COUNT(*) n, SUM(CASE WHEN status='aprovado' THEN valor_total-COALESCE(desconto,0) ELSE 0 END) valor FROM orcamentos WHERE clinica_id=? GROUP BY paciente_id", [clinica_id])).forEach(function (x) { orc[x.paciente_id] = x })
        var pago = {}
        ;(await tentar(client, "SELECT DISTINCT paciente_id FROM parcelas_orcamento WHERE clinica_id=? AND status='pago'", [clinica_id])).forEach(function (x) { pago[x.paciente_id] = 1 })
        ;(await tentar(client, "SELECT DISTINCT o.paciente_id FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id WHERE oi.clinica_id=? AND COALESCE(oi.executado,0)=1", [clinica_id])).forEach(function (x) { pago[x.paciente_id] = 1 })
        var cartoes = ps.filter(function (p) { return q.arquivados ? Number(p.arquivado) === 1 : Number(p.arquivado) !== 1 }).map(function (p) {
            var o = orc[p.id], etapa = p.recompensa_em ? 'recompensa' : !o ? 'indicado' : !Number(o.aprovado) ? 'orcamento' : pago[p.id] ? 'confirmada' : 'tratamento'
            return { paciente_id: p.id, paciente_nome: p.nome, telefone: p.telefone, cadastro: p.cadastro, indicador_id: p.indicado_por_id, indicador_nome: p.indicador, indicador_tel: p.indicador_tel, etapa: etapa, valor_aprovado: o ? r2(o.valor) : 0, recompensa: p.recompensa, recompensa_em: p.recompensa_em }
        })
        if (q.q) { var s2 = String(q.q).toLowerCase(); cartoes = cartoes.filter(function (c) { return (c.paciente_nome + ' ' + c.indicador_nome).toLowerCase().indexOf(s2) >= 0 }) }
        // ranking de quem mais indica (só indicações confirmadas contam valor)
        var rk = {}
        cartoes.forEach(function (c) { if (!c.indicador_id) return; rk[c.indicador_id] = rk[c.indicador_id] || { id: c.indicador_id, nome: c.indicador_nome, indicacoes: 0, confirmadas: 0, valor: 0 }; rk[c.indicador_id].indicacoes++; if (c.etapa === 'confirmada' || c.etapa === 'recompensa') { rk[c.indicador_id].confirmadas++; rk[c.indicador_id].valor = r2(rk[c.indicador_id].valor + c.valor_aprovado) } })
        return json(200, { success: true, etapas: ETAPAS_IND.map(function (e) { return { id: e[0], nome: e[1] } }), cartoes: cartoes, ranking: Object.keys(rk).map(function (k) { return rk[k] }).sort(function (a, c) { return c.confirmadas - a.confirmadas || c.indicacoes - a.indicacoes }).slice(0, 10) })
    }

    return false
}

module.exports = { handle }
