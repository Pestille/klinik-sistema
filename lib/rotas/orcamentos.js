// lib/rotas/orcamentos.js — Orçamentos e tabelas de preço (Fase 4)
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
// Catálogo: tabela_precos (procedimento por linha, tabela pelo NOME, como as
// comissões); cadastro das tabelas: precos_tabelas (tipo particular/convenio/proprio).

var TIPOS = ['particular', 'convenio', 'proprio']
var DATA_RE = /^\d{4}-\d{2}-\d{2}$/

function num(v) { var n = typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0 }
function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }

async function tabelaDaClinica(client, clinica_id, id) {
    var r = await client.execute({ sql: "SELECT * FROM precos_tabelas WHERE id=? AND clinica_id=?", args: [id, clinica_id] })
    return r.rows[0] || null
}

// Garante o cadastro de tabelas que existem só no catálogo (ex.: importadas depois da migration)
async function sincronizarTabelas(client, clinica_id) {
    await client.execute({
        sql: "INSERT INTO precos_tabelas(clinica_id,nome,tipo) SELECT DISTINCT ?, tabela, 'particular' FROM tabela_precos t WHERE t.clinica_id=? AND t.tabela IS NOT NULL AND t.tabela<>'' AND NOT EXISTS (SELECT 1 FROM precos_tabelas x WHERE x.clinica_id=? AND UPPER(x.nome)=UPPER(t.tabela))",
        args: [clinica_id, clinica_id, clinica_id]
    })
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }

    // ── Autorizar ou negar execução (procedimento de convênio) ─────
    if (route === 'procedimento-autorizacao') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var autLib = require('../autorizacao')
        var dec = b.decisao
        if (dec !== 'autorizar' && dec !== 'negar') return json(400, { success: false, error: 'Decisão inválida' })
        var ai = (await client.execute({ sql: "SELECT oi.id, oi.procedimento_nome, oi.dente, oi.executado, oi.autorizacao, oi.guia, o.tabela_preco, o.paciente_id, p.nome paciente_nome FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE oi.id=? AND oi.clinica_id=?", args: [parseInt(b.id) || 0, clinica_id] })).rows[0]
        if (!ai) return json(404, { success: false, error: 'Procedimento não encontrado' })
        if (Number(ai.executado)) return json(400, { success: false, error: 'Procedimento já executado' })
        var sitA = autLib.situacao(ai, ai.tabela_preco, await autLib.tabelasQueExigem(client, clinica_id))
        if (!sitA) return json(400, { success: false, error: 'Este procedimento não precisa de autorização' })
        var guiaA = String(b.guia == null ? '' : b.guia).trim().slice(0, 40)
        if (dec === 'autorizar' && !guiaA) return json(400, { success: false, error: 'Informe o Número de Guia' })
        var novoA = dec === 'autorizar' ? 'autorizado' : 'negado'
        if (sitA === novoA) return json(409, { success: false, error: 'Procedimento já está ' + autLib.ROTULO[novoA].toLowerCase() })
        var quemA = String(auth.nome || auth.email || 'Usuário').slice(0, 80)
        var obsA = String(b.motivo || '').trim().slice(0, 200) || null
        var upA = await client.execute({
            sql: "UPDATE orcamento_itens SET autorizacao=?, guia=COALESCE(NULLIF(?,''),guia), autorizacao_em=?, autorizacao_por=?, autorizacao_obs=? WHERE id=? AND clinica_id=? AND COALESCE(executado,0)=0 AND COALESCE(autorizacao,'')=?",
            args: [novoA, guiaA, hojeCG(), quemA, obsA, ai.id, clinica_id, ai.autorizacao || '']
        })
        if (!upA.rowsAffected) return json(409, { success: false, error: 'O procedimento mudou enquanto você decidia. Atualize a tela.' })
        try { await require('../config').registrar(client, auth, 'tratamento.autorizacao', (novoA === 'autorizado' ? 'Procedimento Autorizado' : 'Procedimento Negado') + ' · ' + (ai.procedimento_nome || '') + (ai.dente ? ' (dente ' + ai.dente + ')' : '') + ' · ' + (ai.paciente_nome || '') + (guiaA ? ' · guia ' + guiaA : '') + (obsA ? ' · ' + obsA : ''), req) } catch (e) {}
        return json(200, { success: true, autorizacao: novoA, msg: novoA === 'autorizado' ? 'Procedimento Autorizado' : 'Procedimento Negado' })
    }

    // ── Tabelas de preço ──────────────────────────────────────────
    if (route === 'precos-tabelas') {
        if (req.method === 'GET') {
            await sincronizarTabelas(client, clinica_id)
            var r = await client.execute({
                sql: "SELECT pt.id,pt.nome,pt.tipo,pt.ativo,COALESCE(pt.exige_autorizacao,1) exige_autorizacao,(SELECT COUNT(*) FROM tabela_precos tp WHERE tp.clinica_id=pt.clinica_id AND UPPER(tp.tabela)=UPPER(pt.nome) AND COALESCE(tp.ativo,1)=1) itens FROM precos_tabelas pt WHERE pt.clinica_id=?" + (q.todas ? "" : " AND pt.ativo=1") + " ORDER BY CASE pt.tipo WHEN 'particular' THEN 0 WHEN 'proprio' THEN 1 ELSE 2 END, pt.nome",
                args: [clinica_id]
            })
            return json(200, { success: true, data: r.rows })
        }
        if (b.action === 'duplicar') {
            var orig = await tabelaDaClinica(client, clinica_id, b.id)
            if (!orig) return json(404, { success: false, error: 'Tabela não encontrada' })
            var novoNome = String(b.nome || '').trim().toUpperCase().slice(0, 60)
            if (!novoNome) return json(400, { success: false, error: 'Informe o nome da nova tabela' })
            var ex = await client.execute({ sql: "SELECT id FROM precos_tabelas WHERE clinica_id=? AND UPPER(nome)=?", args: [clinica_id, novoNome] })
            if (ex.rows.length) return json(409, { success: false, error: 'Já existe uma tabela com esse nome' })
            var fator = 1 + (num(b.ajuste_percent) / 100)
            await client.execute({ sql: "INSERT INTO precos_tabelas(clinica_id,nome,tipo) VALUES(?,?,?)", args: [clinica_id, novoNome, TIPOS.indexOf(b.tipo) !== -1 ? b.tipo : orig.tipo] })
            var cp = await client.execute({
                sql: "INSERT INTO tabela_precos(clinica_id,tabela,procedimento,especialidade,sessoes,valor,comissao,codigo_interno,ativo) SELECT clinica_id,?,procedimento,especialidade,sessoes,ROUND(valor*?,2),comissao,codigo_interno,1 FROM tabela_precos WHERE clinica_id=? AND UPPER(tabela)=UPPER(?) AND COALESCE(ativo,1)=1",
                args: [novoNome, fator, clinica_id, orig.nome]
            })
            return json(200, { success: true, copiados: cp.rowsAffected })
        }
        if (b.id) {
            var t = await tabelaDaClinica(client, clinica_id, b.id)
            if (!t) return json(404, { success: false, error: 'Tabela não encontrada' })
            var nome = b.nome != null ? String(b.nome).trim().toUpperCase().slice(0, 60) : t.nome
            if (!nome) return json(400, { success: false, error: 'Nome obrigatório' })
            if (nome !== t.nome) {
                var dupN = await client.execute({ sql: "SELECT id FROM precos_tabelas WHERE clinica_id=? AND UPPER(nome)=? AND id<>?", args: [clinica_id, nome, t.id] })
                if (dupN.rows.length) return json(409, { success: false, error: 'Já existe uma tabela com esse nome' })
                // O nome liga catálogo e regras de comissão: renomeia junto
                await client.execute({ sql: "UPDATE tabela_precos SET tabela=? WHERE clinica_id=? AND UPPER(tabela)=UPPER(?)", args: [nome, clinica_id, t.nome] })
                try { await client.execute({ sql: "UPDATE comissoes_config SET tabela_preco=? WHERE clinica_id=? AND UPPER(tabela_preco)=UPPER(?)", args: [nome, clinica_id, t.nome] }) } catch (e) {}
            }
            await client.execute({
                sql: "UPDATE precos_tabelas SET nome=?,tipo=?,ativo=?,exige_autorizacao=? WHERE id=? AND clinica_id=?",
                args: [nome, TIPOS.indexOf(b.tipo) !== -1 ? b.tipo : t.tipo, b.ativo === undefined ? t.ativo : (b.ativo ? 1 : 0), b.exige_autorizacao === undefined ? (t.exige_autorizacao == null ? 1 : t.exige_autorizacao) : (b.exige_autorizacao ? 1 : 0), t.id, clinica_id]
            })
            return json(200, { success: true, id: t.id })
        }
        var nn = String(b.nome || '').trim().toUpperCase().slice(0, 60)
        if (!nn) return json(400, { success: false, error: 'Nome obrigatório' })
        var exn = await client.execute({ sql: "SELECT id FROM precos_tabelas WHERE clinica_id=? AND UPPER(nome)=?", args: [clinica_id, nn] })
        if (exn.rows.length) return json(409, { success: false, error: 'Já existe uma tabela com esse nome' })
        var ins = await client.execute({ sql: "INSERT INTO precos_tabelas(clinica_id,nome,tipo,exige_autorizacao) VALUES(?,?,?,?)", args: [clinica_id, nn, TIPOS.indexOf(b.tipo) !== -1 ? b.tipo : 'particular', b.exige_autorizacao === false || b.exige_autorizacao === 0 ? 0 : 1] })
        return json(200, { success: true, id: Number(ins.lastInsertRowid) })
    }

    // ── Procedimentos de uma tabela ───────────────────────────────
    if (route === 'precos-itens') {
        // Insumos (kit) do procedimento: GET ?insumos=<id>  ·  POST {action:'insumos', id, insumos:[{produto_id, quantidade}]}
        if (req.method === 'GET' && q.insumos) {
            var ki = await client.execute({ sql: "SELECT pi.produto_id, pi.quantidade, ep.nome produto, ep.unidade, ep.quantidade saldo FROM procedimento_insumos pi JOIN tabela_precos tp ON tp.id=pi.tabela_preco_id AND tp.clinica_id=pi.clinica_id JOIN estoque_produtos ep ON ep.id=pi.produto_id AND ep.clinica_id=pi.clinica_id AND ep.ativo=1 WHERE pi.tabela_preco_id=? AND pi.clinica_id=? ORDER BY ep.nome", args: [parseInt(q.insumos, 10) || 0, clinica_id] })
            return json(200, { success: true, data: ki.rows })
        }
        if (b.action === 'insumos') {
            var tpi = (await client.execute({ sql: "SELECT id FROM tabela_precos WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })).rows[0]
            if (!tpi) return json(404, { success: false, error: 'Procedimento não encontrado' })
            var lst = (Array.isArray(b.insumos) ? b.insumos : []).slice(0, 50), vistos = {}, ok = []
            for (var li = 0; li < lst.length; li++) {
                var pid = parseInt(lst[li].produto_id, 10), qq = typeof lst[li].quantidade === 'string' && lst[li].quantidade.indexOf(',') >= 0 ? num(lst[li].quantidade) : Number(lst[li].quantidade) || 0
                if (!pid || !(qq > 0) || vistos[pid]) continue
                var ep = (await client.execute({ sql: "SELECT id FROM estoque_produtos WHERE id=? AND clinica_id=? AND ativo=1", args: [pid, clinica_id] })).rows[0]
                if (!ep) return json(400, { success: false, error: 'Produto inválido' })
                vistos[pid] = 1; ok.push([pid, Math.round(qq * 1000) / 1000])
            }
            await client.execute({ sql: "DELETE FROM procedimento_insumos WHERE tabela_preco_id=? AND clinica_id=?", args: [tpi.id, clinica_id] })
            for (var lj = 0; lj < ok.length; lj++) await client.execute({ sql: "INSERT INTO procedimento_insumos(clinica_id,tabela_preco_id,produto_id,quantidade) VALUES(?,?,?,?)", args: [clinica_id, tpi.id, ok[lj][0], ok[lj][1]] })
            return json(200, { success: true, total: ok.length })
        }
        if (req.method === 'GET') {
            var tab = await tabelaDaClinica(client, clinica_id, q.tabela_id)
            if (!tab) return json(404, { success: false, error: 'Tabela não encontrada' })
            var w = ["clinica_id=?", "UPPER(tabela)=UPPER(?)", "COALESCE(ativo,1)=1"], a = [clinica_id, tab.nome]
            if (q.q) { w.push("(procedimento LIKE ? OR codigo_interno LIKE ? OR especialidade LIKE ?)"); a.push('%' + q.q + '%', '%' + q.q + '%', '%' + q.q + '%') }
            var lim = Math.min(Math.max(parseInt(q.limit, 10) || 50, 10), 500), pag = Math.max(parseInt(q.pagina, 10) || 1, 1)
            var tot = await client.execute({ sql: "SELECT COUNT(*) n FROM tabela_precos WHERE " + w.join(' AND '), args: a })
            var rows = await client.execute({ sql: "SELECT id,codigo_interno,procedimento,especialidade,sessoes,valor,comissao,retorno_meses,acao_indicada FROM tabela_precos WHERE " + w.join(' AND ') + " ORDER BY procedimento LIMIT ? OFFSET ?", args: a.concat([lim, (pag - 1) * lim]) })
            return json(200, { success: true, tabela: tab, data: rows.rows, total: Number(tot.rows[0].n), pagina: pag, limite: lim })
        }
        if (b.action === 'delete') {
            var dl = await client.execute({ sql: "UPDATE tabela_precos SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!dl.rowsAffected) return json(404, { success: false, error: 'Procedimento não encontrado' })
            return json(200, { success: true })
        }
        var tb = await tabelaDaClinica(client, clinica_id, b.tabela_id)
        if (!tb) return json(404, { success: false, error: 'Tabela não encontrada' })
        // Importação em lote: [{procedimento, valor, codigo, especialidade, sessoes?, comissao?}]
        if (b.action === 'importar') {
            var linhas = Array.isArray(b.itens) ? b.itens.slice(0, 2000) : []
            var novos = 0, atualizados = 0, ignorados = 0
            for (var i = 0; i < linhas.length; i++) {
                var L = linhas[i], proc = String(L.procedimento || '').trim().toUpperCase().slice(0, 200)
                if (!proc) { ignorados++; continue }
                var vl = num(L.valor)
                var ja = await client.execute({ sql: "SELECT id FROM tabela_precos WHERE clinica_id=? AND UPPER(tabela)=UPPER(?) AND UPPER(procedimento)=? AND COALESCE(ativo,1)=1 LIMIT 1", args: [clinica_id, tb.nome, proc] })
                if (ja.rows.length) {
                    await client.execute({ sql: "UPDATE tabela_precos SET valor=?,codigo_interno=COALESCE(NULLIF(?,''),codigo_interno),especialidade=COALESCE(NULLIF(?,''),especialidade),sessoes=COALESCE(?,sessoes),comissao=COALESCE(?,comissao) WHERE id=? AND clinica_id=?", args: [vl, String(L.codigo || ''), String(L.especialidade || ''), L.sessoes != null ? Math.max(parseInt(L.sessoes, 10) || 1, 1) : null, L.comissao != null ? num(L.comissao) : null, ja.rows[0].id, clinica_id] })
                    atualizados++
                } else {
                    await client.execute({ sql: "INSERT INTO tabela_precos(clinica_id,tabela,procedimento,especialidade,valor,codigo_interno,sessoes,comissao,ativo) VALUES(?,?,?,?,?,?,?,?,1)", args: [clinica_id, tb.nome, proc, String(L.especialidade || '').slice(0, 80), vl, String(L.codigo || '').slice(0, 40), Math.max(parseInt(L.sessoes, 10) || 1, 1), num(L.comissao)] })
                    novos++
                }
            }
            return json(200, { success: true, novos: novos, atualizados: atualizados, ignorados: ignorados })
        }
        var pr = String(b.procedimento || '').trim().toUpperCase().slice(0, 200)
        if (!pr) return json(400, { success: false, error: 'Nome do procedimento obrigatório' })
        var campos = [pr, String(b.especialidade || '').slice(0, 80), Math.max(parseInt(b.sessoes, 10) || 1, 1), num(b.valor), num(b.comissao), String(b.codigo_interno || '').slice(0, 40), parseInt(b.retorno_meses, 10) > 0 ? parseInt(b.retorno_meses, 10) : null, String(b.acao_indicada || '').slice(0, 200)]
        if (b.id) {
            var up = await client.execute({ sql: "UPDATE tabela_precos SET procedimento=?,especialidade=?,sessoes=?,valor=?,comissao=?,codigo_interno=?,retorno_meses=?,acao_indicada=? WHERE id=? AND clinica_id=? AND UPPER(tabela)=UPPER(?)", args: campos.concat([b.id, clinica_id, tb.nome]) })
            if (!up.rowsAffected) return json(404, { success: false, error: 'Procedimento não encontrado' })
            return json(200, { success: true, id: Number(b.id) })
        }
        var ip = await client.execute({ sql: "INSERT INTO tabela_precos(procedimento,especialidade,sessoes,valor,comissao,codigo_interno,retorno_meses,acao_indicada,clinica_id,tabela,ativo) VALUES(?,?,?,?,?,?,?,?,?,?,1)", args: campos.concat([clinica_id, tb.nome]) })
        return json(200, { success: true, id: Number(ip.lastInsertRowid) })
    }

    // ── Busca de procedimento para o orçamento ────────────────────
    if (route === 'buscar-procedimento') {
        var termo = String(q.q || '').trim()
        if (termo.length < 2) return json(400, { success: false, error: 'Mínimo 2 caracteres' })
        var wb = ["tp.clinica_id=?", "COALESCE(tp.ativo,1)=1", "(tp.procedimento LIKE ? OR tp.codigo_interno LIKE ?)"], ab = [clinica_id, '%' + termo + '%', termo + '%']
        if (q.tabela) { wb.push("UPPER(tp.tabela)=UPPER(?)"); ab.push(q.tabela) }
        var rb = await client.execute({
            sql: "SELECT tp.id,tp.procedimento nome,tp.especialidade,tp.sessoes,tp.valor,tp.tabela,tp.codigo_interno,tp.codigo_interno codigo,COALESCE(pt.tipo,'particular') tipo_tabela FROM tabela_precos tp LEFT JOIN precos_tabelas pt ON pt.clinica_id=tp.clinica_id AND UPPER(pt.nome)=UPPER(tp.tabela) WHERE " + wb.join(' AND ') + " ORDER BY tp.procedimento LIMIT 20",
            args: ab
        })
        return json(200, { success: true, data: rb.rows, procedimentos: rb.rows })
    }

    // ── Salvar orçamento (itens atualizados por id; executados preservados) ─
    if (route === 'salvar-orcamento') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var pac = await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })
        if (!pac.rows.length) return json(404, { success: false, error: 'Paciente não encontrado' })
        var itens = Array.isArray(b.itens) ? b.itens : []
        var total = itens.reduce(function(s, it) { return s + (it.excluido ? 0 : num(it.valor_unitario) * Math.max(parseInt(it.quantidade, 10) || 1, 1)) }, 0)
        // Limite de desconto por perfil (Configurações › Regras de orçamento)
        if (auth.perfil !== 'admin' && num(b.desconto) > 0) {
            var limDesc = (await require('../config').lerCfg(client, clinica_id)).orcamento.desconto_max[auth.perfil]
            if (limDesc != null && total > 0 && num(b.desconto) / total * 100 > Number(limDesc) + 0.001) return json(403, { success: false, error: 'Seu perfil pode dar até ' + String(limDesc).replace('.', ',') + '% de desconto. Peça a um administrador para aprovar um desconto maior.' })
        }
        var dataCri = DATA_RE.test(b.data_criacao || '') ? b.data_criacao : hojeCG()
        var validade = b.validade === undefined ? undefined : (DATA_RE.test(b.validade || '') ? b.validade : null)
        var titulo = b.titulo === undefined ? undefined : String(b.titulo || '').slice(0, 120)
        var orcId
        if (b.id) {
            var ow = await client.execute({ sql: "SELECT id FROM orcamentos WHERE id=? AND clinica_id=? AND paciente_id=?", args: [b.id, clinica_id, b.paciente_id] })
            if (!ow.rows.length) return json(404, { success: false, error: 'Orçamento não encontrado' })
            orcId = Number(b.id)
            await client.execute({
                sql: "UPDATE orcamentos SET profissional_id=?,profissional_nome=?,data_criacao=?,observacoes=?,tabela_preco=?,forma_pagamento=?,tipo_pagamento=?,parcelas=?,desconto=?,valor_total=?,voucher_codigo=?,voucher_nome=?," +
                    "titulo=COALESCE(?,titulo),validade=CASE WHEN ? THEN ? ELSE validade END," +
                    "status=CASE WHEN status IN ('desaprovado','reprovado') THEN 'aberto' ELSE status END,updated_at=datetime('now') WHERE id=? AND clinica_id=?",
                args: [b.profissional_id || null, b.profissional_nome || '', dataCri, b.observacoes || '', b.tabela_preco || 'PARTICULAR', b.forma_pagamento || null, b.tipo_pagamento || 'valor_total',
                    b.parcelas || 1, num(b.desconto), total, b.voucher_codigo || null, b.voucher_nome || null, titulo === undefined ? null : titulo, validade === undefined ? 0 : 1, validade === undefined ? null : validade, orcId, clinica_id]
            })
        } else {
            var io = await client.execute({
                sql: "INSERT INTO orcamentos(clinica_id,paciente_id,profissional_id,profissional_nome,data_criacao,observacoes,tabela_preco,forma_pagamento,tipo_pagamento,parcelas,desconto,valor_total,titulo,validade,voucher_codigo,voucher_nome) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                args: [clinica_id, b.paciente_id, b.profissional_id || null, b.profissional_nome || '', dataCri, b.observacoes || '', b.tabela_preco || 'PARTICULAR', b.forma_pagamento || null,
                    b.tipo_pagamento || 'valor_total', b.parcelas || 1, num(b.desconto), total, titulo || null, validade || null, b.voucher_codigo || null, b.voucher_nome || null]
            })
            orcId = Number(io.lastInsertRowid)
        }
        // Itens: com id → atualiza; sem id → insere; os que sumiram → remove (nunca os já executados)
        var atuais = (await client.execute({ sql: "SELECT id,executado,excluido,excluido_em FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?", args: [orcId, clinica_id] })).rows
        var mapa = {}; atuais.forEach(function(r) { mapa[r.id] = r })
        var mantidos = {}, avisos = []
        for (var k = 0; k < itens.length; k++) {
            var it = itens[k]
            var vals = [it.procedimento_codigo || '', String(it.procedimento_nome || '').slice(0, 200), String(it.dente || '').slice(0, 60), String(it.faces || '').slice(0, 20), String(it.regiao || '').slice(0, 60),
                it.profissional_id || null, it.profissional_nome || '', num(it.valor_unitario), num(it.valor_plano), Math.max(parseInt(it.quantidade, 10) || 1, 1)]
            var exc = it.excluido ? 1 : 0
            if (it.id && mapa[it.id]) {
                var jaExc = Number(mapa[it.id].excluido) ? 1 : 0
                var excEm = exc ? (jaExc ? mapa[it.id].excluido_em : new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')) : null
                await client.execute({
                    sql: "UPDATE orcamento_itens SET procedimento_codigo=?,procedimento_nome=?,dente=?,faces=?,regiao=?,profissional_id=?,profissional_nome=?,valor_unitario=?,valor_plano=?,quantidade=?,ordem=?,excluido_em=?,excluido=? WHERE id=? AND clinica_id=?",
                    args: vals.concat([k, excEm, exc, it.id, clinica_id])
                })
                mantidos[it.id] = 1
            } else {
                await client.execute({ sql: "INSERT INTO orcamento_itens(procedimento_codigo,procedimento_nome,dente,faces,regiao,profissional_id,profissional_nome,valor_unitario,valor_plano,quantidade,ordem,excluido,clinica_id,orcamento_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", args: vals.concat([k, exc, clinica_id, orcId]) })
            }
        }
        for (var m = 0; m < atuais.length; m++) {
            if (mantidos[atuais[m].id]) continue
            if (atuais[m].executado) { avisos.push('Um procedimento já executado foi mantido no orçamento.'); continue }
            await client.execute({ sql: "DELETE FROM orcamento_itens WHERE id=? AND clinica_id=?", args: [atuais[m].id, clinica_id] })
        }
        return json(200, { success: true, id: orcId, msg: 'Orçamento salvo', avisos: avisos })
    }

    // ── Duplicar orçamento ────────────────────────────────────────
    if (route === 'orcamento-duplicar') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var o = (await client.execute({ sql: "SELECT * FROM orcamentos WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })).rows[0]
        if (!o) return json(404, { success: false, error: 'Orçamento não encontrado' })
        var nd = await client.execute({
            sql: "INSERT INTO orcamentos(clinica_id,paciente_id,profissional_id,profissional_nome,data_criacao,observacoes,tabela_preco,forma_pagamento,tipo_pagamento,parcelas,desconto,valor_total,titulo,validade,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,date(?,'+30 days'),'aberto')",
            args: [clinica_id, o.paciente_id, o.profissional_id, o.profissional_nome, hojeCG(), o.observacoes, o.tabela_preco, o.forma_pagamento, o.tipo_pagamento, o.parcelas, o.desconto, o.valor_total, o.titulo ? o.titulo + ' (cópia)' : null, hojeCG()]
        })
        var novoId = Number(nd.lastInsertRowid)
        await client.execute({
            sql: "INSERT INTO orcamento_itens(clinica_id,orcamento_id,procedimento_codigo,procedimento_nome,dente,faces,regiao,profissional_id,profissional_nome,valor_unitario,valor_plano,quantidade,ordem,excluido) SELECT clinica_id,?,procedimento_codigo,procedimento_nome,dente,faces,regiao,profissional_id,profissional_nome,valor_unitario,valor_plano,quantidade,ordem,excluido FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?",
            args: [novoId, o.id, clinica_id]
        })
        return json(200, { success: true, id: novoId })
    }

    // ── Dados completos para imprimir / enviar ────────────────────
    if (route === 'orcamento-documento') {
        var od = (await client.execute({ sql: "SELECT * FROM orcamentos WHERE id=? AND clinica_id=?", args: [q.id, clinica_id] })).rows[0]
        if (!od) return json(404, { success: false, error: 'Orçamento não encontrado' })
        var r2 = await Promise.all([
            client.execute({ sql: "SELECT * FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=? ORDER BY CASE WHEN ordem IS NULL THEN 1 ELSE 0 END, ordem, id", args: [od.id, clinica_id] }),
            client.execute({ sql: "SELECT id,nome,cpf,telefone,whatsapp,email FROM pacientes WHERE id=? AND clinica_id=?", args: [od.paciente_id, clinica_id] }),
            client.execute({ sql: "SELECT * FROM clinicas WHERE id=?", args: [clinica_id] })
        ])
        var cli = r2[2].rows[0] || {}
        return json(200, {
            success: true, orcamento: od, itens: r2[0].rows.filter(function (it) { return !Number(it.excluido) }), paciente: r2[1].rows[0] || {},
            clinica: { nome: cli.nome, razao_social: cli.razao_social, cnpj: cli.cnpj || cli.documento_numero, endereco: cli.endereco, cidade: cli.cidade, estado: cli.estado, telefone: cli.telefone }
        })
    }

    // ── Oportunidade de orçamentos (Clinicorp: "Agrupar Oportunidades") ─
    if (route === 'oportunidade') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var acao = b.action || 'criar'
        var oids = Array.isArray(b.orcamento_ids) ? b.orcamento_ids.map(function(x) { return parseInt(x, 10) }).filter(Boolean) : []
        async function validarGrupo(permitida) {
            var sel = await client.execute({ sql: "SELECT id,paciente_id,status,oportunidade_id FROM orcamentos WHERE id IN (" + oids.map(function() { return '?' }).join(',') + ") AND clinica_id=?", args: oids.concat([clinica_id]) })
            if (sel.rows.length !== oids.length) return { erro: 'Orçamento não encontrado' }
            var pacs = {}
            sel.rows.forEach(function(r) { pacs[r.paciente_id] = 1 })
            if (Object.keys(pacs).length > 1) return { erro: 'Os orçamentos precisam ser do mesmo paciente' }
            if (sel.rows.some(function(r) { return Number(r.oportunidade_id) && Number(r.oportunidade_id) !== Number(permitida || 0) })) return { erro: 'Um dos orçamentos já faz parte de outra oportunidade' }
            if (sel.rows.filter(function(r) { return r.status === 'aprovado' }).length > 1) return { erro: 'A oportunidade pode ter no máximo um orçamento aprovado' }
            return { paciente_id: sel.rows[0].paciente_id }
        }
        if (acao === 'criar') {
            if (oids.length < 2) return json(400, { success: false, error: 'Uma oportunidade precisa de pelo menos 2 orçamentos.' })
            var vg = await validarGrupo(null)
            if (vg.erro) return json(409, { success: false, error: vg.erro })
            var no = await client.execute({ sql: "INSERT INTO oportunidades(clinica_id,paciente_id) VALUES(?,?)", args: [clinica_id, vg.paciente_id] })
            var opoId = Number(no.lastInsertRowid)
            await client.execute({ sql: "UPDATE orcamentos SET oportunidade_id=? WHERE id IN (" + oids.map(function() { return '?' }).join(',') + ") AND clinica_id=?", args: [opoId].concat(oids).concat([clinica_id]) })
            return json(200, { success: true, id: opoId, msg: 'Oportunidade criada com sucesso' })
        }
        if (acao === 'atualizar') {
            var opo = parseInt(b.id, 10) || 0
            var ex = await client.execute({ sql: "SELECT id FROM oportunidades WHERE id=? AND clinica_id=?", args: [opo, clinica_id] })
            if (!ex.rows.length) return json(404, { success: false, error: 'Oportunidade não encontrada' })
            // Com menos de 2 orçamentos, a oportunidade é desfeita (os orçamentos voltam a ficar avulsos)
            if (oids.length < 2) {
                await client.execute({ sql: "UPDATE orcamentos SET oportunidade_id=NULL WHERE oportunidade_id=? AND clinica_id=?", args: [opo, clinica_id] })
                await client.execute({ sql: "DELETE FROM oportunidades WHERE id=? AND clinica_id=?", args: [opo, clinica_id] })
                return json(200, { success: true, desfeita: true, msg: 'Oportunidade desfeita com sucesso' })
            }
            var vg2 = await validarGrupo(opo)
            if (vg2.erro) return json(409, { success: false, error: vg2.erro })
            await client.execute({ sql: "UPDATE orcamentos SET oportunidade_id=NULL WHERE oportunidade_id=? AND clinica_id=?", args: [opo, clinica_id] })
            await client.execute({ sql: "UPDATE orcamentos SET oportunidade_id=? WHERE id IN (" + oids.map(function() { return '?' }).join(',') + ") AND clinica_id=?", args: [opo].concat(oids).concat([clinica_id]) })
            return json(200, { success: true, id: opo, msg: 'Oportunidade atualizada com sucesso' })
        }
        return json(400, { success: false, error: 'Ação inválida' })
    }

    return false
}

module.exports = { handle }
