CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    usuario_id INTEGER REFERENCES usuarios(id),
    acao TEXT NOT NULL,
    tabela TEXT,
    registro_id INTEGER,
    dados_anteriores TEXT,
    dados_novos TEXT,
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    profissional_id INTEGER REFERENCES profissionais(id),
    data TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fim TEXT,
    categoria TEXT,
    status TEXT DEFAULT 'agendado',  -- agendado, confirmado, realizado, faltou, cancelado
    observacoes TEXT,
    primeira_consulta INTEGER DEFAULT 0,
    como_conheceu TEXT,
    deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE alertas_retorno (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    data_alerta TEXT NOT NULL,
    mensagem TEXT,
    status TEXT DEFAULT 'pendente',  -- pendente, enviado, realizado
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE alinhadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    profissional_id INTEGER REFERENCES profissionais(id),
    numero_etapa INTEGER,
    total_etapas INTEGER,
    data_inicio TEXT,
    data_prevista_fim TEXT,
    status TEXT DEFAULT 'em_tratamento',
    observacoes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)

-- anamnese (legacy, not used by current code — anamnese_respostas is the active table)
CREATE TABLE anamnese (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    pergunta TEXT NOT NULL,
    resposta TEXT,
    data_preenchimento TEXT DEFAULT (datetime('now'))
)

CREATE TABLE boletos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    nosso_numero TEXT,
    sacado TEXT,
    valor REAL,
    taxas REAL DEFAULT 0,
    vencimento TEXT,
    recebimento TEXT,
    status TEXT DEFAULT 'aberto',  -- aberto, pago, vencido
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE cartoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    tipo TEXT,  -- Cartão de Crédito, Cartão de Débito
    titular TEXT,
    cpf TEXT,
    bandeira TEXT,
    quatro_digitos TEXT,
    cod_autorizacao TEXT,
    valor REAL,
    taxas REAL DEFAULT 0,
    vencimento TEXT,
    pagamento TEXT,
    recebimento TEXT,
    status TEXT DEFAULT 'aberto',
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE categorias_agenda (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    nome TEXT NOT NULL,
    cor TEXT DEFAULT '#9C27B0',
    ativo INTEGER DEFAULT 1
)

CREATE TABLE cheques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    banco TEXT,
    numero_cheque TEXT,
    sacado TEXT,
    valor REAL,
    vencimento TEXT,
    recebimento TEXT,
    status TEXT DEFAULT 'aberto',
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE clinicas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cnpj TEXT UNIQUE,
    telefone TEXT,
    email TEXT,
    endereco TEXT,
    cidade TEXT,
    estado TEXT DEFAULT 'MS',
    cep TEXT,
    logo_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE configuracoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    chave TEXT NOT NULL,
    valor TEXT,
    categoria TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(clinica_id, chave)
)

CREATE TABLE confirmacoes_alertas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    agendamento_id INTEGER REFERENCES agendamentos(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    tipo TEXT,  -- confirmacao, alerta_retorno, aniversario
    canal TEXT,  -- whatsapp, email, sms
    mensagem TEXT,
    status TEXT DEFAULT 'pendente',  -- pendente, enviado, erro
    data_envio TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE contas_bancarias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    banco TEXT NOT NULL,
    tipo TEXT DEFAULT 'Conta Corrente',
    agencia TEXT,
    conta TEXT,
    saldo REAL DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE contas_pagar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    descricao TEXT NOT NULL,
    fornecedor TEXT,
    valor REAL NOT NULL,
    vencimento TEXT NOT NULL,
    pagamento TEXT,
    classificacao TEXT,
    categoria TEXT,
    status TEXT DEFAULT 'aberta',  -- aberta, paga, vencida, cancelada
    recorrente INTEGER DEFAULT 0,
    comprovante_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE contas_receber (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    descricao TEXT,
    valor REAL NOT NULL,
    vencimento TEXT NOT NULL,
    recebimento TEXT,
    forma_pagamento TEXT,
    status TEXT DEFAULT 'aberta',  -- aberta, recebida, vencida, cancelada
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE controle_protetico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    profissional_id INTEGER REFERENCES profissionais(id),
    tipo_protese TEXT,
    laboratorio TEXT,
    data_envio TEXT,
    data_prevista TEXT,
    data_recebimento TEXT,
    status TEXT DEFAULT 'em_producao',  -- em_producao, recebido, instalado, retrabalho
    cor TEXT,
    observacoes TEXT,
    valor REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE crc_inativos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    ultima_visita TEXT,
    dias_ausente INTEGER,
    prioridade TEXT,  -- urgente, alta, media
    contato_realizado INTEGER DEFAULT 0,
    data_contato TEXT,
    resultado_contato TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE documentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    tipo TEXT,  -- rx, laudo, contrato, receita, foto
    nome TEXT,
    url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    produto TEXT NOT NULL,
    categoria TEXT,
    quantidade REAL DEFAULT 0,
    unidade TEXT,
    quantidade_minima REAL DEFAULT 0,
    valor_unitario REAL DEFAULT 0,
    fornecedor TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE estoque_movimentacao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    estoque_id INTEGER REFERENCES estoque(id),
    tipo TEXT,  -- entrada, saida
    quantidade REAL,
    motivo TEXT,
    usuario_id INTEGER REFERENCES usuarios(id),
    data TEXT DEFAULT (datetime('now'))
)

CREATE TABLE extrato (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    conta TEXT,
    tipo TEXT,  -- SAQUE, ENTRADA, SAIDA
    status TEXT DEFAULT 'pendente',
    descricao TEXT,
    hora TEXT,
    valor REAL,
    comprovante_url TEXT,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE indicacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_indicador_id INTEGER REFERENCES pacientes(id),
    paciente_indicado_id INTEGER REFERENCES pacientes(id),
    data TEXT,
    comissao_valor REAL DEFAULT 0,
    comissao_paga INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE lancamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    data TEXT NOT NULL,
    hora TEXT,
    tipo TEXT NOT NULL,  -- Vendas, Entrada, Saída
    forma_pagamento TEXT,  -- boleto, credito, debito, pix, transf, dinheiro
    descricao TEXT,
    paciente_id INTEGER REFERENCES pacientes(id),
    paciente_nome TEXT,
    valor REAL NOT NULL,
    classificacao TEXT,  -- Custo Fixo, Custo Variável, Investimento
    categoria TEXT,  -- COMISSÃO, Fornecedores, Materiais, Funcionários
    status TEXT DEFAULT 'realizado',  -- realizado, pendente, cancelado
    comprovante_url TEXT,
    profissional_id INTEGER REFERENCES profissionais(id),
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE metas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    profissional_id INTEGER REFERENCES profissionais(id),
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    meta_faturamento REAL,
    meta_consultas INTEGER,
    meta_novos_pacientes INTEGER,
    realizado_faturamento REAL DEFAULT 0,
    realizado_consultas INTEGER DEFAULT 0,
    realizado_novos_pacientes INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE odontograma (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    dente INTEGER NOT NULL,
    status TEXT DEFAULT 'saudavel',  -- saudavel, cariado, restaurado, ausente, implante, coroa, tratamento
    cor TEXT,
    observacao TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE pacientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    nome TEXT NOT NULL,
    cpf TEXT,
    data_nascimento TEXT,
    sexo TEXT,
    estado_civil TEXT,
    telefone TEXT,
    whatsapp TEXT,
    email TEXT,
    endereco TEXT,
    cidade TEXT,
    bairro TEXT,
    cep TEXT,
    como_conheceu TEXT,
    convenio TEXT,
    numero_convenio TEXT,
    alerta_medico TEXT,
    foto_url TEXT,
    ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE planos_convenio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    agendamento_id INTEGER REFERENCES agendamentos(id),
    guia TEXT,
    convenio TEXT,
    procedimento_codigo TEXT,
    procedimento_descricao TEXT,
    dente TEXT,
    valor REAL,
    data TEXT,
    status TEXT DEFAULT 'aberto',
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE planos_recorrencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    nome TEXT,
    valor_mensal REAL,
    dia_vencimento INTEGER,
    data_inicio TEXT,
    data_fim TEXT,
    status TEXT DEFAULT 'ativo',
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE prescricoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    profissional_id INTEGER REFERENCES profissionais(id),
    medicamento TEXT,
    dosagem TEXT,
    posologia TEXT,
    data TEXT DEFAULT (datetime('now'))
)

CREATE TABLE procedimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    agendamento_id INTEGER REFERENCES agendamentos(id),
    paciente_id INTEGER REFERENCES pacientes(id),
    profissional_id INTEGER REFERENCES profissionais(id),
    codigo TEXT,
    descricao TEXT NOT NULL,
    valor REAL DEFAULT 0,
    valor_convenio REAL DEFAULT 0,
    convenio TEXT,
    dente TEXT,
    face TEXT,
    data_realizacao TEXT,
    status TEXT DEFAULT 'realizado',
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE profissionais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    nome TEXT NOT NULL,
    cro TEXT,
    especialidade TEXT,
    email TEXT,
    telefone TEXT,
    cor_agenda TEXT DEFAULT '#9C27B0',
    ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE recebiveis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    conta_maquininha TEXT,
    forma_pagamento TEXT,
    paciente_id INTEGER REFERENCES pacientes(id),
    valor REAL,
    taxas REAL DEFAULT 0,
    vencimento TEXT,
    pagamento TEXT,
    recebimento TEXT,
    status TEXT DEFAULT 'a_receber',  -- disponivel, antecipavel, a_receber
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE sqlite_sequence(name,seq)

CREATE TABLE tabelas_preco (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    nome TEXT NOT NULL,  -- Particular, Cassems, Sulamerica, Viventeris
    tipo TEXT DEFAULT 'particular',
    ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE tabelas_preco_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    tabela_id INTEGER REFERENCES tabelas_preco(id),
    codigo TEXT,
    descricao TEXT NOT NULL,
    valor REAL DEFAULT 0,
    comissao REAL DEFAULT 0,
    comissao_indicacao REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinica_id INTEGER REFERENCES clinicas(id),
    profissional_id INTEGER REFERENCES profissionais(id),
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha_hash TEXT,
    perfil TEXT DEFAULT 'recepcionista',  -- admin, dentista, recepcionista
    ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
)

CREATE INDEX idx_ag_data ON agendamentos(data)

CREATE INDEX idx_ag_pac ON agendamentos(paciente_id)

CREATE INDEX idx_ag_prof ON agendamentos(profissional_id)

CREATE INDEX idx_cartoes_venc ON cartoes(vencimento)

CREATE INDEX idx_contas_pagar_venc ON contas_pagar(vencimento)

CREATE INDEX idx_contas_receber_venc ON contas_receber(vencimento)

CREATE INDEX idx_lanc_data ON lancamentos(data)

CREATE INDEX idx_pac_nome ON pacientes(nome)

CREATE INDEX idx_proc_pac ON procedimentos(paciente_id)