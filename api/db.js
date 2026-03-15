// ═══════════════════════════════════════════════════════════
// KLINIK SISTEMA — Serverless Function para o Banco de Dados
// Arquivo: api/db.js (Vercel)
// ═══════════════════════════════════════════════════════════
// NOTA: Para Vercel, usa-se @vercel/kv, Turso (libSQL) ou
// Supabase como banco. Esta versão usa Turso (SQLite na nuvem)
// compatível 100% com o schema SQLite criado.

const { createClient } = require('@libsql/client')

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN || ''
})

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  const path = (req.query.path || '').split('/')
  const resource = path[0]
  const id = path[1]
  const { method } = req
  const q = req.query
  const body = req.body || {}
  const clinica_id = 1 // TODO: extrair do JWT

  try {

    // ── AGENDAMENTOS ──────────────────────────────────────
    if (resource === 'agendamentos') {
      if (method === 'GET' && !id) {
        let sql = `SELECT a.*, p.nome as paciente_nome, p.telefone as paciente_tel,
          pr.nome as profissional_nome, pr.cor_agenda
          FROM agendamentos a
          LEFT JOIN pacientes p ON p.id = a.paciente_id
          LEFT JOIN profissionais pr ON pr.id = a.profissional_id
          WHERE a.clinica_id = ? AND a.deleted = 0`
        const params = [clinica_id]
        if (q.data) { sql += ' AND a.data = ?'; params.push(q.data) }
        if (q.profissional_id) { sql += ' AND a.profissional_id = ?'; params.push(q.profissional_id) }
        sql += ' ORDER BY a.data DESC, a.hora_inicio ASC LIMIT 500'
        const r = await db.execute({ sql, args: params })
        return res.json({ ok: true, data: r.rows })
      }
      if (method === 'GET' && id === 'semana') {
        const hoje = new Date(), fim = new Date(hoje); fim.setDate(fim.getDate()+7)
        const r = await db.execute({ sql: `SELECT a.*, p.nome as paciente_nome, pr.nome as profissional_nome, pr.cor_agenda FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE a.clinica_id=? AND a.deleted=0 AND a.data BETWEEN ? AND ? ORDER BY a.data, a.hora_inicio`, args: [clinica_id, hoje.toISOString().slice(0,10), fim.toISOString().slice(0,10)] })
        return res.json({ ok: true, data: r.rows })
      }
      if (method === 'POST') {
        const r = await db.execute({ sql: `INSERT INTO agendamentos (clinica_id,paciente_id,profissional_id,data,hora_inicio,hora_fim,categoria,status,observacoes,primeira_consulta,como_conheceu) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, args: [clinica_id, body.paciente_id, body.profissional_id, body.data, body.hora_inicio, body.hora_fim||null, body.categoria||null, body.status||'agendado', body.observacoes||null, body.primeira_consulta||0, body.como_conheceu||null] })
        return res.json({ ok: true, id: r.lastInsertRowid })
      }
      if (method === 'PUT' && id) {
        await db.execute({ sql: `UPDATE agendamentos SET status=?,observacoes=?,updated_at=datetime('now') WHERE id=? AND clinica_id=?`, args: [body.status, body.observacoes, id, clinica_id] })
        return res.json({ ok: true })
      }
      if (method === 'DELETE' && id) {
        await db.execute({ sql: `UPDATE agendamentos SET deleted=1,updated_at=datetime('now') WHERE id=? AND clinica_id=?`, args: [id, clinica_id] })
        return res.json({ ok: true })
      }
    }

    // ── PACIENTES ─────────────────────────────────────────
    if (resource === 'pacientes') {
      if (method === 'GET' && id === 'inativos') {
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-6)
        const r = await db.execute({ sql: `SELECT p.*, MAX(a.data) as ultima_visita, CAST((julianday('now') - julianday(MAX(a.data))) AS INTEGER) as dias_ausente FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id AND a.deleted=0 WHERE p.clinica_id=? AND p.ativo=1 GROUP BY p.id HAVING ultima_visita IS NULL OR ultima_visita < ? ORDER BY dias_ausente DESC`, args: [clinica_id, cutoff.toISOString().slice(0,10)] })
        return res.json({ ok: true, data: r.rows })
      }
      if (method === 'GET' && id === 'aniversariantes') {
        const r = await db.execute({ sql: `SELECT *, strftime('%m-%d', data_nascimento) as mes_dia FROM pacientes WHERE clinica_id=? AND ativo=1 AND data_nascimento IS NOT NULL AND strftime('%m-%d', data_nascimento) BETWEEN strftime('%m-%d','now') AND strftime('%m-%d','now','+60 days') ORDER BY mes_dia`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }
      if (method === 'GET' && id && id !== 'inativos' && id !== 'aniversariantes') {
        const r = await db.execute({ sql: `SELECT * FROM pacientes WHERE id=? AND clinica_id=?`, args: [id, clinica_id] })
        return res.json({ ok: true, data: r.rows[0] || null })
      }
      if (method === 'GET') {
        let sql = `SELECT * FROM pacientes WHERE clinica_id=? AND ativo=1`
        const params = [clinica_id]
        if (q.q) { sql += ` AND nome LIKE ?`; params.push(`%${q.q}%`) }
        sql += ` ORDER BY nome LIMIT 200`
        const r = await db.execute({ sql, args: params })
        return res.json({ ok: true, data: r.rows })
      }
      if (method === 'POST') {
        const r = await db.execute({ sql: `INSERT INTO pacientes (clinica_id,nome,cpf,data_nascimento,sexo,estado_civil,telefone,whatsapp,email,endereco,cidade,bairro,cep,como_conheceu,convenio) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [clinica_id,body.nome,body.cpf||null,body.data_nascimento||null,body.sexo||null,body.estado_civil||null,body.telefone||null,body.whatsapp||null,body.email||null,body.endereco||null,body.cidade||null,body.bairro||null,body.cep||null,body.como_conheceu||null,body.convenio||null] })
        return res.json({ ok: true, id: r.lastInsertRowid })
      }
      if (method === 'PUT' && id) {
        await db.execute({ sql: `UPDATE pacientes SET nome=?,cpf=?,data_nascimento=?,sexo=?,telefone=?,whatsapp=?,email=?,como_conheceu=?,updated_at=datetime('now') WHERE id=? AND clinica_id=?`, args: [body.nome,body.cpf,body.data_nascimento,body.sexo,body.telefone,body.whatsapp,body.email,body.como_conheceu,id,clinica_id] })
        return res.json({ ok: true })
      }
    }

    // ── FINANCEIRO: LANÇAMENTOS ───────────────────────────
    if (resource === 'financeiro') {
      const sub = path[1], subid = path[2]

      if (sub === 'lancamentos') {
        if (method === 'GET') {
          let sql = `SELECT l.*, p.nome as paciente_nome_ref FROM lancamentos l LEFT JOIN pacientes p ON p.id=l.paciente_id WHERE l.clinica_id=?`
          const params = [clinica_id]
          if (q.data_de) { sql += ' AND l.data >= ?'; params.push(q.data_de) }
          if (q.data_ate) { sql += ' AND l.data <= ?'; params.push(q.data_ate) }
          if (q.tipo) { sql += ' AND l.tipo = ?'; params.push(q.tipo) }
          sql += ' ORDER BY l.data DESC, l.hora DESC LIMIT 500'
          const r = await db.execute({ sql, args: params })
          return res.json({ ok: true, data: r.rows })
        }
        if (method === 'POST') {
          const r = await db.execute({ sql: `INSERT INTO lancamentos (clinica_id,data,hora,tipo,forma_pagamento,descricao,paciente_id,paciente_nome,valor,classificacao,categoria,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, args: [clinica_id,body.data,body.hora||null,body.tipo,body.forma_pagamento||null,body.descricao||null,body.paciente_id||null,body.paciente_nome||null,body.valor,body.classificacao||null,body.categoria||null,body.status||'realizado'] })
          return res.json({ ok: true, id: r.lastInsertRowid })
        }
      }

      if (sub === 'contas-pagar') {
        if (method === 'GET') {
          let sql = `SELECT * FROM contas_pagar WHERE clinica_id=?`
          const params = [clinica_id]
          if (q.data_de) { sql += ' AND vencimento >= ?'; params.push(q.data_de) }
          if (q.data_ate) { sql += ' AND vencimento <= ?'; params.push(q.data_ate) }
          sql += ' ORDER BY vencimento ASC'
          const r = await db.execute({ sql, args: params })
          return res.json({ ok: true, data: r.rows })
        }
        if (method === 'POST') {
          const r = await db.execute({ sql: `INSERT INTO contas_pagar (clinica_id,descricao,fornecedor,valor,vencimento,classificacao,categoria,status,recorrente) VALUES (?,?,?,?,?,?,?,?,?)`, args: [clinica_id,body.descricao,body.fornecedor||null,body.valor,body.vencimento,body.classificacao||null,body.categoria||null,body.status||'aberta',body.recorrente||0] })
          return res.json({ ok: true, id: r.lastInsertRowid })
        }
        if (method === 'PUT' && subid) {
          await db.execute({ sql: `UPDATE contas_pagar SET status=?,pagamento=datetime('now') WHERE id=? AND clinica_id=?`, args: [body.status||'paga', subid, clinica_id] })
          return res.json({ ok: true })
        }
      }

      if (sub === 'contas-receber') {
        const r = await db.execute({ sql: `SELECT cr.*, p.nome as paciente_nome_ref FROM contas_receber cr LEFT JOIN pacientes p ON p.id=cr.paciente_id WHERE cr.clinica_id=? ORDER BY cr.vencimento ASC`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }

      if (sub === 'boletos') {
        const r = await db.execute({ sql: `SELECT b.*, p.nome as paciente_nome_ref FROM boletos b LEFT JOIN pacientes p ON p.id=b.paciente_id WHERE b.clinica_id=? ORDER BY b.vencimento DESC`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }

      if (sub === 'cartoes') {
        const r = await db.execute({ sql: `SELECT c.*, p.nome as paciente_nome_ref FROM cartoes c LEFT JOIN pacientes p ON p.id=c.paciente_id WHERE c.clinica_id=? ORDER BY c.vencimento DESC`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }

      if (sub === 'planos') {
        const r = await db.execute({ sql: `SELECT pc.*, p.nome as paciente_nome_ref FROM planos_convenio pc LEFT JOIN pacientes p ON p.id=pc.paciente_id WHERE pc.clinica_id=? ORDER BY pc.data DESC`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }

      if (sub === 'extrato') {
        const r = await db.execute({ sql: `SELECT * FROM extrato WHERE clinica_id=? ORDER BY data DESC, hora DESC`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }

      if (sub === 'resumo') {
        const r1 = await db.execute({ sql: `SELECT SUM(CASE WHEN tipo IN ('Entrada','Vendas') THEN valor ELSE 0 END) as total_entrada, SUM(CASE WHEN tipo='Saída' THEN valor ELSE 0 END) as total_saida, COUNT(*) as total FROM lancamentos WHERE clinica_id=? AND data >= date('now','-30 days')`, args: [clinica_id] })
        const r2 = await db.execute({ sql: `SELECT COUNT(*) as total_ag, COUNT(CASE WHEN status='faltou' THEN 1 END) as faltas FROM agendamentos WHERE clinica_id=? AND data >= date('now','-30 days')`, args: [clinica_id] })
        const r3 = await db.execute({ sql: `SELECT SUM(valor) as total_pagar FROM contas_pagar WHERE clinica_id=? AND status='aberta'`, args: [clinica_id] })
        const r4 = await db.execute({ sql: `SELECT SUM(valor) as total_receber FROM contas_receber WHERE clinica_id=? AND status IN ('aberta','vencida')`, args: [clinica_id] })
        return res.json({ ok: true, data: { ...r1.rows[0], ...r2.rows[0], ...r3.rows[0], ...r4.rows[0] } })
      }

      if (sub === 'fluxo-caixa') {
        const mes = q.mes || new Date().getMonth()+1
        const ano = q.ano || new Date().getFullYear()
        const r = await db.execute({ sql: `SELECT data, SUM(CASE WHEN tipo IN ('Entrada','Vendas') THEN valor ELSE 0 END) as entrada, SUM(CASE WHEN tipo='Saída' THEN valor ELSE 0 END) as saida FROM lancamentos WHERE clinica_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=? GROUP BY data ORDER BY data`, args: [clinica_id, String(mes).padStart(2,'0'), String(ano)] })
        return res.json({ ok: true, data: r.rows })
      }
    }

    // ── PROFISSIONAIS ────────────────────────────────────
    if (resource === 'profissionais') {
      if (method === 'GET' && !id) {
        const r = await db.execute({ sql: `SELECT * FROM profissionais WHERE clinica_id=? AND ativo=1 ORDER BY nome`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }
    }

    // ── CRC ───────────────────────────────────────────────
    if (resource === 'crc') {
      if (path[1] === 'inativos') {
        const r = await db.execute({ sql: `SELECT p.id, p.nome, p.telefone, p.whatsapp, MAX(a.data) as ultima_visita, CAST((julianday('now') - julianday(MAX(a.data))) AS INTEGER) as dias_ausente, CASE WHEN (julianday('now') - julianday(MAX(a.data))) > 365 THEN 'urgente' WHEN (julianday('now') - julianday(MAX(a.data))) > 270 THEN 'alta' ELSE 'media' END as prioridade FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id AND a.deleted=0 WHERE p.clinica_id=? AND p.ativo=1 GROUP BY p.id HAVING ultima_visita IS NULL OR ultima_visita <= date('now','-180 days') ORDER BY dias_ausente DESC LIMIT 200`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }
      if (path[1] === 'alertas') {
        const r = await db.execute({ sql: `SELECT ar.*, p.nome as paciente_nome, p.telefone FROM alertas_retorno ar LEFT JOIN pacientes p ON p.id=ar.paciente_id WHERE ar.clinica_id=? AND ar.status='pendente' ORDER BY ar.data_alerta`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }
    }

    // ── METAS ────────────────────────────────────────────
    if (resource === 'metas') {
      const r = await db.execute({ sql: `SELECT m.*, pr.nome as profissional_nome FROM metas m LEFT JOIN profissionais pr ON pr.id=m.profissional_id WHERE m.clinica_id=? AND m.mes=? AND m.ano=?`, args: [clinica_id, q.mes||3, q.ano||2026] })
      return res.json({ ok: true, data: r.rows })
    }

    // ── CONFIGURAÇÕES ────────────────────────────────────
    if (resource === 'configuracoes') {
      if (method === 'GET') {
        const r = await db.execute({ sql: `SELECT * FROM configuracoes WHERE clinica_id=?`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }
      if (method === 'POST') {
        await db.execute({ sql: `INSERT INTO configuracoes (clinica_id,chave,valor) VALUES (?,?,?) ON CONFLICT(clinica_id,chave) DO UPDATE SET valor=excluded.valor,updated_at=datetime('now')`, args: [clinica_id, body.chave, body.valor] })
        return res.json({ ok: true })
      }
    }

    // ── TABELAS DE PREÇO ─────────────────────────────────
    if (resource === 'tabelas-preco') {
      if (path[1] === 'itens') {
        const r = await db.execute({ sql: `SELECT * FROM tabelas_preco_itens WHERE tabela_id=? ORDER BY descricao`, args: [q.tabela_id||1] })
        return res.json({ ok: true, data: r.rows })
      }
      const r = await db.execute({ sql: `SELECT * FROM tabelas_preco WHERE clinica_id=? AND ativo=1`, args: [clinica_id] })
      return res.json({ ok: true, data: r.rows })
    }

    // ── ESTOQUE ──────────────────────────────────────────
    if (resource === 'estoque') {
      if (path[1] === 'movimentacao' && method === 'POST') {
        await db.execute({ sql: `INSERT INTO estoque_movimentacao (estoque_id,tipo,quantidade,motivo) VALUES (?,?,?,?)`, args: [body.estoque_id,body.tipo,body.quantidade,body.motivo||null] })
        const op = body.tipo === 'entrada' ? '+' : '-'
        await db.execute({ sql: `UPDATE estoque SET quantidade=quantidade${op}?,updated_at=datetime('now') WHERE id=?`, args: [body.quantidade,body.estoque_id] })
        return res.json({ ok: true })
      }
      const r = await db.execute({ sql: `SELECT * FROM estoque WHERE clinica_id=? ORDER BY produto`, args: [clinica_id] })
      return res.json({ ok: true, data: r.rows })
    }

    // ── RELATÓRIOS ───────────────────────────────────────
    if (resource === 'relatorios') {
      if (path[1] === 'producao') {
        const r = await db.execute({ sql: `SELECT strftime('%Y-%m', data) as mes, SUM(CASE WHEN tipo IN ('Entrada','Vendas') THEN valor ELSE 0 END) as faturamento, COUNT(DISTINCT paciente_id) as pacientes FROM lancamentos WHERE clinica_id=? AND data >= date('now','-12 months') GROUP BY mes ORDER BY mes`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }
      if (path[1] === 'profissionais') {
        const r = await db.execute({ sql: `SELECT pr.nome, COUNT(a.id) as total_ag, COUNT(CASE WHEN a.status='realizado' THEN 1 END) as realizados FROM profissionais pr LEFT JOIN agendamentos a ON a.profissional_id=pr.id AND a.clinica_id=pr.clinica_id AND a.deleted=0 WHERE pr.clinica_id=? GROUP BY pr.id ORDER BY realizados DESC`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }
      if (path[1] === 'inadimplencia') {
        const r = await db.execute({ sql: `SELECT p.nome, cr.valor, cr.vencimento, cr.forma_pagamento, cr.status FROM contas_receber cr LEFT JOIN pacientes p ON p.id=cr.paciente_id WHERE cr.clinica_id=? AND cr.status IN ('vencida','aberta') ORDER BY cr.vencimento`, args: [clinica_id] })
        return res.json({ ok: true, data: r.rows })
      }
    }

    res.status(404).json({ ok: false, error: `Endpoint não encontrado: ${resource}` })

  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: err.message })
  }
}
