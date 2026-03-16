// api/conta-corrente.js — Conta corrente agrupada por dia
// USO: /api/conta-corrente?de=2026-03-08&ate=2026-03-15
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}

        // Padrão: últimos 7 dias
        var ate = q.ate || new Date().toISOString().slice(0,10)
        var de = q.de
        if (!de) {
            var d = new Date(); d.setDate(d.getDate() - 7)
            de = d.toISOString().slice(0,10)
        }

        var result = await client.execute({
            sql: "SELECT f.id, f.tipo, f.descricao, f.valor, f.data_pagamento, f.forma_pagamento, f.status FROM financeiro f WHERE f.data_pagamento >= ? AND f.data_pagamento <= ? ORDER BY f.data_pagamento ASC, f.id ASC",
            args: [de, ate]
        })

        // Agrupar por dia
        var dias = {}
        var DIAS_SEMANA = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']
        var MESES_ABR = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ']

        var totalVendas = 0, totalEntradas = 0, totalSaidas = 0

        result.rows.forEach(function(f) {
            var dia = f.data_pagamento || 'sem-data'
            if (!dias[dia]) {
                var dt = new Date(dia + 'T12:00:00')
                dias[dia] = {
                    data: dia,
                    dia_num: dt.getDate(),
                    mes_abr: MESES_ABR[dt.getMonth()] || '?',
                    dia_semana: DIAS_SEMANA[dt.getDay()] || '?',
                    vendas: 0,
                    entradas: 0,
                    saidas: 0,
                    transacoes: []
                }
            }

            var val = Math.abs(f.valor || 0)
            var tipo = f.tipo || 'entrada'

            if (tipo === 'entrada') {
                dias[dia].entradas += val
                totalEntradas += val
            } else if (tipo === 'saida') {
                dias[dia].saidas += val
                totalSaidas += val
            }

            // Determinar badge da forma de pagamento
            var badge = ''
            var fp = (f.forma_pagamento || '').toLowerCase()
            if (fp.indexOf('boleto') >= 0) badge = 'boleto'
            else if (fp.indexOf('crédito') >= 0 || fp.indexOf('credito') >= 0 || fp.indexOf('credit') >= 0) badge = 'credito'
            else if (fp.indexOf('débito') >= 0 || fp.indexOf('debito') >= 0) badge = 'debito'
            else if (fp.indexOf('pix') >= 0) badge = 'pix'
            else if (fp.indexOf('transf') >= 0) badge = 'transf'
            else if (fp.indexOf('dinheiro') >= 0 || fp.indexOf('cash') >= 0) badge = 'dinheiro'

            dias[dia].transacoes.push({
                id: f.id,
                hora: '—',
                tipo: tipo === 'entrada' ? 'Entrada' : 'Saída',
                badge: badge,
                descricao: f.descricao || '—',
                valor: val,
                positivo: tipo === 'entrada',
                forma_pagamento: f.forma_pagamento || ''
            })
        })

        // Converter para array ordenado
        var diasArray = Object.values(dias).sort(function(a,b) { return a.data.localeCompare(b.data) })

        res.status(200).json({
            success: true,
            periodo: { de: de, ate: ate },
            totais: {
                vendas: totalVendas,
                entradas: totalEntradas,
                saidas: totalSaidas,
                saldo: totalEntradas - totalSaidas
            },
            dias: diasArray,
            total_transacoes: result.rows.length
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
