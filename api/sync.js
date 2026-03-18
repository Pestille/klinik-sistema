// api/sync.js — Router consolidado para TODOS os syncs Clinicorp → Turso
// CommonJS para compatibilidade com Vercel Hobby

const { createClient } = require("@libsql/client");

const CLINICORP_BASE = "https://api.clinicorp.com/rest/v1";
const CLINICORP_AUTH = `Basic ${process.env.CLINICORP_TOKEN || "a2xpbmlrOjIzYjczZGQwLWYzYTktNGFlZi05N2ZmLTlkYjU2N2QyODNiNQ=="}`;
const BUSINESS_ID = process.env.CLINICORP_BUSINESS_ID || "5073030694043648";

function getDb() {
  return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
}

async function clinicorpFetch(path, params = {}) {
  const url = new URL(`${CLINICORP_BASE}${path}`);
  url.searchParams.set("businessId", BUSINESS_ID);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString(), {
    headers: { Authorization: CLINICORP_AUTH, "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new Error(`Clinicorp ${path} → HTTP ${resp.status}`);
  return resp.json();
}

async function syncProfissionais(db) {
  const data = await clinicorpFetch("/professionals");
  const list = data.professionals || data.data || [];
  let inseridos = 0, atualizados = 0;
  for (const p of list) {
    const existe = await db.execute("SELECT id FROM profissionais WHERE clinicorp_id=?", [String(p.id)]);
    if (existe.rows.length > 0) {
      await db.execute(
        `UPDATE profissionais SET nome=?,especialidade=?,ativo=?,updated_at=datetime('now') WHERE clinicorp_id=?`,
        [p.name||p.nome, p.specialty||p.especialidade||null, p.active!==false?1:0, String(p.id)]
      );
      atualizados++;
    } else {
      await db.execute(
        `INSERT INTO profissionais(clinicorp_id,nome,especialidade,ativo,created_at,updated_at) VALUES(?,?,?,?,datetime('now'),datetime('now'))`,
        [String(p.id), p.name||p.nome, p.specialty||p.especialidade||null, p.active!==false?1:0]
      );
      inseridos++;
    }
  }
  return { tipo: "profissionais", total: list.length, inseridos, atualizados };
}

async function syncPacientes(db, pagina) {
  const pageSize = 100;
  const pg = parseInt(pagina) || 1;
  const data = await clinicorpFetch("/patients", { page: pg, pageSize });
  const list = data.patients || data.data || [];
  const temMais = list.length === pageSize;
  let inseridos = 0, atualizados = 0;
  for (const p of list) {
    const existe = await db.execute("SELECT id FROM pacientes WHERE clinicorp_id=?", [String(p.id)]);
    const nasc = p.birthDate||p.dataNascimento||p.birth_date||null;
    const cpf = p.cpf||p.document||null;
    if (existe.rows.length > 0) {
      await db.execute(
        `UPDATE pacientes SET nome=?,cpf=?,telefone=?,email=?,data_nascimento=?,updated_at=datetime('now') WHERE clinicorp_id=?`,
        [p.name||p.nome, cpf, p.phone||p.telefone||null, p.email||null, nasc, String(p.id)]
      );
      atualizados++;
    } else {
      await db.execute(
        `INSERT INTO pacientes(clinicorp_id,nome,cpf,telefone,email,data_nascimento,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))`,
        [String(p.id), p.name||p.nome, cpf, p.phone||p.telefone||null, p.email||null, nasc]
      );
      inseridos++;
    }
  }
  return { tipo: "pacientes", pagina: pg, processados: list.length, inseridos, atualizados, temMaisPaginas: temMais, proximaPagina: temMais ? pg+1 : null };
}

async function syncAgendamentos(db, dataInicio, dataFim) {
  const hoje = new Date();
  const inicio = dataInicio || new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0,10);
  const fim = dataFim || new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().slice(0,10);
  const data = await clinicorpFetch("/appointments", { startDate: inicio, endDate: fim });
  const list = data.appointments || data.data || [];
  let inseridos = 0, atualizados = 0;
  for (const a of list) {
    let pacienteId = null, profissionalId = null;
    if (a.patientId || a.patient?.id) {
      const r = await db.execute("SELECT id FROM pacientes WHERE clinicorp_id=?", [String(a.patientId||a.patient.id)]);
      if (r.rows.length > 0) pacienteId = r.rows[0].id;
    }
    if (a.professionalId || a.professional?.id) {
      const r = await db.execute("SELECT id FROM profissionais WHERE clinicorp_id=?", [String(a.professionalId||a.professional.id)]);
      if (r.rows.length > 0) profissionalId = r.rows[0].id;
    }
    const existe = await db.execute("SELECT id FROM agendamentos WHERE clinicorp_id=?", [String(a.id)]);
    const dataAgend = a.date||a.dateTime||a.data||a.startDate||null;
    const status = a.status||"agendado";
    const proc = a.procedure||a.service||a.procedimento||null;
    if (existe.rows.length > 0) {
      await db.execute(
        `UPDATE agendamentos SET paciente_id=?,profissional_id=?,data_agendamento=?,status=?,procedimento=?,updated_at=datetime('now') WHERE clinicorp_id=?`,
        [pacienteId, profissionalId, dataAgend, status, proc, String(a.id)]
      );
      atualizados++;
    } else {
      await db.execute(
        `INSERT INTO agendamentos(clinicorp_id,paciente_id,profissional_id,data_agendamento,status,procedimento,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))`,
        [String(a.id), pacienteId, profissionalId, dataAgend, status, proc]
      );
      inseridos++;
    }
  }
  return { tipo: "agendamentos", periodo: `${inicio} → ${fim}`, total: list.length, inseridos, atualizados };
}

async function syncFinanceiro(db, dataInicio, dataFim) {
  const hoje = new Date();
  const inicio = dataInicio || new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0,10);
  const fim = dataFim || new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().slice(0,10);
  const data = await clinicorpFetch("/financial/receipts", { startDate: inicio, endDate: fim });
  const list = data.receipts || data.data || [];
  let inseridos = 0, atualizados = 0;
  for (const r of list) {
    let pacienteId = null, profissionalId = null;
    if (r.patientId || r.patient?.id) {
      const res = await db.execute("SELECT id FROM pacientes WHERE clinicorp_id=?", [String(r.patientId||r.patient.id)]);
      if (res.rows.length > 0) pacienteId = res.rows[0].id;
    }
    if (r.professionalId || r.professional?.id) {
      const res = await db.execute("SELECT id FROM profissionais WHERE clinicorp_id=?", [String(r.professionalId||r.professional.id)]);
      if (res.rows.length > 0) profissionalId = res.rows[0].id;
    }
    const existe = await db.execute("SELECT id FROM recebimentos WHERE clinicorp_id=?", [String(r.id)]);
    const valor = parseFloat(r.value||r.amount||r.valor||0);
    const dataRec = r.date||r.paymentDate||r.data||null;
    const forma = r.paymentMethod||r.formaPagamento||r.method||null;
    const desc = r.description||r.descricao||null;
    if (existe.rows.length > 0) {
      await db.execute(
        `UPDATE recebimentos SET paciente_id=?,profissional_id=?,valor=?,data_recebimento=?,forma_pagamento=?,descricao=?,updated_at=datetime('now') WHERE clinicorp_id=?`,
        [pacienteId, profissionalId, valor, dataRec, forma, desc, String(r.id)]
      );
      atualizados++;
    } else {
      await db.execute(
        `INSERT INTO recebimentos(clinicorp_id,paciente_id,profissional_id,valor,data_recebimento,forma_pagamento,descricao,created_at,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
        [String(r.id), pacienteId, profissionalId, valor, dataRec, forma, desc]
      );
      inseridos++;
    }
  }
  return { tipo: "financeiro", periodo: `${inicio} → ${fim}`, total: list.length, inseridos, atualizados };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const params = req.method === "POST" ? (req.body || {}) : req.query;
  const { tipo, pagina, dataInicio, dataFim } = params;

  if (!tipo) {
    return res.status(400).json({ error: "Parâmetro 'tipo' obrigatório.", tipos: ["profissionais","pacientes","agendamentos","financeiro","todos"] });
  }

  const db = getDb();
  const t0 = Date.now();
  try {
    let resultado;
    if (tipo === "todos") {
      const r1 = await syncProfissionais(db);
      const r2 = await syncAgendamentos(db, dataInicio, dataFim);
      const r3 = await syncFinanceiro(db, dataInicio, dataFim);
      resultado = { sincs: [r1, r2, r3], aviso: "Pacientes omitidos — use tipo=pacientes paginado" };
    } else if (tipo === "profissionais") {
      resultado = await syncProfissionais(db);
    } else if (tipo === "pacientes") {
      resultado = await syncPacientes(db, pagina || 1);
    } else if (tipo === "agendamentos") {
      resultado = await syncAgendamentos(db, dataInicio, dataFim);
    } else if (tipo === "financeiro") {
      resultado = await syncFinanceiro(db, dataInicio, dataFim);
    } else {
      return res.status(404).json({ error: `Tipo '${tipo}' não encontrado.` });
    }
    return res.json({ success: true, duracao_ms: Date.now()-t0, timestamp: new Date().toISOString(), ...resultado });
  } catch (err) {
    console.error(`[sync.js] tipo=${tipo}`, err);
    return res.status(500).json({ error: err.message, tipo });
  }
};
