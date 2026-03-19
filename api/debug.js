// api/debug.js — Rota temporária para diagnosticar fetch Clinicorp
// REMOVER após resolver o problema

const USUARIO = process.env.CLINICORP_USUARIO || 'klinik'
const TOKEN   = process.env.CLINICORP_TOKEN   || '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
const BID     = process.env.CLINICORP_BID     || '5073030694043648'
const SUB     = 'klinik'

function auth() {
    return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')

    var https = require('https')
    var hoje = new Date()
    var d365 = new Date(); d365.setDate(d365.getDate() - 365)

    var params = {
        subscriber_id: SUB,
        businessId: BID,
        from: d365.toISOString().slice(0,10),
        to: hoje.toISOString().slice(0,10),
        limit: 10,
        page: 1
    }

    var qs = '?' + Object.entries(params)
        .map(function(kv){ return encodeURIComponent(kv[0])+'='+encodeURIComponent(kv[1]) }).join('&')

    var path = '/rest/v1/financial/list_receipt' + qs

    return new Promise(function(resolve) {
        var opts = {
            hostname: 'api.clinicorp.com',
            path: path,
            method: 'GET',
            headers: { 'Authorization': auth(), 'accept': 'application/json' }
        }

        var req2 = https.request(opts, function(r) {
            var body = ''
            r.on('data', function(c){ body += c })
            r.on('end', function() {
                try {
                    var parsed = JSON.parse(body)
                    res.status(200).json({
                        status: r.statusCode,
                        path: path,
                        auth_prefix: auth().slice(0,20) + '...',
                        total_items: Array.isArray(parsed) ? parsed.length : (parsed.data||parsed.items||parsed.list||[]).length,
                        keys: Object.keys(parsed),
                        first_item: Array.isArray(parsed) ? parsed[0] : (parsed.data||parsed.items||parsed.list||[])[0],
                        raw_start: body.slice(0, 300)
                    })
                } catch(e) {
                    res.status(200).json({ status: r.statusCode, error: e.message, raw: body.slice(0,500), path: path })
                }
                resolve()
            })
        })
        req2.on('error', function(e){ res.status(500).json({ error: e.message }); resolve() })
        req2.setTimeout(9000, function(){ req2.destroy(); res.status(500).json({ error: 'timeout' }); resolve() })
        req2.end()
    })
}
