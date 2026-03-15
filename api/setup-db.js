// api/setup-db.js — Setup automático do banco de dados
// Executa o schema e cria todas as tabelas no Turso
// USO: GET /api/setup-db?key=SETUP_SECRET_KEY
// SEGURANÇA: Protegido por chave secreta para evitar execução não-autorizada

const { getClient } = require('./db');

// Schema completo inline (para não depender de leitura de arquivo no serverless)
const SCHEMA_STATEMENTS = [
    // Tabela de pacientes
    `CREATE TABLE IF NOT EXISTS pacientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clinicorp_id TEXT UNIQUE,
        nome TEXT NOT NULL,
        cpf TEXT,
        telefone TEXT,
        email TEXT,
        data_nascimento TEXT,
        genero TEXT,
        endereco TEXT,
        cidade TEXT,
        estado TEXT,
        cep TEXT,
        convenio TEXT,
        observacoes TEXT,
        ativo INTEGER DEFAULT 1,
        criado_em TEXT DEFAULT (datetime('now')),
        atualizado_em TEXT DEFAULT (datetime('now')),
        sincronizado_em TEXT
    )`,

    // Tabela de profissionais
    `CREATE TABLE IF NOT EXISTS profissionais (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clinicorp_id TEXT UNIQUE,
        nome TEXT NOT NULL,
        cro TEXT,
        especialidade TEXT,
        telefone TEXT,
        email TEXT,
        ativo INTEGER DEFAULT 1,
        criado_em TEXT DEFAULT (datetime('now')),
        atualizado_em TEXT DEFAULT (datetime('now'))
    )`,

    // Tabela de agendamentos
    `CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clinicorp_id TEXT UNIQUE,
        paciente_id INTEGER,
        profissional_id INTEGER,
        data_hora TEXT NOT NULL,
        duracao_minutos INTEGER DEFAULT 30,
        tipo TEXT,
        status TEXT DEFAULT 'agendado',
        procedimento TEXT,
        valor REAL,
        observacoes TEXT,
        criado_em TEXT DEFAULT (datetime('now')),
        atualizado_em TEXT DEFAULT (datetime('now')),
        sincronizado_em TEXT,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
        FOREIGN KEY (profissional_id) REFERENCES profissionais(id)
    )`,

    // Tabela de tratamentos
    `CREATE TABLE IF NOT EXISTS tratamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clinicorp_id TEXT UNIQUE,
        paciente_id INTEGER,
        profissional_id INTEGER,
        descricao TEXT,
        procedimentos TEXT,
        valor_total REAL,
        valor_pago REAL DEFAULT 0,
        status TEXT DEFAULT 'pendente',
        data_inicio TEXT,
        data_previsao TEXT,
        criado_em TEXT DEFAULT (datetime('now')),
        atualizado_em TEXT DEFAULT (datetime('now')),
        sincronizado_em TEXT,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
        FOREIGN KEY (profissional_id) REFERENCES profissionais(id)
    )`,

    // Tabela financeiro
    `CREATE TABLE IF NOT EXISTS financeiro (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clinicorp_id TEXT UNIQUE,
        paciente_id INTEGER,
        tratamento_id INTEGER,
        tipo TEXT NOT NULL,
        descricao TEXT,
        valor REAL NOT NULL,
        data_vencimento TEXT,
        data_pagamento TEXT,
        forma_pagamento TEXT,
        status TEXT DEFAULT 'pendente',
        criado_em TEXT DEFAULT (datetime('now')),
        atualizado_em TEXT DEFAULT (datetime('now')),
        sincronizado_em TEXT,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
        FOREIGN KEY (tratamento_id) REFERENCES tratamentos(id)
    )`,

    // Tabela de log de sincronização
    `CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tabela TEXT NOT NULL,
        operacao TEXT NOT NULL,
        registros_processados INTEGER DEFAULT 0,
        registros_erros INTEGER DEFAULT 0,
        detalhes TEXT,
        iniciado_em TEXT DEFAULT (datetime('now')),
        finalizado_em TEXT
    )`,

    // Índices
    `CREATE INDEX IF NOT EXISTS idx_pacientes_clinicorp ON pacientes(clinicorp_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pacientes_cpf ON pacientes(cpf)`,
    `CREATE INDEX IF NOT EXISTS idx_pacientes_nome ON pacientes(nome)`,
    `CREATE INDEX IF NOT EXISTS idx_agendamentos_data ON agendamentos(data_hora)`,
    `CREATE INDEX IF NOT EXISTS idx_agendamentos_paciente ON agendamentos(paciente_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agendamentos_profissional ON agendamentos(profissional_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agendamentos_status ON agendamentos(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tratamentos_paciente ON tratamentos(paciente_id)`,
    `CREATE INDEX IF NOT EXISTS idx_financeiro_paciente ON financeiro(paciente_id)`,
    `CREATE INDEX IF NOT EXISTS idx_financeiro_status ON financeiro(status)`,
    `CREATE INDEX IF NOT EXISTS idx_financeiro_vencimento ON financeiro(data_vencimento)`
];

module.exports = async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Proteção por chave secreta
    const { key } = req.query || {};
    const setupKey = process.env.SETUP_SECRET_KEY;

    if (!setupKey) {
        return res.status(500).json({
            success: false,
            error: 'SETUP_SECRET_KEY não configurada nas variáveis de ambiente do Vercel'
        });
    }

    if (key !== setupKey) {
        return res.status(403).json({
            success: false,
            error: 'Chave de setup inválida. Use: /api/setup-db?key=SUA_CHAVE'
        });
    }

    // Executar schema
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    try {
        const client = getClient();

        for (const sql of SCHEMA_STATEMENTS) {
            try {
                await client.execute(sql);
                const name = sql.match(/(?:CREATE TABLE|CREATE INDEX).*?(?:IF NOT EXISTS\s+)?(\w+)/i);
                results.push({
                    status: 'ok',
                    object: name ? name[1] : 'unknown'
                });
                successCount++;
            } catch (err) {
                results.push({
                    status: 'erro',
                    sql: sql.substring(0, 60) + '...',
                    error: err.message
                });
                errorCount++;
            }
        }

        // Verificar tabelas criadas
        const tables = await client.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        );

        return res.status(200).json({
            success: true,
            message: `Setup concluído: ${successCount} operações OK, ${errorCount} erros`,
            tabelas_no_banco: tables.rows.map(r => r.name),
            detalhes: results,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            hint: 'Verifique se TURSO_DATABASE_URL e TURSO_AUTH_TOKEN estão configurados no Vercel'
        });
    }
};
