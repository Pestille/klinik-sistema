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

    // ── Tabelas de preço ──────────────────────────────────────────
    if (route === 'precos-tabelas') {
        if (req.method === 'GET') {
            await sincronizarTabelas(client, clinica_id)
            var r = await client.execute({
                sql: "SELECT pt.id,pt.nome,pt.tipo,pt.ativo,(SELECT COUNT(*) FROM tabela_precos tp WHERE tp.clinica_id=pt.clinica_id AND UPPER(tp.tabela)=UPPER(pt.nome) AND COALESCE(tp.ativo,1)=1) itens FROM precos_tabelas pt WHERE pt.clinica_id=?" + (q.todas ? "" : " AND pt.ativo=1") + " ORDER BY CASE pt.tipo WHEN 'particular' THEN 0 WHEN 'proprio' THEN 1 ELSE 2 END, pt.nome",
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
                sql: "UPDATE precos_tabelas SET nome=?,tipo=?,ativo=? WHERE id=? AND clinica_id=?",
                args: [nome, TIPOS.indexOf(b.tipo) !== -1 ? b.tipo : t.tipo, b.ativo === undefined ? t.ativo : (b.ativo ? 1 : 0), t.id, clinica_id]
            })
            return json(200, { success: true, id: t.id })
        }
        var nn = String(b.nome || '').trim().toUpperCase().slice(0, 60)
        if (!nn) return json(400, { success: false, error: 'Nome obrigatório' })
        var exn = await client.execute({ sql: "SELECT id FROM precos_tabelas WHERE clinica_id=? AND UPPER(nome)=?", args: [clinica_id, nn] })
        if (exn.rows.length) return json(409, { success: false, error: 'Já existe uma tabela com esse nome' })
        var ins = await client.execute({ sql: "INSERT INTO precos_tabelas(clinica_id,nome,tipo) VALUES(?,?,?)", args: [clinica_id, nn, TIPOS.indexOf(b.tipo) !== -1 ? b.tipo : 'particular'] })
        return json(200, { success: true, id: Number(ins.lastInsertRowid) })
    }

    // ── Procedimentos de uma tabela ───────────────────────────────
    if (route === 'precos-itens') {
        if (req.method === 'GET') {
            var tab = await tabelaDaClinica(client, clinica_id, q.tabela_id)
            if (!tab) return json(404, { success: false, error: 'Tabela não encontrada' })
            var w = ["clinica_id=?", "UPPER(tabela)=UPPER(?)", "COALESCE(ativo,1)=1"], a = [clinica_id, tab.nome]
            if (q.q) { w.push("(procedimento LIKE ? OR codigo_interno LIKE ? OR especialidade LIKE ?)"); a.push('%' + q.q + '%', '%' + q.q + '%', '%' + q.q + '%') }
            var lim = Math.min(Math.max(parseInt(q.limit, 10) || 50, 10), 500), pag = Math.max(parseInt(q.pagina, 10) || 1, 1)
            var tot = await client.execute({ sql: "SELECT COUNT(*) n FROM tabela_precos WHERE " + w.join(' AND '), args: a })
            var rows = await client.execute({ sql: "SELECT id,codigo_interno,procedimento,especialidade,sessoes,valor,comissao FROM tabela_precos WHERE " + w.join(' AND ') + " ORDER BY procedimento LIMIT ? OFFSET ?", args: a.concat([lim, (pag - 1) * lim]) })
            return json(200, { success: true, tabela: tab, data: rows.rows, total: Number(tot.rows[0].n), pagina: pag, limite: lim })
        }
        if (b.action === 'delete') {
            var dl = await client.execute({ sql: "UPDATE tabela_precos SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!dl.rowsAffected) return json(404, { success: false, error: 'Procedimento não encontrado' })
            return json(200, { success: true })
        }
        var tb = await tabelaDaClinica(client, clinica_id, b.tabela_id)
        if (!tb) return json(404, { success: false, error: 'Tabela não encontrada' })
        // Importação em lote: [{procedimento, valor, codigo, especialidade}]
        if (b.action === 'importar') {
            var linhas = Array.isArray(b.itens) ? b.itens.slice(0, 2000) : []
            var novos = 0, atualizados = 0, ignorados = 0
            for (var i = 0; i < linhas.length; i++) {
                var L = linhas[i], proc = String(L.procedimento || '').trim().toUpperCase().slice(0, 200)
                if (!proc) { ignorados++; continue }
                var vl = num(L.valor)
                var ja = await client.execute({ sql: "SELECT id FROM tabela_precos WHERE clinica_id=? AND UPPER(tabela)=UPPER(?) AND UPPER(procedimento)=? AND COALESCE(ativo,1)=1 LIMIT 1", args: [clinica_id, tb.nome, proc] })
                if (ja.rows.length) {
                    await client.execute({ sql: "UPDATE tabela_precos SET valor=?,codigo_interno=COALESCE(NULLIF(?,''),codigo_interno),especialidade=COALESCE(NULLIF(?,''),especialidade) WHERE id=? AND clinica_id=?", args: [vl, String(L.codigo || ''), String(L.especialidade || ''), ja.rows[0].id, clinica_id] })
                    atualizados++
                } else {
                    await client.execute({ sql: "INSERT INTO tabela_precos(clinica_id,tabela,procedimento,especialidade,valor,codigo_interno,ativo) VALUES(?,?,?,?,?,?,1)", args: [clinica_id, tb.nome, proc, String(L.especialidade || '').slice(0, 80), vl, String(L.codigo || '').slice(0, 40)] })
                    novos++
                }
            }
            return json(200, { success: true, novos: novos, atualizados: atualizados, ignorados: ignorados })
        }
        var pr = String(b.procedimento || '').trim().toUpperCase().slice(0, 200)
        if (!pr) return json(400, { success: false, error: 'Nome do procedimento obrigatório' })
        var campos = [pr, String(b.especialidade || '').slice(0, 80), Math.max(parseInt(b.sessoes, 10) || 1, 1), num(b.valor), num(b.comissao), String(b.codigo_interno || '').slice(0, 40)]
        if (b.id) {
            var up = await client.execute({ sql: "UPDATE tabela_precos SET procedimento=?,especialidade=?,sessoes=?,valor=?,comissao=?,codigo_interno=? WHERE id=? AND clinica_id=? AND UPPER(tabela)=UPPER(?)", args: campos.concat([b.id, clinica_id, tb.nome]) })
            if (!up.rowsAffected) return json(404, { success: false, error: 'Procedimento não encontrado' })
            return json(200, { success: true, id: Number(b.id) })
        }
        var ip = await client.execute({ sql: "INSERT INTO tabela_precos(procedimento,especialidade,sessoes,valor,comissao,codigo_interno,clinica_id,tabela,ativo) VALUES(?,?,?,?,?,?,?,?,1)", args: campos.concat([clinica_id, tb.nome]) })
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
        var total = itens.reduce(function(s, it) { return s + num(it.valor_unitario) * Math.max(parseInt(it.quantidade, 10) || 1, 1) }, 0)
        var dataCri = DATA_RE.test(b.data_criacao || '') ? b.data_criacao : hojeCG()
        var validade = b.validade === undefined ? undefined : (DATA_RE.test(b.validade || '') ? b.validade : null)
        var titulo = b.titulo === undefined ? undefined : String(b.titulo || '').slice(0, 120)
        var orcId
        if (b.id) {
            var ow = await client.execute({ sql: "SELECT id FROM orcamentos WHERE id=? AND clinica_id=? AND paciente_id=?", args: [b.id, clinica_id, b.paciente_id] })
            if (!ow.rows.length) return json(404, { success: false, error: 'Orçamento não encontrado' })
            orcId = Number(b.id)
            await client.execute({
                sql: "UPDATE orcamentos SET profissional_id=?,profissional_nome=?,data_criacao=?,observacoes=?,tabela_preco=?,forma_pagamento=?,tipo_pagamento=?,parcelas=?,desconto=?,valor_total=?," +
                    "titulo=COALESCE(?,titulo),validade=CASE WHEN ? THEN ? ELSE validade END," +
                    "status=CASE WHEN status IN ('desaprovado','reprovado') THEN 'aberto' ELSE status END,updated_at=datetime('now') WHERE id=? AND clinica_id=?",
                args: [b.profissional_id || null, b.profissional_nome || '', dataCri, b.observacoes || '', b.tabela_preco || 'PARTICULAR', b.forma_pagamento || null, b.tipo_pagamento || 'valor_total',
                    b.parcelas || 1, num(b.desconto), total, titulo === undefined ? null : titulo, validade === undefined ? 0 : 1, validade === undefined ? null : validade, orcId, clinica_id]
            })
        } else {
            var io = await client.execute({
                sql: "INSERT INTO orcamentos(clinica_id,paciente_id,profissional_id,profissional_nome,data_criacao,observacoes,tabela_preco,forma_pagamento,tipo_pagamento,parcelas,desconto,valor_total,titulo,validade) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                args: [clinica_id, b.paciente_id, b.profissional_id || null, b.profissional_nome || '', dataCri, b.observacoes || '', b.tabela_preco || 'PARTICULAR', b.forma_pagamento || null,
                    b.tipo_pagamento || 'valor_total', b.parcelas || 1, num(b.desconto), total, titulo || null, validade || null]
            })
            orcId = Number(io.lastInsertRowid)
        }
        // Itens: com id → atualiza; sem id → insere; os que sumiram → remove (nunca os já executados)
        var atuais = (await client.execute({ sql: "SELECT id,executado FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?", args: [orcId, clinica_id] })).rows
        var mapa = {}; atuais.forEach(function(r) { mapa[r.id] = r })
        var mantidos = {}, avisos = []
        for (var k = 0; k < itens.length; k++) {
            var it = itens[k]
            var vals = [it.procedimento_codigo || '', String(it.procedimento_nome || '').slice(0, 200), String(it.dente || '').slice(0, 60), String(it.faces || '').slice(0, 20), String(it.regiao || '').slice(0, 60),
                it.profissional_id || null, it.profissional_nome || '', num(it.valor_unitario), num(it.valor_plano), Math.max(parseInt(it.quantidade, 10) || 1, 1)]
            if (it.id && mapa[it.id]) {
                await client.execute({ sql: "UPDATE orcamento_itens SET procedimento_codigo=?,procedimento_nome=?,dente=?,faces=?,regiao=?,profissional_id=?,profissional_nome=?,valor_unitario=?,valor_plano=?,quantidade=? WHERE id=? AND clinica_id=?", args: vals.concat([it.id, clinica_id]) })
                mantidos[it.id] = 1
            } else {
                await client.execute({ sql: "INSERT INTO orcamento_itens(procedimento_codigo,procedimento_nome,dente,faces,regiao,profissional_id,profissional_nome,valor_unitario,valor_plano,quantidade,clinica_id,orcamento_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", args: vals.concat([clinica_id, orcId]) })
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
            sql: "INSERT INTO orcamentos(clinica_id,paciente_id,profissional_id,profissional_nome,data_criacao,observacoes,tabela_preco,forma_pagamento,tipo_pagamento,parcelas,desconto,valor_total,titulo,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'aberto')",
            args: [clinica_id, o.paciente_id, o.profissional_id, o.profissional_nome, hojeCG(), o.observacoes, o.tabela_preco, o.forma_pagamento, o.tipo_pagamento, o.parcelas, o.desconto, o.valor_total, o.titulo ? o.titulo + ' (cópia)' : null]
        })
        var novoId = Number(nd.lastInsertRowid)
        await client.execute({
            sql: "INSERT INTO orcamento_itens(clinica_id,orcamento_id,procedimento_codigo,procedimento_nome,dente,faces,regiao,profissional_id,profissional_nome,valor_unitario,valor_plano,quantidade) SELECT clinica_id,?,procedimento_codigo,procedimento_nome,dente,faces,regiao,profissional_id,profissional_nome,valor_unitario,valor_plano,quantidade FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?",
            args: [novoId, o.id, clinica_id]
        })
        return json(200, { success: true, id: novoId })
    }

    // ── Dados completos para imprimir / enviar ────────────────────
    if (route === 'orcamento-documento') {
        var od = (await client.execute({ sql: "SELECT * FROM orcamentos WHERE id=? AND clinica_id=?", args: [q.id, clinica_id] })).rows[0]
        if (!od) return json(404, { success: false, error: 'Orçamento não encontrado' })
        var r2 = await Promise.all([
            client.execute({ sql: "SELECT * FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=? ORDER BY id", args: [od.id, clinica_id] }),
            client.execute({ sql: "SELECT id,nome,cpf,telefone,whatsapp,email FROM pacientes WHERE id=? AND clinica_id=?", args: [od.paciente_id, clinica_id] }),
            client.execute({ sql: "SELECT * FROM clinicas WHERE id=?", args: [clinica_id] })
        ])
        var cli = r2[2].rows[0] || {}
        return json(200, {
            success: true, orcamento: od, itens: r2[0].rows, paciente: r2[1].rows[0] || {},
            clinica: { nome: cli.nome, razao_social: cli.razao_social, cnpj: cli.cnpj || cli.documento_numero, endereco: cli.endereco, cidade: cli.cidade, estado: cli.estado, telefone: cli.telefone }
        })
    }

    return false
}

module.exports = { handle }
