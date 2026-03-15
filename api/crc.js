// api/crc.js — CRC: pacientes inativos com prioridades
// USO: /api/crc?prioridade=urgente (urgente=+365d, alta=+270d, media=+180d)
//      /api/crc?busca=nome
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}

        var sql = "SELECT p.id, p.nome, p.telefone, p.email, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id"
        var having = " GROUP BY p.id HAVING ultima_visita < date('now', '-180 days') OR ultima_visita IS NULL"
        var args = []

        if (q.busca) {
            sql += " WHERE p.nome LIKE ?"
            args.push('%' + q.busca + '%')
        }

        sql += having

        // Filtro por prioridade
        if (q.prioridade === 'urgente') {
            sql += " AND dias_ausente > 365"
        } else if (q.prioridade === 'alta') {
            sql += " AND dias_ausente > 270 AND dias_ausente <= 365"
        } else if (q.prioridade === 'media') {
            sql += " AND dias_ausente > 180 AND dias_ausente <= 270"
        }

        sql += " ORDER BY dias_ausente DESC LIMIT 200"

        var result = await client.execute({ sql: sql, args: args })

        // Contagens por prioridade
        var urgente = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 365 OR MAX(a.data_hora) IS NULL)")
        var alta = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 270 AND dias <= 365)")
        var media = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING dias > 180 AND dias <= 270)")

        // Classificar cada paciente
        var data = result.rows.map(function(p) {
            var prio = 'media'
            if (p.dias_ausente > 365 || !p.ultima_visita) prio = 'urgente'
            else if (p.dias_ausente > 270) prio = 'alta'
            return {
                id: p.id,
                nome: p.nome,
                telefone: p.telefone,
                email: p.email,
                ultima_visita: p.ultima_visita,
                dias_ausente: p.dias_ausente,
                prioridade: prio
            }
        })

        res.status(200).json({
            success: true,
            data: data,
            total: data.length,
            contagens: {
                urgente: urgente.rows[0].total,
                alta: alta.rows[0].total,
                media: media.rows[0].total,
                total: urgente.rows[0].total + alta.rows[0].total + media.rows[0].total
            }
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
