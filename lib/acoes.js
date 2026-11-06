// lib/acoes.js — Registro das ações dos usuários (relatório "Ações Usuários")
// Klinov — Campo Grande, MS
//
// api/data.js chama registrar() depois de toda escrita (POST/PUT/DELETE) que deu
// certo. Daqui sai uma linha em auditoria com operacao (I criação, U edição,
// D exclusão), o tipo de registro, a rota e o paciente envolvido, quando houver.

// Rotas que não são ações sobre registros (leitura por POST, chat, presença...)
var IGNORAR = /^(relatorio|busca|chat|notific|presenca|heartbeat|ping|preferenc|lida|visto|calc|simular|preview|validar|verificar|plano-encargos|parcela-encargos|asaas-sync|sync|db-status)/

var REGISTROS = [
    [/fichas?|prontuario|odontograma|evolucao|anamnese|receita|atestado|prescri/, 'ficha'],
    [/agend|agenda|alerta|lista-espera|bloqueio|cadeira/, 'agendamento'],
    [/orcament|tratament|procedimento-exec|executar/, 'plano_tratamento'],
    [/^plano|planos-|adesao/, 'plano'],
    [/parcela|baixa|receber/, 'parcela'],
    [/lancament|conta|fin-|financeiro|caixa|despesa|categoria|comiss|recibo|receita-saude|nfse|cobranca/, 'lancamento'],
    [/profission|especialidade/, 'profissional'],
    [/usuario|permiss|equipe/, 'usuario'],
    [/crc|crm|lead|tarefa|followup/, 'crc'],
    [/campanha|mensage|envio|whats/, 'campanha'],
    [/meta/, 'meta'],
    [/export|backup/, 'exportacao'],
    [/estoque|produto|protetico|laborat/, 'estoque'],
    [/assinatura|documento|termo|contrato|arquivo|foto/, 'documento'],
    [/config|clinica|preco|tabela/, 'configuracao'],
    [/pacient|dependente/, 'paciente']
]

function operacao(method, b) {
    var ac = String((b && (b.action || b.acao)) || '').toLowerCase()
    if (method === 'DELETE' || /excluir|delete|remover|apagar|lixeira|estornar|cancelar|inativar/.test(ac)) return 'D'
    if (/criar|novo|nova|add|abrir|aderir|incluir|inserir|importar|gerar|duplicar/.test(ac)) return 'I'
    if (ac) return 'U'
    return b && (b.id || b.registro_id) ? 'U' : 'I'
}

function tipoRegistro(route) {
    for (var i = 0; i < REGISTROS.length; i++) if (REGISTROS[i][0].test(route)) return REGISTROS[i][1]
    return route
}

function idPaciente(route, b, resposta) {
    var v = (b && (b.paciente_id || b.pacienteId)) || (resposta && resposta.paciente_id)
    if (!v && /^paciente/.test(route)) v = (b && b.id) || (resposta && resposta.id)
    v = parseInt(v, 10)
    return v > 0 ? v : null
}

function detalhe(route, b) {
    var t = (b && (b.nome || b.descricao || b.titulo || b.procedimento || b.procedimento_nome)) || ''
    var ac = (b && (b.action || b.acao)) || ''
    return (route + (ac ? ' · ' + ac : '') + (t ? ' · ' + String(t) : '')).slice(0, 300)
}

async function registrar(client, x) {
    var auth = x.auth, req = x.req, route = x.route, resposta = x.resposta
    if (!client || !auth || !x.clinica_id || req.method === 'GET' || req.method === 'OPTIONS') return
    if (IGNORAR.test(route)) return
    var st = Number(x.res && x.res.statusCode) || 200
    if (st >= 300 || (resposta && resposta.success === false)) return
    var b = req.body || {}
    try {
        await client.execute({
            sql: "INSERT INTO auditoria(clinica_id,usuario_id,usuario_nome,acao,detalhe,operacao,registro,rota,paciente_id,registro_id,criado_em) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now','-4 hours'))",
            args: [x.clinica_id, auth.usuario_id || auth.id || null, auth.nome || null, 'registro.' + route, detalhe(route, b), operacao(req.method, b), tipoRegistro(route), route, idPaciente(route, b, resposta),
                parseInt(b.id || (resposta && resposta.id), 10) || null]
        })
    } catch (e) { console.error('[acoes]', e.message) }
}

module.exports = { registrar, operacao, tipoRegistro }
