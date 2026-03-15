// api/financeiro.js — Financeiro com filtros
// USO: /api/financeiro?de=2026-03-01&ate=2026-03-15
//      /api/financeiro?tipo=entrada
//      /api/financeiro?forma=pix
//      /api/financeiro?busca=carlos
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

        if (q.de) { where.push("f.data_pagamento >= ?"); args.push(q.de) }
        if (q.ate) { where.push("f.data_pagamento <= ?"); args.push(q.ate) }
        if (q.tipo) { where.push("f.tipo = ?"); args.push(q.tipo) }
        if (q.forma) { where.push("f.forma_pagamento LIKE ?"); args.push('%' + q.forma + '%') }
        if (q.busca) { where.push("f.descricao LIKE ?"); args.push('%' + q.busca + '%') }

        var whereClause = where.length > 0 ? ' WHERE ' + where.join(' AND ') : ''
        var limit = Math.min(parseInt(q.limit) || 100, 500)
        var page = parseInt(q.page) || 1
        var offset = (page - 1) * limit

        var result = await client.execute({
            sql: "SELECT f.id, f.clinicorp_id, f.tipo, f.descricao, f.valor, f.data_pagamento, f.forma_pagamento, f.status FROM financeiro f" + whereClause + " ORDER BY f.data_pagamento DESC LIMIT ? OFFSET ?",
            args: args.concat([limit, offset])
        })

        // Totais
        var totais = await client.execute({
            sql: "SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) as total_entradas, COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END), 0) as total_saidas, COALESCE(SUM(valor), 0) as total_geral, COUNT(*) as total_registros FROM financeiro f" + whereClause,
            args: args
        })

        // Por forma de pagamento
        var porForma = await client.execute({
            sql: "SELECT forma_pagamento, COUNT(*) as qtd, SUM(valor) as total FROM financeiro f" + whereClause + " GROUP BY forma_pagamento ORDER BY total DESC",
            args: args
        })

        // Por dia (para gráfico)
        var porDia = await client.execute({
            sql: "SELECT data_pagamento as dia, SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) as entradas, SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END) as saidas FROM financeiro f" + whereClause + " GROUP BY data_pagamento ORDER BY data_pagamento",
            args: args
        })

        res.status(200).json({
            success: true,
            data: result.rows,
            totais: totais.rows[0],
            por_forma_pagamento: porForma.rows,
            por_dia: porDia.rows,
            paginacao: { page: page, limit: limit },
            filtros: q
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
