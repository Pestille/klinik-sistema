// api/sync-pacientes.js — Sincronizar pacientes Clinicorp → Turso

var https = require('https')
var { getClient } = require('./db')

var BASE_HOST = 'api.clinicorp.com'
var BASE_PATH = '/rest/v1'
var USUARIO   = process.env.CLINICORP_USUARIO || 'klinik'
var TOKEN     = process.env.CLINICORP_TOKEN   || '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
var SUB       = 'klinik'
var BID       = process.env.CLINICORP_BID     || '5073030694043648'

function auth() {
    return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

function fetchPage(endpoint, params) {
    return new Promise(function(resolve) {
        var qs = '?' + Object.entries(params).map(function(kv) {
            return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1])
        }).join('&')
        var opts = {
            hostname: BASE_HOST,
            path: BASE_PATH + '/' + endpoint + qs,
            method: 'GET',
            headers: { 'Authorization': auth(), 'accept': 'application/json' }
        }
        var req = https.request(opts, function(res) {
            var body = ''
            res.on('data', function(c) { body += c })
            res.on('end', function() {
                if (res.statusCode >= 400) { resolve({ items: [], _error: res.statusCode }); return }
                try {
                    var d = JSON.parse(body)
                    var items = Array.isArray(d) ? d : (d.data || d.items || d.results || d.list || [])
                    resolve({ items: items, raw: d })
                } catch(e) { resolve({ items: [] }) }
            })
        })
        req.on('error', function(e) { resolve({ items: [], _err: e.message }) })
        req.setTimeout(15000, function() { req.destroy(); resolve({ items: [], _timeout: true }) })
        req.end()
    })
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.status(200).end(); return }

    var startTime = Date.now()
    var totalProcessados = 0
    var totalErros = 0

    try {
        var client = getClient()

        var d = new Date()
        var from = new Date(); from.setDate(from.getDate() - 365)
        var params = {
            subscriber_id: SUB,
            bu
