// api/agendamentos.js — Agendamentos com filtros completos
// USO: /api/agendamentos?data=2026-03-15
//      /api/agendamentos?de=2026-03-10&ate=2026-03-16
//      /api/agendamentos?semana=2026-03-10
//      /api/agendamentos?mes=2026-03
//      /api/agendamentos?profissional=3
//      /api/agendamentos?status=agendado
//      /api/agendamentos?busca=carlos
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}
        var where = []
        var args = []

        // Filtro por data exata
        if (q.data) {
            where.push("a.data_hora LIKE ?")
            args.push(q.data + '%')
        }

        // Filtro por range de datas
        if (q.de && q.ate) {
            where.push("a.data_hora >= ? AND a.data_hora <= ?")
            args.push(q.de)
            args.push(q.ate + ' 23:59')
        }

        // Filtro por semana (data = segunda-feira da semana)
        if (q.semana) {
            var seg = new Date(q.semana + 'T12:00:00')
            var dom = new Date(seg); dom.setDate(dom.getDate() + 6)
            where.push("a.data_hora >= ? AND a.data_hora <= ?")
            args.push(seg.toISOString().slice(0, 10))
            args.push(dom.toISOString().slice(0, 10) + ' 23:59')
        }

        // Filtro por mes
        if (q.mes) {
            where.push("a.data_hora LIKE ?")
            args.push(q.mes + '%')
        }

        // Filtro por profissional
        if (q.profissional) {
            where.push("a.profissional_id = ?")
            args.push(parseInt(q.profissional))
        }

        // Filtro por status
        if (q.status) {
            where.push("a.status = ?")
            args.push(q.status)
        }

        // Filtro por categoria/tipo
        if (q.tipo) {
            where.push("a.tipo = ?")
            args.push(q.tipo)
        }

        // Busca por nome do paciente
        if (q.busca) {
            where.push("a.procedimento LIKE ?")
            args.push('%' + q.busca + '%')
        }

        var whereClause = where.length > 0 ? ' WHERE ' + where.join(' AND ') : ''
        var limit = Math.min(parseInt(q.limit) || 500, 2000)
        var offset = parseInt(q.offset) || 0

        // Query principal
        var sql = "SELECT a.id, a.clinicorp_id, a.data_hora, a.tipo as categoria, a.status, a.procedimento as paciente_nome, a.observacoes, a.profissional_id, a.paciente_id, pr.nome as profissional_nome FROM agendamentos a LEFT JOIN profissionais pr ON a.profissional_id = pr.id" + whereClause + " ORDER BY a.data_hora DESC LIMIT ? OFFSET ?"
        args.push(limit)
        args.push(offset)

        var result = await client.execute({ sql: sql, args: args })

        // Contagem total
        var countArgs = args.slice(0, -2)
        var countResult = await client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos a" + whereClause, args: countArgs })

        // Resumo por status (para o filtro ativo)
        var resumoSql = "SELECT status, COUNT(*) as total FROM agendamentos a" + whereClause + " GROUP BY status"
        var resumoResult = await client.execute({ sql: resumoSql, args: countArgs })

        // Resumo por categoria
        var catSql = "SELECT tipo as categoria, COUNT(*) as total FROM agendamentos a" + whereClause + " GROUP BY tipo ORDER BY total DESC"
        var catResult = await client.execute({ sql: catSql, args: countArgs })

        res.status(200).json({
            success: true,
            data: result.rows,
            total: countResult.rows[0].total,
            por_status: resumoResult.rows,
            por_categoria: catResult.rows,
            filtros_aplicados: q
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
