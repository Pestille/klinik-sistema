// api/sync-pacientes.js — Sincronizar pacientes da API Clinicorp → Turso
// Klinik Sistema — Campo Grande, MS
// USO: GET /api/sync-pacientes

const { getClient } = require('./db');

const CLINICORP_BASE = 'https://report-api.clinicorp.com';
const CLINICORP_AUTH = 'Basic a2xpbmlrOjIzYjczZGQwLWYzYTktNGFlZi05N2ZmLTlkYjU2N2QyODNiNQ==';
const BUSINESS_ID = '5073030694043648';

async function fetchPacientesClinicorp(page = 1, pageSize = 100) {
    const url = `${CLINICORP_BASE}/reports/customers` +
        `?businessId=${BUSINESS_ID}` +
        `&page=${page}` +
        `&pageSize=${pageSize}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': CLINICORP_AUTH,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Clinicorp API erro ${response.status}: ${text}`);
    }

    return response.json();
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const startTime = Date.now();
    let totalProcessados = 0;
    let totalInseridos = 0;
    let totalAtualizados = 0;
    let totalErros = 0;
    let page = 1;
    let hasMore = true;

    try {
        const client = getClient();

        while (hasMore) {
            // Buscar página de pacientes da Clinicorp
            const data = await fetchPacientesClinicorp(page);

            // A API pode retornar em diferentes formatos
            // Tentar extrair a lista de pacientes
            let pacientes = [];
            if (Array.isArray(data)) {
                pacientes = data;
            } else if (data.data && Array.isArray(data.data)) {
                pacientes = data.data;
            } else if (data.customers && Array.isArray(data.customers)) {
                pacientes = data.customers;
            } else if (data.content && Array.isArray(data.content)) {
                pacientes = data.content;
            } else if (data.results && Array.isArray(data.results)) {
                pacientes = data.results;
            }

            if (pacientes.length === 0) {
                hasMore = false;
                break;
            }

            // Inserir/atualizar cada paciente no banco
            for (const p of pacientes) {
                try {
                    // Mapear campos da Clinicorp para nosso schema
                    const clinicorpId = String(p.id || p.customerId || p.customer_id || '');
                    const nome = p.name || p.nome || p.customerName || p.customer_name || '';
                    const cpf = p.cpf || p.document || p.documentNumber || '';
                    const telefone = p.phone || p.telefone || p.mobilePhone || p.cellphone || '';
                    const email = p.email || p.emailAddress || '';
                    const dataNascimento = p.birthDate || p.birth_date || p.dataNascimento || '';
                    const genero = p.gender || p.genero || p.sex || '';

                    if (!clinicorpId || !nome) {
                        totalErros++;
                        continue;
                    }

                    // UPSERT: inserir ou atualizar se já existe
                    await client.execute({
                        sql: `INSERT INTO pacientes (clinicorp_id, nome, cpf, telefone, email, data_nascimento, genero, sincronizado_em)
                              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                              ON CONFLICT(clinicorp_id) DO UPDATE SET
                                nome = excluded.nome,
                                cpf = excluded.cpf,
                                telefone = excluded.telefone,
                                email = excluded.email,
                                data_nascimento = excluded.data_nascimento,
                                genero = excluded.genero,
                                atualizado_em = datetime('now'),
                                sincronizado_em = datetime('now')`,
                        args: [clinicorpId, nome, cpf, telefone, email, dataNascimento, genero]
                    });

                    totalProcessados++;
                    // Simplificação: contamos tudo como processado
                } catch (err) {
                    totalErros++;
                    console.error(`Erro paciente ${p.id || 'unknown'}:`, err.message);
                }
            }

            // Verificar se há mais páginas
            const totalPages = data.totalPages || data.total_pages || data.pages || 0;
            if (page >= totalPages || pacientes.length < 100) {
                hasMore = false;
            } else {
                page++;
            }
        }

        // Registrar no sync_log
        const duracao = Date.now() - startTime;
        await client.execute({
            sql: `INSERT INTO sync_log (tabela, operacao, registros_processados, registros_erros, detalhes, finalizado_em)
                  VALUES ('pacientes', 'sync_clinicorp', ?, ?, ?, datetime('now'))`,
            args: [
                totalProcessados,
                totalErros,
                JSON.stringify({
                    paginas_processadas: page,
                    duracao_ms: duracao
                })
            ]
        });

        // Contar total no banco
        const countResult = await client.execute('SELECT COUNT(*) as total FROM pacientes');
        const totalNoBanco = countResult.rows[0].total;

        return res.status(200).json({
            success: true,
            message: `Sincronização concluída em ${duracao}ms`,
            registros_processados: totalProcessados,
            erros: totalErros,
            paginas: page,
            total_pacientes_no_banco: totalNoBanco,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        // Registrar erro no sync_log
        try {
            const client = getClient();
            await client.execute({
                sql: `INSERT INTO sync_log (tabela, operacao, registros_erros, detalhes, finalizado_em)
                      VALUES ('pacientes', 'sync_clinicorp_erro', 1, ?, datetime('now'))`,
                args: [JSON.stringify({ error: error.message })]
            });
        } catch { }

        return res.status(500).json({
            success: false,
            error: error.message,
            registros_processados: totalProcessados,
            erros: totalErros,
            timestamp: new Date().toISOString()
        });
    }
};
