// lib/rotas/publico.js — Anamnese por link, check-in por QR e medicamentos (Fase 9, parte 2)
// Klinov — Campo Grande, MS
//
// Duas entradas:
//   handlePublico(ctx)  rota 'publico' SEM login (?acao=anamnese|checkin). Só
//                       aceita token aleatório; nunca devolve dado além do
//                       primeiro nome do paciente. Tentativas limitadas por IP.
//   handle(route, ctx)  rotas logadas: anamnese-perguntas, anamnese-modelo,
//                       anamnese-link, checkin-config, medicamentos.

var crypto = require('crypto')

var TIPOS_PERG = ['YES_NO', 'DESC']
// [pergunta, tipo, alerta] — alerta: "Sim" merece atenção antes do atendimento
var PERGUNTAS_PADRAO = [
    ['Qual o motivo da consulta?', 'DESC', 0],
    ['Quando foi o seu último tratamento odontológico?', 'DESC', 0],
    ['Está fazendo algum tratamento médico?', 'YES_NO', 0],
    ['Está tomando algum medicamento?', 'YES_NO', 1],
    ['Tem alergia a algum medicamento?', 'YES_NO', 1],
    ['Teve alguma reação a anestesia local?', 'YES_NO', 1],
    ['Sente sensibilidade nos dentes?', 'YES_NO', 0],
    ['Range os dentes ou tem apertamento?', 'YES_NO', 0],
    ['Sua gengiva sangra com frequência?', 'YES_NO', 0],
    ['Tem algum hábito? (Ex.: roe unha, morde tampa de caneta)', 'YES_NO', 0],
    ['Fuma? Quantos cigarros por dia?', 'YES_NO', 0],
    ['É diabético? Tem alguém da família que é diabético?', 'YES_NO', 1],
    ['Quando você se corta, sangra muito?', 'YES_NO', 1],
    ['Tem algum problema cardíaco?', 'YES_NO', 1],
    ['Sente dores de cabeça, dores na face, ouvido ou articulação?', 'YES_NO', 0],
    ['Teve algum desmaio, tem ataques nervosos, epilepsia ou convulsão?', 'YES_NO', 1],
    ['Sua pressão arterial é normal?', 'YES_NO', 0],
    ['Está grávida?', 'YES_NO', 1]
]
// Sugestões iniciais para adulto; a clínica revisa e edita em Configurações.
// [nome, apresentação, quantidade, posologia, uso]
var MEDICAMENTOS_PADRAO = [
    ['Amoxicilina 500 mg', 'Cápsula', '21 cápsulas', 'Tomar 1 cápsula de 8 em 8 horas por 7 dias.', 'interno'],
    ['Amoxicilina + clavulanato de potássio 875 mg + 125 mg', 'Comprimido', '14 comprimidos', 'Tomar 1 comprimido de 12 em 12 horas por 7 dias.', 'interno'],
    ['Azitromicina 500 mg', 'Comprimido', '3 comprimidos', 'Tomar 1 comprimido ao dia por 3 dias.', 'interno'],
    ['Clindamicina 300 mg', 'Cápsula', '28 cápsulas', 'Tomar 1 cápsula de 6 em 6 horas por 7 dias.', 'interno'],
    ['Metronidazol 400 mg', 'Comprimido', '21 comprimidos', 'Tomar 1 comprimido de 8 em 8 horas por 7 dias.', 'interno'],
    ['Ibuprofeno 600 mg', 'Comprimido', '9 comprimidos', 'Tomar 1 comprimido de 8 em 8 horas por 3 dias, após as refeições.', 'interno'],
    ['Nimesulida 100 mg', 'Comprimido', '6 comprimidos', 'Tomar 1 comprimido de 12 em 12 horas por 3 dias, após as refeições.', 'interno'],
    ['Dipirona 500 mg', 'Comprimido', '12 comprimidos', 'Tomar 1 comprimido de 6 em 6 horas em caso de dor.', 'interno'],
    ['Paracetamol 750 mg', 'Comprimido', '12 comprimidos', 'Tomar 1 comprimido de 6 em 6 horas em caso de dor.', 'interno'],
    ['Dexametasona 4 mg', 'Comprimido', '1 comprimido', 'Tomar 1 comprimido 1 hora antes do procedimento.', 'interno'],
    ['Digluconato de clorexidina 0,12%', 'Solução para bochecho', '1 frasco de 250 mL', 'Bochechar 15 mL por 1 minuto, 2 vezes ao dia, por 7 dias.', 'externo']
]
var LINK_DIAS = 7
var LIMITE = { checkin: 8, anamnese: 30 } // tentativas por IP a cada 10 minutos

function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function token() { return crypto.randomBytes(24).toString('hex') }
function tokenOk(t) { return /^[a-f0-9]{48}$/.test(String(t || '')) }
function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) }
function primeiroNome(n) { var p = String(n || '').trim().split(/\s+/)[0] || ''; return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() }
function ipDe(req) { var h = req.headers || {}; return String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim().slice(0, 64) || 'local' }
function digitos(v) { return String(v || '').replace(/\D/g, '') }

async function perguntas(client, cid) {
    var r = await client.execute({ sql: "SELECT id,pergunta,tipo,sequencia,COALESCE(alerta,0) alerta FROM anamnese_perguntas WHERE clinica_id=? AND ativo=1 ORDER BY sequencia,id", args: [cid] })
    if (r.rows.length) return r.rows
    var todas = await client.execute({ sql: "SELECT COUNT(*) n FROM anamnese_perguntas WHERE clinica_id=?", args: [cid] })
    if (Number(todas.rows[0].n) > 0) return []
    for (var i = 0; i < PERGUNTAS_PADRAO.length; i++) {
        var p = PERGUNTAS_PADRAO[i]
        await client.execute({ sql: "INSERT INTO anamnese_perguntas(clinica_id,pergunta,tipo,sequencia,alerta) VALUES(?,?,?,?,?)", args: [cid, p[0], p[1], i + 1, p[2]] })
    }
    return (await client.execute({ sql: "SELECT id,pergunta,tipo,sequencia,COALESCE(alerta,0) alerta FROM anamnese_perguntas WHERE clinica_id=? AND ativo=1 ORDER BY sequencia,id", args: [cid] })).rows
}

// Grava as respostas (substitui as anteriores). Só aceita perguntas ativas da clínica.
async function gravarRespostas(client, cid, pacienteId, respostas, quem) {
    var ps = await perguntas(client, cid), porId = {}
    ps.forEach(function (p) { porId[p.id] = p })
    var lista = (Array.isArray(respostas) ? respostas : []).filter(function (r) { return r && porId[r.pergunta_id] })
    await client.execute({ sql: "DELETE FROM anamnese_respostas WHERE paciente_id=? AND clinica_id=?", args: [pacienteId, cid] })
    for (var i = 0; i < lista.length; i++) {
        var r = lista[i], p = porId[r.pergunta_id]
        var resp = p.tipo === 'YES_NO' ? (['Sim', 'Não'].indexOf(r.resposta) !== -1 ? r.resposta : '') : txt(r.descricao || r.resposta, 1000)
        var desc = txt(r.descricao, 1000)
        if (!resp && !desc) continue
        await client.execute({
            sql: "INSERT INTO anamnese_respostas(clinica_id,paciente_id,pergunta_id,pergunta_texto,resposta,descricao,data_preenchimento,preenchido_por) VALUES(?,?,?,?,?,?,?,?)",
            args: [cid, pacienteId, p.id, p.pergunta, resp, desc, agoraCG(), quem]
        })
    }
    return lista.length
}

async function excedeu(client, ip, chave) {
    await client.execute({ sql: "DELETE FROM publico_tentativas WHERE criado_em < datetime('now','-1 day')", args: [] })
    var r = await client.execute({ sql: "SELECT COUNT(*) n FROM publico_tentativas WHERE ip=? AND chave=? AND criado_em >= datetime('now','-10 minutes')", args: [ip, chave] })
    return Number(r.rows[0].n) >= LIMITE[chave]
}
async function contar(client, ip, chave) { await client.execute({ sql: "INSERT INTO publico_tentativas(ip,chave) VALUES(?,?)", args: [ip, chave] }) }

// ════════════════════════════════════════════════════════════════
// SEM LOGIN
// ════════════════════════════════════════════════════════════════
async function handlePublico(ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }
    var acao = q.acao || b.acao, ip = ipDe(req)
    if (acao !== 'anamnese' && acao !== 'checkin') return json(400, { success: false, error: 'Ação inválida' })
    if (await excedeu(client, ip, acao)) return json(429, { success: false, error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' })

    if (acao === 'anamnese') {
        var t = q.t || b.t
        if (!tokenOk(t)) { await contar(client, ip, acao); return json(404, { success: false, error: 'Link inválido.' }) }
        var l = (await client.execute({
            sql: "SELECT l.*, p.nome paciente_nome, c.nome clinica_nome, c.logo clinica_logo FROM anamnese_links l JOIN pacientes p ON p.id=l.paciente_id AND p.clinica_id=l.clinica_id LEFT JOIN clinicas c ON c.id=l.clinica_id WHERE l.token=?",
            args: [t]
        })).rows[0]
        if (!l) { await contar(client, ip, acao); return json(404, { success: false, error: 'Link inválido.' }) }
        if (l.usado_em) return json(410, { success: false, error: 'Este questionário já foi respondido. Obrigado!' })
        if (String(l.expira_em) < agoraCG()) return json(410, { success: false, error: 'Este link expirou. Peça um novo à clínica.' })
        var base = { clinica: l.clinica_nome || 'Clínica', logo: l.clinica_logo || null, paciente: primeiroNome(l.paciente_nome) }
        if (req.method === 'GET') {
            var ps = await perguntas(client, l.clinica_id)
            return json(200, Object.assign({ success: true, perguntas: ps.map(function (p) { return { id: p.id, pergunta: p.pergunta, tipo: p.tipo } }) }, base))
        }
        if (!b.confirmo) return json(400, { success: false, error: 'Confirme que as informações são verdadeiras.' })
        // marca como usado antes de gravar: dois envios simultâneos não gravam duas vezes
        var marca = await client.execute({ sql: "UPDATE anamnese_links SET usado_em=? WHERE id=? AND usado_em IS NULL", args: [agoraCG(), l.id] })
        if (!marca.rowsAffected) return json(410, { success: false, error: 'Este questionário já foi respondido. Obrigado!' })
        var n = await gravarRespostas(client, l.clinica_id, l.paciente_id, b.respostas, 'Paciente (link)')
        return json(200, Object.assign({ success: true, respostas: n }, base))
    }

    // check-in
    var c = q.c || b.c
    if (!tokenOk(c)) { await contar(client, ip, acao); return json(404, { success: false, error: 'QR Code inválido.' }) }
    var cli = (await client.execute({ sql: "SELECT id, nome FROM clinicas WHERE checkin_token=?", args: [c] })).rows[0]
    if (!cli) { await contar(client, ip, acao); return json(404, { success: false, error: 'QR Code inválido. Procure a recepção.' }) }
    if (req.method === 'GET') return json(200, { success: true, clinica: cli.nome || 'Clínica' })

    await contar(client, ip, acao)
    var cpf = digitos(b.cpf), nasc = String(b.nascimento || ''), tel4 = digitos(b.telefone).slice(-4)
    var pac = []
    if (cpf.length === 11) {
        pac = (await client.execute({ sql: "SELECT id, nome FROM pacientes WHERE clinica_id=? AND REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','')=?", args: [cli.id, cpf] })).rows
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(nasc) && tel4.length === 4) {
        pac = (await client.execute({
            sql: "SELECT id, nome FROM pacientes WHERE clinica_id=? AND substr(data_nascimento,1,10)=? AND (substr(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(telefone,''),'(',''),')',''),'-',''),' ',''),-4)=? OR substr(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(whatsapp,''),'(',''),')',''),'-',''),' ',''),-4)=?)",
            args: [cli.id, nasc, tel4, tel4]
        })).rows
    } else return json(400, { success: false, error: 'Informe o CPF, ou a data de nascimento e os 4 últimos dígitos do telefone.' })
    if (!pac.length) return json(404, { success: false, error: 'Não encontramos seu cadastro. Procure a recepção.' })

    var hoje = agoraCG().slice(0, 10), ids = pac.map(function (p) { return p.id })
    var ags = (await client.execute({
        sql: "SELECT a.id, a.paciente_id, a.status, substr(a.data_hora,12,5) hora, COALESCE(pr.nome, a.profissional_nome) profissional FROM agendamentos a LEFT JOIN profissionais pr ON pr.id=a.profissional_id AND pr.clinica_id=a.clinica_id WHERE a.clinica_id=? AND DATE(a.data_hora)=? AND a.paciente_id IN (" + ids.map(function () { return '?' }).join(',') + ") AND COALESCE(a.status,'') NOT IN ('cancelado','desmarcado','faltou') ORDER BY a.data_hora",
        args: [cli.id, hoje].concat(ids)
    })).rows
    var nome = primeiroNome((pac.filter(function (p) { return ags[0] && p.id === ags[0].paciente_id })[0] || pac[0]).nome)
    if (!ags.length) return json(404, { success: false, error: nome + ', não encontramos consulta sua para hoje. Procure a recepção.' })
    // Mais de uma consulta no dia: vale a mais próxima do horário atual
    var agora = agoraCG().slice(11, 16), min = function (h) { return Number(String(h).slice(0, 2)) * 60 + Number(String(h).slice(3, 5)) }
    var ag = ags.filter(function (a) { return ['agendado', 'confirmado', 'nao_confirmado', 'atrasado', ''].indexOf(a.status || '') !== -1 })
        .sort(function (x, y) { return Math.abs(min(x.hora) - min(agora)) - Math.abs(min(y.hora) - min(agora)) })[0]
    if (!ag) return json(200, { success: true, ja: true, nome: nome, hora: ags[0].hora, profissional: ags[0].profissional || '' })
    await client.execute({ sql: "UPDATE agendamentos SET status='em_espera', chegada_em=?, atualizado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [agoraCG(), ag.id, cli.id] })
    return json(200, { success: true, nome: nome, hora: ag.hora, profissional: ag.profissional || '' })
}

// ════════════════════════════════════════════════════════════════
// COM LOGIN
// ════════════════════════════════════════════════════════════════
async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }
    var admin = auth && auth.perfil === 'admin'

    // Substitui a rota antiga: semeia as perguntas padrão quando a clínica não tem nenhuma
    if (route === 'anamnese-perguntas') return json(200, { success: true, perguntas: await perguntas(client, clinica_id) })

    if (route === 'anamnese-modelo') {
        if (req.method === 'GET') return json(200, { success: true, data: await perguntas(client, clinica_id), tipos: TIPOS_PERG })
        if (!admin) return json(403, { success: false, error: 'Apenas o administrador edita o questionário' })
        if (b.action === 'excluir') {
            var ex = await client.execute({ sql: "UPDATE anamnese_perguntas SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!ex.rowsAffected) return json(404, { success: false, error: 'Pergunta não encontrada' })
            return json(200, { success: true })
        }
        if (b.action === 'ordenar') {
            var ids = Array.isArray(b.ids) ? b.ids : []
            for (var i = 0; i < ids.length; i++) await client.execute({ sql: "UPDATE anamnese_perguntas SET sequencia=? WHERE id=? AND clinica_id=?", args: [i + 1, ids[i], clinica_id] })
            return json(200, { success: true })
        }
        var pg = txt(b.pergunta, 300), tp = TIPOS_PERG.indexOf(b.tipo) !== -1 ? b.tipo : 'YES_NO', al = b.alerta ? 1 : 0
        if (!pg) return json(400, { success: false, error: 'Escreva a pergunta' })
        if (b.id) {
            var up = await client.execute({ sql: "UPDATE anamnese_perguntas SET pergunta=?,tipo=?,alerta=? WHERE id=? AND clinica_id=? AND ativo=1", args: [pg, tp, al, b.id, clinica_id] })
            if (!up.rowsAffected) return json(404, { success: false, error: 'Pergunta não encontrada' })
            return json(200, { success: true, id: Number(b.id) })
        }
        await perguntas(client, clinica_id) // garante a semente antes da primeira pergunta nova
        var mx = await client.execute({ sql: "SELECT COALESCE(MAX(sequencia),0) m FROM anamnese_perguntas WHERE clinica_id=? AND ativo=1", args: [clinica_id] })
        var ins = await client.execute({ sql: "INSERT INTO anamnese_perguntas(clinica_id,pergunta,tipo,sequencia,alerta) VALUES(?,?,?,?,?)", args: [clinica_id, pg, tp, Number(mx.rows[0].m) + 1, al] })
        return json(200, { success: true, id: Number(ins.lastInsertRowid) })
    }

    // Respostas da equipe passam pela mesma validação do link
    if (route === 'salvar-anamnese') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var pid = parseInt(b.paciente_id) || 0
        var okp = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [pid, clinica_id] })).rows[0]
        if (!okp) return json(404, { success: false, error: 'Paciente não encontrado' })
        var n = await gravarRespostas(client, clinica_id, pid, b.respostas, auth.nome || 'Equipe')
        return json(200, { success: true, salvos: n })
    }

    if (route === 'anamnese-link') {
        var pac = (await client.execute({ sql: "SELECT id, nome, COALESCE(NULLIF(whatsapp,''), telefone) fone FROM pacientes WHERE id=? AND clinica_id=?", args: [q.paciente_id || b.paciente_id, clinica_id] })).rows[0]
        if (!pac) return json(404, { success: false, error: 'Paciente não encontrado' })
        if (req.method === 'GET') {
            var ls = await client.execute({ sql: "SELECT id, criado_em, expira_em, usado_em, criado_por_nome FROM anamnese_links WHERE paciente_id=? AND clinica_id=? ORDER BY id DESC LIMIT 10", args: [pac.id, clinica_id] })
            return json(200, { success: true, data: ls.rows })
        }
        var tk = token(), exp = new Date(Date.now() - 4 * 3600 * 1000 + LINK_DIAS * 86400000).toISOString().replace('T', ' ').slice(0, 19)
        // um link aberto por paciente: o novo invalida os anteriores
        await client.execute({ sql: "UPDATE anamnese_links SET expira_em='2000-01-01 00:00:00' WHERE paciente_id=? AND clinica_id=? AND usado_em IS NULL", args: [pac.id, clinica_id] })
        await client.execute({ sql: "INSERT INTO anamnese_links(clinica_id,paciente_id,token,criado_por_nome,expira_em) VALUES(?,?,?,?,?)", args: [clinica_id, pac.id, tk, auth.nome || null, exp] })
        return json(200, { success: true, caminho: '/anamnese?t=' + tk, expira_em: exp, telefone: pac.fone || '', paciente: pac.nome })
    }

    if (route === 'checkin-config') {
        var cl = (await client.execute({ sql: "SELECT id, nome, checkin_token FROM clinicas WHERE id=?", args: [clinica_id] })).rows[0]
        if (!cl) return json(404, { success: false, error: 'Clínica não encontrada' })
        var tkc = cl.checkin_token
        if (req.method === 'POST' && b.action === 'renovar') {
            if (!admin) return json(403, { success: false, error: 'Apenas o administrador gera um novo QR Code' })
            tkc = null
        }
        if (!tkc) { tkc = token(); await client.execute({ sql: "UPDATE clinicas SET checkin_token=? WHERE id=?", args: [tkc, clinica_id] }) }
        var hoje = agoraCG().slice(0, 10)
        var chegadas = await client.execute({
            sql: "SELECT a.id, a.paciente_nome, substr(a.data_hora,12,5) hora, substr(a.chegada_em,12,5) chegada, a.status, COALESCE(pr.nome,a.profissional_nome) profissional FROM agendamentos a LEFT JOIN profissionais pr ON pr.id=a.profissional_id AND pr.clinica_id=a.clinica_id WHERE a.clinica_id=? AND a.chegada_em IS NOT NULL AND substr(a.chegada_em,1,10)=? ORDER BY a.chegada_em DESC",
            args: [clinica_id, hoje]
        })
        return json(200, { success: true, caminho: '/checkin?c=' + tkc, clinica: cl.nome || '', chegadas: chegadas.rows })
    }

    if (route === 'medicamentos') {
        if (req.method === 'GET') {
            var tot = await client.execute({ sql: "SELECT COUNT(*) n FROM medicamentos WHERE clinica_id=?", args: [clinica_id] })
            if (!Number(tot.rows[0].n)) {
                for (var m = 0; m < MEDICAMENTOS_PADRAO.length; m++) {
                    var md = MEDICAMENTOS_PADRAO[m]
                    await client.execute({ sql: "INSERT INTO medicamentos(clinica_id,nome,apresentacao,quantidade,posologia,uso) VALUES(?,?,?,?,?,?)", args: [clinica_id].concat(md) })
                }
            }
            var w = ["clinica_id=?", "ativo=1"], a = [clinica_id]
            if (q.q) { w.push("nome LIKE ?"); a.push('%' + txt(q.q, 60) + '%') }
            var ms = await client.execute({ sql: "SELECT id,nome,apresentacao,quantidade,posologia,uso FROM medicamentos WHERE " + w.join(' AND ') + " ORDER BY nome", args: a })
            return json(200, { success: true, data: ms.rows })
        }
        if (b.action === 'excluir') {
            var mx2 = await client.execute({ sql: "UPDATE medicamentos SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!mx2.rowsAffected) return json(404, { success: false, error: 'Medicamento não encontrado' })
            return json(200, { success: true })
        }
        var nm = txt(b.nome, 160), uso = b.uso === 'externo' ? 'externo' : 'interno'
        if (!nm) return json(400, { success: false, error: 'Informe o nome do medicamento' })
        var vals = [nm, txt(b.apresentacao, 80), txt(b.quantidade, 80), txt(b.posologia, 500), uso]
        if (b.id) {
            var um = await client.execute({ sql: "UPDATE medicamentos SET nome=?,apresentacao=?,quantidade=?,posologia=?,uso=? WHERE id=? AND clinica_id=? AND ativo=1", args: vals.concat([b.id, clinica_id]) })
            if (!um.rowsAffected) return json(404, { success: false, error: 'Medicamento não encontrado' })
            return json(200, { success: true, id: Number(b.id) })
        }
        var im = await client.execute({ sql: "INSERT INTO medicamentos(clinica_id,nome,apresentacao,quantidade,posologia,uso) VALUES(?,?,?,?,?,?)", args: [clinica_id].concat(vals) })
        return json(200, { success: true, id: Number(im.lastInsertRowid) })
    }

    return false
}

module.exports = { handle, handlePublico, PERGUNTAS_PADRAO, MEDICAMENTOS_PADRAO }
