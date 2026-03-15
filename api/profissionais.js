// api/profissionais.js — Lista profissionais com estatísticas
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}

        if (q.id) {
            var prof = await client.execute({ sql: 'SELECT * FROM profissionais WHERE id = ?', args: [parseInt(q.id)] })
            if (prof.rows.length === 0) { res.status(404).json({ success: false, error: 'Profissional nao encontrado' }); return }

            var ags = await client.execute({
                sql: "SELECT data_hora, tipo as categoria, status, procedimento as paciente_nome FROM agendamentos WHERE profissional_id = ? ORDER BY data_hora DESC LIMIT 50",
                args: [parseInt(q.id)]
            })

            var porMes = await client.execute({
                sql: "SELECT substr(data_hora, 1, 7) as mes, COUNT(*) as total FROM agendamentos WHERE profissional_id = ? GROUP BY mes ORDER BY mes DESC LIMIT 6",
                args: [parseInt(q.id)]
            })

            res.status(200).json({
                success: true,
                profissional: prof.rows[0],
                agendamentos_recentes: ags.rows,
                por_mes: porMes.rows
            })
            return
        }

        var result = await client.execute("SELECT pr.id, pr.nome, pr.clinicorp_id, pr.cro, pr.especialidade, pr.ativo, COUNT(a.id) as total_agendamentos, COUNT(CASE WHEN a.data_hora >= date('now', '-30 days') THEN 1 END) as agendamentos_mes FROM profissionais pr LEFT JOIN agendamentos a ON pr.id = a.profissional_id GROUP BY pr.id ORDER BY total_agendamentos DESC")

        res.status(200).json({
            success: true,
            data: result.rows,
            total: result.rows.length
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
