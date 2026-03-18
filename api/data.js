// api/data.js — Router consolidado para TODAS as consultas (Turso DB)
// Usa o wrapper query() do db.js — mesmo padrão do projeto

const { query } = require('./db')

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  var r = (req.query || {}).r
  if (!r) {
    res.status(400).json({
      error: "Parâmetro 'r' obrigatório.",
      rotas: ['dashboard','pacientes','agendamentos','profissionais','financeiro',
              'crc','relatorios','busca','aniversariantes','conta-corrente',
              'fluxo-caixa','metas','db-status','agenda-view']
    })
    return
  }

  var q   = req.query.q          || ''
  var mes = req.query.mes        || new Date().toISOString().slice(0,7)
  var ano = req.query.ano        || new Date().getFullYear().toString()
  var dia = req.query.data       || new Date().toISOString().slice(0,10)
  var prof= req.query.profissional || ''
  var di  = req.query.dataInicio || ''
  var df  = req.query.dataFim    || ''
  var lim = parseInt(req.query.limit) || 200

  try {
    var result, rows

    // ── DASHBOARD ────────────────────────────────────────────────────────────
    if (r === 'dashboard') {
      var hoje = new Date().toISOString().slice(0,10)
      var mesA = hoje.slice(0,7)
      var rs = await Promise.all([
        query('SELECT COUNT(*) as total FROM pacientes'),
        query('SELECT COUNT(*) as total FROM agendamentos'),
        query("SELECT COUNT(*) as total FROM agendamentos WHERE DATE(data_agendamento)=?",[hoje]),
        query("SELECT COALESCE(SUM(valor),0) as total FROM recebimentos WHERE strftime('%Y-%m',data_recebimento)=?",[mesA]),
        query("SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_agendamento)=?",[mesA]),
        query('SELECT COUNT(*) as total FROM profissionais WHERE ativo=1'),
      ])
      return res.json({
        totalPacientes:        rs[0].rows[0].total,
        totalAgendamentos:     rs[1].rows[0].total,
        agendamentosHoje:      rs[2].rows[0].total,
        receitaMes:            rs[3].rows[0].total,
        agendamentosMes:       rs[4].rows[0].total,
        profissionaisAtivos:   rs[5].rows[0].total,
      })
    }

    // ── DB-STATUS ────────────────────────────────────────────────────────────
    if (r === 'db-status') {
      var tables = await query("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
      if (!tables.success) return res.status(500).json({ error: tables.error })
      return res.json({
        status: 'ok',
        tables: tables.rows.map(function(t){ return t.name }),
        timestamp: new Date().toISOString()
      })
    }

    // ── PACIENTES ────────────────────────────────────────────────────────────
    if (r === 'pacientes') {
      if (q) {
        var like = '%'+q+'%'
        result = await query(
          'SELECT p.id,p.nome,p.cpf,p.telefone,p.email,p.data_nascimento,p.created_at,'+
          'COUNT(a.id) as total_agendamentos,MAX(a.data_agendamento) as ultimo_agendamento '+
          'FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id '+
          'WHERE p.nome LIKE ? OR p.cpf LIKE ? OR p.telefone LIKE ? '+
          'GROUP BY p.id ORDER BY p.nome LIMIT '+lim,
          [like,like,like]
        )
      } else {
        result = await query(
          'SELECT p.id,p.nome,p.cpf,p.telefone,p.email,p.data_nascimento,p.created_at,'+
          'COUNT(a.id) as total_agendamentos,MAX(a.data_agendamento) as ultimo_agendamento '+
          'FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id '+
          'GROUP BY p.id ORDER BY p.nome LIMIT '+lim
        )
      }
      if (!result.success) return res.status(500).json({ error: result.error })
      return res.json({ pacientes: result.rows, total: result.rows.length })
    }

    // ── AGENDAMENTOS ─────────────────────────────────────────────────────────
    if (r === 'agendamentos') {
      var sqlAg, argsAg
      if (di && df) {
        sqlAg = 'SELECT a.*,p.nome as paciente_nome,pr.nome as profissional_nome '+
                'FROM agendamentos a '+
                'LEFT JOIN pacientes p ON p.id=a.paciente_id '+
                'LEFT JOIN profissionais pr ON pr.id=a.profissional_id '+
                'WHERE DATE(a.data_agendamento) BETWEEN ? AND ? '+
                'ORDER BY a.data_agendamento DESC LIMIT '+lim
        argsAg = [di, df]
      } else if (req.query.data) {
        sqlAg = 'SELECT a.*,p.nome as paciente_nome,pr.nome as profissional_nome '+
                'FROM agendamentos a '+
                'LEFT JOIN pacientes p ON p.id=a.paciente_id '+
                'LEFT JOIN profissionais pr ON pr.id=a.profissional_id '+
                'WHERE DATE(a.data_agendamento)=? ORDER BY a.data_agendamento'
        argsAg = [dia]
      } else {
        sqlAg = "SELECT a.*,p.nome as paciente_nome,pr.nome as profissional_nome "+
                "FROM agendamentos a "+
                "LEFT JOIN pacientes p ON p.id=a.paciente_id "+
                "LEFT JOIN profissionais pr ON pr.id=a.profissional_id "+
                "WHERE strftime('%Y-%m',a.data_agendamento)=? "+
                "ORDER BY a.data_agendamento DESC LIMIT "+lim
        argsAg = [mes]
      }
      result = await query(sqlAg, argsAg)
      if (!result.success) return res.status(500).json({ error: result.error })
      return res.json({ agendamentos: result.rows, total: result.rows.length })
    }

    // ── PROFISSIONAIS ────────────────────────────────────────────────────────
    if (r === 'profissionais') {
      result = await query(
        'SELECT p.*,COUNT(a.id) as total_agendamentos '+
        'FROM profissionais p LEFT JOIN agendamentos a ON a.profissional_id=p.id '+
        'GROUP BY p.id ORDER BY p.nome'
      )
      if (!result.success) return res.status(500).json({ error: result.error })
      return res.json({ profissionais: result.rows })
    }

    // ── FINANCEIRO ───────────────────────────────────────────────────────────
    if (r === 'financeiro') {
      var rs2 = await Promise.all([
        query(
          "SELECT r.*,p.nome as paciente_nome,pr.nome as profissional_nome "+
          "FROM recebimentos r "+
          "LEFT JOIN pacientes p ON p.id=r.paciente_id "+
          "LEFT JOIN profissionais pr ON pr.id=r.profissional_id "+
          "WHERE strftime('%Y-%m',r.data_recebimento)=? ORDER BY r.data_recebimento DESC",
          [mes]
        ),
        query(
          "SELECT pr.nome,COALESCE(SUM(r.valor),0) as total,COUNT(r.id) as qtd "+
          "FROM profissionais pr "+
          "LEFT JOIN recebimentos r ON r.profissional_id=pr.id AND strftime('%Y-%m',r.data_recebimento)=? "+
          "GROUP BY pr.id ORDER BY total DESC",
          [mes]
        ),
        query(
          "SELECT forma_pagamento,COALESCE(SUM(valor),0) as total,COUNT(*) as qtd "+
          "FROM recebimentos WHERE strftime('%Y-%m',data_recebimento)=? "+
          "GROUP BY forma_pagamento ORDER BY total DESC",
          [mes]
        ),
      ])
      var recRows = rs2[0].success ? rs2[0].rows : []
      var totalMes = recRows.reduce(function(s,x){ return s+(x.valor||0) },0)
      return res.json({
        recebimentos:     recRows,
        porProfissional:  rs2[1].success ? rs2[1].rows : [],
        porFormaPagamento:rs2[2].success ? rs2[2].rows : [],
        totalMes: totalMes,
        mes: mes
      })
    }

    // ── CRC ──────────────────────────────────────────────────────────────────
    if (r === 'crc') {
      result = await query(
        'SELECT p.id,p.nome,p.telefone,p.email,'+
        'MAX(a.data_agendamento) as ultimo_agendamento,'+
        'COUNT(a.id) as total_consultas,'+
        "CAST(julianday('now')-julianday(MAX(a.data_agendamento)) AS INTEGER) as dias_ausente "+
        'FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id '+
        'GROUP BY p.id HAVING ultimo_agendamento IS NOT NULL '+
        'ORDER BY dias_ausente DESC LIMIT 200'
      )
      if (!result.success) return res.status(500).json({ error: result.error })
      return res.json({ pacientes: result.rows, total: result.rows.length })
    }

    // ── RELATÓRIOS ───────────────────────────────────────────────────────────
    if (r === 'relatorios') {
      var rs3 = await Promise.all([
        query("SELECT strftime('%Y-%m',data_recebimento) as mes,SUM(valor) as total,COUNT(*) as qtd FROM recebimentos WHERE strftime('%Y',data_recebimento)=? GROUP BY mes ORDER BY mes",[ano]),
        query("SELECT status,COUNT(*) as qtd FROM agendamentos WHERE strftime('%Y-%m',data_agendamento)=? GROUP BY status",[mes]),
        query("SELECT strftime('%Y-%m',created_at) as mes,COUNT(*) as total FROM pacientes WHERE strftime('%Y',created_at)=? GROUP BY mes ORDER BY mes",[ano]),
        query("SELECT procedimento,COUNT(*) as qtd FROM agendamentos WHERE strftime('%Y-%m',data_agendamento)=? AND procedimento IS NOT NULL AND procedimento!='' GROUP BY procedimento ORDER BY qtd DESC LIMIT 10",[mes]),
      ])
      return res.json({
        receitaMensal:        rs3[0].success ? rs3[0].rows : [],
        agendamentosPorStatus:rs3[1].success ? rs3[1].rows : [],
        novosPacientesMes:    rs3[2].success ? rs3[2].rows : [],
        topProcedimentos:     rs3[3].success ? rs3[3].rows : [],
        mes: mes, ano: ano
      })
    }

    // ── BUSCA ────────────────────────────────────────────────────────────────
    if (r === 'busca') {
      if (!q) return res.status(400).json({ error: "Parâmetro 'q' obrigatório" })
      var like2 = '%'+q+'%'
      var rs4 = await Promise.all([
        query('SELECT id,nome,cpf,telefone,email FROM pacientes WHERE nome LIKE ? OR cpf LIKE ? OR telefone LIKE ? LIMIT 20',[like2,like2,like2]),
        query('SELECT a.id,a.data_agendamento,a.status,a.procedimento,p.nome as paciente_nome,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE p.nome LIKE ? OR a.procedimento LIKE ? ORDER BY a.data_agendamento DESC LIMIT 20',[like2,like2]),
      ])
      return res.json({
        pacientes:    rs4[0].success ? rs4[0].rows : [],
        agendamentos: rs4[1].success ? rs4[1].rows : [],
        query: q
      })
    }

    // ── ANIVERSARIANTES ──────────────────────────────────────────────────────
    if (r === 'aniversariantes') {
      var mesNum = req.query.mes || String(new Date().getMonth()+1).padStart(2,'0')
      result = await query(
        "SELECT id,nome,telefone,email,data_nascimento,strftime('%d',data_nascimento) as dia "+
        'FROM pacientes WHERE strftime(\'%m\',data_nascimento)=? AND data_nascimento IS NOT NULL '+
        "ORDER BY strftime('%d',data_nascimento)",
        [mesNum]
      )
      if (!result.success) return res.status(500).json({ error: result.error })
      return res.json({ aniversariantes: result.rows, mes: mesNum, total: result.rows.length })
    }

    // ── CONTA CORRENTE ───────────────────────────────────────────────────────
    if (r === 'conta-corrente') {
      var rs5 = await Promise.all([
        query("SELECT data_recebimento as data,descricao,valor,'entrada' as tipo,forma_pagamento FROM recebimentos WHERE strftime('%Y-%m',data_recebimento)=? ORDER BY data_recebimento",[mes]),
        query("SELECT data_lancamento as data,descricao,valor,'saida' as tipo,categoria FROM despesas WHERE strftime('%Y-%m',data_lancamento)=? ORDER BY data_lancamento",[mes]),
      ])
      var entradas = rs5[0].success ? rs5[0].rows : []
      var saidas   = rs5[1].success ? rs5[1].rows : []  // tabela despesas pode não existir
      var totalE = entradas.reduce(function(s,x){ return s+(x.valor||0) },0)
      var totalS = saidas.reduce(function(s,x){ return s+(x.valor||0) },0)
      var lanc = entradas.concat(saidas).sort(function(a,b){ return a.data>b.data?1:-1 })
      return res.json({ lancamentos:lanc, totalEntradas:totalE, totalSaidas:totalS, saldo:totalE-totalS, mes:mes })
    }

    // ── FLUXO DE CAIXA ───────────────────────────────────────────────────────
    if (r === 'fluxo-caixa') {
      result = await query(
        "SELECT strftime('%Y-%m',data_recebimento) as mes,SUM(valor) as receita,COUNT(*) as transacoes "+
        "FROM recebimentos WHERE strftime('%Y',data_recebimento)=? GROUP BY mes ORDER BY mes",
        [ano]
      )
      if (!result.success) return res.status(500).json({ error: result.error })
      return res.json({ fluxo: result.rows, ano: ano })
    }

    // ── METAS ────────────────────────────────────────────────────────────────
    if (r === 'metas') {
      var rs6 = await Promise.all([
        query("SELECT COALESCE(SUM(valor),0) as total FROM recebimentos WHERE strftime('%Y-%m',data_recebimento)=?",[mes]),
        query("SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_agendamento)=?",[mes]),
        query("SELECT COUNT(*) as total FROM pacientes WHERE strftime('%Y-%m',created_at)=?",[mes]),
      ])
      return res.json({
        mes: mes,
        receitaRealizada:        rs6[0].success ? rs6[0].rows[0].total : 0,
        agendamentosRealizados:  rs6[1].success ? rs6[1].rows[0].total : 0,
        novosPacientes:          rs6[2].success ? rs6[2].rows[0].total : 0,
      })
    }

    // ── AGENDA VIEW ──────────────────────────────────────────────────────────
    if (r === 'agenda-view') {
      var sqlAv, argsAv
      if (prof) {
        sqlAv = 'SELECT a.*,p.nome as paciente_nome,p.telefone as paciente_telefone,pr.nome as profissional_nome '+
                'FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id '+
                'WHERE DATE(a.data_agendamento)=? AND a.profissional_id=? ORDER BY a.data_agendamento'
        argsAv = [dia, prof]
      } else {
        sqlAv = 'SELECT a.*,p.nome as paciente_nome,p.telefone as paciente_telefone,pr.nome as profissional_nome '+
                'FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id '+
                'WHERE DATE(a.data_agendamento)=? ORDER BY pr.nome,a.data_agendamento'
        argsAv = [dia]
      }
      result = await query(sqlAv, argsAv)
      if (!result.success) return res.status(500).json({ error: result.error })
      return res.json({ agendamentos: result.rows, data: dia, total: result.rows.length })
    }

    // ── ROTA NÃO ENCONTRADA ──────────────────────────────────────────────────
    res.status(404).json({
      error: "Rota '"+r+"' não encontrada.",
      rotas: ['dashboard','pacientes','agendamentos','profissionais','financeiro',
              'crc','relatorios','busca','aniversariantes','conta-corrente',
              'fluxo-caixa','metas','db-status','agenda-view']
    })

  } catch(err) {
    console.error('[data.js] r='+r, err.message)
    res.status(500).json({ error: err.message, r: r })
  }
}
