// api/asaas-webhook.js — Webhook do Asaas para validação de saques e notificações
var { getClient } = require('./db')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    // Accept both GET (health check) and POST (webhook)
    if (req.method === 'GET') {
        return res.status(200).json({ status: 'ok', service: 'asaas-webhook' })
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    try {
        var client = getClient()
        var body = req.body || {}
        var event = body.event || ''
        // Asaas pode enviar payment como objeto direto ou dentro de body
        var payment = body.payment || body || {}

        console.log('[asaas-webhook] Event:', event, 'Payment ID:', payment.id || 'N/A', 'Full body keys:', Object.keys(body).join(','))

        // ── VALIDAÇÃO DE SAQUE ──
        // Asaas envia POST para validar se o saque deve ser autorizado
        if (event === 'TRANSFER_PENDING' || event === 'TRANSFER_CREATED') {
            // Autoriza o saque
            return res.status(200).json({ authorized: true })
        }

        // ── PAGAMENTO RECEBIDO ──
        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
            var externalId = payment.id || ''
            if (externalId) {
                // Atualiza status da cobrança no banco
                var upd = await client.execute({
                    sql: "UPDATE cobrancas SET status='pago',data_pagamento=datetime('now'),updated_at=datetime('now') WHERE asaas_id=?",
                    args: [externalId]
                })
                // Se encontrou a cobrança, atualiza saldo da clínica
                if (upd.rowsAffected > 0) {
                    var cobR = await client.execute({ sql: "SELECT id,clinica_id,valor FROM cobrancas WHERE asaas_id=?", args: [externalId] })
                    if (cobR.rows.length) {
                        var cob = cobR.rows[0]
                        await client.execute({ sql: "UPDATE clinicas SET saldo=saldo+? WHERE id=?", args: [cob.valor, cob.clinica_id] })
                        // Cascade: mark linked parcela as paid
                        try {
                            var parcUpd = await client.execute({
                                sql: "UPDATE parcelas_orcamento SET status='pago', data_pagamento=datetime('now'), updated_at=datetime('now') WHERE cobranca_id=? AND status!='pago'",
                                args: [cob.id]
                            })
                            if (parcUpd.rowsAffected > 0) console.log('[asaas-webhook] Parcela baixada automaticamente via cobranca_id=' + cob.id)
                        } catch(ep) { console.error('[asaas-webhook] Parcela cascade error:', ep.message) }
                        console.log('[asaas-webhook] Pagamento confirmado: R$' + cob.valor + ' clinica_id=' + cob.clinica_id)
                    }
                }
            }
            return res.status(200).json({ received: true })
        }

        // ── PAGAMENTO VENCIDO ──
        if (event === 'PAYMENT_OVERDUE') {
            var externalId2 = payment.id || ''
            if (externalId2) {
                await client.execute({
                    sql: "UPDATE cobrancas SET status='vencido',updated_at=datetime('now') WHERE asaas_id=?",
                    args: [externalId2]
                })
                // Cascade: mark linked parcela as overdue
                try {
                    var cobOv = await client.execute({ sql: "SELECT id FROM cobrancas WHERE asaas_id=?", args: [externalId2] })
                    if (cobOv.rows.length) {
                        await client.execute({
                            sql: "UPDATE parcelas_orcamento SET status='vencido', updated_at=datetime('now') WHERE cobranca_id=? AND status='pendente'",
                            args: [cobOv.rows[0].id]
                        })
                    }
                } catch(ep) { console.error('[asaas-webhook] Parcela overdue cascade error:', ep.message) }
            }
            return res.status(200).json({ received: true })
        }

        // ── PAGAMENTO CANCELADO / ESTORNADO ──
        if (event === 'PAYMENT_DELETED' || event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_REFUND_IN_PROGRESS') {
            var externalId3 = payment.id || ''
            if (externalId3) {
                await client.execute({
                    sql: "UPDATE cobrancas SET status='cancelado',updated_at=datetime('now') WHERE asaas_id=?",
                    args: [externalId3]
                })
            }
            return res.status(200).json({ received: true })
        }

        // Evento não tratado — aceita silenciosamente
        return res.status(200).json({ received: true, event: event })

    } catch (error) {
        console.error('[asaas-webhook] Error:', error.message)
        return res.status(500).json({ error: error.message })
    }
}
