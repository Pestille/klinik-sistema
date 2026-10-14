// lib/permissoes.js — Permissões por perfil, aplicadas no servidor
// Klinov — Campo Grande, MS
//
// RECURSOS é a tabela padrão (a mesma que a tela "Permissões por Perfil" mostra).
// A clínica pode sobrescrever qualquer item; a ordem de precedência é:
//   override da clínica → linha global semeada → padrão desta tabela.
// Admin sempre pode tudo.

var PERFIS = ['admin', 'dentista', 'recepcionista', 'asb', 'administrativo']

var RECURSOS = [
    // [recurso, admin, dentista, recepcionista, asb, administrativo]
    // [recurso, admin, dentista, recepcionista, asb, administrativo]
    // ── AGENDA ──
    ['agenda.agendar_atendimento', 1, 1, 1, 0, 0],
    ['agenda.editar_horarios', 1, 1, 1, 0, 0],
    ['agenda.visualizar_classificacao', 1, 1, 1, 1, 1],
    // ── CLINICA ──
    ['clinica.ver', 1, 1, 1, 1, 1],
    // ── CONFIGURACOES ──
    ['configuracoes.acessar', 1, 0, 0, 0, 0],
    ['configuracoes.editar', 1, 0, 0, 0, 0],
    // ── CONTROLE DE CHEQUE ──
    ['cheque.acessar', 1, 0, 0, 0, 1],
    ['cheque.excluir', 1, 0, 0, 0, 0],
    ['cheque.editar_parcelas', 1, 0, 0, 0, 1],
    // ── CONTROLE DE INDICACAO ──
    ['indicacao.acessar', 1, 1, 1, 0, 1],
    ['indicacao.excluir', 1, 0, 0, 0, 0],
    // ── CONTROLE PROTETICO ──
    ['protetico.acessar', 1, 1, 1, 1, 1],
    ['protetico.excluir', 1, 0, 0, 0, 0],
    // ── CRC ──
    ['crc.acessar', 1, 1, 1, 0, 1],
    ['crc.excluir', 1, 0, 0, 0, 0],
    ['crc.agendamento_pacificacao', 1, 1, 1, 0, 0],
    ['crc.enviar_mensagem', 1, 1, 1, 0, 1],
    ['crc.exportar_planilha', 1, 0, 0, 0, 1],
    ['crc.abrir_nova_funcao', 1, 0, 0, 0, 0],
    ['crc.editar', 1, 0, 0, 0, 0],
    ['crc.rejeitar_paciente', 1, 0, 0, 0, 0],
    ['crc.encaminhamento', 1, 1, 1, 0, 0],
    ['crc.exportar_agendamento', 1, 0, 0, 0, 1],
    // ── CRM ──
    ['crm.acessar', 1, 1, 1, 0, 1],
    ['crm.excluir', 1, 0, 0, 0, 0],
    ['crm.acessar_campanha', 1, 0, 0, 0, 1],
    // ── DASHBOARD ANALITICO ──
    ['dashboard.acessar', 1, 1, 0, 0, 1],
    ['dashboard.editar_metas', 1, 0, 0, 0, 0],
    // ── FINANCEIRO ──
    ['financeiro.acessar', 1, 0, 0, 0, 1],
    ['financeiro.excluir', 1, 0, 0, 0, 0],
    ['financeiro.contas', 1, 0, 0, 0, 1],
    ['financeiro.editar_contas', 1, 0, 0, 0, 0],
    ['financeiro.planos', 1, 0, 0, 0, 1],
    ['financeiro.processar_recibo', 1, 0, 0, 0, 1],
    ['financeiro.conta_corrente', 1, 0, 0, 0, 1],
    ['financeiro.controle_cheques', 1, 0, 0, 0, 1],
    ['financeiro.editar_cheques', 1, 0, 0, 0, 0],
    ['financeiro.controle_cartoes', 1, 0, 0, 0, 1],
    ['financeiro.editar_cartoes', 1, 0, 0, 0, 0],
    ['financeiro.editar_parcelas', 1, 0, 0, 0, 0],
    ['financeiro.controle_boletos', 1, 0, 0, 0, 1],
    ['financeiro.controle_planos', 1, 0, 0, 0, 1],
    ['financeiro.fluxo_caixa', 1, 0, 0, 0, 1],
    ['financeiro.parcela_avulsa', 1, 0, 0, 0, 0],
    ['financeiro.dre', 1, 0, 0, 0, 0],
    ['financeiro.comissoes', 1, 0, 0, 0, 1],
    ['financeiro.dar_baixa', 1, 0, 0, 0, 1],
    ['financeiro.conciliacoes', 1, 0, 0, 0, 0],
    ['financeiro.receita_saude', 1, 1, 0, 0, 1],
    // ── GERENCIAR CONTAS ──
    ['gerenciar_contas.acessar', 1, 0, 0, 0, 1],
    ['gerenciar_contas.editar', 1, 0, 0, 0, 0],
    ['gerenciar_contas.importacao', 1, 0, 0, 0, 0],
    ['gerenciar_contas.excluir_relatorio', 1, 0, 0, 0, 0],
    // ── MARKETPLACE ──
    ['marketplace.acessar', 1, 0, 0, 0, 0],
    ['marketplace.exclusao_grupos', 1, 0, 0, 0, 0],
    // ── METAS ──
    ['metas.acessar', 1, 1, 0, 0, 1],
    ['metas.editar', 1, 0, 0, 0, 0],
    // ── PACIENTES ──
    ['pacientes.acessar', 1, 1, 1, 1, 1],
    ['pacientes.agendamentos', 1, 1, 1, 0, 1],
    ['pacientes.prontuario', 1, 1, 1, 1, 0],
    ['pacientes.orcamentos', 1, 1, 1, 0, 0],
    ['pacientes.editar_orcamento', 1, 1, 0, 0, 0],
    ['pacientes.financeiro', 1, 0, 0, 0, 1],
    ['pacientes.fotos', 1, 1, 1, 1, 0],
    ['pacientes.emissao_relatorio', 1, 0, 0, 0, 1],
    ['pacientes.atendimento_recepcao', 1, 0, 1, 0, 0],
    ['pacientes.exportar', 1, 0, 0, 0, 1],
    ['pacientes.prescricoes', 1, 1, 0, 0, 0],
    ['pacientes.recibos', 1, 1, 0, 0, 1],
    ['pacientes.documentos', 1, 1, 1, 1, 1],
    ['pacientes.anamnese', 1, 1, 1, 0, 0],
    ['pacientes.odontograma', 1, 1, 0, 0, 0],
    ['pacientes.ficha_clinica', 1, 1, 0, 0, 0],
    ['pacientes.exames', 1, 1, 1, 1, 0],
    ['pacientes.indicacoes', 1, 1, 1, 0, 1],
    ['pacientes.editar_cadastro', 1, 1, 1, 0, 1],
    ['pacientes.excluir', 1, 0, 0, 0, 0],
    ['pacientes.gerar_procedimentos', 1, 1, 0, 0, 0],
    // ── PLANO DE RECORRENCIA ──
    ['recorrencia.acessar', 1, 0, 0, 0, 1],
    ['recorrencia.editar', 1, 0, 0, 0, 0],
    ['recorrencia.editar_config', 1, 0, 0, 0, 0],
    // ── PORTAL DO ASSINANTE ──
    ['portal.acessar', 1, 0, 0, 0, 0],
    ['portal.editar', 1, 0, 0, 0, 0],
    // ── PROFISSIONAIS ──
    ['profissionais.acessar', 1, 1, 1, 0, 1],
    ['profissionais.editar', 1, 0, 0, 0, 0],
    // ── RELATORIOS ──
    ['relatorios.acessar', 1, 1, 0, 0, 1],
    ['relatorios.editar', 1, 0, 0, 0, 0],
    ['relatorios.agendamentos_retornos', 1, 1, 0, 0, 1],
    ['relatorios.agendamentos_cadastros', 1, 1, 0, 0, 1],
    ['relatorios.agendamentos_desc', 1, 1, 0, 0, 1],
    ['relatorios.agendamentos_atendidos', 1, 1, 0, 0, 1],
    ['relatorios.agendamentos_faltas', 1, 1, 0, 0, 1],
    ['relatorios.agendamentos_geral', 1, 1, 0, 0, 1],
    ['relatorios.agendamentos_movimentacao', 1, 1, 0, 0, 1],
    ['relatorios.agendamentos_marcacoes', 1, 1, 0, 0, 1],
    ['relatorios.agendamentos_confirmacoes', 1, 1, 0, 0, 1],
    ['relatorios.procedimentos_agendados', 1, 1, 0, 0, 1],
    ['relatorios.procedimentos_evolucao', 1, 1, 0, 0, 1],
    ['relatorios.procedimentos_credito_debito', 1, 0, 0, 0, 1],
    ['relatorios.procedimentos_falta_cancel', 1, 1, 0, 0, 1],
    ['relatorios.financeiro_cpf', 1, 0, 0, 0, 1],
    ['relatorios.financeiro_liquidez', 1, 0, 0, 0, 0],
    ['relatorios.financeiro_pagamentos', 1, 0, 0, 0, 1],
    ['relatorios.procedimentos_retornos', 1, 1, 0, 0, 1],
    ['relatorios.procedimentos_modalidade', 1, 1, 0, 0, 1],
    ['relatorios.orcamentos', 1, 1, 0, 0, 1],
    ['relatorios.orcamentos_aprovados', 1, 1, 0, 0, 1],
    ['relatorios.comissoes', 1, 0, 0, 0, 1],
    ['relatorios.producao', 1, 1, 0, 0, 1],
    // ── ESTOQUE ──
    ['estoque.acessar', 1, 0, 1, 1, 1],
    ['estoque.editar', 1, 0, 0, 0, 1],
    // ── MARKETING ──
    ['marketing.acessar', 1, 0, 1, 0, 1],
    ['marketing.editar', 1, 0, 0, 0, 0],
    // ── USUARIOS E PERMISSOES ──
    ['usuarios.acessar', 1, 0, 0, 0, 0],
    ['usuarios.modificar_senhas', 1, 0, 0, 0, 0],
    ['usuarios.trocar_perfil', 1, 0, 0, 0, 0],
]

var _padrao = {}
RECURSOS.forEach(function(r) {
    _padrao[r[0]] = {}
    PERFIS.forEach(function(p, i) { _padrao[r[0]][p] = r[1 + i] })
})

function padrao(perfil, recurso) {
    var r = _padrao[recurso]
    if (!r) return 0
    return r[perfil] === undefined ? 0 : r[perfil]
}

// Mapa efetivo { recurso: 0|1 } de um perfil na clínica
async function mapaPerfil(client, clinica_id, perfil) {
    var mapa = {}
    RECURSOS.forEach(function(r) { mapa[r[0]] = perfil === 'admin' ? 1 : padrao(perfil, r[0]) })
    var rows = await client.execute({
        sql: "SELECT recurso, permitido, clinica_id FROM permissoes WHERE (clinica_id IS NULL OR clinica_id=?) AND perfil=? ORDER BY CASE WHEN clinica_id IS NULL THEN 0 ELSE 1 END",
        args: [clinica_id, perfil]
    })
    rows.rows.forEach(function(r) { mapa[r.recurso] = r.permitido ? 1 : 0 })
    if (perfil === 'admin') Object.keys(mapa).forEach(function(k) { mapa[k] = 1 })
    return mapa
}

async function pode(client, auth, recurso) {
    if (!auth) return false
    if (auth.perfil === 'admin') return true
    var r = await client.execute({
        sql: "SELECT permitido FROM permissoes WHERE (clinica_id IS NULL OR clinica_id=?) AND perfil=? AND recurso=? ORDER BY CASE WHEN clinica_id IS NULL THEN 1 ELSE 0 END LIMIT 1",
        args: [auth.clinica_id, auth.perfil, recurso]
    })
    if (r.rows.length) return r.rows[0].permitido === 1
    return padrao(auth.perfil, recurso) === 1
}

module.exports = { PERFIS, RECURSOS, padrao, mapaPerfil, pode }
