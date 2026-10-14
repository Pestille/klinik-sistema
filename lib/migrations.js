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
    },
    {
        // Colunas de pacientes que rotas antigas criavam sob demanda: a lista e o
        // cadastro novos leem todas, então garantimos que existam
        id: '2026-10-15-006-pacientes-colunas',
        up: ['ativo INTEGER DEFAULT 1', 'criado_em TEXT', 'whatsapp TEXT', 'email TEXT', 'cpf TEXT', 'telefone TEXT', 'data_nascimento TEXT', 'sexo TEXT',
            'estado_civil TEXT', 'como_conheceu TEXT', 'convenio TEXT', 'numero_convenio TEXT', 'alerta_medico TEXT', 'cep TEXT', 'endereco TEXT',
            'numero TEXT', 'complemento TEXT', 'bairro TEXT', 'cidade TEXT', 'uf TEXT', 'foto_url TEXT'
        ].map(function(c) { return "ALTER TABLE pacientes ADD COLUMN " + c })
    },
    {
        // Fase 4 — Orçamentos e tabelas de preço. O catálogo continua em tabela_precos
        // (uma linha por procedimento, ligada à tabela pelo nome, como as comissões);
        // precos_tabelas guarda o cadastro de cada tabela (tipo particular/convênio/próprio).
        id: '2026-10-15-007-orcamentos',
        up: [
            "CREATE TABLE IF NOT EXISTS tabela_precos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER DEFAULT 1, tabela TEXT NOT NULL, procedimento TEXT NOT NULL, especialidade TEXT, sessoes INTEGER DEFAULT 1, valor REAL DEFAULT 0, comissao REAL DEFAULT 0, codigo_interno TEXT)",
            "ALTER TABLE tabela_precos ADD COLUMN ativo INTEGER DEFAULT 1",
            "CREATE TABLE IF NOT EXISTS precos_tabelas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, nome TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'particular', ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')))",
            "INSERT INTO precos_tabelas(clinica_id,nome,tipo) SELECT t.clinica_id, t.tabela, CASE WHEN UPPER(t.tabela) LIKE '%SUL%AM%' OR UPPER(t.tabela) LIKE '%PREVIDENT%' OR UPPER(t.tabela) LIKE '%VIVENTERIS%' OR UPPER(t.tabela) LIKE '%CARE%PLUS%' OR UPPER(t.tabela) LIKE '%AESP%' OR UPPER(t.tabela) LIKE '%AMIL%' OR UPPER(t.tabela) LIKE '%UNIMED%' OR UPPER(t.tabela) LIKE '%ODONTOPREV%' OR UPPER(t.tabela) LIKE '%BRADESCO%' OR UPPER(t.tabela) LIKE '%METLIFE%' OR UPPER(t.tabela) LIKE '%CASSEMS%' OR UPPER(t.tabela) LIKE '%HAPVIDA%' THEN 'convenio' ELSE 'particular' END FROM (SELECT DISTINCT clinica_id, tabela FROM tabela_precos WHERE clinica_id IS NOT NULL AND tabela IS NOT NULL AND tabela<>'') t WHERE NOT EXISTS (SELECT 1 FROM precos_tabelas x WHERE x.clinica_id=t.clinica_id AND UPPER(x.nome)=UPPER(t.tabela))",
            "ALTER TABLE orcamento_itens ADD COLUMN faces TEXT",
            "ALTER TABLE orcamentos ADD COLUMN titulo TEXT",
            "ALTER TABLE orcamentos ADD COLUMN validade TEXT"
        ]
    },
    {
        // CRC: os cartões nascem dos eventos (falta, parcela vencida, orçamento
        // em aberto…) calculados na hora; aqui só fica o que a equipe fez com
        // eles (etapa, data de retorno) e o histórico de interações.
        id: '2026-10-16-008-crc',
        up: [
            "CREATE TABLE IF NOT EXISTS crc_cartoes (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, fila TEXT NOT NULL, chave TEXT NOT NULL, paciente_id INTEGER, paciente_nome TEXT, etapa TEXT NOT NULL, retornar_em TEXT, atualizado_em TEXT DEFAULT (datetime('now')), UNIQUE(clinica_id, fila, chave))",
            "CREATE TABLE IF NOT EXISTS crc_interacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, paciente_id INTEGER, paciente_nome TEXT, fila TEXT NOT NULL, chave TEXT, forma TEXT, etapa TEXT, detalhes TEXT, retornar_em TEXT, usuario_id INTEGER, usuario_nome TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_crc_interacoes_pac ON crc_interacoes(clinica_id, paciente_id)",
            "CREATE TABLE IF NOT EXISTS crc_filas (clinica_id INTEGER NOT NULL, fila TEXT NOT NULL, ativo INTEGER DEFAULT 1, PRIMARY KEY(clinica_id, fila))"
        ]
    },
    {
        // Financeiro: tabelas que o código já usava mas nunca criava em produção
        // (lancamentos, contas_pagar) + fornecedores e contas bancárias. A leitura
        // unificada do dinheiro fica em lib/rotas/financeiro.js (movimentos).
        id: '2026-10-17-009-financeiro',
        up: [
            "CREATE TABLE IF NOT EXISTS lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, data TEXT NOT NULL, hora TEXT, tipo TEXT NOT NULL, forma_pagamento TEXT, descricao TEXT, paciente_id INTEGER, paciente_nome TEXT, valor REAL NOT NULL DEFAULT 0, classificacao TEXT, categoria TEXT, status TEXT DEFAULT 'realizado', comprovante_url TEXT, profissional_id INTEGER, created_at TEXT DEFAULT (datetime('now')))",
            "ALTER TABLE lancamentos ADD COLUMN orcamento_id INTEGER",
            "ALTER TABLE lancamentos ADD COLUMN parcela_orcamento_id INTEGER",
            "ALTER TABLE lancamentos ADD COLUMN conta_pagar_id INTEGER",
            "ALTER TABLE lancamentos ADD COLUMN conta_id INTEGER",
            "ALTER TABLE lancamentos ADD COLUMN categoria_id INTEGER",
            "ALTER TABLE lancamentos ADD COLUMN criado_por_nome TEXT",
            "CREATE INDEX IF NOT EXISTS idx_lancamentos_data ON lancamentos(clinica_id, data)",
            "CREATE TABLE IF NOT EXISTS contas_pagar (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, descricao TEXT NOT NULL, fornecedor TEXT, valor REAL NOT NULL DEFAULT 0, vencimento TEXT NOT NULL, pagamento TEXT, classificacao TEXT, categoria TEXT, status TEXT DEFAULT 'aberta', recorrente INTEGER DEFAULT 0, comprovante_url TEXT, created_at TEXT DEFAULT (datetime('now')))",
            "ALTER TABLE contas_pagar ADD COLUMN categoria_id INTEGER",
            "ALTER TABLE contas_pagar ADD COLUMN parcela_atual INTEGER DEFAULT 1",
            "ALTER TABLE contas_pagar ADD COLUMN total_parcelas INTEGER DEFAULT 1",
            "ALTER TABLE contas_pagar ADD COLUMN frequencia TEXT",
            "ALTER TABLE contas_pagar ADD COLUMN competencia TEXT",
            "ALTER TABLE contas_pagar ADD COLUMN conta_id INTEGER",
            "ALTER TABLE contas_pagar ADD COLUMN forma_pagamento TEXT",
            "ALTER TABLE contas_pagar ADD COLUMN fornecedor_id INTEGER",
            "ALTER TABLE contas_pagar ADD COLUMN observacoes TEXT",
            "CREATE INDEX IF NOT EXISTS idx_contas_pagar_venc ON contas_pagar(clinica_id, vencimento)",
            "CREATE TABLE IF NOT EXISTS fornecedores (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, nome TEXT NOT NULL, documento TEXT, telefone TEXT, email TEXT, observacoes TEXT, ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS contas_bancarias (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, nome TEXT NOT NULL, tipo TEXT DEFAULT 'corrente', banco TEXT, agencia TEXT, conta TEXT, saldo_inicial REAL DEFAULT 0, ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS categorias_financeiras (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, nome TEXT NOT NULL, classificacao TEXT NOT NULL, tipo TEXT NOT NULL, ativo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS parcelas_orcamento (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, orcamento_id INTEGER, paciente_id INTEGER, numero_parcela INTEGER NOT NULL, total_parcelas INTEGER NOT NULL, valor REAL NOT NULL, data_vencimento TEXT NOT NULL, data_pagamento TEXT, forma_pagamento TEXT, status TEXT DEFAULT 'pendente', tipo TEXT DEFAULT 'parcela', cobranca_id INTEGER, asaas_id TEXT, observacoes TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
            "ALTER TABLE parcelas_orcamento ADD COLUMN conta_id INTEGER"
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
