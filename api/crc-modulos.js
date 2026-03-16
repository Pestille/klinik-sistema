// api/crc-modulos.js — CRC completo com 6 módulos
// USO: /api/crc-modulos?modulo=inativos
//      /api/crc-modulos?modulo=faltas
//      /api/crc-modulos?modulo=primeira_consulta
//      /api/crc-modulos?modulo=aniversariantes
//      /api/crc-modulos?modulo=tratamentos_abertos
//      /api/crc-modulos?modulo=resumo
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    try {
        var client = getClient()
        var q = req.query || {}
        var modulo = q.modulo || 'resumo'

        if (modulo === 'resumo') {
            // Contagens de todos os módulos
            var inativos = await client.execute("SELECT COUNT(*) as total FROM (SELECT p.id FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING MAX(a.data_hora) < date('now', '-180 days') OR MAX(a.data_hora) IS NULL)")
            var faltas = await client.execute("SELECT COUNT(*) as total FROM agendamentos WHERE status = 'faltou' AND data_hora >= date('now', '-90 days')")
            var agendados = await client.execute("SELECT COUNT(*) as total FROM agendamentos WHERE status = 'agendado' AND data_hora >= date('now')")

            res.status(200).json({
                success: true,
                modulo: 'resumo',
                contagens: {
                    inativos: inativos.rows[0].total,
                    faltas_90d: faltas.rows[0].total,
                    agendamentos_futuros: agendados.rows[0].total
                }
            })

        } else if (modulo === 'inativos') {
            var prio = q.prioridade || ''
            var sql = "SELECT p.id, p.nome, p.telefone, p.email, MAX(a.data_hora) as ultima_visita, CAST(julianday('now') - julianday(MAX(a.data_hora)) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON p.id = a.paciente_id"
            var having = " GROUP BY p.id HAVING ultima_visita < date('now', '-180 days') OR ultima_visita IS NULL"
            var args = []

            if (q.busca) { sql += " WHERE p.nome LIKE ?"; args.push('%' + q.busca + '%') }
            sql += having

            if (prio === 'urgente') sql += " AND dias_ausente > 365"
            else if (prio === 'alta') sql += " AND dias_ausente > 270 AND dias_ausente <= 365"
            else if (prio === 'media') sql += " AND dias_ausente > 180 AND dias_ausente <= 270"

            sql += " ORDER BY dias_ausente DESC LIMIT 200"

            var result = await client.execute({ sql: sql, args: args })

            var data = result.rows.map(function(p) {
                var prio = 'media'
                if (p.dias_ausente > 365 || !p.ultima_visita) prio = 'urgente'
                else if (p.dias_ausente > 270) prio = 'alta'
                return { id: p.id, nome: p.nome, telefone: p.telefone, email: p.email, ultima_visita: p.ultima_visita, dias_ausente: p.dias_ausente, prioridade: prio }
            })

            res.status(200).json({ success: true, modulo: 'inativos', data: data, total: data.length })

        } else if (modulo === 'faltas') {
            // Pacientes que faltaram nos últimos 90 dias
            var dias = parseInt(q.dias) || 90
            var result = await client.execute({
                sql: "SELECT a.id, a.data_hora, a.tipo as categoria, a.procedimento as paciente_nome, a.profissional_id, pr.nome as profissional_nome, p.telefone FROM agendamentos a LEFT JOIN profissionais pr ON a.profissional_id = pr.id LEFT JOIN pacientes p ON a.paciente_id = p.id WHERE a.status = 'faltou' AND a.data_hora >= date('now', '-' || ? || ' days') ORDER BY a.data_hora DESC LIMIT 200",
                args: [dias]
            })

            // Agrupar por paciente e contar faltas
            var porPaciente = {}
            result.rows.forEach(function(a) {
                var nome = a.paciente_nome || 'Desconhecido'
                if (!porPaciente[nome]) porPaciente[nome] = { nome: nome, telefone: a.telefone || '', faltas: 0, ultima_falta: '', categorias: [] }
                porPaciente[nome].faltas++
                if (!porPaciente[nome].ultima_falta || a.data_hora > porPaciente[nome].ultima_falta) porPaciente[nome].ultima_falta = a.data_hora
                if (a.categoria && porPaciente[nome].categorias.indexOf(a.categoria) === -1) porPaciente[nome].categorias.push(a.categoria)
            })

            var data = Object.values(porPaciente).sort(function(a,b) { return b.faltas - a.faltas })

            res.status(200).json({ success: true, modulo: 'faltas', data: data, total_faltas: result.rows.length, pacientes_faltantes: data.length, periodo_dias: dias })

        } else if (modulo === 'primeira_consulta') {
            // Primeira consulta = pacientes com apenas 1 agendamento
            var result = await client.execute(
                "SELECT p.id, p.nome, p.telefone, p.email, COUNT(a.id) as total_agendamentos, MAX(a.data_hora) as ultima_visita, MIN(a.data_hora) as primeira_visita FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id GROUP BY p.id HAVING total_agendamentos = 1 ORDER BY ultima_visita DESC LIMIT 100"
            )

            res.status(200).json({ success: true, modulo: 'primeira_consulta', data: result.rows, total: result.rows.length })

        } else if (modulo === 'aniversariantes') {
            var result = await client.execute(
                "SELECT id, nome, telefone, email, data_nascimento FROM pacientes WHERE data_nascimento IS NOT NULL AND data_nascimento != ''"
            )

            var hoje = new Date()
            var dias = parseInt(q.dias) || 60
            var anivs = []

            result.rows.forEach(function(p) {
                try {
                    var nasc = new Date(p.data_nascimento + 'T12:00:00')
                    if (isNaN(nasc.getTime())) return
                    var prox = new Date(hoje.getFullYear(), nasc.getMonth(), nasc.getDate())
                    if (prox < hoje) prox.setFullYear(prox.getFullYear() + 1)
                    var diff = Math.floor((prox - hoje) / 86400000)
                    if (diff >= 0 && diff <= dias) {
                        anivs.push({ id: p.id, nome: p.nome, telefone: p.telefone, data_nascimento: p.data_nascimento, dia_aniversario: prox.toISOString().slice(0,10), dias_faltam: diff })
                    }
                } catch(e) {}
            })

            anivs.sort(function(a,b) { return a.dias_faltam - b.dias_faltam })
            res.status(200).json({ success: true, modulo: 'aniversariantes', data: anivs, total: anivs.length })

        } else if (modulo === 'tratamentos_abertos') {
            // Pacientes com agendamentos futuros (tratamentos em andamento)
            var result = await client.execute(
                "SELECT p.id, p.nome, p.telefone, COUNT(a.id) as agendamentos_futuros, MIN(a.data_hora) as proximo FROM pacientes p INNER JOIN agendamentos a ON p.id = a.paciente_id WHERE a.status = 'agendado' AND a.data_hora >= date('now') GROUP BY p.id ORDER BY proximo ASC LIMIT 100"
            )

            res.status(200).json({ success: true, modulo: 'tratamentos_abertos', data: result.rows, total: result.rows.length })

        } else {
            res.status(400).json({ success: false, error: 'Modulo invalido. Use: resumo, inativos, faltas, primeira_consulta, aniversariantes, tratamentos_abertos' })
        }

    } catch(error) {
        res.status(500).json({ success: false, error: error.message })
    }
}
