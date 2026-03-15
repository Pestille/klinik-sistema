// api/db-status.js — Health check do banco de dados
// Retorna status da conexão e contagem de registros por tabela
// USO: GET /api/db-status

const { getClient } = require('./db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const client = getClient();
        const start = Date.now();

        // Teste de conexão
        await client.execute('SELECT 1');
        const latency = Date.now() - start;

        // Listar tabelas
        const tablesResult = await client.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        );

        // Contagem por tabela
        const counts = {};
        for (const row of tablesResult.rows) {
            try {
                const countResult = await client.execute(`SELECT COUNT(*) as total FROM ${row.name}`);
                counts[row.name] = countResult.rows[0].total;
            } catch {
                counts[row.name] = 'erro';
            }
        }

        // Último sync
        let lastSync = null;
        try {
            const syncResult = await client.execute(
                'SELECT tabela, operacao, registros_processados, finalizado_em FROM sync_log ORDER BY id DESC LIMIT 1'
            );
            if (syncResult.rows.length > 0) {
                lastSync = syncResult.rows[0];
            }
        } catch {
            // tabela sync_log pode não existir ainda
        }

        return res.status(200).json({
            status: 'online',
            banco: 'Turso (libSQL)',
            latencia_ms: latency,
            tabelas: counts,
            total_tabelas: tablesResult.rows.length,
            ultimo_sync: lastSync,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        return res.status(500).json({
            status: 'offline',
            error: error.message,
            hint: 'Verifique TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no Vercel',
            timestamp: new Date().toISOString()
        });
    }
};
