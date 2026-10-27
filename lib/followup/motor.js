// lib/followup/motor.js — Régua automática de follow-up de orçamentos (WhatsApp)
// Klinov — Campo Grande, MS
//
// Roda uma vez por dia (api/cron-confirmacoes.js?tarefa=followup) e, para cada
// clínica com o follow-up ligado:
//   1. Sincroniza: orçamento aprovado → convertido; reprovado/excluído → encerrado;
//      mensagem do paciente que ficou sem resposta → equipe
//   2. Inscreve orçamentos em aberto na régua (maiores valores primeiro, com
//      limite diário para proteger a reputação do número na Meta)
//   3. Envia a mensagem da vez (template aprovado) e registra no CRC
//
// Duas coisas separadas em cada follow-up:
//   • status      — onde está a conversa (ativo, conversando, transferido…)
//   • regua_ativa — se ainda pode receber mensagens AGENDADAS. Vai a 0 de vez em
//     "não tenho interesse", opt-out e encerramento: voltar a conversar nunca
//     religa a régua de vendas.
//
// Toda query filtra clinica_id. Nada sai sem cfg.ativo; em modo_teste tudo vai
// para o telefone de teste.

var textos = require('./textos')
var clinicorp = require('./clinicorp')
var { lerCfg } = require('../config')

// Padrões neutros: clube, convênio e prova social são da clínica e precisam ser
// ligados/preenchidos na Configuração antes de aparecer nas mensagens.
var PADRAO = {
    ativo: false,
    modo_teste: true,
    telefone_teste: '',
    dias: [2, 5, 10, 20],
    janela_dias: 90,
    valor_minimo: 0,
    limite_novos_dia: 30,
    limite_envios_dia: 80,
    pular_domingo: true,
    pausa_apos_resposta_dias: 3,
    carencia_dias: 60,
    parcelas_cartao: null,
    sem_juros: false,
    parcelas_clube: null,
    desconto_pix: null,
    entrada_boleto_pct: null,
    texto_pagamento: '',
    klinik_club: false,
    nome_clube: 'Klinik Club',
    prova_social: '',
    nome_equipe: 'nossa equipe',
    telefone_atendimento: '',
    ia_ativa: true,
    email_alerta: '',
    templates: { m1: 'klinik_tratamento_cuidado', m2: 'klinik_tratamento_duvidas', m3: 'klinik_tratamento_saude', m4: 'klinik_tratamento_ultima' }
}
// Status em que uma resposta do paciente ainda é atribuída ao follow-up
var ESCUTANDO = ['ativo', 'conversando', 'transferido', 'concluido', 'perdido', 'pausado']
var FINAIS = ['convertido', 'encerrado', 'optout']

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function maxData(a, b) { return a > b ? a : b }

async function lerCfgFollowup(client, clinica_id) {
    var cfg = await lerCfg(client, clinica_id)
    var fixo = process.env.FOLLOWUP_IGNORAR_CONFIG_FIXA === '1' ? {} : (require('./config-clinicas')[clinica_id] || {})
    var f = Object.assign({}, PADRAO, cfg.followup || {}, fixo)
    f.templates = Object.assign({}, PADRAO.templates, (cfg.followup || {}).templates || {}, fixo.templates || {})
    if (fixo.modo_teste !== undefined && process.env.FOLLOWUP_TELEFONE_TESTE) f.telefone_teste = String(process.env.FOLLOWUP_TELEFONE_TESTE).replace(/\D/g, '')
    var dias = Array.isArray(f.dias) ? f.dias.map(Number).filter(function (n) { return n >= 1 && n <= 120 }) : []
    f.dias = dias.length === 4 ? dias : PADRAO.dias.slice()
    return f
}

// Telefone no formato da Meta (55 + DDD + número)
function foneWa(t) {
    var d = String(t || '').replace(/\D/g, '')
    if (d.length < 10) return ''
    if (d.length <= 11) d = '55' + d
    return d
}
// Chave de comparação: DDD + 8 últimos dígitos (ignora o 55 e o nono dígito,
// que a Meta às vezes devolve sem). "" quando não dá para saber o DDD.
function chaveFone(t) {
    var d = String(t || '').replace(/\D/g, '')
    if (d.length >= 12 && d.slice(0, 2) === '55') d = d.slice(2)
    if (d.length < 10 || d.length > 11) return ''
    return d.slice(0, 2) + d.slice(-8)
}

// ── Envio pela API oficial (Cloud API) ───────────────────────────
// Usa o número da própria clínica quando cadastrado; senão o da plataforma.
var _cred = {}
async function credenciais(client, clinica_id) {
    if (_cred[clinica_id] && Date.now() - _cred[clinica_id].em < 300000) return _cred[clinica_id]
    var c = { token: process.env.WHATSAPP_TOKEN || '', phoneId: process.env.WHATSAPP_PHONE_ID || '', fonte: 'env', em: Date.now() }
    try {
        var r = (await client.execute({ sql: "SELECT whatsapp_token, whatsapp_phone_id FROM clinicas WHERE id=?", args: [clinica_id] })).rows[0]
        if (r && r.whatsapp_token && r.whatsapp_phone_id) { c.token = r.whatsapp_token; c.phoneId = r.whatsapp_phone_id; c.fonte = 'clinica' }
    } catch (e) { /* colunas ainda não existem: usa a plataforma */ }
    _cred[clinica_id] = c
    return c
}

async function chamarMeta(c, corpo) {
    if (!c.token || !c.phoneId) return { ok: false, erro: 'WhatsApp não configurado (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)' }
    try {
        var r = await fetch('https://graph.facebook.com/v23.0/' + c.phoneId + '/messages', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
        })
        var j = {}
        try { j = await r.json() } catch (e) {}
        // O phone_id não é segredo; ajuda a diagnosticar número errado/não registrado.
        if (!r.ok) return { ok: false, erro: ((j.error && (j.error.message + (j.error.code ? ' (' + j.error.code + ')' : ''))) || ('HTTP ' + r.status)).slice(0, 260) + ' [phone_id ' + c.phoneId + ' via ' + c.fonte + ']' }
        return { ok: true, id: (j.messages && j.messages[0] && j.messages[0].id) || null }
    } catch (e) { return { ok: false, erro: String(e.message || e).slice(0, 300) } }
}

async function enviarTemplate(client, clinica_id, fone, nome, params) {
    return chamarMeta(await credenciais(client, clinica_id), {
        messaging_product: 'whatsapp', to: fone, type: 'template',
        template: { name: nome, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: params.map(function (p) { return { type: 'text', text: p } }) }] }
    })
}

async function enviarTexto(client, clinica_id, fone, texto) {
    return chamarMeta(await credenciais(client, clinica_id), { messaging_product: 'whatsapp', to: fone, type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: false } })
}

// ── Registro ─────────────────────────────────────────────────────
// INSERT OR IGNORE: o índice único das mensagens recebidas (wa_message_id) faz
// a deduplicação dos reenvios da Meta de forma atômica. Devolve true se gravou.
async function registrarMensagem(client, fu, m) {
    var r = await client.execute({
        sql: "INSERT OR IGNORE INTO followup_mensagens(clinica_id,followup_id,direcao,autor,etapa,texto,wa_message_id,status,erro,criado_em) VALUES(?,?,?,?,?,?,?,?,?,?)",
        args: [fu.clinica_id, fu.id, m.direcao, m.autor, m.etapa || null, m.texto ? String(m.texto).slice(0, 4000) : null, m.wa_message_id || null, m.status || null, m.erro || null, agoraCG()]
    })
    return (r.rowsAffected || 0) === 1
}

// Atualiza o cartão do CRC (fila orçamentos em aberto) e grava a interação no
// histórico do paciente. Nunca rebaixa uma etapa que a equipe definiu à mão.
async function registrarCrc(client, fu, etapa, detalhes, retornarEm) {
    if (fu.teste) return
    try {
        var chave = 'orc:' + fu.orcamento_id
        var sobrescreve = etapa === 'retornar' ? "excluded.etapa" : "CASE WHEN crc_cartoes.etapa IN ('aberto','follow_up') THEN excluded.etapa ELSE crc_cartoes.etapa END"
        await client.execute({
            sql: "INSERT INTO crc_cartoes(clinica_id,fila,chave,paciente_id,paciente_nome,etapa,retornar_em,atualizado_em) VALUES(?,'orcamentos_abertos',?,?,?,?,?,datetime('now','-4 hours')) " +
                "ON CONFLICT(clinica_id,fila,chave) DO UPDATE SET etapa=" + sobrescreve + ", retornar_em=CASE WHEN excluded.etapa='retornar' THEN excluded.retornar_em ELSE crc_cartoes.retornar_em END, atualizado_em=datetime('now','-4 hours')",
            args: [fu.clinica_id, chave, fu.paciente_id || null, fu.paciente_nome || null, etapa, retornarEm || null]
        })
        await client.execute({
            sql: "INSERT INTO crc_interacoes(clinica_id,paciente_id,paciente_nome,fila,chave,forma,etapa,detalhes,retornar_em,usuario_id,usuario_nome,criado_em) VALUES(?,?,?,'orcamentos_abertos',?,'whatsapp',?,?,?,NULL,'Follow-up automático',datetime('now','-4 hours'))",
            args: [fu.clinica_id, fu.paciente_id || null, fu.paciente_nome || null, chave, etapa, String(detalhes || '').slice(0, 2000), retornarEm || null]
        })
    } catch (e) { console.error('[followup] CRC:', e.message) }
}

async function atualizar(client, fu, campos) {
    var ks = Object.keys(campos)
    if (!ks.length) return
    await client.execute({
        sql: "UPDATE orcamento_followups SET " + ks.map(function (k) { return k + '=?' }).join(',') + ",atualizado_em=? WHERE id=? AND clinica_id=?",
        args: ks.map(function (k) { return campos[k] }).concat([agoraCG(), fu.id, fu.clinica_id])
    })
    Object.assign(fu, campos)
}

// Avisa a equipe (e-mail) quando um paciente pede atendimento humano
async function avisarEquipe(client, fu, cfg, assunto, corpo) {
    try {
        var rk = process.env.RESEND_API_KEY || ''
        var destino = cfg.email_alerta
        if (!destino) { var c = (await client.execute({ sql: "SELECT email FROM clinicas WHERE id=?", args: [fu.clinica_id] })).rows[0]; destino = c && c.email }
        if (!rk || !destino) return
        var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;') }
        // Últimas mensagens da conversa, para quem atende não precisar de outro sistema
        if (fu.id) {
            var ms = (await client.execute({ sql: "SELECT direcao, autor, texto, criado_em FROM followup_mensagens WHERE followup_id=? AND clinica_id=? AND direcao IN ('entrada','saida') AND texto IS NOT NULL ORDER BY id DESC LIMIT 8", args: [fu.id, fu.clinica_id] })).rows.reverse()
            if (ms.length) corpo += '\n\n— Conversa —\n' + ms.map(function (m) {
                var quem = m.direcao === 'entrada' ? 'Paciente' : m.autor === 'regua' ? 'Mensagem automática' : m.autor === 'ia' ? 'Assistente virtual' : 'Clínica'
                return String(m.criado_em || '').slice(11, 16) + ' ' + quem + ': ' + String(m.texto).replace(/^\[TESTE → \d+\] /, '').slice(0, 600)
            }).join('\n\n')
        }
        await fetch('https://api.resend.com/emails', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + rk, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'noreply@klinov.com.br', to: [destino], subject: assunto, html: esc(corpo).replace(/\n/g, '<br>') })
        })
    } catch (e) { console.error('[followup] aviso:', e.message) }
}

// Passa a conversa para a equipe: status, CRC ("Retornar novamente" hoje) e e-mail
async function transferir(client, fu, cfg, motivo, resumo) {
    await atualizar(client, fu, { status: 'transferido', transferido_em: agoraCG(), resumo_equipe: String(resumo || motivo || '').slice(0, 600) })
    await registrarCrc(client, fu, 'retornar', 'Paciente respondeu ao follow-up e precisa da equipe: ' + (resumo || motivo), hojeCG())
    await avisarEquipe(client, fu, cfg, (fu.teste ? '[TESTE] ' : '') + 'Follow-up: ' + (fu.paciente_nome || 'paciente') + ' quer falar com a equipe',
        'Paciente: ' + (fu.paciente_nome || '') + '\nTelefone: ' + (fu.telefone || '') + '\nOrçamento #' + fu.orcamento_id + ' · ' + textos.moeda(fu.valor) +
        '\nMotivo: ' + (motivo || '') + (resumo ? '\nResumo: ' + resumo : '') +
        '\n\nPróximo passo: chamar o paciente pelo WhatsApp da clínica' + (cfg.telefone_atendimento ? ' (' + textos.foneBr(cfg.telefone_atendimento) + ')' : '') + ' e agendar. O paciente já foi avisado de que será chamado. Quando o orçamento for aprovado no Clinicorp, o follow-up para sozinho.')
}

// Opt-out por telefone: vale para todos os pacientes e follow-ups da clínica
// com aquele número (mãe e filho no mesmo celular, por exemplo)
async function optoutTelefone(client, clinica_id, fone) {
    var chave = chaveFone(fone)
    if (!chave) return 0
    await client.execute({ sql: "UPDATE orcamento_followups SET status=CASE WHEN status IN ('convertido','encerrado') THEN status ELSE 'optout' END, regua_ativa=0, atualizado_em=? WHERE clinica_id=? AND fone_chave=?", args: [agoraCG(), clinica_id, chave] })
    var pacs = (await client.execute({ sql: "SELECT id, telefone, whatsapp FROM pacientes WHERE clinica_id=? AND COALESCE(aceita_marketing,1)=1 AND (substr(replace(replace(replace(replace(telefone,' ',''),'-',''),'(',''),')',''),-8)=? OR substr(replace(replace(replace(replace(whatsapp,' ',''),'-',''),'(',''),')',''),-8)=?)", args: [clinica_id, chave.slice(-8), chave.slice(-8)] })).rows
    var n = 0
    for (var i = 0; i < pacs.length; i++) {
        if (chaveFone(pacs[i].telefone) !== chave && chaveFone(pacs[i].whatsapp) !== chave) continue
        await client.execute({ sql: "UPDATE pacientes SET aceita_marketing=0 WHERE id=? AND clinica_id=?", args: [pacs[i].id, clinica_id] })
        n++
    }
    return n
}

// Contexto para montar mensagens (orçamento, itens, categoria, clínica)
async function contexto(client, fu, cfg) {
    var o = (await client.execute({ sql: "SELECT * FROM orcamentos WHERE id=? AND clinica_id=?", args: [fu.orcamento_id, fu.clinica_id] })).rows[0]
    if (!o) return null
    var itens = (await client.execute({ sql: "SELECT procedimento_nome, dente, regiao, valor_unitario, quantidade FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=? ORDER BY id", args: [o.id, fu.clinica_id] })).rows
    var cli = (await client.execute({ sql: "SELECT nome, endereco, numero, bairro, cidade, estado, telefone FROM clinicas WHERE id=?", args: [fu.clinica_id] })).rows[0] || {}
    return {
        orcamento: o, itens: itens, clinica: cli, clinica_nome: cli.nome, cfg: cfg, hoje: hojeCG(),
        categoria: fu.categoria || textos.categoriaDoOrcamento(itens), paciente_nome: fu.paciente_nome, valor: Number(fu.valor) || 0
    }
}

// ── 1. Sincronizar status com os orçamentos ──────────────────────
async function sincronizar(client, clinica_id, cfg) {
    var r = { convertidos: 0, encerrados: 0, sem_resposta: 0 }
    var abertos = await client.execute({
        sql: "SELECT f.*, o.status orc_status, o.id oid FROM orcamento_followups f LEFT JOIN orcamentos o ON o.id=f.orcamento_id AND o.clinica_id=f.clinica_id WHERE f.clinica_id=? AND f.status NOT IN ('convertido','encerrado','optout')",
        args: [clinica_id]
    })
    for (var i = 0; i < abertos.rows.length; i++) {
        var fu = abertos.rows[i]
        if (fu.orc_status === 'aprovado') {
            await atualizar(client, fu, { status: 'convertido', convertido_em: agoraCG(), regua_ativa: 0 })
            r.convertidos++
        } else if (!fu.oid || fu.orc_status === 'reprovado' || fu.orc_status === 'desaprovado' || fu.orc_status === 'cancelado') {
            await atualizar(client, fu, { status: 'encerrado', regua_ativa: 0 })
            r.encerrados++
        }
    }
    // Rede de segurança: paciente escreveu há mais de 30 min e ninguém respondeu
    // (a IA caiu no meio, a função estourou o tempo…) → equipe assume
    var limite = new Date(Date.now() - 4 * 3600 * 1000 - 30 * 60000).toISOString().slice(0, 19).replace('T', ' ')
    var orfas = await client.execute({
        sql: "SELECT f.* FROM orcamento_followups f WHERE f.clinica_id=? AND f.status IN ('ativo','conversando','concluido','perdido') " +
            "AND (SELECT m.direcao FROM followup_mensagens m WHERE m.followup_id=f.id AND m.clinica_id=f.clinica_id AND m.direcao IN ('entrada','saida') ORDER BY m.id DESC LIMIT 1)='entrada' " +
            "AND (SELECT m.criado_em FROM followup_mensagens m WHERE m.followup_id=f.id AND m.clinica_id=f.clinica_id AND m.direcao='entrada' ORDER BY m.id DESC LIMIT 1)<?",
        args: [clinica_id, limite]
    })
    for (var j = 0; j < orfas.rows.length; j++) {
        await transferir(client, orfas.rows[j], cfg, 'Mensagem do paciente ficou sem resposta automática', orfas.rows[j].resumo_equipe)
        r.sem_resposta++
    }
    return r
}

// Quantos registros/mensagens de hoje (limites contados no banco, não por execução)
async function contarHoje(client, clinica_id, teste, hoje) {
    var a = (await client.execute({ sql: "SELECT COUNT(*) n FROM orcamento_followups WHERE clinica_id=? AND COALESCE(teste,0)=? AND substr(criado_em,1,10)=?", args: [clinica_id, teste, hoje] })).rows[0]
    var b = (await client.execute({ sql: "SELECT COUNT(*) n FROM followup_mensagens m JOIN orcamento_followups f ON f.id=m.followup_id AND f.clinica_id=m.clinica_id WHERE m.clinica_id=? AND COALESCE(f.teste,0)=? AND m.autor='regua' AND m.status<>'erro' AND substr(m.criado_em,1,10)=?", args: [clinica_id, teste, hoje] })).rows[0]
    return { novos: Number(a.n) || 0, envios: Number(b.n) || 0 }
}

// ── 2. Inscrever orçamentos em aberto ────────────────────────────
async function inscrever(client, clinica_id, cfg, hoje) {
    var teste = cfg.modo_teste ? 1 : 0
    var limiteCfg = cfg.modo_teste ? Math.min(3, cfg.limite_novos_dia) : Math.max(0, parseInt(cfg.limite_novos_dia, 10) || 0)
    var limite = limiteCfg - (await contarHoje(client, clinica_id, teste, hoje)).novos
    if (limite <= 0) return 0
    var ate = addDias(hoje, -cfg.dias[0]), de = addDias(hoje, -Math.max(cfg.janela_dias, cfg.dias[0]))
    var carencia = addDias(hoje, -(parseInt(cfg.carencia_dias, 10) || 0))
    var cand = await client.execute({
        sql: "SELECT o.id, o.paciente_id, o.data_criacao, (COALESCE(o.valor_total,0)-COALESCE(o.desconto,0)) valor, p.nome, COALESCE(NULLIF(p.whatsapp,''),p.telefone) fone " +
            "FROM orcamentos o JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id " +
            "WHERE o.clinica_id=? AND COALESCE(o.status,'aberto')='aberto' AND substr(o.data_criacao,1,10) BETWEEN ? AND ? " +
            (cfg._fonte_clinicorp ? "AND o.clinicorp_id IS NOT NULL " : "") +
            "AND (COALESCE(o.valor_total,0)-COALESCE(o.desconto,0))>0 AND (COALESCE(o.valor_total,0)-COALESCE(o.desconto,0))>=? " +
            "AND COALESCE(p.aceita_marketing,1)=1 AND COALESCE(p.ativo,1)=1 AND COALESCE(NULLIF(p.whatsapp,''),p.telefone,'')<>'' " +
            "AND NOT EXISTS (SELECT 1 FROM orcamento_followups f WHERE f.clinica_id=o.clinica_id AND f.orcamento_id=o.id) " +
            // um follow-up por paciente: em andamento, recusado/opt-out (nunca mais) ou terminado há pouco (carência)
            "AND NOT EXISTS (SELECT 1 FROM orcamento_followups f2 WHERE f2.clinica_id=o.clinica_id AND f2.paciente_id=o.paciente_id AND (" +
                "f2.status IN ('ativo','conversando','transferido','pausado','perdido','optout') OR substr(f2.atualizado_em,1,10)>=?)) " +
            // quem já aprovou outro orçamento depois deste provavelmente fechou por outro caminho
            "AND NOT EXISTS (SELECT 1 FROM orcamentos o2 WHERE o2.clinica_id=o.clinica_id AND o2.paciente_id=o.paciente_id AND o2.status='aprovado' AND substr(COALESCE(o2.data_aprovacao,o2.data_criacao),1,10)>=substr(o.data_criacao,1,10)) " +
            "ORDER BY valor DESC LIMIT ?",
        args: [clinica_id, de, ate, Number(cfg.valor_minimo) || 0, carencia, limite * 4]
    })
    // Mesma regra por TELEFONE (vários pacientes no mesmo celular)
    var ocupados = {}
    ;(await client.execute({ sql: "SELECT fone_chave FROM orcamento_followups WHERE clinica_id=? AND fone_chave IS NOT NULL AND (status IN ('ativo','conversando','transferido','pausado','perdido','optout') OR substr(atualizado_em,1,10)>=?)", args: [clinica_id, carencia] }))
        .rows.forEach(function (r) { ocupados[r.fone_chave] = 1 })
    var feitos = 0
    for (var i = 0; i < cand.rows.length && feitos < limite; i++) {
        var c = cand.rows[i], chave = chaveFone(c.fone)
        if (!chave || ocupados[chave]) continue
        ocupados[chave] = 1
        var itens = (await client.execute({ sql: "SELECT procedimento_nome, valor_unitario, quantidade FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?", args: [c.id, clinica_id] })).rows
        // base: para orçamentos recentes, a data de criação; para o acúmulo
        // antigo, "como se tivesse sido criado há dias[0] dias" → 1ª mensagem hoje
        var base = maxData(String(c.data_criacao).slice(0, 10), ate)
        var ins = await client.execute({
            sql: "INSERT OR IGNORE INTO orcamento_followups(clinica_id,orcamento_id,paciente_id,paciente_nome,telefone,fone_chave,valor,categoria,base_data,etapa,status,regua_ativa,ia_ativa,teste,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,0,'ativo',1,?,?,?,?)",
            args: [clinica_id, c.id, c.paciente_id, c.nome, foneWa(c.fone), chave, Number(c.valor) || 0, textos.categoriaDoOrcamento(itens), base, cfg.ia_ativa ? 1 : 0, teste, agoraCG(), agoraCG()]
        })
        if (ins.rowsAffected) feitos++
    }
    return feitos
}

// Paciente com consulta marcada de hoje em diante: não empurra mensagem de venda
async function temConsultaFutura(client, clinica_id, paciente_id, hoje) {
    if (!paciente_id) return false
    try {
        var c = await client.execute({ sql: "SELECT 1 FROM followup_consultas fc JOIN pacientes p ON p.clinicorp_id=fc.clinicorp_paciente_id AND p.clinica_id=fc.clinica_id WHERE fc.clinica_id=? AND p.id=? AND fc.data>=? LIMIT 1", args: [clinica_id, paciente_id, hoje] })
        if (c.rows.length) return true
    } catch (e) { /* tabela ainda não existe */ }
    var r = await client.execute({ sql: "SELECT 1 FROM agendamentos WHERE clinica_id=? AND paciente_id=? AND substr(data_hora,1,10)>=? AND COALESCE(status,'') NOT IN ('desmarcado','cancelado','faltou') LIMIT 1", args: [clinica_id, paciente_id, hoje] })
    return r.rows.length > 0
}

// ── 3. Enviar a mensagem da vez ──────────────────────────────────
async function enviarEtapa(client, fu, cfg, etapa, hoje) {
    hoje = hoje || hojeCG()
    if (!!fu.teste !== !!cfg.modo_teste) return { ok: false, erro: 'Registro de outro modo (teste/produção)' }
    var ctx = await contexto(client, fu, cfg)
    if (!ctx) { await atualizar(client, fu, { status: 'encerrado', regua_ativa: 0 }); return { ok: false, erro: 'orçamento não encontrado' } }
    var msg = textos.montarMensagem(etapa, ctx)
    var destino = fu.teste ? foneWa(cfg.telefone_teste) : fu.telefone
    if (!destino) return { ok: false, erro: cfg.modo_teste ? 'Modo teste sem telefone de teste' : 'Paciente sem telefone' }

    // Reserva atômica: só um processo (cron, botão "rodar agora", retentativa)
    // consegue avançar esta etapa hoje. Quem perder a corrida não envia.
    var agora = agoraCG(), anterior = { etapa: fu.etapa, ultimo_envio: fu.ultimo_envio || null }
    var res = await client.execute({
        sql: "UPDATE orcamento_followups SET etapa=?, ultimo_envio=?, atualizado_em=? WHERE id=? AND clinica_id=? AND etapa=? AND regua_ativa=1 AND (ultimo_envio IS NULL OR substr(ultimo_envio,1,10)<?)",
        args: [etapa, agora, agora, fu.id, fu.clinica_id, etapa - 1, hoje]
    })
    if ((res.rowsAffected || 0) !== 1) return { ok: false, pulado: true, erro: 'já enviado por outra execução' }

    var nomeTpl = cfg.templates[msg.template.chave] || msg.template.nome_padrao
    var r = await enviarTemplate(client, fu.clinica_id, destino, nomeTpl, msg.params)
    await registrarMensagem(client, fu, { direcao: 'saida', autor: 'regua', etapa: etapa, texto: (fu.teste ? '[TESTE → ' + destino + '] ' : '') + msg.texto, wa_message_id: r.id, status: r.ok ? 'enviado' : 'erro', erro: r.erro })
    if (!r.ok) {
        // devolve a reserva para tentar de novo na próxima execução
        await client.execute({ sql: "UPDATE orcamento_followups SET etapa=?, ultimo_envio=? WHERE id=? AND clinica_id=? AND etapa=?", args: [anterior.etapa, anterior.ultimo_envio, fu.id, fu.clinica_id, etapa] })
        return r
    }
    fu.etapa = etapa; fu.ultimo_envio = agora
    if (etapa >= 4 && fu.status === 'ativo') await atualizar(client, fu, { status: 'concluido' })
    await registrarCrc(client, fu, 'follow_up', 'Follow-up automático ' + etapa + '/4 enviado (' + msg.template.papel + ')')
    return r
}

async function executarClinica(client, clinica_id, opts) {
    opts = opts || {}
    var hoje = opts.hoje || hojeCG()
    var cfg = await lerCfgFollowup(client, clinica_id)
    var res = { clinica_id: clinica_id, ativo: !!cfg.ativo, modo_teste: !!cfg.modo_teste, convertidos: 0, encerrados: 0, sem_resposta: 0, inscritos: 0, enviados: 0, erros: 0, pulados: 0, detalhes: [] }
    var usaClinicorp = clinicorp.configurado() && clinica_id === clinicorp.clinicaDoClinicorp()
    if (usaClinicorp && (cfg.ativo || opts.sincronizar)) {
        try { res.clinicorp = await clinicorp.sincronizar(client, clinica_id, cfg, { hoje: opts.hoje, obter: opts.obterClinicorp }) }
        catch (e) { console.error('[followup] Clinicorp:', e.message); res.clinicorp = { erro: e.message } }
    }
    if (!cfg.ativo) return res
    // Clinicorp fora do ar hoje: não mexe na régua (status podem estar velhos)
    if (usaClinicorp && (!res.clinicorp || res.clinicorp.erro || (res.clinicorp.orcamentos && res.clinicorp.orcamentos.falhas.length && !res.clinicorp.orcamentos.recebidos))) { res.msg = 'Clinicorp indisponível: régua não rodou hoje'; return res }
    cfg._fonte_clinicorp = usaClinicorp
    var s = await sincronizar(client, clinica_id, cfg)
    res.convertidos = s.convertidos; res.encerrados = s.encerrados; res.sem_resposta = s.sem_resposta
    if (cfg.pular_domingo && new Date(hoje + 'T12:00:00Z').getUTCDay() === 0) { res.msg = 'Domingo: sem envios'; return res }
    if (cfg.modo_teste && !foneWa(cfg.telefone_teste)) { res.msg = 'Modo teste ligado sem telefone de teste: nada enviado'; return res }
    res.inscritos = await inscrever(client, clinica_id, cfg, hoje)

    var teste = cfg.modo_teste ? 1 : 0
    var limiteEnvios = Math.max(0, parseInt(cfg.limite_envios_dia, 10) || 0) - (await contarHoje(client, clinica_id, teste, hoje)).envios
    var pausa = addDias(hoje, -(parseInt(cfg.pausa_apos_resposta_dias, 10) || 0))
    var fila = await client.execute({
        sql: "SELECT f.* FROM orcamento_followups f JOIN pacientes p ON p.id=f.paciente_id AND p.clinica_id=f.clinica_id " +
            "WHERE f.clinica_id=? AND f.status IN ('ativo','conversando') AND f.regua_ativa=1 AND f.etapa<4 AND COALESCE(f.teste,0)=? " +
            "AND COALESCE(p.aceita_marketing,1)=1 AND COALESCE(p.ativo,1)=1 ORDER BY f.valor DESC",
        args: [clinica_id, teste]
    })
    for (var i = 0; i < fila.rows.length; i++) {
        if (res.enviados >= limiteEnvios) { res.msg = 'Limite diário de envios atingido'; break }
        var fu = fila.rows[i], prox = fu.etapa + 1
        if (hoje < addDias(fu.base_data, cfg.dias[prox - 1])) continue
        // Não envia no mesmo dia de outro envio, nem logo depois de o paciente falar
        if (fu.ultimo_envio && String(fu.ultimo_envio).slice(0, 10) >= hoje) continue
        if (fu.ultima_resposta && String(fu.ultima_resposta).slice(0, 10) > pausa) { res.pulados++; continue }
        if (await temConsultaFutura(client, clinica_id, fu.paciente_id, hoje)) { res.pulados++; continue }
        var r = await enviarEtapa(client, fu, cfg, prox, hoje)
        if (r.ok) res.enviados++
        else if (r.pulado) res.pulados++
        else { res.erros++; res.detalhes.push({ followup: fu.id, erro: r.erro }) }
    }
    return res
}

// Sai do modo teste: apaga os registros de teste para os pacientes reais
// começarem a régua do zero
async function limparTeste(client, clinica_id) {
    await client.execute({ sql: "DELETE FROM followup_mensagens WHERE clinica_id=? AND followup_id IN (SELECT id FROM orcamento_followups WHERE clinica_id=? AND teste=1)", args: [clinica_id, clinica_id] })
    var r = await client.execute({ sql: "DELETE FROM orcamento_followups WHERE clinica_id=? AND teste=1", args: [clinica_id] })
    return r.rowsAffected || 0
}

async function executarTodas(client, opts) {
    var cl = await client.execute("SELECT id FROM clinicas ORDER BY id")
    var out = []
    for (var i = 0; i < cl.rows.length; i++) {
        try { out.push(await executarClinica(client, cl.rows[i].id, opts)) }
        catch (e) { console.error('[followup] clínica ' + cl.rows[i].id + ':', e.message); out.push({ clinica_id: cl.rows[i].id, erro: e.message }) }
    }
    return out
}

module.exports = {
    PADRAO, ESCUTANDO, FINAIS,
    lerCfgFollowup, executarClinica, executarTodas, limparTeste, enviarEtapa, contexto,
    enviarTexto, enviarTemplate, registrarMensagem, registrarCrc, atualizar, avisarEquipe, transferir, optoutTelefone,
    foneWa, chaveFone, hojeCG, agoraCG, addDias
}
