// lib/rotas/agenda.js — Rotas da Agenda (Fase 2)
// Klinov — Campo Grande, MS
//
// Chamado por api/data.js: handle(route, ctx) devolve true quando respondeu.
// ctx = { req, res, q, client, auth, clinica_id }. Toda query filtra clinica_id.

var { moverParaLixeira } = require('../lixeira')

// Categorias padrão (iguais às do Clinicorp) criadas na primeira abertura da agenda
var CATEGORIAS_PADRAO = [
    ['Avaliação', '#1565C0'], ['Consulta', '#034030'], ['Retorno', '#2E7D52'], ['Cirurgia', '#C62828'],
    ['Clareamento', '#FF6D00'], ['Endodontia', '#1B5E3B'], ['Harmonização', '#E65100'], ['Implante', '#00695C'],
    ['Instalação de aparelho', '#424242'], ['Manutenção', '#757575'], ['Ortodontia', '#1565C0'],
    ['Prótese', '#00695C'], ['Restauração', '#2E7D52'], ['Profilaxia', '#1B5E3B']
]

var HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/
var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var COR_RE = /^#[0-9A-Fa-f]{6}$/

function minutos(h) { var p = String(h).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1] || 0, 10) }
function sobrepoe(i1, f1, i2, f2) { return minutos(i1) < minutos(f2) && minutos(i2) < minutos(f1) }

function addDias(data, n) {
    var d = new Date(data + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
}

async function categorias(client, clinica_id) {
    var r = await client.execute({ sql: "SELECT id,nome,cor,ordem FROM agenda_categorias WHERE clinica_id=? AND ativo=1 ORDER BY ordem, nome", args: [clinica_id] })
    if (r.rows.length) return r.rows
    var existe = await client.execute({ sql: "SELECT COUNT(*) n FROM agenda_categorias WHERE clinica_id=?", args: [clinica_id] })
    if (existe.rows[0].n > 0) return []
    for (var i = 0; i < CATEGORIAS_PADRAO.length; i++) {
        await client.execute({ sql: "INSERT INTO agenda_categorias(clinica_id,nome,cor,ordem) VALUES(?,?,?,?)", args: [clinica_id, CATEGORIAS_PADRAO[i][0], CATEGORIAS_PADRAO[i][1], i] })
    }
    return (await client.execute({ sql: "SELECT id,nome,cor,ordem FROM agenda_categorias WHERE clinica_id=? AND ativo=1 ORDER BY ordem, nome", args: [clinica_id] })).rows
}

// Conflitos para um horário: bloqueios do profissional/clínica e limite de
// agendamentos simultâneos. Devolve mensagem de erro ou null.
async function conflito(client, clinica_id, profissional_id, data, inicio, fim, ignorarId, limite) {
    var bl = await client.execute({
        sql: "SELECT titulo,hora_inicio,hora_fim FROM agenda_bloqueios WHERE clinica_id=? AND data=? AND bloqueia=1 AND (profissional_id IS NULL OR profissional_id=?)",
        args: [clinica_id, data, profissional_id || 0]
    })
    for (var i = 0; i < bl.rows.length; i++) {
        var b = bl.rows[i]
        if (sobrepoe(inicio, fim, b.hora_inicio, b.hora_fim)) return 'Horário bloqueado: ' + b.titulo + ' (' + b.hora_inicio + '–' + b.hora_fim + ')'
    }
    if (!profissional_id) return null
    var ag = await client.execute({
        sql: "SELECT id,substr(data_hora,12,5) ini,hora_fim FROM agendamentos WHERE clinica_id=? AND profissional_id=? AND DATE(data_hora)=? AND status NOT IN ('cancelado','desmarcado','faltou') AND id<>?",
        args: [clinica_id, profissional_id, data, ignorarId || 0]
    })
    var simultaneos = ag.rows.filter(function(a) { return sobrepoe(inicio, fim, a.ini, a.hora_fim || a.ini) }).length
    if (simultaneos >= (limite || 1)) return 'O profissional já tem agendamento nesse horário'
    return null
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}

    // ── Tudo que a tela da agenda precisa para um período ─────────
    if (route === 'agenda-config') {
        var ini = DATA_RE.test(q.de || '') ? q.de : new Date().toISOString().slice(0, 10)
        var fimP = DATA_RE.test(q.ate || '') ? q.ate : addDias(ini, 42)
        var r = await Promise.all([
            categorias(client, clinica_id),
            client.execute({ sql: "SELECT dia_semana,hora_inicio,hora_fim FROM clinica_horarios WHERE clinica_id=? ORDER BY dia_semana,hora_inicio", args: [clinica_id] }),
            client.execute({ sql: "SELECT profissional_id,dia_semana,hora_inicio,hora_fim FROM profissional_horarios WHERE clinica_id=? ORDER BY profissional_id,dia_semana,hora_inicio", args: [clinica_id] }),
            client.execute({ sql: "SELECT id,profissional_id,data,hora_inicio,hora_fim,titulo,observacao,bloqueia,criado_por_nome FROM agenda_bloqueios WHERE clinica_id=? AND data BETWEEN ? AND ? ORDER BY data,hora_inicio", args: [clinica_id, ini, fimP] }),
            client.execute({ sql: "SELECT ar.id,ar.paciente_id,p.nome paciente_nome,p.telefone,ar.profissional_id,ar.data_retorno,ar.motivo,ar.status FROM alertas_retorno ar JOIN pacientes p ON p.id=ar.paciente_id AND p.clinica_id=ar.clinica_id WHERE ar.clinica_id=? AND ar.status='pendente' ORDER BY ar.data_retorno LIMIT 300", args: [clinica_id] }),
            client.execute({ sql: "SELECT le.id,le.paciente_id,p.nome paciente_nome,p.telefone,le.profissional_id,le.preferencia,le.observacao,le.criado_em FROM lista_espera le JOIN pacientes p ON p.id=le.paciente_id AND p.clinica_id=le.clinica_id WHERE le.clinica_id=? AND le.status='aguardando' ORDER BY le.criado_em LIMIT 300", args: [clinica_id] }),
            client.execute({ sql: "SELECT id,nome,cor_agenda,especialidade,ativo FROM profissionais WHERE clinica_id=? ORDER BY nome", args: [clinica_id] })
        ])
        return res.status(200).json({
            success: true, categorias: r[0], horarios_clinica: r[1].rows, horarios_profissionais: r[2].rows,
            bloqueios: r[3].rows, alertas_retorno: r[4].rows, lista_espera: r[5].rows, profissionais: r[6].rows
        }), true
    }

    // ── Categorias (criar/editar/remover) ─────────────────────────
    if (route === 'agenda-categorias') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' }), true
        if (b.action === 'delete') {
            await client.execute({ sql: "UPDATE agenda_categorias SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            return res.status(200).json({ success: true }), true
        }
        var nome = String(b.nome || '').trim().slice(0, 60)
        if (!nome || !COR_RE.test(b.cor || '')) return res.status(400).json({ success: false, error: 'Nome e cor (#RRGGBB) obrigatórios' }), true
        if (b.id) {
            var up = await client.execute({ sql: "UPDATE agenda_categorias SET nome=?,cor=? WHERE id=? AND clinica_id=?", args: [nome, b.cor, b.id, clinica_id] })
            if (!up.rowsAffected) return res.status(404).json({ success: false, error: 'Categoria não encontrada' }), true
            return res.status(200).json({ success: true, id: Number(b.id) }), true
        }
        var ord = await client.execute({ sql: "SELECT COALESCE(MAX(ordem),0)+1 o FROM agenda_categorias WHERE clinica_id=?", args: [clinica_id] })
        var ins = await client.execute({ sql: "INSERT INTO agenda_categorias(clinica_id,nome,cor,ordem) VALUES(?,?,?,?)", args: [clinica_id, nome, b.cor, ord.rows[0].o] })
        return res.status(200).json({ success: true, id: Number(ins.lastInsertRowid) }), true
    }

    // ── Compromissos / bloqueios ──────────────────────────────────
    if (route === 'agenda-bloqueio') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' }), true
        if (b.action === 'delete') {
            var del = await client.execute({ sql: "DELETE FROM agenda_bloqueios WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!del.rowsAffected) return res.status(404).json({ success: false, error: 'Compromisso não encontrado' }), true
            return res.status(200).json({ success: true }), true
        }
        var titulo = String(b.titulo || '').trim().slice(0, 80)
        if (!titulo || !DATA_RE.test(b.data || '') || !HORA_RE.test(b.hora_inicio || '') || !HORA_RE.test(b.hora_fim || '')) {
            return res.status(400).json({ success: false, error: 'Título, data, início e fim obrigatórios' }), true
        }
        if (minutos(b.hora_fim) <= minutos(b.hora_inicio)) return res.status(400).json({ success: false, error: 'O fim precisa ser depois do início' }), true
        var profB = b.profissional_id ? parseInt(b.profissional_id, 10) : null
        if (profB) {
            var okP = await client.execute({ sql: "SELECT id FROM profissionais WHERE id=? AND clinica_id=?", args: [profB, clinica_id] })
            if (!okP.rows.length) return res.status(404).json({ success: false, error: 'Profissional não encontrado' }), true
        }
        // Repetir: até 52 ocorrências, a cada N dias
        var vezes = Math.min(Math.max(parseInt(b.repetir_vezes, 10) || 1, 1), 52)
        var cada = Math.min(Math.max(parseInt(b.repetir_cada_dias, 10) || 7, 1), 365)
        var ids = []
        for (var i = 0; i < vezes; i++) {
            var dataI = addDias(b.data, i * cada)
            var insB = await client.execute({
                sql: "INSERT INTO agenda_bloqueios(clinica_id,profissional_id,data,hora_inicio,hora_fim,titulo,observacao,bloqueia,criado_por_nome) VALUES(?,?,?,?,?,?,?,?,?)",
                args: [clinica_id, profB, dataI, b.hora_inicio, b.hora_fim, titulo, String(b.observacao || '').slice(0, 500), b.bloqueia === 0 || b.bloqueia === false ? 0 : 1, auth.nome || null]
            })
            ids.push(Number(insB.lastInsertRowid))
        }
        return res.status(200).json({ success: true, ids: ids }), true
    }

    // ── Horário de funcionamento e agenda de trabalho ─────────────
    // body: { profissional_id?: id, horarios: [{dia_semana, hora_inicio, hora_fim}] }
    if (route === 'agenda-horarios') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' }), true
        var lista = Array.isArray(b.horarios) ? b.horarios : []
        for (var h = 0; h < lista.length; h++) {
            var it = lista[h]
            if (!(it.dia_semana >= 0 && it.dia_semana <= 6) || !HORA_RE.test(it.hora_inicio || '') || !HORA_RE.test(it.hora_fim || '') || minutos(it.hora_fim) <= minutos(it.hora_inicio)) {
                return res.status(400).json({ success: false, error: 'Horário inválido no item ' + (h + 1) }), true
            }
        }
        if (b.profissional_id) {
            var okH = await client.execute({ sql: "SELECT id FROM profissionais WHERE id=? AND clinica_id=?", args: [b.profissional_id, clinica_id] })
            if (!okH.rows.length) return res.status(404).json({ success: false, error: 'Profissional não encontrado' }), true
            await client.execute({ sql: "DELETE FROM profissional_horarios WHERE profissional_id=? AND clinica_id=?", args: [b.profissional_id, clinica_id] })
            for (var j = 0; j < lista.length; j++) {
                await client.execute({ sql: "INSERT INTO profissional_horarios(clinica_id,profissional_id,dia_semana,hora_inicio,hora_fim) VALUES(?,?,?,?,?)", args: [clinica_id, b.profissional_id, lista[j].dia_semana, lista[j].hora_inicio, lista[j].hora_fim] })
            }
        } else {
            await client.execute({ sql: "DELETE FROM clinica_horarios WHERE clinica_id=?", args: [clinica_id] })
            for (var k = 0; k < lista.length; k++) {
                await client.execute({ sql: "INSERT INTO clinica_horarios(clinica_id,dia_semana,hora_inicio,hora_fim) VALUES(?,?,?,?)", args: [clinica_id, lista[k].dia_semana, lista[k].hora_inicio, lista[k].hora_fim] })
            }
        }
        return res.status(200).json({ success: true }), true
    }

    // ── Cor da agenda do profissional ─────────────────────────────
    if (route === 'agenda-cor-profissional') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' }), true
        if (!COR_RE.test(b.cor || '')) return res.status(400).json({ success: false, error: 'Cor inválida' }), true
        var upC = await client.execute({ sql: "UPDATE profissionais SET cor_agenda=? WHERE id=? AND clinica_id=?", args: [b.cor, b.profissional_id, clinica_id] })
        if (!upC.rowsAffected) return res.status(404).json({ success: false, error: 'Profissional não encontrado' }), true
        return res.status(200).json({ success: true }), true
    }

    // ── Alertas de retorno ────────────────────────────────────────
    if (route === 'alertas-retorno') {
        if (req.method === 'GET') {
            var w = ["ar.clinica_id=?"], a = [clinica_id]
            if (q.paciente_id) { w.push("ar.paciente_id=?"); a.push(q.paciente_id) }
            if (q.status) { w.push("ar.status=?"); a.push(q.status) }
            var rr = await client.execute({ sql: "SELECT ar.*,p.nome paciente_nome FROM alertas_retorno ar JOIN pacientes p ON p.id=ar.paciente_id AND p.clinica_id=ar.clinica_id WHERE " + w.join(' AND ') + " ORDER BY ar.data_retorno LIMIT 300", args: a })
            return res.status(200).json({ success: true, data: rr.rows }), true
        }
        if (b.action === 'status') {
            if (['pendente', 'agendado', 'cancelado', 'concluido'].indexOf(b.status) === -1) return res.status(400).json({ success: false, error: 'Status inválido' }), true
            var us = await client.execute({ sql: "UPDATE alertas_retorno SET status=?,agendamento_id=COALESCE(?,agendamento_id) WHERE id=? AND clinica_id=?", args: [b.status, b.agendamento_id || null, b.id, clinica_id] })
            if (!us.rowsAffected) return res.status(404).json({ success: false, error: 'Alerta não encontrado' }), true
            return res.status(200).json({ success: true }), true
        }
        if (!b.paciente_id || !DATA_RE.test(b.data_retorno || '')) return res.status(400).json({ success: false, error: 'Paciente e data de retorno obrigatórios' }), true
        var okPa = await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })
        if (!okPa.rows.length) return res.status(404).json({ success: false, error: 'Paciente não encontrado' }), true
        var insA = await client.execute({
            sql: "INSERT INTO alertas_retorno(clinica_id,paciente_id,profissional_id,data_retorno,motivo,criado_por_nome) VALUES(?,?,?,?,?,?)",
            args: [clinica_id, b.paciente_id, b.profissional_id || null, b.data_retorno, String(b.motivo || '').slice(0, 200), auth.nome || null]
        })
        return res.status(200).json({ success: true, id: Number(insA.lastInsertRowid) }), true
    }

    // ── Lista de espera ───────────────────────────────────────────
    if (route === 'lista-espera') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' }), true
        if (b.action === 'status') {
            if (['aguardando', 'agendado', 'removido'].indexOf(b.status) === -1) return res.status(400).json({ success: false, error: 'Status inválido' }), true
            var ul = await client.execute({ sql: "UPDATE lista_espera SET status=? WHERE id=? AND clinica_id=?", args: [b.status, b.id, clinica_id] })
            if (!ul.rowsAffected) return res.status(404).json({ success: false, error: 'Item não encontrado' }), true
            return res.status(200).json({ success: true }), true
        }
        if (!b.paciente_id) return res.status(400).json({ success: false, error: 'Paciente obrigatório' }), true
        var okPl = await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })
        if (!okPl.rows.length) return res.status(404).json({ success: false, error: 'Paciente não encontrado' }), true
        var insL = await client.execute({
            sql: "INSERT INTO lista_espera(clinica_id,paciente_id,profissional_id,preferencia,observacao,criado_por_nome) VALUES(?,?,?,?,?,?)",
            args: [clinica_id, b.paciente_id, b.profissional_id || null, String(b.preferencia || '').slice(0, 120), String(b.observacao || '').slice(0, 500), auth.nome || null]
        })
        return res.status(200).json({ success: true, id: Number(insL.lastInsertRowid) }), true
    }

    // ── Situação financeira resumida do paciente (selo do popover) ─
    if (route === 'agenda-situacao-paciente') {
        var pid = parseInt(q.paciente_id, 10) || 0
        var hoje = new Date().toISOString().slice(0, 10)
        var venc = { rows: [{ n: 0, total: 0 }] }
        try {
            venc = await client.execute({
                sql: "SELECT COUNT(*) n, COALESCE(SUM(valor),0) total FROM parcelas_orcamento WHERE clinica_id=? AND paciente_id=? AND status NOT IN ('pago','cancelado') AND data_vencimento < ?",
                args: [clinica_id, pid, hoje]
            })
        } catch (e) { /* tabela ausente em bases antigas: trata como em dia */ }
        return res.status(200).json({ success: true, parcelas_vencidas: Number(venc.rows[0].n), valor_vencido: Number(venc.rows[0].total) }), true
    }

    // ── Salvar agendamento (inclui recorrência e checagem de conflito) ─
    if (route === 'salvar-agendamento') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' }), true
        // Atualização só de status (popover / confirmação)
        if (b.id && b.paciente_nome === '_keep_') {
            var st = String(b.status || 'agendado')
            var up2 = await client.execute({ sql: "UPDATE agendamentos SET status=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [st, b.id, clinica_id] })
            if (!up2.rowsAffected) return res.status(404).json({ success: false, error: 'Agendamento não encontrado' }), true
            return res.status(200).json({ success: true, msg: 'Status atualizado' }), true
        }
        if (!b.paciente_nome || !DATA_RE.test(b.data || '') || !HORA_RE.test(b.hora || '')) {
            return res.status(400).json({ success: false, error: 'Paciente, data e hora obrigatórios' }), true
        }
        var horaFim = HORA_RE.test(b.hora_fim || '') ? b.hora_fim : null
        if (!horaFim) { var mf = minutos(b.hora) + 30; horaFim = String(Math.floor(mf / 60)).padStart(2, '0') + ':' + String(mf % 60).padStart(2, '0') }
        if (minutos(horaFim) <= minutos(b.hora)) return res.status(400).json({ success: false, error: 'O fim precisa ser depois do início' }), true

        var pacId = null
        if (b.paciente_id) {
            var rp = await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [b.paciente_id, clinica_id] })
            if (!rp.rows.length) return res.status(404).json({ success: false, error: 'Paciente não encontrado' }), true
            pacId = rp.rows[0].id
        } else {
            var rpn = await client.execute({ sql: "SELECT id FROM pacientes WHERE nome=? AND clinica_id=? LIMIT 1", args: [b.paciente_nome, clinica_id] })
            if (rpn.rows.length) pacId = rpn.rows[0].id
        }
        var profId = b.profissional_id ? parseInt(b.profissional_id, 10) : null
        var profNome = b.profissional_nome || ''
        if (profId) {
            var rpr = await client.execute({ sql: "SELECT nome FROM profissionais WHERE id=? AND clinica_id=?", args: [profId, clinica_id] })
            if (!rpr.rows.length) return res.status(404).json({ success: false, error: 'Profissional não encontrado' }), true
            profNome = rpr.rows[0].nome
        }
        var catId = null, tipo = b.tipo || ''
        if (b.categoria_id) {
            var rc = await client.execute({ sql: "SELECT id,nome FROM agenda_categorias WHERE id=? AND clinica_id=?", args: [b.categoria_id, clinica_id] })
            if (rc.rows.length) { catId = rc.rows[0].id; tipo = rc.rows[0].nome }
        }
        var limite = Math.min(Math.max(parseInt(b.limite_simultaneos, 10) || 1, 1), 10)
        var permitirSobreposicao = b.permitir_conflito === true

        var vezes2 = b.id ? 1 : Math.min(Math.max(parseInt(b.repetir_vezes, 10) || 1, 1), 52)
        var cada2 = Math.min(Math.max(parseInt(b.repetir_cada_dias, 10) || 7, 1), 365)
        var datas = []
        for (var v = 0; v < vezes2; v++) datas.push(addDias(b.data, v * cada2))
        if (!permitirSobreposicao) {
            for (var c = 0; c < datas.length; c++) {
                var msg = await conflito(client, clinica_id, profId, datas[c], b.hora, horaFim, b.id, limite)
                if (msg) return res.status(409).json({ success: false, error: msg + (datas.length > 1 ? ' em ' + datas[c].split('-').reverse().join('/') : ''), conflito: true }), true
            }
        }
        var campos = [pacId, profId, horaFim, tipo, catId, b.status || 'agendado', b.procedimento || '', String(b.observacoes || '').slice(0, 1000),
            b.paciente_nome, profNome, b.primeira_consulta ? 1 : 0, b.confirmacao_envio || null, b.alerta_envio || null, b.canal_envio || null]
        if (b.id) {
            var upA = await client.execute({
                sql: "UPDATE agendamentos SET paciente_id=?,profissional_id=?,hora_fim=?,tipo=?,categoria_id=?,status=?,procedimento=?,observacoes=?,paciente_nome=?,profissional_nome=?,primeira_consulta=?,confirmacao_envio=?,alerta_envio=?,canal_envio=?,data_hora=?,atualizado_em=datetime('now') WHERE id=? AND clinica_id=?",
                args: campos.concat([b.data + ' ' + b.hora, b.id, clinica_id])
            })
            if (!upA.rowsAffected) return res.status(404).json({ success: false, error: 'Agendamento não encontrado' }), true
            return res.status(200).json({ success: true, msg: 'Agendamento atualizado', ids: [Number(b.id)] }), true
        }
        var serie = datas.length > 1 ? 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : null
        var novos = []
        for (var n = 0; n < datas.length; n++) {
            var insAg = await client.execute({
                sql: "INSERT INTO agendamentos(paciente_id,profissional_id,hora_fim,tipo,categoria_id,status,procedimento,observacoes,paciente_nome,profissional_nome,primeira_consulta,confirmacao_envio,alerta_envio,canal_envio,data_hora,serie_id,criado_por_nome,criado_em,atualizado_em,clinica_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),?)",
                args: campos.concat([datas[n] + ' ' + b.hora, serie, auth.nome || null, clinica_id])
            })
            novos.push(Number(insAg.lastInsertRowid))
        }
        if (b.alerta_retorno_id) {
            await client.execute({ sql: "UPDATE alertas_retorno SET status='agendado',agendamento_id=? WHERE id=? AND clinica_id=?", args: [novos[0], b.alerta_retorno_id, clinica_id] })
        }
        if (b.lista_espera_id) {
            await client.execute({ sql: "UPDATE lista_espera SET status='agendado' WHERE id=? AND clinica_id=?", args: [b.lista_espera_id, clinica_id] })
        }
        return res.status(200).json({ success: true, msg: novos.length > 1 ? novos.length + ' agendamentos salvos' : 'Agendamento salvo', ids: novos }), true
    }

    // ── Excluir agendamento (vai para a lixeira) ──────────────────
    if (route === 'excluir-agendamento') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST required' }), true
        if (!b.id) return res.status(400).json({ success: false, error: 'id obrigatório' }), true
        if (!await moverParaLixeira(client, auth, 'agendamento', b.id)) return res.status(404).json({ success: false, error: 'Agendamento não encontrado' }), true
        return res.status(200).json({ success: true, msg: 'Agendamento excluído' }), true
    }

    return false
}

module.exports = { handle, conflito, CATEGORIAS_PADRAO }
