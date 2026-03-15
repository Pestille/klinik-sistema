// api/dashboard.js — Dashboard com dados do Turso
// Retorna resumo geral para o frontend
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var startTime = Date.now()

        // Contagens gerais
        var pacCount = await client.execute('SELECT COUNT(*) as total FROM pacientes')
        var profCount = await client.execute('SELECT COUNT(*) as total FROM profissionais')
        var agCount = await client.execute('SELECT COUNT(*) as total FROM agendamentos')
        var finCount = await client.execute('SELECT COUNT(*) as total FROM financeiro')

        // Receita total
        var receita = await client.execute('SELECT COALESCE(SUM(valor), 0) as total FROM financeiro WHERE tipo = ?', ['entrada'])

        // Agendamentos hoje
        var hoje = new Date().toISOString().slice(0, 10)
        var agHoje = await client.execute('SELECT COUNT(*) as total FROM agendamentos WHERE data_hora LIKE ?', [hoje + '%'])

        // Agendamentos por mes (ultimos 6 meses)
        var porMes = await client.execute("SELECT substr(data_hora, 1, 7) as mes, COUNT(*) as total FROM agendamentos WHERE data_hora >= date('now', '-6 months') GROUP BY mes ORDER BY mes")

        // Agendamentos por categoria
        var porCategoria = await client.execute('SELECT tipo as categoria, COUNT(*) as total FROM agendamentos WHERE tipo IS NOT NULL AND tipo != ? GROUP BY tipo ORDER BY total DESC LIMIT 10', [''])

        // Pacientes inativos (sem agendamento nos ultimos 180 dias)
        var inativos = await client.execute("SELECT p.id, p.nome, p.telefone, MAX(a.data_hora) as ultima_visita FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING ultima_visita < date('now', '-180 days') OR ultima_visita IS NULL ORDER BY ultima_visita ASC LIMIT 100")

        // Profissionais com agendamentos
        var profsAg = await client.execute('SELECT pr.id, pr.nome, pr.especialidade, COUNT(a.id) as total_agendamentos FROM profissionais pr LEFT JOIN agendamentos a ON pr.id = a.profissional_id GROUP BY pr.id ORDER BY total_agendamentos DESC')

        // Agendamentos recentes (proximos 7 dias)
        var proximos = await client.execute("SELECT a.id, a.data_hora, a.tipo, a.status, a.procedimento as paciente_nome, pr.nome as profissional_nome FROM agendamentos a LEFT JOIN profissionais pr ON a.profissional_id = pr.id WHERE a.data_hora >= date('now') AND a.data_hora <= date('now', '+7 days') ORDER BY a.data_hora LIMIT 30")

        // Ultimo sync
        var lastSync = await client.execute('SELECT tabela, operacao, registros_processados, finalizado_em FROM sync_log ORDER BY id DESC LIMIT 5')

        var duracao = Date.now() - startTime

        res.status(200).json({
            success: true,
            resumo: {
                total_pacientes: pacCount.rows[0].total,
                total_profissionais: profCount.rows[0].total,
                total_agendamentos: agCount.rows[0].total,
                total_financeiro: finCount.rows[0].total,
                receita_total: receita.rows[0].total,
                agendamentos_hoje: agHoje.rows[0].total
            },
            agendamentos_por_mes: porMes.rows,
            agendamentos_por_categoria: porCategoria.rows,
            inativos: inativos.rows,
            profissionais: profsAg.rows,
            proximos_agendamentos: proximos.rows,
            ultimos_syncs: lastSync.rows,
            ms: duracao
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
