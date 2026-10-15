// lib/rotas/pacientes.js — Paciente e prontuário (Fase 3)
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.

var { moverParaLixeira } = require('../lixeira')

var DATA_RE = /^\d{4}-\d{2}-\d{2}$/
var TIPOS_DOC = ['atestado', 'receituario', 'declaracao', 'contrato', 'termo', 'orientacao', 'solicitacao', 'outro']

// Campos editáveis do cadastro (nome da coluna = nome no body)
var CAMPOS = ['nome', 'apelido', 'cpf', 'rg', 'data_nascimento', 'sexo', 'estado_civil', 'telefone', 'whatsapp', 'fone_fixo', 'email', 'sem_email',
    'como_conheceu', 'indicado_por_id', 'indicado_por_nome', 'observacoes', 'alerta_medico', 'convenio', 'numero_convenio',
    'cep', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
    'profissao', 'local_trabalho', 'pai', 'mae', 'responsavel_nome', 'responsavel_cpf']

// Modelos iniciais (textos próprios do Klinov). Variáveis: {{paciente.*}}, {{clinica.*}},
// {{profissional.*}}, {{data}}, {{data_extenso}}, {{hora}}
var MODELOS_PADRAO = [
    ['Atestado odontológico', 'atestado',
        '<h2 style="text-align:center">ATESTADO</h2><p>Atesto, para os devidos fins, que <b>{{paciente.nome}}</b>, CPF {{paciente.cpf}}, esteve sob meus cuidados profissionais em {{data}}, das ____ às ____ horas, devendo permanecer afastado(a) de suas atividades por ____ dia(s).</p><p>CID: ______</p>'],
    ['Declaração de comparecimento', 'declaracao',
        '<h2 style="text-align:center">DECLARAÇÃO DE COMPARECIMENTO</h2><p>Declaro que <b>{{paciente.nome}}</b> compareceu a esta clínica em {{data}}, no período das ____ às ____ horas, para atendimento odontológico.</p>'],
    ['Receituário simples', 'receituario',
        '<h2 style="text-align:center">RECEITUÁRIO</h2><p><b>Paciente:</b> {{paciente.nome}}</p><p><b>Uso:</b> ________</p><ol><li>&nbsp;</li><li>&nbsp;</li></ol>'],
    ['Orientações pós-operatórias', 'orientacao',
        '<h2 style="text-align:center">ORIENTAÇÕES APÓS O PROCEDIMENTO</h2><p>Paciente: <b>{{paciente.nome}}</b></p><ul><li>Mantenha a compressa de gaze por 30 minutos.</li><li>Evite bochechos, alimentos quentes e esforço físico nas primeiras 24 horas.</li><li>Aplique gelo na face, por 15 minutos, a cada hora, no primeiro dia.</li><li>Tome a medicação conforme a receita.</li><li>Em caso de sangramento persistente, febre ou dor intensa, entre em contato com a clínica pelo telefone {{clinica.telefone}}.</li></ul>'],
    ['Termo de consentimento', 'termo',
        '<h2 style="text-align:center">TERMO DE CONSENTIMENTO PARA TRATAMENTO</h2><p>Eu, <b>{{paciente.nome}}</b>, CPF {{paciente.cpf}}, declaro que fui informado(a) de forma clara sobre o diagnóstico, o plano de tratamento proposto, as alternativas, os riscos, os cuidados necessários e o custo estimado, e que tive a oportunidade de esclarecer minhas dúvidas.</p><p>Autorizo {{profissional.nome}} (CRO {{profissional.cro}}) e a equipe de {{clinica.nome}} a realizar o tratamento descrito: ____________________.</p>'],
    ['Contrato de prestação de serviços', 'contrato',
        '<h2 style="text-align:center">CONTRATO DE PRESTAÇÃO DE SERVIÇOS ODONTOLÓGICOS</h2><p><b>CONTRATADA:</b> {{clinica.razao_social}}, CNPJ {{clinica.cnpj}}, com endereço em {{clinica.endereco}}.</p><p><b>CONTRATANTE:</b> {{paciente.nome}}, CPF {{paciente.cpf}}, residente em {{paciente.endereco_completo}}.</p><p><b>1. Objeto.</b> Prestação dos serviços odontológicos descritos no orçamento aprovado pelo CONTRATANTE.</p><p><b>2. Valor e pagamento.</b> Conforme o orçamento aprovado e a forma de pagamento escolhida.</p><p><b>3. Obrigações.</b> O CONTRATANTE compromete-se a comparecer às consultas e seguir as orientações; a CONTRATADA, a executar os serviços com zelo técnico.</p><p><b>4. Foro.</b> Fica eleito o foro da comarca de {{clinica.cidade}}.</p>'],
    ['Solicitação de exame radiográfico', 'solicitacao',
        '<h2 style="text-align:center">SOLICITAÇÃO DE EXAME</h2><p>Paciente: <b>{{paciente.nome}}</b> — Nascimento: {{paciente.data_nascimento}}</p><p>Solicito: ☐ Radiografia panorâmica ☐ Periapical(is) ☐ Tomografia ☐ Documentação ortodôntica</p><p>Região/dentes: ________</p>']
]

var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function br(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d }
// Código de validação impresso no documento (consulta pública em /validador)
var ALFA_COD = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function novoCodigo() { var b = require('crypto').randomBytes(12), s = ''; for (var i = 0; i < 12; i++) s += ALFA_COD[b[i] % ALFA_COD.length]; return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8) }
async function gravarCodigo(client, cid, id) {
    for (var t = 0; t < 5; t++) {
        var c = novoCodigo()
        try { await client.execute({ sql: "UPDATE documentos_emitidos SET codigo_validacao=? WHERE id=? AND clinica_id=? AND codigo_validacao IS NULL", args: [c, id, cid] }); return c }
        catch (e) { if (!/unique/i.test(e.message || '')) throw e }
    }
    return null
}
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// Limpeza mínima do HTML salvo (o documento é aberto para impressão dentro do app)
function sanitizar(html) {
    return String(html || '')
        .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?(<\/\s*\1\s*>|$)/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
        .slice(0, 200000)
}

async function modelos(client, clinica_id) {
    var r = await client.execute({ sql: "SELECT id,nome,tipo,conteudo FROM documento_modelos WHERE clinica_id=? AND ativo=1 ORDER BY tipo,nome", args: [clinica_id] })
    if (r.rows.length) return r.rows
    var existe = await client.execute({ sql: "SELECT COUNT(*) n FROM documento_modelos WHERE clinica_id=?", args: [clinica_id] })
    if (existe.rows[0].n > 0) return []
    for (var i = 0; i < MODELOS_PADRAO.length; i++) {
        await client.execute({ sql: "INSERT INTO documento_modelos(clinica_id,nome,tipo,conteudo) VALUES(?,?,?,?)", args: [clinica_id, MODELOS_PADRAO[i][0], MODELOS_PADRAO[i][1], MODELOS_PADRAO[i][2]] })
    }
    return (await client.execute({ sql: "SELECT id,nome,tipo,conteudo FROM documento_modelos WHERE clinica_id=? AND ativo=1 ORDER BY tipo,nome", args: [clinica_id] })).rows
}

async function pacienteDaClinica(client, clinica_id, id) {
    var r = await client.execute({ sql: "SELECT * FROM pacientes WHERE id=? AND clinica_id=?", args: [id, clinica_id] })
    return r.rows[0] || null
}

async function tenta(client, sql, args, padrao) {
    try { return (await client.execute({ sql: sql, args: args })).rows } catch (e) { return padrao || [] }
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }

    // ── Lista paginada ────────────────────────────────────────────
    if (route === 'pacientes-lista') {
        var w = ["p.clinica_id=?"], a = [clinica_id]
        var termo = String(q.q || '').trim()
        if (termo) {
            var dig = termo.replace(/\D/g, '')
            if (termo.charAt(0) === '%') { w.push("p.nome LIKE ?"); a.push('%' + termo.slice(1) + '%') }
            else if (dig.length >= 3 && dig.length === termo.replace(/[\s.\-()/]/g, '').length) { w.push("(REPLACE(REPLACE(REPLACE(p.cpf,'.',''),'-',''),' ','') LIKE ? OR REPLACE(REPLACE(REPLACE(REPLACE(p.telefone,' ',''),'-',''),'(',''),')','') LIKE ?)"); a.push('%' + dig + '%', '%' + dig + '%') }
            else { w.push("p.nome LIKE ?"); a.push(termo + '%') }
        }
        if (q.status === 'inativo') w.push("p.ativo=0")
        else if (q.status !== 'todos') w.push("(p.ativo=1 OR p.ativo IS NULL)")
        if (q.como_conheceu) { w.push("p.como_conheceu=?"); a.push(q.como_conheceu) }
        var lim = Math.min(Math.max(parseInt(q.limit, 10) || 25, 5), 100)
        var pag = Math.max(parseInt(q.pagina, 10) || 1, 1)
        var where = " WHERE " + w.join(' AND ')
        var tot = await client.execute({ sql: "SELECT COUNT(*) n FROM pacientes p" + where, args: a })
        var rows = await client.execute({
            sql: "SELECT p.id,p.nome,p.telefone,p.whatsapp,p.email,p.data_nascimento,p.como_conheceu,p.ativo,p.foto_url,p.cpf FROM pacientes p" + where + " ORDER BY p.nome LIMIT ? OFFSET ?",
            args: a.concat([lim, (pag - 1) * lim])
        })
        return json(200, { success: true, data: rows.rows, total: Number(tot.rows[0].n), pagina: pag, limite: lim })
    }

    // ── Criar / atualizar cadastro completo ───────────────────────
    if (route === 'paciente-salvar') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var nome = String(b.nome || '').trim().toUpperCase()
        if (!nome) return json(400, { success: false, error: 'Nome obrigatório' })
        b.nome = nome
        if (b.cpf) {
            var cpfDig = String(b.cpf).replace(/\D/g, '')
            if (cpfDig.length !== 11) return json(400, { success: false, error: 'CPF inválido' })
            var dup = await client.execute({ sql: "SELECT id,nome FROM pacientes WHERE clinica_id=? AND REPLACE(REPLACE(cpf,'.',''),'-','')=? AND id<>?", args: [clinica_id, cpfDig, b.id || 0] })
            if (dup.rows.length) return json(409, { success: false, error: 'Já existe paciente com este CPF: ' + dup.rows[0].nome, paciente_id: dup.rows[0].id })
        }
        if (b.data_nascimento && !DATA_RE.test(b.data_nascimento)) return json(400, { success: false, error: 'Data de nascimento inválida' })
        if (b.indicado_por_id) {
            var ind = await pacienteDaClinica(client, clinica_id, b.indicado_por_id)
            if (!ind || Number(b.indicado_por_id) === Number(b.id)) return json(400, { success: false, error: 'Paciente indicador inválido' })
            b.indicado_por_nome = ind.nome
        }
        var cols = CAMPOS.filter(function(c) { return c in b })
        var vals = cols.map(function(c) {
            var v = b[c]
            if (c === 'sem_email') return v ? 1 : 0
            if (c === 'indicado_por_id') return v ? Number(v) : null
            return v == null ? '' : String(v).slice(0, c === 'observacoes' || c === 'alerta_medico' ? 2000 : 200)
        })
        if (b.id) {
            if (!await pacienteDaClinica(client, clinica_id, b.id)) return json(404, { success: false, error: 'Paciente não encontrado' })
            await client.execute({ sql: "UPDATE pacientes SET " + cols.map(function(c) { return c + '=?' }).join(',') + " WHERE id=? AND clinica_id=?", args: vals.concat([b.id, clinica_id]) })
            return json(200, { success: true, id: Number(b.id) })
        }
        var ins = await client.execute({
            sql: "INSERT INTO pacientes(" + cols.concat(['ativo', 'clinica_id', 'criado_em']).join(',') + ") VALUES(" + cols.map(function() { return '?' }).concat(['1', '?', "datetime('now')"]).join(',') + ")",
            args: vals.concat([clinica_id])
        })
        return json(200, { success: true, id: Number(ins.lastInsertRowid) })
    }

    // ── Ativar / inativar ─────────────────────────────────────────
    if (route === 'paciente-status') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var ativo = b.ativo ? 1 : 0
        var up = await client.execute({ sql: "UPDATE pacientes SET ativo=?,inativado_em=" + (ativo ? "NULL" : "datetime('now')") + " WHERE id=? AND clinica_id=?", args: [ativo, b.id, clinica_id] })
        if (!up.rowsAffected) return json(404, { success: false, error: 'Paciente não encontrado' })
        return json(200, { success: true })
    }

    // ── Excluir (só sem histórico; vai para a lixeira) ────────────
    if (route === 'excluir-paciente') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (!await pacienteDaClinica(client, clinica_id, b.id)) return json(404, { success: false, error: 'Paciente não encontrado' })
        var hist = 0
        var checks = ["SELECT COUNT(*) n FROM agendamentos WHERE paciente_id=? AND clinica_id=?", "SELECT COUNT(*) n FROM orcamentos WHERE paciente_id=? AND clinica_id=?",
            "SELECT COUNT(*) n FROM pagamentos WHERE paciente_id=? AND clinica_id=?", "SELECT COUNT(*) n FROM parcelas_orcamento WHERE paciente_id=? AND clinica_id=?",
            "SELECT COUNT(*) n FROM prontuario_evolucoes WHERE paciente_id=? AND clinica_id=?"]
        for (var i = 0; i < checks.length; i++) { var rr = await tenta(client, checks[i], [b.id, clinica_id], [{ n: 0 }]); hist += Number(rr[0].n) }
        if (hist > 0) return json(409, { success: false, error: 'Este paciente tem agendamentos, orçamentos, pagamentos ou evolução registrados. Inative o cadastro em vez de excluir.' })
        await moverParaLixeira(client, auth, 'paciente', b.id)
        return json(200, { success: true })
    }

    // ── Resumo da Visão Geral ─────────────────────────────────────
    if (route === 'paciente-resumo') {
        var pid = parseInt(q.id, 10) || 0
        var pac = await pacienteDaClinica(client, clinica_id, pid)
        if (!pac) return json(404, { success: false, error: 'Paciente não encontrado' })
        var agora = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') // horário de Campo Grande
        var hoje = agora.slice(0, 10)
        var r = await Promise.all([
            tenta(client, "SELECT a.id,a.data_hora,a.hora_fim,a.status,a.tipo,COALESCE(pr.nome,a.profissional_nome) profissional_nome FROM agendamentos a LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.paciente_id=? AND a.clinica_id=? AND a.data_hora>=? AND COALESCE(a.status,'') NOT IN ('cancelado','desmarcado') ORDER BY a.data_hora LIMIT 3", [pid, clinica_id, agora]),
            tenta(client, "SELECT a.data_hora,COALESCE(pr.nome,a.profissional_nome) profissional_nome FROM agendamentos a LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.paciente_id=? AND a.clinica_id=? AND a.data_hora<? AND COALESCE(a.status,'') NOT IN ('cancelado','desmarcado','faltou') ORDER BY a.data_hora DESC LIMIT 1", [pid, clinica_id, agora]),
            tenta(client, "SELECT COUNT(*) n, MAX(data_preenchimento) quando FROM anamnese_respostas WHERE paciente_id=? AND clinica_id=?", [pid, clinica_id], [{ n: 0 }]),
            tenta(client, "SELECT id,data_retorno,motivo FROM alertas_retorno WHERE paciente_id=? AND clinica_id=? AND status='pendente' ORDER BY data_retorno", [pid, clinica_id]),
            tenta(client, "SELECT id,data_criacao,valor_total,status FROM orcamentos WHERE paciente_id=? AND clinica_id=? AND (status IS NULL OR UPPER(status) IN ('ABERTO','PENDENTE','EM_ABERTO')) ORDER BY data_criacao DESC LIMIT 10", [pid, clinica_id]),
            tenta(client, "SELECT COUNT(*) n, COALESCE(SUM(valor),0) total FROM parcelas_orcamento WHERE paciente_id=? AND clinica_id=? AND status NOT IN ('pago','cancelado') AND data_vencimento<?", [pid, clinica_id, hoje], [{ n: 0, total: 0 }]),
            tenta(client, "SELECT id,texto,autor_nome,criado_em FROM paciente_notas WHERE paciente_id=? AND clinica_id=? ORDER BY criado_em DESC LIMIT 50", [pid, clinica_id]),
            tenta(client, "SELECT COUNT(*) n FROM pacientes WHERE indicado_por_id=? AND clinica_id=?", [pid, clinica_id], [{ n: 0 }])
        ])
        return json(200, {
            success: true, proximos: r[0], ultimo: r[1][0] || null, anamnese: { respostas: Number(r[2][0].n || 0), quando: r[2][0].quando || null },
            alertas: r[3], orcamentos_abertos: r[4], vencido: { parcelas: Number(r[5][0].n), valor: Number(r[5][0].total) }, notas: r[6], indicados: Number(r[7][0].n)
        })
    }

    // ── Notas gerais ──────────────────────────────────────────────
    if (route === 'paciente-notas') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        if (b.action === 'delete') {
            var nota = await client.execute({ sql: "SELECT autor_id FROM paciente_notas WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!nota.rows.length) return json(404, { success: false, error: 'Nota não encontrada' })
            if (auth.perfil !== 'admin' && Number(nota.rows[0].autor_id) !== Number(auth.usuario_id)) return json(403, { success: false, error: 'Só o autor ou um admin pode remover a nota' })
            await client.execute({ sql: "DELETE FROM paciente_notas WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            return json(200, { success: true })
        }
        var texto = String(b.texto || '').trim().slice(0, 2000)
        if (!texto) return json(400, { success: false, error: 'Escreva a nota' })
        if (!await pacienteDaClinica(client, clinica_id, b.paciente_id)) return json(404, { success: false, error: 'Paciente não encontrado' })
        var n = await client.execute({ sql: "INSERT INTO paciente_notas(clinica_id,paciente_id,texto,autor_id,autor_nome) VALUES(?,?,?,?,?)", args: [clinica_id, b.paciente_id, texto, auth.usuario_id, auth.nome || null] })
        return json(200, { success: true, id: Number(n.lastInsertRowid) })
    }

    // ── Evolução clínica ──────────────────────────────────────────
    if (route === 'paciente-evolucoes') {
        if (req.method === 'GET') {
            var ev = await client.execute({
                sql: "SELECT e.*,pr.nome profissional_nome FROM prontuario_evolucoes e LEFT JOIN profissionais pr ON pr.id=e.profissional_id WHERE e.paciente_id=? AND e.clinica_id=? ORDER BY e.data DESC, e.id DESC LIMIT 500",
                args: [q.paciente_id, clinica_id]
            })
            return json(200, { success: true, data: ev.rows })
        }
        if (b.action === 'delete') {
            var ex = await client.execute({ sql: "SELECT autor_id FROM prontuario_evolucoes WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!ex.rows.length) return json(404, { success: false, error: 'Registro não encontrado' })
            if (auth.perfil !== 'admin' && Number(ex.rows[0].autor_id) !== Number(auth.usuario_id)) return json(403, { success: false, error: 'Só o autor ou um admin pode excluir' })
            await moverParaLixeira(client, auth, 'evolucao', b.id)
            return json(200, { success: true })
        }
        var txt = String(b.texto || '').trim().slice(0, 10000)
        var data = DATA_RE.test(b.data || '') ? b.data : new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10)
        if (!txt) return json(400, { success: false, error: 'Descreva o atendimento' })
        var prof = b.profissional_id ? Number(b.profissional_id) : null
        if (prof) {
            var okp = await client.execute({ sql: "SELECT id FROM profissionais WHERE id=? AND clinica_id=?", args: [prof, clinica_id] })
            if (!okp.rows.length) return json(404, { success: false, error: 'Profissional não encontrado' })
        }
        if (b.id) {
            var ed = await client.execute({ sql: "SELECT autor_id FROM prontuario_evolucoes WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            if (!ed.rows.length) return json(404, { success: false, error: 'Registro não encontrado' })
            if (auth.perfil !== 'admin' && Number(ed.rows[0].autor_id) !== Number(auth.usuario_id)) return json(403, { success: false, error: 'Só o autor ou um admin pode editar' })
            await client.execute({ sql: "UPDATE prontuario_evolucoes SET data=?,profissional_id=?,dente=?,texto=?,proxima_consulta=?,editado_em=datetime('now') WHERE id=? AND clinica_id=?", args: [data, prof, String(b.dente || '').slice(0, 60), txt, String(b.proxima_consulta || '').slice(0, 500), b.id, clinica_id] })
            return json(200, { success: true, id: Number(b.id) })
        }
        if (!await pacienteDaClinica(client, clinica_id, b.paciente_id)) return json(404, { success: false, error: 'Paciente não encontrado' })
        var ie = await client.execute({
            sql: "INSERT INTO prontuario_evolucoes(clinica_id,paciente_id,profissional_id,data,dente,texto,proxima_consulta,autor_id,autor_nome) VALUES(?,?,?,?,?,?,?,?,?)",
            args: [clinica_id, b.paciente_id, prof, data, String(b.dente || '').slice(0, 60), txt, String(b.proxima_consulta || '').slice(0, 500), auth.usuario_id, auth.nome || null]
        })
        return json(200, { success: true, id: Number(ie.lastInsertRowid) })
    }

    // ── Indicações feitas pelo paciente ───────────────────────────
    if (route === 'paciente-indicacoes') {
        var ri = await client.execute({ sql: "SELECT id,nome,telefone,criado_em,ativo FROM pacientes WHERE indicado_por_id=? AND clinica_id=? ORDER BY criado_em DESC", args: [q.paciente_id, clinica_id] })
        return json(200, { success: true, data: ri.rows })
    }

    // ── Modelos de documento ──────────────────────────────────────
    if (route === 'documento-modelos') {
        if (req.method === 'GET') return json(200, { success: true, data: await modelos(client, clinica_id), tipos: TIPOS_DOC })
        if (b.action === 'delete') {
            await client.execute({ sql: "UPDATE documento_modelos SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] })
            return json(200, { success: true })
        }
        var mn = String(b.nome || '').trim().slice(0, 120), mt = TIPOS_DOC.indexOf(b.tipo) !== -1 ? b.tipo : 'outro', mc = sanitizar(b.conteudo)
        if (!mn || !mc) return json(400, { success: false, error: 'Nome e conteúdo obrigatórios' })
        if (b.id) {
            var um = await client.execute({ sql: "UPDATE documento_modelos SET nome=?,tipo=?,conteudo=? WHERE id=? AND clinica_id=?", args: [mn, mt, mc, b.id, clinica_id] })
            if (!um.rowsAffected) return json(404, { success: false, error: 'Modelo não encontrado' })
            return json(200, { success: true, id: Number(b.id) })
        }
        var im = await client.execute({ sql: "INSERT INTO documento_modelos(clinica_id,nome,tipo,conteudo) VALUES(?,?,?,?)", args: [clinica_id, mn, mt, mc] })
        return json(200, { success: true, id: Number(im.lastInsertRowid) })
    }

    // ── Preenche um modelo com os dados do paciente ───────────────
    if (route === 'documento-preparar') {
        var pp = await pacienteDaClinica(client, clinica_id, q.paciente_id)
        if (!pp) return json(404, { success: false, error: 'Paciente não encontrado' })
        var mod = await client.execute({ sql: "SELECT * FROM documento_modelos WHERE id=? AND clinica_id=?", args: [q.modelo_id, clinica_id] })
        if (!mod.rows.length) return json(404, { success: false, error: 'Modelo não encontrado' })
        var cli = (await tenta(client, "SELECT * FROM clinicas WHERE id=?", [clinica_id]))[0] || {}
        var pr = q.profissional_id ? (await tenta(client, "SELECT * FROM profissionais WHERE id=? AND clinica_id=?", [q.profissional_id, clinica_id]))[0] || {} : {}
        var agoraCG = new Date(Date.now() - 4 * 3600 * 1000)
        var dIso = agoraCG.toISOString()
        var vars = {
            'paciente.nome': pp.nome, 'paciente.cpf': pp.cpf, 'paciente.rg': pp.rg, 'paciente.data_nascimento': br(pp.data_nascimento),
            'paciente.telefone': pp.telefone, 'paciente.email': pp.email,
            'paciente.endereco_completo': [pp.endereco, pp.numero, pp.complemento, pp.bairro, pp.cidade && (pp.cidade + (pp.uf ? '/' + pp.uf : '')), pp.cep && ('CEP ' + pp.cep)].filter(Boolean).join(', '),
            'paciente.responsavel': pp.responsavel_nome,
            'clinica.nome': cli.nome, 'clinica.razao_social': cli.razao_social || cli.nome, 'clinica.cnpj': cli.cnpj || cli.documento_numero,
            'clinica.endereco': [cli.endereco, cli.cidade, cli.estado].filter(Boolean).join(', '), 'clinica.cidade': cli.cidade, 'clinica.telefone': cli.telefone,
            'profissional.nome': pr.nome, 'profissional.cro': [pr.cro, pr.cro_uf].filter(Boolean).join('/'), 'profissional.especialidade': pr.especialidade,
            'data': br(dIso.slice(0, 10)), 'data_extenso': agoraCG.getUTCDate() + ' de ' + MESES[agoraCG.getUTCMonth()] + ' de ' + agoraCG.getUTCFullYear(), 'hora': dIso.slice(11, 16)
        }
        var html = String(mod.rows[0].conteudo).replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, function(_, k) { return vars[k] != null && vars[k] !== '' ? escHtml(vars[k]) : '________' })
        return json(200, { success: true, titulo: mod.rows[0].nome, tipo: mod.rows[0].tipo, conteudo: html, cabecalho: { clinica: cli.nome || '', cidade: cli.cidade || '', profissional: pr.nome || '', cro: vars['profissional.cro'] || '', data_extenso: vars.data_extenso } })
    }

    // ── Documentos emitidos ───────────────────────────────────────
    if (route === 'documentos-emitidos') {
        if (req.method === 'GET') {
            var de = await client.execute({ sql: "SELECT d.id,d.titulo,d.tipo,d.conteudo,d.criado_por_nome,d.criado_em,d.codigo_validacao,pr.nome profissional_nome FROM documentos_emitidos d LEFT JOIN profissionais pr ON pr.id=d.profissional_id WHERE d.paciente_id=? AND d.clinica_id=? ORDER BY d.criado_em DESC", args: [q.paciente_id, clinica_id] })
            // documentos emitidos antes do validador ganham código na primeira listagem
            for (var dc = 0; dc < de.rows.length; dc++) if (!de.rows[dc].codigo_validacao) de.rows[dc].codigo_validacao = await gravarCodigo(client, clinica_id, de.rows[dc].id)
            return json(200, { success: true, data: de.rows })
        }
        if (b.action === 'delete') {
            if (!await moverParaLixeira(client, auth, 'documento_emitido', b.id)) return json(404, { success: false, error: 'Documento não encontrado' })
            return json(200, { success: true })
        }
        if (!await pacienteDaClinica(client, clinica_id, b.paciente_id)) return json(404, { success: false, error: 'Paciente não encontrado' })
        var tit = String(b.titulo || '').trim().slice(0, 160), cont = sanitizar(b.conteudo)
        if (!tit || !cont) return json(400, { success: false, error: 'Título e conteúdo obrigatórios' })
        var idd = await client.execute({
            sql: "INSERT INTO documentos_emitidos(clinica_id,paciente_id,modelo_id,titulo,tipo,conteudo,profissional_id,criado_por_nome) VALUES(?,?,?,?,?,?,?,?)",
            args: [clinica_id, b.paciente_id, b.modelo_id || null, tit, TIPOS_DOC.indexOf(b.tipo) !== -1 ? b.tipo : 'outro', cont, b.profissional_id || null, auth.nome || null]
        })
        var novoId = Number(idd.lastInsertRowid)
        return json(200, { success: true, id: novoId, codigo_validacao: await gravarCodigo(client, clinica_id, novoId) })
    }

    return false
}

module.exports = { handle, sanitizar, MODELOS_PADRAO }
