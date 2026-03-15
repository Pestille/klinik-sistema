// api/pacientes.js — Pacientes com filtros completos
// USO: /api/pacientes?busca=silva
//      /api/pacientes?status=ativos (ativos = visita nos ultimos 180 dias)
//      /api/pacientes?status=inativos
//      /api/pacientes?page=1&limit=50
//      /api/pacientes?id=42 (detalhe de um paciente)
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}

        // Detalhe de um paciente
        if (q.id) {
            var pac = await client.execute({ sql: 'SELECT * FROM pacientes WHERE id = ?', args: [parseInt(q.id)] })
            if (pac.rows.length === 0) { res.status(404).json({ success: false, error: 'Paciente nao encontrado' }); return }

            // Agendamentos do paciente
            var ags = await client.execute({
                sql: "SELECT a.id, a.data_hora, a.tipo as categoria, a.status, a.procedimento, pr.nome as profissional FROM agendamentos a LEFT JOIN profissionais pr ON a.profissional_id = pr.id WHERE a.paciente_id = ? ORDER BY a.data_hora DESC LIMIT 50",
                args: [parseInt(q.id)]
            })

            // Financeiro do paciente
            var fin = await client.execute({
                sql: "SELECT * FROM financeiro WHERE paciente_id = ? ORDER BY data_pagamento DESC LIMIT 20",
                args: [parseInt(q.id)]
            })

            res.status(200).json({
                success: true,
                paciente: pac.rows[0],
                agendamentos: ags.rows,
                financeiro: fin.rows
            })
            return
        }

        var page = parseInt(q.page) || 1
        var limit = Math.min(parseInt(q.limit) || 50, 200)
        var offset = (page - 1) * limit

        // Base: pacientes com última visita
        var baseSql
        var countSql
        var args = []
        var countArgs = []

        if (q.status === 'inativos') {
            // Inativos: sem visita nos ultimos 180 dias
            baseSql = "SELECT p.id, p.nome, p.telefone, p.email, p.clinicorp_id, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING ultima_visita < date('now', '-180 days') OR ultima_visita IS NULL"
            countSql = "SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING MAX(a.data_hora) < date('now', '-180 days') OR MAX(a.data_hora) IS NULL)"

            if (q.busca) {
                baseSql = "SELECT p.id, p.nome, p.telefone, p.email, p.clinicorp_id, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id WHERE p.nome LIKE ? GROUP BY p.id HAVING ultima_visita < date('now', '-180 days') OR ultima_visita IS NULL"
                countSql = "SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id WHERE p.nome LIKE ? GROUP BY p.id HAVING MAX(a.data_hora) < date('now', '-180 days') OR MAX(a.data_hora) IS NULL)"
                args.push('%' + q.busca + '%')
                countArgs.push('%' + q.busca + '%')
            }

            baseSql += " ORDER BY ultima_visita ASC LIMIT ? OFFSET ?"
            args.push(limit)
            args.push(offset)

        } else if (q.status === 'ativos') {
            baseSql = "SELECT p.id, p.nome, p.telefone, p.email, p.clinicorp_id, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id"
            countSql = "SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id"

            if (q.busca) {
                baseSql += " WHERE p.nome LIKE ?"
                countSql += " WHERE p.nome LIKE ?"
                args.push('%' + q.busca + '%')
                countArgs.push('%' + q.busca + '%')
            }

            baseSql += " GROUP BY p.id HAVING ultima_visita >= date('now', '-180 days') ORDER BY ultima_visita DESC LIMIT ? OFFSET ?"
            countSql += " GROUP BY p.id HAVING MAX(a.data_hora) >= date('now', '-180 days'))"
            args.push(limit)
            args.push(offset)

        } else {
            // Todos
            baseSql = "SELECT p.id, p.nome, p.telefone, p.email, p.clinicorp_id, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id"
            countSql = "SELECT COUNT(*) as total FROM pacientes p"

            if (q.busca) {
                baseSql += " WHERE p.nome LIKE ?"
                countSql += " WHERE p.nome LIKE ?"
                args.push('%' + q.busca + '%')
                countArgs.push('%' + q.busca + '%')
            }

            baseSql += " GROUP BY p.id ORDER BY p.nome ASC LIMIT ? OFFSET ?"
            args.push(limit)
            args.push(offset)
        }

        var result = await client.execute({ sql: baseSql, args: args })
        var countResult = await client.execute({ sql: countSql, args: countArgs })
        var total = countResult.rows[0].total

        // Contagens gerais
        var totalPac = await client.execute('SELECT COUNT(*) as total FROM pacientes')
        var totalInativos = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING MAX(a.data_hora) < date('now', '-180 days') OR MAX(a.data_hora) IS NULL)")

        res.status(200).json({
            success: true,
            data: result.rows,
            paginacao: {
                page: page,
                limit: limit,
                total: total,
                totalPages: Math.ceil(total / limit)
            },
            resumo: {
                total_pacientes: totalPac.rows[0].total,
                total_inativos: totalInativos.rows[0].total,
                total_ativos: totalPac.rows[0].total - totalInativos.rows[0].total
            }
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
