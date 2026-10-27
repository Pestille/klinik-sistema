// lib/rotas/followup.js — Painel do follow-up automático de orçamentos
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
// A régua e a IA ficam em lib/followup/*; aqui só configuração, funil,
// conversas, ações da equipe e prévia das mensagens.

var motor = require('../followup/motor')
var textos = require('../followup/textos')
var { salvarSecao, registrar } = require('../config')

var STATUS = ['ativo', 'conversando', 'transferido', 'concluido', 'pausado', 'perdido', 'optout', 'convertido', 'encerrado']
var ACOES = ['pausar', 'retomar', 'assumir', 'devolver_ia', 'encerrar']

function num(v, min, max, padrao) { var n = Number(v); if (!isFinite(n)) return padrao; return Math.min(Math.max(n, min), max) }

async function doFollowup(client, clinica_id, id) {
    var r = await client.execute({ sql: "SELECT * FROM orcamento_followups WHERE id=? AND clinica_id=?", args: [parseInt(id, 10) || 0, clinica_id] })
    return r.rows[0] || null
}

async function handle(route, ctx) {
    if (String(route).indexOf('followup-') !== 0) return false
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }
    var admin = auth.perfil === 'admin'

    // ── Painel: configuração + funil + lista ──────────────────────
    if (route === 'followup-painel') {
        var cfg = await motor.lerCfgFollowup(client, clinica_id)
        var teste = cfg.modo_teste ? 1 : 0
        var k = (await client.execute({
            sql: "SELECT COUNT(*) total, " +
                "SUM(CASE WHEN etapa>=1 THEN 1 ELSE 0 END) contatados, " +
                "SUM(CASE WHEN status='ativo' THEN 1 ELSE 0 END) em_regua, " +
                "SUM(CASE WHEN status='conversando' THEN 1 ELSE 0 END) conversando, " +
                "SUM(CASE WHEN status='transferido' THEN 1 ELSE 0 END) transferidos, " +
                "SUM(CASE WHEN status='convertido' THEN 1 ELSE 0 END) convertidos, " +
                "SUM(CASE WHEN status IN ('perdido','optout') THEN 1 ELSE 0 END) perdidos, " +
                "SUM(CASE WHEN ultima_resposta IS NOT NULL THEN 1 ELSE 0 END) responderam, " +
                "COALESCE(SUM(CASE WHEN status IN ('ativo','conversando','transferido','concluido','pausado') THEN valor ELSE 0 END),0) valor_aberto, " +
                "COALESCE(SUM(CASE WHEN status='convertido' THEN valor ELSE 0 END),0) valor_convertido " +
                "FROM orcamento_followups WHERE clinica_id=? AND COALESCE(teste,0)=?",
            args: [clinica_id, teste]
        })).rows[0]
        var obj = (await client.execute({ sql: "SELECT objecao, COUNT(*) n FROM orcamento_followups WHERE clinica_id=? AND COALESCE(teste,0)=? AND objecao IS NOT NULL GROUP BY objecao ORDER BY n DESC", args: [clinica_id, teste] })).rows
        var w = ["f.clinica_id=?", "COALESCE(f.teste,0)=?"], a = [clinica_id, teste]
        if (STATUS.indexOf(q.status) >= 0) { w.push("f.status=?"); a.push(q.status) }
        else if (q.status === 'atencao') w.push("f.status='transferido'")
        if (q.q) { w.push("f.paciente_nome LIKE ?"); a.push('%' + String(q.q).slice(0, 60) + '%') }
        var lista = (await client.execute({
            sql: "SELECT f.id, f.orcamento_id, f.paciente_id, f.paciente_nome, f.valor, f.categoria, f.etapa, f.status, f.objecao, f.resumo_equipe, f.ultimo_envio, f.ultima_resposta, f.transferido_em, f.convertido_em, f.ia_ativa, " +
                "(SELECT m.texto FROM followup_mensagens m WHERE m.followup_id=f.id AND m.clinica_id=f.clinica_id ORDER BY m.id DESC LIMIT 1) ultima_msg, " +
                "(SELECT m.direcao FROM followup_mensagens m WHERE m.followup_id=f.id AND m.clinica_id=f.clinica_id ORDER BY m.id DESC LIMIT 1) ultima_direcao, " +
                "(SELECT m.status FROM followup_mensagens m WHERE m.followup_id=f.id AND m.clinica_id=f.clinica_id AND m.direcao='saida' ORDER BY m.id DESC LIMIT 1) ultimo_status " +
                "FROM orcamento_followups f WHERE " + w.join(' AND ') +
                " ORDER BY CASE f.status WHEN 'transferido' THEN 0 WHEN 'conversando' THEN 1 ELSE 2 END, COALESCE(f.ultima_resposta, f.ultimo_envio, f.criado_em) DESC LIMIT 300",
            args: a
        })).rows
        return json(200, {
            success: true,
            config: cfg,
            integracoes: { whatsapp: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID), ia: !!process.env.ANTHROPIC_API_KEY, email: !!process.env.RESEND_API_KEY },
            templates: textos.TEMPLATES.map(function (t) { return { etapa: t.etapa, chave: t.chave, papel: t.papel, nome: cfg.templates[t.chave] || t.nome_padrao, corpo: t.corpo, botoes: textos.BOTOES } }),
            kpis: k, objecoes: obj, lista: lista, admin: admin
        })
    }

    // ── Conversa completa ─────────────────────────────────────────
    if (route === 'followup-conversa') {
        var fu = await doFollowup(client, clinica_id, q.id)
        if (!fu) return json(404, { success: false, error: 'Conversa não encontrada' })
        var msgs = (await client.execute({ sql: "SELECT id, direcao, autor, etapa, texto, status, erro, criado_em FROM followup_mensagens WHERE followup_id=? AND clinica_id=? ORDER BY id", args: [fu.id, clinica_id] })).rows
        var orc = (await client.execute({ sql: "SELECT id, titulo, profissional_nome, data_criacao, validade, valor_total, desconto, status FROM orcamentos WHERE id=? AND clinica_id=?", args: [fu.orcamento_id, clinica_id] })).rows[0] || null
        var itens = orc ? (await client.execute({ sql: "SELECT procedimento_nome, dente, regiao, valor_unitario, quantidade FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=? ORDER BY id", args: [orc.id, clinica_id] })).rows : []
        var ultEntrada = msgs.filter(function (m) { return m.direcao === 'entrada' }).pop()
        var janela = !!(ultEntrada && (Date.now() - 4 * 3600 * 1000) - new Date(String(ultEntrada.criado_em).replace(' ', 'T') + 'Z').getTime() < 24 * 3600 * 1000)
        return json(200, { success: true, followup: fu, mensagens: msgs, orcamento: orc, itens: itens, janela_aberta: janela })
    }

    // ── Configuração (só administrador) ───────────────────────────
    if (route === 'followup-config') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (!admin) return json(403, { success: false, error: 'Apenas o administrador altera o follow-up' })
        var atual = await motor.lerCfgFollowup(client, clinica_id)
        var dias = Array.isArray(b.dias) ? b.dias.map(function (d) { return parseInt(d, 10) }) : atual.dias
        if (dias.length !== 4 || dias.some(function (d, i) { return !(d >= 1 && d <= 120) || (i && d <= dias[i - 1]) })) return json(400, { success: false, error: 'Os 4 dias da régua devem ser crescentes, entre 1 e 120' })
        var fone = String(b.telefone_teste == null ? atual.telefone_teste : b.telefone_teste).replace(/\D/g, '').slice(0, 13)
        var modoTeste = b.modo_teste === undefined ? atual.modo_teste : !!b.modo_teste
        if (modoTeste && b.ativo && fone.length < 10) return json(400, { success: false, error: 'Informe o telefone de teste (com DDD) para ligar em modo teste' })
        var tpl = Object.assign({}, atual.templates)
        Object.keys(b.templates || {}).forEach(function (kk) { if (tpl[kk] !== undefined && /^[a-z0-9_]{1,512}$/.test(String(b.templates[kk]))) tpl[kk] = String(b.templates[kk]) })
        var novo = {
            ativo: b.ativo === undefined ? atual.ativo : !!b.ativo,
            modo_teste: modoTeste,
            telefone_teste: fone,
            dias: dias,
            janela_dias: num(b.janela_dias, 7, 365, atual.janela_dias),
            valor_minimo: num(b.valor_minimo, 0, 1e7, atual.valor_minimo),
            limite_novos_dia: num(b.limite_novos_dia, 0, 200, atual.limite_novos_dia),
            limite_envios_dia: num(b.limite_envios_dia, 0, 500, atual.limite_envios_dia),
            pular_domingo: b.pular_domingo === undefined ? atual.pular_domingo : !!b.pular_domingo,
            pausa_apos_resposta_dias: num(b.pausa_apos_resposta_dias, 0, 30, atual.pausa_apos_resposta_dias),
            parcelas_cartao: b.parcelas_cartao === '' || b.parcelas_cartao === null ? null : (b.parcelas_cartao === undefined ? atual.parcelas_cartao : num(b.parcelas_cartao, 1, 48, null)),
            desconto_pix: b.desconto_pix === '' || b.desconto_pix === null ? null : (b.desconto_pix === undefined ? atual.desconto_pix : num(b.desconto_pix, 0, 50, null)),
            texto_pagamento: String(b.texto_pagamento == null ? atual.texto_pagamento : b.texto_pagamento).replace(/[\r\n\t]+/g, ' ').slice(0, 300),
            klinik_club: b.klinik_club === undefined ? atual.klinik_club : !!b.klinik_club,
            nome_clube: String(b.nome_clube || atual.nome_clube).slice(0, 40),
            sulamerica: b.sulamerica === undefined ? atual.sulamerica : !!b.sulamerica,
            prova_social: String(b.prova_social == null ? atual.prova_social : b.prova_social).replace(/[\r\n\t]+/g, ' ').slice(0, 160),
            nome_equipe: String(b.nome_equipe || atual.nome_equipe).slice(0, 40),
            ia_ativa: b.ia_ativa === undefined ? atual.ia_ativa : !!b.ia_ativa,
            email_alerta: String(b.email_alerta == null ? atual.email_alerta : b.email_alerta).trim().slice(0, 120),
            templates: tpl
        }
        await salvarSecao(client, clinica_id, 'followup', novo)
        var limpos = 0
        if (atual.modo_teste && !novo.modo_teste) limpos = await motor.limparTeste(client, clinica_id)
        await registrar(client, auth, 'followup_config', 'Follow-up ' + (novo.ativo ? 'ligado' : 'desligado') + (novo.modo_teste ? ' (modo teste)' : ''), req)
        return json(200, { success: true, config: novo, testes_removidos: limpos })
    }

    // ── Ações da equipe sobre uma conversa ────────────────────────
    if (route === 'followup-acao') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (ACOES.indexOf(b.acao) < 0) return json(400, { success: false, error: 'Ação inválida' })
        var f = await doFollowup(client, clinica_id, b.id)
        if (!f) return json(404, { success: false, error: 'Conversa não encontrada' })
        if (motor.FINAIS.indexOf(f.status) >= 0 && b.acao !== 'encerrar') return json(400, { success: false, error: 'Esta conversa já foi finalizada' })
        var campos = {}
        if (b.acao === 'pausar') campos = { status: 'pausado' }
        if (b.acao === 'retomar') campos = { status: f.etapa >= 4 ? 'concluido' : 'ativo' }
        if (b.acao === 'assumir') campos = { status: 'transferido', transferido_em: motor.agoraCG() }
        if (b.acao === 'devolver_ia') campos = { status: 'conversando', ia_ativa: 1 }
        if (b.acao === 'encerrar') campos = { status: 'encerrado' }
        await motor.atualizar(client, f, campos)
        await motor.registrarMensagem(client, f, { direcao: 'nota', autor: 'equipe', texto: (auth.nome || 'Equipe') + ': ' + { pausar: 'pausou a régua', retomar: 'retomou a régua', assumir: 'assumiu a conversa', devolver_ia: 'devolveu a conversa para a assistente virtual', encerrar: 'encerrou o follow-up' }[b.acao], status: 'nota' })
        return json(200, { success: true, status: campos.status })
    }

    // ── Equipe responde pelo painel (dentro da janela de 24h) ─────
    if (route === 'followup-responder') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var fr = await doFollowup(client, clinica_id, b.id)
        if (!fr) return json(404, { success: false, error: 'Conversa não encontrada' })
        var texto = String(b.texto || '').trim().slice(0, 1500)
        if (!texto) return json(400, { success: false, error: 'Escreva a mensagem' })
        var ult = (await client.execute({ sql: "SELECT criado_em FROM followup_mensagens WHERE followup_id=? AND clinica_id=? AND direcao='entrada' ORDER BY id DESC LIMIT 1", args: [fr.id, clinica_id] })).rows[0]
        if (!ult || (Date.now() - 4 * 3600 * 1000) - new Date(String(ult.criado_em).replace(' ', 'T') + 'Z').getTime() >= 24 * 3600 * 1000)
            return json(400, { success: false, error: 'A janela de 24h do WhatsApp fechou: só dá para escrever livremente até 24h depois da última mensagem do paciente. Ligue para o paciente ou aguarde ele responder.' })
        var cfgR = await motor.lerCfgFollowup(client, clinica_id)
        var destino = fr.teste ? motor.foneWa(cfgR.telefone_teste) : fr.telefone
        var env = await motor.enviarTexto(destino, texto)
        await motor.registrarMensagem(client, fr, { direcao: 'saida', autor: 'equipe', texto: texto, wa_message_id: env.id, status: env.ok ? 'enviado' : 'erro', erro: env.erro })
        if (!env.ok) return json(502, { success: false, error: 'WhatsApp recusou o envio: ' + env.erro })
        if (fr.status !== 'transferido') await motor.atualizar(client, fr, { status: 'transferido', transferido_em: motor.agoraCG() })
        return json(200, { success: true })
    }

    // ── Prévia das 4 mensagens para um orçamento ──────────────────
    if (route === 'followup-previa') {
        var cfgP = await motor.lerCfgFollowup(client, clinica_id)
        var oid = parseInt(q.orcamento_id, 10) || 0
        var orcP = oid
            ? (await client.execute({ sql: "SELECT o.id, o.paciente_id, p.nome FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE o.id=? AND o.clinica_id=?", args: [oid, clinica_id] })).rows[0]
            : (await client.execute({ sql: "SELECT o.id, o.paciente_id, p.nome FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id AND p.clinica_id=o.clinica_id WHERE o.clinica_id=? AND COALESCE(o.status,'aberto')='aberto' AND (COALESCE(o.valor_total,0)-COALESCE(o.desconto,0))>0 ORDER BY o.data_criacao DESC LIMIT 1", args: [clinica_id] })).rows[0]
        if (!orcP) return json(404, { success: false, error: 'Nenhum orçamento em aberto para gerar a prévia' })
        var o = (await client.execute({ sql: "SELECT valor_total, desconto FROM orcamentos WHERE id=? AND clinica_id=?", args: [orcP.id, clinica_id] })).rows[0]
        var fake = { id: 0, clinica_id: clinica_id, orcamento_id: orcP.id, paciente_nome: orcP.nome, valor: (Number(o.valor_total) || 0) - (Number(o.desconto) || 0) }
        var cx = await motor.contexto(client, fake, cfgP)
        return json(200, {
            success: true, orcamento_id: orcP.id, paciente: orcP.nome, categoria: cx.categoria, categoria_nome: textos.CATEGORIAS[cx.categoria].nome,
            mensagens: [1, 2, 3, 4].map(function (e) { var m = textos.montarMensagem(e, cx); return { etapa: e, papel: m.template.papel, dia: cfgP.dias[e - 1], texto: m.texto, botoes: textos.BOTOES } })
        })
    }

    // ── Rodar a régua agora (só administrador) ────────────────────
    if (route === 'followup-executar') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (!admin) return json(403, { success: false, error: 'Apenas o administrador' })
        var r = await motor.executarClinica(client, clinica_id, {})
        if (!r.ativo) return json(400, { success: false, error: 'Ligue o follow-up antes de rodar a régua' })
        return json(200, { success: true, resultado: r })
    }

    return false
}

module.exports = { handle }
