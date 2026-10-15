// lib/config.js — Preferências da clínica (clinicas.cfg_json) e trilha de auditoria
// Klinov — Campo Grande, MS
//
// cfg_json guarda as preferências que não têm coluna própria. lerCfg() sempre
// devolve o objeto completo (padrões + o que foi salvo), então quem lê não
// precisa tratar ausência. registrar() grava ações sensíveis na tabela auditoria
// e nunca derruba a operação que está sendo auditada.

var PADRAO = {
    tema: { cor: 'verde', titulo: '' },
    agenda: { confirmacao_padrao: '1_dia', canal_padrao: 'whatsapp' },
    bloqueios: { inadimplencia: 'nao', dias_tolerancia: 0 },
    orcamento: { desconto_max: {} },
    seguranca: { dois_fatores: false, sessao_horas: 8, inatividade_min: 30, senha_exportar: false },
    recibos: { proximo: 1 }
}

function copia(o) { return JSON.parse(JSON.stringify(o)) }
function mesclar(base, extra) {
    Object.keys(extra || {}).forEach(function (k) {
        if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k] && typeof base[k] === 'object') base[k] = mesclar(base[k], extra[k])
        else base[k] = extra[k]
    })
    return base
}

async function lerCfg(client, clinica_id) {
    var cfg = copia(PADRAO)
    try {
        var r = await client.execute({ sql: "SELECT cfg_json FROM clinicas WHERE id=?", args: [clinica_id] })
        if (r.rows.length && r.rows[0].cfg_json) mesclar(cfg, JSON.parse(r.rows[0].cfg_json))
    } catch (e) { /* coluna ainda não existe ou JSON inválido: usa o padrão */ }
    return cfg
}

// Salva só a seção informada (as outras ficam como estão)
async function salvarSecao(client, clinica_id, secao, valores) {
    var atual = {}
    try {
        var r = await client.execute({ sql: "SELECT cfg_json FROM clinicas WHERE id=?", args: [clinica_id] })
        if (r.rows.length && r.rows[0].cfg_json) atual = JSON.parse(r.rows[0].cfg_json) || {}
    } catch (e) { atual = {} }
    atual[secao] = valores
    await client.execute({ sql: "UPDATE clinicas SET cfg_json=? WHERE id=?", args: [JSON.stringify(atual), clinica_id] })
    return mesclar(copia(PADRAO), atual)
}

function ipDe(req) {
    var h = (req && req.headers) || {}
    return String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim().slice(0, 64) || null
}

async function registrar(client, quem, acao, detalhe, req) {
    try {
        await client.execute({
            sql: "INSERT INTO auditoria(clinica_id,usuario_id,usuario_nome,acao,detalhe,ip,criado_em) VALUES(?,?,?,?,?,?,datetime('now','-4 hours'))",
            args: [quem.clinica_id || null, quem.usuario_id || quem.id || null, quem.nome || null, acao, detalhe ? String(detalhe).slice(0, 500) : null, ipDe(req)]
        })
    } catch (e) { console.error('[auditoria]', e.message) }
}

module.exports = { PADRAO, lerCfg, salvarSecao, registrar }
