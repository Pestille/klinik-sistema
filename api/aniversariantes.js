// api/aniversariantes.js — Aniversariantes próximos 60 dias
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var dias = parseInt((req.query || {}).dias) || 60

        // Buscar pacientes com data_nascimento preenchida
        // e filtrar os que fazem aniversário nos próximos X dias
        var result = await client.execute(
            "SELECT id, nome, telefone, email, data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento != ''"
        )

        var hoje = new Date()
        var aniversariantes = []

        result.rows.forEach(function(p) {
            try {
                var nasc = new Date(p.data_nascimento + 'T12:00:00')
                if (isNaN(nasc.getTime())) return

                // Próximo aniversário
                var prox = new Date(hoje.getFullYear(), nasc.getMonth(), nasc.getDate())
                if (prox < hoje) prox.setFullYear(prox.getFullYear() + 1)

                var diffDias = Math.floor((prox - hoje) / 86400000)

                if (diffDias >= 0 && diffDias <= dias) {
                    aniversariantes.push({
                        id: p.id,
                        nome: p.nome,
                        telefone: p.telefone,
                        email: p.email,
                        data_nascimento: p.data_nascimento,
                        dia_aniversario: prox.toISOString().slice(0, 10),
                        dias_faltam: diffDias
                    })
                }
            } catch(e) {}
        })

        aniversariantes.sort(function(a, b) { return a.dias_faltam - b.dias_faltam })

        res.status(200).json({
            success: true,
            data: aniversariantes,
            total: aniversariantes.length,
            periodo_dias: dias
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
