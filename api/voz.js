// api/voz.js — Endpoint público para assistentes de voz (Siri, Google, Alexa)
// Autenticação via token pessoal do profissional (token_voz)
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var q = req.query || {}
    var token = q.token || ''
    var pergunta = (q.q || q.pergunta || '').toLowerCase().trim()

    if (!token) {
        return res.status(200).json({ resposta: 'Token nao informado. Gere seu token pessoal nas configuracoes do sistema.' })
    }

    try {
        var client = getClient()

        // Validate token
        try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_voz TEXT") } catch(e) {}
        var userR = await client.execute({ sql: "SELECT u.id, u.nome, u.perfil, u.clinica_id FROM usuarios u WHERE u.token_voz=? AND u.ativo=1", args: [token] })
        if (!userR.rows.length) {
            return res.status(200).json({ resposta: 'Token invalido ou expirado.' })
        }
        var user = userR.rows[0]
        var clinica_id = user.clinica_id
        var profNome = user.nome || ''

        if (!pergunta) {
            return res.status(200).json({ resposta: 'Ola ' + profNome.split(' ')[0] + '! Pergunte sobre sua agenda, faltas ou aniversariantes.' })
        }

        var hoje = new Date().toISOString().slice(0, 10)
        var amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

        // Detect intent
        var ehHoje = pergunta.match(/hoje|agora|dia/)
        var ehAmanha = pergunta.match(/amanh/)
        var ehSemana = pergunta.match(/semana/)
        var ehPacientes = pergunta.match(/pacient|agenda|consulta|atendimento|horario|quant/)
        var ehFaltas = pergunta.match(/falt|ausent/)
        var ehAniversario = pergunta.match(/anivers|parab/)
        var ehProximo = pergunta.match(/proximo|proxim|seguinte|next/)

        var dataBusca = hoje
        var periodoLabel = 'hoje'
        if (ehAmanha) { dataBusca = amanha; periodoLabel = 'amanha' }

        var resposta = ''

        if (ehPacientes || ehHoje || ehAmanha) {
            var sql = "SELECT a.data_hora, a.status, a.procedimento, a.tipo, COALESCE(p.nome,a.paciente_nome) as paciente_nome, COALESCE(pr.nome,a.profissional_nome) as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND a.clinica_id=? AND a.status NOT IN ('cancelado')"
            var args = [dataBusca, clinica_id]

            // Filter by professional unless asking for all
            if (!pergunta.match(/todos|clinica|geral|toda/)) {
                sql += " AND (pr.nome LIKE ? OR a.profissional_nome LIKE ?)"
                args.push('%' + profNome.split(' ')[0] + '%', '%' + profNome.split(' ')[0] + '%')
            }
            sql += " ORDER BY a.data_hora ASC"

            var agR = await client.execute({ sql: sql, args: args })
            var ag = agR.rows

            if (!ag.length) {
                resposta = profNome.split(' ')[0] + ', voce nao tem pacientes agendados para ' + periodoLabel + '.'
            } else {
                resposta = profNome.split(' ')[0] + ', voce tem ' + ag.length + ' paciente' + (ag.length > 1 ? 's' : '') + ' ' + periodoLabel + '. '
                ag.forEach(function(a, i) {
                    var hora = (a.data_hora || '').slice(11, 16) || ''
                    resposta += (a.paciente_nome || 'Paciente').split(' ')[0] + ' as ' + hora
                    if (i < ag.length - 1) resposta += ', '
                    else resposta += '. '
                })
                var confirmados = ag.filter(function(a) { return a.status === 'confirmado' }).length
                if (confirmados > 0) resposta += confirmados + ' ja confirmou.'
            }

        } else if (ehProximo) {
            // Proximo paciente
            var proxR = await client.execute({
                sql: "SELECT a.data_hora, COALESCE(p.nome,a.paciente_nome) as paciente_nome, a.procedimento, a.tipo FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.data_hora >= datetime('now') AND a.clinica_id=? AND a.status NOT IN ('cancelado') AND (pr.nome LIKE ? OR a.profissional_nome LIKE ?) ORDER BY a.data_hora ASC LIMIT 1",
                args: [clinica_id, '%' + profNome.split(' ')[0] + '%', '%' + profNome.split(' ')[0] + '%']
            })
            if (proxR.rows.length) {
                var prox = proxR.rows[0]
                var proxHora = (prox.data_hora || '').slice(11, 16)
                var proxData = (prox.data_hora || '').slice(0, 10)
                var proxDia = proxData === hoje ? 'hoje' : proxData === amanha ? 'amanha' : proxData.split('-').reverse().join('/')
                resposta = 'Seu proximo paciente e ' + (prox.paciente_nome || '').split(' ')[0] + ', ' + proxDia + ' as ' + proxHora + '.'
            } else {
                resposta = 'Nao encontrei proximo agendamento.'
            }

        } else if (ehFaltas) {
            var fR = await client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE DATE(data_hora)=? AND (status='faltou' OR status LIKE '%falt%') AND clinica_id=?", args: [dataBusca, clinica_id] })
            var faltas = fR.rows[0].total || 0
            resposta = faltas > 0 ? faltas + ' paciente' + (faltas > 1 ? 's' : '') + ' faltaram ' + periodoLabel + '.' : 'Nenhuma falta ' + periodoLabel + '.'

        } else if (ehAniversario) {
            var mesStr = String(new Date().getMonth() + 1).padStart(2, '0')
            var anR = await client.execute({ sql: "SELECT nome FROM pacientes WHERE data_nascimento IS NOT NULL AND substr(data_nascimento,6,2)=? AND clinica_id=? LIMIT 10", args: [mesStr, clinica_id] })
            if (anR.rows.length) {
                resposta = anR.rows.length + ' aniversariantes este mes: ' + anR.rows.map(function(a) { return a.nome.split(' ')[0] }).join(', ') + '.'
            } else {
                resposta = 'Nenhum aniversariante este mes.'
            }

        } else {
            resposta = profNome.split(' ')[0] + ', voce pode perguntar: quantos pacientes hoje, minha agenda de amanha, proximo paciente, faltas de hoje, ou aniversariantes do mes.'
        }

        return res.status(200).json({ resposta: resposta, profissional: profNome })

    } catch (error) {
        return res.status(200).json({ resposta: 'Erro ao consultar: ' + error.message })
    }
}
