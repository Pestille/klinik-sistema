// lib/followup/clinicorp.js — Traz do Clinicorp o que a régua de follow-up precisa
// Klinov — Campo Grande, MS
//
// Enquanto a clínica opera no Clinicorp, os orçamentos de verdade estão lá.
// Antes de cada execução da régua, este módulo:
//   1. busca os orçamentos (estimates/list, no máximo 31 dias por chamada) da
//      janela da régua e grava/atualiza em `orcamentos` (com itens), ligados ao
//      paciente pelo id do Clinicorp (criado em `pacientes` se ainda não existir);
//   2. reflete o status: OPEN → aberto · APPROVED → aprovado · REJECTED → reprovado.
//      Orçamento aberto que sumiu do Clinicorp (excluído) → cancelado;
//   3. busca as consultas dos próximos 60 dias (appointment/list) para a régua
//      não mandar mensagem de venda a quem já tem consulta marcada.
// A régua (motor.js) continua lendo só o Turso, então o resto não muda.
//
// Campos reais do estimates/list: id, Status, Amount, DiscountAmount, CreateDate,
// ApprovedDate, RejectedDate, LastChange_Date, PatientId, PatientName,
// PatientMobilePhone, ProfessionalName, DentistName, TreatmentId, ProcedureList[]
// (nome do procedimento em OperationDescription).

var https = require('https')

function configurado() {
    return !!(process.env.CLINICORP_USUARIO && process.env.CLINICORP_TOKEN && process.env.CLINICORP_SUB)
}

// GET na API do Clinicorp. Devolve { ok, itens } ou { ok:false, erro }.
function get(endpoint, params, timeoutMs) {
    return new Promise(function (resolve) {
        var q = Object.assign({ subscriber_id: process.env.CLINICORP_SUB || '', businessId: process.env.CLINICORP_BID || '' }, params)
        var qs = Object.keys(q).filter(function (k) { return q[k] !== '' && q[k] != null }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]) }).join('&')
        var req = https.request({
            hostname: 'api.clinicorp.com', path: '/rest/v1/' + endpoint + '?' + qs, method: 'GET',
            headers: { 'Authorization': 'Basic ' + Buffer.from((process.env.CLINICORP_USUARIO || '') + ':' + (process.env.CLINICORP_TOKEN || '')).toString('base64'), 'accept': 'application/json' }
        }, function (res) {
            var body = ''
            res.on('data', function (c) { body += c })
            res.on('end', function () {
                if (res.statusCode >= 400) return resolve({ ok: false, erro: 'HTTP ' + res.statusCode })
                try {
                    var d = JSON.parse(body)
                    resolve({ ok: true, itens: Array.isArray(d) ? d : (d.data || d.items || d.results || d.list || []) })
                } catch (e) { resolve({ ok: false, erro: 'resposta inválida' }) }
            })
        })
        req.on('error', function (e) { resolve({ ok: false, erro: e.message }) })
        req.setTimeout(timeoutMs || 15000, function () { req.destroy(); resolve({ ok: false, erro: 'timeout' }) })
        req.end()
    })
}

function ymd(d) { return d.toISOString().slice(0, 10) }
function addDias(ymdStr, n) { var d = new Date(ymdStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }
// Janelas de até 31 dias cobrindo [de, ate]
function janelas(de, ate) {
    var out = [], ini = de
    while (ini <= ate) {
        var fim = addDias(ini, 30)
        if (fim > ate) fim = ate
        out.push({ from: ini, to: fim })
        ini = addDias(fim, 1)
    }
    return out
}

var STATUS = { OPEN: 'aberto', FOLLOWUP: 'aberto', APPROVED: 'aprovado', REJECTED: 'reprovado', REJECTED_OPPORTUNITY: 'reprovado' }
function txt(v, max) { return v == null ? '' : String(v).slice(0, max || 200) }
function data10(v) { var s = txt(v, 40); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '' }
function numero(v) { var n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0 }
function itensDe(o) {
    return (Array.isArray(o.ProcedureList) ? o.ProcedureList : []).map(function (p) {
        p = p || {}
        return {
            nome: txt(p.OperationDescription || p.ProcedureDescription || p.Description || p.Name || 'Procedimento', 200),
            dente: txt(p.Tooth || p.ToothNumber || p.Teeth || p.ToothDescription || '', 60),
            valor: numero(p.Amount != null ? p.Amount : (p.Value != null ? p.Value : p.Price))
        }
    })
}

async function lotes(client, stmts) {
    for (var i = 0; i < stmts.length; i += 80) await client.batch(stmts.slice(i, i + 80), 'write')
}

// ── Orçamentos ───────────────────────────────────────────────────
async function sincronizarOrcamentos(client, clinica_id, janelaDias, hoje, obter) {
    obter = obter || get
    var de = addDias(hoje, -Math.max(7, janelaDias)), ate = hoje
    var js = janelas(de, ate)
    var rs = await Promise.all(js.map(function (w) { return obter('estimates/list', w) }))
    var falhas = rs.filter(function (r) { return !r.ok }).map(function (r, i) { return js[i].from + ': ' + r.erro })
    var lista = [], vistos = {}
    rs.forEach(function (r) { if (r.ok) r.itens.forEach(function (o) { var k = String(o.id || ''); if (k && !vistos[k]) { vistos[k] = 1; lista.push(o) } }) })
    var res = { recebidos: lista.length, novos: 0, atualizados: 0, cancelados: 0, pacientes_novos: 0, duplicados_removidos: 0, falhas: falhas }
    if (!lista.length && falhas.length) return res

    // Pacientes: mapa clinicorp_id → id (cria quem ainda não existe)
    var pacIds = {}
    lista.forEach(function (o) { if (o.PatientId) pacIds[String(o.PatientId)] = o })
    var cids = Object.keys(pacIds), mapaPac = {}
    for (var i = 0; i < cids.length; i += 200) {
        var parte = cids.slice(i, i + 200)
        var r = await client.execute({ sql: "SELECT id, clinicorp_id, telefone, nome FROM pacientes WHERE clinica_id=? AND clinicorp_id IN (" + parte.map(function () { return '?' }).join(',') + ")", args: [clinica_id].concat(parte) })
        r.rows.forEach(function (p) { mapaPac[String(p.clinicorp_id)] = p })
    }
    var stmts = []
    cids.forEach(function (cid) {
        var o = pacIds[cid], fone = txt(o.PatientMobilePhone, 30), nome = txt(o.PatientName, 200) || 'Paciente'
        var p = mapaPac[cid]
        if (!p) { stmts.push({ sql: "INSERT INTO pacientes(clinica_id,clinicorp_id,nome,telefone,ativo) VALUES(?,?,?,?,1)", args: [clinica_id, cid, nome, fone] }); res.pacientes_novos++ }
        else if ((fone && fone !== p.telefone) || (nome && nome !== p.nome)) stmts.push({ sql: "UPDATE pacientes SET telefone=COALESCE(NULLIF(?,''),telefone), nome=? WHERE id=? AND clinica_id=?", args: [fone, nome, p.id, clinica_id] })
    })
    await lotes(client, stmts)
    if (res.pacientes_novos) {
        for (var j = 0; j < cids.length; j += 200) {
            var parte2 = cids.slice(j, j + 200)
            var r2 = await client.execute({ sql: "SELECT id, clinicorp_id FROM pacientes WHERE clinica_id=? AND clinicorp_id IN (" + parte2.map(function () { return '?' }).join(',') + ")", args: [clinica_id].concat(parte2) })
            r2.rows.forEach(function (p) { mapaPac[String(p.clinicorp_id)] = p })
        }
    }

    // Duplicatas de versões anteriores (mesmo id do Clinicorp gravado 2x): fica a mais antiga
    var dup = await client.execute({ sql: "SELECT o.id FROM orcamentos o WHERE o.clinica_id=? AND o.clinicorp_id IS NOT NULL AND EXISTS (SELECT 1 FROM orcamentos o2 WHERE o2.clinica_id=o.clinica_id AND o2.clinicorp_id=o.clinicorp_id AND o2.id<o.id) AND NOT EXISTS (SELECT 1 FROM orcamento_followups f WHERE f.clinica_id=o.clinica_id AND f.orcamento_id=o.id)", args: [clinica_id] })
    if (dup.rows.length) {
        await lotes(client, dup.rows.reduce(function (acc, d) {
            return acc.concat([{ sql: "DELETE FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?", args: [d.id, clinica_id] }, { sql: "DELETE FROM orcamentos WHERE id=? AND clinica_id=?", args: [d.id, clinica_id] }])
        }, []))
        res.duplicados_removidos = dup.rows.length
    }

    // Orçamentos já gravados (para só escrever o que mudou), pelo id do Clinicorp
    var existentes = {}, todosIds = lista.map(function (o) { return String(o.id) })
    for (var e = 0; e < todosIds.length; e += 200) {
        var parteE = todosIds.slice(e, e + 200)
        var ex = await client.execute({ sql: "SELECT id, clinicorp_id, clinicorp_alterado, status FROM orcamentos WHERE clinica_id=? AND clinicorp_id IN (" + parteE.map(function () { return '?' }).join(',') + ") ORDER BY id DESC", args: [clinica_id].concat(parteE) })
        ex.rows.forEach(function (o) { existentes[String(o.clinicorp_id)] = o })
    }
    var novosIds = [], stmts2 = []
    lista.forEach(function (o) {
        var cid = String(o.id), atual = existentes[cid]
        var status = STATUS[String(o.Status || '').toUpperCase()] || 'aberto'
        var alterado = 'v2|' + txt(o.LastChange_Date || o.ApprovedDate || o.RejectedDate || o.CreateDate, 40) + '|' + status
        var pac = mapaPac[String(o.PatientId || '')]
        // Date = data do orçamento (é por ela que o estimates/list filtra as janelas)
        var criado = data10(o.Date) || data10(o.CreateDate) || hoje
        var titulo = txt(o.TreatmentName || o.Description || '', 120) || null
        var valor = numero(o.Amount)
        if (!atual) {
            stmts2.push({
                sql: "INSERT INTO orcamentos(clinica_id,clinicorp_id,clinicorp_alterado,paciente_id,profissional_nome,data_criacao,status,data_aprovacao,valor_total,desconto,titulo,tabela_preco) VALUES(?,?,?,?,?,?,?,?,?,0,?,'CLINICORP')",
                args: [clinica_id, cid, alterado, pac ? pac.id : null, txt(o.ProfessionalName || o.DentistName, 120), criado, status, data10(o.ApprovedDate) || null, valor, titulo]
            })
            novosIds.push(cid); res.novos++
        } else if (atual.clinicorp_alterado !== alterado) {
            stmts2.push({
                sql: "UPDATE orcamentos SET clinicorp_alterado=?,paciente_id=COALESCE(?,paciente_id),profissional_nome=?,status=?,data_aprovacao=COALESCE(?,data_aprovacao),valor_total=?,data_criacao=?,updated_at=datetime('now') WHERE id=? AND clinica_id=?",
                args: [alterado, pac ? pac.id : null, txt(o.ProfessionalName || o.DentistName, 120), status, data10(o.ApprovedDate) || null, valor, criado, atual.id, clinica_id]
            })
            if (status === 'aberto') novosIds.push(cid) // itens podem ter mudado
            res.atualizados++
        }
    })
    await lotes(client, stmts2)

    // Itens dos orçamentos novos/alterados (só os em aberto interessam à régua)
    if (novosIds.length) {
        var ids = {}
        for (var k = 0; k < novosIds.length; k += 200) {
            var parte3 = novosIds.slice(k, k + 200)
            var r3 = await client.execute({ sql: "SELECT id, clinicorp_id FROM orcamentos WHERE clinica_id=? AND clinicorp_id IN (" + parte3.map(function () { return '?' }).join(',') + ")", args: [clinica_id].concat(parte3) })
            r3.rows.forEach(function (x) { ids[String(x.clinicorp_id)] = x.id })
        }
        var stmts3 = []
        lista.forEach(function (o) {
            var oid = ids[String(o.id)]
            if (!oid || novosIds.indexOf(String(o.id)) < 0) return
            stmts3.push({ sql: "DELETE FROM orcamento_itens WHERE orcamento_id=? AND clinica_id=?", args: [oid, clinica_id] })
            itensDe(o).forEach(function (it) {
                stmts3.push({ sql: "INSERT INTO orcamento_itens(clinica_id,orcamento_id,procedimento_nome,dente,valor_unitario,quantidade) VALUES(?,?,?,?,?,1)", args: [clinica_id, oid, it.nome, it.dente, it.valor] })
            })
        })
        await lotes(client, stmts3)
    }

    // Aberto no Turso que não veio do Clinicorp (excluído lá) → cancelado.
    // Só quando todas as janelas responderam, para não cancelar por falha de rede.
    if (!falhas.length) {
        var sumidos = []
        var abertosJanela = await client.execute({ sql: "SELECT id, clinicorp_id FROM orcamentos WHERE clinica_id=? AND clinicorp_id IS NOT NULL AND COALESCE(status,'aberto')='aberto' AND substr(data_criacao,1,10) BETWEEN ? AND ?", args: [clinica_id, addDias(de, 7), ate] })
        abertosJanela.rows.forEach(function (o) { if (!vistos[String(o.clinicorp_id)]) sumidos.push(o.id) })
        await lotes(client, sumidos.map(function (id) { return { sql: "UPDATE orcamentos SET status='cancelado', updated_at=datetime('now') WHERE id=? AND clinica_id=?", args: [id, clinica_id] } }))
        res.cancelados = sumidos.length
    }
    return res
}

// ── Consultas futuras ────────────────────────────────────────────
async function sincronizarConsultas(client, clinica_id, hoje, obter) {
    obter = obter || get
    var js = janelas(hoje, addDias(hoje, 60))
    var rs = await Promise.all(js.map(function (w) { return obter('appointment/list', w) }))
    if (rs.some(function (r) { return !r.ok })) return { ok: false, erro: rs.filter(function (r) { return !r.ok }).map(function (r) { return r.erro }).join(', ') }
    var porPaciente = {}
    rs.forEach(function (r) {
        r.itens.forEach(function (a) {
            if (a.Deleted || a.deleted) return
            var st = String(a.StatusId || a.Status || '').toLowerCase()
            if (/desmarc|cancel|falt/.test(st)) return
            var pid = String(a.Patient_PersonId || a.PatientId || '')
            var d = data10(a.date || a.Date)
            if (!pid || !d || d < hoje) return
            if (!porPaciente[pid] || d < porPaciente[pid]) porPaciente[pid] = d
        })
    })
    var stmts = [{ sql: "DELETE FROM followup_consultas WHERE clinica_id=?", args: [clinica_id] }]
    Object.keys(porPaciente).forEach(function (pid) {
        stmts.push({ sql: "INSERT INTO followup_consultas(clinica_id,clinicorp_paciente_id,data) VALUES(?,?,?)", args: [clinica_id, pid, porPaciente[pid]] })
    })
    await lotes(client, stmts)
    return { ok: true, pacientes_com_consulta: stmts.length - 1 }
}

// Clínica que opera no Clinicorp (por enquanto, a Klinik)
function clinicaDoClinicorp() { return parseInt(process.env.KLINIK_CLINICA_ID || '1', 10) }

async function sincronizar(client, clinica_id, cfg, opts) {
    opts = opts || {}
    var hoje = opts.hoje || new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10)
    var o = await sincronizarOrcamentos(client, clinica_id, (cfg && cfg.janela_dias) || 90, hoje, opts.obter)
    var c = await sincronizarConsultas(client, clinica_id, hoje, opts.obter)
    return { orcamentos: o, consultas: c }
}

module.exports = { configurado, sincronizar, sincronizarOrcamentos, sincronizarConsultas, clinicaDoClinicorp, janelas, get }
