// lib/rotas/planos.js — Planos Recorrentes (etapa 1: cadastro e controle, sem cobrança automática)
// Klinov — Campo Grande, MS
//
// Plano: nome, procedimentos, periodicidade, valor, duração e a cada quantos
// pagamentos o procedimento é liberado. Adesão: o plano de um paciente, com valor
// e regras próprios para o reajuste do plano não mudar o combinado sem querer.
// Mensalidades: recebidas manualmente pela mesma baixa de Contas a Receber
// (fin-receber-baixa, origem 'plano'). Nada aqui fala com o Asaas.

var { moverParaLixeira } = require('../lixeira')

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var PERIODOS = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6 }
var MESES_A_FRENTE = 12, MAX_DURACAO = 60

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
function inteiro(v) { var n = Number(v); return Number.isInteger(n) ? n : NaN }
function addMeses(ymd, n) {
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7) - 1 + n, d = +ymd.slice(8, 10)
    var ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    return new Date(Date.UTC(y, m, Math.min(d, ult))).toISOString().slice(0, 10)
}

// Sempre a partir da data de início, para o dia 31 não virar 28 para sempre depois de fevereiro.
function vencimentoDe(inicio, intervalo, numero) { return addMeses(inicio, (numero - 1) * intervalo) }

function totalDeParcelas(duracao, intervalo) { return duracao ? Math.ceil(Number(duracao) / Number(intervalo)) : null }

// Próximas mensalidades a criar. Plano com prazo: todas. Sem prazo: até 12 meses à frente.
function parcelasDevidas(ad, ultimoNumero, hoje) {
    var total = totalDeParcelas(ad.duracao_meses, ad.intervalo_meses), limite = addMeses(hoje, MESES_A_FRENTE), out = []
    for (var n = Number(ultimoNumero) + 1; ; n++) {
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

// Valida e normaliza o plano. Devolve { erro } ou os campos prontos para gravar.
function validarPlano(b) {
    var nome = txt(b.nome, 120)
    if (!nome) return { erro: 'Informe o nome do plano.' }
    var valor = r2(b.valor)
    if (!(valor > 0)) return { erro: 'Informe o valor da cobrança.' }
    var per = String(b.periodicidade || 'mensal')
    var intervalo = per === 'outros' ? inteiro(b.intervalo_meses) : PERIODOS[per]
    if (!intervalo || intervalo < 1 || intervalo > 24) return { erro: per === 'outros' ? 'Informe o intervalo da cobrança, de 1 a 24 meses.' : 'Tipo de cobrança inválido.' }
    var duracao = null
    if (b.duracao_meses !== null && b.duracao_meses !== undefined && b.duracao_meses !== '') {
        duracao = inteiro(b.duracao_meses)
        if (!duracao || duracao < 1 || duracao > MAX_DURACAO) return { erro: 'A duração deve ficar entre 1 e ' + MAX_DURACAO + ' meses.' }
        if (duracao < intervalo) return { erro: 'A duração não pode ser menor que o intervalo da cobrança.' }
    }
    var aCada = inteiro(b.liberar_a_cada === undefined || b.liberar_a_cada === '' ? 1 : b.liberar_a_cada)
    if (!aCada || aCada < 1 || aCada > 60) return { erro: 'A liberação deve ser a cada 1 a 60 pagamentos.' }
    var procs = (Array.isArray(b.procedimentos) ? b.procedimentos : []).map(function (p) { return txt(p, 200) }).filter(Boolean)
    procs = procs.filter(function (p, i) { return procs.indexOf(p) === i })
    if (!procs.length) return { erro: 'Escolha ao menos um procedimento.' }
    if (procs.length > 50) return { erro: 'Use no máximo 50 procedimentos por plano.' }
    return { nome: nome, observacoes: txt(b.observacoes, 1000) || null, tabela_preco: txt(b.tabela_preco, 80) || 'PARTICULAR', periodicidade: per, intervalo_meses: intervalo, valor: valor, duracao_meses: duracao, liberar_a_cada: aCada, alerta_retorno: b.alerta_retorno ? 1 : 0, procedimentos: procs }
}

async function garantirParcelas(client, clinica_id, ad) {
    if (ad.status !== 'ativo') return 0
    var ult = (await client.execute({ sql: "SELECT COALESCE(MAX(numero),0) n FROM plano_parcelas WHERE paciente_plano_id=? AND clinica_id=?", args: [ad.id, clinica_id] })).rows[0].n
    var novas = parcelasDevidas(ad, ult, hojeCG())
    if (!novas.length) return 0
    var marcas = novas.map(function () { return '(?,?,?,?,?,?)' }).join(',')
    var args = []
    novas.forEach(function (p) { args.push(clinica_id, ad.id, ad.paciente_id, p.numero, p.vencimento, r2(ad.valor)) })
    // A restrição única evita mensalidade repetida se duas telas abrirem ao mesmo tempo.
    await client.execute({ sql: "INSERT OR IGNORE INTO plano_parcelas(clinica_id,paciente_plano_id,paciente_id,numero,vencimento,valor) VALUES " + marcas, args: args })
    return novas.length
}

// Depois da baixa: mantém a fila de mensalidades e avisa a recepção quando libera um procedimento.
async function aposBaixa(client, clinica_id, parc, data, auth) {
    var ad = (await client.execute({ sql: "SELECT pp.*, pl.nome plano_nome, pl.alerta_retorno FROM paciente_planos pp JOIN planos_recorrentes pl ON pl.id=pp.plano_id AND pl.clinica_id=pp.clinica_id WHERE pp.id=? AND pp.clinica_id=?", args: [parc.paciente_plano_id, clinica_id] })).rows[0]
    if (!ad) return
    await garantirParcelas(client, clinica_id, ad)
    if (!Number(ad.alerta_retorno)) return
    var pagos = Number((await client.execute({ sql: "SELECT COUNT(*) n FROM plano_parcelas WHERE paciente_plano_id=? AND clinica_id=? AND status='pago'", args: [ad.id, clinica_id] })).rows[0].n)
    var aCada = Math.max(Number(ad.liberar_a_cada) || 1, 1)
    if (pagos % aCada !== 0) return
    var motivo = ('Plano ' + ad.plano_nome + ': procedimento liberado (' + (pagos / aCada) + 'ª liberação)').slice(0, 200)
    // Estornar e receber de novo não pode criar um segundo aviso igual.
    var ja = await client.execute({ sql: "SELECT id FROM alertas_retorno WHERE clinica_id=? AND paciente_id=? AND motivo=?", args: [clinica_id, ad.paciente_id, motivo] })
    if (ja.rows.length) return
    await client.execute({ sql: "INSERT INTO alertas_retorno(clinica_id,paciente_id,data_retorno,motivo,criado_por_nome) VALUES(?,?,?,?,?)", args: [clinica_id, ad.paciente_id, data, motivo, (auth && auth.nome) || null] })
}

async function procedimentosDe(client, clinica_id, planoId) {
    return (await client.execute({ sql: "SELECT procedimento_nome FROM plano_procedimentos WHERE plano_id=? AND clinica_id=? ORDER BY procedimento_nome", args: [planoId, clinica_id] })).rows.map(function (r) { return r.procedimento_nome })
}

async function gravarProcedimentos(client, clinica_id, planoId, procs) {
    await client.execute({ sql: "DELETE FROM plano_procedimentos WHERE plano_id=? AND clinica_id=?", args: [planoId, clinica_id] })
    for (var i = 0; i < procs.length; i++) await client.execute({ sql: "INSERT INTO plano_procedimentos(clinica_id,plano_id,procedimento_nome) VALUES(?,?,?)", args: [clinica_id, planoId, procs[i]] })
}

var SELECT_ADESAO = "SELECT pp.*, pl.nome plano_nome, pl.tabela_preco, pac.nome paciente_nome, " +
    "(SELECT COUNT(*) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pago') pagos, " +
    "(SELECT COUNT(*) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pendente' AND x.vencimento<?) atrasadas, " +
    "(SELECT MIN(x.vencimento) FROM plano_parcelas x WHERE x.paciente_plano_id=pp.id AND x.clinica_id=pp.clinica_id AND x.status='pendente') proximo, " +
    "(SELECT COUNT(*) FROM plano_usos u WHERE u.paciente_plano_id=pp.id AND u.clinica_id=pp.clinica_id) usos " +
    "FROM paciente_planos pp JOIN planos_recorrentes pl ON pl.id=pp.plano_id AND pl.clinica_id=pp.clinica_id " +
    "LEFT JOIN pacientes pac ON pac.id=pp.paciente_id AND pac.clinica_id=pp.clinica_id "

function resumirAdesao(a) {
    var total = totalDeParcelas(a.duracao_meses, a.intervalo_meses), pagos = Number(a.pagos) || 0
    var lib = liberacoes(pagos, a.liberar_a_cada, a.usos)
    return Object.assign({}, a, { total_parcelas: total, liberacoes: lib, situacao: a.status === 'cancelado' ? 'cancelado' : (total && pagos >= total ? 'concluido' : (Number(a.atrasadas) ? 'atrasado' : 'em_dia')) })
}

async function handle(route, ctx) {
    var client = ctx.client, clinica_id = ctx.clinica_id, q = ctx.q || {}, req = ctx.req, res = ctx.res, auth = ctx.auth
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }

    // ── Planos ───────────────────────────────────────────────────
    if (route === 'planos-recorrentes') {
        if (req.method === 'GET') {
            var pls = (await client.execute({ sql: "SELECT pl.*, (SELECT COUNT(*) FROM paciente_planos pp WHERE pp.plano_id=pl.id AND pp.clinica_id=pl.clinica_id AND pp.status='ativo') adesoes_ativas, (SELECT COUNT(*) FROM paciente_planos pp WHERE pp.plano_id=pl.id AND pp.clinica_id=pl.clinica_id) adesoes_total FROM planos_recorrentes pl WHERE pl.clinica_id=? ORDER BY pl.ativo DESC, pl.nome", args: [clinica_id] })).rows
            var procs = (await client.execute({ sql: "SELECT plano_id, procedimento_nome FROM plano_procedimentos WHERE clinica_id=? ORDER BY procedimento_nome", args: [clinica_id] })).rows
            var tabelas = (await client.execute({ sql: "SELECT DISTINCT tabela FROM tabela_precos WHERE clinica_id=? AND tabela IS NOT NULL ORDER BY tabela", args: [clinica_id] }).catch(function () { return { rows: [] } })).rows.map(function (t) { return t.tabela })
            return json(200, { success: true, tabelas: tabelas.length ? tabelas : ['PARTICULAR'], data: pls.map(function (p) {
                return Object.assign({}, p, { procedimentos: procs.filter(function (x) { return Number(x.plano_id) === Number(p.id) }).map(function (x) { return x.procedimento_nome }) })
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
            await client.execute({ sql: "UPDATE planos_recorrentes SET ativo=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [b.ativo ? 1 : 0, pid, clinica_id] })
            return json(200, { success: true })
        }
        if (b.action === 'excluir') {
            if (!atual) return json(400, { success: false, error: 'Plano não informado' })
            var nAd = Number((await client.execute({ sql: "SELECT COUNT(*) n FROM paciente_planos WHERE plano_id=? AND clinica_id=?", args: [pid, clinica_id] })).rows[0].n)
            if (nAd) return json(400, { success: false, error: 'Este plano já teve pacientes e não pode ser excluído. Desative-o para não aceitar novas adesões.' })
            await moverParaLixeira(client, auth, 'plano_recorrente', pid)
            return json(200, { success: true })
        }
        var v = validarPlano(b)
        if (v.erro) return json(400, { success: false, error: v.erro })
        // Compara aqui: o LOWER do SQLite não entende acentos ("PREVENÇÃO" e "Prevenção" passariam).
        var nomes = (await client.execute({ sql: "SELECT nome FROM planos_recorrentes WHERE clinica_id=? AND id<>?", args: [clinica_id, pid || 0] })).rows
        if (nomes.some(function (n) { return String(n.nome).toLowerCase() === v.nome.toLowerCase() })) return json(400, { success: false, error: 'Já existe um plano com este nome.' })
        var ph = v.procedimentos.map(function () { return '?' }).join(',')
        var achados = (await client.execute({ sql: "SELECT DISTINCT procedimento FROM tabela_precos WHERE clinica_id=? AND UPPER(tabela)=UPPER(?) AND procedimento IN (" + ph + ")", args: [clinica_id, v.tabela_preco].concat(v.procedimentos) })).rows.map(function (r) { return r.procedimento })
        var antigos = atual ? await procedimentosDe(client, clinica_id, pid) : []
        var fora = v.procedimentos.filter(function (p) { return achados.indexOf(p) < 0 && antigos.indexOf(p) < 0 })
        if (fora.length) return json(400, { success: false, error: 'Procedimento fora da lista de preços ' + v.tabela_preco + ': ' + fora[0] })
        if (atual) {
            await client.execute({ sql: "UPDATE planos_recorrentes SET nome=?,observacoes=?,tabela_preco=?,periodicidade=?,intervalo_meses=?,valor=?,duracao_meses=?,liberar_a_cada=?,alerta_retorno=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [v.nome, v.observacoes, v.tabela_preco, v.periodicidade, v.intervalo_meses, v.valor, v.duracao_meses, v.liberar_a_cada, v.alerta_retorno, pid, clinica_id] })
        } else {
            var ins = await client.execute({ sql: "INSERT INTO planos_recorrentes(clinica_id,nome,observacoes,tabela_preco,periodicidade,intervalo_meses,valor,duracao_meses,liberar_a_cada,alerta_retorno,criado_por_nome) VALUES(?,?,?,?,?,?,?,?,?,?,?)", args: [clinica_id, v.nome, v.observacoes, v.tabela_preco, v.periodicidade, v.intervalo_meses, v.valor, v.duracao_meses, v.liberar_a_cada, v.alerta_retorno, auth.nome || null] })
            pid = Number(ins.lastInsertRowid)
        }
        await gravarProcedimentos(client, clinica_id, pid, v.procedimentos)
        var reajustados = 0
        if (atual && b.aplicar_adesoes && v.valor !== r2(atual.valor)) {
            var hj = hojeCG()
            var ra = await client.execute({ sql: "UPDATE paciente_planos SET valor=?, atualizado_em=datetime('now') WHERE plano_id=? AND clinica_id=? AND status='ativo'", args: [v.valor, pid, clinica_id] })
            reajustados = ra.rowsAffected
            await client.execute({ sql: "UPDATE plano_parcelas SET valor=? WHERE clinica_id=? AND status='pendente' AND vencimento>=? AND paciente_plano_id IN (SELECT id FROM paciente_planos WHERE plano_id=? AND clinica_id=? AND status='ativo')", args: [v.valor, clinica_id, hj, pid, clinica_id] })
        }
        return json(200, { success: true, id: pid, reajustados: reajustados })
    }

    // ── Adesões ──────────────────────────────────────────────────
    if (route === 'planos-adesoes') {
        var hoje = hojeCG()
        if (req.method === 'GET') {
            var w = ['pp.clinica_id=?'], a = [hoje, clinica_id]
            if (q.plano_id) { w.push('pp.plano_id=?'); a.push(inteiro(q.plano_id) || 0) }
            if (q.paciente_id) { w.push('pp.paciente_id=?'); a.push(inteiro(q.paciente_id) || 0) }
            var rows = (await client.execute({ sql: SELECT_ADESAO + "WHERE " + w.join(' AND ') + " ORDER BY CASE pp.status WHEN 'ativo' THEN 0 ELSE 1 END, pac.nome LIMIT 500", args: a })).rows.map(resumirAdesao)
            if (q.situacao && q.situacao !== 'todos') rows = rows.filter(function (r) { return r.situacao === q.situacao })
            return json(200, { success: true, data: rows })
        }
        if (req.method !== 'POST') return json(405, { success: false, error: 'Método não permitido' })

        if (b.action === 'aderir') {
            var pl = (await client.execute({ sql: "SELECT * FROM planos_recorrentes WHERE id=? AND clinica_id=? AND ativo=1", args: [inteiro(b.plano_id) || 0, clinica_id] })).rows[0]
            if (!pl) return json(404, { success: false, error: 'Plano não encontrado ou desativado.' })
            var pac = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [inteiro(b.paciente_id) || 0, clinica_id] })).rows[0]
            if (!pac) return json(404, { success: false, error: 'Paciente não encontrado.' })
            if (!DATA_RE.test(b.data_inicio || '')) return json(400, { success: false, error: 'Informe a data do primeiro vencimento.' })
            var val = b.valor === undefined || b.valor === '' ? r2(pl.valor) : r2(b.valor)
            if (!(val > 0)) return json(400, { success: false, error: 'Informe o valor da mensalidade.' })
            var rep = await client.execute({ sql: "SELECT id FROM paciente_planos WHERE clinica_id=? AND paciente_id=? AND plano_id=? AND status='ativo'", args: [clinica_id, pac.id, pl.id] })
            if (rep.rows.length) return json(400, { success: false, error: 'Este paciente já está neste plano.' })
            var insA = await client.execute({ sql: "INSERT INTO paciente_planos(clinica_id,paciente_id,plano_id,valor,intervalo_meses,duracao_meses,liberar_a_cada,data_inicio,observacoes,criado_por_nome) VALUES(?,?,?,?,?,?,?,?,?,?)", args: [clinica_id, pac.id, pl.id, val, pl.intervalo_meses, pl.duracao_meses, pl.liberar_a_cada, b.data_inicio, txt(b.observacoes, 500) || null, auth.nome || null] })
            var adId = Number(insA.lastInsertRowid)
            await garantirParcelas(client, clinica_id, { id: adId, paciente_id: pac.id, valor: val, intervalo_meses: pl.intervalo_meses, duracao_meses: pl.duracao_meses, data_inicio: b.data_inicio, status: 'ativo' })
            return json(200, { success: true, id: adId })
        }

        var ad = (await client.execute({ sql: "SELECT * FROM paciente_planos WHERE id=? AND clinica_id=?", args: [inteiro(b.id) || 0, clinica_id] })).rows[0]
        if (!ad) return json(404, { success: false, error: 'Adesão não encontrada.' })

        if (b.action === 'cancelar') {
            if (ad.status === 'cancelado') return json(400, { success: false, error: 'Este plano já está cancelado.' })
            await client.execute({ sql: "UPDATE paciente_planos SET status='cancelado', cancelado_em=?, motivo_cancelamento=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [hoje, txt(b.motivo, 300) || null, ad.id, clinica_id] })
            // O que já venceu continua devido; só as mensalidades futuras deixam de existir.
            await client.execute({ sql: "UPDATE plano_parcelas SET status='cancelado' WHERE paciente_plano_id=? AND clinica_id=? AND status='pendente' AND vencimento>=?", args: [ad.id, clinica_id, hoje] })
            return json(200, { success: true })
        }
        if (b.action === 'reativar') {
            if (ad.status !== 'cancelado') return json(400, { success: false, error: 'Este plano não está cancelado.' })
            var outro = await client.execute({ sql: "SELECT id FROM paciente_planos WHERE clinica_id=? AND paciente_id=? AND plano_id=? AND status='ativo' AND id<>?", args: [clinica_id, ad.paciente_id, ad.plano_id, ad.id] })
            if (outro.rows.length) return json(400, { success: false, error: 'Este paciente já tem outra adesão ativa neste plano.' })
            await client.execute({ sql: "UPDATE paciente_planos SET status='ativo', cancelado_em=NULL, motivo_cancelamento=NULL, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [ad.id, clinica_id] })
            await client.execute({ sql: "UPDATE plano_parcelas SET status='pendente', valor=? WHERE paciente_plano_id=? AND clinica_id=? AND status='cancelado' AND vencimento>=?", args: [r2(ad.valor), ad.id, clinica_id, hoje] })
            await garantirParcelas(client, clinica_id, Object.assign({}, ad, { status: 'ativo' }))
            return json(200, { success: true })
        }
        if (b.action === 'valor') {
            if (ad.status !== 'ativo') return json(400, { success: false, error: 'Só é possível reajustar um plano ativo.' })
            var nv = r2(b.valor)
            if (!(nv > 0)) return json(400, { success: false, error: 'Informe o novo valor.' })
            await client.execute({ sql: "UPDATE paciente_planos SET valor=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [nv, ad.id, clinica_id] })
            await client.execute({ sql: "UPDATE plano_parcelas SET valor=? WHERE paciente_plano_id=? AND clinica_id=? AND status='pendente' AND vencimento>=?", args: [nv, ad.id, clinica_id, hoje] })
            return json(200, { success: true })
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
        return json(200, { success: true, adesao: resumirAdesao(det), parcelas: parcelas, usos: usos, procedimentos: await procedimentosDe(client, clinica_id, det.plano_id), hoje: hj2 })
    }

    // ── Mensalidade: estornar a baixa ou dispensar ───────────────
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
        if (!liberacoes(au.pagos, au.liberar_a_cada, au.usos).disponiveis) return json(400, { success: false, error: 'Nenhum procedimento liberado no momento.' })
        var nomeProc = txt(b.procedimento_nome, 200)
        if ((await procedimentosDe(client, clinica_id, au.plano_id)).indexOf(nomeProc) < 0) return json(400, { success: false, error: 'Este procedimento não faz parte do plano.' })
        await client.execute({ sql: "INSERT INTO plano_usos(clinica_id,paciente_plano_id,paciente_id,procedimento_nome,data,observacoes,criado_por_nome) VALUES(?,?,?,?,?,?,?)", args: [clinica_id, au.id, au.paciente_id, nomeProc, DATA_RE.test(b.data || '') ? b.data : hj3, txt(b.observacoes, 300) || null, auth.nome || null] })
        return json(200, { success: true })
    }

    return false
}

module.exports = { handle, aposBaixa, parcelasDevidas, vencimentoDe, totalDeParcelas, liberacoes, validarPlano }
