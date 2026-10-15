// lib/rotas/configuracoes.js — Configurações (Fase 8)
// Klinov — Campo Grande, MS
//
// handle(route, ctx) devolve true quando respondeu. Toda query filtra clinica_id.
//   clinica-config     dados da clínica, logo, cobrança e preferências (admin)
//   clinica-publico    nome, logo, tema e limites que a tela precisa (qualquer usuário)
//   especialidades     lista da clínica (usada no cadastro de profissionais e tabelas)
//   mensagens-modelos  textos de confirmação, lembrete, aniversário e retorno
//   usuario-permissoes exceções de permissão por usuário (sobre o perfil)
//   auditoria          trilha de ações sensíveis
//   profissional-*     inativar/reativar e excluir profissional

var cfgLib = require('../config')
var permissoes = require('../permissoes')

var ESPECIALIDADES = ['Clínica geral', 'Dentística', 'Endodontia', 'Periodontia', 'Implantodontia', 'Prótese', 'Ortodontia', 'Odontopediatria', 'Cirurgia bucomaxilofacial', 'Estética', 'Harmonização orofacial', 'Radiologia']
var MODELOS = {
    confirmacao: { nome: 'Confirmação de consulta', assunto: 'Confirmação de consulta', corpo: 'Olá, {{nome}}! Sua consulta com {{profissional}} está marcada para {{data_consulta}} às {{hora}}. Podemos confirmar?' },
    lembrete: { nome: 'Lembrete de consulta', assunto: 'Lembrete de consulta', corpo: 'Olá, {{nome}}! Lembrete: sua consulta é em {{data_consulta}} às {{hora}} com {{profissional}}.' },
    aniversario: { nome: 'Feliz aniversário', assunto: 'Feliz aniversário!', corpo: 'Olá, {{nome}}! A equipe da {{clinica}} deseja um feliz aniversário, com muita saúde e muitos sorrisos.' },
    retorno: { nome: 'Lembrete de retorno', assunto: 'Está na hora do seu retorno', corpo: 'Olá, {{nome}}! Está chegando a data do seu retorno na {{clinica}}. Responda esta mensagem para agendarmos.' }
}
var CORES_TEMA = ['verde', 'azul', 'petroleo', 'grafite']
var PERFIS = ['admin', 'dentista', 'recepcionista', 'asb', 'administrativo']
var DADOS = ['nome', 'razao_social', 'cnpj', 'documento_tipo', 'documento_numero', 'telefone', 'email', 'endereco', 'numero', 'bairro', 'complemento', 'cidade', 'estado', 'cep', 'foro', 'resp_tecnico_nome', 'resp_tecnico_cro']

function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200) }
function num(v, min, max, def) { var n = Number(String(v == null ? '' : v).replace(',', '.')); if (!isFinite(n)) return def; return Math.min(Math.max(n, min), max) }

async function tentar(client, sql, args) {
    try { return (await client.execute({ sql: sql, args: args || [] })).rows }
    catch (e) { if (/no such (table|column)/i.test(e.message || '')) return []; throw e }
}

async function handle(route, ctx) {
    var req = ctx.req, res = ctx.res, q = ctx.q, client = ctx.client, auth = ctx.auth, clinica_id = ctx.clinica_id
    var b = req.body || {}
    function json(status, obj) { res.status(status).json(obj); return true }
    var admin = auth.perfil === 'admin'

    // ── Dados e preferências da clínica ───────────────────────────
    if (route === 'clinica-config') {
        if (!admin) return json(403, { success: false, error: 'Só o administrador altera as configurações da clínica' })
        if (req.method === 'POST') {
            var s = b.secao, d = b.dados || {}
            if (s === 'dados') {
                if (!txt(d.nome, 120)) return json(400, { success: false, error: 'Informe o nome da clínica' })
                if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return json(400, { success: false, error: 'E-mail inválido' })
                var vals = DADOS.map(function (k) { return txt(d[k], k === 'endereco' ? 200 : 120) || null })
                await client.execute({ sql: "UPDATE clinicas SET " + DADOS.map(function (k) { return k + '=?' }).join(',') + " WHERE id=?", args: vals.concat([clinica_id]) })
                await cfgLib.registrar(client, auth, 'config.dados_clinica', null, req)
                return json(200, { success: true })
            }
            if (s === 'logo') {
                var logo = String(d.logo || '')
                if (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) return json(400, { success: false, error: 'Envie a logo em PNG, JPG ou WEBP' })
                if (logo.length > 420000) return json(400, { success: false, error: 'Logo muito grande (máximo 300 KB)' })
                await client.execute({ sql: "UPDATE clinicas SET logo=? WHERE id=?", args: [logo || null, clinica_id] })
                return json(200, { success: true })
            }
            if (s === 'cobranca') {
                var campos = ['pix_tipo', 'pix_chave', 'banco_nome', 'banco_agencia', 'banco_conta'], a = campos.map(function (k) { return txt(d[k], 120) || null })
                var setKey = d.asaas_api_key ? ', asaas_api_key=?' : ''
                if (d.asaas_api_key) a.push(txt(d.asaas_api_key, 300))
                await client.execute({ sql: "UPDATE clinicas SET " + campos.map(function (k) { return k + '=?' }).join(',') + setKey + " WHERE id=?", args: a.concat([clinica_id]) })
                await cfgLib.registrar(client, auth, 'config.cobranca', d.asaas_api_key ? 'Chave do Asaas alterada' : null, req)
                return json(200, { success: true })
            }
            if (s === 'comunicacao') {
                var flags = ['cfg_confirmacao_wa', 'cfg_confirmacao_email', 'cfg_aniversario', 'cfg_lembrete_retorno']
                await client.execute({ sql: "UPDATE clinicas SET " + flags.map(function (k) { return k + '=?' }).join(',') + " WHERE id=?", args: flags.map(function (k) { return d[k] ? 1 : 0 }).concat([clinica_id]) })
                var ag = { confirmacao_padrao: ['mesmo_dia', '1_dia', '2_dias', 'nao'].indexOf(d.confirmacao_padrao) >= 0 ? d.confirmacao_padrao : '1_dia', canal_padrao: ['whatsapp', 'email', 'ambos'].indexOf(d.canal_padrao) >= 0 ? d.canal_padrao : 'whatsapp' }
                ag = Object.assign({}, (await cfgLib.lerCfg(client, clinica_id)).agenda, ag)
                await cfgLib.salvarSecao(client, clinica_id, 'agenda', ag)
                return json(200, { success: true })
            }
            if (s === 'agenda_geral') {
                var atualAg = (await cfgLib.lerCfg(client, clinica_id)).agenda
                var novoAg = Object.assign({}, atualAg, { limite_simultaneos: num(d.limite_simultaneos, 1, 10, 1), forcar_encaixe: ['todos', 'admin', 'nao'].indexOf(d.forcar_encaixe) >= 0 ? d.forcar_encaixe : 'todos' })
                await cfgLib.salvarSecao(client, clinica_id, 'agenda', novoAg)
                await cfgLib.registrar(client, auth, 'config.agenda', 'Simultâneos: ' + novoAg.limite_simultaneos + ' · encaixe: ' + novoAg.forcar_encaixe, req)
                return json(200, { success: true })
            }
            if (s === 'tema') {
                await cfgLib.salvarSecao(client, clinica_id, 'tema', { cor: CORES_TEMA.indexOf(d.cor) >= 0 ? d.cor : 'verde', titulo: txt(d.titulo, 40) })
                return json(200, { success: true })
            }
            if (s === 'bloqueios') {
                var op = ['nao', 'avisar', 'admin', 'bloquear'].indexOf(d.inadimplencia) >= 0 ? d.inadimplencia : 'nao'
                await cfgLib.salvarSecao(client, clinica_id, 'bloqueios', { inadimplencia: op, dias_tolerancia: num(d.dias_tolerancia, 0, 90, 0) })
                await cfgLib.registrar(client, auth, 'config.bloqueios', 'Inadimplência: ' + op, req)
                return json(200, { success: true })
            }
            if (s === 'orcamento') {
                var lim = {}
                PERFIS.forEach(function (p) { if (p !== 'admin' && d.desconto_max && d.desconto_max[p] !== '' && d.desconto_max[p] != null) lim[p] = num(d.desconto_max[p], 0, 100, 100) })
                await cfgLib.salvarSecao(client, clinica_id, 'orcamento', { desconto_max: lim })
                return json(200, { success: true })
            }
            if (s === 'seguranca') {
                var seg = { dois_fatores: !!d.dois_fatores, sessao_horas: num(d.sessao_horas, 1, 24, 8), inatividade_min: num(d.inatividade_min, 5, 240, 30), senha_exportar: !!d.senha_exportar }
                if (seg.dois_fatores) {
                    var sem = await tentar(client, "SELECT nome FROM usuarios WHERE clinica_id=? AND ativo=1 AND COALESCE(email_pessoal,'')=''", [clinica_id])
                    if (sem.length && !d.confirmar) return json(409, { success: false, error: 'Usuários sem e-mail pessoal não conseguem receber o código e ficariam sem acesso: ' + sem.map(function (u) { return u.nome }).join(', ') + '. Cadastre o e-mail deles ou confirme para ativar mesmo assim (eles entram só com a senha).', sem_email: sem.map(function (u) { return u.nome }) })
                }
                await cfgLib.salvarSecao(client, clinica_id, 'seguranca', seg)
                await cfgLib.registrar(client, auth, 'config.seguranca', JSON.stringify(seg), req)
                return json(200, { success: true })
            }
            if (s === 'recibos') {
                await cfgLib.salvarSecao(client, clinica_id, 'recibos', { proximo: Math.round(num(d.proximo, 1, 99999999, 1)) })
                return json(200, { success: true })
            }
            return json(400, { success: false, error: 'Seção inválida' })
        }
        var cli = (await client.execute({ sql: "SELECT * FROM clinicas WHERE id=?", args: [clinica_id] })).rows[0] || {}
        var dados = {}
        DADOS.concat(['pix_tipo', 'pix_chave', 'banco_nome', 'banco_agencia', 'banco_conta', 'cfg_confirmacao_wa', 'cfg_confirmacao_email', 'cfg_aniversario', 'cfg_lembrete_retorno', 'logo']).forEach(function (k) { dados[k] = cli[k] == null ? '' : cli[k] })
        if (!dados.cnpj && cli.documento_tipo === 'cnpj') dados.cnpj = cli.documento_numero || ''
        dados.asaas_configurado = !!cli.asaas_api_key
        return json(200, { success: true, dados: dados, cfg: await cfgLib.lerCfg(client, clinica_id), perfis: PERFIS, cores: CORES_TEMA })
    }

    if (route === 'clinica-publico') {
        var c2 = (await tentar(client, "SELECT nome, logo FROM clinicas WHERE id=?", [clinica_id]))[0] || {}
        var cf = await cfgLib.lerCfg(client, clinica_id)
        var lim2 = cf.orcamento.desconto_max[auth.perfil]
        return json(200, { success: true, nome: c2.nome || '', logo: c2.logo || '', tema: cf.tema, inatividade_min: cf.seguranca.inatividade_min, desconto_max: auth.perfil === 'admin' || lim2 == null ? null : lim2, agenda: cf.agenda })
    }

    // ── Especialidades ────────────────────────────────────────────
    if (route === 'especialidades') {
        var ex = await tentar(client, "SELECT COUNT(*) n FROM especialidades WHERE clinica_id=?", [clinica_id])
        if (ex.length && !Number(ex[0].n)) for (var i = 0; i < ESPECIALIDADES.length; i++) await client.execute({ sql: "INSERT INTO especialidades(clinica_id,nome) VALUES(?,?)", args: [clinica_id, ESPECIALIDADES[i]] })
        if (req.method === 'POST') {
            if (b.action === 'excluir') { await client.execute({ sql: "UPDATE especialidades SET ativo=0 WHERE id=? AND clinica_id=?", args: [b.id, clinica_id] }); return json(200, { success: true }) }
            var nome = txt(b.nome, 60)
            if (!nome) return json(400, { success: false, error: 'Informe o nome' })
            var dup = (await client.execute({ sql: "SELECT id FROM especialidades WHERE clinica_id=? AND UPPER(nome)=UPPER(?) AND ativo=1 AND id<>?", args: [clinica_id, nome, b.id || 0] })).rows
            if (dup.length) return json(409, { success: false, error: 'Já existe esta especialidade' })
            if (b.id) { await client.execute({ sql: "UPDATE especialidades SET nome=? WHERE id=? AND clinica_id=?", args: [nome, b.id, clinica_id] }); return json(200, { success: true, id: b.id }) }
            var ie = await client.execute({ sql: "INSERT INTO especialidades(clinica_id,nome) VALUES(?,?)", args: [clinica_id, nome] })
            return json(200, { success: true, id: Number(ie.lastInsertRowid) })
        }
        return json(200, { success: true, data: (await client.execute({ sql: "SELECT id, nome FROM especialidades WHERE clinica_id=? AND ativo=1 ORDER BY nome", args: [clinica_id] })).rows })
    }

    // ── Modelos de mensagem ───────────────────────────────────────
    if (route === 'mensagens-modelos') {
        var tipos = Object.keys(MODELOS)
        for (var t = 0; t < tipos.length; t++) {
            var tem = await tentar(client, "SELECT id FROM templates_mensagem WHERE clinica_id=? AND tipo=? AND ativo=1 LIMIT 1", [clinica_id, tipos[t]])
            if (!tem.length) { try { await client.execute({ sql: "INSERT INTO templates_mensagem(nome,tipo,assunto,corpo,ativo,clinica_id) VALUES(?,?,?,?,1,?)", args: [MODELOS[tipos[t]].nome, tipos[t], MODELOS[tipos[t]].assunto, MODELOS[tipos[t]].corpo, clinica_id] }) } catch (e) { if (!/no such table/i.test(e.message)) throw e } }
        }
        if (req.method === 'POST') {
            if (tipos.indexOf(b.tipo) < 0) return json(400, { success: false, error: 'Tipo inválido' })
            var corpo = txt(b.corpo, 2000)
            if (!corpo) return json(400, { success: false, error: 'Escreva a mensagem' })
            await client.execute({ sql: "UPDATE templates_mensagem SET assunto=?, corpo=? WHERE id=(SELECT id FROM templates_mensagem WHERE clinica_id=? AND tipo=? AND ativo=1 ORDER BY id LIMIT 1) AND clinica_id=?", args: [txt(b.assunto, 150) || MODELOS[b.tipo].assunto, corpo, clinica_id, b.tipo, clinica_id] })
            return json(200, { success: true })
        }
        var lista = []
        for (var u = 0; u < tipos.length; u++) {
            var r = (await tentar(client, "SELECT tipo, assunto, corpo FROM templates_mensagem WHERE clinica_id=? AND tipo=? AND ativo=1 ORDER BY id LIMIT 1", [clinica_id, tipos[u]]))[0]
            lista.push({ tipo: tipos[u], nome: MODELOS[tipos[u]].nome, assunto: r ? r.assunto : MODELOS[tipos[u]].assunto, corpo: r ? r.corpo : MODELOS[tipos[u]].corpo })
        }
        return json(200, { success: true, data: lista, variaveis: ['nome', 'data_consulta', 'hora', 'profissional', 'procedimento', 'clinica'] })
    }

    // ── Permissões por usuário ────────────────────────────────────
    if (route === 'usuario-permissoes') {
        if (!admin) return json(403, { success: false, error: 'Só o administrador altera permissões' })
        var uid = parseInt(b.usuario_id || q.usuario_id, 10) || 0
        var us = (await client.execute({ sql: "SELECT id, nome, perfil FROM usuarios WHERE id=? AND clinica_id=?", args: [uid, clinica_id] })).rows[0]
        if (!us) return json(404, { success: false, error: 'Usuário não encontrado' })
        if (req.method === 'POST') {
            var validos = {}
            permissoes.RECURSOS.forEach(function (r) { validos[r[0]] = 1 })
            var ov = b.overrides || {}, n = 0
            await client.execute({ sql: "DELETE FROM permissoes_usuario WHERE usuario_id=? AND clinica_id=?", args: [uid, clinica_id] })
            for (var k in ov) {
                if (!validos[k] || (ov[k] !== 0 && ov[k] !== 1)) continue
                await client.execute({ sql: "INSERT INTO permissoes_usuario(clinica_id,usuario_id,recurso,permitido) VALUES(?,?,?,?)", args: [clinica_id, uid, k, ov[k]] })
                n++
            }
            await cfgLib.registrar(client, auth, 'permissoes.usuario', us.nome + ': ' + n + ' exceção(ões)', req)
            return json(200, { success: true, excecoes: n })
        }
        var base = await permissoes.mapaPerfil(client, clinica_id, us.perfil)
        var ovs = {}
        ;(await tentar(client, "SELECT recurso, permitido FROM permissoes_usuario WHERE usuario_id=? AND clinica_id=?", [uid, clinica_id])).forEach(function (x) { ovs[x.recurso] = Number(x.permitido) })
        return json(200, { success: true, usuario: us, perfil: base, overrides: ovs, recursos: permissoes.RECURSOS.map(function (r) { return r[0] }) })
    }

    // ── Auditoria ─────────────────────────────────────────────────
    if (route === 'auditoria') {
        if (!admin) return json(403, { success: false, error: 'Só o administrador vê a auditoria' })
        var w = ['clinica_id=?'], a2 = [clinica_id]
        if (/^\d{4}-\d{2}-\d{2}$/.test(q.de || '')) { w.push("substr(criado_em,1,10)>=?"); a2.push(q.de) }
        if (/^\d{4}-\d{2}-\d{2}$/.test(q.ate || '')) { w.push("substr(criado_em,1,10)<=?"); a2.push(q.ate) }
        if (q.acao) { w.push("acao LIKE ?"); a2.push(q.acao + '%') }
        return json(200, { success: true, data: await tentar(client, "SELECT * FROM auditoria WHERE " + w.join(' AND ') + " ORDER BY id DESC LIMIT 1000", a2) })
    }

    // ── Profissionais: inativar e excluir ─────────────────────────
    if (route === 'profissional-status') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var up = await client.execute({ sql: "UPDATE profissionais SET ativo=? WHERE id=? AND clinica_id=?", args: [b.ativo ? 1 : 0, b.id, clinica_id] })
        if (!up.rowsAffected) return json(404, { success: false, error: 'Profissional não encontrado' })
        await cfgLib.registrar(client, auth, b.ativo ? 'profissional.reativar' : 'profissional.inativar', 'Profissional #' + b.id, req)
        return json(200, { success: true })
    }
    if (route === 'excluir-profissional') {
        if (req.method !== 'POST') return json(405, { success: false, error: 'POST required' })
        var pid = parseInt(b.id, 10) || 0
        var pr = (await client.execute({ sql: "SELECT id, nome FROM profissionais WHERE id=? AND clinica_id=?", args: [pid, clinica_id] })).rows[0]
        if (!pr) return json(404, { success: false, error: 'Profissional não encontrado' })
        var uso = 0
        ;(await tentar(client, "SELECT (SELECT COUNT(*) FROM agendamentos WHERE profissional_id=? AND clinica_id=?) + (SELECT COUNT(*) FROM orcamentos WHERE profissional_id=? AND clinica_id=?) n", [pid, clinica_id, pid, clinica_id])).forEach(function (x) { uso = Number(x.n) })
        if (uso) return json(409, { success: false, error: 'Este profissional tem agendamentos ou orçamentos no histórico. Inative em vez de excluir.' })
        await require('../lixeira').moverParaLixeira(client, auth, 'profissional', pid)
        await client.execute({ sql: "UPDATE usuarios SET profissional_id=NULL WHERE profissional_id=? AND clinica_id=?", args: [pid, clinica_id] })
        return json(200, { success: true })
    }

    return false
}

module.exports = { handle, MODELOS }
