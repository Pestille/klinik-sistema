// lib/rotas/fichas.js — Fichas de especialidade do prontuário (ortodontia e implante)
// Klinov — Campo Grande, MS
//
// Uma ficha por tratamento de especialidade do paciente. Os campos de cada modelo
// ficam em dados_json, sempre normalizados aqui (normOrto/normImplante) antes de
// gravar. As visitas de acompanhamento (manutenções, retornos) ficam em
// ficha_esp_visitas para os relatórios acharem a última sem abrir o JSON.
//
//   fichas-especialidade  GET  ?paciente_id    fichas do paciente, com visitas
//                         POST salvar | action delete | visita | visita-remover
//
// Implante: cada implante tem cinco etapas (planejamento → finalização) com data
// prevista e data em que foi feita. A etapa atual é sempre a seguinte à última
// feita, mesmo que alguma do meio tenha sido pulada (ex.: carga imediata sem
// reabertura).

var { moverParaLixeira } = require('../lixeira')
var FM = require('../fichas-modelos')

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var TIPOS = { ortodontia: 'Ortodontia', implante: 'Implante', endodontia: 'Endodontia', periodontia: 'Periodontia', alinhadores: 'Alinhadores', toxina: 'Toxina Botulínica' }
var STATUS = { avaliacao: 'Em avaliação', tratamento: 'Em tratamento', suspenso: 'Suspenso', finalizado: 'Finalizado' }
var FILOSOFIAS = { convencional: 'Convencional (bráquete metálico)', estetico: 'Estético (cerâmica/safira)', autoligado: 'Autoligado', lingual: 'Lingual', alinhadores: 'Alinhadores', ortopedico: 'Ortopedia funcional', outro: 'Outro' }
var ARCADAS = { ambas: 'Superior e inferior', superior: 'Superior', inferior: 'Inferior' }
var CLASSES = { 'I': 'Classe I', 'II-1': 'Classe II divisão 1', 'II-2': 'Classe II divisão 2', 'III': 'Classe III' }
var CARGAS = { imediata: 'Imediata', precoce: 'Precoce', tardia: 'Tardia' }
var ETAPAS = [['planejamento', 'Planejamento'], ['cirurgia', 'Cirurgia'], ['reabertura', 'Reabertura'], ['protetico', 'Protético'], ['finalizacao', 'Finalização']]
var MAX_IMPLANTES = 32

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function data(v) { return DATA_RE.test(String(v || '')) ? String(v) : null }
function escolha(v, mapa) { v = String(v == null ? '' : v); return Object.prototype.hasOwnProperty.call(mapa, v) ? v : '' }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// Número opcional dentro da faixa. Devolve { v } ou { erro }.
function medida(v, min, max, nome) {
    if (v === null || v === undefined || v === '') return { v: null }
    var n = Number(String(v).replace(',', '.'))
    if (!isFinite(n) || n < min || n > max) return { erro: nome + ' deve ficar entre ' + min + ' e ' + max + '.' }
    return { v: Math.round(n * 10) / 10 }
}

function normOrto(d, hoje) {
    d = d || {}
    var intervalo = d.intervalo_dias === '' || d.intervalo_dias == null ? 30 : Number(d.intervalo_dias)
    if (!Number.isInteger(intervalo) || intervalo < 7 || intervalo > 180) return { erro: 'O intervalo entre manutenções deve ficar entre 7 e 180 dias.' }
    if (d.previsao_termino && !data(d.previsao_termino)) return { erro: 'Previsão de término inválida.' }
    return { dados: {
        filosofia: escolha(d.filosofia, FILOSOFIAS), arcada: escolha(d.arcada, ARCADAS), classe: escolha(d.classe, CLASSES),
        previsao_termino: data(d.previsao_termino), intervalo_dias: intervalo,
        queixa: txt(d.queixa, 1000), plano: txt(d.plano, 3000), contencao: txt(d.contencao, 500), observacoes: txt(d.observacoes, 3000)
    } }
}

function normImplante(d, hoje) {
    d = d || {}
    var lista = Array.isArray(d.implantes) ? d.implantes : []
    if (lista.length > MAX_IMPLANTES) return { erro: 'No máximo ' + MAX_IMPLANTES + ' implantes por ficha.' }
    var vistos = {}, out = []
    for (var i = 0; i < lista.length; i++) {
        var x = lista[i] || {}, n = i + 1
        var dente = String(x.dente == null ? '' : x.dente).trim()
        // Implante só em dente permanente (notação FDI 11–48)
        if (!/^[1-4][1-8]$/.test(dente)) return { erro: 'Implante ' + n + ': informe o dente na notação FDI (11 a 48).' }
        if (vistos[dente]) return { erro: 'O dente ' + dente + ' aparece em dois implantes.' }
        vistos[dente] = 1
        var di = medida(x.diametro, 2, 8, 'Implante ' + n + ': o diâmetro (mm)'); if (di.erro) return di
        var co = medida(x.comprimento, 4, 20, 'Implante ' + n + ': o comprimento (mm)'); if (co.erro) return co
        var to = medida(x.torque, 0, 100, 'Implante ' + n + ': o torque (Ncm)'); if (to.erro) return to
        var et = {}, src = x.etapas || {}
        for (var k = 0; k < ETAPAS.length; k++) {
            var e = src[ETAPAS[k][0]] || {}
            if (e.prevista && !data(e.prevista)) return { erro: 'Implante ' + n + ': data prevista de ' + ETAPAS[k][1].toLowerCase() + ' inválida.' }
            if (e.executada && !data(e.executada)) return { erro: 'Implante ' + n + ': data de ' + ETAPAS[k][1].toLowerCase() + ' inválida.' }
            if (e.executada && e.executada > hoje) return { erro: 'Implante ' + n + ': ' + ETAPAS[k][1].toLowerCase() + ' não pode ter sido feita numa data futura.' }
            et[ETAPAS[k][0]] = { prevista: data(e.prevista), executada: data(e.executada) }
        }
        out.push({ dente: dente, marca: txt(x.marca, 60), modelo: txt(x.modelo, 60), diametro: di.v, comprimento: co.v, torque: to.v, carga: escolha(x.carga, CARGAS), etapas: et })
    }
    out.sort(function (a, b) { return a.dente < b.dente ? -1 : 1 })
    return { dados: { implantes: out, enxerto: txt(d.enxerto, 500), observacoes: txt(d.observacoes, 3000) } }
}

// Etapa atual: a seguinte à última feita. null = todas feitas.
function etapaAtual(imp) {
    var ult = -1
    ETAPAS.forEach(function (e, i) { if (imp.etapas && imp.etapas[e[0]] && imp.etapas[e[0]].executada) ult = i })
    return ult + 1 < ETAPAS.length ? ETAPAS[ult + 1][0] : null
}

function lerDados(row) { try { return JSON.parse(row.dados_json || '{}') || {} } catch (e) { return {} } }

// Completa a ficha com o que a tela e os relatórios precisam
function montar(f, visitas) {
    var d = lerDados(f)
    var vs = visitas.filter(function (v) { return Number(v.ficha_id) === Number(f.id) })
    var ultima = vs.length ? vs[0].data : null
    var out = { id: f.id, paciente_id: f.paciente_id, tipo: f.tipo, status: f.status, profissional_id: f.profissional_id, profissional_nome: f.profissional_nome || null,
        data_inicio: f.data_inicio, criado_por_id: f.criado_por_id, criado_por_nome: f.criado_por_nome, criado_em: f.criado_em, atualizado_em: f.atualizado_em, dados: d, visitas: vs, ultima_visita: ultima }
    if (f.tipo === 'ortodontia' && f.status === 'tratamento') {
        var base = ultima || f.data_inicio
        out.proxima_manutencao = base ? addDias(base, Number(d.intervalo_dias) || 30) : null
    }
    if (f.tipo === 'implante') (d.implantes || []).forEach(function (i) { i.etapa_atual = etapaAtual(i) })
    if (f.tipo === 'periodontia') (d.avaliacoes || []).forEach(function (a) { a.resumo = FM.resumoPerio(a) })
    if (f.tipo === 'alinhadores') out.andamento = FM.andamentoAlinhador(d)
    return out
}

async function carregarFichas(client, clinica_id, where, args) {
    var fs = (await client.execute({
        sql: "SELECT f.*, pr.nome profissional_nome FROM fichas_especialidade f LEFT JOIN profissionais pr ON pr.id=f.profissional_id AND pr.clinica_id=f.clinica_id WHERE f.clinica_id=? " + (where || '') + " ORDER BY f.data_inicio DESC, f.id DESC LIMIT 2000",
        args: [clinica_id].concat(args || [])
    })).rows
    if (!fs.length) return []
    var ids = fs.map(function (f) { return Number(f.id) })
    var vs = (await client.execute({
        sql: "SELECT v.*, pr.nome profissional_nome FROM ficha_esp_visitas v LEFT JOIN profissionais pr ON pr.id=v.profissional_id AND pr.clinica_id=v.clinica_id WHERE v.clinica_id=? AND v.ficha_id IN (" + ids.map(function () { return '?' }).join(',') + ") ORDER BY v.data DESC, v.id DESC",
        args: [clinica_id].concat(ids)
    })).rows
    return fs.map(function (f) { return montar(f, vs) })
}

async function profissionalDaClinica(client, clinica_id, id) {
    if (!id) return true
    return (await client.execute({ sql: "SELECT id FROM profissionais WHERE id=? AND clinica_id=?", args: [id, clinica_id] })).rows.length > 0
}

async function handle(route, ctx) {
    if (route !== 'fichas-especialidade') return false
    var client = ctx.client, clinica_id = ctx.clinica_id, q = ctx.q || {}, req = ctx.req, res = ctx.res, auth = ctx.auth
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }
    var hoje = hojeCG()

    if (req.method === 'GET') {
        var pid = parseInt(q.paciente_id, 10)
        if (!pid) return json(400, { success: false, error: 'Paciente não informado' })
        var lista = await carregarFichas(client, clinica_id, 'AND f.paciente_id=?', [pid])
        return json(200, { success: true, data: lista, opcoes: { tipos: TIPOS, status: STATUS, filosofias: FILOSOFIAS, arcadas: ARCADAS, classes: CLASSES, cargas: CARGAS, etapas: ETAPAS, endo: FM.ENDO, perio: FM.PERIO, dentes: FM.DENTES_ADULTO, toxina: FM.TOXINA } })
    }
    if (req.method !== 'POST') return json(405, { success: false, error: 'Método não suportado' })

    async function fichaDaClinica(id) {
        return (await client.execute({ sql: "SELECT * FROM fichas_especialidade WHERE id=? AND clinica_id=?", args: [id, clinica_id] })).rows[0]
    }

    if (b.action === 'delete') {
        var fd = await fichaDaClinica(b.id)
        if (!fd) return json(404, { success: false, error: 'Ficha não encontrada' })
        if (auth.perfil !== 'admin' && Number(fd.criado_por_id) !== Number(auth.usuario_id)) return json(403, { success: false, error: 'Só quem criou a ficha ou um administrador pode excluí-la' })
        await moverParaLixeira(client, auth, 'ficha_especialidade', fd.id)
        return json(200, { success: true })
    }

    if (b.action === 'visita') {
        var fv = await fichaDaClinica(b.ficha_id)
        if (!fv) return json(404, { success: false, error: 'Ficha não encontrada' })
        var dv = data(b.data) || hoje
        if (dv > hoje) return json(400, { success: false, error: 'A visita não pode ter data futura' })
        if (fv.data_inicio && dv < fv.data_inicio) return json(400, { success: false, error: 'A visita não pode ser anterior ao início do tratamento (' + fv.data_inicio.split('-').reverse().join('/') + ')' })
        var desc = txt(b.descricao, 2000)
        if (!desc) return json(400, { success: false, error: 'Descreva o que foi feito na visita' })
        var pv = b.profissional_id ? Number(b.profissional_id) : (fv.profissional_id || null)
        if (!await profissionalDaClinica(client, clinica_id, pv)) return json(404, { success: false, error: 'Profissional não encontrado' })
        var iv = await client.execute({ sql: "INSERT INTO ficha_esp_visitas(clinica_id,ficha_id,data,descricao,profissional_id,usuario_id,usuario_nome) VALUES(?,?,?,?,?,?,?)", args: [clinica_id, fv.id, dv, desc, pv, auth.usuario_id || null, auth.nome || null] })
        await client.execute({ sql: "UPDATE fichas_especialidade SET atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [fv.id, clinica_id] })
        return json(200, { success: true, id: Number(iv.lastInsertRowid) })
    }

    if (b.action === 'visita-remover') {
        var vr = (await client.execute({ sql: "SELECT id, usuario_id FROM ficha_esp_visitas WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })).rows[0]
        if (!vr) return json(404, { success: false, error: 'Visita não encontrada' })
        if (auth.perfil !== 'admin' && Number(vr.usuario_id) !== Number(auth.usuario_id)) return json(403, { success: false, error: 'Só quem registrou a visita ou um administrador pode removê-la' })
        await client.execute({ sql: "DELETE FROM ficha_esp_visitas WHERE id=? AND clinica_id=?", args: [vr.id, clinica_id] })
        return json(200, { success: true })
    }

    // ── Salvar (criar ou editar) ─────────────────────────────────
    var atual = null
    if (b.id) {
        atual = await fichaDaClinica(b.id)
        if (!atual) return json(404, { success: false, error: 'Ficha não encontrada' })
    }
    var tipo = atual ? atual.tipo : escolha(b.tipo, TIPOS)
    if (!tipo) return json(400, { success: false, error: 'Escolha o modelo da ficha' })
    var status = escolha(b.status, STATUS) || 'avaliacao'
    var inicio = data(b.data_inicio)
    if (b.data_inicio && !inicio) return json(400, { success: false, error: 'Data de início inválida' })
    if (!inicio) inicio = atual ? atual.data_inicio : hoje
    if (status !== 'avaliacao' && inicio > hoje) return json(400, { success: false, error: 'Um tratamento já iniciado não pode ter início numa data futura' })
    var norm = tipo === 'ortodontia' ? normOrto(b.dados, hoje) : tipo === 'implante' ? normImplante(b.dados, hoje) : FM.MODELOS[tipo].norm(b.dados, hoje)
    if (norm.erro) return json(400, { success: false, error: norm.erro })
    if (tipo === 'ortodontia' && norm.dados.previsao_termino && norm.dados.previsao_termino < inicio) return json(400, { success: false, error: 'A previsão de término não pode ser antes do início' })
    if (tipo === 'implante') {
        var antes = (norm.dados.implantes || []).filter(function (i) { return ETAPAS.some(function (e) { return i.etapas[e[0]].executada && i.etapas[e[0]].executada < inicio }) })[0]
        if (antes) return json(400, { success: false, error: 'Implante do dente ' + antes.dente + ': há etapa feita antes do início do tratamento' })
    }
    var prof = b.profissional_id ? Number(b.profissional_id) : null
    if (!await profissionalDaClinica(client, clinica_id, prof)) return json(404, { success: false, error: 'Profissional não encontrado' })
    var dj = JSON.stringify(norm.dados)

    if (atual) {
        await client.execute({ sql: "UPDATE fichas_especialidade SET status=?, profissional_id=?, data_inicio=?, dados_json=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [status, prof, inicio, dj, atual.id, clinica_id] })
        return json(200, { success: true, id: Number(atual.id) })
    }
    var pac = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })).rows[0]
    if (!pac) return json(404, { success: false, error: 'Paciente não encontrado' })
    var ins = await client.execute({
        sql: "INSERT INTO fichas_especialidade(clinica_id,paciente_id,tipo,status,profissional_id,data_inicio,dados_json,criado_por_id,criado_por_nome) VALUES(?,?,?,?,?,?,?,?,?)",
        args: [clinica_id, pac.id, tipo, status, prof, inicio, dj, auth.usuario_id || null, auth.nome || null]
    })
    return json(200, { success: true, id: Number(ins.lastInsertRowid) })
}

module.exports = { handle, carregarFichas, etapaAtual, normOrto, normImplante, TIPOS, STATUS, FILOSOFIAS, ETAPAS }
