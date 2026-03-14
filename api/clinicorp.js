const https = require('https')

const BASE_HOST = 'api.clinicorp.com'
const BASE_PATH = '/rest/v1'
const USUARIO = process.env.CLINICORP_USUARIO || 'klinik'
const TOKEN   = process.env.CLINICORP_TOKEN   || '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
const BID     = process.env.CLINICORP_BID     || '5073030694043648'
const SUB     = 'klinik'

function getAuth() {
  return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

function getDates(days) {
  var fim = new Date()
  var ini = new Date()
  ini.setDate(ini.getDate() - (days || 365))
  return {
    from: ini.toISOString().split('T')[0],
    to:   fim.toISOString().split('T')[0]
  }
}

function httpGet(path) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: BASE_HOST,
      path:     BASE_PATH + path,
      method:   'GET',
      headers:  { 'Authorization': getAuth(), 'accept': 'application/json' }
    }
    var req = https.request(options, function(res) {
      var body = ''
      res.on('data', function(chunk) { body += chunk })
      res.on('end', function() {
        if (res.statusCode === 429) { reject(new Error('429: Rate limit')) ; return }
        if (res.statusCode >= 400)  { reject(new Error(res.statusCode + ': ' + body)); return }
        try { resolve(JSON.parse(body)) }
        catch(e) { reject(new Error('JSON parse error: ' + body.substring(0,200))) }
      })
    })
    req.on('error', reject)
    req.setTimeout(25000, function() { req.destroy(new Error('timeout')) })
    req.end()
  })
}

function buildQS(params) {
  return '?' + Object.entries(params).map(function(kv) {
    return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1])
  }).join('&')
}

async function fetchAll(endpoint, params) {
  var all = [], page = 1
  while (true) {
    var p = Object.assign({}, params, { limit: 100, page: page })
    var data = await httpGet('/' + endpoint + buildQS(p))
    var items = Array.isArray(data) ? data :
      (data.data || data.items || data.results || data.list || [])
    if (!items.length) break
    all = all.concat(items)
    if (items.length < 100) break
    page++
    if (page > 20) break // segurança
  }
  return all
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  var endpoint = (req.query || {}).endpoint
  if (!endpoint) { res.status(400).json({ ok: false, error: 'endpoint required' }); return }

  try {
    var dates = getDates(365)
    var base  = { subscriber_id: SUB, businessId: BID, from: dates.from, to: dates.to }
    var baseN = { subscriber_id: SUB }
    var data

    if (endpoint === 'agendamentos') {
      data = await fetchAll('appointment/list', base)

    } else if (endpoint === 'recebimentos') {
      data = await fetchAll('financial/list_receipt', base)

    } else if (endpoint === 'pagamentos') {
      data = await fetchAll('financial/list_payments', base)

    } else if (endpoint === 'procedimentos') {
      data = await fetchAll('procedures/list', baseN)

    } else if (endpoint === 'profissionais') {
      data = await fetchAll('professional/list_all_professionals', baseN)

    } else if (endpoint === 'aniversariantes') {
      var hoje = new Date().toISOString().split('T')[0]
      var em60 = new Date(); em60.setDate(em60.getDate() + 60)
      data = await fetchAll('patient/birthdays', {
        subscriber_id: SUB, businessId: BID,
        initial_date: hoje, final_date: em60.toISOString().split('T')[0]
      })

    } else if (endpoint === 'dashboard') {
      var results = await Promise.allSettled([
        fetchAll('appointment/list', base),
        fetchAll('financial/list_receipt', base),
        fetchAll('procedures/list', baseN),
        fetchAll('professional/list_all_professionals', baseN),
        (async function() {
          var h = new Date().toISOString().split('T')[0]
          var e = new Date(); e.setDate(e.getDate() + 60)
          return fetchAll('patient/birthdays', {
            subscriber_id: SUB, businessId: BID,
            initial_date: h, final_date: e.toISOString().split('T')[0]
          })
        })()
      ])

      var ag   = results[0].status === 'fulfilled' ? results[0].value : []
      var rec  = results[1].status === 'fulfilled' ? results[1].value : []
      var proc = results[2].status === 'fulfilled' ? results[2].value : []
      var prof = results[3].status === 'fulfilled' ? results[3].value : []
      var aniv = results[4].status === 'fulfilled' ? results[4].value : []

      // Inativos
      var ativos = ag.filter(function(a) { return !a.Deleted })
      var ultimas = {}
      ativos.forEach(function(a) {
        var d = new Date(a.date)
        if (!ultimas[a.PatientName] || d > ultimas[a.PatientName]) ultimas[a.PatientName] = d
      })
      var cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6)
      var inativos = Object.entries(ultimas)
        .filter(function(kv) { return kv[1] < cutoff })
        .map(function(kv) {
          return { nome: kv[0], ultima: kv[1].toISOString().split('T')[0],
                   dias: Math.floor((Date.now() - kv[1].getTime()) / 86400000) }
        })
        .sort(function(a,b) { return b.dias - a.dias })

      // Receita
      var receita = rec.reduce(function(s,r) {
        return s + parseFloat(r.Amount || r.amount || r.Value || 0)
      }, 0)

      // Por mês
      var porMes = {}
      ativos.forEach(function(a) {
        var m = a.date ? a.date.substring(0,7) : null
        if (m) porMes[m] = (porMes[m] || 0) + 1
      })

      // Por categoria
      var porCat = {}
      ativos.forEach(function(a) {
        var c = a.CategoryDescription || 'Outros'
        porCat[c] = (porCat[c] || 0) + 1
      })

      data = {
        resumo: {
          total_agendamentos:  ag.length,
          total_inativos:      inativos.length,
          total_procedimentos: proc.length,
          total_profissionais: prof.length,
          total_aniversariantes: aniv.length,
          receita_total: receita,
          ticket_medio:  rec.length > 0 ? receita / rec.length : 0
        },
        inativos: inativos.slice(0, 100),
        agendamentos_recentes: ativos
          .sort(function(a,b) { return new Date(b.date) - new Date(a.date) })
          .slice(0, 30),
        por_mes: porMes,
        por_categoria: porCat,
        profissionais: prof,
        aniversariantes: aniv
      }

    } else {
      res.status(400).json({ ok: false, error: 'Endpoint desconhecido: ' + endpoint }); return
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate')
    res.status(200).json({
      ok: true,
      data: data,
      total: Array.isArray(data) ? data.length : null,
      ts: new Date().toISOString()
    })

  } catch(err) {
    console.error('Erro:', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
}
