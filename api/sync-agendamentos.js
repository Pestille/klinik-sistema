// api/sync-agendamentos.js — Sincronizar agendamentos da API Clinicorp → Turso
// Klinik Sistema — Campo Grande, MS
// USO: GET /api/sync-agendamentos?startDate=2026-03-01&endDate=2026-03-31

const { getClient } = require('./db');

const CLINICORP_BASE = 'https://report-api.clinicorp.com';
const CLINICORP_AUTH = 'Basic a2xpbmlrOjIzYjczZGQwLWYzYTktNGFlZi05N2ZmLTlkYjU2N2QyODNiNQ==';
const BUSINESS_ID = '5073030694043648';

async function fetchAgendamentosClinicorp(startDate, endDate, page = 1, pageSize = 100) {
    const url = `${CLINICORP_BASE}/reports/schedules` +
        `?businessId=${BUSINESS_ID}` +
        `&startDate=${startDate}` +
        `&endDate=${endDate}` +
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

    // Datas padrão: mês atual
    const now = new Date();
    const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const defaultEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    const startDate = req.query?.startDate || defaultStart;
    const endDate = req.query?.endDate || defaultEnd;

    const startTime = Date.now();
    let totalProcessados = 0;
    let totalErros = 0;
    let page = 1;
    let hasMore = true;

    try {
        const client = getClient();

        while (hasMore) {
            const data = await fetchAgendamentosClinicorp(startDate, endDate, page);

            // Extrair lista de agendamentos
            let agendamentos = [];
            if (Array.isArray(data)) {
                agendamentos = data;
            } else if (data.data && Array.isArray(data.data)) {
                agendamentos = data.data;
            } else if (data.schedules && Array.isArray(data.schedules)) {
                agendamentos = data.schedules;
            } else if (data.content && Array.isArray(data.content)) {
                agendamentos = data.content;
            } else if (data.results && Array.isArray(data.results)) {
                agendamentos = data.results;
            }

            if (agendamentos.length === 0) {
                hasMore = false;
                break;
            }

            for (const a of agendamentos) {
                try {
                    const clinicorpId = String(a.id || a.scheduleId || a.schedule_id || '');
                    const dataHora = a.date || a.dateTime || a.scheduleDate || a.start || '';
                    const duracao = a.duration || a.durationMinutes || a.duration_minutes || 30;
                    const tipo = a.type || a.scheduleType || a.appointmentType || '';
                    const status = a.status || a.scheduleStatus || 'agendado';
                    const procedimento = a.procedure || a.procedureName || a.treatment || a.description || '';
                    const valor = a.value || a.price || a.amount || 0;
                    const observacoes = a.notes || a.observation || a.obs || '';

                    // IDs do paciente e profissional na Clinicorp
                    const pacienteClinicorpId = String(a.customerId || a.customer_id || a.patientId || a.patient_id || '');
                    const profissionalClinicorpId = String(a.professionalId || a.professional_id || a.dentistId || a.doctorId || '');

                    if (!clinicorpId || !dataHora) {
                        totalErros++;
                        continue;
                    }

                    // Buscar IDs locais do paciente e profissional
                    let pacienteId = null;
                    let profissionalId = null;

                    if (pacienteClinicorpId) {
                        const pResult = await client.execute({
                            sql: 'SELECT id FROM pacientes WHERE clinicorp_id = ?',
                            args: [pacienteClinicorpId]
                        });
                        if (pResult.rows.length > 0) {
                            pacienteId = pResult.rows[0].id;
                        }
                    }

                    if (profissionalClinicorpId) {
                        const prResult = await client.execute({
                            sql: 'SELECT id FROM profissionais WHERE clinicorp_id = ?',
                            args: [profissionalClinicorpId]
                        });
                        if (prResult.rows.length > 0) {
                            profissionalId = prResult.rows[0].id;
                        }
                    }

                    // UPSERT
                    await client.execute({
                        sql: `INSERT INTO agendamentos (clinicorp_id, paciente_id, profissional_id, data_hora, duracao_minutos, tipo, status, procedimento, valor, observacoes, sincronizado_em)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                              ON CONFLICT(clinicorp_id) DO UPDATE SET
                                paciente_id = excluded.paciente_id,
                                profissional_id = excluded.profissional_id,
                                data_hora = excluded.data_hora,
                                duracao_minutos = excluded.duracao_minutos,
                                tipo = excluded.tipo,
                                status = excluded.status,
                                procedimento = excluded.procedimento,
                                valor = excluded.valor,
                                observacoes = excluded.observacoes,
                                atualizado_em = datetime('now'),
                                sincronizado_em = datetime('now')`,
                        args: [clinicorpId, pacienteId, profissionalId, dataHora, duracao, tipo, status, procedimento, valor, observacoes]
                    });

                    totalProcessados++;
                } catch (err) {
                    totalErros++;
                    console.error(`Erro agendamento ${a.id || 'unknown'}:`, err.message);
                }
            }

            // Paginação
            const totalPages = data.totalPages || data.total_pages || data.pages || 0;
            if (page >= totalPages || agendamentos.length < 100) {
                hasMore = false;
            } else {
                page++;
            }
        }

        // Registrar no sync_log
        const duracao = Date.now() - startTime;
        await client.execute({
            sql: `INSERT INTO sync_log (tabela, operacao, registros_processados, registros_erros, detalhes, finalizado_em)
                  VALUES ('agendamentos', 'sync_clinicorp', ?, ?, ?, datetime('now'))`,
            args: [
                totalProcessados,
                totalErros,
                JSON.stringify({
                    periodo: `${startDate} a ${endDate}`,
                    paginas: page,
                    duracao_ms: duracao
                })
            ]
        });

        // Contagem
        const countResult = await client.execute('SELECT COUNT(*) as total FROM agendamentos');
        const totalNoBanco = countResult.rows[0].total;

        return res.status(200).json({
            success: true,
            message: `Sincronização concluída em ${duracao}ms`,
            periodo: { startDate, endDate },
            registros_processados: totalProcessados,
            erros: totalErros,
            paginas: page,
            total_agendamentos_no_banco: totalNoBanco,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        try {
            const client = getClient();
            await client.execute({
                sql: `INSERT INTO sync_log (tabela, operacao, registros_erros, detalhes, finalizado_em)
                      VALUES ('agendamentos', 'sync_clinicorp_erro', 1, ?, datetime('now'))`,
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
