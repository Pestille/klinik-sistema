// lib/rotas/assinaturas.js — Assinatura eletrônica do paciente por link (Fase pós-auditoria, lote 2)
// Klinov — Campo Grande, MS
//
// A equipe pede a assinatura de um documento emitido, evolução, procedimento
// executado ou da anamnese. O sistema congela uma cópia do conteúdo (com hash
// SHA-256) e gera um link de uso único. O paciente confirma a identidade
// (data de nascimento ou início do CPF), desenha a assinatura e aceita o termo.
// Ficam guardados: data e hora, IP, navegador, nome digitado, imagem e hash.
//
//   handle(route, ctx)        assinatura-solicitar, assinaturas, assinatura-cancelar (com login)
//   handlePublico(ctx)        ?r=publico&acao=assinar (sem login, só pelo token)

var crypto = require('crypto')
var { pode } = require('../permissoes')

var TIPOS = {
    documento: { perm: 'pacientes.documentos', rotulo: 'Documento' },
    evolucao: { perm: 'pacientes.prontuario', rotulo: 'Evolução clínica' },
    procedimento: { perm: 'pacientes.prontuario', rotulo: 'Procedimento executado' },
    anamnese: { perm: 'pacientes.anamnese', rotulo: 'Anamnese' }
}
var DIAS = 7, MAX_ERROS = 5, LIMITE_IP = 30

function agoraCG() { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
function sha(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex') }
function digitos(v) { return String(v || '').replace(/\D/g, '') }
function primeiroNome(n) { var p = String(n || '').trim().split(/\s+/)[0] || ''; return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() }
function ipDe(req) { var h = req.headers || {}; return String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim().slice(0, 64) || 'local' }

// Cópia congelada do que será assinado. Devolve null se não pertence à clínica.
async function snapshot(client, cid, tipo, refId) {
    if (tipo === 'documento') {
        var d = (await client.execute({ sql: "SELECT paciente_id, titulo, conteudo FROM documentos_emitidos WHERE id=? AND clinica_id=?", args: [refId, cid] })).rows[0]
        return d ? { paciente_id: d.paciente_id, titulo: d.titulo, conteudo: d.conteudo } : null
    }
    if (tipo === 'evolucao') {
        var e = (await client.execute({ sql: "SELECT paciente_id, data, dente, texto, autor_nome FROM prontuario_evolucoes WHERE id=? AND clinica_id=?", args: [refId, cid] })).rows[0]
        return e ? { paciente_id: e.paciente_id, titulo: 'Evolução clínica de ' + br(e.data), conteudo: '<p><b>Data:</b> ' + br(e.data) + (e.dente ? ' · <b>Dente/região:</b> ' + esc(e.dente) : '') + (e.autor_nome ? ' · <b>Registrado por:</b> ' + esc(e.autor_nome) : '') + '</p><p>' + esc(e.texto).replace(/\n/g, '<br>') + '</p>' } : null
    }
    if (tipo === 'procedimento') {
        var p = (await client.execute({ sql: "SELECT o.paciente_id, oi.procedimento_nome, oi.dente, oi.regiao, oi.faces, oi.profissional_nome, oi.data_execucao, oi.executado FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id WHERE oi.id=? AND oi.clinica_id=?", args: [refId, cid] }).catch(function () { return client.execute({ sql: "SELECT o.paciente_id, oi.procedimento_nome, oi.dente, oi.regiao, oi.profissional_nome, oi.data_execucao, oi.executado FROM orcamento_itens oi JOIN orcamentos o ON o.id=oi.orcamento_id AND o.clinica_id=oi.clinica_id WHERE oi.id=? AND oi.clinica_id=?", args: [refId, cid] }) })).rows[0]
        if (!p) return null
        if (!Number(p.executado)) return { erro: 'Só é possível pedir assinatura de procedimento já executado.' }
        return { paciente_id: p.paciente_id, titulo: 'Procedimento executado: ' + (p.procedimento_nome || ''), conteudo: '<p>Declaro que o procedimento abaixo foi realizado.</p><p><b>Procedimento:</b> ' + esc(p.procedimento_nome) + '<br><b>Dente/região:</b> ' + esc([p.dente, p.faces ? '(' + p.faces + ')' : '', p.regiao].filter(Boolean).join(' ') || '—') + '<br><b>Executado em:</b> ' + br(p.data_execucao) + '<br><b>Profissional:</b> ' + esc(p.profissional_nome || '—') + '</p>' }
    }
    if (tipo === 'anamnese') {
        var pac = (await client.execute({ sql: "SELECT id FROM pacientes WHERE id=? AND clinica_id=?", args: [refId, cid] })).rows[0]
        if (!pac) return null
        var rs = (await client.execute({ sql: "SELECT pergunta_texto, resposta, descricao, data_preenchimento FROM anamnese_respostas WHERE paciente_id=? AND clinica_id=? ORDER BY pergunta_id", args: [refId, cid] })).rows
        if (!rs.length) return { erro: 'A anamnese ainda não foi preenchida.' }
        return { paciente_id: pac.id, titulo: 'Anamnese', conteudo: '<p>Declaro que as respostas abaixo são verdadeiras.</p><ol>' + rs.map(function (r) { var resp = r.resposta && r.resposta !== r.descricao ? r.resposta : ''; return '<li><b>' + esc(r.pergunta_texto) + '</b><br>' + esc([resp, r.descricao].filter(Boolean).join(' — ') || '—') + '</li>' }).join('') + '</ol>' }
    }
    return null
}

function publicaAssinatura(a) {
    return { id: a.id, tipo: a.tipo, ref_id: a.ref_id, titulo: a.titulo, status: a.status, criado_em: a.criado_em, criado_por: a.criado_por_nome, expira_em: a.expira_em,
        assinado_em: a.assinado_em, assinatura_nome: a.assinatura_nome, assinatura_img: a.assinatura_img, ip: a.ip, navegador: a.user_agent, hash: a.conteudo_hash, verificacao: a.verificacao }
}

// ════════════════════════════════════════════════════════════════
// COM LOGIN
// ════════════════════════════════════════════════════════════════
async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }

    if (route === 'assinaturas') {
        var w = ["clinica_id=?"], a = [clinica_id]
        if (q.paciente_id) { w.push("paciente_id=?"); a.push(q.paciente_id) }
        if (q.tipo && TIPOS[q.tipo]) { w.push("tipo=?"); a.push(q.tipo) }
        if (q.ref_id) { w.push("ref_id=?"); a.push(q.ref_id) }
        if (!q.paciente_id && !q.ref_id) return json(400, { success: false, error: 'Informe o paciente' })
        var rows = await client.execute({ sql: "SELECT * FROM assinaturas WHERE " + w.join(' AND ') + " AND status<>'cancelado' ORDER BY id DESC LIMIT 300", args: a })
        var hoje = agoraCG()
        return json(200, { success: true, data: rows.rows.map(function (r) { var x = publicaAssinatura(r); if (x.status === 'pendente' && String(r.expira_em) < hoje) x.status = 'expirado'; if (q.sem_imagem) delete x.assinatura_img; return x }) })
    }

    if (route === 'assinatura-solicitar') {
        var t = TIPOS[b.tipo]
        if (!t) return json(400, { success: false, error: 'Tipo inválido' })
        if (!await pode(client, auth, t.perm)) return json(403, { success: false, error: 'Seu perfil não tem permissão para esta ação' })
        var snap = await snapshot(client, clinica_id, b.tipo, b.ref_id)
        if (!snap) return json(404, { success: false, error: 'Registro não encontrado' })
        if (snap.erro) return json(400, { success: false, error: snap.erro })
        var ja = (await client.execute({ sql: "SELECT id FROM assinaturas WHERE clinica_id=? AND tipo=? AND ref_id=? AND status='assinado'", args: [clinica_id, b.tipo, b.ref_id] })).rows[0]
        if (ja && !b.nova) return json(409, { success: false, error: 'Este registro já foi assinado pelo paciente.', assinatura_id: ja.id })
        await client.execute({ sql: "UPDATE assinaturas SET status='cancelado' WHERE clinica_id=? AND tipo=? AND ref_id=? AND status='pendente'", args: [clinica_id, b.tipo, b.ref_id] })
        var pac = (await client.execute({ sql: "SELECT nome, COALESCE(NULLIF(whatsapp,''), telefone) fone FROM pacientes WHERE id=? AND clinica_id=?", args: [snap.paciente_id, clinica_id] })).rows[0] || {}
        var tk = crypto.randomBytes(24).toString('hex')
        var exp = new Date(Date.now() - 4 * 3600 * 1000 + DIAS * 86400000).toISOString().replace('T', ' ').slice(0, 19)
        var ins = await client.execute({
            sql: "INSERT INTO assinaturas(clinica_id,paciente_id,tipo,ref_id,titulo,conteudo,conteudo_hash,token,status,criado_por_nome,criado_em,expira_em) VALUES(?,?,?,?,?,?,?,?,'pendente',?,?,?)",
            args: [clinica_id, snap.paciente_id, b.tipo, b.ref_id, snap.titulo, snap.conteudo, sha(snap.titulo + '\n' + snap.conteudo), tk, auth.nome || null, agoraCG(), exp]
        })
        return json(200, { success: true, id: Number(ins.lastInsertRowid), caminho: '/assinar?t=' + tk, expira_em: exp, paciente: pac.nome || '', telefone: pac.fone || '' })
    }

    if (route === 'assinatura-cancelar') {
        var c = await client.execute({ sql: "UPDATE assinaturas SET status='cancelado' WHERE id=? AND clinica_id=? AND status='pendente'", args: [b.id, clinica_id] })
        if (!c.rowsAffected) return json(404, { success: false, error: 'Pedido de assinatura não encontrado ou já assinado' })
        return json(200, { success: true })
    }

    return false
}

// ════════════════════════════════════════════════════════════════
// SEM LOGIN (?r=publico&acao=assinar)
// ════════════════════════════════════════════════════════════════
async function handlePublico(ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client
    var b = req.body || {}
    function json(s, o) { res.status(s).json(o); return true }
    var ip = ipDe(req)
    await client.execute({ sql: "DELETE FROM publico_tentativas WHERE criado_em < datetime('now','-1 day')", args: [] })
    var nt = (await client.execute({ sql: "SELECT COUNT(*) n FROM publico_tentativas WHERE ip=? AND chave='assinar' AND criado_em >= datetime('now','-10 minutes')", args: [ip] })).rows[0]
    if (Number(nt.n) >= LIMITE_IP) return json(429, { success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' })
    async function falhou() { await client.execute({ sql: "INSERT INTO publico_tentativas(ip,chave) VALUES(?, 'assinar')", args: [ip] }) }

    var t = String(q.t || b.t || '')
    if (!/^[a-f0-9]{48}$/.test(t)) { await falhou(); return json(404, { success: false, error: 'Link inválido.' }) }
    var a = (await client.execute({ sql: "SELECT a.*, p.nome paciente_nome, p.data_nascimento, p.cpf, c.nome clinica_nome FROM assinaturas a JOIN pacientes p ON p.id=a.paciente_id AND p.clinica_id=a.clinica_id LEFT JOIN clinicas c ON c.id=a.clinica_id WHERE a.token=?", args: [t] })).rows[0]
    if (!a) { await falhou(); return json(404, { success: false, error: 'Link inválido.' }) }
    if (a.status === 'assinado') return json(410, { success: false, error: 'Este documento já foi assinado. Obrigado!' })
    if (a.status !== 'pendente') return json(410, { success: false, error: 'Este pedido de assinatura foi cancelado. Peça um novo link à clínica.' })
    if (String(a.expira_em) < agoraCG()) return json(410, { success: false, error: 'Este link expirou. Peça um novo à clínica.' })

    var nasc = String(a.data_nascimento || '').slice(0, 10), cpf = digitos(a.cpf)
    var conferir = /^\d{4}-\d{2}-\d{2}$/.test(nasc) ? 'nascimento' : (cpf.length === 11 ? 'cpf' : 'nenhum')
    var base = { clinica: a.clinica_nome || 'Clínica', paciente: primeiroNome(a.paciente_nome), titulo: a.titulo, conferir: conferir }
    if (req.method === 'GET') return json(200, Object.assign({ success: true }, base))

    // Toda ação POST confere a identidade antes de mostrar ou gravar
    var ok = conferir === 'nenhum' || (conferir === 'nascimento' ? String(b.nascimento || '') === nasc : digitos(b.cpf_inicio).slice(0, 3) === cpf.slice(0, 3) && digitos(b.cpf_inicio).length >= 3)
    if (!ok) {
        await falhou()
        var erros = Number(a.tentativas || 0) + 1
        await client.execute({ sql: "UPDATE assinaturas SET tentativas=?" + (erros >= MAX_ERROS ? ", status='cancelado'" : "") + " WHERE id=?", args: [erros, a.id] })
        if (erros >= MAX_ERROS) return json(410, { success: false, error: 'Dados não conferem. Por segurança, este link foi cancelado; peça um novo à clínica.' })
        return json(403, { success: false, error: conferir === 'nascimento' ? 'A data de nascimento não confere com o cadastro.' : 'Os números do CPF não conferem com o cadastro.', restantes: MAX_ERROS - erros })
    }
    if (b.etapa === 'ver') return json(200, Object.assign({ success: true, conteudo: a.conteudo, hash: a.conteudo_hash }, base))

    // Assinar
    var nome = String(b.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    var img = String(b.imagem || '')
    if (nome.split(' ').length < 2) return json(400, { success: false, error: 'Digite seu nome completo.' })
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 300000) return json(400, { success: false, error: 'Desenhe sua assinatura no quadro.' })
    if (!b.aceite) return json(400, { success: false, error: 'Confirme que leu e concorda com o documento.' })
    if (b.hash && b.hash !== a.conteudo_hash) return json(409, { success: false, error: 'O documento mudou desde que você abriu. Recarregue a página.' })
    var quando = agoraCG()
    var verif = sha([a.conteudo_hash, nome, quando, ip, a.id].join('|')).slice(0, 16).toUpperCase()
    var up = await client.execute({
        sql: "UPDATE assinaturas SET status='assinado', assinado_em=?, assinatura_nome=?, assinatura_img=?, ip=?, user_agent=?, verificacao=? WHERE id=? AND status='pendente'",
        args: [quando, nome, img, ip, String((req.headers || {})['user-agent'] || '').slice(0, 300), verif, a.id]
    })
    if (!up.rowsAffected) return json(410, { success: false, error: 'Este documento já foi assinado. Obrigado!' })
    return json(200, { success: true, assinado_em: quando, verificacao: verif, paciente: base.paciente, clinica: base.clinica })
}

module.exports = { handle, handlePublico, snapshot, TIPOS }
