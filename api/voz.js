// api/voz.js — Endpoint público para assistentes de voz (Siri, Google, Alexa)
// Autenticação via token pessoal do profissional (token_voz)
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    // ── ALEXA SKILL HANDLER ──
    // If POST with Alexa request format, handle as Alexa
    if (req.method === 'POST' && req.body && req.body.request && req.body.request.type) {
        return handleAlexa(req, res)
    }

    // ── REGULAR VOZ API (GET) ──
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

// ══════════════════════════════════════════════════════════════
// ALEXA SKILL HANDLER
// ══════════════════════════════════════════════════════════════
async function handleAlexa(req, res) {
    var body = req.body || {}
    var requestType = (body.request && body.request.type) || ''
    var intent = (body.request && body.request.intent) || {}
    var intentName = intent.name || ''
    var slots = intent.slots || {}
    var token = (body.session && body.session.user && body.session.user.accessToken) || ''

    // Get Alexa API access token for profile info (email)
    var apiAccessToken = (body.context && body.context.System && body.context.System.apiAccessToken) || ''
    var apiEndpoint = (body.context && body.context.System && body.context.System.apiEndpoint) || 'https://api.amazonalexa.com'

    try {
        var client = getClient()

        // ── Identify user by Alexa account email ──
        var userEmail = ''
        if (apiAccessToken) {
            try {
                var profileRes = await fetch(apiEndpoint + '/v2/accounts/~current/settings/Profile.email', {
                    headers: { 'Authorization': 'Bearer ' + apiAccessToken }
                })
                if (profileRes.ok) {
                    var emailData = await profileRes.text()
                    userEmail = emailData.replace(/"/g, '').trim()
                }
            } catch(e) { console.log('[alexa] Email fetch error:', e.message) }
        }

        // Determine if user is a professional or patient
        var isProfissional = false, isPaciente = false
        var clinica_id = 1, profNome = '', profId = null
        var pacienteNome = '', pacienteId = null

        if (userEmail) {
            // Check professionals first
            var profR = await client.execute({ sql: "SELECT id, nome, clinica_id FROM profissionais WHERE email=? AND ativo=1 LIMIT 1", args: [userEmail] })
            if (profR.rows.length) {
                isProfissional = true
                profId = profR.rows[0].id
                profNome = profR.rows[0].nome || ''
                clinica_id = profR.rows[0].clinica_id || 1
            }
            // Check users (admin, dentista, etc)
            if (!isProfissional) {
                var usrR = await client.execute({ sql: "SELECT u.id, u.nome, u.clinica_id, u.perfil FROM usuarios u WHERE u.email=? AND u.ativo=1 LIMIT 1", args: [userEmail] })
                if (usrR.rows.length) {
                    isProfissional = true
                    profNome = usrR.rows[0].nome || ''
                    clinica_id = usrR.rows[0].clinica_id || 1
                    // Find matching professional by name
                    var prMatch = await client.execute({ sql: "SELECT id FROM profissionais WHERE nome LIKE ? LIMIT 1", args: ['%' + profNome.split(' ')[0] + '%'] })
                    if (prMatch.rows.length) profId = prMatch.rows[0].id
                }
            }
            // Check patients
            if (!isProfissional) {
                var pacR = await client.execute({ sql: "SELECT id, nome, clinica_id FROM pacientes WHERE email=? LIMIT 1", args: [userEmail] })
                if (pacR.rows.length) {
                    isPaciente = true
                    pacienteId = pacR.rows[0].id
                    pacienteNome = pacR.rows[0].nome || ''
                    clinica_id = pacR.rows[0].clinica_id || 1
                }
            }
        }

        // Fallback to token identification
        if (!isProfissional && !isPaciente && token) {
            try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_voz TEXT") } catch(e) {}
            var tokR = await client.execute({ sql: "SELECT u.id, u.nome, u.clinica_id FROM usuarios u WHERE u.token_voz=? AND u.ativo=1", args: [token] })
            if (tokR.rows.length) { isProfissional = true; profNome = tokR.rows[0].nome || ''; clinica_id = tokR.rows[0].clinica_id || 1 }
        }

        // Default clinic
        if (!clinica_id) {
            var cliR = await client.execute({ sql: "SELECT id FROM clinicas LIMIT 1", args: [] })
            if (cliR.rows.length) clinica_id = cliR.rows[0].id
        }

        var hoje = new Date().toISOString().slice(0, 10)
        var amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
        var diasSemana = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado']

        if (requestType === 'LaunchRequest') {
            if (isPaciente) {
                return alexaResp(res, 'Ola ' + pacienteNome.split(' ')[0] + '! Sou a assistente da Klinik Odontologia. Voce pode perguntar: que horas e minha consulta, quando e minha proxima consulta, ou meus agendamentos.', false)
            }
            return alexaResp(res, 'Ola' + (profNome ? ' ' + profNome.split(' ')[0] : '') + '! Sou a assistente da Klinik Odontologia. Voce pode perguntar: quantos pacientes tenho hoje, minha agenda de amanha, proximo paciente, faltas ou aniversariantes.', false)
        }
        if (requestType === 'SessionEndedRequest') return res.status(200).json({})

        if (requestType === 'IntentRequest') {
            if (intentName === 'AMAZON.HelpIntent') {
                if (isPaciente) return alexaResp(res, 'Voce pode perguntar: que horas e minha consulta, quando e minha proxima consulta, ou meus agendamentos.', false)
                return alexaResp(res, 'Pergunte: quantos pacientes hoje, agenda de amanha, proximo paciente, faltas ou aniversariantes.', false)
            }
            if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') return alexaResp(res, 'Ate logo!', true)

            // ── PATIENT INTENTS ──
            if (intentName === 'MinhaConsultaIntent' || intentName === 'MeusAgendamentosIntent') {
                if (!isPaciente && !userEmail) {
                    return alexaResp(res, 'Para consultar seus agendamentos, preciso acessar seu email. Nas configuracoes da skill no app Alexa, habilite a permissao de email.', true)
                }
                if (!isPaciente) {
                    return alexaResp(res, 'Nao encontrei seu cadastro na Klinik Odontologia com o email ' + userEmail + '. Verifique com a clinica se seu email esta cadastrado.', true)
                }

                // Find patient appointments
                var pacAg = await client.execute({
                    sql: "SELECT a.data_hora, a.hora_fim, a.status, COALESCE(pr.nome, a.profissional_nome) as profissional_nome, a.procedimento, a.tipo FROM agendamentos a LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.paciente_id=? AND DATE(a.data_hora)>=? AND a.status NOT IN ('cancelado','faltou') ORDER BY a.data_hora ASC LIMIT 5",
                    args: [pacienteId, hoje]
                })

                if (!pacAg.rows.length) {
                    return alexaResp(res, pacienteNome.split(' ')[0] + ', voce nao tem consultas agendadas nos proximos dias. Para agendar, entre em contato com a Klinik Odontologia.', true)
                }

                var proxima = pacAg.rows[0]
                var proxData = (proxima.data_hora || '').slice(0, 10)
                var proxHora = (proxima.data_hora || '').slice(11, 16)
                var proxDiaSemana = diasSemana[new Date(proxData + 'T12:00:00').getDay()] || ''
                var proxProf = proxima.profissional_nome || ''

                var resp = ''
                if (proxData === hoje) {
                    resp = pacienteNome.split(' ')[0] + ', sua consulta e hoje as ' + proxHora
                } else if (proxData === amanha) {
                    resp = pacienteNome.split(' ')[0] + ', sua proxima consulta e amanha, ' + proxDiaSemana + ', as ' + proxHora
                } else {
                    resp = pacienteNome.split(' ')[0] + ', sua proxima consulta e ' + proxDiaSemana + ', dia ' + proxData.split('-').reverse().join('/') + ', as ' + proxHora
                }
                if (proxProf) resp += ', com ' + proxProf
                resp += '.'

                if (proxima.status === 'confirmado') resp += ' Sua presenca ja esta confirmada.'

                // If more appointments
                if (pacAg.rows.length > 1) {
                    resp += ' Voce tambem tem mais ' + (pacAg.rows.length - 1) + ' consulta' + (pacAg.rows.length > 2 ? 's' : '') + ' agendada' + (pacAg.rows.length > 2 ? 's' : '') + '.'
                }

                return alexaResp(res, resp, true)
            }

            // ── PROFESSIONAL INTENTS (filter by professional) ──
            var profFilter = ''
            var profArgs = []
            if (isProfissional && profNome) {
                profFilter = " AND (pr.nome LIKE ? OR a.profissional_nome LIKE ?)"
                profArgs = ['%' + profNome.split(' ')[0] + '%', '%' + profNome.split(' ')[0] + '%']
            }
            var hoje = new Date().toISOString().slice(0, 10)
            var amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

            if (intentName === 'AgendaHojeIntent' || intentName === 'AgendaAmanhaIntent') {
                var data = intentName === 'AgendaAmanhaIntent' ? amanha : hoje
                var label = intentName === 'AgendaAmanhaIntent' ? 'amanha' : 'hoje'
                var agSql = "SELECT a.data_hora, COALESCE(p.nome,a.paciente_nome) as paciente_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND a.clinica_id=? AND a.status NOT IN ('cancelado')" + profFilter + " ORDER BY a.data_hora"
                var ag = await client.execute({ sql: agSql, args: [data, clinica_id].concat(profArgs) })
                if (!ag.rows.length) return alexaResp(res, profNome.split(' ')[0]+', voce nao tem pacientes '+label+'.', true)
                var r = profNome.split(' ')[0]+', voce tem '+ag.rows.length+' paciente'+(ag.rows.length>1?'s':'')+' '+label+'. '
                ag.rows.forEach(function(a,i){ r += (a.paciente_nome||'').split(' ')[0]+' as '+(a.data_hora||'').slice(11,16)+(i<ag.rows.length-1?', ':'. ') })
                return alexaResp(res, r, true)
            }

            if (intentName === 'ProximoPacienteIntent') {
                var pxSql = "SELECT a.data_hora, COALESCE(p.nome,a.paciente_nome) as paciente_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.data_hora>=datetime('now') AND a.clinica_id=? AND a.status NOT IN ('cancelado')" + profFilter + " ORDER BY a.data_hora LIMIT 1"
                var px = await client.execute({ sql: pxSql, args: [clinica_id].concat(profArgs) })
                if (!px.rows.length) return alexaResp(res, 'Sem proximo agendamento.', true)
                var p = px.rows[0], h = (p.data_hora||'').slice(11,16), d2 = (p.data_hora||'').slice(0,10)
                return alexaResp(res, 'Proximo paciente: '+(p.paciente_nome||'').split(' ')[0]+', '+(d2===hoje?'hoje':d2===amanha?'amanha':d2.split('-').reverse().join('/'))+' as '+h+'.', true)
            }

            if (intentName === 'FaltasIntent') {
                var fR = await client.execute({ sql: "SELECT COUNT(*) as t FROM agendamentos WHERE DATE(data_hora)=? AND (status='faltou' OR status LIKE '%falt%') AND clinica_id=?", args: [hoje, clinica_id] })
                return alexaResp(res, (fR.rows[0].t||0)>0?fR.rows[0].t+' falta'+(fR.rows[0].t>1?'s':'')+' hoje.':'Nenhuma falta hoje.', true)
            }

            if (intentName === 'AniversariantesIntent') {
                var ms = String(new Date().getMonth()+1).padStart(2,'0')
                var an = await client.execute({ sql: "SELECT nome FROM pacientes WHERE data_nascimento IS NOT NULL AND substr(data_nascimento,6,2)=? AND clinica_id=? LIMIT 10", args: [ms, clinica_id] })
                return alexaResp(res, an.rows.length?an.rows.length+' aniversariantes: '+an.rows.map(function(a){return a.nome.split(' ')[0]}).join(', ')+'.':'Nenhum aniversariante este mes.', true)
            }

            if (intentName === 'QuantosPacientesIntent') {
                var qSql = "SELECT COUNT(*) as t FROM agendamentos a LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND a.clinica_id=? AND a.status NOT IN ('cancelado')" + profFilter
                var qR = await client.execute({ sql: qSql, args: [hoje, clinica_id].concat(profArgs) })
                return alexaResp(res, profNome.split(' ')[0]+', voce tem '+(qR.rows[0].t||0)+' pacientes hoje.', true)
            }

            return alexaResp(res, 'Nao entendi. Pergunte: agenda de hoje, proximo paciente, faltas ou aniversariantes.', false)
        }
        return alexaResp(res, 'Erro.', true)
    } catch(e) {
        return alexaResp(res, 'Erro ao consultar. Tente novamente.', true)
    }
}

function alexaResp(res, text, endSession) {
    return res.status(200).json({ version: '1.0', response: { outputSpeech: { type: 'PlainText', text: text }, shouldEndSession: endSession !== false } })
}
