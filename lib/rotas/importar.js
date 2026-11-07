// lib/rotas/importar.js — Sincronização Clinicorp → Klinov
// Klinov — Campo Grande, MS
//
// Rota administrativa usada pelo sincronizador local (scripts fora do deploy).
// A idempotência vem da tabela clinicorp_import_map (entidade, origem, destino),
// a mesma usada na importação de 2026-10-15: registro já mapeado é ATUALIZADO,
// registro novo é INSERIDO e entra no mapa. Nada é apagado por aqui.
//
// Ações (POST sync-clinicorp, somente admin):
//   status  — contagens das tabelas + entidades do mapa
//   mapa    — { entidade, offset } → até 5000 pares { origem, destino }
//   dump    — { tabela, offset, limite } → linhas (backup antes de gravar)
//   upsert  — { tabela, entidade, registros: [{ origem, dados }] }

var TABELAS = {
    pacientes: 1, profissionais: 1, agendamentos: 1, orcamentos: 1, orcamento_itens: 1,
    parcelas_orcamento: 1, pagamentos: 1, prontuario_evolucoes: 1, anamnese_perguntas: 1,
    anamnese_respostas: 1, financeiro: 1, contas_pagar: 1, comissoes_lancamentos: 1
}
var SO_DUMP = { clinicorp_import_map: 1, clinicas: 1, agenda_categorias: 1 }

async function garantirMapa(client) {
    await client.execute("CREATE TABLE IF NOT EXISTS clinicorp_import_map (entidade TEXT NOT NULL, origem TEXT NOT NULL, destino INTEGER NOT NULL, clinica_id INTEGER NOT NULL, importado_em TEXT, PRIMARY KEY (clinica_id, entidade, origem))")
}

async function colunas(client, tabela) {
    var r = await client.execute("PRAGMA table_info(" + tabela + ")")
    var m = {}
    for (var i = 0; i < r.rows.length; i++) m[r.rows[i].name] = 1
    delete m.id; delete m.clinica_id
    return m
}

async function handle(route, ctx) {
    if (route !== 'sync-clinicorp') return false
    var req = ctx.req, res = ctx.res, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    function json(st, o) { res.status(st).json(o); return true }
    if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
    if (!auth || auth.perfil !== 'admin') return json(403, { success: false, error: 'Apenas o administrador sincroniza dados' })
    var b = req.body || {}
    var acao = String(b.acao || '')

    if (acao === 'status') {
        await garantirMapa(client)
        var contagens = {}
        var nomes = Object.keys(TABELAS)
        for (var i = 0; i < nomes.length; i++) {
            try {
                var c = await client.execute({ sql: "SELECT COUNT(*) n FROM " + nomes[i] + " WHERE clinica_id=?", args: [clinica_id] })
                contagens[nomes[i]] = Number(c.rows[0].n)
            } catch (e) { contagens[nomes[i]] = null }
        }
        var ent = await client.execute({ sql: "SELECT entidade, COUNT(*) n FROM clinicorp_import_map WHERE clinica_id=? GROUP BY entidade", args: [clinica_id] })
        return json(200, { success: true, contagens: contagens, mapa: ent.rows })
    }

    if (acao === 'mapa') {
        await garantirMapa(client)
        var off = parseInt(b.offset) || 0
        var mr = await client.execute({ sql: "SELECT origem, destino FROM clinicorp_import_map WHERE clinica_id=? AND entidade=? ORDER BY rowid LIMIT 5000 OFFSET ?", args: [clinica_id, String(b.entidade || ''), off] })
        return json(200, { success: true, data: mr.rows, offset: off, fim: mr.rows.length < 5000 })
    }

    if (acao === 'dump') {
        var tb = String(b.tabela || '')
        if (!TABELAS[tb] && !SO_DUMP[tb]) return json(400, { success: false, error: 'Tabela não permitida' })
        var off2 = parseInt(b.offset) || 0
        var lim = Math.min(parseInt(b.limite) || 2000, 5000)
        var temClinica = tb !== 'clinicas'
        var sql = "SELECT * FROM " + tb + (temClinica ? " WHERE clinica_id=" + Number(clinica_id) : "") + " ORDER BY rowid LIMIT " + lim + " OFFSET " + off2
        try {
            var dr = await client.execute(sql)
            return json(200, { success: true, data: dr.rows, fim: dr.rows.length < lim })
        } catch (e) { return json(200, { success: true, data: [], fim: true, aviso: e.message }) }
    }

    if (acao === 'upsert') {
        var tabela = String(b.tabela || '')
        var entidade = String(b.entidade || '')
        var regs = Array.isArray(b.registros) ? b.registros : []
        if (!TABELAS[tabela]) return json(400, { success: false, error: 'Tabela não permitida' })
        if (!entidade) return json(400, { success: false, error: 'Entidade obrigatória' })
        if (!regs.length) return json(200, { success: true, inseridos: 0, atualizados: 0, mapa: {} })
        if (regs.length > 400) return json(400, { success: false, error: 'Máximo de 400 registros por chamada' })
        await garantirMapa(client)
        var cols = await colunas(client, tabela)

        // mapa existente para as origens do lote
        var origens = regs.map(function (r) { return String(r.origem || '') })
        var marks = origens.map(function () { return '?' }).join(',')
        var ex = await client.execute({ sql: "SELECT origem, destino FROM clinicorp_import_map WHERE clinica_id=? AND entidade=? AND origem IN (" + marks + ")", args: [clinica_id, entidade].concat(origens) })
        var destinoDe = {}
        for (var e2 = 0; e2 < ex.rows.length; e2++) destinoDe[ex.rows[e2].origem] = Number(ex.rows[e2].destino)

        var agora = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

        // Adota registros criados fora do mapa que já carregam o clinicorp_id
        // (ex.: pacientes criados pela sincronização da agenda) — senão o INSERT
        // bate no índice único de clinicorp_id.
        if (cols.clinicorp_id) {
            var orfaos = origens.filter(function (o) { return destinoDe[o] == null })
            if (orfaos.length) {
                var marks2 = orfaos.map(function () { return '?' }).join(',')
                var ad = await client.execute({ sql: "SELECT id, clinicorp_id FROM " + tabela + " WHERE clinica_id=? AND clinicorp_id IN (" + marks2 + ")", args: [clinica_id].concat(orfaos) })
                var adota = []
                for (var a2 = 0; a2 < ad.rows.length; a2++) {
                    var cidAd = String(ad.rows[a2].clinicorp_id)
                    if (destinoDe[cidAd] != null) continue
                    destinoDe[cidAd] = Number(ad.rows[a2].id)
                    adota.push({ sql: "INSERT OR REPLACE INTO clinicorp_import_map (entidade, origem, destino, clinica_id, importado_em) VALUES (?,?,?,?,?)", args: [entidade, cidAd, Number(ad.rows[a2].id), clinica_id, agora] })
                }
                if (adota.length) await client.batch(adota, 'write')
            }
        }

        // Mapa apontando para linha que não existe mais vira INSERT de novo
        var chk = Object.keys(destinoDe)
        if (chk.length) {
            var vivos = {}
            for (var c3 = 0; c3 < chk.length; c3 += 200) {
                var fat = chk.slice(c3, c3 + 200)
                var vr = await client.execute({ sql: "SELECT id FROM " + tabela + " WHERE clinica_id=? AND id IN (" + fat.map(function () { return '?' }).join(',') + ")", args: [clinica_id].concat(fat.map(function (o) { return destinoDe[o] })) })
                for (var v2 = 0; v2 < vr.rows.length; v2++) vivos[Number(vr.rows[v2].id)] = 1
            }
            for (var c4 = 0; c4 < chk.length; c4++) if (!vivos[destinoDe[chk[c4]]]) delete destinoDe[chk[c4]]
        }
        var updates = [], inserts = []
        for (var ri = 0; ri < regs.length; ri++) {
            var r3 = regs[ri]
            var origem = String(r3.origem || '')
            var dados = r3.dados || {}
            var ks = Object.keys(dados).filter(function (k) { return cols[k] })
            if (!origem || !ks.length) continue
            var vals = ks.map(function (k) { var v = dados[k]; return v === undefined ? null : v })
            if (destinoDe[origem] != null) {
                if (b.somente_inserir) continue
                updates.push({ sql: "UPDATE " + tabela + " SET " + ks.map(function (k) { return k + "=?" }).join(',') + " WHERE id=? AND clinica_id=?", args: vals.concat([destinoDe[origem], clinica_id]) })
            } else {
                inserts.push({ origem: origem, sql: "INSERT INTO " + tabela + " (" + ks.join(',') + ",clinica_id) VALUES (" + ks.map(function () { return '?' }).join(',') + ",?)", args: vals.concat([clinica_id]) })
            }
        }

        var atualizados = 0, inseridos = 0
        if (updates.length) {
            var ru = await client.batch(updates.map(function (u) { return { sql: u.sql, args: u.args } }), 'write')
            atualizados = ru.length
        }
        if (inserts.length) {
            var rins = await client.batch(inserts.map(function (u) { return { sql: u.sql, args: u.args } }), 'write')
            var mapIns = []
            for (var mi = 0; mi < inserts.length; mi++) {
                var novoId = Number(rins[mi].lastInsertRowid)
                destinoDe[inserts[mi].origem] = novoId
                mapIns.push({ sql: "INSERT OR REPLACE INTO clinicorp_import_map (entidade, origem, destino, clinica_id, importado_em) VALUES (?,?,?,?,?)", args: [entidade, inserts[mi].origem, novoId, clinica_id, agora] })
            }
            if (mapIns.length) await client.batch(mapIns, 'write')
            inseridos = inserts.length
        }
        return json(200, { success: true, inseridos: inseridos, atualizados: atualizados, mapa: destinoDe })
    }

    // Atualiza campos de convênio/execução de itens de orçamento pelo id.
    // { itens: [{ id, dados: { convenio_status, convenio_valor_recebido, ... } }] }
    if (acao === 'atualizar-itens') {
        var itsA = Array.isArray(b.itens) ? b.itens : []
        if (itsA.length > 400) return json(400, { success: false, error: 'Máximo de 400 itens por chamada' })
        var PODE = { convenio_status: 1, convenio_valor_recebido: 1, convenio_recebido_em: 1, convenio_obs: 1, guia: 1, executado: 1, data_execucao: 1 }
        var stA = []
        for (var ai = 0; ai < itsA.length; ai++) {
            var itA = itsA[ai]
            var idA = parseInt(itA.id) || 0
            var ksA = Object.keys(itA.dados || {}).filter(function (k) { return PODE[k] })
            if (!idA || !ksA.length) continue
            stA.push({ sql: "UPDATE orcamento_itens SET " + ksA.map(function (k) { return k + "=?" }).join(',') + " WHERE id=? AND clinica_id=?", args: ksA.map(function (k) { return itA.dados[k] === undefined ? null : itA.dados[k] }).concat([idA, clinica_id]) })
        }
        var afet = 0
        if (stA.length) {
            var rA = await client.batch(stA, 'write')
            for (var ra = 0; ra < rA.length; ra++) afet += Number(rA[ra].rowsAffected) || 0
        }
        return json(200, { success: true, atualizados: afet })
    }

    // Substitui os itens de orçamentos cujo conteúdo mudou no Clinicorp.
    // { grupos: [{ destino: <id klinov>, origem: <BudgetId>, itens: [dados] }] }
    if (acao === 'substituir-itens') {
        var grupos = Array.isArray(b.grupos) ? b.grupos : []
        if (!grupos.length) return json(200, { success: true, orcamentos: 0, itens: 0 })
        if (grupos.length > 50) return json(400, { success: false, error: 'Máximo de 50 orçamentos por chamada' })
        await garantirMapa(client)
        var colsIt = await colunas(client, 'orcamento_itens')
        var nOrc = 0, nIt = 0
        for (var gi = 0; gi < grupos.length; gi++) {
            var g = grupos[gi]
            var destino = parseInt(g.destino) || 0
            if (!destino) continue
            var dono = await client.execute({ sql: "SELECT id FROM orcamentos WHERE id=? AND clinica_id=?", args: [destino, clinica_id] })
            if (!dono.rows.length) continue
            var stmts = [{ sql: "DELETE FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?", args: [destino, clinica_id] }]
            if (g.origem) stmts.push({ sql: "DELETE FROM clinicorp_import_map WHERE clinica_id=? AND entidade='orcamento_item' AND (origem=? OR origem LIKE ?)", args: [clinica_id, String(g.origem), String(g.origem) + ':%'] })
            var its = Array.isArray(g.itens) ? g.itens : []
            for (var ii = 0; ii < its.length; ii++) {
                var dd = its[ii] && its[ii].dados ? its[ii].dados : its[ii]
                var ks2 = Object.keys(dd || {}).filter(function (k) { return colsIt[k] && k !== 'orcamento_id' })
                if (!ks2.length) continue
                stmts.push({ sql: "INSERT INTO orcamento_itens (orcamento_id," + ks2.join(',') + ",clinica_id) VALUES (?," + ks2.map(function () { return '?' }).join(',') + ",?)", args: [destino].concat(ks2.map(function (k) { return dd[k] === undefined ? null : dd[k] })).concat([clinica_id]) })
                nIt++
            }
            await client.batch(stmts, 'write')
            nOrc++
        }
        return json(200, { success: true, orcamentos: nOrc, itens: nIt })
    }

    return json(400, { success: false, error: 'Ação inválida' })
}

module.exports = { handle }
