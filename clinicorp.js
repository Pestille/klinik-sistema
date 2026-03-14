// Vercel Serverless Function — proxy seguro para API Clinicorp
// Credenciais ficam no servidor, nunca expostas no browser

const BASE = 'https://api.clinicorp.com/rest/v1'
const USUARIO = process.env.CLINICORP_USUARIO || 'klinik'
const TOKEN = process.env.CLINICORP_TOKEN || '23b73dd0-f3a9-4aef-97ff-9db567d283b5'
const BUSINESS_ID = process.env.CLINICORP_BUSINESS_ID || '5073030694043648'
const SUB = 'klinik'

function getAuth() {
  const cred = Buffer.from(`${USUARIO}:${TOKEN}`).toString('base64')
  return `Basic ${cred}`
}

function getDates(days = 365) {
  const fim = new Date()
  const ini = new Date()
  ini.setDate(ini.getDate() - days)
  return {
    from: ini.toISOString().split('T')[0],
    to: fim.toISOString().split('T')[0]
  }
}

async function fetchCorp(endpoint, params = {}) {
  const url = new URL(`${BASE}/${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': getAuth(),
      'accept': 'application/json'
    }
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${res.status}: ${err}`)
  }
  return res.json()
}

async function fetchAll(endpoint, baseParams) {
  const all = []
  let page = 1
  while (true) {
    const params = { ...baseParams, limit: 100, page }
    const data = await fetchCorp(endpoint, params)
    if (Array.isArray(data)) {
      all.push(...data)
      if (data.length < 100) break
    } else {
      // Tenta extrair lista de dentro de um objeto
      const list = data.data || data.items || data.results || data.list || []
      if (Array.isArray(list)) {
        all.push(...list)
        const meta = data.meta || data.pagination || {}
        const totalPages = meta.total_pages || meta.last_page || 1
        if (page >= totalPages) break
      } else {
        break
      }
    }
    page++
  }
  return all
}

export default async function handler(req, res) {
  // CORS — permite chamadas do seu domínio
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { endpoint } = req.query
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' })

  try {
    const { from, to } = getDates(365)
    const baseWithDate = { subscriber_id: SUB, businessId: BUSINESS_ID, from, to }
    const baseNoDate  = { subscriber_id: SUB }

    let data

    switch (endpoint) {
      case 'agendamentos':
        data = await fetchAll('appointment/list', baseWithDate)
        break

      case 'recebimentos':
        data = await fetchAll('financial/list_receipt', baseWithDate)
        break

      case 'pagamentos':
        data = await fetchAll('financial/list_payments', baseWithDate)
        break

      case 'caixa':
        data = await fetchAll('financial/list_cash_flow', baseWithDate)
        break

      case 'orcamentos':
        data = await fetchAll('estimates/list', baseWithDate)
        break

      case 'procedimentos':
        data = await fetchAll('procedures/list', baseNoDate)
        break

      case 'profissionais':
        data = await fetchAll('professional/list_all_professionals', baseNoDate)
        break

      case 'aniversariantes': {
        const hoje = new Date().toISOString().split('T')[0]
        const em60 = new Date()
        em60.setDate(em60.getDate() + 60)
        data = await fetchAll('patient/birthdays', {
          subscriber_id: SUB,
          businessId: BUSINESS_ID,
          initial_date: hoje,
          final_date: em60.toISOString().split('T')[0]
        })
        break
      }

      case 'dashboard': {
        // Busca todos os dados em paralelo
        const [ag, rec, proc, prof, aniv] = await Promise.allSettled([
          fetchAll('appointment/list', baseWithDate),
          fetchAll('financial/list_receipt', baseWithDate),
          fetchAll('procedures/list', baseNoDate),
          fetchAll('professional/list_all_professionals', baseNoDate),
          (async () => {
            const hoje = new Date().toISOString().split('T')[0]
            const em60 = new Date(); em60.setDate(em60.getDate() + 60)
            return fetchAll('patient/birthdays', {
              subscriber_id: SUB, businessId: BUSINESS_ID,
              initial_date: hoje, final_date: em60.toISOString().split('T')[0]
            })
          })()
        ])

        const agendamentos  = ag.status   === 'fulfilled' ? ag.value   : []
        const recebimentos  = rec.status  === 'fulfilled' ? rec.value  : []
        const procedimentos = proc.status === 'fulfilled' ? proc.value : []
        const profissionais = prof.status === 'fulfilled' ? prof.value : []
        const aniversariantes = aniv.status === 'fulfilled' ? aniv.value : []

        // Calcula inativos
        const ativos = agendamentos.filter(a => !a.Deleted)
        const porPaciente = {}
        ativos.forEach(a => {
          const nome = a.PatientName
          const data = new Date(a.date)
          if (!porPaciente[nome] || data > porPaciente[nome]) {
            porPaciente[nome] = data
          }
        })
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6)
        const inativos = Object.entries(porPaciente)
          .filter(([, d]) => d < cutoff)
          .map(([nome, d]) => ({
            nome,
            ultima: d.toISOString().split('T')[0],
            dias: Math.floor((Date.now() - d.getTime()) / 86400000)
          }))
          .sort((a, b) => b.dias - a.dias)

        // Receita total
        const receita = recebimentos.reduce((s, r) => {
          return s + parseFloat(r.Amount || r.amount || r.Value || 0)
        }, 0)

        // Agendamentos por mês
        const porMes = {}
        ativos.forEach(a => {
          const mes = a.date ? a.date.substring(0, 7) : null
          if (mes) porMes[mes] = (porMes[mes] || 0) + 1
        })

        // Mix de categorias
        const porCat = {}
        ativos.forEach(a => {
          const cat = a.CategoryDescription || 'Outros'
          porCat[cat] = (porCat[cat] || 0) + 1
        })

        data = {
          resumo: {
            total_agendamentos: agendamentos.length,
            total_inativos: inativos.length,
            total_procedimentos: procedimentos.length,
            total_profissionais: profissionais.length,
            total_aniversariantes: aniversariantes.length,
            receita_total: receita,
            ticket_medio: recebimentos.length > 0 ? receita / recebimentos.length : 0
          },
          inativos: inativos.slice(0, 50),
          agendamentos_recentes: ativos
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 20),
          por_mes: porMes,
          por_categoria: porCat,
          profissionais,
          aniversariantes
        }
        break
      }

      default:
        return res.status(400).json({ error: `Endpoint desconhecido: ${endpoint}` })
    }

    // Cache de 5 minutos
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate')
    return res.status(200).json({ ok: true, data, total: Array.isArray(data) ? data.length : null, ts: new Date().toISOString() })

  } catch (err) {
    console.error('Clinicorp API error:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
