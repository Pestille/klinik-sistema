const https = require('https')

const BASE_HOST = 'api.clinicorp.com'
const BASE_PATH = '/rest/v1'
const USUARIO   = process.env.CLINICORP_USUARIO || ''
const TOKEN     = process.env.CLINICORP_TOKEN   || ''
const BID       = process.env.CLINICORP_BID     || ''
const SUB       = process.env.CLINICORP_SUB     || ''

function auth() {
  return 'Basic ' + Buffer.from(USUARIO + ':' + TOKEN).toString('base64')
}

function dates(days) {
  var d = new Date(); var i = new Date()
  i.setDate(i.getDate() - (days||365))
  return { from: i.toISOString().slice(0,10), to: d.toISOString().slice(0,10) }
}

// Busca UMA página com timeout de 8s
function fetchPage(endpoint, params) {
  return new Promise(function(resolve, reject) {
    var qs = '?' + Object.entries(params).map(function(kv){
      return encodeURIComponent(kv[0])+'='+encodeURIComponent(kv[1])
    }).join('&')
    var opts = {
      hostname: BASE_HOST,
      path: BASE_PATH+'/'+endpoint+qs,
      method: 'GET',
      headers: { 'Authorization': auth(), 'accept': 'application/json' }
    }
    var req = https.request(opts, function(res) {
      var body = ''
      res.on('data', function(c){ body += c })
      res.on('end', function() {
        if (res.statusCode === 429) { resolve({ _rateLimit: true, items: [] }); return }
        if (res.statusCode >= 400)  { resolve({ _error: res.statusCode, items: [] }); return }
        try {
          var d = JSON.parse(body)
          var items = Array.isArray(d) ? d : (d.data||d.items||d.results||d.list||[])
          resolve({ items: items, raw: d })
        } catch(e) { resolve({ items: [] }) }
      })
    })
    req.on('error', function(e){ resolve({ items: [], _err: e.message }) })
    req.setTimeout(8000, function(){ req.destroy(); resolve({ items: [], _timeout: true }) })
    req.end()
  })
}

// Busca com paginação mas para em MAX_PAGES para não estourar timeout
async function fetchAll(endpoint, params, maxPages) {
  maxPages = maxPages || 3 // máximo 3 páginas = 300 registros por padrão
  var all = []
  for (var page = 1; page <= maxPages; page++) {
    var p = Object.assign({}, params, { limit: 100, page: page })
    var r = await fetchPage(endpoint, p)
    if (r._rateLimit || r._timeout || r._error) break
    all = all.concat(r.items)
    if (r.items.length < 100) break
  }
  return all
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  var ep = (req.query||{}).endpoint
  if (!ep) { res.status(400).json({ ok:false, error:'endpoint required' }); return }

  try {
    var d = dates(365)
    var base  = { subscriber_id:SUB, businessId:BID, from:d.from, to:d.to }
    var baseN = { subscriber_id:SUB }
    var data

    if (ep === 'profissionais') {
      data = await fetchAll('professional/list_all_professionals', baseN, 2)

    } else if (ep === 'procedimentos') {
      data = await fetchAll('procedures/list', baseN, 5)

    } else if (ep === 'recebimentos') {
      data = await fetchAll('financial/list_receipt', base, 5)

    } else if (ep === 'agendamentos') {
      // Limita a 3 páginas (300 registros) para não dar timeout
      data = await fetchAll('appointment/list', base, 3)

    } else if (ep === 'aniversariantes') {
      var hoje = new Date().toISOString().slice(0,10)
      var em60 = new Date(); em60.setDate(em60.getDate()+60)
      data = await fetchAll('patient/birthdays', {
        subscriber_id:SUB, businessId:BID,
        initial_date:hoje, final_date:em60.toISOString().slice(0,10)
      }, 2)

    } else if (ep === 'dashboard') {
      // Busca em paralelo com limite conservador por endpoint
      var rs = await Promise.allSettled([
        fetchAll('appointment/list', base, 9),           // até 900 agendamentos
        fetchAll('financial/list_receipt', base, 3),
        fetchAll('procedures/list', baseN, 2),
        fetchAll('professional/list_all_professionals', baseN, 1),
        (async function(){
          var h = new Date().toISOString().slice(0,10)
          var e = new Date(); e.setDate(e.getDate()+60)
          return fetchAll('patient/birthdays',{
            subscriber_id:SUB,businessId:BID,
            initial_date:h,final_date:e.toISOString().slice(0,10)
          },1)
        })()
      ])

      var ag   = rs[0].status==='fulfilled' ? rs[0].value : []
      var rec  = rs[1].status==='fulfilled' ? rs[1].value : []
      var proc = rs[2].status==='fulfilled' ? rs[2].value : []
      var prof = rs[3].status==='fulfilled' ? rs[3].value : []
      var aniv = rs[4].status==='fulfilled' ? rs[4].value : []

      // Inativos
      var ativos = ag.filter(function(a){ return !a.Deleted })
      var ult = {}
      ativos.forEach(function(a){
        var dt = new Date(a.date)
        if (!ult[a.PatientName]||dt>ult[a.PatientName]) ult[a.PatientName]=dt
      })
      var cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-6)
      var inativos = Object.entries(ult)
        .filter(function(kv){ return kv[1]<cutoff })
        .map(function(kv){
          return { nome:kv[0], ultima:kv[1].toISOString().slice(0,10),
                   dias:Math.floor((Date.now()-kv[1].getTime())/86400000) }
        })
        .sort(function(a,b){ return b.dias-a.dias })

      var receita = rec.reduce(function(s,r){
        return s+parseFloat(r.Amount||r.amount||r.Value||0)
      },0)

      var porMes={}, porCat={}
      ativos.forEach(function(a){
        var m=a.date?a.date.slice(0,7):null
        if(m) porMes[m]=(porMes[m]||0)+1
        var c=a.CategoryDescription||'Outros'
        porCat[c]=(porCat[c]||0)+1
      })

      data = {
        resumo:{
          total_agendamentos:ag.length,
          total_inativos:inativos.length,
          total_procedimentos:proc.length,
          total_profissionais:prof.length,
          total_aniversariantes:aniv.length,
          receita_total:receita,
          ticket_medio:rec.length>0?receita/rec.length:0
        },
        inativos:inativos.slice(0,100),
        agendamentos_recentes:ativos
          .sort(function(a,b){ return new Date(b.date)-new Date(a.date) })
          .slice(0,30),
        por_mes:porMes,
        por_categoria:porCat,
        profissionais:prof,
        aniversariantes:aniv
      }

    } else {
      res.status(400).json({ok:false,error:'Endpoint desconhecido: '+ep}); return
    }

    res.setHeader('Cache-Control','s-maxage=180,stale-while-revalidate=60')
    res.status(200).json({
      ok:true, data:data,
      total:Array.isArray(data)?data.length:null,
      ts:new Date().toISOString()
    })

  } catch(err) {
    console.error(err.message)
    res.status(500).json({ok:false,error:err.message})
  }
}
