// ═══════════════════════════════════════════════════════════
// KLINIK SISTEMA — Turso Data Layer
// Conecta o frontend às APIs do banco Turso
// Adicione antes do </body>: <script src="/klinik-turso.js"></script>
// ═══════════════════════════════════════════════════════════

(function() {
'use strict'

// ── API HELPERS ─────────────────────────────────────────
async function apiGet(endpoint, params) {
    var qs = params ? '?' + Object.entries(params).filter(function(kv){return kv[1]!==undefined&&kv[1]!==null&&kv[1]!==''}).map(function(kv){return encodeURIComponent(kv[0])+'='+encodeURIComponent(kv[1])}).join('&') : ''
    try {
        var r = await fetch('/api/' + endpoint + qs)
        var d = await r.json()
        return d.success !== false ? d : null
    } catch(e) { console.error('API error:', endpoint, e); return null }
}

// ── OVERRIDE: loadDashboard ─────────────────────────────
var _origLoadDashboard = window.loadDashboard
window.loadDashboard = async function() {
    try {
        var d = await apiGet('dashboard')
        if (!d) { if (_origLoadDashboard) _origLoadDashboard(); return }

        ST.dashboard = {
            resumo: d.resumo,
            por_mes: {},
            por_categoria: {},
            profissionais: d.profissionais || [],
            inativos: (d.inativos || []).map(function(p) {
                return { nome: p.nome, ultima: p.ultima_visita ? p.ultima_visita.slice(0,10) : '—', dias: p.dias_ausente || 999, telefone: p.telefone }
            })
        }

        // Converter arrays para objetos compatíveis
        ;(d.agendamentos_por_mes || []).forEach(function(m) { ST.dashboard.por_mes[m.mes] = m.total })
        ;(d.agendamentos_por_categoria || []).forEach(function(c) { ST.dashboard.por_categoria[c.categoria] = c.total })

        ST.inativos = ST.dashboard.inativos
        ST.profissionais = d.profissionais

        // Renderizar tudo que depende do dashboard
        if (typeof renderCRMCounts === 'function') renderCRMCounts(ST.inativos)
        if (curPage === 'crm' && typeof renderCRM === 'function') renderCRM()
        if (curPage === 'relatorios' && typeof renderRelatorios === 'function') renderRelatorios()
        if (typeof renderRelCounts === 'function') renderRelCounts(ST.dashboard)
        if (typeof renderProfsList === 'function') renderProfsList()

        // Atualizar KPIs do relatório
        var r = d.resumo
        var el
        el = document.getElementById('rel-fat'); if (el) el.textContent = 'R$ ' + (r.receita_total||0).toLocaleString('pt-BR', {minimumFractionDigits:2})
        el = document.getElementById('rel-receb'); if (el) el.textContent = 'R$ ' + (r.receita_total||0).toLocaleString('pt-BR', {minimumFractionDigits:2})
        el = document.getElementById('rel-ag'); if (el) el.textContent = r.total_agendamentos || 0

        console.log('[Turso] Dashboard carregado:', r.total_pacientes, 'pacientes,', r.total_agendamentos, 'agendamentos')
    } catch(e) {
        console.error('[Turso] Erro dashboard:', e)
        if (_origLoadDashboard) _origLoadDashboard()
    }
}

// ── OVERRIDE: loadAgenda ────────────────────────────────
var _origLoadAgenda = window.loadAgenda
window.loadAgenda = async function() {
    var loadingEl = document.getElementById('agenda-loading')
    var gridEl = document.getElementById('agenda-grid')
    if (loadingEl) loadingEl.classList.remove('hidden')
    if (gridEl) gridEl.classList.add('hidden')

    try {
        // Buscar agendamentos do dia selecionado
        var dtStr = agendaDate.toISOString().slice(0,10)
        var d = await apiGet('agendamentos', { data: dtStr })

        if (d && d.data) {
            // Converter para formato compatível com renderAgendaGrid
            ST.agendamentos = d.data.map(function(a) {
                var parts = (a.data_hora || '').split(' ')
                var hora = parts[1] || ''
                var horaFim = ''
                if (hora) {
                    var h = parseInt(hora.split(':')[0]) || 9
                    var m = parseInt(hora.split(':')[1]) || 0
                    horaFim = h + ':' + (m + 30 < 60 ? (m+30) : '00')
                    if (m + 30 >= 60) horaFim = (h+1) + ':' + String(m+30-60).padStart(2,'0')
                }
                return {
                    date: parts[0] || '',
                    fromTime: hora,
                    toTime: horaFim,
                    PatientName: a.paciente_nome || '',
                    CategoryDescription: a.categoria || '',
                    ProfessionalName: a.profissional_nome || '',
                    MobilePhone: '',
                    Deleted: a.status === 'cancelado',
                    Status: a.status,
                    _profId: a.profissional_id
                }
            })

            // Carregar profs se não tem
            if (!ST.profissionais || ST.profissionais.length === 0) {
                var profs = await apiGet('profissionais')
                if (profs && profs.data) {
                    ST.profissionais = profs.data
                    ST.dashboard = ST.dashboard || {}
                    ST.dashboard.profissionais = profs.data
                }
            }

            if (typeof renderMiniCal === 'function') renderMiniCal()
            if (typeof renderProfsList === 'function') renderProfsList()
            if (typeof renderAgendaGrid === 'function') renderAgendaGrid()
        }

        // Também carregar pacientes para busca
        if (!ST.pacientesLista || ST.pacientesLista.length === 0) {
            loadPacientesTurso()
        }

        if (loadingEl) loadingEl.classList.add('hidden')
        if (gridEl) gridEl.classList.remove('hidden')

        // Info de quantos agendamentos sem confirmação
        var warnEl = document.getElementById('agenda-warn-txt')
        if (warnEl && d) {
            var semConfirm = (d.data || []).filter(function(a){ return a.status === 'agendado' }).length
            warnEl.textContent = semConfirm > 0 ? semConfirm + ' sem confirmação' : ''
        }

    } catch(e) {
        console.error('[Turso] Erro agenda:', e)
        if (_origLoadAgenda) _origLoadAgenda()
    }
}

// ── PACIENTES via Turso ─────────────────────────────────
async function loadPacientesTurso(busca, status) {
    try {
        var params = { limit: 100 }
        if (busca) params.busca = busca
        if (status) params.status = status

        var d = await apiGet('pacientes', params)
        if (!d) return

        ST.pacientesLista = (d.data || []).map(function(p) {
            return {
                nome: p.nome,
                tel: p.telefone || '',
                email: p.email || '',
                ultima: p.ultima_visita ? new Date(p.ultima_visita) : new Date(2020,0,1),
                id: p.id,
                dias_ausente: p.dias_ausente
            }
        })

        // Atualizar contagens
        if (d.resumo) {
            var subEl = document.getElementById('pac-sub')
            if (subEl) subEl.textContent = d.resumo.total_pacientes + ' pacientes (' + d.resumo.total_ativos + ' ativos, ' + d.resumo.total_inativos + ' inativos)'
        }

        if (typeof renderPacientesFromTurso === 'function') renderPacientesFromTurso()
        else if (typeof filterPac === 'function') filterPac()

        var loadEl = document.getElementById('pac-loading')
        var dataEl = document.getElementById('pac-data')
        if (loadEl) loadEl.classList.add('hidden')
        if (dataEl) dataEl.classList.remove('hidden')

        // Atualizar prontuário sidebar
        if (typeof filterProntList === 'function') filterProntList()

    } catch(e) { console.error('[Turso] Erro pacientes:', e) }
}

// Override renderPacientes
window.renderPacientes = function() { loadPacientesTurso() }

// Override filterPac com debounce
var _filterTimer = null
var _origFilterPac = window.filterPac
window.filterPac = function() {
    clearTimeout(_filterTimer)
    _filterTimer = setTimeout(function() {
        var q = (document.getElementById('pac-search').value || '').trim()
        var f = document.getElementById('pac-filter').value

        if (q.length >= 2 || f !== 'todos') {
            loadPacientesTurso(q, f === 'todos' ? '' : f === 'inativos' ? 'inativos' : f === 'ativos' ? 'ativos' : '')
        } else if (q.length === 0) {
            loadPacientesTurso('', f === 'todos' ? '' : f)
        }
        // Para buscas de 1 char, usar o filtro local
        else if (_origFilterPac) _origFilterPac()
    }, 300)
}

// ── CRC via Turso ───────────────────────────────────────
window.renderCRM = async function() {
    var f = document.getElementById('crm-filter').value
    var prio = f === 'all' ? '' : f

    var d = await apiGet('crc', { prioridade: prio })
    if (!d) return

    // Atualizar KPIs
    var el
    el = document.getElementById('crm-urgente'); if (el) el.textContent = d.contagens.urgente
    el = document.getElementById('crm-alta'); if (el) el.textContent = d.contagens.alta
    el = document.getElementById('crm-media'); if (el) el.textContent = d.contagens.media
    el = document.getElementById('crm-sub'); if (el) el.textContent = d.contagens.total + ' pacientes sem visita há 6+ meses'

    var bmap = {urgente:'badge-red', alta:'badge-orange', media:'badge-green'}
    var lmap = {urgente:'URGENTE', alta:'ALTA', media:'MÉDIA'}

    var tableEl = document.getElementById('crm-table')
    if (tableEl) {
        tableEl.innerHTML = (d.data || []).map(function(p, i) {
            var tel = (p.telefone || '').replace(/\D/g, '')
            var nome1 = (p.nome || '').split(' ')[0]
            var wa = 'https://wa.me/55' + tel + '?text=' + encodeURIComponent('Olá ' + nome1 + '! É a Klinik Odontologia. Sentimos sua falta! 😊')
            return '<tr><td class="text-muted">' + (i+1) + '</td><td><div class="pname">' + p.nome + '</div></td><td class="text-muted">' + (p.ultima_visita || '—') + '</td><td style="color:var(--red);font-weight:500">' + (p.dias_ausente||'?') + 'd</td><td><span class="badge ' + (bmap[p.prioridade]||'') + '">' + (lmap[p.prioridade]||'') + '</span></td><td>' + (tel ? '<a href="'+wa+'" target="_blank" class="wa-btn">WhatsApp</a>' : '—') + '</td></tr>'
        }).join('')
    }
}

// ── PROFISSIONAIS via Turso ─────────────────────────────
var _origLoadProfissionais = window.loadProfissionais
window.loadProfissionais = async function() {
    var loadEl = document.getElementById('prof-loading')
    var dataEl = document.getElementById('prof-data')
    if (loadEl) loadEl.classList.remove('hidden')
    if (dataEl) dataEl.classList.add('hidden')

    try {
        var d = await apiGet('profissionais')
        if (!d || !d.data) { if (_origLoadProfissionais) _origLoadProfissionais(); return }

        ST.profissionais = d.data
        var subEl = document.getElementById('prof-sub')
        if (subEl) subEl.textContent = d.data.length + ' profissionais cadastrados'

        var PROF_CORES = ['#9C27B0','#4CAF50','#FF9800','#795548','#2196F3','#E91E63','#00BCD4','#F44336']
        var gridEl = document.getElementById('prof-grid')
        if (gridEl) {
            gridEl.innerHTML = d.data.map(function(p, i) {
                var nome = p.nome || 'Profissional'
                var esp = p.especialidade || ''
                var ini = nome.split(' ').slice(0,2).map(function(x){return x[0]}).join('')
                var cor = PROF_CORES[i % PROF_CORES.length]
                var agMes = p.agendamentos_mes || 0
                var agTotal = p.total_agendamentos || 0
                return '<div class="prof-card"><div class="prof-av" style="background:'+cor+'22;color:'+cor+'">'+ini+'</div><div class="prof-name">'+nome+'</div><div class="prof-esp">'+esp+'</div><div style="margin-top:8px;font-size:11px;color:var(--text3)">'+agTotal+' agendamentos total</div><div style="font-size:11px;color:var(--green)">'+agMes+' este mês</div><span class="badge badge-green" style="margin-top:8px">Ativo</span></div>'
            }).join('')
        }

        if (typeof renderProfsList === 'function') renderProfsList()
        if (loadEl) loadEl.classList.add('hidden')
        if (dataEl) dataEl.classList.remove('hidden')

    } catch(e) {
        console.error('[Turso] Erro profissionais:', e)
        if (_origLoadProfissionais) _origLoadProfissionais()
    }
}

// ── BUSCA GLOBAL via Turso ──────────────────────────────
var _origGlobalSearch = window.globalSearch
window.globalSearch = async function(q) {
    if (!q || q.length < 2) return

    // Primeiro, tentar navegar para página
    var lower = q.toLowerCase()
    var pages = ['agenda','pacientes','financeiro','relatorios','configuracoes','profissionais','crm','aniversariantes']
    var match = pages.find(function(p) { return p.includes(lower) || lower.includes(p.substring(0,4)) })
    if (match && q.length > 3) { nav(match); return }

    // Se não é navegação, fazer busca de dados
    var d = await apiGet('busca', { q: q })
    if (!d || d.total === 0) return

    // Se encontrou pacientes, ir para pacientes e preencher busca
    if (d.pacientes && d.pacientes.length > 0) {
        nav('pacientes')
        var searchEl = document.getElementById('pac-search')
        if (searchEl) { searchEl.value = q; filterPac() }
    }
}

// ── RELATÓRIOS via Turso ────────────────────────────────
window.renderRelatorios = async function() {
    var d = ST.dashboard
    if (!d) return

    // Atualizar KPIs
    if (typeof renderRelCounts === 'function') renderRelCounts(d)

    // Gráfico de produção por mês
    var sorted = Object.entries(d.por_mes).sort(function(a,b){return a[0].localeCompare(b[0])}).slice(-6)
    var max = Math.max.apply(null, sorted.map(function(x){return x[1]}))
    var chartEl = document.getElementById('rel-chart')
    if (chartEl && sorted.length > 0) {
        chartEl.innerHTML = sorted.map(function(item) {
            var m = item[0], v = item[1]
            var parts = m.split('-')
            var MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
            return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:10px;color:var(--text3);font-weight:500">'+v+'</div><div style="height:'+Math.max(4,Math.round(v/max*90))+'px;width:100%;background:rgba(27,94,59,.6);border-radius:2px 2px 0 0;max-width:36px"></div><div style="font-size:10px;color:var(--text3)">'+MESES_ABR[parseInt(parts[1])-1]+'</div></div>'
        }).join('')
    }

    // Procedimentos
    var cats = Object.entries(d.por_categoria).sort(function(a,b){return b[1]-a[1]}).slice(0,10)
    var totalCat = cats.reduce(function(s,c){return s+c[1]},0)
    var procEl = document.getElementById('rel-proc')
    if (procEl) {
        procEl.innerHTML = cats.map(function(c) {
            return '<tr><td class="pname">'+c[0]+'</td><td>'+c[1]+'</td><td style="color:var(--text3)">'+Math.round(c[1]/totalCat*100)+'%</td></tr>'
        }).join('')
    }

    // Profissionais
    var profsEl = document.getElementById('rel-profs')
    if (profsEl && ST.profissionais) {
        profsEl.innerHTML = (ST.profissionais || []).map(function(p) {
            return '<tr><td class="pname">'+(p.nome||'—')+'</td><td class="text-muted">'+(p.total_agendamentos||0)+'</td></tr>'
        }).join('')
    }

    // Inativos
    var inativos = d.inativos || []
    var urgEl = document.getElementById('rel-urg'); if (urgEl) urgEl.textContent = inativos.filter(function(i){return i.dias>365}).length
    var altEl = document.getElementById('rel-alta'); if (altEl) altEl.textContent = inativos.filter(function(i){return i.dias>270&&i.dias<=365}).length
    var medEl = document.getElementById('rel-med'); if (medEl) medEl.textContent = inativos.filter(function(i){return i.dias<=270}).length
}

// ── ANIVERSARIANTES via Turso ───────────────────────────
var _origLoadAniversariantes = window.loadAniversariantes
window.loadAniversariantes = async function() {
    var loadEl = document.getElementById('aniv-loading')
    var dataEl = document.getElementById('aniv-data')
    if (loadEl) loadEl.classList.remove('hidden')
    if (dataEl) dataEl.classList.add('hidden')

    try {
        var d = await apiGet('aniversariantes')
        if (!d) { if (_origLoadAniversariantes) _origLoadAniversariantes(); return }

        ST.aniversariantes = d.data || []
        var MMS = ['','JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ']

        var listEl = document.getElementById('aniv-list')
        if (listEl) {
            listEl.innerHTML = ST.aniversariantes.length ? ST.aniversariantes.map(function(a) {
                var tel = (a.telefone || '').replace(/\D/g, '')
                var nome1 = (a.nome || '').split(' ')[0]
                var dt = a.dia_aniversario || ''
                var parts = dt.split('-')
                var dia = parts[2] || '?'
                var mes = parts[1] ? MMS[parseInt(parts[1])] : '?'
                var wa = 'https://wa.me/55' + tel + '?text=' + encodeURIComponent('Feliz aniversário, ' + nome1 + '! 🎂 A equipe Klinik te deseja um dia incrível!')
                return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)"><div style="width:40px;text-align:center;background:rgba(27,94,59,.08);border-radius:6px;padding:4px"><div style="font-size:18px;font-weight:300;color:var(--green)">'+dia+'</div><div style="font-size:9px;color:var(--text3)">'+mes+'</div></div><div style="flex:1"><div style="font-weight:500;font-size:13px">'+a.nome+'</div><div style="font-size:12px;color:var(--text3)">'+(a.telefone||'—')+' · em '+a.dias_faltam+' dias</div></div>'+(tel?'<a href="'+wa+'" target="_blank" class="wa-btn">Parabenizar</a>':'')+'</div>'
            }).join('') : '<div style="text-align:center;padding:30px;color:var(--text3)">Nenhum aniversariante nos próximos 60 dias</div>'
        }

        if (loadEl) loadEl.classList.add('hidden')
        if (dataEl) dataEl.classList.remove('hidden')

    } catch(e) {
        console.error('[Turso] Erro aniversariantes:', e)
        if (_origLoadAniversariantes) _origLoadAniversariantes()
    }
}

// ── FINANCEIRO via Turso ────────────────────────────────
var _origLoadFinanceiro = window.loadFinanceiro
window.loadFinanceiro = async function() {
    try {
        var d = await apiGet('financeiro', { limit: 60 })
        if (!d) { if (_origLoadFinanceiro) _origLoadFinanceiro(); return }

        ST.recebimentos = d.data || []
        var t = d.totais || {}

        var el
        el = document.getElementById('fin-total'); if (el) el.textContent = 'R$ ' + (t.total_geral||0).toLocaleString('pt-BR', {minimumFractionDigits:2})
        el = document.getElementById('fin-ticket'); if (el) el.textContent = 'R$ ' + (t.total_registros > 0 ? Math.round(t.total_geral / t.total_registros) : 0).toLocaleString('pt-BR')
        el = document.getElementById('fin-count'); if (el) el.textContent = t.total_registros || 0
        el = document.getElementById('fin-max'); if (el) {
            var maxVal = Math.max.apply(null, (d.data||[]).map(function(r){return r.valor||0}))
            el.textContent = 'R$ ' + maxVal.toLocaleString('pt-BR', {minimumFractionDigits:2})
        }

        // Renderizar tabela
        var tableEl = document.getElementById('fin-table')
        if (tableEl) {
            tableEl.innerHTML = (d.data || []).slice(0, 60).map(function(r, i) {
                var v = r.valor || 0
                var dt = r.data_pagamento || '—'
                return '<tr><td class="text-muted">'+(i+1)+'</td><td><div class="pname">'+(r.descricao||'—')+'</div></td><td class="text-muted">'+dt+'</td><td style="color:var(--green);font-weight:500">R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</td></tr>'
            }).join('')
        }

        ST._finData = d.data
        var loadEl = document.getElementById('fin-loading')
        var dataEl = document.getElementById('fin-data')
        if (loadEl) loadEl.classList.add('hidden')
        if (dataEl) dataEl.classList.remove('hidden')

    } catch(e) {
        console.error('[Turso] Erro financeiro:', e)
        if (_origLoadFinanceiro) _origLoadFinanceiro()
    }
}

// ── DASHBOARD ANALÍTICO via Turso ───────────────────────
var _origRenderDashAnalitico = window.renderDashAnalitico
window.renderDashAnalitico = async function() {
    // Buscar dados reais
    var prod = await apiGet('relatorios', { tipo: 'producao', meses: 3 })

    if (prod && prod.producao_mensal) {
        var dados = prod.producao_mensal.map(function(m) {
            // Buscar receita correspondente
            var rec = (prod.receita_mensal || []).find(function(r){return r.mes === m.mes}) || {}
            return {
                mes: m.mes,
                agendamentos: m.agendamentos,
                entrada: rec.receita || 0
            }
        })

        var max = Math.max.apply(null, dados.map(function(d){return Math.max(d.agendamentos*50, d.entrada)})) || 1
        var MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

        var chartEl = document.getElementById('chart-caixa')
        if (chartEl) {
            chartEl.innerHTML = dados.map(function(d) {
                var parts = d.mes.split('-')
                var label = MESES_ABR[parseInt(parts[1])-1] || d.mes
                return '<div class="bar-grp" style="flex:1"><div class="bar-grp-bars"><div class="bar-seg" style="height:'+Math.max(4,Math.round(d.entrada/max*90))+'px;background:#1976D2" title="Receita: R$ '+d.entrada.toLocaleString('pt-BR')+'"></div><div class="bar-seg" style="height:'+Math.max(4,d.agendamentos/10)+'px;background:#F9A825" title="Agendamentos: '+d.agendamentos+'"></div></div><div class="bar-lbl">'+label+'</div></div>'
            }).join('')
        }
    }

    // Manter gráficos estáticos que não tem dados dinâmicos ainda
    if (_origRenderDashAnalitico) {
        // Apenas chamar os outros gráficos estáticos
        var nfEl = document.getElementById('chart-nf')
        var desmEl = document.getElementById('chart-desmarcados')
        var faltEl = document.getElementById('chart-faltas')
        if (nfEl && nfEl.innerHTML === '') _origRenderDashAnalitico()
    }
}

// ── PRONTUÁRIO via Turso ────────────────────────────────
var _origAbrirProntuario = window.abrirProntuario
window.abrirProntuario = async function(nome) {
    nav('prontuario')

    // Buscar paciente pelo nome
    var pac = await apiGet('pacientes', { busca: nome, limit: 1 })
    if (!pac || !pac.data || pac.data.length === 0) {
        if (_origAbrirProntuario) _origAbrirProntuario(nome)
        return
    }

    var pacId = pac.data[0].id
    var detalhe = await apiGet('pacientes', { id: pacId })
    if (!detalhe) { if (_origAbrirProntuario) _origAbrirProntuario(nome); return }

    var p = detalhe.paciente
    var ags = detalhe.agendamentos || []
    var fin = detalhe.financeiro || []

    var teeth_sup = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28]
    var teeth_inf = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]

    var detailEl = document.getElementById('pront-detail')
    if (detailEl) {
        detailEl.innerHTML =
            '<div class="card" style="margin-bottom:12px"><div class="card-header"><div class="card-title">'+p.nome+'</div><button class="btn btn-sm btn-primary">Editar Cadastro</button></div><div class="card-body"><span class="badge badge-blue">'+ags.length+' consultas</span> <span class="badge badge-green">'+fin.length+' registros financeiros</span>'+(p.telefone?' <span style="margin-left:8px;color:var(--text3)">'+p.telefone+'</span>':'')+(p.email?' <span style="margin-left:8px;color:var(--text3)">'+p.email+'</span>':'')+'</div></div>' +
            '<div class="card" style="margin-bottom:12px"><div class="card-header"><div class="card-title">Odontograma</div></div><div style="padding:4px 8px;font-size:10px;text-align:center;color:var(--text3)">SUPERIOR</div><div class="odont-row">'+teeth_sup.map(function(t){return '<div><div class="tooth" title="'+t+'">'+t+'</div></div>'}).join('')+'</div><div class="odont-row">'+teeth_inf.map(function(t){return '<div><div class="tooth" title="'+t+'">'+t+'</div></div>'}).join('')+'</div><div style="padding:4px 8px;font-size:10px;text-align:center;color:var(--text3)">INFERIOR</div></div>' +
            '<div class="card"><div class="card-header"><div class="card-title">Histórico de Consultas</div></div><div class="card-body p0"><table class="tbl"><thead><tr><th>Data</th><th>Categoria</th><th>Profissional</th><th>Status</th></tr></thead><tbody>'+ags.map(function(a){return '<tr><td>'+(a.data_hora||'—').slice(0,10)+'</td><td><span class="badge badge-blue">'+(a.categoria||'Geral')+'</span></td><td>'+(a.profissional||'—')+'</td><td>'+(a.status||'—')+'</td></tr>'}).join('')+'</tbody></table></div></div>'

        // Financeiro do paciente
        if (fin.length > 0) {
            detailEl.innerHTML += '<div class="card" style="margin-top:12px"><div class="card-header"><div class="card-title">Financeiro</div></div><div class="card-body p0"><table class="tbl"><thead><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr></thead><tbody>'+fin.map(function(f){return '<tr><td>'+(f.data_pagamento||'—')+'</td><td>'+(f.descricao||'—')+'</td><td style="color:var(--green);font-weight:500">R$ '+(f.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</td></tr>'}).join('')+'</tbody></table></div></div>'
        }
    }

    if (typeof filterProntList === 'function') filterProntList()
}

// ── LOG ─────────────────────────────────────────────────
console.log('[Klinik Turso] Data layer ativo — APIs conectadas ao banco Turso')

})()
