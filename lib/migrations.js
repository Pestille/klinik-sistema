// lib/migrations.js — Migrations versionadas do banco (Turso/libSQL)
// Klinov — Campo Grande, MS
//
// Cada migration roda uma única vez por banco e fica registrada em
// schema_migrations. Para mudar o schema, ADICIONE uma nova entrada no fim da
// lista (nunca edite uma já aplicada). Os statements devem ser idempotentes
// (CREATE ... IF NOT EXISTS); ALTER TABLE ADD COLUMN repetido é tolerado.

var MIGRATIONS = [
    {
        id: '2026-10-14-001-lixeira',
        up: [
            "CREATE TABLE IF NOT EXISTS lixeira (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, tipo TEXT NOT NULL, tabela TEXT NOT NULL, registro_id INTEGER NOT NULL, descricao TEXT, dados_json TEXT NOT NULL, filhos_json TEXT, excluido_por INTEGER, excluido_por_nome TEXT, excluido_em TEXT DEFAULT (datetime('now')), restaurado_em TEXT)",
            "CREATE INDEX IF NOT EXISTS idx_lixeira_clinica ON lixeira(clinica_id, restaurado_em, excluido_em)"
        ]
    },
    {
        id: '2026-10-14-002-usuarios-token-redefinir',
        up: [
            "ALTER TABLE usuarios ADD COLUMN token_redefinir TEXT",
            "ALTER TABLE usuarios ADD COLUMN token_redefinir_expira TEXT"
        ]
    }
]

function isAlreadyApplied(e) {
    return /duplicate column|already exists/i.test((e && e.message) || '')
}

async function runMigrations(client) {
    if (global._klinovMigrated) return
    await client.execute("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, aplicada_em TEXT DEFAULT (datetime('now')))")
    var done = await client.execute("SELECT id FROM schema_migrations")
    var applied = {}
    done.rows.forEach(function(r) { applied[r.id] = true })

    for (var i = 0; i < MIGRATIONS.length; i++) {
        var m = MIGRATIONS[i]
        if (applied[m.id]) continue
        for (var j = 0; j < m.up.length; j++) {
            try { await client.execute(m.up[j]) }
            catch (e) { if (!isAlreadyApplied(e)) throw new Error('Migration ' + m.id + ' falhou: ' + e.message) }
        }
        await client.execute({ sql: "INSERT OR IGNORE INTO schema_migrations(id) VALUES(?)", args: [m.id] })
    }
    global._klinovMigrated = true
}

module.exports = { runMigrations, MIGRATIONS }
