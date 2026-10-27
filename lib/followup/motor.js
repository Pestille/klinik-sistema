// lib/followup/motor.js — Régua automática de follow-up de orçamentos (WhatsApp)
// Klinov — Campo Grande, MS
//
// Roda uma vez por dia (api/cron-confirmacoes.js?tarefa=followup) e, para cada
// clínica com o follow-up ligado:
//   1. Sincroniza: orçamento aprovado → convertido; reprovado/excluído → encerrado
//   2. Inscreve orçamentos em aberto na régua (maiores valores primeiro, com
//      limite diário para proteger a reputação do número na Meta)
//   3. Envia a mensagem da vez (template aprovado) e registra no CRC
//
// Toda query filtra clinica_id. Nada sai sem cfg.ativo; em modo_teste tudo vai
// para o telefone de teste.

var textos = require('./textos')
var { lerCfg } = require('../config')

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
    parcelas_cartao: null,
    desconto_pix: null,
    texto_pagamento: '',
    klinik_club: true,
    nome_clube: 'Klinik Club',
    sulamerica: true,
    prova_social: 'mais de 2.500 pacientes já confiaram o sorriso deles a nós',
    nome_equipe: 'nossa equipe',
    ia_ativa: true,
    email_alerta: '',
    templates: { m1: 'klinik_orcamento_valor', m2: 'klinik_orcamento_duvidas', m3: 'klinik_orcamento_adiar', m4: 'klinik_orcamento_ultima' }
}
// Status em que o paciente ainda está "na régua" (recebe mensagens agendadas)
var EM_REGUA = ['ativo', 'conversando']
// Status em que uma resposta do paciente ainda é atribuída ao follow-up
var ESCUTANDO = ['ativo', 'conversando', 'transferido', 'concluido', 'perdido', 'pausado']
var FINAIS = ['convertido', 'encerrado', 'optout']

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function maxData(a, b) { return a > b ? a : b }

async function lerCfgFollowup(client, clinica_id) {
    var cfg = await lerCfg(client, clinica_id)
    var f = Object.assign({}, PADRAO, cfg.followup || {})
    f.templates = Object.assign({}, PADRAO.templates, (cfg.followup || {}).templates || {})
    var dias = Array.isArray(f.dias) ? f.dias.map(Number).filter(function (n) { return n >= 0 && n <= 120 }) : []
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
// Últimos 8 dígitos: casa com/sem 55 e com/sem o nono dígito
function chaveFone(t) { var d = String(t || '').replace(/\D/g, ''); return d.slice(-8) }

// ── Envio pela API oficial (Cloud API) ───────────────────────────
function credenciais() { return { token: process.env.WHATSAPP_TOKEN || '', phoneId: process.env.WHATSAPP_PHONE_ID || '' } }

async function chamarMeta(corpo) {
    var c = credenciais()
    if (!c.token || !c.phoneId) return { ok: false, erro: 'WhatsApp não configurado (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)' }
    try {
        var r = await fetch('https://graph.facebook.com/v23.0/' + c.phoneId + '/messages', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
        })
        var j = {}
        try { j = await r.json() } catch (e) {}
        if (!r.ok) return { ok: false, erro: ((j.error && (j.error.message + (j.error.code ? ' (' + j.error.code + ')' : ''))) || ('HTTP ' + r.status)).slice(0, 300) }
        return { ok: true, id: (j.messages && j.messages[0] && j.messages[0].id) || null }
    } catch (e) { return { ok: false, erro: String(e.message || e).slice(0, 300) } }
}

async function enviarTemplate(fone, nome, params) {
    return chamarMeta({
        messaging_product: 'whatsapp', to: fone, type: 'template',
        template: { name: nome, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: params.map(function (p) { return { type: 'text', text: p } }) }] }
    })
}

async function enviarTexto(fone, texto) {
    return chamarMeta({ messaging_product: 'whatsapp', to: fone, type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: false } })
}

// ── Registro ─────────────────────────────────────────────────────
async function registrarMensagem(client, fu, m) {
    await client.execute({
        sql: "INSERT INTO followup_mensagens(clinica_id,followup_id,direcao,autor,etapa,texto,wa_message_id,status,erro,criado_em) VALUES(?,?,?,?,?,?,?,?,?,?)",
        args: [fu.clinica_id, fu.id, m.direcao, m.autor, m.etapa || null, m.texto ? String(m.texto).slice(0, 4000) : null, m.wa_message_id || null, m.status || null, m.erro || null, agoraCG()]
    })
}

// Atualiza o cartão do CRC (fila orçamentos em aberto) e grava a interação no
// histórico do paciente. Nunca rebaixa uma etapa que a equipe definiu à mão.
async function registrarCrc(client, fu, etapa, detalhes, retornarEm) {
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
        await fetch('https://api.resend.com/emails', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + rk, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'noreply@klinov.com.br', to: [destino], subject: assunto, html: esc(corpo).replace(/\n/g, '<br>') })
        })
    } catch (e) { console.error('[followup] aviso:', e.message) }
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
async function sincronizar(client, clinica_id) {
    var r = { convertidos: 0, encerrados: 0 }
    var abertos = await client.execute({
        sql: "SELECT f.id, f.clinica_id, f.orcamento_id, f.paciente_id, f.paciente_nome, f.status, o.status orc_status, o.id oid FROM orcamento_followups f LEFT JOIN orcamentos o ON o.id=f.orcamento_id AND o.clinica_id=f.clinica_id WHERE f.clinica_id=? AND f.status NOT IN ('convertido','encerrado','optout')",
        args: [clinica_id]
    })
    for (var i = 0; i < abertos.rows.length; i++) {
        var fu = abertos.rows[i]
        if (fu.orc_status === 'aprovado') {
            await atualizar(client, fu, { status: 'convertido', convertido_em: agoraCG() })
            r.convertidos++
        } else if (!fu.oid || fu.orc_status === 'reprovado' || fu.orc_status === 'desaprovado' || fu.orc_status === 'cancelado') {
            await atualizar(client, fu, { status: 'encerrado' })
            r.encerrados++
        }
    }
    return r
}

// ── 2. Inscrever orçamentos em aberto ────────────────────────────
async function inscrever(client, clinica_id, cfg, hoje) {
    var limite = cfg.modo_teste ? Math.min(3, cfg.limite_novos_dia) : Math.max(0, parseInt(cfg.limite_novos_dia, 10) || 0)
    if (!limite) return 0
    var ate = addDias(hoje, -cfg.dias[0]), de = addDias(hoje, -Math.max(cfg.janela_dias, cfg.dias[0]))
    var cand = await client.execute({
        sql: "SELECT o.id, o.paciente_id, o.data_criacao, (COALESCE(o.valor_total,0)-COALESCE(o.desconto,0)) valor, p.nome, COALESCE(NULLIF(p.whatsapp,''),p.telefone) fone " +
            "FROM orcamentos o JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id " +
            "WHERE o.clinica_id=? AND COALESCE(o.status,'aberto')='aberto' AND substr(o.data_criacao,1,10) BETWEEN ? AND ? " +
            "AND (COALESCE(o.valor_total,0)-COALESCE(o.desconto,0))>=? AND COALESCE(p.aceita_marketing,1)=1 AND COALESCE(p.ativo,1)=1 " +
            "AND COALESCE(NULLIF(p.whatsapp,''),p.telefone,'')<>'' " +
            "AND NOT EXISTS (SELECT 1 FROM orcamento_followups f WHERE f.clinica_id=o.clinica_id AND f.orcamento_id=o.id) " +
            // um paciente por vez: se já há outro orçamento dele na régua ou em conversa, espera
            "AND NOT EXISTS (SELECT 1 FROM orcamento_followups f2 WHERE f2.clinica_id=o.clinica_id AND f2.paciente_id=o.paciente_id AND f2.status IN ('ativo','conversando','transferido','pausado')) " +
            // quem já aprovou outro orçamento depois deste provavelmente fechou por outro caminho
            "AND NOT EXISTS (SELECT 1 FROM orcamentos o2 WHERE o2.clinica_id=o.clinica_id AND o2.paciente_id=o.paciente_id AND o2.status='aprovado' AND substr(COALESCE(o2.data_aprovacao,o2.data_criacao),1,10)>=substr(o.data_criacao,1,10)) " +
            "ORDER BY valor DESC LIMIT ?",
        args: [clinica_id, de, ate, Number(cfg.valor_minimo) || 0, limite * 3]
    })
    var feitos = 0, pacientes = {}
    for (var i = 0; i < cand.rows.length && feitos < limite; i++) {
        var c = cand.rows[i]
        if (pacientes[c.paciente_id] || !foneWa(c.fone)) continue
        pacientes[c.paciente_id] = 1
        var itens = (await client.execute({ sql: "SELECT procedimento_nome, valor_unitario, quantidade FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?", args: [c.id, clinica_id] })).rows
        // base: para orçamentos recentes, a data de criação; para o acúmulo
        // antigo, "como se tivesse sido criado há dias[0] dias" → 1ª mensagem hoje
        var base = maxData(String(c.data_criacao).slice(0, 10), ate)
        await client.execute({
            sql: "INSERT OR IGNORE INTO orcamento_followups(clinica_id,orcamento_id,paciente_id,paciente_nome,telefone,valor,categoria,base_data,etapa,status,ia_ativa,teste,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,0,'ativo',?,?,?,?)",
            args: [clinica_id, c.id, c.paciente_id, c.nome, foneWa(c.fone), Number(c.valor) || 0, textos.categoriaDoOrcamento(itens), base, cfg.ia_ativa ? 1 : 0, cfg.modo_teste ? 1 : 0, agoraCG(), agoraCG()]
        })
        feitos++
    }
    return feitos
}

// Paciente com consulta marcada de hoje em diante: não empurra mensagem de venda
async function temConsultaFutura(client, clinica_id, paciente_id, hoje) {
    if (!paciente_id) return false
    var r = await client.execute({ sql: "SELECT 1 FROM agendamentos WHERE clinica_id=? AND paciente_id=? AND substr(data_hora,1,10)>=? AND COALESCE(status,'') NOT IN ('desmarcado','cancelado','faltou') LIMIT 1", args: [clinica_id, paciente_id, hoje] })
    return r.rows.length > 0
}

// ── 3. Enviar a mensagem da vez ──────────────────────────────────
async function enviarEtapa(client, fu, cfg, etapa) {
    var ctx = await contexto(client, fu, cfg)
    if (!ctx) { await atualizar(client, fu, { status: 'encerrado' }); return { ok: false, erro: 'orçamento não encontrado' } }
    var msg = textos.montarMensagem(etapa, ctx)
    if (!!fu.teste !== !!cfg.modo_teste) return { ok: false, erro: 'Registro de outro modo (teste/produção)' }
    var destino = fu.teste ? foneWa(cfg.telefone_teste) : fu.telefone
    if (!destino) return { ok: false, erro: cfg.modo_teste ? 'Modo teste sem telefone de teste' : 'Paciente sem telefone' }
    var nomeTpl = cfg.templates[msg.template.chave] || msg.template.nome_padrao
    var r = await enviarTemplate(destino, nomeTpl, msg.params)
    await registrarMensagem(client, fu, { direcao: 'saida', autor: 'regua', etapa: etapa, texto: (fu.teste ? '[TESTE → ' + destino + '] ' : '') + msg.texto, wa_message_id: r.id, status: r.ok ? 'enviado' : 'erro', erro: r.erro })
    if (r.ok) {
        var campos = { etapa: etapa, ultimo_envio: agoraCG() }
        if (etapa >= 4 && fu.status === 'ativo') campos.status = 'concluido'
        await atualizar(client, fu, campos)
        if (!fu.teste) await registrarCrc(client, fu, 'follow_up', 'Follow-up automático ' + etapa + '/4 enviado (' + msg.template.papel + ')')
    }
    return r
}

async function executarClinica(client, clinica_id, opts) {
    opts = opts || {}
    var hoje = opts.hoje || hojeCG()
    var cfg = await lerCfgFollowup(client, clinica_id)
    var res = { clinica_id: clinica_id, ativo: !!cfg.ativo, modo_teste: !!cfg.modo_teste, convertidos: 0, encerrados: 0, inscritos: 0, enviados: 0, erros: 0, pulados: 0, detalhes: [] }
    if (!cfg.ativo && !opts.forcar) return res
    var s = await sincronizar(client, clinica_id)
    res.convertidos = s.convertidos; res.encerrados = s.encerrados
    if (cfg.pular_domingo && new Date(hoje + 'T12:00:00Z').getUTCDay() === 0 && !opts.forcar) { res.msg = 'Domingo: sem envios'; return res }
    if (cfg.modo_teste && !foneWa(cfg.telefone_teste)) { res.msg = 'Modo teste ligado sem telefone de teste: nada enviado'; return res }
    res.inscritos = await inscrever(client, clinica_id, cfg, hoje)

    var limiteEnvios = Math.max(0, parseInt(cfg.limite_envios_dia, 10) || 0)
    var pausa = addDias(hoje, -(parseInt(cfg.pausa_apos_resposta_dias, 10) || 0))
    var fila = await client.execute({
        sql: "SELECT * FROM orcamento_followups WHERE clinica_id=? AND status IN ('ativo','conversando') AND etapa<4 AND COALESCE(teste,0)=? ORDER BY valor DESC",
        args: [clinica_id, cfg.modo_teste ? 1 : 0]
    })
    for (var i = 0; i < fila.rows.length; i++) {
        if (res.enviados >= limiteEnvios) { res.msg = 'Limite diário de envios atingido'; break }
        var fu = fila.rows[i], prox = fu.etapa + 1
        if (hoje < addDias(fu.base_data, cfg.dias[prox - 1])) continue
        // Não envia no mesmo dia de outro envio, nem logo depois de o paciente falar
        if (fu.ultimo_envio && String(fu.ultimo_envio).slice(0, 10) >= hoje) continue
        if (fu.ultima_resposta && String(fu.ultima_resposta).slice(0, 10) > pausa) { res.pulados++; continue }
        if (await temConsultaFutura(client, clinica_id, fu.paciente_id, hoje)) { res.pulados++; continue }
        var r = await enviarEtapa(client, fu, cfg, prox)
        if (r.ok) res.enviados++
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
    PADRAO, EM_REGUA, ESCUTANDO, FINAIS,
    lerCfgFollowup, executarClinica, executarTodas, limparTeste, enviarEtapa, contexto,
    enviarTexto, enviarTemplate, registrarMensagem, registrarCrc, atualizar, avisarEquipe,
    foneWa, chaveFone, hojeCG, agoraCG, addDias
}
