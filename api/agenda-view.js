// api/agenda-view.js — Agenda com visualização dia/semana/mês
// USO: /api/agenda-view?modo=dia&data=2026-03-15
//      /api/agenda-view?modo=semana&data=2026-03-10
//      /api/agenda-view?modo=mes&mes=2026-03
//      /api/agenda-view?profissional=3
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}
        var modo = q.modo || 'dia'
        var profFiltro = q.profissional ? parseInt(q.profissional) : null

        var where = []
        var args = []

        if (modo === 'dia') {
            var data = q.data || new Date().toISOString().slice(0,10)
            where.push("a.data_hora LIKE ?")
            args.push(data + '%')

        } else if (modo === 'semana') {
            var baseDate = q.data ? new Date(q.data + 'T12:00:00') : new Date()
            var dow = baseDate.getDay()
            var seg = new Date(baseDate); seg.setDate(seg.getDate() - (dow === 0 ? 6 : dow - 1))
            var dom = new Date(seg); dom.setDate(dom.getDate() + 6)
            where.push("a.data_hora >= ? AND a.data_hora <= ?")
            args.push(seg.toISOString().slice(0,10))
            args.push(dom.toISOString().slice(0,10) + ' 23:59')

        } else if (modo === 'mes') {
            var mes = q.mes || new Date().toISOString().slice(0,7)
            where.push("a.data_hora LIKE ?")
            args.push(mes + '%')
        }

        if (profFiltro) {
            where.push("a.profissional_id = ?")
            args.push(profFiltro)
        }

        // Excluir cancelados por padrão
        if (q.incluir_cancelados !== '1') {
            where.push("a.status != 'cancelado'")
        }

        var whereClause = where.length > 0 ? ' WHERE ' + where.join(' AND ') : ''

        // Agendamentos com dados do profissional
        var result = await client.execute({
            sql: "SELECT a.id, a.data_hora, a.tipo as categoria, a.status, a.procedimento as paciente_nome, a.observacoes, a.profissional_id, a.paciente_id, pr.nome as profissional_nome FROM agendamentos a LEFT JOIN profissionais pr ON a.profissional_id = pr.id" + whereClause + " ORDER BY a.data_hora ASC LIMIT 1000",
            args: args
        })

        // Profissionais ativos
        var profs = await client.execute("SELECT id, nome, especialidade FROM profissionais ORDER BY nome")

        // Agrupar por profissional para a view de agenda
        var porProfissional = {}
        profs.rows.forEach(function(pr) { porProfissional[pr.id] = { profissional: pr, agendamentos: [] } })

        result.rows.forEach(function(a) {
            var pid = a.profissional_id
            if (pid && porProfissional[pid]) {
                porProfissional[pid].agendamentos.push(a)
            }
        })

        // Contagens
        var total = result.rows.length
        var confirmados = result.rows.filter(function(a){return a.status === 'confirmado'}).length
        var agendados = result.rows.filter(function(a){return a.status === 'agendado'}).length
        var realizados = result.rows.filter(function(a){return a.status === 'realizado'}).length
        var faltas = result.rows.filter(function(a){return a.status === 'faltou'}).length

        // Para modo mês: agrupar por dia
        var porDia = {}
        if (modo === 'mes' || modo === 'semana') {
            result.rows.forEach(function(a) {
                var dia = (a.data_hora || '').slice(0, 10)
                if (!porDia[dia]) porDia[dia] = { total: 0, confirmados: 0, agendados: 0, realizados: 0, faltas: 0 }
                porDia[dia].total++
                if (a.status === 'confirmado') porDia[dia].confirmados++
                if (a.status === 'agendado') porDia[dia].agendados++
                if (a.status === 'realizado') porDia[dia].realizados++
                if (a.status === 'faltou') porDia[dia].faltas++
            })
        }

        // Por categoria
        var porCategoria = {}
        result.rows.forEach(function(a) {
            var cat = a.categoria || 'Outros'
            porCategoria[cat] = (porCategoria[cat] || 0) + 1
        })

        res.status(200).json({
            success: true,
            modo: modo,
            agendamentos: result.rows,
            por_profissional: porProfissional,
            profissionais: profs.rows,
            por_dia: porDia,
            por_categoria: porCategoria,
            resumo: {
                total: total,
                confirmados: confirmados,
                agendados: agendados,
                realizados: realizados,
                faltas: faltas
            }
        })

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
