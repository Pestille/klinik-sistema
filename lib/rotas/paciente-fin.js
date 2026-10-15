// lib/rotas/paciente-fin.js — Crédito do paciente, lançamentos avulsos, anexos e pastas de fotos
// Klinov — Campo Grande, MS
//
//   paciente-credito   saldo e extrato; depositar (entra no caixa), usar para pagar parcela ou
//                      avulso (não entra de novo no caixa) e devolver (saída)
//   paciente-avulso    cobrança fora de orçamento (consulta, urgência…) gravada em `cobrancas`
//                      com referencia='avulso': aparece em Contas a receber e no caixa quando paga
//   anexos             arquivos ligados a um registro (hoje: contas a pagar e comprovantes)
//   fotos-pastas       pastas das fotos do paciente; foto-pasta move uma foto
//
// O dinheiro segue lido por movimentos() (lib/rotas/financeiro.js): parcelas e avulsos
// pagos com forma 'credito_paciente' ficam de fora para não contar duas vezes.

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'cheque']
var ENTIDADES_ANEXO = { conta_pagar: { tabela: 'contas_pagar', perm: 'financeiro.contas' } }
var MAX_ANEXO = 2000000 // ~1,5 MB em base64

function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }
function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) }
function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function num(v) { var n = typeof v === 'string' ? Number(v.replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? n : 0 }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100 }

async function saldoCredito(client, cid, pid) {
    var r = (await client.execute({ sql: "SELECT COALESCE(SUM(CASE WHEN tipo='deposito' THEN valor ELSE -valor END),0) s FROM paciente_creditos WHERE clinica_id=? AND paciente_id=?", args: [cid, pid] })).rows[0]
    return r2(r.s)
}
async function paciente(client, cid, id) {
    return (await client.execute({ sql: "SELECT id, nome FROM pacientes WHERE id=? AND clinica_id=?", args: [id, cid] })).rows[0] || null
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }

    // ── Crédito do paciente ──────────────────────────────────────
    if (route === 'paciente-credito') {
        var pac = await paciente(client, clinica_id, q.paciente_id || b.paciente_id)
        if (!pac) return json(404, { success: false, error: 'Paciente não encontrado' })
        if (req.method === 'GET') {
            var ex = await client.execute({ sql: "SELECT id, tipo, valor, descricao, forma, data, ref, criado_por_nome FROM paciente_creditos WHERE clinica_id=? AND paciente_id=? ORDER BY id DESC LIMIT 200", args: [clinica_id, pac.id] })
            return json(200, { success: true, saldo: await saldoCredito(client, clinica_id, pac.id), extrato: ex.rows })
        }
        var valor = r2(num(b.valor)), data = DATA_RE.test(b.data || '') ? b.data : hojeCG()
        if (b.action === 'depositar') {
            if (valor <= 0) return json(400, { success: false, error: 'Informe o valor' })
            var forma = FORMAS.indexOf(b.forma) !== -1 ? b.forma : 'dinheiro'
            var desc = txt(b.descricao, 140) || 'Crédito do paciente'
            // entra no caixa como cobrança paga (aparece na conta corrente e no fluxo)
            var cb = await client.execute({ sql: "INSERT INTO cobrancas(clinica_id,paciente_id,paciente_nome,tipo,valor,descricao,referencia,status,data_vencimento,data_pagamento) VALUES(?,?,?,?,?,?,'credito','pago',?,?)", args: [clinica_id, pac.id, pac.nome, forma, valor, desc, data, data + ' ' + agoraCG().slice(11)] })
            await client.execute({ sql: "INSERT INTO paciente_creditos(clinica_id,paciente_id,tipo,valor,descricao,forma,data,ref,criado_por_nome) VALUES(?,?,'deposito',?,?,?,?,?,?)", args: [clinica_id, pac.id, valor, desc, forma, data, 'cobranca:' + Number(cb.lastInsertRowid), auth.nome || null] })
            return json(200, { success: true, saldo: await saldoCredito(client, clinica_id, pac.id) })
        }
        if (b.action === 'usar') {
            var saldo = await saldoCredito(client, clinica_id, pac.id)
            var alvo = null
            if (b.parcela_id) {
                alvo = (await client.execute({ sql: "SELECT id, valor, status, numero_parcela, total_parcelas, orcamento_id FROM parcelas_orcamento WHERE id=? AND clinica_id=? AND paciente_id=?", args: [b.parcela_id, clinica_id, pac.id] })).rows[0]
                if (alvo) alvo.desc = 'Parcela ' + alvo.numero_parcela + '/' + alvo.total_parcelas + ' do orçamento #' + alvo.orcamento_id
            } else if (b.avulso_id) {
                alvo = (await client.execute({ sql: "SELECT id, valor, status, descricao FROM cobrancas WHERE id=? AND clinica_id=? AND paciente_id=? AND referencia='avulso'", args: [b.avulso_id, clinica_id, pac.id] })).rows[0]
                if (alvo) alvo.desc = alvo.descricao || 'Lançamento avulso'
            }
            if (!alvo) return json(404, { success: false, error: 'Parcela ou lançamento não encontrado' })
            if (/pago|recebido|confirmado/.test(alvo.status || '')) return json(400, { success: false, error: 'Já está pago' })
            if (Number(alvo.valor) > saldo + 0.009) return json(400, { success: false, error: 'Crédito insuficiente (saldo R$ ' + saldo.toFixed(2).replace('.', ',') + ')' })
            if (b.parcela_id) await client.execute({ sql: "UPDATE parcelas_orcamento SET status='pago', data_pagamento=?, forma_pagamento='credito_paciente' WHERE id=? AND clinica_id=?", args: [data, alvo.id, clinica_id] })
            else await client.execute({ sql: "UPDATE cobrancas SET status='pago', data_pagamento=?, tipo='credito_paciente' WHERE id=? AND clinica_id=?", args: [data, alvo.id, clinica_id] })
            await client.execute({ sql: "INSERT INTO paciente_creditos(clinica_id,paciente_id,tipo,valor,descricao,forma,data,ref,criado_por_nome) VALUES(?,?,'uso',?,?,NULL,?,?,?)", args: [clinica_id, pac.id, r2(alvo.valor), 'Pagamento: ' + alvo.desc, data, (b.parcela_id ? 'parcela:' : 'avulso:') + alvo.id, auth.nome || null] })
            return json(200, { success: true, saldo: await saldoCredito(client, clinica_id, pac.id) })
        }
        if (b.action === 'devolver') {
            var sd = await saldoCredito(client, clinica_id, pac.id)
            if (valor <= 0) return json(400, { success: false, error: 'Informe o valor' })
            if (valor > sd + 0.009) return json(400, { success: false, error: 'O valor é maior que o saldo de crédito' })
            var lc = await client.execute({ sql: "INSERT INTO lancamentos(clinica_id,tipo,descricao,valor,data,paciente_id,paciente_nome,forma_pagamento,categoria,classificacao,status) VALUES(?,'saida',?,?,?,?,?,?,'Devolução de crédito','Outros','realizado')", args: [clinica_id, 'Devolução de crédito · ' + pac.nome, valor, data, pac.id, pac.nome, FORMAS.indexOf(b.forma) !== -1 ? b.forma : 'dinheiro'] })
            await client.execute({ sql: "INSERT INTO paciente_creditos(clinica_id,paciente_id,tipo,valor,descricao,forma,data,ref,criado_por_nome) VALUES(?,?,'devolucao',?,?,?,?,?,?)", args: [clinica_id, pac.id, valor, txt(b.descricao, 140) || 'Devolução ao paciente', b.forma || 'dinheiro', data, 'lancamento:' + Number(lc.lastInsertRowid), auth.nome || null] })
            return json(200, { success: true, saldo: await saldoCredito(client, clinica_id, pac.id) })
        }
        return json(400, { success: false, error: 'Ação inválida' })
    }

    // ── Lançamentos avulsos (fora de orçamento) ──────────────────
    if (route === 'paciente-avulso') {
        var pa = await paciente(client, clinica_id, q.paciente_id || b.paciente_id)
        if (!pa) return json(404, { success: false, error: 'Paciente não encontrado' })
        if (req.method === 'GET') {
            var av = await client.execute({ sql: "SELECT id, descricao, valor, status, data_vencimento vencimento, data_pagamento pagamento, tipo forma FROM cobrancas WHERE clinica_id=? AND paciente_id=? AND referencia='avulso' AND status<>'cancelado' ORDER BY data_vencimento DESC, id DESC", args: [clinica_id, pa.id] })
            var hoje = hojeCG()
            return json(200, { success: true, data: av.rows.map(function (x) { var pago = /pago|recebido|confirmado/.test(x.status); return Object.assign({}, x, { valor: r2(x.valor), situacao: pago ? 'pago' : (String(x.vencimento) < hoje ? 'vencido' : 'a_vencer'), vencimento: String(x.vencimento || '').slice(0, 10), pagamento: x.pagamento ? String(x.pagamento).slice(0, 10) : null }) }) })
        }
        if (b.action === 'cancelar') {
            var cn = await client.execute({ sql: "UPDATE cobrancas SET status='cancelado' WHERE id=? AND clinica_id=? AND paciente_id=? AND referencia='avulso' AND status NOT IN ('pago','recebido','confirmado')", args: [b.id, clinica_id, pa.id] })
            if (!cn.rowsAffected) return json(404, { success: false, error: 'Lançamento não encontrado ou já pago' })
            return json(200, { success: true })
        }
        if (b.action === 'receber') { var rr = await receberAvulso(client, clinica_id, b); return rr.erro ? json(rr.erro, { success: false, error: rr.error }) : json(200, { success: true }) }
        var vl = r2(num(b.valor)), ds = txt(b.descricao, 140), venc = DATA_RE.test(b.vencimento || '') ? b.vencimento : hojeCG()
        if (vl <= 0 || !ds) return json(400, { success: false, error: 'Informe descrição e valor' })
        var pagoAgora = b.pago === true || b.pago === 'true'
        var fm = FORMAS.indexOf(b.forma) !== -1 ? b.forma : (pagoAgora ? 'dinheiro' : 'a_definir')
        var ins = await client.execute({ sql: "INSERT INTO cobrancas(clinica_id,paciente_id,paciente_nome,tipo,valor,descricao,referencia,status,data_vencimento,data_pagamento) VALUES(?,?,?,?,?,?,'avulso',?,?,?)", args: [clinica_id, pa.id, pa.nome, fm, vl, ds, pagoAgora ? 'pago' : 'pendente', venc, pagoAgora ? venc + ' ' + agoraCG().slice(11) : null] })
        return json(200, { success: true, id: Number(ins.lastInsertRowid) })
    }

    // ── Anexos (comprovantes de contas a pagar) ──────────────────
    if (route === 'anexos') {
        var ent = ENTIDADES_ANEXO[q.entidade || b.entidade]
        if (!ent) return json(400, { success: false, error: 'Tipo de anexo inválido' })
        var refId = q.ref_id || b.ref_id
        var dono = (await client.execute({ sql: "SELECT id FROM " + ent.tabela + " WHERE id=? AND clinica_id=?", args: [refId, clinica_id] })).rows[0]
        if (!dono) return json(404, { success: false, error: 'Registro não encontrado' })
        var entNome = q.entidade || b.entidade
        if (req.method === 'GET') {
            if (q.id) {
                var um = (await client.execute({ sql: "SELECT id, nome, mime, dados FROM anexos WHERE id=? AND clinica_id=? AND entidade=? AND ref_id=?", args: [q.id, clinica_id, entNome, refId] })).rows[0]
                if (!um) return json(404, { success: false, error: 'Anexo não encontrado' })
                return json(200, { success: true, anexo: um })
            }
            var ls = await client.execute({ sql: "SELECT id, nome, mime, tamanho, comprovante, criado_por_nome, criado_em FROM anexos WHERE clinica_id=? AND entidade=? AND ref_id=? ORDER BY id", args: [clinica_id, entNome, refId] })
            return json(200, { success: true, data: ls.rows })
        }
        if (b.action === 'excluir') {
            var de = await client.execute({ sql: "DELETE FROM anexos WHERE id=? AND clinica_id=? AND entidade=? AND ref_id=?", args: [b.id, clinica_id, entNome, refId] })
            if (!de.rowsAffected) return json(404, { success: false, error: 'Anexo não encontrado' })
            await sincronizarComprovante(client, clinica_id, entNome, refId)
            return json(200, { success: true })
        }
        var dados = String(b.dados || '')
        var m = /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.exec(dados)
        if (!m) return json(400, { success: false, error: 'Envie imagem (PNG, JPG, WEBP) ou PDF' })
        if (dados.length > MAX_ANEXO) return json(400, { success: false, error: 'Arquivo muito grande (máximo 1,5 MB)' })
        var qtd = (await client.execute({ sql: "SELECT COUNT(*) n FROM anexos WHERE clinica_id=? AND entidade=? AND ref_id=?", args: [clinica_id, entNome, refId] })).rows[0]
        if (Number(qtd.n) >= 10) return json(400, { success: false, error: 'Limite de 10 anexos por registro' })
        var ia = await client.execute({ sql: "INSERT INTO anexos(clinica_id,entidade,ref_id,nome,mime,tamanho,dados,comprovante,criado_por_nome,criado_em) VALUES(?,?,?,?,?,?,?,?,?,?)", args: [clinica_id, entNome, refId, txt(b.nome, 120) || 'arquivo', m[1], Math.round(dados.length * 0.75), dados, b.comprovante ? 1 : 0, auth.nome || null, agoraCG()] })
        await sincronizarComprovante(client, clinica_id, entNome, refId)
        return json(200, { success: true, id: Number(ia.lastInsertRowid) })
    }

    // ── Pastas de fotos ──────────────────────────────────────────
    if (route === 'fotos-pastas') {
        var pf = await paciente(client, clinica_id, q.paciente_id)
        if (!pf) return json(404, { success: false, error: 'Paciente não encontrado' })
        var ps = await client.execute({ sql: "SELECT COALESCE(NULLIF(pasta,''),'') pasta, COUNT(*) n FROM documentos WHERE clinica_id=? AND paciente_id=? AND tipo='foto' GROUP BY 1 ORDER BY 1", args: [clinica_id, pf.id] })
        var vazias = (await client.execute({ sql: "SELECT nome FROM fotos_pastas WHERE clinica_id=? AND paciente_id=? ORDER BY nome", args: [clinica_id, pf.id] })).rows.map(function (r) { return r.nome })
        var mapa = {}
        ps.rows.forEach(function (r) { if (r.pasta) mapa[r.pasta] = Number(r.n) })
        vazias.forEach(function (n) { if (!(n in mapa)) mapa[n] = 0 })
        var total = ps.rows.reduce(function (s, r) { return s + Number(r.n) }, 0)
        return json(200, { success: true, total: total, sem_pasta: Number((ps.rows.filter(function (r) { return !r.pasta })[0] || { n: 0 }).n), pastas: Object.keys(mapa).sort().map(function (k) { return { nome: k, n: mapa[k] } }) })
    }
    if (route === 'foto-pasta') {
        var nomeP = txt(b.pasta, 60)
        if (b.action === 'criar') {
            var pc = await paciente(client, clinica_id, b.paciente_id)
            if (!pc || !nomeP) return json(400, { success: false, error: 'Informe o nome da pasta' })
            await client.execute({ sql: "INSERT OR IGNORE INTO fotos_pastas(clinica_id,paciente_id,nome) VALUES(?,?,?)", args: [clinica_id, pc.id, nomeP] })
            return json(200, { success: true })
        }
        var mv = await client.execute({ sql: "UPDATE documentos SET pasta=? WHERE id=? AND clinica_id=? AND tipo='foto'", args: [nomeP || null, b.id, clinica_id] })
        if (!mv.rowsAffected) return json(404, { success: false, error: 'Foto não encontrada' })
        return json(200, { success: true })
    }

    return false
}

// Recebe um lançamento avulso (Contas a receber ou ficha do paciente)
async function receberAvulso(client, cid, b) {
    var c = (await client.execute({ sql: "SELECT id, status FROM cobrancas WHERE id=? AND clinica_id=? AND referencia='avulso'", args: [b.id, cid] })).rows[0]
    if (!c) return { erro: 404, error: 'Lançamento não encontrado' }
    if (/pago|recebido|confirmado|cancelado/.test(c.status)) return { erro: 400, error: 'Lançamento já está pago ou cancelado' }
    var data = DATA_RE.test(b.data || '') ? b.data : hojeCG()
    var forma = FORMAS.indexOf(b.forma_pagamento || b.forma) !== -1 ? (b.forma_pagamento || b.forma) : 'dinheiro'
    await client.execute({ sql: "UPDATE cobrancas SET status='pago', data_pagamento=?, tipo=? WHERE id=? AND clinica_id=?", args: [data + ' ' + agoraCG().slice(11), forma, c.id, cid] })
    return {}
}

// contas_pagar.comprovante_url passa a apontar para o anexo marcado como comprovante
async function sincronizarComprovante(client, cid, entidade, refId) {
    if (entidade !== 'conta_pagar') return
    var cp = (await client.execute({ sql: "SELECT id FROM anexos WHERE clinica_id=? AND entidade='conta_pagar' AND ref_id=? AND comprovante=1 ORDER BY id DESC LIMIT 1", args: [cid, refId] })).rows[0]
    try { await client.execute({ sql: "UPDATE contas_pagar SET comprovante_url=? WHERE id=? AND clinica_id=?", args: [cp ? 'anexo:' + cp.id : null, refId, cid] }) } catch (e) {}
}

module.exports = { handle, receberAvulso, saldoCredito }
