// lib/migrations.js — Migrations versionadas do banco (Turso/libSQL)
// Klinov — Campo Grande, MS
//
// Cada migration roda uma única vez por banco e fica registrada em
// schema_migrations. Para mudar o schema, ADICIONE uma nova entrada no fim da
// lista (nunca edite uma já aplicada). Os statements devem ser idempotentes
// (CREATE ... IF NOT EXISTS); ALTER TABLE ADD COLUMN repetido é tolerado.

var MIGRATIONS = [
    {
        id: '2026-10-14-001-lixeira',
        up: [
            "CREATE TABLE IF NOT EXISTS lixeira (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, tipo TEXT NOT NULL, tabela TEXT NOT NULL, registro_id INTEGER NOT NULL, descricao TEXT, dados_json TEXT NOT NULL, filhos_json TEXT, excluido_por INTEGER, excluido_por_nome TEXT, excluido_em TEXT DEFAULT (datetime('now')), restaurado_em TEXT)",
            "CREATE INDEX IF NOT EXISTS idx_lixeira_clinica ON lixeira(clinica_id, restaurado_em, excluido_em)"
        ]
    },
    {
        id: '2026-10-14-002-usuarios-token-redefinir',
        up: [
            "ALTER TABLE usuarios ADD COLUMN token_redefinir TEXT",
            "ALTER TABLE usuarios ADD COLUMN token_redefinir_expira TEXT"
        ]
    },
    {
        // As permissões passaram a ser checadas no servidor: a tabela precisa
        // existir mesmo em bancos onde permissoes-migrate nunca rodou.
        id: '2026-10-14-003-permissoes',
        up: [
            "CREATE TABLE IF NOT EXISTS permissoes (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, perfil TEXT NOT NULL, recurso TEXT NOT NULL, permitido INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))"
        ]
    },
    {
        // Fase 2 — Agenda completa
        id: '2026-10-15-004-agenda',
        up: [
            "CREATE TABLE IF NOT EXISTS agenda_categorias (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, nome TEXT NOT NULL, cor TEXT NOT NULL, ordem INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1)",
            // Compromisso/bloqueio: profissional_id NULL = clínica inteira (feriado, agenda fechada)
            "CREATE TABLE IF NOT EXISTS agenda_bloqueios (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, profissional_id INTEGER, data TEXT NOT NULL, hora_inicio TEXT NOT NULL, hora_fim TEXT NOT NULL, titulo TEXT NOT NULL, observacao TEXT, bloqueia INTEGER DEFAULT 1, criado_por_nome TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_agenda_bloqueios_data ON agenda_bloqueios(clinica_id, data)",
            // dia_semana 0=domingo … 6=sábado; vários intervalos por dia (ex.: manhã e tarde)
            "CREATE TABLE IF NOT EXISTS clinica_horarios (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, dia_semana INTEGER NOT NULL, hora_inicio TEXT NOT NULL, hora_fim TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS profissional_horarios (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, profissional_id INTEGER NOT NULL, dia_semana INTEGER NOT NULL, hora_inicio TEXT NOT NULL, hora_fim TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS alertas_retorno (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, paciente_id INTEGER NOT NULL, profissional_id INTEGER, data_retorno TEXT NOT NULL, motivo TEXT, status TEXT DEFAULT 'pendente', agendamento_id INTEGER, criado_por_nome TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_alertas_retorno ON alertas_retorno(clinica_id, status, data_retorno)",
            "CREATE TABLE IF NOT EXISTS lista_espera (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, paciente_id INTEGER NOT NULL, profissional_id INTEGER, preferencia TEXT, observacao TEXT, status TEXT DEFAULT 'aguardando', criado_por_nome TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "ALTER TABLE agendamentos ADD COLUMN categoria_id INTEGER",
            "ALTER TABLE agendamentos ADD COLUMN primeira_consulta INTEGER DEFAULT 0",
            "ALTER TABLE agendamentos ADD COLUMN serie_id TEXT",
            "ALTER TABLE agendamentos ADD COLUMN criado_por_nome TEXT",
            "ALTER TABLE agendamentos ADD COLUMN confirmacao_envio TEXT",
            "ALTER TABLE agendamentos ADD COLUMN alerta_envio TEXT",
            "ALTER TABLE agendamentos ADD COLUMN canal_envio TEXT",
            "ALTER TABLE profissionais ADD COLUMN cor_agenda TEXT"
        ]
    },
    {
        // Fase 3 — Paciente e prontuário
        id: '2026-10-15-005-paciente',
        up: [
            "ALTER TABLE pacientes ADD COLUMN apelido TEXT",
            "ALTER TABLE pacientes ADD COLUMN rg TEXT",
            "ALTER TABLE pacientes ADD COLUMN fone_fixo TEXT",
            "ALTER TABLE pacientes ADD COLUMN observacoes TEXT",
            "ALTER TABLE pacientes ADD COLUMN profissao TEXT",
            "ALTER TABLE pacientes ADD COLUMN local_trabalho TEXT",
            "ALTER TABLE pacientes ADD COLUMN pai TEXT",
            "ALTER TABLE pacientes ADD COLUMN mae TEXT",
            "ALTER TABLE pacientes ADD COLUMN responsavel_nome TEXT",
            "ALTER TABLE pacientes ADD COLUMN responsavel_cpf TEXT",
            "ALTER TABLE pacientes ADD COLUMN indicado_por_id INTEGER",
            "ALTER TABLE pacientes ADD COLUMN indicado_por_nome TEXT",
            "ALTER TABLE pacientes ADD COLUMN sem_email INTEGER DEFAULT 0",
            "ALTER TABLE pacientes ADD COLUMN inativado_em TEXT",
            "CREATE TABLE IF NOT EXISTS paciente_notas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, paciente_id INTEGER NOT NULL, texto TEXT NOT NULL, autor_id INTEGER, autor_nome TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_paciente_notas ON paciente_notas(clinica_id, paciente_id)",
            "CREATE TABLE IF NOT EXISTS prontuario_evolucoes (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, paciente_id INTEGER NOT NULL, profissional_id INTEGER, data TEXT NOT NULL, dente TEXT, texto TEXT NOT NULL, proxima_consulta TEXT, autor_id INTEGER, autor_nome TEXT, criado_em TEXT DEFAULT (datetime('now')), editado_em TEXT)",
            "CREATE INDEX IF NOT EXISTS idx_evolucoes ON prontuario_evolucoes(clinica_id, paciente_id, data)",
            // Modelos de documento (atestado, receituário, contrato…) com variáveis {{paciente.nome}}
            "CREATE TABLE IF NOT EXISTS documento_modelos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, nome TEXT NOT NULL, tipo TEXT NOT NULL, conteudo TEXT NOT NULL, ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS documentos_emitidos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, paciente_id INTEGER NOT NULL, modelo_id INTEGER, titulo TEXT NOT NULL, tipo TEXT, conteudo TEXT NOT NULL, profissional_id INTEGER, criado_por_nome TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_documentos_emitidos ON documentos_emitidos(clinica_id, paciente_id)"
        ]
    }
]

function isAlreadyApplied(e) {
    return /duplicate column|already exists/i.test((e && e.message) || '')
}

// Nunca lança: uma migration com problema não pode derrubar todas as rotas.
// ALTER em tabela que ainda não existe deixa a migration pendente (tenta de novo
// no próximo cold start); outros erros são logados e interrompem a fila.
async function runMigrations(client) {
    if (global._klinovMigrated) return
    try {
        await client.execute("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, aplicada_em TEXT DEFAULT (datetime('now')))")
        var done = await client.execute("SELECT id FROM schema_migrations")
        var applied = {}
        done.rows.forEach(function(r) { applied[r.id] = true })
        var tudoAplicado = true

        for (var i = 0; i < MIGRATIONS.length; i++) {
            var m = MIGRATIONS[i]
            if (applied[m.id]) continue
            var pendente = false
            for (var j = 0; j < m.up.length; j++) {
                try { await client.execute(m.up[j]) }
                catch (e) {
                    if (isAlreadyApplied(e)) continue
                    if (/^ALTER TABLE/i.test(m.up[j]) && /no such table/i.test(e.message || '')) { pendente = true; continue }
                    console.error('[migrations] ' + m.id + ' falhou: ' + e.message)
                    return
                }
            }
            if (pendente) { tudoAplicado = false; continue }
            await client.execute({ sql: "INSERT OR IGNORE INTO schema_migrations(id) VALUES(?)", args: [m.id] })
        }
        if (tudoAplicado) global._klinovMigrated = true
    } catch (e) {
        console.error('[migrations] erro: ' + e.message)
    }
}

module.exports = { runMigrations, MIGRATIONS }
