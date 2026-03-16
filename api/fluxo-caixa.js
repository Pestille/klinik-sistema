// api/fluxo-caixa.js — Fluxo de caixa por mês
// USO: /api/fluxo-caixa?mes=3&ano=2026
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}
        var now = new Date()
        var mes = parseInt(q.mes) || (now.getMonth() + 1)
        var ano = parseInt(q.ano) || now.getFullYear()

        var mesStr = ano + '-' + String(mes).padStart(2, '0')

        // Entradas e saídas por dia
        var result = await client.execute({
            sql: "SELECT data_pagamento as dia, tipo, SUM(valor) as total FROM financeiro WHERE data_pagamento LIKE ? GROUP BY data_pagamento, tipo ORDER BY data_pagamento",
            args: [mesStr + '%']
        })

        // Montar dados por dia do mês
        var ultimoDia = new Date(ano, mes, 0).getDate()
        var porDia = []
        var acumulado = 0

        for (var d = 1; d <= ultimoDia; d++) {
            var diaStr = mesStr + '-' + String(d).padStart(2, '0')
            var entradas = 0
            var saidas = 0

            result.rows.forEach(function(r) {
                if (r.dia === diaStr) {
                    if (r.tipo === 'entrada') entradas = r.total || 0
                    else saidas = Math.abs(r.total || 0)
                }
            })

            var saldo = entradas - saidas
            acumulado += saldo

            porDia.push({
                dia: d,
                data: diaStr,
                entradas: entradas,
                saidas: saidas,
                saldo: saldo,
                acumulado: acumulado
            })
        }

        // Totais do mês
        var totalEnt = await client.execute({
            sql: "SELECT COALESCE(SUM(valor), 0) as total FROM financeiro WHERE data_pagamento LIKE ? AND tipo = 'entrada'",
            args: [mesStr + '%']
        })
        var totalSai = await client.execute({
            sql: "SELECT COALESCE(SUM(ABS(valor)), 0) as total FROM financeiro WHERE data_pagamento LIKE ? AND tipo = 'saida'",
            args: [mesStr + '%']
        })

        // Resumo por forma de pagamento (entradas)
        var porForma = await client.execute({
            sql: "SELECT forma_pagamento, SUM(valor) as total FROM financeiro WHERE data_pagamento LIKE ? AND tipo = 'entrada' GROUP BY forma_pagamento ORDER BY total DESC",
            args: [mesStr + '%']
        })

        var entTotal = totalEnt.rows[0].total
        var saiTotal = totalSai.rows[0].total

        res.status(200).json({
            success: true,
            mes: mes,
            ano: ano,
            mes_str: mesStr,
            por_dia: porDia,
            totais: {
                entradas: entTotal,
                saidas: saiTotal,
                saldo: entTotal - saiTotal,
                acumulado: acumulado
            },
            resumo_entradas: porForma.rows
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
