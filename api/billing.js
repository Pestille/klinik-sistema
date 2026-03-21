// api/billing.js — Stripe billing: checkout, webhooks, portal
var { getClient } = require('./db')

// Stripe raw body parsing for webhooks
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var stripeKey = process.env.STRIPE_SECRET_KEY || ''
    var webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''
    if (!stripeKey) return res.status(500).json({ success: false, error: 'STRIPE_SECRET_KEY não configurada' })

    var stripe = require('stripe')(stripeKey)
    var client = getClient()
    var q = req.query || {}
    var action = q.action || ''

    try {
        // ── CRIAR CHECKOUT SESSION ────────────────────────────────
        if (action === 'checkout') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var body = req.body || {}
            var clinicaId = body.clinica_id
            var plano = body.plano // basico, profissional, premium

            if (!clinicaId || !plano) return res.status(400).json({ success: false, error: 'clinica_id e plano obrigatórios' })

            // Get clinic info
            var clinR = await client.execute({ sql: "SELECT * FROM clinicas WHERE id=?", args: [clinicaId] })
            if (!clinR.rows.length) return res.status(404).json({ success: false, error: 'Clínica não encontrada' })
            var clinica = clinR.rows[0]

            // Price IDs from env vars
            var priceMap = {
                basico: process.env.STRIPE_PRICE_BASICO || '',
                profissional: process.env.STRIPE_PRICE_PROFISSIONAL || '',
                premium: process.env.STRIPE_PRICE_PREMIUM || ''
            }
            var priceId = priceMap[plano]
            if (!priceId) return res.status(400).json({ success: false, error: 'Plano inválido ou Price ID não configurado para: ' + plano })

            // Create or reuse Stripe customer
            var customerId = clinica.stripe_customer_id
            if (!customerId) {
                // Get admin email
                var adminR = await client.execute({ sql: "SELECT email,nome FROM usuarios WHERE clinica_id=? AND perfil='admin' LIMIT 1", args: [clinicaId] })
                var adminEmail = adminR.rows.length ? adminR.rows[0].email : ''
                var adminNome = adminR.rows.length ? adminR.rows[0].nome : ''

                var customer = await stripe.customers.create({
                    email: adminEmail,
                    name: clinica.nome || adminNome,
                    metadata: { clinica_id: String(clinicaId) }
                })
                customerId = customer.id
                await client.execute({ sql: "UPDATE clinicas SET stripe_customer_id=? WHERE id=?", args: [customerId, clinicaId] })
            }

            // Create checkout session
            var appUrl = process.env.APP_URL || 'https://klinik-sistema.vercel.app'
            var session = await stripe.checkout.sessions.create({
                customer: customerId,
                payment_method_types: ['card'],
                line_items: [{ price: priceId, quantity: 1 }],
                mode: 'subscription',
                success_url: appUrl + '/app?billing=success',
                cancel_url: appUrl + '/app?billing=cancel',
                metadata: { clinica_id: String(clinicaId), plano: plano },
                subscription_data: {
                    metadata: { clinica_id: String(clinicaId), plano: plano }
                }
            })

            return res.status(200).json({ success: true, url: session.url, session_id: session.id })
        }

        // ── PORTAL DO CLIENTE (gerenciar assinatura) ──────────────
        if (action === 'portal') {
            if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' })
            var pb = req.body || {}
            if (!pb.clinica_id) return res.status(400).json({ success: false, error: 'clinica_id obrigatório' })

            var pCliR = await client.execute({ sql: "SELECT stripe_customer_id FROM clinicas WHERE id=?", args: [pb.clinica_id] })
            if (!pCliR.rows.length || !pCliR.rows[0].stripe_customer_id) {
                return res.status(400).json({ success: false, error: 'Clínica sem assinatura Stripe' })
            }

            var appUrl2 = process.env.APP_URL || 'https://klinik-sistema.vercel.app'
            var portalSession = await stripe.billingPortal.sessions.create({
                customer: pCliR.rows[0].stripe_customer_id,
                return_url: appUrl2 + '/app'
            })

            return res.status(200).json({ success: true, url: portalSession.url })
        }

        // ── STATUS DA ASSINATURA ──────────────────────────────────
        if (action === 'status') {
            var sq = req.query || {}
            if (!sq.clinica_id) return res.status(400).json({ success: false, error: 'clinica_id obrigatório' })

            var sCliR = await client.execute({ sql: "SELECT plano,plano_inicio,plano_fim,status_pagamento,stripe_customer_id FROM clinicas WHERE id=?", args: [sq.clinica_id] })
            if (!sCliR.rows.length) return res.status(404).json({ success: false, error: 'Clínica não encontrada' })
            var cl = sCliR.rows[0]

            // Check if trial expired
            var isTrial = cl.plano === 'trial'
            var trialExpired = false
            if (isTrial && cl.plano_fim) {
                trialExpired = new Date(cl.plano_fim) < new Date()
            }

            return res.status(200).json({
                success: true,
                plano: cl.plano,
                plano_inicio: cl.plano_inicio,
                plano_fim: cl.plano_fim,
                status_pagamento: cl.status_pagamento,
                is_trial: isTrial,
                trial_expired: trialExpired,
                has_stripe: !!cl.stripe_customer_id
            })
        }

        // ── WEBHOOK STRIPE ────────────────────────────────────────
        if (action === 'webhook') {
            if (req.method !== 'POST') return res.status(405).end()

            var event
            if (webhookSecret) {
                var sig = req.headers['stripe-signature']
                try {
                    // Vercel provides raw body as req.body when content-type is not JSON
                    var rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
                    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
                } catch (err) {
                    console.error('[billing] Webhook signature failed:', err.message)
                    return res.status(400).json({ error: 'Webhook signature failed' })
                }
            } else {
                event = req.body
            }

            var evType = event.type
            var evData = event.data.object

            console.log('[billing] Webhook:', evType)

            if (evType === 'checkout.session.completed') {
                var meta = evData.metadata || {}
                var cid = parseInt(meta.clinica_id) || 0
                var plan = meta.plano || 'basico'
                if (cid) {
                    var now = new Date().toISOString().slice(0, 10)
                    await client.execute({
                        sql: "UPDATE clinicas SET plano=?,plano_inicio=?,plano_fim=NULL,status_pagamento='ativo',stripe_customer_id=COALESCE(stripe_customer_id,?) WHERE id=?",
                        args: [plan, now, evData.customer || '', cid]
                    })
                    console.log('[billing] Clinica', cid, 'upgraded to', plan)
                }
            }

            if (evType === 'invoice.paid') {
                var custId = evData.customer
                if (custId) {
                    await client.execute({
                        sql: "UPDATE clinicas SET status_pagamento='ativo' WHERE stripe_customer_id=?",
                        args: [custId]
                    })
                }
            }

            if (evType === 'invoice.payment_failed') {
                var custId2 = evData.customer
                if (custId2) {
                    await client.execute({
                        sql: "UPDATE clinicas SET status_pagamento='inadimplente' WHERE stripe_customer_id=?",
                        args: [custId2]
                    })
                    console.log('[billing] Payment failed for customer', custId2)
                }
            }

            if (evType === 'customer.subscription.deleted') {
                var custId3 = evData.customer
                if (custId3) {
                    await client.execute({
                        sql: "UPDATE clinicas SET plano='cancelado',status_pagamento='cancelado' WHERE stripe_customer_id=?",
                        args: [custId3]
                    })
                    console.log('[billing] Subscription cancelled for customer', custId3)
                }
            }

            return res.status(200).json({ received: true })
        }

        return res.status(400).json({ success: false, error: 'Action inválida', actions: ['checkout', 'portal', 'status', 'webhook'] })

    } catch (error) {
        console.error('[billing]', error.message)
        return res.status(500).json({ success: false, error: error.message })
    }
}
