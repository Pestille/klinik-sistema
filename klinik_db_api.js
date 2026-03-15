// ═══════════════════════════════════════════════════════════
// KLINIK SISTEMA — Database API Client
// Conecta o frontend com a API do banco de dados
// ═══════════════════════════════════════════════════════════

const KlinikDB = {
  // Base URL da API — alterar para produção
  BASE: '/api/db',

  async get(endpoint, params = {}) {
    const qs = new URLSearchParams(params).toString()
    const r = await fetch(`${this.BASE}/${endpoint}${qs ? '?' + qs : ''}`)
    const d = await r.json()
    return d.ok ? d.data : []
  },

  async post(endpoint, body) {
    const r = await fetch(`${this.BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return r.json()
  },

  async put(endpoint, id, body) {
    const r = await fetch(`${this.BASE}/${endpoint}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return r.json()
  },

  async delete(endpoint, id) {
    const r = await fetch(`${this.BASE}/${endpoint}/${id}`, { method: 'DELETE' })
    return r.json()
  },

  // ── AGENDA ──────────────────────────────────────────────
  agenda: {
    list: (params) => KlinikDB.get('agendamentos', params),
    create: (data) => KlinikDB.post('agendamentos', data),
    update: (id, data) => KlinikDB.put('agendamentos', id, data),
    delete: (id) => KlinikDB.delete('agendamentos', id),
    hoje: () => KlinikDB.get('agendamentos', { data: new Date().toISOString().slice(0,10) }),
    semana: () => KlinikDB.get('agendamentos/semana'),
    porProfissional: (prof_id, data) => KlinikDB.get('agendamentos', { profissional_id: prof_id, data }),
  },

  // ── PACIENTES ────────────────────────────────────────────
  pacientes: {
    list: (params) => KlinikDB.get('pacientes', params),
    busca: (q) => KlinikDB.get('pacientes', { q }),
    get: (id) => KlinikDB.get(`pacientes/${id}`),
    create: (data) => KlinikDB.post('pacientes', data),
    update: (id, data) => KlinikDB.put('pacientes', id, data),
    inativos: () => KlinikDB.get('pacientes/inativos'),
    aniversariantes: () => KlinikDB.get('pacientes/aniversariantes'),
    prontuario: (id) => KlinikDB.get(`pacientes/${id}/prontuario`),
  },

  // ── FINANCEIRO ───────────────────────────────────────────
  financeiro: {
    // Conta Corrente
    lancamentos: (params) => KlinikDB.get('financeiro/lancamentos', params),
    criarLancamento: (data) => KlinikDB.post('financeiro/lancamentos', data),
    // Contas a Pagar
    contasPagar: (params) => KlinikDB.get('financeiro/contas-pagar', params),
    criarContaPagar: (data) => KlinikDB.post('financeiro/contas-pagar', data),
    pagarConta: (id) => KlinikDB.put('financeiro/contas-pagar', id, { status: 'paga' }),
    // Contas a Receber
    contasReceber: (params) => KlinikDB.get('financeiro/contas-receber', params),
    // Boletos
    boletos: (params) => KlinikDB.get('financeiro/boletos', params),
    // Cartões
    cartoes: (params) => KlinikDB.get('financeiro/cartoes', params),
    // Planos
    planos: (params) => KlinikDB.get('financeiro/planos', params),
    // Recebíveis
    recebiveis: (params) => KlinikDB.get('financeiro/recebiveis', params),
    // Extrato
    extrato: (params) => KlinikDB.get('financeiro/extrato', params),
    // Dashboard
    resumo: (params) => KlinikDB.get('financeiro/resumo', params),
    fluxoCaixa: (mes, ano) => KlinikDB.get('financeiro/fluxo-caixa', { mes, ano }),
  },

  // ── CRC / INATIVOS ───────────────────────────────────────
  crc: {
    inativos: () => KlinikDB.get('crc/inativos'),
    alertas: () => KlinikDB.get('crc/alertas'),
    registrarContato: (pac_id, resultado) => KlinikDB.post('crc/contato', { paciente_id: pac_id, resultado }),
  },

  // ── PROFISSIONAIS ────────────────────────────────────────
  profissionais: {
    list: () => KlinikDB.get('profissionais'),
    get: (id) => KlinikDB.get(`profissionais/${id}`),
    create: (data) => KlinikDB.post('profissionais', data),
    update: (id, data) => KlinikDB.put('profissionais', id, data),
  },

  // ── ESTOQUE ──────────────────────────────────────────────
  estoque: {
    list: () => KlinikDB.get('estoque'),
    entrada: (id, qty, motivo) => KlinikDB.post('estoque/movimentacao', { estoque_id: id, tipo: 'entrada', quantidade: qty, motivo }),
    saida: (id, qty, motivo) => KlinikDB.post('estoque/movimentacao', { estoque_id: id, tipo: 'saida', quantidade: qty, motivo }),
    abaixoMinimo: () => KlinikDB.get('estoque/abaixo-minimo'),
  },

  // ── METAS ────────────────────────────────────────────────
  metas: {
    list: (mes, ano) => KlinikDB.get('metas', { mes, ano }),
    update: (id, data) => KlinikDB.put('metas', id, data),
    resumo: (mes, ano) => KlinikDB.get('metas/resumo', { mes, ano }),
  },

  // ── CONFIGURAÇÕES ────────────────────────────────────────
  config: {
    list: () => KlinikDB.get('configuracoes'),
    get: (chave) => KlinikDB.get('configuracoes', { chave }),
    set: (chave, valor) => KlinikDB.post('configuracoes', { chave, valor }),
  },

  // ── RELATÓRIOS ───────────────────────────────────────────
  relatorios: {
    producao: (params) => KlinikDB.get('relatorios/producao', params),
    porProfissional: (params) => KlinikDB.get('relatorios/profissionais', params),
    porProcedimento: (params) => KlinikDB.get('relatorios/procedimentos', params),
    inativos: () => KlinikDB.get('relatorios/inativos'),
    inadimplencia: (params) => KlinikDB.get('relatorios/inadimplencia', params),
  },

  // ── INDICAÇÕES ───────────────────────────────────────────
  indicacoes: {
    list: () => KlinikDB.get('indicacoes'),
    create: (data) => KlinikDB.post('indicacoes', data),
  },

  // ── CONTROLE PROTÉTICO ───────────────────────────────────
  protetico: {
    list: () => KlinikDB.get('protetico'),
    create: (data) => KlinikDB.post('protetico', data),
    update: (id, data) => KlinikDB.put('protetico', id, data),
  },

  // ── TABELAS DE PREÇO ─────────────────────────────────────
  tabelas: {
    list: () => KlinikDB.get('tabelas-preco'),
    itens: (tabela_id) => KlinikDB.get('tabelas-preco/itens', { tabela_id }),
  },
}

// Exporta para uso global
if (typeof window !== 'undefined') window.KlinikDB = KlinikDB
if (typeof module !== 'undefined') module.exports = KlinikDB
