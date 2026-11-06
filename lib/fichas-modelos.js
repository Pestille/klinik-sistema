// lib/fichas-modelos.js — Modelos de ficha de especialidade: endodontia, periodontia,
// alinhadores e toxina botulínica (estética e terapêutica). Campos e textos tirados
// das fichas do Clinicorp (Ficha Endodôntica, Ficha Periodontia/Periograma, Alinhadores,
// Toxina Botulínica). Cada modelo normaliza o que vem da tela antes de gravar.
//
// Devolve { dados } ou { erro }.

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function data(v) { return DATA_RE.test(String(v || '')) ? String(v) : null }
function escolha(v, mapa) { v = String(v == null ? '' : v); return Object.prototype.hasOwnProperty.call(mapa, v) ? v : '' }
// Lista de marcações: só as chaves conhecidas
function marcas(v, mapa) { var out = []; (Array.isArray(v) ? v : []).forEach(function (k) { k = String(k); if (mapa[k] && out.indexOf(k) < 0) out.push(k) }); return out }
function numero(v, min, max, casas) {
    if (v === null || v === undefined || v === '') return { v: null }
    var n = Number(String(v).replace(',', '.'))
    if (!isFinite(n) || n < min || n > max) return { erro: true }
    var f = Math.pow(10, casas == null ? 1 : casas)
    return { v: Math.round(n * f) / f }
}
// Dente FDI permanente (11–48) ou decíduo (51–85)
function denteOk(d) { return /^([1-4][1-8]|[5-8][1-5])$/.test(String(d || '')) }
function addDias(ymd, n) { var d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ── Endodontia ──────────────────────────────────────────────────────
var ENDO = {
    situacao: { a_realizar: 'A realizar', existente: 'Existente' },
    status: { avaliacao: 'Em Avaliação', tratamento: 'Em Tratamento', executado: 'Executado', suspenso: 'Suspenso', finalizado: 'Finalizado' },
    condicao: { sem_antecedente: 'Sem Antecedente', protese: 'Prótese Dentária', trat_protetico: 'Tratamentos Protéticos', retratamento: 'Retratamento', endo_insatisfatorio: 'Trat. Endo Insatisfatório', lesao_apical: 'Lesão Apical' },
    sintomas: { dor_provocada: 'Dor Provocada', dor_espontanea: 'Dor Espontânea', dor_ausente: 'Dor Ausente', pulsatil: 'Pulsátil', constante: 'Constante', dor_percussao: 'Dor a Percussão', mobilidade: 'Mobilidade', edema: 'Edema', fistula_intra: 'Fístula Intra Oral', fistula_extra: 'Fístula Extra Oral' },
    vitalidade: { frio: 'Frio', calor: 'Calor' },
    canais: { atresiado: 'Atresiado', obturacao_deficiente: 'Obturação Deficiente', trepanacao: 'Trepanação', reabsorcao_interna: 'Reabsorção Interna', reabsorcao_externa: 'Reabsorção Externa' },
    proposto: { conservador: 'Trat. Conservador', biopulpectomia: 'Biopulpectomia', necropulpectomia: 'Necropulpectomia', retratamento: 'Retratamento', apicetomia: 'Apicetomia' },
    canal: { unico: 'Único', vest: 'Vest', palatino: 'Palatino/Lingual', m_vest: 'M. Vest', m_lingual: 'M. Lingual', m_palatino: 'M. Palatino', d_vest: 'D. Vest', d_lingual: 'D. Lingual' },
    final: { assintomatico: 'Assintomático', espontanea: 'Espontânea', dor: 'Dor', edema: 'Edema' },
    intercorrencias: { degrau: 'Degrau', trepanacao_coroa_raiz: 'Trepanação Coroa/Raiz', extravasamento_cone: 'Extravasamento do Cone', extravasamento_cimento: 'Extravasamento do Cimento', fratura_instrumento: 'Fratura de Instrumento' }
}
function normEndo(d, hoje) {
    d = d || {}
    var lista = Array.isArray(d.dentes) ? d.dentes : [], vistos = {}, out = []
    if (lista.length > 32) return { erro: 'No máximo 32 dentes por ficha.' }
    for (var i = 0; i < lista.length; i++) {
        var x = lista[i] || {}, dente = String(x.dente == null ? '' : x.dente).trim()
        if (!denteOk(dente)) return { erro: 'Selecione um Elemento: informe o dente na notação FDI.' }
        if (vistos[dente]) return { erro: 'O dente ' + dente + ' já está na ficha.' }
        vistos[dente] = 1
        var ini = data(x.inicio), fim = data(x.fim), rx = data(x.data_raio_x)
        if (fim && ini && fim < ini) return { erro: 'Dente ' + dente + ': o fim é anterior ao início.' }
        if (rx && rx > hoje) return { erro: 'Dente ' + dente + ': a data do raio-x não pode ser futura.' }
        var canais = []
        var cl = Array.isArray(x.odontometria) ? x.odontometria : []
        for (var k = 0; k < cl.length && k < 8; k++) {
            var c = cl[k] || {}, nome = escolha(c.canal, ENDO.canal)
            if (!nome) continue
            var mm = numero(c.mm, 0, 40, 1)
            if (mm.erro) return { erro: 'Dente ' + dente + ', canal ' + ENDO.canal[nome] + ': milímetro deve ficar entre 0 e 40.' }
            canais.push({ canal: nome, mm: mm.v, referencia: txt(c.referencia, 40), inst_inicial: txt(c.inst_inicial, 20), inst_final: txt(c.inst_final, 20), lima: txt(c.lima, 40) })
        }
        out.push({
            dente: dente, situacao: escolha(x.situacao, ENDO.situacao) || 'a_realizar', status: escolha(x.status, ENDO.status) || 'avaliacao', inicio: ini, fim: fim,
            condicao: marcas(x.condicao, ENDO.condicao), sintomas: marcas(x.sintomas, ENDO.sintomas), vitalidade: marcas(x.vitalidade, ENDO.vitalidade),
            obs_clinicas: txt(x.obs_clinicas, 2000), data_raio_x: rx, canais: marcas(x.canais, ENDO.canais), canais_outro: txt(x.canais_outro, 120),
            obs_radiograficas: txt(x.obs_radiograficas, 2000), proposto: marcas(x.proposto, ENDO.proposto), proposto_outro: txt(x.proposto_outro, 120),
            odontometria: canais, prescricao: txt(x.prescricao, 2000), obs_odontometria: txt(x.obs_odontometria, 2000),
            final: marcas(x.final, ENDO.final), intercorrencias: marcas(x.intercorrencias, ENDO.intercorrencias), intercorrencias_outro: txt(x.intercorrencias_outro, 120), obs_finalizacao: txt(x.obs_finalizacao, 2000)
        })
    }
    out.sort(function (a, b) { return a.dente < b.dente ? -1 : 1 })
    return { dados: { dentes: out, observacoes: txt(d.observacoes, 3000) } }
}

// ── Periodontia (avaliações com sessões e periograma) ──────────────
// Periograma por dente: 3 sítios por face (vestibular e palatina/lingual).
var PERIO = {
    faces: ['vestibular', 'lingual'],
    mobilidade: { '0': '0', '1': '1', '2': '2', '3': '3' },
    furca: { '0': '—', '1': 'Grau I', '2': 'Grau II', '3': 'Grau III' },
    // Furca se aplica a molares (e primeiros pré-molares superiores)
    comFurca: function (d) { return /^[1-4][678]$/.test(d) || /^[12]4$/.test(d) }
}
var DENTES_ADULTO = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38].map(String)
function normSitios(v, fn) { var a = Array.isArray(v) ? v : []; var o = []; for (var i = 0; i < 3; i++) o.push(fn(a[i])); return o }
function normPerio(d, hoje) {
    d = d || {}
    var avs = Array.isArray(d.avaliacoes) ? d.avaliacoes : [], out = []
    if (avs.length > 30) return { erro: 'No máximo 30 avaliações por ficha.' }
    for (var i = 0; i < avs.length; i++) {
        var a = avs[i] || {}, n = i + 1
        var nome = txt(a.nome, 120), dt = data(a.data), qtd = parseInt(a.sessoes_qtd, 10)
        var falta = []
        if (!nome) falta.push('Nome do Tratamento')
        if (!dt) falta.push('Data')
        if (!(qtd >= 1 && qtd <= 20)) falta.push('Quantidade de Sessões (informe um número entre 1 e 20)')
        if (falta.length) return { erro: 'Avaliação ' + n + ' — preencha os campos obrigatórios: ' + falta.join(', ') }
        if (dt > hoje) return { erro: 'Avaliação ' + n + ': a data da avaliação não pode ser maior que a data atual' }
        // Sessões: finalizadas em ordem, sem data futura nem anterior à sessão anterior
        var ses = [], src = Array.isArray(a.sessoes) ? a.sessoes : [], ultima = dt
        for (var s = 0; s < qtd; s++) {
            var fz = data((src[s] || {}).finalizada_em)
            if (fz) {
                if (fz > hoje) return { erro: 'Avaliação ' + n + ', sessão ' + (s + 1) + ': a data da sessão não pode ser maior que a data atual.' }
                if (fz < ultima) return { erro: 'Avaliação ' + n + ', sessão ' + (s + 1) + ': a data deve ser igual ou posterior à finalização da sessão anterior.' }
                if (s > 0 && !ses[s - 1].finalizada_em) return { erro: 'Avaliação ' + n + ': finalize a sessão ' + s + ' antes da sessão ' + (s + 1) + '.' }
                ultima = fz
            }
            ses.push({ numero: s + 1, finalizada_em: fz })
        }
        var pg = {}, srcPg = a.periograma && typeof a.periograma === 'object' ? a.periograma : {}
        for (var dk in srcPg) {
            if (!Object.prototype.hasOwnProperty.call(srcPg, dk) || !denteOk(dk)) continue
            var t = srcPg[dk] || {}, reg = { ausente: !!t.ausente, implante: !!t.implante, faces: {} }
            for (var f = 0; f < PERIO.faces.length; f++) {
                var fc = (t.faces || {})[PERIO.faces[f]] || {}, erroN = false
                var prof = normSitios(fc.sondagem, function (v) { var r = numero(v, 0, 20, 0); if (r.erro) erroN = true; return r.v })
                var marg = normSitios(fc.margem, function (v) { var r = numero(v, -10, 15, 0); if (r.erro) erroN = true; return r.v })
                if (erroN) return { erro: 'Avaliação ' + n + ', dente ' + dk + ': sondagem entre 0 e 20 mm e margem entre -10 e 15 mm.' }
                reg.faces[PERIO.faces[f]] = { sondagem: prof, margem: marg, sangramento: normSitios(fc.sangramento, function (v) { return !!v }), placa: normSitios(fc.placa, function (v) { return !!v }) }
            }
            reg.mobilidade = escolha(t.mobilidade, PERIO.mobilidade)
            reg.furca = PERIO.comFurca(dk) && !reg.implante ? escolha(t.furca, PERIO.furca) : ''
            reg.obs = txt(t.obs, 300)
            pg[dk] = reg
        }
        out.push({ nome: nome, data: dt, sessoes_qtd: qtd, sessoes: ses, periograma: pg })
    }
    return { dados: { avaliacoes: out, observacoes: txt(d.observacoes, 3000) } }
}
// Resumo de uma avaliação: % de sítios com sangramento e com bolsa ≥ 4 mm
function resumoPerio(av) {
    var sit = 0, sang = 0, bolsa = 0, placa = 0
    Object.keys(av.periograma || {}).forEach(function (k) {
        var t = av.periograma[k]; if (t.ausente) return
        PERIO.faces.forEach(function (f) {
            var fc = (t.faces || {})[f] || {}
            for (var i = 0; i < 3; i++) {
                if (fc.sondagem && fc.sondagem[i] != null) { sit++; if (fc.sondagem[i] >= 4) bolsa++ }
                if (fc.sangramento && fc.sangramento[i]) sang++
                if (fc.placa && fc.placa[i]) placa++
            }
        })
    })
    return { sitios: sit, sangramento: sang, bolsas: bolsa, placa: placa }
}

// ── Alinhadores ─────────────────────────────────────────────────────
function normAlinhadores(d, hoje) {
    d = d || {}
    var q = parseInt(d.quantidade, 10), troca = parseInt(d.trocar_dias, 10)
    if (d.quantidade !== '' && d.quantidade != null && !(q >= 1 && q <= 120)) return { erro: 'Quantidade de Alinhadores deve ficar entre 1 e 120.' }
    if (d.trocar_dias !== '' && d.trocar_dias != null && !(troca >= 1 && troca <= 60)) return { erro: 'Trocar Alinhadores a Cada: entre 1 e 60 dias.' }
    var ini = data(d.inicio), fim = data(d.fim)
    if (ini && fim && fim < ini) return { erro: 'A Data de Fim é anterior à Data de Início.' }
    var refs = [], src = Array.isArray(d.refinamentos) ? d.refinamentos : []
    for (var i = 0; i < src.length && i < 10; i++) {
        var r = src[i] || {}, rq = parseInt(r.quantidade, 10), rt = parseInt(r.trocar_dias, 10)
        if (!(rq >= 1 && rq <= 120)) return { erro: 'Refinamento ' + (i + 1) + ': Quantidade de Novos Alinhadores entre 1 e 120.' }
        refs.push({ quantidade: rq, trocar_dias: rt >= 1 && rt <= 60 ? rt : null, inicio: data(r.inicio) })
    }
    var total = (q || 0) + refs.reduce(function (a, r) { return a + r.quantidade }, 0)
    var atual = parseInt(d.alinhador_atual, 10)
    if (d.alinhador_atual !== '' && d.alinhador_atual != null && !(atual >= 1 && atual <= Math.max(total, 1))) return { erro: 'Alinhador Atual deve ficar entre 1 e ' + Math.max(total, 1) + '.' }
    var iniAt = data(d.inicio_atual)
    if (iniAt && iniAt > addDias(hoje, 60)) return { erro: 'Início do Alinhador Atual muito à frente.' }
    return { dados: {
        empresa: txt(d.empresa, 60), arcada: escolha(d.arcada, { ambas: 'Superior e inferior', superior: 'Superior', inferior: 'Inferior' }), quantidade: q || null, trocar_dias: troca || null,
        inicio: ini, fim: fim, alinhador_atual: atual || null, inicio_atual: iniAt, refinamentos: refs, link: txt(d.link, 300), observacoes: txt(d.observacoes, 3000)
    } }
}
// Calcula fim do atual e início do próximo
function andamentoAlinhador(d) {
    if (!d || !d.inicio_atual || !d.alinhador_atual) return null
    var troca = d.trocar_dias || 14
    var fimAt = addDias(d.inicio_atual, troca)
    var total = (d.quantidade || 0) + (d.refinamentos || []).reduce(function (a, r) { return a + r.quantidade }, 0)
    return { fim_atual: fimAt, proximo: d.alinhador_atual < total ? d.alinhador_atual + 1 : null, inicio_proximo: d.alinhador_atual < total ? fimAt : null, total: total }
}

// ── Toxina botulínica ──────────────────────────────────────────────
var TOXINA = {
    regioes: { glabelares: 'Linhas Glabelares', frontais: 'Linhas Frontais', cantais: 'Linhas Cantais', bunny: 'Bunny-lines', mento: 'Linhas do Mento', periorais: 'Linhas Periorais', masseter: 'Masseter', outra: 'Outra' }
}
function normToxina(d, hoje) {
    d = d || {}
    var lotes = [], ls = Array.isArray(d.lotes) ? d.lotes : []
    for (var i = 0; i < ls.length && i < 20; i++) {
        var l = ls[i] || {}, prod = txt(l.produto, 80)
        if (!prod) continue
        var vol = numero(l.diluicao, 0, 100, 2)
        if (vol.erro) return { erro: 'Lote ' + (i + 1) + ': Volume Diluição (ml) entre 0 e 100.' }
        lotes.push({ produto: prod, validade: data(l.validade), lote: txt(l.lote, 40), diluicao: vol.v })
    }
    var aps = [], as = Array.isArray(d.aplicacoes) ? d.aplicacoes : []
    for (var j = 0; j < as.length && j < 60; j++) {
        var a = as[j] || {}, reg = escolha(a.regiao, TOXINA.regioes)
        if (!reg) continue
        var u = numero(a.unidades, 0, 500, 1), pr = numero(a.preco, 0, 100000, 2)
        if (u.erro) return { erro: TOXINA.regioes[reg] + ': quantidade (UI) entre 0 e 500.' }
        if (pr.erro) return { erro: TOXINA.regioes[reg] + ': preço inválido.' }
        var dt = data(a.data)
        if (dt && dt > hoje) return { erro: TOXINA.regioes[reg] + ': a data da aplicação não pode ser futura.' }
        aps.push({ regiao: reg, descricao: txt(a.descricao, 80), produto: txt(a.produto, 80), unidades: u.v, preco: pr.v, data: dt, retoque: !!a.retoque, obs: txt(a.obs, 300) })
    }
    return { dados: { finalidade: escolha(d.finalidade, { estetica: 'Estética', terapeutica: 'Terapêutica' }) || 'estetica', lotes: lotes, aplicacoes: aps, cuidados: txt(d.cuidados, 3000), observacoes: txt(d.observacoes, 3000) } }
}

var MODELOS = {
    endodontia: { nome: 'Endodontia', norm: normEndo },
    periodontia: { nome: 'Periodontia', norm: normPerio },
    alinhadores: { nome: 'Alinhadores', norm: normAlinhadores },
    toxina: { nome: 'Toxina Botulínica', norm: normToxina }
}

module.exports = { MODELOS: MODELOS, ENDO: ENDO, PERIO: { mobilidade: PERIO.mobilidade, furca: PERIO.furca, faces: PERIO.faces }, DENTES_ADULTO: DENTES_ADULTO, TOXINA: TOXINA, normEndo: normEndo, normPerio: normPerio, normAlinhadores: normAlinhadores, normToxina: normToxina, resumoPerio: resumoPerio, andamentoAlinhador: andamentoAlinhador, comFurca: PERIO.comFurca }
