// api/relatorios.js — Relatórios com filtros
// USO: /api/relatorios?tipo=producao&mes=2026-03
//      /api/relatorios?tipo=procedimentos&de=2026-01-01&ate=2026-03-15
//      /api/relatorios?tipo=profissionais&mes=2026-03
//      /api/relatorios?tipo=inativos
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}
        var tipo = q.tipo || 'producao'

        if (tipo === 'producao') {
            // Produção mensal
            var meses = parseInt(q.meses) || 6
            var producao = await client.execute({
                sql: "SELECT substr(data_hora, 1, 7) as mes, COUNT(*) as agendamentos, COUNT(DISTINCT procedimento) as pacientes_unicos FROM agendamentos WHERE data_hora >= date('now', '-' || ? || ' months') GROUP BY mes ORDER BY mes",
                args: [meses]
            })

            var receita = await client.execute({
                sql: "SELECT substr(data_pagamento, 1, 7) as mes, SUM(valor) as receita, COUNT(*) as recebimentos FROM financeiro WHERE data_pagamento >= date('now', '-' || ? || ' months') GROUP BY mes ORDER BY mes",
                args: [meses]
            })

            var totalAg = await client.execute('SELECT COUNT(*) as total FROM agendamentos')
            var totalRec = await client.execute('SELECT COALESCE(SUM(valor), 0) as total FROM financeiro')

            res.status(200).json({
                success: true,
                tipo: 'producao',
                producao_mensal: producao.rows,
                receita_mensal: receita.rows,
                totais: {
                    agendamentos: totalAg.rows[0].total,
                    receita: totalRec.rows[0].total
                }
            })

        } else if (tipo === 'procedimentos') {
            var procedimentos = await client.execute("SELECT tipo as categoria, COUNT(*) as total, ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM agendamentos WHERE tipo IS NOT NULL AND tipo != ''), 1) as percentual FROM agendamentos WHERE tipo IS NOT NULL AND tipo != '' GROUP BY tipo ORDER BY total DESC LIMIT 15")

            res.status(200).json({
                success: true,
                tipo: 'procedimentos',
                data: procedimentos.rows
            })

        } else if (tipo === 'profissionais') {
            var mes = q.mes || new Date().toISOString().slice(0, 7)
            var profs = await client.execute({
                sql: "SELECT pr.id, pr.nome, COUNT(a.id) as agendamentos, COUNT(DISTINCT a.procedimento) as pacientes FROM profissionais pr LEFT JOIN agendamentos a ON pr.id = a.profissional_id AND a.data_hora LIKE ? GROUP BY pr.id ORDER BY agendamentos DESC",
                args: [mes + '%']
            })

            res.status(200).json({
                success: true,
                tipo: 'profissionais',
                mes: mes,
                data: profs.rows
            })

        } else if (tipo === 'inativos') {
            var urgente = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 365 OR MAX(a.data_hora) IS NULL)")
            var alta = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 270 AND dias <= 365)")
            var media = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 180 AND dias <= 270)")

            res.status(200).json({
                success: true,
                tipo: 'inativos',
                urgente: urgente.rows[0].total,
                alta: alta.rows[0].total,
                media: media.rows[0].total,
                total: urgente.rows[0].total + alta.rows[0].total + media.rows[0].total
            })

        } else {
            res.status(400).json({ success: false, error: 'Tipo invalido. Use: producao, procedimentos, profissionais, inativos' })
        }

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
