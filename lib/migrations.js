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
    },
    {
        // Financeiro (parte 2): cheques e cartões a compensar, taxas por forma de
        // pagamento, multa/juros, repasse de convênio, conciliação OFX e régua de cobrança.
        id: '2026-10-18-010-financeiro-controles',
        up: [
            "CREATE TABLE IF NOT EXISTS recebiveis (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, tipo TEXT NOT NULL, cartao_tipo TEXT, origem TEXT, origem_id INTEGER, paciente_id INTEGER, paciente_nome TEXT, titular TEXT, cpf TEXT, banco TEXT, agencia TEXT, numero TEXT, bandeira TEXT, ultimos4 TEXT, autorizacao TEXT, parcela INTEGER DEFAULT 1, total_parcelas INTEGER DEFAULT 1, data_venda TEXT, vencimento TEXT, recebido_em TEXT, valor REAL NOT NULL DEFAULT 0, taxa REAL DEFAULT 0, valor_final REAL DEFAULT 0, status TEXT DEFAULT 'pendente', conta_id INTEGER, lancamento_id INTEGER, observacoes TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_recebiveis ON recebiveis(clinica_id, tipo, vencimento)",
            "CREATE TABLE IF NOT EXISTS taxas_pagamento (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, forma TEXT NOT NULL, parcelas_de INTEGER DEFAULT 1, parcelas_ate INTEGER DEFAULT 1, percentual REAL DEFAULT 0, fixo REAL DEFAULT 0, prazo_dias INTEGER DEFAULT 30)",
            "CREATE TABLE IF NOT EXISTS taxas_config (clinica_id INTEGER PRIMARY KEY, multa_percent REAL DEFAULT 0, juros_mes_percent REAL DEFAULT 0, desconto_percent REAL DEFAULT 0, desconto_dias INTEGER DEFAULT 0)",
            "ALTER TABLE orcamento_itens ADD COLUMN guia TEXT",
            "ALTER TABLE orcamento_itens ADD COLUMN convenio_status TEXT",
            "ALTER TABLE orcamento_itens ADD COLUMN convenio_recebido_em TEXT",
            "ALTER TABLE orcamento_itens ADD COLUMN convenio_valor_recebido REAL",
            "ALTER TABLE orcamento_itens ADD COLUMN convenio_obs TEXT",
            "CREATE TABLE IF NOT EXISTS conciliacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, descricao TEXT, periodo_de TEXT, periodo_ate TEXT, status TEXT DEFAULT 'pendente', total_itens INTEGER DEFAULT 0, total_conciliados INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))",
            "ALTER TABLE conciliacoes ADD COLUMN conta_id INTEGER",
            "CREATE TABLE IF NOT EXISTS conciliacao_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, conciliacao_id INTEGER, data TEXT, descricao TEXT, valor REAL, tipo TEXT, lancamento_id INTEGER, status TEXT DEFAULT 'pendente', created_at TEXT DEFAULT (datetime('now')))",
            "ALTER TABLE conciliacao_itens ADD COLUMN fitid TEXT",
            "ALTER TABLE conciliacao_itens ADD COLUMN movimento_id TEXT",
            "CREATE TABLE IF NOT EXISTS regua_regras (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, dias INTEGER NOT NULL, canal TEXT NOT NULL, mensagem TEXT NOT NULL, ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS regua_envios (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, regra_id INTEGER NOT NULL, parcela_id INTEGER NOT NULL, canal TEXT, destino TEXT, status TEXT, erro TEXT, enviado_em TEXT DEFAULT (datetime('now')), UNIQUE(regra_id, parcela_id))"
        ]
    },
    {
        // Metas por clínica ou por profissional (referencia_id = profissional)
        id: '2026-10-19-011-metas',
        up: [
            "CREATE TABLE IF NOT EXISTS metas_config (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, tipo TEXT NOT NULL, valor REAL NOT NULL, data_inicio TEXT NOT NULL, data_fim TEXT NOT NULL, analise TEXT DEFAULT 'clinica', created_at TEXT DEFAULT (datetime('now')))",
            "ALTER TABLE metas_config ADD COLUMN analise TEXT DEFAULT 'clinica'",
            "ALTER TABLE metas_config ADD COLUMN referencia_id INTEGER",
            "ALTER TABLE metas_config ADD COLUMN referencia_nome TEXT",
            "UPDATE metas_config SET analise='clinica' WHERE analise IS NULL OR analise NOT IN ('clinica','profissional')"
        ]
    },
    {
        // Configurações: dados completos da clínica, preferências em cfg_json,
        // especialidades, permissões por usuário, auditoria e login em duas etapas.
        // Profissionais sem clínica (importação antiga) passam a ser da primeira
        // clínica, como no backfill de clinica_id feito no migrate-saas.
        id: '2026-10-20-012-configuracoes',
        up: [
            "ALTER TABLE clinicas ADD COLUMN telefone TEXT",
            "ALTER TABLE clinicas ADD COLUMN email TEXT",
            "ALTER TABLE clinicas ADD COLUMN cnpj TEXT",
            "ALTER TABLE clinicas ADD COLUMN razao_social TEXT",
            "ALTER TABLE clinicas ADD COLUMN endereco TEXT",
            "ALTER TABLE clinicas ADD COLUMN cidade TEXT",
            "ALTER TABLE clinicas ADD COLUMN estado TEXT",
            "ALTER TABLE clinicas ADD COLUMN cep TEXT",
            "ALTER TABLE clinicas ADD COLUMN numero TEXT",
            "ALTER TABLE clinicas ADD COLUMN bairro TEXT",
            "ALTER TABLE clinicas ADD COLUMN complemento TEXT",
            "ALTER TABLE clinicas ADD COLUMN foro TEXT",
            "ALTER TABLE clinicas ADD COLUMN logo TEXT",
            "ALTER TABLE clinicas ADD COLUMN resp_tecnico_nome TEXT",
            "ALTER TABLE clinicas ADD COLUMN resp_tecnico_cro TEXT",
            "ALTER TABLE clinicas ADD COLUMN cfg_json TEXT",
            "CREATE TABLE IF NOT EXISTS especialidades (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, nome TEXT NOT NULL, ativo INTEGER DEFAULT 1)",
            "CREATE TABLE IF NOT EXISTS permissoes_usuario (clinica_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, recurso TEXT NOT NULL, permitido INTEGER NOT NULL, PRIMARY KEY(usuario_id, recurso))",
            "CREATE TABLE IF NOT EXISTS auditoria (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, usuario_id INTEGER, usuario_nome TEXT, acao TEXT NOT NULL, detalhe TEXT, ip TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_auditoria ON auditoria(clinica_id, criado_em)",
            "ALTER TABLE usuarios ADD COLUMN profissional_id INTEGER",
            "ALTER TABLE usuarios ADD COLUMN email_pessoal TEXT",
            "ALTER TABLE usuarios ADD COLUMN telefone TEXT",
            "ALTER TABLE usuarios ADD COLUMN codigo_2fa TEXT",
            "ALTER TABLE usuarios ADD COLUMN codigo_2fa_expira TEXT",
            "ALTER TABLE usuarios ADD COLUMN codigo_2fa_tentativas INTEGER DEFAULT 0",
            "ALTER TABLE usuarios ADD COLUMN desafio_2fa TEXT",
            "ALTER TABLE profissionais ADD COLUMN ativo INTEGER DEFAULT 1",
            "ALTER TABLE profissionais ADD COLUMN whatsapp TEXT",
            "ALTER TABLE profissionais ADD COLUMN cor_agenda TEXT",
            "UPDATE profissionais SET clinica_id=(SELECT MIN(id) FROM clinicas) WHERE clinica_id IS NULL"
        ]
    },
    {
        // Colunas de cobrança/comunicação da clínica que antes só eram criadas por
        // rotas manuais (pagamentos-migrate) ou ALTERs espalhados no data.js
        id: '2026-10-20-013-clinicas-cobranca',
        up: [
            "ALTER TABLE clinicas ADD COLUMN documento_tipo TEXT",
            "ALTER TABLE clinicas ADD COLUMN documento_numero TEXT",
            "ALTER TABLE clinicas ADD COLUMN pix_tipo TEXT",
            "ALTER TABLE clinicas ADD COLUMN pix_chave TEXT",
            "ALTER TABLE clinicas ADD COLUMN banco_nome TEXT",
            "ALTER TABLE clinicas ADD COLUMN banco_agencia TEXT",
            "ALTER TABLE clinicas ADD COLUMN banco_conta TEXT",
            "ALTER TABLE clinicas ADD COLUMN asaas_api_key TEXT",
            "ALTER TABLE clinicas ADD COLUMN cfg_confirmacao_wa INTEGER DEFAULT 0",
            "ALTER TABLE clinicas ADD COLUMN cfg_confirmacao_email INTEGER DEFAULT 0",
            "ALTER TABLE clinicas ADD COLUMN cfg_aniversario INTEGER DEFAULT 0",
            "ALTER TABLE clinicas ADD COLUMN cfg_lembrete_retorno INTEGER DEFAULT 0",
            "ALTER TABLE clinicas ADD COLUMN cfg_cobranca_auto INTEGER DEFAULT 0"
        ]
    },
    {
        // Extras: estoque (produtos e movimentos), controle protético (kanban) e
        // situação manual das indicações (recompensa, arquivo). Tabelas novas para
        // não esbarrar nas antigas estoque/estoque_movimentacao, que nunca tiveram tela.
        id: '2026-10-21-014-extras',
        up: [
            "CREATE TABLE IF NOT EXISTS estoque_produtos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, nome TEXT NOT NULL, categoria TEXT, unidade TEXT DEFAULT 'UN', codigo TEXT, quantidade REAL DEFAULT 0, minimo REAL DEFAULT 0, custo_medio REAL DEFAULT 0, fornecedor_id INTEGER, localizacao TEXT, validade TEXT, ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS estoque_movimentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, produto_id INTEGER NOT NULL, tipo TEXT NOT NULL, quantidade REAL NOT NULL, saldo REAL, custo_unitario REAL, motivo TEXT, lote TEXT, validade TEXT, paciente_id INTEGER, profissional_id INTEGER, conta_pagar_id INTEGER, usuario_nome TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_estoque_mov ON estoque_movimentos(clinica_id, produto_id)",
            "CREATE TABLE IF NOT EXISTS proteticos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, paciente_id INTEGER, paciente_nome TEXT, profissional_id INTEGER, profissional_nome TEXT, servico TEXT NOT NULL, dentes TEXT, cor TEXT, laboratorio_id INTEGER, laboratorio_nome TEXT, etapa TEXT DEFAULT 'pre_envio', data_envio TEXT, data_prevista TEXT, data_retorno TEXT, data_instalacao TEXT, valor REAL DEFAULT 0, observacoes TEXT, conta_pagar_id INTEGER, arquivado INTEGER DEFAULT 0, criado_em TEXT DEFAULT (datetime('now')), atualizado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_proteticos ON proteticos(clinica_id, etapa)",
            "CREATE TABLE IF NOT EXISTS indicacoes_status (clinica_id INTEGER NOT NULL, paciente_id INTEGER NOT NULL, recompensa TEXT, recompensa_em TEXT, arquivado INTEGER DEFAULT 0, PRIMARY KEY(clinica_id, paciente_id))"
        ]
    },
    {
        // Extras parte 2: anamnese editável e enviada por link, check-in por QR e
        // lista de medicamentos do receituário. As tabelas de anamnese existiam só
        // pela rota anamnese-migrate; aqui passam a ser garantidas.
        id: '2026-10-22-015-publico',
        up: [
            "CREATE TABLE IF NOT EXISTS anamnese_perguntas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, pergunta TEXT NOT NULL, tipo TEXT DEFAULT 'YES_NO', sequencia INTEGER, ativo INTEGER DEFAULT 1)",
            "CREATE TABLE IF NOT EXISTS anamnese_respostas (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER, paciente_id INTEGER, pergunta_id INTEGER, pergunta_texto TEXT, resposta TEXT, descricao TEXT, data_preenchimento TEXT DEFAULT (datetime('now')), preenchido_por TEXT)",
            "ALTER TABLE anamnese_perguntas ADD COLUMN alerta INTEGER DEFAULT 0",
            "CREATE TABLE IF NOT EXISTS anamnese_links (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, paciente_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, criado_por_nome TEXT, criado_em TEXT DEFAULT (datetime('now')), expira_em TEXT NOT NULL, usado_em TEXT)",
            "CREATE INDEX IF NOT EXISTS idx_anamnese_links ON anamnese_links(clinica_id, paciente_id)",
            "CREATE TABLE IF NOT EXISTS medicamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, clinica_id INTEGER NOT NULL, nome TEXT NOT NULL, apresentacao TEXT, quantidade TEXT, posologia TEXT, uso TEXT DEFAULT 'interno', ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS publico_tentativas (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, chave TEXT, criado_em TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_publico_tent ON publico_tentativas(ip, chave, criado_em)",
            "ALTER TABLE clinicas ADD COLUMN checkin_token TEXT",
            "ALTER TABLE agendamentos ADD COLUMN chegada_em TEXT"
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
