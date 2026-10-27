// lib/followup/pagamento.js — Link de pagamento (Asaas) pedido pela assistente
// virtual do follow-up.
//
// A IA só decide a forma (pix/cartão) e as parcelas que o paciente escolheu;
// valor, limite de parcelas e desconto são calculados AQUI a partir do
// orçamento e da configuração da clínica — nunca do texto da IA.
// Usa /v3/paymentLinks: o paciente preenche os próprios dados no Asaas, então
// não precisa de CPF no cadastro.

var motor = require('./motor')
var textos = require('./textos')

async function chaveAsaas(client, clinica_id) {
    try {
        var r = (await client.execute({ sql: "SELECT asaas_api_key FROM clinicas WHERE id=?", args: [clinica_id] })).rows[0]
        if (r && r.asaas_api_key) return r.asaas_api_key
    } catch (e) { /* coluna ausente: usa a da plataforma */ }
    return process.env.ASAAS_API_KEY || ''
}

function arred(v) { return Math.round(v * 100) / 100 }

// Valida o pedido da IA contra a política. Devolve { ok, forma, parcelas, valor, desconto } ou { ok:false, motivo }
function calcular(pedido, fu, cfg) {
    var forma = String((pedido && pedido.forma) || '').toLowerCase()
    var valor = Number(fu.valor) || 0
    if (valor <= 0) return { ok: false, motivo: 'orçamento sem valor' }
    if (forma === 'pix') {
        var d = pedido.com_desconto_pix && Number(cfg.desconto_pix) > 0 ? Number(cfg.desconto_pix) : 0
        return { ok: true, forma: 'pix', parcelas: 1, valor: arred(valor * (1 - d / 100)), desconto: d }
    }
    if (forma === 'cartao') {
        var n = parseInt(pedido.parcelas, 10) || 1
        var max = parseInt(cfg.parcelas_cartao, 10) || 1
        if (pedido.assinante_clube && cfg.klinik_club) max = Math.max(max, parseInt(cfg.parcelas_clube, 10) || 0)
        if (n < 1 || n > max) return { ok: false, motivo: n + 'x acima do permitido (' + max + 'x)' }
        return { ok: true, forma: 'cartao', parcelas: n, valor: arred(valor), desconto: 0 }
    }
    return { ok: false, motivo: 'forma de pagamento inválida' }
}

function chavePedido(c) { return c.forma + '|' + c.parcelas + '|' + c.valor.toFixed(2) }

// Gera (ou reaproveita) o link. Devolve { ok, url, calc } ou { ok:false, erro }
async function gerarLink(client, fu, cfg, ctx, pedido) {
    var calc = calcular(pedido, fu, cfg)
    if (!calc.ok) return { ok: false, erro: calc.motivo }
    var chave = chavePedido(calc)
    // Mesmo pedido já atendido nas últimas 48h: manda o mesmo link
    if (fu.pagamento_link && fu.pagamento_info) {
        try {
            var info = JSON.parse(fu.pagamento_info)
            if (info.chave === chave && info.em && Date.now() - Date.parse(info.em) < 48 * 3600 * 1000) return { ok: true, url: fu.pagamento_link, calc: calc, reaproveitado: true }
        } catch (e) {}
    }
    var key = await chaveAsaas(client, fu.clinica_id)
    if (!key) return { ok: false, erro: 'Asaas não configurado' }
    var cat = ctx && textos.CATEGORIAS[ctx.categoria]
    var tratamento = (ctx && ctx.orcamento && ctx.orcamento.titulo) || (cat && cat.nome ? cat.nome.charAt(0).toUpperCase() + cat.nome.slice(1) : 'Tratamento odontológico')
    var nome = (fu.teste ? '[TESTE] ' : '') + ((ctx && ctx.clinica_nome) || 'Klinik') + ' – ' + tratamento
    var corpo = {
        name: nome.slice(0, 100),
        description: ('Orçamento #' + fu.orcamento_id + ' – ' + (fu.paciente_nome || '') + (calc.desconto ? ' – Pix com ' + calc.desconto + '% de desconto' : '') + (calc.forma === 'cartao' ? ' – ' + calc.parcelas + 'x sem juros' : '')).slice(0, 500),
        billingType: calc.forma === 'pix' ? 'PIX' : 'CREDIT_CARD',
        chargeType: calc.forma === 'cartao' && calc.parcelas > 1 ? 'INSTALLMENT' : 'DETACHED',
        value: calc.valor,
        dueDateLimitDays: 3,
        notificationEnabled: false,
        externalReference: 'followup:' + fu.clinica_id + ':' + fu.id
    }
    if (corpo.chargeType === 'INSTALLMENT') corpo.maxInstallmentCount = calc.parcelas
    try {
        var r = await fetch('https://api.asaas.com/v3/paymentLinks', {
            method: 'POST', headers: { 'access_token': key, 'Content-Type': 'application/json', 'User-Agent': 'klinik-sistema' }, body: JSON.stringify(corpo)
        })
        var j = await r.json().catch(function () { return {} })
        if (!r.ok || !j.url) return { ok: false, erro: ((j.errors && j.errors[0] && j.errors[0].description) || 'HTTP ' + r.status).slice(0, 200) }
        await motor.atualizar(client, fu, { pagamento_link: j.url, pagamento_info: JSON.stringify({ chave: chave, id: j.id, forma: calc.forma, parcelas: calc.parcelas, valor: calc.valor, desconto: calc.desconto, em: new Date().toISOString() }) })
        return { ok: true, url: j.url, calc: calc }
    } catch (e) { return { ok: false, erro: String(e.message || e).slice(0, 200) } }
}

function descrever(calc) {
    if (calc.forma === 'pix') return 'Pix à vista' + (calc.desconto ? ' com ' + calc.desconto + '% de desconto' : '') + ' (' + textos.moeda(calc.valor) + ')'
    return 'cartão de crédito em ' + calc.parcelas + 'x sem juros (' + textos.moeda(calc.valor) + ')'
}

module.exports = { gerarLink, calcular, descrever }
