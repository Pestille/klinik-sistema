// api/sync-pacientes.js — versão diagnóstico
var https = require('https')

var USUARIO = 'klinik'
var TOKEN   = '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
var SUB     = 'klinik'
var BID     = '5073030694043648'

function auth() {
    return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')

    var d = new Date()
    var from = new Date(); from.setDate(from.getDate() - 30)

    var path = '/rest/v1/appointment/list?subscriber_id=' + SUB +
        '&businessId=' + BID +
        '&from=' + from.toISOString().slice(0,10) +
        '&to=' + d.toISOString().slice(0,10) +
        '&limit=5&page=1'

    try {
        var result = await new Promise(function(resolve) {
            var opts = {
                hostname: 'api.clinicorp.com',
                path: path,
                method: 'GET',
                headers: { 'Authorization': auth(), 'accept': 'application/json' }
            }
            var req2 = https.request(opts, function(response) {
                var body = ''
                response.on('data', function(c) { body += c })
                response.on('end', function() {
                    resolve({
                        status: response.statusCode,
                        headers: response.headers,
                        body_preview: body.substring(0, 500),
                        body_length: body.length
                    })
                })
            })
            req2.on('error', function(e) {
                resolve({ error: e.message, code: e.code })
            })
            req2.setTimeout(10000, function() {
                req2.destroy()
                resolve({ error: 'TIMEOUT after 10s' })
            })
            req2.end()
        })

        res.status(200).json({
            test: 'Clinicorp API diagnostic',
            url: 'https://api.clinicorp.com' + path,
            result: result,
            timestamp: new Date().toISOString()
        })

    } catch(e) {
        res.status(500).json({ error: e.message })
    }
}
