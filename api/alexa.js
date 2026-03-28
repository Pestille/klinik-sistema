// api/alexa.js — Alexa Skill "Klinik Odontologia"
// Endpoint HTTPS para Amazon Alexa Skills Kit
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })

    var body = req.body || {}
    var requestType = (body.request && body.request.type) || ''
    var intent = (body.request && body.request.intent) || {}
    var intentName = intent.name || ''
    var slots = intent.slots || {}

    // Account linking: token is passed via body.session.user.accessToken
    var token = (body.session && body.session.user && body.session.user.accessToken) || ''

    try {
        // ── LAUNCH REQUEST ──
        if (requestType === 'LaunchRequest') {
            return alexaResp(res, 'Ola! Sou a assistente da Klinik Odontologia. Voce pode perguntar: quantos pacientes tenho hoje, minha agenda de amanha, proximo paciente, faltas de hoje ou aniversariantes do mes. O que deseja saber?', false)
        }

        // ── SESSION ENDED ──
        if (requestType === 'SessionEndedRequest') {
            return res.status(200).json({})
        }

        // ── INTENT REQUEST ──
        if (requestType === 'IntentRequest') {

            // Built-in intents
            if (intentName === 'AMAZON.HelpIntent') {
                return alexaResp(res, 'Voce pode me perguntar: quantos pacientes tenho hoje, quem sao meus pacientes de amanha, proximo paciente, faltas de hoje, ou aniversariantes do mes.', false)
            }
            if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
                return alexaResp(res, 'Ate logo! Bom trabalho na clinica!', true)
            }

            // Validate token
            if (!token) {
                return alexaResp(res, 'Voce precisa vincular sua conta primeiro. Abra o app Alexa, va na skill Klinik Odontologia e vincule sua conta com seu token pessoal.', true, true)
            }

            var client = getClient()

            // Validate user
            try { await client.execute("ALTER TABLE usuarios ADD COLUMN token_voz TEXT") } catch(e) {}
            var userR = await client.execute({ sql: "SELECT u.id, u.nome, u.perfil, u.clinica_id FROM usuarios u WHERE u.token_voz=? AND u.ativo=1", args: [token] })
            if (!userR.rows.length) {
                return alexaResp(res, 'Token invalido. Gere um novo token no sistema Klinik e vincule novamente.', true)
            }
            var user = userR.rows[0]
            var clinica_id = user.clinica_id
            var profNome = user.nome || ''
            var hoje = new Date().toISOString().slice(0, 10)
            var amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

            // ── AGENDA HOJE ──
            if (intentName === 'AgendaHojeIntent') {
                var ag = await getAgendamentos(client, hoje, clinica_id, profNome)
                if (!ag.length) return alexaResp(res, profNome.split(' ')[0] + ', voce nao tem pacientes agendados para hoje.', true)
                var resp = profNome.split(' ')[0] + ', voce tem ' + ag.length + ' paciente' + (ag.length > 1 ? 's' : '') + ' hoje. '
                ag.forEach(function(a, i) {
                    resp += (a.paciente_nome || 'Paciente').split(' ')[0] + ' as ' + (a.data_hora || '').slice(11, 16)
                    resp += i < ag.length - 1 ? ', ' : '. '
                })
                return alexaResp(res, resp, true)
            }

            // ── AGENDA AMANHA ──
            if (intentName === 'AgendaAmanhaIntent') {
                var ag2 = await getAgendamentos(client, amanha, clinica_id, profNome)
                if (!ag2.length) return alexaResp(res, profNome.split(' ')[0] + ', voce nao tem pacientes agendados para amanha.', true)
                var resp2 = profNome.split(' ')[0] + ', voce tem ' + ag2.length + ' paciente' + (ag2.length > 1 ? 's' : '') + ' amanha. '
                ag2.forEach(function(a, i) {
                    resp2 += (a.paciente_nome || 'Paciente').split(' ')[0] + ' as ' + (a.data_hora || '').slice(11, 16)
                    resp2 += i < ag2.length - 1 ? ', ' : '. '
                })
                return alexaResp(res, resp2, true)
            }

            // ── PROXIMO PACIENTE ──
            if (intentName === 'ProximoPacienteIntent') {
                var proxR = await client.execute({
                    sql: "SELECT a.data_hora, COALESCE(p.nome,a.paciente_nome) as paciente_nome, a.procedimento, a.tipo FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.data_hora >= datetime('now') AND a.clinica_id=? AND a.status NOT IN ('cancelado') AND (pr.nome LIKE ? OR a.profissional_nome LIKE ?) ORDER BY a.data_hora ASC LIMIT 1",
                    args: [clinica_id, '%' + profNome.split(' ')[0] + '%', '%' + profNome.split(' ')[0] + '%']
                })
                if (proxR.rows.length) {
                    var prox = proxR.rows[0]
                    var proxHora = (prox.data_hora || '').slice(11, 16)
                    var proxData = (prox.data_hora || '').slice(0, 10)
                    var proxDia = proxData === hoje ? 'hoje' : proxData === amanha ? 'amanha' : proxData.split('-').reverse().join('/')
                    return alexaResp(res, 'Seu proximo paciente e ' + (prox.paciente_nome || '').split(' ')[0] + ', ' + proxDia + ' as ' + proxHora + '.', true)
                }
                return alexaResp(res, 'Nao encontrei proximo agendamento.', true)
            }

            // ── FALTAS ──
            if (intentName === 'FaltasIntent') {
                var periodo = (slots.periodo && slots.periodo.value) || 'hoje'
                var dataF = periodo === 'amanha' ? amanha : hoje
                var fR = await client.execute({ sql: "SELECT COUNT(*) as total FROM agendamentos WHERE DATE(data_hora)=? AND (status='faltou' OR status LIKE '%falt%') AND clinica_id=?", args: [dataF, clinica_id] })
                var faltas = fR.rows[0].total || 0
                return alexaResp(res, faltas > 0 ? faltas + ' paciente' + (faltas > 1 ? 's' : '') + ' faltaram ' + periodo + '.' : 'Nenhuma falta registrada ' + periodo + '.', true)
            }

            // ── ANIVERSARIANTES ──
            if (intentName === 'AniversariantesIntent') {
                var mesStr = String(new Date().getMonth() + 1).padStart(2, '0')
                var anR = await client.execute({ sql: "SELECT nome FROM pacientes WHERE data_nascimento IS NOT NULL AND substr(data_nascimento,6,2)=? AND clinica_id=? LIMIT 10", args: [mesStr, clinica_id] })
                if (anR.rows.length) {
                    return alexaResp(res, anR.rows.length + ' aniversariantes este mes: ' + anR.rows.map(function(a) { return a.nome.split(' ')[0] }).join(', ') + '.', true)
                }
                return alexaResp(res, 'Nenhum aniversariante este mes.', true)
            }

            // ── QUANTOS PACIENTES ──
            if (intentName === 'QuantosPacientesIntent') {
                var periodo2 = (slots.periodo && slots.periodo.value) || 'hoje'
                var dataQ = periodo2 === 'amanha' ? amanha : hoje
                var qR = await client.execute({
                    sql: "SELECT COUNT(*) as total FROM agendamentos a LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND a.clinica_id=? AND a.status NOT IN ('cancelado') AND (pr.nome LIKE ? OR a.profissional_nome LIKE ?)",
                    args: [dataQ, clinica_id, '%' + profNome.split(' ')[0] + '%', '%' + profNome.split(' ')[0] + '%']
                })
                var total = qR.rows[0].total || 0
                return alexaResp(res, profNome.split(' ')[0] + ', voce tem ' + total + ' paciente' + (total !== 1 ? 's' : '') + ' ' + periodo2 + '.', true)
            }

            // Fallback
            return alexaResp(res, 'Desculpe, nao entendi. Voce pode perguntar: quantos pacientes hoje, minha agenda de amanha, proximo paciente, faltas ou aniversariantes.', false)
        }

        return alexaResp(res, 'Erro desconhecido.', true)

    } catch (error) {
        console.error('[alexa] Error:', error.message)
        return alexaResp(res, 'Ocorreu um erro ao consultar. Tente novamente.', true)
    }
}

function alexaResp(res, text, endSession, linkAccount) {
    var response = {
        version: '1.0',
        response: {
            outputSpeech: { type: 'PlainText', text: text },
            shouldEndSession: endSession !== false
        }
    }
    if (linkAccount) {
        response.response.card = { type: 'LinkAccount' }
    }
    return res.status(200).json(response)
}

async function getAgendamentos(client, data, clinica_id, profNome) {
    var r = await client.execute({
        sql: "SELECT a.data_hora, a.status, COALESCE(p.nome,a.paciente_nome) as paciente_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE DATE(a.data_hora)=? AND a.clinica_id=? AND a.status NOT IN ('cancelado') AND (pr.nome LIKE ? OR a.profissional_nome LIKE ?) ORDER BY a.data_hora ASC",
        args: [data, clinica_id, '%' + profNome.split(' ')[0] + '%', '%' + profNome.split(' ')[0] + '%']
    })
    return r.rows
}
