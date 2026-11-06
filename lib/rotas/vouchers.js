// lib/rotas/vouchers.js — Controle de Voucher (como no Clinicorp)
// Klinov — Campo Grande, MS
//
// Modelos (templates) de voucher, geração de códigos, venda e uso no orçamento.
// Tipos (Clinicorp): desconto (percentual ou valor fixo), valor ("Voucher de
// Valor": abate do total), gratuito e procedimento (adiciona procedimentos com
// valor zero). O código é numérico de 6 dígitos; a validação devolve os mesmos
// erros numerados do Clinicorp: -1 validade encerrada, -2 já utilizado,
// -3 pendência de pagamento, -4 não encontrado, -5 limite de uso atingido.
// O voucher é consumido na APROVAÇÃO do orçamento (aprovar-orcamento).

var TIPOS = ['desconto', 'valor', 'gratuito', 'procedimento']

function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function num(v) { var n = typeof v === 'string' ? Number(v.replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.')) : Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0 }
function hojeCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10) }

async function tentar(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args })).rows }
    catch (e) { if (/no such (table|column)/i.test(e.message || '')) return []; throw e }
}

// Código numérico de 6 dígitos, único na clínica
async function gerarCodigo(client, cid) {
    for (var t = 0; t < 20; t++) {
        var c = String(100000 + Math.floor(Math.random() * 900000))
        var ja = await client.execute({ sql: "SELECT 1 FROM voucher_codigos WHERE clinica_id=? AND codigo=?", args: [cid, c] })
        if (!ja.rows.length) return c
    }
    throw new Error('Não foi possível gerar um código')
}

// Valida um código e devolve { err } (negativo, como no Clinicorp) ou os dados
async function validarCodigo(client, cid, codigo) {
    var rows = await tentar(client, "SELECT vc.*, v.nome, v.tipo, v.desconto_tipo, v.desconto_percent, v.desconto_valor, v.valor, v.procedimentos, v.ativo FROM voucher_codigos vc JOIN vouchers v ON v.id=vc.voucher_id AND v.clinica_id=vc.clinica_id WHERE vc.clinica_id=? AND vc.codigo=?", [cid, String(codigo || '').trim()])
    var c = rows[0]
    if (!c || Number(c.ativo) === 0 || c.status === 'cancelado') return { err: -4 }
    if (c.status === 'utilizado') return { err: -2 }
    if (c.validade && c.validade < hojeCG()) return { err: -1 }
    if (Number(c.exige_pagamento) && !Number(c.pago)) return { err: -3 }
    return { codigo: c }
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(st, o) { res.status(st).json(o); return true }

    // ── Controle de Voucher (Configurações > Vouchers) ────────────
    if (route === 'vouchers') {
        if (req.method === 'GET') {
            var vs = await tentar(client, "SELECT * FROM vouchers WHERE clinica_id=? ORDER BY ativo DESC, nome", [clinica_id])
            var cods = await tentar(client, "SELECT vc.*, p.nome comprador FROM voucher_codigos vc LEFT JOIN pacientes p ON p.id=vc.comprador_paciente_id AND p.clinica_id=vc.clinica_id WHERE vc.clinica_id=? ORDER BY vc.id DESC LIMIT 1000", [clinica_id])
            var porV = {}
            cods.forEach(function (c) { (porV[c.voucher_id] = porV[c.voucher_id] || []).push(c) })
            return json(200, {
                success: true,
                data: vs.map(function (v) {
                    var cs = porV[v.id] || []
                    return Object.assign({}, v, { procedimentos: v.procedimentos ? JSON.parse(v.procedimentos) : [], codigos: cs,
                        gerados: cs.length, utilizados: cs.filter(function (c) { return c.status === 'utilizado' }).length })
                })
            })
        }
        // Criar ou editar o modelo ("Criar Voucher" / "Editar Voucher")
        if (!b.action || b.action === 'salvar') {
            var nome = txt(b.nome, 80)
            if (!nome) return json(400, { success: false, error: 'Informe o nome do voucher' })
            var tipo = TIPOS.indexOf(b.tipo) >= 0 ? b.tipo : 'desconto'
            var dTipo = b.desconto_tipo === 'valor' ? 'valor' : 'percent'
            var dPct = Math.min(Math.max(num(b.desconto_percent), 0), 100), dVal = Math.max(num(b.desconto_valor), 0)
            if (tipo === 'desconto' && dTipo === 'percent' && !dPct) return json(400, { success: false, error: 'Informe o percentual de desconto' })
            if (tipo === 'desconto' && dTipo === 'valor' && !dVal) return json(400, { success: false, error: 'Informe o valor do desconto' })
            var valor = Math.max(num(b.valor), 0)
            if (tipo === 'valor' && !valor) return json(400, { success: false, error: 'Informe o Valor do Voucher' })
            var procs = []
            if (tipo === 'procedimento') {
                procs = (Array.isArray(b.procedimentos) ? b.procedimentos : []).slice(0, 30).map(function (p) {
                    return { procedimento: txt(p.procedimento, 200).toUpperCase(), quantidade: Math.max(parseInt(p.quantidade, 10) || 1, 1) }
                }).filter(function (p) { return p.procedimento })
                if (!procs.length) return json(400, { success: false, error: 'Aqui serão inseridos os procedimentos do voucher' })
            }
            var exigePag = tipo === 'gratuito' ? 0 : (b.exige_pagamento ? 1 : 0)
            var campos = [nome, tipo, dTipo, dPct, dVal, valor, JSON.stringify(procs), Math.max(parseInt(b.validade_dias, 10) || 0, 0) || null,
                b.reutilizavel ? 1 : 0, Math.max(parseInt(b.limite_codigos, 10) || 0, 0) || null, exigePag, Math.max(num(b.preco_venda), 0)]
            if (b.id) {
                var vUp = await client.execute({ sql: "UPDATE vouchers SET nome=?,tipo=?,desconto_tipo=?,desconto_percent=?,desconto_valor=?,valor=?,procedimentos=?,validade_dias=?,reutilizavel=?,limite_codigos=?,exige_pagamento=?,preco_venda=? WHERE id=? AND clinica_id=?", args: campos.concat([b.id, clinica_id]) })
                if (!vUp.rowsAffected) return json(404, { success: false, error: 'Voucher não Encontrado' })
                return json(200, { success: true, id: Number(b.id), msg: 'Voucher Editado com Sucesso' })
            }
            var vIns = await client.execute({ sql: "INSERT INTO vouchers(nome,tipo,desconto_tipo,desconto_percent,desconto_valor,valor,procedimentos,validade_dias,reutilizavel,limite_codigos,exige_pagamento,preco_venda,clinica_id,ativo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)", args: campos.concat([clinica_id]) })
            return json(200, { success: true, id: Number(vIns.lastInsertRowid), msg: 'Template de Voucher Criado com sucesso' })
        }
        if (b.action === 'inativar' || b.action === 'ativar') {
            var vAt = await client.execute({ sql: "UPDATE vouchers SET ativo=? WHERE id=? AND clinica_id=?", args: [b.action === 'ativar' ? 1 : 0, b.id, clinica_id] })
            return vAt.rowsAffected ? json(200, { success: true }) : json(404, { success: false, error: 'Voucher não Encontrado' })
        }
        // "Gerar Voucher" / "Gerar Próximo Voucher": cria códigos do modelo
        if (b.action === 'gerar') {
            var vg = (await client.execute({ sql: "SELECT * FROM vouchers WHERE id=? AND clinica_id=? AND ativo=1", args: [b.id, clinica_id] })).rows[0]
            if (!vg) return json(404, { success: false, error: 'Voucher não Encontrado' })
            var qtd = Math.min(Math.max(parseInt(b.quantidade, 10) || 1, 1), 100)
            if (vg.limite_codigos) {
                var jaG = await client.execute({ sql: "SELECT COUNT(*) n FROM voucher_codigos WHERE voucher_id=? AND clinica_id=? AND status<>'cancelado'", args: [vg.id, clinica_id] })
                if (Number(jaG.rows[0].n) + qtd > Number(vg.limite_codigos)) return json(400, { success: false, error: 'Não é possível colocar o Limite de Códigos menor do que a quantidade de códigos ja gerada', limite: Number(vg.limite_codigos), gerados: Number(jaG.rows[0].n) })
            }
            var validade = null
            if (vg.validade_dias) { var dv = new Date(hojeCG() + 'T12:00:00Z'); dv.setUTCDate(dv.getUTCDate() + Number(vg.validade_dias)); validade = dv.toISOString().slice(0, 10) }
            var novos = []
            for (var g = 0; g < qtd; g++) {
                var cod = await gerarCodigo(client, clinica_id)
                await client.execute({ sql: "INSERT INTO voucher_codigos(clinica_id,voucher_id,codigo,validade,status,exige_pagamento,criado_por_nome) VALUES(?,?,?,?,'disponivel',?,?)", args: [clinica_id, vg.id, cod, validade, Number(vg.exige_pagamento) ? 1 : 0, (auth && auth.nome) || null] })
                novos.push(cod)
            }
            return json(200, { success: true, codigos: novos, validade: validade, msg: 'Voucher Salvo' })
        }
        // "Vender Voucher": liga o código a um comprador, com valor e situação do pagamento
        if (b.action === 'vender') {
            var cv = (await client.execute({ sql: "SELECT vc.*, v.preco_venda FROM voucher_codigos vc JOIN vouchers v ON v.id=vc.voucher_id AND v.clinica_id=vc.clinica_id WHERE vc.id=? AND vc.clinica_id=?", args: [b.codigo_id, clinica_id] })).rows[0]
            if (!cv) return json(404, { success: false, error: 'Voucher não Encontrado' })
            if (cv.status === 'utilizado') return json(400, { success: false, error: 'Voucher já utilizado' })
            var compradorId = parseInt(b.paciente_id, 10) || null
            if (compradorId) {
                var pcv = await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [compradorId, clinica_id] })
                if (!pcv.rows.length) return json(404, { success: false, error: 'Paciente não encontrado' })
            }
            await client.execute({ sql: "UPDATE voucher_codigos SET status='vendido', comprador_paciente_id=?, comprador_nome=?, valor_venda=?, pago=?, venda_em=datetime('now','-4 hours') WHERE id=? AND clinica_id=?",
                args: [compradorId, txt(b.comprador_nome, 120) || null, num(b.valor_venda) || num(cv.preco_venda), b.pago ? 1 : 0, cv.id, clinica_id] })
            return json(200, { success: true, msg: 'Venda de Voucher registrada' })
        }
        // Receber o pagamento da venda
        if (b.action === 'receber') {
            var rcv = await client.execute({ sql: "UPDATE voucher_codigos SET pago=1 WHERE id=? AND clinica_id=? AND status='vendido'", args: [b.codigo_id, clinica_id] })
            return rcv.rowsAffected ? json(200, { success: true }) : json(404, { success: false, error: 'Voucher não Encontrado' })
        }
        if (b.action === 'cancelar') {
            var ccv = await client.execute({ sql: "UPDATE voucher_codigos SET status='cancelado' WHERE id=? AND clinica_id=? AND status<>'utilizado'", args: [b.codigo_id, clinica_id] })
            return ccv.rowsAffected ? json(200, { success: true }) : json(400, { success: false, error: 'Voucher já utilizado' })
        }
        return json(400, { success: false, error: 'Ação inválida' })
    }

    // ── Código do Voucher (tela de orçamento: "Inserir Voucher") ──
    if (route === 'voucher-codigo') {
        var cod6 = String(q.codigo || b.codigo || '').trim()
        if (!/^\d{6,}$/.test(cod6)) return json(200, { success: false, err: -4, error: 'Voucher não Encontrado' })
        var vr = await validarCodigo(client, clinica_id, cod6)
        if (vr.err) {
            var MSG = { '-1': 'Voucher com prazo de validade encerrado', '-2': 'Voucher já utilizado', '-3': 'Voucher com pendência de pagamento', '-4': 'Voucher não Encontrado', '-5': 'Limite de uso do voucher atingido' }
            return json(200, { success: false, err: vr.err, error: MSG[String(vr.err)] })
        }
        var cOk = vr.codigo
        return json(200, { success: true, voucher: { codigo: cOk.codigo, nome: cOk.nome, tipo: cOk.tipo, desconto_tipo: cOk.desconto_tipo, desconto_percent: Number(cOk.desconto_percent) || 0, desconto_valor: Number(cOk.desconto_valor) || 0, valor: Number(cOk.valor) || 0, procedimentos: cOk.procedimentos ? JSON.parse(cOk.procedimentos) : [], validade: cOk.validade } })
    }

    return false
}

// Consome o voucher na aprovação do orçamento ("Será consumido mediante a
// aprovação do orçamento"). Devolve { erro } se não puder mais ser usado.
async function consumir(client, clinica_id, codigo, orcamento_id, auth) {
    if (!codigo) return {}
    var vr = await validarCodigo(client, clinica_id, codigo)
    if (vr.err) {
        var MSG = { '-1': 'Voucher com prazo de validade encerrado', '-2': 'Voucher já utilizado', '-3': 'Voucher com pendência de pagamento', '-4': 'Voucher não Encontrado', '-5': 'Limite de uso do voucher atingido' }
        return { erro: MSG[String(vr.err)] }
    }
    await client.execute({ sql: "UPDATE voucher_codigos SET status='utilizado', usado_em=datetime('now','-4 hours'), usado_orcamento_id=?, usado_por_nome=? WHERE id=? AND clinica_id=?", args: [orcamento_id || null, (auth && auth.nome) || null, vr.codigo.id, clinica_id] })
    return {}
}

module.exports = { handle, consumir, validarCodigo }
