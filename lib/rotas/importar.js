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

    return json(400, { success: false, error: 'Ação inválida' })
}

module.exports = { handle }
