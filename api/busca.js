// api/busca.js — Busca global
// USO: /api/busca?q=carlos
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = (req.query || {}).q || ''

        if (!q || q.length < 2) {
            res.status(400).json({ success: false, error: 'Busca precisa de pelo menos 2 caracteres' })
            return
        }

        var termo = '%' + q + '%'

        // Pacientes
        var pacientes = await client.execute({
            sql: "SELECT id, nome, telefone, email FROM pacientes WHERE nome LIKE ? OR telefone LIKE ? OR email LIKE ? LIMIT 10",
            args: [termo, termo, termo]
        })

        // Agendamentos (busca no nome do paciente armazenado em procedimento)
        var agendamentos = await client.execute({
            sql: "SELECT a.id, a.data_hora, a.tipo as categoria, a.procedimento as paciente_nome, pr.nome as profissional FROM agendamentos a LEFT JOIN profissionais pr ON a.profissional_id = pr.id WHERE a.procedimento LIKE ? ORDER BY a.data_hora DESC LIMIT 10",
            args: [termo]
        })

        // Profissionais
        var profissionais = await client.execute({
            sql: "SELECT id, nome, especialidade FROM profissionais WHERE nome LIKE ? LIMIT 5",
            args: [termo]
        })

        res.status(200).json({
            success: true,
            busca: q,
            pacientes: pacientes.rows,
            agendamentos: agendamentos.rows,
            profissionais: profissionais.rows,
            total: pacientes.rows.length + agendamentos.rows.length + profissionais.rows.length
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
