// lib/lixeira.js — Exclusão com cópia restaurável (Administração de Dados)
// Klinov — Campo Grande, MS
//
// Antes de um DELETE, a linha (e as linhas filhas) é copiada em JSON para a
// tabela lixeira. Restaurar reinsere com o mesmo id. As consultas de leitura
// não precisam filtrar nada: o registro sai mesmo da tabela de origem.

// tipo → { tabela, descricao(row), filhos: [{ tabela, fk }] }
var TIPOS = {
    agendamento: { tabela: 'agendamentos', rotulo: 'Agendamento', descricao: function(r) { return (r.paciente_nome || 'Paciente') + ' — ' + (r.data_hora || '') } },
    orcamento: { tabela: 'orcamentos', rotulo: 'Orçamento', descricao: function(r) { return 'Orçamento #' + r.id + (r.valor_total ? ' — R$ ' + r.valor_total : '') }, filhos: [{ tabela: 'orcamento_itens', fk: 'orcamento_id' }] },
    documento: { tabela: 'documentos', rotulo: 'Documento', descricao: function(r) { return r.nome || r.titulo || ('Documento #' + r.id) } },
    meta: { tabela: 'metas_config', rotulo: 'Meta', descricao: function(r) { return (r.tipo || 'Meta') + ' ' + (r.data_inicio || '') + ' a ' + (r.data_fim || '') } },
    comissao_config: { tabela: 'comissoes_config', rotulo: 'Regra de comissão', descricao: function(r) { return 'Regra #' + r.id } },
    paciente: { tabela: 'pacientes', rotulo: 'Paciente', descricao: function(r) { return r.nome || ('Paciente #' + r.id) } },
    evolucao: { tabela: 'prontuario_evolucoes', rotulo: 'Evolução clínica', descricao: function(r) { return (r.data || '') + ' — ' + String(r.texto || '').slice(0, 60) } },
    documento_emitido: { tabela: 'documentos_emitidos', rotulo: 'Documento emitido', descricao: function(r) { return r.titulo || ('Documento #' + r.id) } }
}

function plain(row) {
    var o = {}
    Object.keys(row).forEach(function(k) { if (isNaN(Number(k))) o[k] = row[k] })
    return o
}

// Copia para a lixeira e apaga. Retorna false se o registro não existe na clínica.
async function moverParaLixeira(client, auth, tipo, id) {
    var t = TIPOS[tipo]
    if (!t) throw new Error('Tipo de lixeira desconhecido: ' + tipo)
    var where = " WHERE id=? AND clinica_id=?"
    var args = [id, auth.clinica_id]
    var r = await client.execute({ sql: "SELECT * FROM " + t.tabela + where, args: args })
    if (!r.rows.length) return false
    var row = plain(r.rows[0])

    var filhos = []
    for (var i = 0; i < (t.filhos || []).length; i++) {
        var f = t.filhos[i]
        var fr = await client.execute({ sql: "SELECT * FROM " + f.tabela + " WHERE " + f.fk + "=? AND clinica_id=?", args: [id, auth.clinica_id] })
        filhos.push({ tabela: f.tabela, fk: f.fk, linhas: fr.rows.map(plain) })
    }

    await client.execute({
        sql: "INSERT INTO lixeira(clinica_id,tipo,tabela,registro_id,descricao,dados_json,filhos_json,excluido_por,excluido_por_nome) VALUES(?,?,?,?,?,?,?,?,?)",
        args: [auth.clinica_id, tipo, t.tabela, id, t.descricao(row), JSON.stringify(row), filhos.length ? JSON.stringify(filhos) : null, auth.usuario_id || null, auth.nome || null]
    })
    for (var k = 0; k < filhos.length; k++) {
        await client.execute({ sql: "DELETE FROM " + filhos[k].tabela + " WHERE " + filhos[k].fk + "=? AND clinica_id=?", args: [id, auth.clinica_id] })
    }
    await client.execute({ sql: "DELETE FROM " + t.tabela + where, args: args })
    return true
}

async function inserirLinha(client, tabela, row) {
    var cols = Object.keys(row)
    await client.execute({
        sql: "INSERT INTO " + tabela + "(" + cols.join(',') + ") VALUES(" + cols.map(function() { return '?' }).join(',') + ")",
        args: cols.map(function(c) { return row[c] })
    })
}

async function restaurar(client, auth, lixeiraId) {
    var r = await client.execute({ sql: "SELECT * FROM lixeira WHERE id=? AND clinica_id=? AND restaurado_em IS NULL", args: [lixeiraId, auth.clinica_id] })
    if (!r.rows.length) return { ok: false, status: 404, error: 'Item não encontrado na lixeira' }
    var item = r.rows[0]
    var t = TIPOS[item.tipo]
    if (!t || t.tabela !== item.tabela) return { ok: false, status: 400, error: 'Tipo inválido' }

    var existe = await client.execute({ sql: "SELECT id FROM " + t.tabela + " WHERE id=?", args: [item.registro_id] })
    if (existe.rows.length) return { ok: false, status: 409, error: 'Já existe um registro com o mesmo id' }

    var row = JSON.parse(item.dados_json)
    if (Number(row.clinica_id) !== Number(auth.clinica_id)) return { ok: false, status: 403, error: 'Sem permissão' }
    await inserirLinha(client, t.tabela, row)
    var filhos = item.filhos_json ? JSON.parse(item.filhos_json) : []
    for (var i = 0; i < filhos.length; i++) {
        for (var j = 0; j < filhos[i].linhas.length; j++) await inserirLinha(client, filhos[i].tabela, filhos[i].linhas[j])
    }
    await client.execute({ sql: "UPDATE lixeira SET restaurado_em=datetime('now') WHERE id=?", args: [lixeiraId] })
    return { ok: true }
}

module.exports = { TIPOS, moverParaLixeira, restaurar }
