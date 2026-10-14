// api/db.js — Conexão com Turso (libSQL)
// Klinik Sistema — Campo Grande, MS

const { createClient } = require('@libsql/client');

let _client = null;

function getClient() {
    if (!_client) {
        const url = process.env.TURSO_DATABASE_URL;
        const authToken = process.env.TURSO_AUTH_TOKEN;
        if (!url || !authToken) {
            throw new Error(
                'Variáveis TURSO_DATABASE_URL e TURSO_AUTH_TOKEN não configuradas. ' +
                'Configure no Vercel: Settings > Environment Variables'
            );
        }
        _client = createClient({ url, authToken });
    }
    return _client;
}

async function query(sql, args) {
    const client = getClient();
    try {
        const result = await client.execute({ sql: sql, args: args || [] });
        return {
            success: true,
            rows: result.rows,
            rowsAffected: result.rowsAffected,
            lastInsertRowid: result.lastInsertRowid
        };
    } catch (error) {
        console.error('Erro na query:', error.message);
        return {
            success: false,
            rows: [],
            error: error.message,
            sql: sql.substring(0, 100)
        };
    }
}

async function batch(statements) {
    const client = getClient();
    try {
        const results = await client.batch(statements, 'write');
        return { success: true, results };
    } catch (error) {
        console.error('Erro no batch:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = { getClient, query, batch };
