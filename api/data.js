// api/data.js — Router consolidado para TODAS as consultas de dados
// CommonJS para compatibilidade com Vercel Hobby (Node.js serverless)

const { createClient } = require("@libsql/client");

function getDb() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { r, q, mes, ano, profissional, data, dataInicio, dataFim, limit } = req.query;

  if (!r) {
    return res.status(400).json({
      error: "Parâmetro 'r' obrigatório. Ex: /api/data?r=dashboard",
      rotas: [
        "dashboard","pacientes","agendamentos","profissionais",
        "financeiro","crc","relatorios","busca","aniversariantes",
        "conta-corrente","fluxo-caixa","metas","db-status","agenda-view"
      ]
    });
  }

  const db = getDb();

  try {
    switch (r) {

      // ── DASHBOARD ────────────────────────────────────────────────────────
      case "dashboard": {
        const hoje = new Date().toISOString().slice(0, 10);
        const mesAtual = hoje.slice(0, 7);
        const [p, a, ah, rm, am, pr] = await Promise.all([
          db.execute("SELECT COUNT(*) as total FROM pacientes"),
          db.execute("SELECT COUNT(*) as total FROM agendamentos"),
          db.execute("SELECT COUNT(*) as total FROM agendamentos WHERE DATE(data_agendamento) = ?", [hoje]),
          db.execute("SELECT COALESCE(SUM(valor),0) as total FROM recebimentos WHERE strftime('%Y-%m',data_recebimento)=?", [mesAtual]),
          db.execute("SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_agendamento)=?", [mesAtual]),
          db.execute("SELECT COUNT(*) as total FROM profissionais WHERE ativo=1"),
        ]);
        return res.json({
          totalPacientes: p.rows[0].total,
          totalAgendamentos: a.rows[0].total,
          agendamentosHoje: ah.rows[0].total,
          receitaMes: rm.rows[0].total,
          agendamentosMes: am.rows[0].total,
          profissionaisAtivos: pr.rows[0].total,
        });
      }

      // ── PACIENTES ────────────────────────────────────────────────────────
      case "pacientes": {
        const lim = parseInt(limit) || 100;
        let sql, args = [];
        if (q) {
          const like = `%${q}%`;
          sql = `SELECT p.id,p.nome,p.cpf,p.telefone,p.email,p.data_nascimento,p.created_at,
                        COUNT(a.id) as total_agendamentos, MAX(a.data_agendamento) as ultimo_agendamento
                 FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id
                 WHERE p.nome LIKE ? OR p.cpf LIKE ? OR p.telefone LIKE ?
                 GROUP BY p.id ORDER BY p.nome LIMIT ${lim}`;
          args = [like, like, like];
        } else {
          sql = `SELECT p.id,p.nome,p.cpf,p.telefone,p.email,p.data_nascimento,p.created_at,
                        COUNT(a.id) as total_agendamentos, MAX(a.data_agendamento) as ultimo_agendamento
                 FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id
                 GROUP BY p.id ORDER BY p.nome LIMIT ${lim}`;
        }
        const result = await db.execute(sql, args);
        return res.json({ pacientes: result.rows, total: result.rows.length });
      }

      // ── AGENDAMENTOS ─────────────────────────────────────────────────────
      case "agendamentos": {
        const lim = parseInt(limit) || 200;
        let sql, args = [];
        if (data) {
          sql = `SELECT a.*,p.nome as paciente_nome,pr.nome as profissional_nome
                 FROM agendamentos a
                 LEFT JOIN pacientes p ON p.id=a.paciente_id
                 LEFT JOIN profissionais pr ON pr.id=a.profissional_id
                 WHERE DATE(a.data_agendamento)=? ORDER BY a.data_agendamento`;
          args = [data];
        } else if (dataInicio && dataFim) {
          sql = `SELECT a.*,p.nome as paciente_nome,pr.nome as profissional_nome
                 FROM agendamentos a
                 LEFT JOIN pacientes p ON p.id=a.paciente_id
                 LEFT JOIN profissionais pr ON pr.id=a.profissional_id
                 WHERE DATE(a.data_agendamento) BETWEEN ? AND ?
                 ORDER BY a.data_agendamento DESC LIMIT ${lim}`;
          args = [dataInicio, dataFim];
        } else {
          const m = mes || new Date().toISOString().slice(0, 7);
          sql = `SELECT a.*,p.nome as paciente_nome,pr.nome as profissional_nome
                 FROM agendamentos a
                 LEFT JOIN pacientes p ON p.id=a.paciente_id
                 LEFT JOIN profissionais pr ON pr.id=a.profissional_id
                 WHERE strftime('%Y-%m',a.data_agendamento)=?
                 ORDER BY a.data_agendamento DESC LIMIT ${lim}`;
          args = [m];
        }
        const result = await db.execute(sql, args);
        return res.json({ agendamentos: result.rows, total: result.rows.length });
      }

      // ── PROFISSIONAIS ────────────────────────────────────────────────────
      case "profissionais": {
        const result = await db.execute(
          `SELECT p.*,COUNT(a.id) as total_agendamentos
           FROM profissionais p LEFT JOIN agendamentos a ON a.profissional_id=p.id
           GROUP BY p.id ORDER BY p.nome`
        );
        return res.json({ profissionais: result.rows });
      }

      // ── FINANCEIRO ───────────────────────────────────────────────────────
      case "financeiro": {
        const m = mes || new Date().toISOString().slice(0, 7);
        const [rec, porProf, porForma] = await Promise.all([
          db.execute(
            `SELECT r.*,p.nome as paciente_nome,pr.nome as profissional_nome
             FROM recebimentos r
             LEFT JOIN pacientes p ON p.id=r.paciente_id
             LEFT JOIN profissionais pr ON pr.id=r.profissional_id
             WHERE strftime('%Y-%m',r.data_recebimento)=? ORDER BY r.data_recebimento DESC`, [m]
          ),
          db.execute(
            `SELECT pr.nome,COALESCE(SUM(r.valor),0) as total,COUNT(r.id) as qtd
             FROM profissionais pr
             LEFT JOIN recebimentos r ON r.profissional_id=pr.id AND strftime('%Y-%m',r.data_recebimento)=?
             GROUP BY pr.id ORDER BY total DESC`, [m]
          ),
          db.execute(
            `SELECT forma_pagamento,COALESCE(SUM(valor),0) as total,COUNT(*) as qtd
             FROM recebimentos WHERE strftime('%Y-%m',data_recebimento)=?
             GROUP BY forma_pagamento ORDER BY total DESC`, [m]
          ),
        ]);
        const totalMes = rec.rows.reduce((s, x) => s + (x.valor || 0), 0);
        return res.json({
          recebimentos: rec.rows, porProfissional: porProf.rows,
          porFormaPagamento: porForma.rows, totalMes, mes: m
        });
      }

      // ── CRC ──────────────────────────────────────────────────────────────
      case "crc": {
        const result = await db.execute(
          `SELECT p.id,p.nome,p.telefone,p.email,
                  MAX(a.data_agendamento) as ultimo_agendamento,
                  COUNT(a.id) as total_consultas,
                  CAST(julianday('now')-julianday(MAX(a.data_agendamento)) AS INTEGER) as dias_ausente
           FROM pacientes p LEFT JOIN agendamentos a ON a.paciente_id=p.id
           GROUP BY p.id HAVING ultimo_agendamento IS NOT NULL
           ORDER BY dias_ausente DESC LIMIT 200`
        );
        return res.json({ pacientes: result.rows, total: result.rows.length });
      }

      // ── RELATÓRIOS ───────────────────────────────────────────────────────
      case "relatorios": {
        const m = mes || new Date().toISOString().slice(0, 7);
        const a2 = ano || m.slice(0, 4);
        const [rm, rs, np, tp] = await Promise.all([
          db.execute(`SELECT strftime('%Y-%m',data_recebimento) as mes,SUM(valor) as total,COUNT(*) as qtd FROM recebimentos WHERE strftime('%Y',data_recebimento)=? GROUP BY mes ORDER BY mes`, [a2]),
          db.execute(`SELECT status,COUNT(*) as qtd FROM agendamentos WHERE strftime('%Y-%m',data_agendamento)=? GROUP BY status`, [m]),
          db.execute(`SELECT strftime('%Y-%m',created_at) as mes,COUNT(*) as total FROM pacientes WHERE strftime('%Y',created_at)=? GROUP BY mes ORDER BY mes`, [a2]),
          db.execute(`SELECT procedimento,COUNT(*) as qtd FROM agendamentos WHERE strftime('%Y-%m',data_agendamento)=? AND procedimento IS NOT NULL AND procedimento!='' GROUP BY procedimento ORDER BY qtd DESC LIMIT 10`, [m]),
        ]);
        return res.json({
          receitaMensal: rm.rows, agendamentosPorStatus: rs.rows,
          novosPacientesMes: np.rows, topProcedimentos: tp.rows, mes: m, ano: a2
        });
      }

      // ── BUSCA GLOBAL ─────────────────────────────────────────────────────
      case "busca": {
        if (!q) return res.status(400).json({ error: "Parâmetro 'q' obrigatório" });
        const like = `%${q}%`;
        const [pac, agend] = await Promise.all([
          db.execute(`SELECT id,nome,cpf,telefone,email FROM pacientes WHERE nome LIKE ? OR cpf LIKE ? OR telefone LIKE ? LIMIT 20`, [like, like, like]),
          db.execute(`SELECT a.id,a.data_agendamento,a.status,a.procedimento,p.nome as paciente_nome,pr.nome as profissional_nome FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id WHERE p.nome LIKE ? OR a.procedimento LIKE ? ORDER BY a.data_agendamento DESC LIMIT 20`, [like, like]),
        ]);
        return res.json({ pacientes: pac.rows, agendamentos: agend.rows, query: q });
      }

      // ── ANIVERSARIANTES ──────────────────────────────────────────────────
      case "aniversariantes": {
        const m = mes || String(new Date().getMonth() + 1).padStart(2, "0");
        const result = await db.execute(
          `SELECT id,nome,telefone,email,data_nascimento,strftime('%d',data_nascimento) as dia
           FROM pacientes WHERE strftime('%m',data_nascimento)=? AND data_nascimento IS NOT NULL
           ORDER BY strftime('%d',data_nascimento)`, [m]
        );
        return res.json({ aniversariantes: result.rows, mes: m, total: result.rows.length });
      }

      // ── CONTA CORRENTE ───────────────────────────────────────────────────
      case "conta-corrente": {
        const m = mes || new Date().toISOString().slice(0, 7);
        const [entradas, saidas] = await Promise.all([
          db.execute(`SELECT data_recebimento as data,descricao,valor,'entrada' as tipo,forma_pagamento FROM recebimentos WHERE strftime('%Y-%m',data_recebimento)=? ORDER BY data_recebimento`, [m]),
          db.execute(`SELECT data_lancamento as data,descricao,valor,'saida' as tipo,categoria FROM despesas WHERE strftime('%Y-%m',data_lancamento)=? ORDER BY data_lancamento`, [m]).catch(() => ({ rows: [] })),
        ]);
        const totalEntradas = entradas.rows.reduce((s, x) => s + (x.valor || 0), 0);
        const totalSaidas = saidas.rows.reduce((s, x) => s + (x.valor || 0), 0);
        const lancamentos = [...entradas.rows, ...saidas.rows].sort((a, b) => a.data > b.data ? 1 : -1);
        return res.json({ lancamentos, totalEntradas, totalSaidas, saldo: totalEntradas - totalSaidas, mes: m });
      }

      // ── FLUXO DE CAIXA ───────────────────────────────────────────────────
      case "fluxo-caixa": {
        const a2 = ano || new Date().getFullYear().toString();
        const result = await db.execute(
          `SELECT strftime('%Y-%m',data_recebimento) as mes,SUM(valor) as receita,COUNT(*) as transacoes
           FROM recebimentos WHERE strftime('%Y',data_recebimento)=? GROUP BY mes ORDER BY mes`, [a2]
        );
        return res.json({ fluxo: result.rows, ano: a2 });
      }

      // ── METAS ────────────────────────────────────────────────────────────
      case "metas": {
        const m = mes || new Date().toISOString().slice(0, 7);
        const [receita, agend, novosPac] = await Promise.all([
          db.execute(`SELECT COALESCE(SUM(valor),0) as total FROM recebimentos WHERE strftime('%Y-%m',data_recebimento)=?`, [m]),
          db.execute(`SELECT COUNT(*) as total FROM agendamentos WHERE strftime('%Y-%m',data_agendamento)=?`, [m]),
          db.execute(`SELECT COUNT(*) as total FROM pacientes WHERE strftime('%Y-%m',created_at)=?`, [m]),
        ]);
        return res.json({ mes: m, receitaRealizada: receita.rows[0].total, agendamentosRealizados: agend.rows[0].total, novosPacientes: novosPac.rows[0].total });
      }

      // ── DB STATUS ────────────────────────────────────────────────────────
     case "db-status": {
  const tables = await db.execute(
    `SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name`
  );
  return res.json({
    status: "ok",
    tables: tables.rows.map(t => ({
      name: t.name,
      columns: (t.sql || "").match(/^\s+(\w+)\s/gm)?.map(c => c.trim()) || []
    }))
  });
}
        });
      }

      // ── AGENDA VIEW ──────────────────────────────────────────────────────
      case "agenda-view": {
        const d = data || new Date().toISOString().slice(0, 10);
        let sql, args;
        if (profissional) {
          sql = `SELECT a.*,p.nome as paciente_nome,p.telefone as paciente_telefone,pr.nome as profissional_nome
                 FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id
                 WHERE DATE(a.data_agendamento)=? AND a.profissional_id=? ORDER BY a.data_agendamento`;
          args = [d, profissional];
        } else {
          sql = `SELECT a.*,p.nome as paciente_nome,p.telefone as paciente_telefone,pr.nome as profissional_nome
                 FROM agendamentos a LEFT JOIN pacientes p ON p.id=a.paciente_id LEFT JOIN profissionais pr ON pr.id=a.profissional_id
                 WHERE DATE(a.data_agendamento)=? ORDER BY pr.nome,a.data_agendamento`;
          args = [d];
        }
        const result = await db.execute(sql, args);
        return res.json({ agendamentos: result.rows, data: d, total: result.rows.length });
      }

      default:
        return res.status(404).json({
          error: `Rota '${r}' não encontrada.`,
          rotas: ["dashboard","pacientes","agendamentos","profissionais","financeiro","crc","relatorios","busca","aniversariantes","conta-corrente","fluxo-caixa","metas","db-status","agenda-view"]
        });
    }
  } catch (err) {
    console.error(`[data.js] r=${r}`, err);
    return res.status(500).json({ error: err.message, r });
  }
};
