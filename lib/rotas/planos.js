// lib/rotas/planos.js — Planos: Plano Próprio e Plano Recorrente (sem cobrança automática)
// Klinov — Campo Grande, MS
//
// Plano Recorrente: procedimentos, periodicidade, valor, duração e a cada quantos
// pagamentos o procedimento é liberado.
// Plano Próprio (igual ao Clinicorp): plano da clínica para empresas, famílias e
// pacientes fidelizados. Cobrança por pessoa, mensal ou valor total (este exige
// vigência definida), taxa de adesão opcional, juros por atraso, liberação dos
// procedimentos (após contratação, após a taxa, taxa + 1ª parcela ou após N
// parcelas) e valores por quantidade de pessoas. A adesão tem um titular e
// dependentes; a parcela é o valor por pessoa × pessoas do plano.
// Adesão: o plano de um paciente, com valor e regras próprios para a alteração do
// plano não mudar o combinado sem querer. Parcelas recebidas manualmente pela baixa
// de Contas a Receber (fin-receber-baixa, origem 'plano'); a taxa de adesão é a
// parcela número 0. Nada aqui fala com o Asaas.

var { moverParaLixeira } = require('../lixeira')

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var PERIODOS = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6 }
var LIBERACOES_PROPRIO = ['contratacao', 'taxa', 'taxa_parcela', 'parcelas']
var MESES_A_FRENTE = 12, MAX_DURACAO = 60, MAX_PARCELAS_SEM_PRAZO = 60

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
function num(v) { var n = typeof v === 'string' ? Number(v.replace(/R\$\s?/i, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) : Number(v); return isFinite(n) ? n : NaN }
function inteiro(v) { var n = Number(v); return Number.isInteger(n) ? n : NaN }
function vazio(v) { return v === null || v === undefined || v === '' }
function addMeses(ymd, n) {
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7) - 1 + n, d = +ymd.slice(8, 10)
    var ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    return new Date(Date.UTC(y, m, Math.min(d, ult))).toISOString().slice(0, 10)
}

// Sempre a partir da data de início, para o dia 31 não virar 28 para sempre depois de fevereiro.
function vencimentoDe(inicio, intervalo, numero) { return addMeses(inicio, (numero - 1) * intervalo) }

function totalDeParcelas(duracao, intervalo) { return duracao ? Math.ceil(Number(duracao) / Number(intervalo)) : null }

// Próximas parcelas a criar. Plano com prazo: todas. Sem prazo: até 12 meses à frente.
function parcelasDevidas(ad, ultimoNumero, hoje) {
    var total = totalDeParcelas(ad.duracao_meses, ad.intervalo_meses), limite = addMeses(hoje, MESES_A_FRENTE), out = []
    for (var n = Math.max(Number(ultimoNumero), 0) + 1; ; n++) {
        var v = vencimentoDe(ad.data_inicio, Number(ad.intervalo_meses), n)
        if (total ? n > total : (v > limite && n > 1)) break
        out.push({ numero: n, vencimento: v })
    }
    return out
}

function liberacoes(pagos, aCada, usos) {
    var ganhas = Math.floor(Number(pagos) / Math.max(Number(aCada) || 1, 1))
    return { ganhas: ganhas, usadas: Number(usos) || 0, disponiveis: Math.max(ganhas - (Number(usos) || 0), 0) }
}

// Plano Próprio: liberado ou não (depois de liberado, os procedimentos do plano ficam à disposição).
function liberadoProprio(a) {
    var lib = a.liberacao || 'contratacao'
    if (lib === 'taxa') return !!Number(a.taxa_paga)
    if (lib === 'taxa_parcela') return !!Number(a.taxa_paga) && !!Number(a.p1_paga)
    if (lib === 'parcelas') return Number(a.pagos) >= Math.max(Number(a.liberar_a_cada) || 1, 1)
    return true
}

// Valor por pessoa conforme a quantidade de pessoas (maior faixa alcançada).
function valorPorPessoa(plano, faixas, pessoas) {
    var v = r2(plano.valor)
    ;(faixas || []).slice().sort(function (a, b) { return a.a_partir_de - b.a_partir_de }).forEach(function (f) { if (pessoas >= Number(f.a_partir_de)) v = r2(f.valor) })
    return v
}

// Valida e normaliza o plano. Devolve { erro } ou os campos prontos para gravar.
function validarPlano(b) {
    var tipo = b.tipo === 'proprio' ? 'proprio' : 'recorrente'
    var nome = txt(b.nome, 120)
    if (!nome) return { erro: 'Dê um nome ao plano' }
    var tabela = txt(b.tabela_preco, 80)
    if (!tabela) return { erro: 'Selecione uma tabela de preços.' }
    var procs = (Array.isArray(b.procedimentos) ? b.procedimentos : []).map(function (p) { return txt(p, 200) }).filter(Boolean)
    procs = procs.filter(function (p, i) { return procs.indexOf(p) === i })
    if (!procs.length) return { erro: 'Selecione ao menos um procedimento para o plano.' }
    if (procs.length > 200) return { erro: 'Use no máximo 200 procedimentos por plano.' }
    var valor = r2(num(b.valor))
    if (!(valor > 0)) return { erro: 'Informe o valor da cobrança.' }

    var duracao = null
    if (!vazio(b.duracao_meses)) {
        duracao = inteiro(b.duracao_meses)
        if (!duracao || duracao < 1 || duracao > MAX_DURACAO) return { erro: 'A duração deve ficar entre 1 e ' + MAX_DURACAO + ' meses.' }
    }
    var modo = 'mensal', per, intervalo, liberacao, aCada
    if (tipo === 'proprio') {
        modo = b.modo_cobranca === 'total' ? 'total' : 'mensal'
        if (modo === 'total' && !duracao) return { erro: 'Valor total não admite duração indeterminada — defina um período.' }
        per = modo === 'total' ? 'total' : 'mensal'
        intervalo = modo === 'total' ? duracao : 1
        liberacao = LIBERACOES_PROPRIO.indexOf(b.liberacao) >= 0 ? b.liberacao : 'contratacao'
        aCada = liberacao === 'parcelas' ? inteiro(b.liberar_a_cada) : 1
        var maxP = duracao ? totalDeParcelas(duracao, intervalo) : MAX_PARCELAS_SEM_PRAZO
        if (!aCada || aCada < 1) return { erro: 'Informe o número de parcelas pagas.' }
        if (aCada > maxP) return { erro: 'Máximo de ' + maxP + ' parcelas para a vigência definida.' }
    } else {
        per = String(b.periodicidade || 'mensal')
        intervalo = per === 'outros' ? inteiro(b.intervalo_meses) : PERIODOS[per]
        if (!intervalo || intervalo < 1 || intervalo > 24) return { erro: per === 'outros' ? 'Informe o intervalo da cobrança, de 1 a 24 meses.' : 'Tipo de cobrança inválido.' }
        if (duracao && duracao < intervalo) return { erro: 'Mínimo de ' + intervalo + ' meses, conforme a periodicidade de cobrança selecionada.' }
        aCada = inteiro(vazio(b.liberar_a_cada) ? 1 : b.liberar_a_cada)
        if (!aCada || aCada < 1 || aCada > 60) return { erro: 'A liberação deve ser a cada 1 a 60 pagamentos.' }
        var maxR = duracao ? totalDeParcelas(duracao, intervalo) : 60
        if (aCada > maxR) return { erro: 'Máximo de ' + maxR + ' parcelas para a vigência e a periodicidade definidas.' }
        liberacao = aCada === 1 ? 'cada' : 'parcelas'
    }
    var taxa = !!b.taxa_adesao, valorTaxa = null
    if (taxa) {
        valorTaxa = vazio(b.valor_taxa) ? valor : r2(num(b.valor_taxa))
        if (!(valorTaxa > 0)) return { erro: 'Informe o valor da taxa de adesão.' }
    }
    if ((liberacao === 'taxa' || liberacao === 'taxa_parcela') && !taxa) return { erro: 'Para liberar após a taxa de adesão, marque "Gerar taxa de adesão".' }
    var faixas = []
    if (tipo === 'proprio' && Array.isArray(b.faixas)) {
        for (var i = 0; i < b.faixas.length && i < 20; i++) {
            var f = b.faixas[i] || {}
            if (vazio(f.a_partir_de) && vazio(f.valor)) continue
            var ap = inteiro(f.a_partir_de), fv = r2(num(f.valor))
            if (!ap || ap < 2 || ap > 999) return { erro: 'Faixa ' + (i + 1) + ': "A partir de (pessoas)" deve ser de 2 a 999.' }
            if (!(fv > 0)) return { erro: 'Faixa ' + (i + 1) + ': informe o valor por pessoa.' }
            if (faixas.some(function (x) { return x.a_partir_de === ap })) return { erro: 'Há duas faixas a partir de ' + ap + ' pessoas.' }
            faixas.push({ a_partir_de: ap, valor: fv })
        }
        faixas.sort(function (a, b2) { return a.a_partir_de - b2.a_partir_de })
    }
    return { tipo: tipo, nome: nome, observacoes: txt(b.observacoes, 1000) || null, tabela_preco: tabela, periodicidade: per, intervalo_meses: intervalo, valor: valor, duracao_meses: duracao,
        liberar_a_cada: aCada, liberacao: liberacao, alerta_retorno: b.alerta_retorno ? 1 : 0, modo_cobranca: modo, taxa_adesao: taxa ? 1 : 0, valor_taxa: valorTaxa, juros_atraso: b.juros_atraso ? 1 : 0,
        faixas: faixas, procedimentos: procs }
}

function valorParcela(ad) { return r2(Number(ad.valor) * Math.max(Number(ad.pessoas) || 1, 1)) }

async function garantirParcelas(client, clinica_id, ad) {
    if (ad.status !== 'ativo') return 0
    var ult = (await client.execute({ sql: "SELECT COALESCE(MAX(numero),0) n FROM plano_parcelas WHERE paciente_plano_id=? AND clinica_id=?", args: [ad.id, clinica_id] })).rows[0].n
    var novas = parcelasDevidas(ad, ult, hojeCG())
    if (!novas.length) return 0
    var marcas = novas.map(function () { return '(?,?,?,?,?,?)' }).join(',')
    var args = []
    novas.forEach(function (p) { args.push(clinica_id, ad.id, ad.paciente_id, p.numero, p.vencimento, valorParcela(ad)) })
    // A restrição única evita parcela repetida se duas telas abrirem ao mesmo tempo.
    await client.execute({ sql: "INSERT OR IGNORE INTO plano_parcelas(clinica_id,paciente_plano_id,paciente_id,numero,vencimento,valor) VALUES " + marcas, args: args })
    return novas.length
}

// Valor das parcelas em aberto ainda não vencidas (depois de reajuste ou mudança de pessoas).
async function reprecificar(client, clinica_id, ad) {
    await client.execute({ sql: "UPDATE plano_parcelas SET valor=? WHERE paciente_plano_id=? AND clinica_id=? AND status='pendente' AND numero>0 AND vencimento>=?", args: [valorParcela(ad), ad.id, clinica_id, hojeCG()] })
}

var SELECT_ADESAO = "SELECT pp.*, pl.nome plano_nome, pl.tabela_preco, pl.tipo plano_tipo, pl.modo_cobranca, pl.alerta_retorno, pl.juros_atraso, pac.nome paciente_nome, " +
    "(SELECT COUNT(*) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pago' AND x.numero>0) pagos, " +
    "(SELECT COUNT(*) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pago' AND x.numero=0) taxa_paga, " +
    "(SELECT COUNT(*) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pago' AND x.numero=1) p1_paga, " +
    "(SELECT COUNT(*) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pendente' AND x.vencimento<?) atrasadas, " +
    "(SELECT MIN(x.vencimento) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pendente') proximo, " +
    "(SELECT MAX(x.data_pagamento) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pago') ultimo_pagamento, " +
    "(SELECT COUNT(*) FROM plano_usos u WHERE u.paciente_plano_id=pp.id AND u.clinica_id=pp.clinica_id) usos " +
    "FROM paciente_planos pp JOIN planos_recorrentes pl ON pl.id=pp.plano_id AND pl.clinica_id=pp.clinica_id " +
    "LEFT JOIN pacientes pac ON pac.id=pp.paciente_id AND pac.clinica_id=pp.clinica_id "

function resumirAdesao(a) {
    var total = totalDeParcelas(a.duracao_meses, a.intervalo_meses), pagos = Number(a.pagos) || 0
    var lib
    if (a.plano_tipo === 'proprio') {
        var ok = liberadoProprio(a)
        lib = { proprio: true, liberado: ok, ganhas: ok ? 1 : 0, usadas: Number(a.usos) || 0, disponiveis: ok ? 1 : 0 }
    } else lib = liberacoes(pagos, a.liberar_a_cada, a.usos)
    var situacao = a.status === 'cancelado' ? 'cancelado' : (total && pagos >= total ? 'concluido' : (Number(a.atrasadas) ? 'atrasado' : 'em_dia'))
    return Object.assign({}, a, { total_parcelas: total, liberacoes: lib, situacao: situacao, valor_parcela: valorParcela(a) })
}

// Depois da baixa: mantém a fila de parcelas e avisa a recepção quando libera um procedimento.
async function aposBaixa(client, clinica_id, parc, data, auth) {
    var ad = (await client.execute({ sql: SELECT_ADESAO + "WHERE pp.id=? AND pp.clinica_id=?", args: [hojeCG(), parc.paciente_plano_id, clinica_id] })).rows[0]
    if (!ad) return
    await garantirParcelas(client, clinica_id, ad)
    if (!Number(ad.alerta_retorno)) return
    var motivo
    if (ad.plano_tipo === 'proprio') {
        if (!liberadoProprio(ad)) return
        motivo = 'Plano ' + ad.plano_nome + ': procedimentos liberados'
    } else {
        var pagos = Number(ad.pagos), aCada = Math.max(Number(ad.liberar_a_cada) || 1, 1)
        if (!pagos || Number(parc.numero) === 0 || pagos % aCada !== 0) return
        motivo = 'Plano ' + ad.plano_nome + ': procedimento liberado (' + (pagos / aCada) + 'ª liberação)'
    }
    motivo = motivo.slice(0, 200)
    // Estornar e receber de novo não pode criar um segundo aviso igual.
    var ja = await client.execute({ sql: "SELECT id FROM alertas_retorno WHERE clinica_id=? AND paciente_id=? AND motivo=?", args: [clinica_id, ad.paciente_id, motivo] })
    if (ja.rows.length) return
    await client.execute({ sql: "INSERT INTO alertas_retorno(clinica_id,paciente_id,data_retorno,motivo,criado_por_nome) VALUES(?,?,?,?,?)", args: [clinica_id, ad.paciente_id, data, motivo, (auth && auth.nome) || null] })
}

// Juros do Plano Próprio/Recorrente marcado "Cobrar juros por atraso": aplicados a partir do
// mês seguinte ao vencimento, com a multa e os juros de Configurações › Taxas e encargos.
async function encargosPlano(client, clinica_id, id, data) {
    var p = (await client.execute({ sql: "SELECT x.*, pl.juros_atraso FROM plano_parcelas x JOIN paciente_planos a ON a.id=x.paciente_plano_id AND a.clinica_id=x.clinica_id JOIN planos_recorrentes pl ON pl.id=a.plano_id AND pl.clinica_id=x.clinica_id WHERE x.id=? AND x.clinica_id=?", args: [id, clinica_id] })).rows[0]
    if (!p) return null
    var valor = r2(p.valor), venc = String(p.vencimento).slice(0, 10)
    var base = { valor: valor, dias_atraso: 0, multa: 0, juros: 0, acrescimo: 0, desconto: 0, total: valor, juros_atraso: !!Number(p.juros_atraso) }
    if (!Number(p.juros_atraso) || data < addMeses(venc, 1)) return base
    var e = await require('./operacao').encargos(client, clinica_id, { data_vencimento: venc, valor: valor }, data)
    return Object.assign(e, { desconto: 0, total: r2(valor + e.acrescimo), juros_atraso: true })
}

async function procedimentosDe(client, clinica_id, planoId) {
    return (await client.execute({ sql: "SELECT procedimento_nome FROM plano_procedimentos WHERE plano_id=? AND clinica_id=? ORDER BY procedimento_nome", args: [planoId, clinica_id] })).rows.map(function (r) { return r.procedimento_nome })
}

async function gravarProcedimentos(client, clinica_id, planoId, procs) {
    await client.execute({ sql: "DELETE FROM plano_procedimentos WHERE plano_id=? AND clinica_id=?", args: [planoId, clinica_id] })
    for (var i = 0; i < procs.length; i++) await client.execute({ sql: "INSERT INTO plano_procedimentos(clinica_id,plano_id,procedimento_nome) VALUES(?,?,?)", args: [clinica_id, planoId, procs[i]] })
}

async function gravarFaixas(client, clinica_id, planoId, faixas) {
    await client.execute({ sql: "DELETE FROM plano_faixas WHERE plano_id=? AND clinica_id=?", args: [planoId, clinica_id] })
    for (var i = 0; i < faixas.length; i++) await client.execute({ sql: "INSERT INTO plano_faixas(clinica_id,plano_id,a_partir_de,valor) VALUES(?,?,?,?)", args: [clinica_id, planoId, faixas[i].a_partir_de, faixas[i].valor] })
}

async function faixasDe(client, clinica_id, planoId) {
    return (await client.execute({ sql: "SELECT a_partir_de, valor FROM plano_faixas WHERE plano_id=? AND clinica_id=? ORDER BY a_partir_de", args: [planoId, clinica_id] })).rows.map(function (f) { return { a_partir_de: Number(f.a_partir_de), valor: r2(f.valor) } })
}

// Dependentes informados na adesão: paciente já cadastrado ({paciente_id}) ou novo
// ({nome, telefone, cpf, nascimento}). Devolve { erro } ou { ids }.
async function resolverDependentes(client, clinica_id, lista, jaNoPlano) {
    var ids = [], novos = []
    for (var i = 0; i < lista.length && i < 50; i++) {
        var d = lista[i] || {}
        if (!vazio(d.paciente_id)) {
            var pid = inteiro(d.paciente_id)
            var ex = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [pid || 0, clinica_id] })).rows[0]
            if (!ex) return { erro: 'Dependente ' + (i + 1) + ': paciente não encontrado.' }
            if (ids.indexOf(pid) >= 0 || jaNoPlano.indexOf(pid) >= 0) return { erro: 'Este dependente já está incluído neste plano.' }
            ids.push(pid)
            continue
        }
        var nome = txt(d.nome, 120)
        if (!nome) return { erro: 'Dependente ' + (i + 1) + ': informe o nome.' }
        var tel = String(d.telefone || '').replace(/\D/g, '')
        if (tel.length !== 11) return { erro: 'Informe o telefone completo do dependente, com DDD e 9 dígitos.' }
        var cpf = String(d.cpf || '').replace(/\D/g, '')
        if (cpf && cpf.length !== 11) return { erro: 'Dependente ' + nome + ': CPF incompleto.' }
        var nasc = DATA_RE.test(d.nascimento || '') ? d.nascimento : null
        novos.push({ nome: nome.toUpperCase(), tel: tel, cpf: cpf ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : null, nasc: nasc })
    }
    for (var k = 0; k < novos.length; k++) {
        var n = novos[k]
        var ins = await client.execute({ sql: "INSERT INTO pacientes(clinica_id,nome,telefone,whatsapp,cpf,data_nascimento,ativo,criado_em) VALUES(?,?,?,?,?,?,1,datetime('now'))", args: [clinica_id, n.nome, n.tel, n.tel, n.cpf, n.nasc] })
        ids.push(Number(ins.lastInsertRowid))
    }
    return { ids: ids }
}

async function dependentesDe(client, clinica_id, adesaoId) {
    return (await client.execute({ sql: "SELECT d.id, d.paciente_id, d.incluido_em, p.nome, p.telefone, p.cpf, p.data_nascimento FROM plano_dependentes d LEFT JOIN pacientes p ON p.id=d.paciente_id AND p.clinica_id=d.clinica_id WHERE d.paciente_plano_id=? AND d.clinica_id=? ORDER BY p.nome", args: [adesaoId, clinica_id] })).rows
}

async function contarPessoas(client, clinica_id, ad) {
    var n = Number((await client.execute({ sql: "SELECT COUNT(*) n FROM plano_dependentes WHERE paciente_plano_id=? AND clinica_id=?", args: [ad.id, clinica_id] })).rows[0].n)
    return n + (Number(ad.incluir_titular) === 0 ? 0 : 1)
}

async function handle(route, ctx) {
    var client = ctx.client, clinica_id = ctx.clinica_id, q = ctx.q || {}, req = ctx.req, res = ctx.res, auth = ctx.auth
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }

    // ── Planos ───────────────────────────────────────────────────
    if (route === 'planos-recorrentes') {
        if (req.method === 'GET' && q.tabela_procs) {
            // Lista completa da tabela de preço para escolher os procedimentos do plano.
            var tp = await client.execute({ sql: "SELECT DISTINCT procedimento FROM tabela_precos WHERE clinica_id=? AND UPPER(tabela)=UPPER(?) AND COALESCE(ativo,1)=1 ORDER BY procedimento LIMIT 2000", args: [clinica_id, String(q.tabela_procs).slice(0, 80)] })
            return json(200, { success: true, procedimentos: tp.rows.map(function (r) { return r.procedimento }) })
        }
        if (req.method === 'GET') {
            var hjL = hojeCG()
            var pls = (await client.execute({ sql: "SELECT pl.*, (SELECT COUNT(*) FROM paciente_planos pp WHERE pp.plano_id=pl.id AND pp.clinica_id=pl.clinica_id AND pp.status='ativo') adesoes_ativas, (SELECT COUNT(*) FROM paciente_planos pp WHERE pp.plano_id=pl.id AND pp.clinica_id=pl.clinica_id) adesoes_total, " +
                "(SELECT COUNT(DISTINCT x.paciente_plano_id) FROM plano_parcelas x JOIN paciente_planos pp ON pp.id=x.paciente_plano_id AND pp.clinica_id=x.clinica_id WHERE pp.plano_id=pl.id AND x.clinica_id=pl.clinica_id AND pp.status='ativo' AND x.status='pendente' AND x.vencimento<?) inadimplentes " +
                "FROM planos_recorrentes pl WHERE pl.clinica_id=? ORDER BY pl.ativo DESC, pl.nome", args: [hjL, clinica_id] })).rows
            var procs = (await client.execute({ sql: "SELECT plano_id, procedimento_nome FROM plano_procedimentos WHERE clinica_id=? ORDER BY procedimento_nome", args: [clinica_id] })).rows
            var fxs = (await client.execute({ sql: "SELECT plano_id, a_partir_de, valor FROM plano_faixas WHERE clinica_id=? ORDER BY a_partir_de", args: [clinica_id] }).catch(function () { return { rows: [] } })).rows
            var tabelas = (await client.execute({ sql: "SELECT DISTINCT tabela FROM tabela_precos WHERE clinica_id=? AND tabela IS NOT NULL ORDER BY tabela", args: [clinica_id] }).catch(function () { return { rows: [] } })).rows.map(function (t) { return t.tabela })
            return json(200, { success: true, tabelas: tabelas.length ? tabelas : ['PARTICULAR'], data: pls.map(function (p) {
                return Object.assign({}, p, { tipo: p.tipo || 'recorrente',
                    procedimentos: procs.filter(function (x) { return Number(x.plano_id) === Number(p.id) }).map(function (x) { return x.procedimento_nome }),
                    faixas: fxs.filter(function (x) { return Number(x.plano_id) === Number(p.id) }).map(function (x) { return { a_partir_de: Number(x.a_partir_de), valor: r2(x.valor) } }) })
            }) })
        }
        if (req.method !== 'POST') return json(405, { success: false, error: 'Método não permitido' })
        var pid = b.id ? inteiro(b.id) : null
        var atual = null
        if (pid) {
            atual = (await client.execute({ sql: "SELECT * FROM planos_recorrentes WHERE id=? AND clinica_id=?", args: [pid, clinica_id] })).rows[0]
            if (!atual) return json(404, { success: false, error: 'Plano não encontrado' })
        }
        if (b.action === 'ativo') {
            if (!atual) return json(400, { success: false, error: 'Plano não informado' })
            if (!b.ativo) {
                // Adesão com prazo já cumprido (tudo pago) não segura o plano.
                var nAt = (await client.execute({ sql: SELECT_ADESAO + "WHERE pp.plano_id=? AND pp.clinica_id=? AND pp.status='ativo'", args: [hojeCG(), pid, clinica_id] })).rows.map(resumirAdesao).filter(function (x) { return x.situacao !== 'concluido' }).length
                if (nAt) return json(400, { success: false, error: 'Existem ' + nAt + ' paciente(s) ativo(s) neste plano. Desvincule-os antes de inativar.', titulo: 'Plano com pacientes ativos' })
            }
            await client.execute({ sql: "UPDATE planos_recorrentes SET ativo=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [b.ativo ? 1 : 0, pid, clinica_id] })
            return json(200, { success: true })
        }
        if (b.action === 'excluir') {
            if (!atual) return json(400, { success: false, error: 'Plano não informado' })
            var nAd = Number((await client.execute({ sql: "SELECT COUNT(*) n FROM paciente_planos WHERE plano_id=? AND clinica_id=?", args: [pid, clinica_id] })).rows[0].n)
            if (nAd) return json(400, { success: false, error: 'Este plano tem ' + nAd + ' paciente(s) vinculado(s). Para excluí-lo, primeiro exclua ou desvincule os planos dos pacientes associados a ele.', titulo: 'Plano com pacientes vinculados' })
            await moverParaLixeira(client, auth, 'plano_recorrente', pid)
            return json(200, { success: true })
        }
        var v = validarPlano(Object.assign({}, b, atual ? { tipo: atual.tipo || 'recorrente' } : {}))
        if (v.erro) return json(400, { success: false, error: v.erro })
        // Compara aqui: o LOWER do SQLite não entende acentos ("PREVENÇÃO" e "Prevenção" passariam).
        var nomes = (await client.execute({ sql: "SELECT nome FROM planos_recorrentes WHERE clinica_id=? AND id<>?", args: [clinica_id, pid || 0] })).rows
        if (nomes.some(function (n) { return String(n.nome).toLowerCase() === v.nome.toLowerCase() })) return json(400, { success: false, error: 'Já existe um plano com este nome.' })
        var ph = v.procedimentos.map(function () { return '?' }).join(',')
        var achados = (await client.execute({ sql: "SELECT DISTINCT procedimento FROM tabela_precos WHERE clinica_id=? AND UPPER(tabela)=UPPER(?) AND procedimento IN (" + ph + ")", args: [clinica_id, v.tabela_preco].concat(v.procedimentos) })).rows.map(function (r) { return r.procedimento })
        var antigos = atual ? await procedimentosDe(client, clinica_id, pid) : []
        var fora = v.procedimentos.filter(function (p) { return achados.indexOf(p) < 0 && antigos.indexOf(p) < 0 })
        if (fora.length) return json(400, { success: false, error: 'Procedimento fora da lista de preços ' + v.tabela_preco + ': ' + fora[0] })
        var cols = ['nome', 'observacoes', 'tabela_preco', 'periodicidade', 'intervalo_meses', 'valor', 'duracao_meses', 'liberar_a_cada', 'alerta_retorno', 'tipo', 'modo_cobranca', 'taxa_adesao', 'valor_taxa', 'juros_atraso', 'liberacao']
        var vals = cols.map(function (c) { return v[c] })
        if (atual) {
            await client.execute({ sql: "UPDATE planos_recorrentes SET " + cols.map(function (c) { return c + '=?' }).join(',') + ",atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: vals.concat([pid, clinica_id]) })
        } else {
            var ins = await client.execute({ sql: "INSERT INTO planos_recorrentes(clinica_id," + cols.join(',') + ",criado_por_nome) VALUES(?," + cols.map(function () { return '?' }).join(',') + ",?)", args: [clinica_id].concat(vals, [auth.nome || null]) })
            pid = Number(ins.lastInsertRowid)
        }
        await gravarProcedimentos(client, clinica_id, pid, v.procedimentos)
        await gravarFaixas(client, clinica_id, pid, v.faixas)
        var reajustados = 0
        // Plano Próprio: alterações valem só para os novos pacientes (como no Clinicorp).
        if (atual && v.tipo === 'recorrente' && b.aplicar_adesoes && v.valor !== r2(atual.valor)) {
            var ads = (await client.execute({ sql: "SELECT * FROM paciente_planos WHERE plano_id=? AND clinica_id=? AND status='ativo'", args: [pid, clinica_id] })).rows
            for (var ai = 0; ai < ads.length; ai++) {
                await client.execute({ sql: "UPDATE paciente_planos SET valor=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [v.valor, ads[ai].id, clinica_id] })
                await reprecificar(client, clinica_id, Object.assign({}, ads[ai], { valor: v.valor }))
            }
            reajustados = ads.length
        }
        return json(200, { success: true, id: pid, reajustados: reajustados })
    }

    // ── Adesões ──────────────────────────────────────────────────
    if (route === 'planos-adesoes') {
        var hoje = hojeCG()
        if (req.method === 'GET') {
            var w = ['pp.clinica_id=?'], a = [hoje, clinica_id]
            if (q.plano_id) { w.push('pp.plano_id=?'); a.push(inteiro(q.plano_id) || 0) }
            if (q.paciente_id) {
                // O paciente aparece nos planos em que é titular e nos que é dependente.
                w.push('(pp.paciente_id=? OR pp.id IN (SELECT paciente_plano_id FROM plano_dependentes WHERE clinica_id=pp.clinica_id AND paciente_id=?))')
                a.push(inteiro(q.paciente_id) || 0, inteiro(q.paciente_id) || 0)
            }
            if (q.busca) { w.push('pac.nome LIKE ?'); a.push('%' + txt(q.busca, 60) + '%') }
            var rows = (await client.execute({ sql: SELECT_ADESAO + "WHERE " + w.join(' AND ') + " ORDER BY CASE pp.status WHEN 'ativo' THEN 0 ELSE 1 END, pac.nome LIMIT 500", args: a })).rows.map(resumirAdesao)
            if (q.situacao && q.situacao !== 'todos') rows = rows.filter(function (r) { return r.situacao === q.situacao })
            if (q.paciente_id) rows.forEach(function (r) { r.sou_dependente = Number(r.paciente_id) !== Number(q.paciente_id) })
            return json(200, { success: true, data: rows })
        }
        if (req.method !== 'POST') return json(405, { success: false, error: 'Método não permitido' })

        if (b.action === 'aderir') {
            var pl = (await client.execute({ sql: "SELECT * FROM planos_recorrentes WHERE id=? AND clinica_id=? AND ativo=1", args: [inteiro(b.plano_id) || 0, clinica_id] })).rows[0]
            if (!pl) return json(404, { success: false, error: 'Plano não encontrado ou desativado.' })
            var proprio = pl.tipo === 'proprio'
            var pac = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [inteiro(b.paciente_id) || 0, clinica_id] })).rows[0]
            if (!pac) return json(404, { success: false, error: 'Selecione o paciente titular do plano.' })
            if (!DATA_RE.test(b.data_inicio || '')) return json(400, { success: false, error: 'Informe a data do primeiro vencimento.' })
            var forma = b.forma_pagamento || 'aberto'
            if (forma !== 'aberto') return json(400, { success: false, error: 'Cobrança automática (boleto, cartão de crédito ou link de pagamento) ainda não está disponível. Use Lançamento em aberto.' })
            var incluir = proprio ? b.incluir_titular !== false : true
            var rep = await client.execute({ sql: "SELECT id FROM paciente_planos WHERE clinica_id=? AND paciente_id=? AND plano_id=? AND status='ativo'", args: [clinica_id, pac.id, pl.id] })
            if (rep.rows.length) return json(400, { success: false, error: 'Este paciente já está incluído neste plano.' })
            // Quem já é dependente em outra adesão ativa do mesmo plano não entra de novo.
            var depsAtivos = (await client.execute({ sql: "SELECT d.paciente_id FROM plano_dependentes d JOIN paciente_planos pp ON pp.id=d.paciente_plano_id AND pp.clinica_id=d.clinica_id WHERE d.clinica_id=? AND pp.plano_id=? AND pp.status='ativo'", args: [clinica_id, pl.id] })).rows.map(function (r) { return Number(r.paciente_id) })
            if (incluir && depsAtivos.indexOf(Number(pac.id)) >= 0) return json(400, { success: false, error: 'Este paciente já está incluído neste plano.' })
            var deps = { ids: [] }
            if (proprio && Array.isArray(b.dependentes) && b.dependentes.length) {
                deps = await resolverDependentes(client, clinica_id, b.dependentes, [Number(pac.id)].concat(depsAtivos))
                if (deps.erro) return json(400, { success: false, error: deps.erro })
            }
            var pessoas = (incluir ? 1 : 0) + deps.ids.length
            if (!pessoas) return json(400, { success: false, error: 'Inclua o titular ou ao menos um dependente.' })
            var faixasPl = proprio ? await faixasDe(client, clinica_id, pl.id) : []
            var val = vazio(b.valor) ? valorPorPessoa(pl, faixasPl, pessoas) : r2(num(b.valor))
            if (!(val > 0)) return json(400, { success: false, error: proprio ? 'Informe o valor por pessoa.' : 'Informe o valor da mensalidade.' })
            // Taxa de adesão: do plano, a menos que a adesão diga outra coisa; cobrada por pessoa.
            var comTaxa = b.taxa_adesao === undefined ? !!Number(pl.taxa_adesao) : !!b.taxa_adesao
            var vTaxa = null
            if (comTaxa) {
                vTaxa = vazio(b.valor_taxa) ? (pl.valor_taxa != null ? r2(pl.valor_taxa) : val) : r2(num(b.valor_taxa))
                if (!(vTaxa > 0)) return json(400, { success: false, error: 'Informe o valor da taxa de adesão.' })
            }
            var libAd = pl.liberacao || (proprio ? 'contratacao' : 'cada')
            if ((libAd === 'taxa' || libAd === 'taxa_parcela') && !comTaxa) libAd = 'contratacao'
            var vend = vazio(b.vendedor_id) ? null : inteiro(b.vendedor_id), profFav = vazio(b.profissional_id) ? null : inteiro(b.profissional_id)
            var insA = await client.execute({ sql: "INSERT INTO paciente_planos(clinica_id,paciente_id,plano_id,valor,intervalo_meses,duracao_meses,liberar_a_cada,data_inicio,observacoes,criado_por_nome,pessoas,incluir_titular,valor_taxa,forma_pagamento,vendedor_id,profissional_id,liberacao) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                args: [clinica_id, pac.id, pl.id, val, pl.intervalo_meses, pl.duracao_meses, pl.liberar_a_cada, b.data_inicio, txt(b.observacoes, 500) || null, auth.nome || null, pessoas, incluir ? 1 : 0, vTaxa, forma, vend || null, profFav || null, libAd] })
            var adId = Number(insA.lastInsertRowid)
            for (var di = 0; di < deps.ids.length; di++) await client.execute({ sql: "INSERT INTO plano_dependentes(clinica_id,paciente_plano_id,paciente_id,incluido_em) VALUES(?,?,?,?)", args: [clinica_id, adId, deps.ids[di], hoje] })
            if (vTaxa) await client.execute({ sql: "INSERT OR IGNORE INTO plano_parcelas(clinica_id,paciente_plano_id,paciente_id,numero,vencimento,valor) VALUES(?,?,?,0,?,?)", args: [clinica_id, adId, pac.id, b.data_inicio, r2(vTaxa * pessoas)] })
            await garantirParcelas(client, clinica_id, { id: adId, paciente_id: pac.id, valor: val, pessoas: pessoas, intervalo_meses: pl.intervalo_meses, duracao_meses: pl.duracao_meses, data_inicio: b.data_inicio, status: 'ativo' })
            // Liberado já na contratação: avisa a recepção, como na baixa.
            if (proprio && libAd === 'contratacao') await aposBaixa(client, clinica_id, { paciente_plano_id: adId, numero: -1 }, hoje, auth)
            return json(200, { success: true, id: adId, pessoas: pessoas, valor: val })
        }

        var ad = (await client.execute({ sql: "SELECT * FROM paciente_planos WHERE id=? AND clinica_id=?", args: [inteiro(b.id) || 0, clinica_id] })).rows[0]
        if (!ad) return json(404, { success: false, error: 'Adesão não encontrada.' })

        if (b.action === 'cancelar') {
            if (ad.status === 'cancelado') return json(400, { success: false, error: 'Este plano já está cancelado.' })
            await client.execute({ sql: "UPDATE paciente_planos SET status='cancelado', cancelado_em=?, motivo_cancelamento=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [hoje, txt(b.motivo, 300) || null, ad.id, clinica_id] })
            // O que já venceu continua devido; só as parcelas futuras deixam de existir.
            await client.execute({ sql: "UPDATE plano_parcelas SET status='cancelado' WHERE paciente_plano_id=? AND clinica_id=? AND status='pendente' AND vencimento>=?", args: [ad.id, clinica_id, hoje] })
            return json(200, { success: true })
        }
        if (b.action === 'reativar') {
            if (ad.status !== 'cancelado') return json(400, { success: false, error: 'Este plano não está cancelado.' })
            var outro = await client.execute({ sql: "SELECT id FROM paciente_planos WHERE clinica_id=? AND paciente_id=? AND plano_id=? AND status='ativo' AND id<>?", args: [clinica_id, ad.paciente_id, ad.plano_id, ad.id] })
            if (outro.rows.length) return json(400, { success: false, error: 'Este paciente já está incluído neste plano.' })
            await client.execute({ sql: "UPDATE paciente_planos SET status='ativo', cancelado_em=NULL, motivo_cancelamento=NULL, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [ad.id, clinica_id] })
            await client.execute({ sql: "UPDATE plano_parcelas SET status='pendente', valor=? WHERE paciente_plano_id=? AND clinica_id=? AND status='cancelado' AND numero>0 AND vencimento>=?", args: [valorParcela(ad), ad.id, clinica_id, hoje] })
            await garantirParcelas(client, clinica_id, Object.assign({}, ad, { status: 'ativo' }))
            return json(200, { success: true })
        }
        if (b.action === 'valor') {
            if (ad.status !== 'ativo') return json(400, { success: false, error: 'Só é possível reajustar um plano ativo.' })
            var nv = r2(num(b.valor))
            if (!(nv > 0)) return json(400, { success: false, error: 'Informe um valor maior que zero' })
            await client.execute({ sql: "UPDATE paciente_planos SET valor=?, observacoes=COALESCE(?,observacoes), atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [nv, b.observacoes === undefined ? null : txt(b.observacoes, 500), ad.id, clinica_id] })
            await reprecificar(client, clinica_id, Object.assign({}, ad, { valor: nv }))
            return json(200, { success: true })
        }
        if (b.action === 'excluir') {
            var pagas = Number((await client.execute({ sql: "SELECT COUNT(*) n FROM plano_parcelas WHERE paciente_plano_id=? AND clinica_id=? AND status='pago'", args: [ad.id, clinica_id] })).rows[0].n)
            if (pagas) return json(400, { success: false, error: 'Este plano já tem pagamentos recebidos. Inative o plano do paciente em vez de excluir, ou estorne os pagamentos antes.' })
            await client.execute({ sql: "DELETE FROM plano_parcelas WHERE paciente_plano_id=? AND clinica_id=?", args: [ad.id, clinica_id] })
            await client.execute({ sql: "DELETE FROM plano_dependentes WHERE paciente_plano_id=? AND clinica_id=?", args: [ad.id, clinica_id] })
            await client.execute({ sql: "DELETE FROM plano_usos WHERE paciente_plano_id=? AND clinica_id=?", args: [ad.id, clinica_id] })
            await client.execute({ sql: "DELETE FROM paciente_planos WHERE id=? AND clinica_id=?", args: [ad.id, clinica_id] })
            return json(200, { success: true })
        }
        if (b.action === 'dependentes-add' || b.action === 'dependentes-remover') {
            var plD = (await client.execute({ sql: "SELECT tipo FROM planos_recorrentes WHERE id=? AND clinica_id=?", args: [ad.plano_id, clinica_id] })).rows[0]
            if (!plD || plD.tipo !== 'proprio') return json(400, { success: false, error: 'Só o Plano Próprio tem dependentes.' })
            if (ad.status !== 'ativo') return json(400, { success: false, error: 'Este plano está inativo.' })
            if (b.action === 'dependentes-add') {
                var noPlano = (await client.execute({ sql: "SELECT d.paciente_id FROM plano_dependentes d JOIN paciente_planos pp ON pp.id=d.paciente_plano_id AND pp.clinica_id=d.clinica_id WHERE d.clinica_id=? AND pp.plano_id=? AND pp.status='ativo' UNION SELECT paciente_id FROM paciente_planos WHERE clinica_id=? AND plano_id=? AND status='ativo' AND (id<>? OR incluir_titular=1)", args: [clinica_id, ad.plano_id, clinica_id, ad.plano_id, ad.id] })).rows.map(function (r) { return Number(r.paciente_id) })
                var nd = await resolverDependentes(client, clinica_id, Array.isArray(b.dependentes) ? b.dependentes : [], noPlano)
                if (nd.erro) return json(400, { success: false, error: nd.erro })
                if (!nd.ids.length) return json(400, { success: false, error: 'Informe o dependente.' })
                for (var j = 0; j < nd.ids.length; j++) await client.execute({ sql: "INSERT INTO plano_dependentes(clinica_id,paciente_plano_id,paciente_id,incluido_em) VALUES(?,?,?,?)", args: [clinica_id, ad.id, nd.ids[j], hoje] })
            } else {
                var rem = (Array.isArray(b.ids) ? b.ids : []).map(inteiro).filter(Boolean)
                if (!rem.length) return json(400, { success: false, error: 'Selecione os dependentes.' })
                var restam = await contarPessoas(client, clinica_id, ad) - rem.length
                if (restam < 1) return json(400, { success: false, error: 'Inclua o titular ou ao menos um dependente.' })
                await client.execute({ sql: "DELETE FROM plano_dependentes WHERE paciente_plano_id=? AND clinica_id=? AND id IN (" + rem.map(function () { return '?' }).join(',') + ")", args: [ad.id, clinica_id].concat(rem) })
            }
            var np = await contarPessoas(client, clinica_id, ad)
            await client.execute({ sql: "UPDATE paciente_planos SET pessoas=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [np, ad.id, clinica_id] })
            await reprecificar(client, clinica_id, Object.assign({}, ad, { pessoas: np }))
            return json(200, { success: true, pessoas: np })
        }
        return json(400, { success: false, error: 'Ação inválida' })
    }

    if (route === 'plano-adesao') {
        var hj2 = hojeCG()
        var det = (await client.execute({ sql: SELECT_ADESAO + "WHERE pp.id=? AND pp.clinica_id=?", args: [hj2, inteiro(q.id) || 0, clinica_id] })).rows[0]
        if (!det) return json(404, { success: false, error: 'Adesão não encontrada.' })
        await garantirParcelas(client, clinica_id, det)
        var parcelas = (await client.execute({ sql: "SELECT * FROM plano_parcelas WHERE paciente_plano_id=? AND clinica_id=? ORDER BY numero", args: [det.id, clinica_id] })).rows
        var usos = (await client.execute({ sql: "SELECT * FROM plano_usos WHERE paciente_plano_id=? AND clinica_id=? ORDER BY data DESC, id DESC", args: [det.id, clinica_id] })).rows
        return json(200, { success: true, adesao: resumirAdesao(det), parcelas: parcelas, usos: usos, procedimentos: await procedimentosDe(client, clinica_id, det.plano_id), dependentes: await dependentesDe(client, clinica_id, det.id), hoje: hj2 })
    }

    // ── Encargos sugeridos para receber uma parcela do plano ─────
    if (route === 'plano-encargos') {
        var enc = await encargosPlano(client, clinica_id, inteiro(q.id) || 0, DATA_RE.test(q.data || '') ? q.data : hojeCG())
        return enc ? json(200, Object.assign({ success: true }, enc)) : json(404, { success: false, error: 'Parcela não encontrada.' })
    }

    // ── Parcela: estornar a baixa ou dispensar ───────────────────
    if (route === 'plano-parcela') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'Método não permitido' })
        var pa = (await client.execute({ sql: "SELECT * FROM plano_parcelas WHERE id=? AND clinica_id=?", args: [inteiro(b.id) || 0, clinica_id] })).rows[0]
        if (!pa) return json(404, { success: false, error: 'Mensalidade não encontrada.' })
        if (b.action === 'estornar') {
            if (pa.status !== 'pago') return json(400, { success: false, error: 'Esta mensalidade não está paga.' })
            var rc = await client.execute({ sql: "SELECT id FROM recebiveis WHERE clinica_id=? AND origem='plano' AND origem_id=? LIMIT 1", args: [clinica_id, pa.id] })
            if (rc.rows.length) return json(400, { success: false, error: 'Este pagamento gerou um cheque ou cartão no controle de recebíveis. Resolva por lá antes de estornar.' })
            var est = await client.execute({ sql: "UPDATE plano_parcelas SET status='pendente', data_pagamento=NULL, forma_pagamento=NULL, conta_id=NULL, valor_pago=NULL, acrescimo=0, desconto_baixa=0, baixado_por_nome=NULL WHERE id=? AND clinica_id=? AND status='pago'", args: [pa.id, clinica_id] })
            return est.rowsAffected ? json(200, { success: true }) : json(400, { success: false, error: 'Esta mensalidade não está paga.' })
        }
        if (b.action === 'cancelar') {
            var ca = await client.execute({ sql: "UPDATE plano_parcelas SET status='cancelado' WHERE id=? AND clinica_id=? AND status='pendente'", args: [pa.id, clinica_id] })
            return ca.rowsAffected ? json(200, { success: true }) : json(400, { success: false, error: 'Só é possível dispensar mensalidade em aberto.' })
        }
        return json(400, { success: false, error: 'Ação inválida' })
    }

    // ── Uso dos procedimentos liberados ──────────────────────────
    if (route === 'plano-uso') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'Método não permitido' })
        if (b.action === 'excluir') {
            var du = await client.execute({ sql: "DELETE FROM plano_usos WHERE id=? AND clinica_id=?", args: [inteiro(b.id) || 0, clinica_id] })
            return du.rowsAffected ? json(200, { success: true }) : json(404, { success: false, error: 'Registro não encontrado.' })
        }
        var hj3 = hojeCG()
        var au = (await client.execute({ sql: SELECT_ADESAO + "WHERE pp.id=? AND pp.clinica_id=?", args: [hj3, inteiro(b.adesao_id) || 0, clinica_id] })).rows[0]
        if (!au) return json(404, { success: false, error: 'Adesão não encontrada.' })
        if (au.status !== 'ativo') return json(400, { success: false, error: 'Este plano está cancelado.' })
        if (!resumirAdesao(au).liberacoes.disponiveis) return json(400, { success: false, error: 'Nenhum procedimento liberado no momento.' })
        var nomeProc = txt(b.procedimento_nome, 200)
        if ((await procedimentosDe(client, clinica_id, au.plano_id)).indexOf(nomeProc) < 0) return json(400, { success: false, error: 'Este procedimento não faz parte do plano.' })
        // No Plano Próprio, o uso pode ser do titular ou de um dependente.
        var quem = au.paciente_id
        if (!vazio(b.paciente_id) && Number(b.paciente_id) !== Number(au.paciente_id)) {
            var dp = (await client.execute({ sql: "SELECT paciente_id FROM plano_dependentes WHERE paciente_plano_id=? AND clinica_id=? AND paciente_id=?", args: [au.id, clinica_id, inteiro(b.paciente_id) || 0] })).rows[0]
            if (!dp) return json(400, { success: false, error: 'Esta pessoa não faz parte do plano.' })
            quem = dp.paciente_id
        }
        await client.execute({ sql: "INSERT INTO plano_usos(clinica_id,paciente_plano_id,paciente_id,procedimento_nome,data,observacoes,criado_por_nome) VALUES(?,?,?,?,?,?,?)", args: [clinica_id, au.id, quem, nomeProc, DATA_RE.test(b.data || '') ? b.data : hj3, txt(b.observacoes, 300) || null, auth.nome || null] })
        return json(200, { success: true })
    }

    return false
}

module.exports = { handle, aposBaixa, parcelasDevidas, vencimentoDe, totalDeParcelas, liberacoes, validarPlano, liberadoProprio, valorPorPessoa, encargosPlano }
