# Levantamento Clinicorp → Klinov

Referência funcional para a réplica. **Visual segue o Klinov** (`CLAUDE.md`); aqui só fluxos, campos e regras.
Fonte: sistema.clinicorp.com (versão 0.35.41), conta KLINIK ODONTOLOGIA, levantado em 14/10/2026.
Nenhum dado de paciente é registrado aqui — só estrutura.

## Navegação global

- **Topbar:** menu (drawer), busca global "Encontre pacientes ou funções do sistema" (pacientes + atalhos para telas), treinamentos ao vivo, suporte, CliniChat (chat interno), notificações, menu do usuário (nome + perfil).
- **Home:** cards de módulo — Agenda, Pacientes, CRC, Financeiro, Profissionais, Relatórios, Clinipay.
- **Drawer:** Início · busca de funcionalidade · "Mais acessados" (dinâmico por uso) · Módulos · rodapé com "Novidades do sistema" (changelog) e Configurações.

### Árvore de módulos

| Módulo | Submódulos |
|---|---|
| Agenda | — |
| Clinipay | Abrir Conta · Extrato · Gerenciar Conta · Recebíveis |
| Confirmação e Alertas | — |
| Controle de Indicação | — |
| Controle Protético | — |
| CRC | Geral · Agendamento sem Confirmação · Alerta de Retorno · Aniversariantes · Cancelamentos · Faltas · Faltas na primeira consulta · Inadimplência · Orçamentos em Aberto · Tratamento sem Agendamento |
| CRM | — |
| Dashboard Analítico | — |
| Estoque | Controle de Estoque |
| Financeiro | — |
| Gestão de Casos de Alinhadores | — |
| Metas | — |
| Pacientes | — |
| Planos (novo) | — |
| Portal de Assinatura | — |
| Profissionais | — |
| Relatórios | — |
| Tutoriais do Sistema | — |
| Usuários e Permissões | — |
| Configurações | — |

---

## Agenda (`/calendar`)

**Layout:** coluna esquerda (botão Novo ▾, minicalendário mensal com semana destacada, filtro de profissionais com checkbox colorido + "Todos", painel "Alertas de Retorno"); área principal com navegação ‹ Hoje ›, título do período, botão atualizar, seletor de visão (Semana/…), imprimir, engrenagem.

**Grade:** slots de 15 min, 8:00–20:00. Cabeçalho de cada dia mostra "Pacientes: N". Uma subcoluna por profissional selecionado, com fundo na cor do profissional. Bloqueios/compromissos aparecem como faixa cinza com ícone (ex.: "feriado 8–20h", "agenda fechada", "DRA X ATENDERÁ 13–20h"). Dias sem expediente aparecem hachurados. Desmarcados aparecem riscados e esmaecidos.

**Menu Novo:** Novo agendamento · Novo compromisso · Alerta de retorno.

**Modal "Nova consulta"** (abas Consulta | Compromisso):
- Paciente: busca por nome com autocomplete (nome, celular, CPF) + opção "Novo paciente: <texto>" (cadastro rápido inline); botão Editar após selecionar.
- ☐ Primeira consulta · ☐ Múltiplos agendamentos (recorrência/lote).
- Observações para consulta (textarea).
- + Adicionar procedimentos (vincula procedimentos do tratamento).
- Data · Profissional (com avatar/cor) · Categoria (lista colorida configurável: Avaliação, Botox, Cirurgia, Clareamento, Consulta, Endodontia, Harmonização, Implante, Instalação aparelho…).
- Horário: grade de chips de 15 em 15 min mostrando disponibilidade do profissional.
- Confirmação (select) · Alerta de consulta (select) · Enviar por (WhatsApp/…). Regra: alerta não pode ser no mesmo dia (envio automático às 7h).
- Rodapé: Cancelar · Confirmar consulta.

**Popover do agendamento (clique no evento):**
- Foto, nome, telefone do paciente; selo de WhatsApp.
- Ações: Prontuário · WhatsApp · ficha/anamnese · financeiro do paciente.
- Observações.
- Faixa de situação financeira ("Financeiro OK" verde / pendência).
- Data, horário início–fim, profissional; ações Editar · Desmarcar · Excluir.
- Categoria & Marcadores (múltiplas tags) + Adicionar.
- Rodapé: "Agendado por <usuário> em <data hora>" + **status**: Agendado · Confirmado (verde-água) · Em espera (amarelo) · Em atendimento (azul) · Atendido (verde) · Atrasado (vermelho) · Faltou (preto).

**Engrenagem (preferências por usuário):** Mostrar desmarcações · Mostrar lista de espera · Mostrar horário de almoço · Mostrar sábado · Mostrar domingo · Cor de fundo do profissional · Reduzir brilho de eventos passados · Visualização detalhada na semana · Modo conforto. Outras: Configurar categorias · Imprimir agenda.

**Visões:** Dia · Semana · Mês.

---

## Pacientes

### Lista
- Estado inicial vazio com busca ("Digite o nome e pressione ENTER; para buscar por sobrenome digite % antes"). Botão **+ Novo paciente**.
- Tabela: Nome (link) · Celular/WhatsApp (ícone WA clicável) · Nascimento · Email · Como conheceu (ícone: Plano/Convênio, Indicado por…) · Status (Ativo/Inativo). Paginação com "N registros", linhas por página, página X de Y.

### Novo paciente (modal)
Nome* · Apelido ("como prefere ser chamado") · CPF (máscara) · RG · Celular/WhatsApp (seletor de país, máscara) · Telefone fixo · E-mail + ☐ Não possui e-mail · Data de nascimento* · Gênero (Masculino/Feminino/Outro) · Como conheceu (Google, Instagram, Facebook, Indicado por, Escola, Outdoor, Panfleto, Placa, Plano/Convênio, Rádio, TV, Revista, Outros) · Indicado por (habilita quando "Indicado por") · Observações. Botões Cancelar / Cadastrar paciente. Endereço e complemento ficam para a edição na ficha.

### Ficha do paciente
**Cabeçalho:** foto, nome, celular + WhatsApp, badge Ativo. Ações (ícones): Excluir · Inativar · Imprimir dados · Gerar código do app (Clini.me) · Link para agendamento online · Gerar link de indicação · **Consultar CPF** (SPC/Serasa, score).
Topbar troca para "← Voltar para Pacientes".

**14 abas:**

1. **Visão Geral** — card "Informações do paciente" com sub-abas:
   - *Cadastro:* nascimento (+ idade), CPF, RG, email, telefone, como conheceu, plano (convênio), nº do plano (copiar), cadastrado em, observações, SPC Serasa [Consultar], Editar.
   - *Contato:* email, celular, telefone fixo, endereço, complemento/bairro/cidade/UF/CEP.
   - *Complemento:* profissão, local de trabalho, tempo de trabalho, pai, mãe, representante legal.
   - Cards: Próximo agendamento (Ver todos) · Anamnese (Preencher anamnese) · Alerta de retorno (Novo alerta) · Orçamentos em aberto (contador + lista + Ver todos) · **Notas gerais** (+ Adicionar nota, várias notas com autor/data).
2. **Orçamentos** — tabela Status (Aprovado/Em aberto/…) · Data · Tratamento (lista de procedimentos com dente) · Responsável (avatar) · Contrato (ícone gerar/assinar) · Valor · abrir · ⋮ (Enviar por e-mail · Imprimir · Desaprovar/Aprovar · Duplicar · Visualizar). Botões: **Agrupar oportunidades** · **+ Novo orçamento**.
   - *Editor:* Tratamento (nome), Orçamento criado por (profissional), Data, Observações, **Tabela de preço** (AESP, Care Plus, Particular, Prevident, SulAmérica, São Leopoldo, Viventeris…), + Adicionar procedimento. Painel direito com itens (checkbox, código-procedimento, tabela, profissional, dente/região, valor; badge **Plano** vs **Particular**), Total Particular, Total Plano, **Definir forma de pagamento**, banner Consulta CPF com score, botão **Aprovar**, Cancelar/Salvar. Ações do painel: visualizar, imprimir, e-mail, ⋮.
3. **Financeiro** — ações: Crédito do paciente · Adicionar mensalidades · Adicionar lançamento. Tabela: ⋮ · $ · Lançamento (data) · Hora · abrir · Descrição · Contrato · Valor a pagar · Valor pago · Saldo · Forma pagto. · Parcelas · Pagamento · **Status em 4 etapas: 1 Lançamento → 2 Checkout → 3 Pagamento → 4 Recebimento**. ⋮: Excluir lançamento · Cancelar pagamento · Recibo · Emitir NFS-e pelo valor total do checkout. Rodapé "Saldo a pagar".
4. **Fotos** — pastas (Nova pasta, "Todas as fotos e pastas" com contador), Câmera intraoral, Adicionar foto.
5. **Plano e Ficha Clínica** — *Planos de tratamento aprovados* (data, profissional, valor total, status Aberto/Fechado, imprimir; expandir → grupos A realizar/Executados com procedimento, status de autorização do convênio, nº guia, data execução, dente/região, profissional, valor). *Ficha clínica* (evolução): filtro Listar procedimentos (A realizar/Executados…), Imprimir, + Novo; tabela Ações · Data (executado) · Dente · Procedimentos executados · Profissional · Detalhes próx. consulta · Obs · **Assinatura do paciente [Solicitar]** (assinatura eletrônica).
6. **Fichas Especialidades** — pastas por especialidade, + Nova ficha (modelos por especialidade).
7. **Odontograma** — dentição Permanente/Decídua + Dentição mista; arcadas com vistas vestibular/oclusal/palatina/lingual, dentes 11–48; legenda A realizar (vermelho) · Executado (verde) · Existente (azul); tela cheia. Painel lateral Procedimentos (data, dente, procedimento, ⋮) + Adicionar procedimento + Imprimir.
8. **Anamnese** — lista de anamneses + Nova anamnese: tipo Nova/Última preenchida; responsável **Paciente** (envia link para o paciente preencher) ou **Profissional**. Alertas de saúde derivados e assinatura eletrônica.
9. **Planos** — upsell do produto Planos (Plano próprio / Plano recorrente) — ver módulo Planos.
10. **Documentos** — tabela Opções · Data · Nome · Obs · Assinatura; Adicionar arquivo · Adicionar documento (modelos: contrato, atestado, receituário, termo…).
11. **Exames** — exames vinculados ao CPF (integração com laboratórios/radiologia).
12. **Recibos** — recibos emitidos.
13. **Agendamentos** — histórico: Data · Horário · Status (ex. "4-Atendido") · Profissional · Procedimentos · Observação · Marcador/Categoria; exportar e imprimir.
14. **Indicações** — pacientes indicados por este paciente.

---

## CRC — Central de Relacionamento com o Cliente (`/crc`)

**Home:** grade de cards, um por fila, com ícone, "Total de pacientes: N", selo **"Atividade em atraso"** e tooltip (i). Filas desativadas mostram botão **Ativar**.

**Cada fila = quadro kanban** (`/crc/<fila>`): cabeçalho "CRC ← <Fila>", botões **Relatório** e atualizar. Filtros: Especialidade · Profissional · Ordenar por (Mais recente…) · Pesquisar paciente · De/Até · Faixa de tempo (Hoje, Amanhã, Últimos 7/15/30 dias, Mês passado, Data personalizada). Cada coluna tem um contador "Quantidade N". Cartão: paciente, data e hora do evento, selo de contexto (ex. "Agendado para hoje"), bolinha de prioridade, dias desde o evento ("1 dia"), atalho WhatsApp, **(+) Nova interação**.

**Nova interação (modal):** Forma de contato (Ligação | WhatsApp) · Etapa (move o cartão de coluna) · Detalhes da interação · Anexar arquivo · Cancelar/Salvar. O histórico de interações fica no paciente.

| Fila | Rota | Colunas (etapas) |
|---|---|---|
| Agendamento sem confirmação | `appointment_without_confirmation` | Confirmação pendente → Retornar novamente → Desmarcou → Reagendou → Confirmou |
| Aniversariantes | `birthdays` | Aniversariantes do dia → Aniversariantes em atraso → Contato realizado |
| Desmarcações / Cancelamentos | `cancellation` | Desmarcado → Contato realizado → Retornar novamente → Agendado → Abandonou tratamento |
| Faltas | `absences` | Faltou → Contato realizado → Retornar novamente → Agendado → Abandonou tratamento |
| Faltas na 1ª consulta | `absences_first_appointment` | Faltou → Contato realizado → Retornar novamente → Agendado → Desistiu |
| Inadimplência | `without_payment` | Parcela vencida → Contato realizado → Retornar novamente → Renegociado → Sem negociação → Pago |
| Orçamentos em aberto | `open_budgets` | Em aberto → Contato realizado → Retornar novamente → Follow up → Orçamento reprovado → Orçamento aprovado |
| Tratamento sem agendamento | `open_treatment_without_appointment` | Sem agendamento → Contato realizado → Retornar novamente → Agendado → Abandonou tratamento |
| Alerta de retorno (novo layout) | `board/alert-return` | A contatar → Em contato → Retornar novamente → Agendado → Retorno recusado (arrastar e soltar; busca por nº de prontuário ou nome) |

Regras (CRC): os cartões entram automaticamente pelo evento de origem (falta, parcela vencida, orçamento não aprovado, alerta de retorno vencido etc.) e saem quando o evento se resolve (pagou, agendou, aprovou).

---

## Financeiro

Abas no topo: Geral · Conta Corrente · Fluxo de Caixa · Controle de Boletos · Controle de Cheques · Controle de Cartões · Controle de Planos · Recebíveis Clinipay · Contas a Pagar · Contas a Receber · Extrato · Conciliações Bancárias · Receita Saúde.
**Geral:** grade numerada (1–12) de atalhos para cada subtela.

### Conta Corrente
"Listagem de vendas, entradas e saídas da clínica." Ações: exportar, imprimir, **+ Novo lançamento**. Filtros: período, tipo (Todos/Vendas/Entradas/Saídas/Cancelamentos), busca em todas as colunas, Listar.
KPIs: **Vendas** (valor total de vendas = tratamentos lançados) · **Cancelamento de vendas** · **Entradas** (verde) · **Saídas** (vermelho) + "N transações no período".
Lista agrupada por dia (data, dia da semana, nº de transações, mini-KPIs do dia, expandir). Expandido: Hora · Tipo (badge Vendas/Entrada/Saída) · Forma de pagamento · Descrição · Nome (link do paciente) · Valor.
**Novo lançamento (modal):** Tipo* (Receita/Entrada | Despesa/Saída) · Data* · Valor* · Conta* (Caixa Geral, bancos…) · Conta de despesa/receita* (plano de contas) · Descrição* (máx. 140) · Salvar lançamento.

### Fluxo de Caixa
Filtro Mês/Ano + Listar. Gráfico combinado por dia: barras Entrada (verde) / Saída (vermelho) / A receber (azul) / A pagar (rosa), linhas Saldo e Saldo acumulado, marcador vertical "hoje". Painel lateral do mês: Entradas, Saídas, Saldo (parcial), A receber, A pagar, Saldo (pendente), **Saldo (previsto)**. "Resumo entradas" por forma (Boleto, Cartão de crédito, Cartão de débito, Dinheiro, Planos de saúde, Transferência…) e resumo de saídas. Abaixo, lista dia a dia (Entrada/Saída/Saldo) expansível com os lançamentos em duas colunas (Entradas | Saídas).

### Controles de recebíveis (Boletos, Cheques, Cartões, Planos)
Mesmo padrão: De/Até, rádio Em aberto / Pago / Todos, Listar, expandir.
- **Boletos:** Vencimento · Recebimento · Nosso número · Paciente · Sacado · Valor · Taxas · Vl. final · Status · Confirmar · Desfazer.
- **Cheques:** Vencimento · Recebimento · Banco · Nº do cheque · Sacado · Vl. final · Status · Confirmar · Desfazer.
- **Cartões:** filtro Tipo (todos/crédito/débito). Vencimento · Pagamento · Recebimento · Tipo · Titular · CPF · Bandeira · 4 últimos dígitos · Cód. autorização · Comp. venda · Valor · Taxas · Vl. final · Status · Confirmar.
- **Planos (convênios):** De/Até, Guia, Lista/Tabela de preço, Tipo (Em aberto/…). Data · Paciente · Guia · Procedimentos · Confirmação · Ações (baixa do repasse do convênio).

### Contas a Pagar
- Banner **DDA**: "N novos boletos foram emitidos para seu CNPJ" + Listar boletos (importa boletos registrados contra o CNPJ).
- Atalhos: **Cadastro de fornecedores** · **Contas recorrentes** · Pagar boleto (via conta digital) · **+ Nova conta a pagar**.
- Filtros: Mostrar ☑ A pagar ☑ Pagas · De/Até · ☐ Criadas pelo DDA · Mais filtros · Listar · imprimir · exportar.
- **Totais** por tipo: Custo fixo · Custo variável · Investimento · Outros · Valor total.
- Lista agrupada por dia de vencimento: Status (REALIZADO / ABERTO / vencido) · botão pagar · Ações (ver, editar, excluir, estornar) · Tipo · Categoria (Comissão, Fornecedores, Empréstimo, Cadastro de fornecedores…) · Vencimento · Descrição · Anexos (pasta) · Comprovante (baixar/excluir) · Valor.
- **Nova conta a pagar:** Categoria · Valor* · Descrição* · Tipo (Custo fixo/Custo variável/Investimento/Outros) · ☐ Recorrente · Data de vencimento · Data de competência · ☐ Parcelado · Conta · Forma de pagamento (Transferência…) · Fornecedor · Observações.

### Contas a Receber
De/Até · ☐ Exibir lançamentos sem check-out · Listar · imprimir. Status (Vencido/A vencer/Pago) · Data · Nome (link) · Forma de pagamento · Valor · Confirmar (baixa). Total no rodapé.

### Extrato (conta digital)
De/Até · Conta · Tipo · Listar · busca por descrição · **Solicitar saque**. Selos de saldo: Disponível · Antecipável · A receber. Saldo inicial → dias com Tipo (Saque/Entrada) · Status · Conta · Descrição (paciente/ID do saque) · Hora · Comprovante · Valor → Saldo do dia.

### Conciliações Bancárias
Cadastro de contas bancárias (banco com logo, tipo, agência, conta, editar/excluir) + importar extrato (OFX) por conta e conciliar com os lançamentos.

### Integração Receita Saúde
Exporta os recebimentos em CSV para importação em lote no Receita Saúde (recibo médico da Receita Federal). Filtros De/Até e Status (Todos/Exportado/Não exportado). Tabela com checkbox · Data do recebimento · Paciente · CPF do paciente · CPF do pagador · CPF da clínica · Descrição · Valor · Exportado (Sim/Não) · Últ. exportação. Botão Exportar CSV.

### Recebíveis Clinipay
Agenda de recebíveis da maquininha/link próprio. **No Klinov, o equivalente é o Asaas** (já integrado: cobranças, saldo, saques).

---

## Metas (`/config/goals`)

Abas **Visualizar metas** | **Configuração de metas**.
- *Configuração:* tabela com editar/excluir · Tipo (Agendamentos/Vendas/Faltas) · De · Até · Análise (Clínica/Usuário/Profissional) · Clínica/Usuário · Meta (valor ou quantidade). + Adicionar meta.
- *Visualizar:* Tipo → Período (Todos, Ano corrente, meses configurados) → Visualizar. Cards agrupados por análise ("Clínica"): título, clínica, período, meta, valor alcançado, **% atingido** e barra de progresso (vermelha abaixo do esperado).

---

## Relatórios (`/reports/<categoria>/<relatório>`)

Layout: menu lateral recolhível com categorias em acordeão; área principal com título + descrição curta, filtros no topo (período/ano/consultar por), botão **Listar**, estado vazio "Selecione um período para começar"; após listar, ações ⚙ configurar · imprimir · exportar.

| Categoria | Relatórios |
|---|---|
| Agendamentos | Alertas de retorno · Categoria · Conversões sem agendamento · Desmarcações · Faltas · Geral · Marcadores · Primeira consulta |
| Estoque | Controle de estoque |
| Financeiro | Balancete · Caixa · Conta corrente · Contas a pagar · **DRE** · Fluxo financeiro · NFSe · Notas fiscais externas · Pagamentos e comissões · Recibos · Todos lançamentos |
| Geral | Acessos por usuário · Ações de usuários (auditoria) · Marcadores · Mensagens de confirmações e alertas enviadas · Mensagens enviadas |
| Pacientes | Alertas da régua de cobrança · Aniversariantes · Avaliações Google · Cobrança e pagamentos · Consultas SPC/Serasa · Exames radiológicos · Faixa etária · Indicações · Localização · Oportunidades e conversão · Orçamentos · Pagamentos parciais · Planos recorrentes · Planos/Convênios · Registros SPC/Serasa · Último agendamento |
| Tratamentos | Controle de ortodontia · Controle protético · Estatística de implantes · Faturamento · Implantes em tratamento · Procedimentos executados · Procedimentos não executados · Procedimentos vencidos · Tratamentos em aberto · Tratamentos ortodônticos |

**DRE** (modelo para os demais): consultar por Exercício (ano) ou Período; matriz conta × Jan…Dez + Total + análise vertical (%). Plano de contas usado:
```
1  Receita Operacional Bruta
   4.1.1 Receita Bruta de Vendas → 4.1.1.01 De Serviços Prestados
2  Dedução da Receita Bruta (-)
   2 PASSIVO → 2.1 CIRCULANTE → 2.1.01 Comissões Profissionais · 2.1.02 Provisão Comissões
     2.1.2 Contas a Pagar → 2.1.2.1 Contas Clínica (2.1.2.1.01 Contas Gerais) · 2.1.2.2 Contas Pessoais · 2.1.2.3 Contas Cursos
     2.1.2.4 Obrigações com Pacientes → 2.1.2.4.01 Crédito do Paciente
3  Receita Operacional Líquida (1 - 2)
4  Custos → 3.3 Custo dos Serviços Prestados → 3.3.1.01 Comissões Profissionais
5  Resultado Bruto (3 - 4)
6  Despesas Operacionais → 3.4.1 Despesas Gerais · 3.4.2 Despesas com Vendas (Taxas cartão crédito/débito, boleto, Pix, financiamento)
7  Lucro ou Prejuízo Operacional (5 - 6)
8  Receitas não Operacionais → 4.2 Receitas Financeiras (… 4.2.02 Multas Recebidas)
9  Despesas não Operacionais
10 Lucro Líquido antes do IR (7 + 8 - 9)
11 Provisão IR (-) · 12 Provisão CSLL (-)
13 Lucro Líquido (10 + 11 + 12)
```

---

## Dashboard Analítico (`/group/analytic_dashboard`)

Filtros: Últimos 3 meses | Selecionar período · Mês de referência · Ano · Clínica (multiclínica) · Análise (Todas/…) · Listar. Grade de gráficos (3 por linha), cada um com o mês de referência e os dois anteriores:
1. Fluxo de caixa (R$) — barras Entrada/Saída/Resultado.
2. Emissão de notas fiscais e recibos (R$) — Recibos/NFSe/Nota fiscal externa.
3. Análise de inadimplência — pizza Pagamentos/Inadimplência/Valores a entrar.
4. Entrada, previsão e inadimplência (R$) — linhas.
5. Agendamentos desmarcados × agendamento total.
6. Faltas × agendamento total.
7. Faltas na primeira consulta × primeiras consultas.
8. Agendamento total e primeiras consultas.
9. Categorias mais agendadas (top 3 + Ver mais).
10. Ocupação da agenda (%).
11. Parcelamento médio (filtro por profissional) — pagamentos totais, parcelamento total, média.
12. Oportunidades de vendas, vendas realizadas e conversão (R$) + atalho para o relatório.
13. Vendas por especialidade (R$) (top 3 + Ver mais).
14. Meta de faltas (meta × realizado).
15. Meta de vendas (R$) — meta, projeção, total realizado.
16. Orçamentos e conversão de orçamentos (R$) — por mês: Aprovado / Em aberto / Follow up / Reprovado / Total, com ticket médio e % de conversão.
17. Banner de insight: "Oportunidade parada — N orçamentos sem retorno, R$ X nos últimos 30 dias" + CTA de oferecer boleto (no Klinov: cobrança Asaas).

---

## Profissionais (`/professionals`)

Busca · ☑ Mostrar apenas profissionais ativos · **+ Adicionar profissional**. Grade de cards: faixa superior na **cor da agenda**, badge Ativo/Inativo, avatar com iniciais na cor, nome, usuário vinculado (ou "Usuário não encontrado"), celular, email, especialidade. ⋮: Editar · Inativar · Excluir (com confirmação).
**Adicionar profissional:** Nome* · Cor da agenda* · Nascimento (dia/mês/ano) · Gênero · Celular* (país) · RG · CPF · Email* · Estado civil · CRO (UF + número) · Especialidades (multi). A edição traz também horários de atendimento, comissões e vínculo com usuário.

## Usuários e Permissões (`/management/users`)

Busca · ☐ Mostrar apenas usuários ativos · **+ Novo usuário**. Cards: badge Ativo/Inativo, avatar, nome, perfil, login (`nome@clinica`), telefone, email, **"Último acesso em: data hora"**. ⋮: editar, permissões, inativar, redefinir senha.
**Novo usuário:** Nome* · Usuário* (login) · Email* · Telefone* · Perfil* — **Administrador · Auxiliar técnico · Profissional · Financeiro · Gestor de relacionamento · Recepcionista**. As permissões são por perfil e ajustáveis por usuário (ver `referencias/permissoes*.png`).

---

## Configurações (`/settings/*`)

Layout: menu lateral com busca "Buscar configurações", grupos recolhíveis; conteúdo com breadcrumb "Grupo › Item" + descrição. Salvamento automático na maioria das telas.

| Seção | Rota | Conteúdo |
|---|---|---|
| Administração de dados | `data-admin` | **Lixeira**: listar registros excluídos por Tipo e Profissional e **restaurar**. |
| Agenda › Geral | `schedule-general` | Tempo de visualização (5/15/20/30 min) · Limitar agendamentos no mesmo horário (quantidade por profissional) · Permitir agendar em horário indisponível · Colorir agendamentos por categoria (vs. cor do profissional) · Fuso horário · Tipo de agendamento: **por Profissional ou por Cadeira**. |
| Agenda › Agendamento online | `online-scheduling` | Habilitar link público de agendamento; aba Profissionais (quem aparece no link, horários). |
| Agenda › Confirmações e alertas | `confirmations-alerts` | Plataformas (SMS/Email/WhatsApp) · canais padrão ao criar agendamento · quando enviar a **confirmação** (no mesmo dia/1 dia antes…) e o **alerta/lembrete** (uma semana antes…) · custo por envio · **modelos de mensagem** por tipo (Confirmação, Lembrete, Resposta padrão do WhatsApp) e canal, com variáveis. |
| Agenda › Horário de funcionamento | `business-hours` | Por dia da semana: ligado/desligado + início–fim. |
| Assinatura eletrônica | `electronic-signature` | Métodos com nível de segurança: **Link via WhatsApp/SMS com código** (alto — coleta autenticação, sessão, carimbo de tempo, log de auditoria, geolocalização, consentimento, evidências) e assinatura presencial (tablet/QR). |
| Bloqueios | `blocks` | Para Agenda e outras operações, por motivo (Inadimplência · Financeiro em aberto · Pendências de contrato): Não bloquear · Avisar e pedir confirmação · Exigir aprovação de administrador · Bloquear. |
| Clínica › Geral | `clinic-general` | Abas Dados cadastrais (logo, nome, razão social, CNPJ, telefones, email, endereço com CEP, **foro** do contrato) · Responsável técnico (dentista, CRO) · Endereços (multiunidade). |
| Clínica › Check-in | `check-in` | QR code/link para o paciente fazer check-in ao chegar (muda status para "Em espera"). Baixar/imprimir QR. |
| Clínica › Perfil no Google | — | Vincular Google Business (avaliações). |
| Configuração de emissor NFS-e | `nfse-issuer` | Emissores (CNPJ, situação, validade do certificado). |
| Registro SPC | `cdl-association` | Adesão à CDL para negativar inadimplentes. |
| Caixa | `teller` | Desabilitar caixa · exigir senha para operações · formas aceitas no caixa (Dinheiro, Cheque, Débito, Crédito, Pix, Boleto, Transferência). |
| Contas bancárias | `bank-accounts` | Contas da clínica (banco, agência, conta) para conciliação e lançamentos. |
| Emissores | `issuers` | Emissor de boletos (legado, substituído pela conta digital; no Klinov = Asaas). |
| Exportar dados | `data-export` | Conjunto de dados → exportar XLSX (fracionado em volumes grandes). |
| Medicamentos | `drugs` | Base de ~2.000 medicamentos com posologia padrão; adicionar próprios; filtro "somente os criados". Usado no receituário. |
| Orçamento | `estimate` | Limite máximo de desconto (por perfil). |
| Personalização do sistema | `system-customization` | Cores (ícones da home, barra superior, barra de pesquisa), imagem de fundo, ícone, título, prévia ao vivo, restaurar padrão. |
| Procedimentos › Especialidades | — | Lista de especialidades. |
| Procedimentos › Tabelas de preço | `price-lists` | Filtro Todos/Particular/Plano-Convênio/Plano próprio · cards por tabela (tipo, "utiliza Unidade Odontológica (UO)?") · Ver detalhes (procedimentos com código TUSS, valor) · + Nova tabela. |
| Prontuário › Geral | `record-general` | Numeração automática de prontuário · sessões de procedimento · retorno de procedimentos · registro de tempo de execução · ocultar consulta SPC. |
| Prontuário › Anamnese | `anamnesis` | Modelos de anamnese por especialidade (Abrir modelo, editar perguntas). |
| Prontuário › Centros radiológicos / Diagnóstico digital | — | Integrações com radiologia (exames por CPF). |
| Prontuário › Documentos | `documents` | Modelos com tipo (Atestado, Contrato, Receituário comum/controlado, Termo, Solicitação de exame, Outro) e anexos automáticos. Ex.: Contrato de prestação de serviço, Contrato ortodontia, TCLE, Termo de autorização (menor), Orientações pós-cirúrgicas. |
| Recibos | `receipts` | Numeração sequencial: último recibo, iniciar próximo em. |
| Régua de cobrança | `billing-rule` | Linha do tempo de −10 a +10 dias do vencimento; clicar no dia cria regra: forma (Boleto…), tipo (Alerta), canal (SMS/Email/WhatsApp) e horário. |
| Relatórios | `reports` | Configuração do DRE (contas que alimentam cada grupo, débito/crédito, alíquotas IR/CSLL) e do Fluxo financeiro (montante inicial). |
| Segurança | `security` | 2FA obrigatório para todos · exigir usuário+senha de admin para **imprimir** e para **exportar**. |
| Taxas – formas de pagamento | `payment-fees` | Taxas por forma (valor fixo, %, faixas de parcelamento), instruções do boleto, desconto por pagamento antecipado, **multa e juros automáticos** por atraso. |

---

## Módulos menores

- **Confirmação e Alertas** (`/alert_confirmation_control`): tela legada, migrando para Configurações › Agenda › Confirmações e alertas (mesmo conteúdo).
- **Controle de Indicação** (`/referral_control`): kanban Indicado → Orçamento em aberto → Pagamento e execução → Indicação confirmada → Ação executada (recompensa ao indicador), com cartões "Indicado / Indicador", busca, ordenação, Relatório e arquivados.
- **Controle Protético** (`/prosthetic_control`): kanban **Pré-envio → Envio/Em laboratório → Retorno à clínica → Agendamento do paciente → Instalado**; filtro por profissional, busca, Relatório e arquivo por coluna; "Adicionar serviço" (paciente, serviço, laboratório, datas, valor).
- **CRM** (`/crm`): Gestão de campanhas (anúncios Meta conectados, "Conexão ativa") e **Gestão de leads** (`/crm/leads`): visão Quadro/Lista, + Novo lead, filtros por origem/campanha/etapa/marcador, colunas configuráveis, funil "do primeiro contato ao orçamento fechado".
- **Controle de Estoque** (`/inventory_control`): lista de produtos com busca; por item: entrada (+), movimentação (entrada/saída), excluir, editar, quantidade disponível, unidade (UN/CX), alerta de estoque mínimo (i). + Adicionar produto.
- **Gestão de alinhadores** (`/marketplace/aligners-management`): fichas de casos por status: Iniciados · Pendências da clínica · Pendências da empresa · Em tratamento · Finalizados (integração com fornecedor de alinhadores).
- **Planos** (`/financial/plans`): **Plano próprio** (tabela de preço própria para empresas/famílias, checkout integrado) e **Plano recorrente** (tratamento em mensalidades com cobrança automática).
- **Portal de assinatura** (`/signature_portal`): Documentos pendentes · Documentos assinados · Certificado digital do profissional; assinatura em lote por período.
- **Clinipay**: conta digital própria (abrir conta, extrato, recebíveis, maquininha). **No Klinov = Asaas.**
- **Tutoriais do sistema**: vídeos de ajuda.

---

# Comparação Clinicorp × Klinov

Base: este levantamento + o inventário do código do Klinov (14/10/2026). ✅ completo · 🟡 parcial ou só visual · ❌ não existe.

| Módulo | Klinov hoje | Principais lacunas |
|---|---|---|
| Navegação / home / busca | 🟡 | Sem rotas por URL; menu duplicado; busca da sidebar morta; home sem resumo do dia |
| Agenda | 🟡 | Compromissos/bloqueios, alerta de retorno, recorrência, lista de espera, impressão, horário de funcionamento aplicado, categorias editáveis, cor do profissional, paciente por **id** |
| Pacientes — lista/cadastro | 🟡 | Lista paginada com filtros; campos complementares não salvam; inativar/excluir; busca por id (hoje por nome, pode abrir o paciente errado) |
| Ficha do paciente (14 abas) | 🟡 | Visão geral, notas, evolução em texto, fichas por especialidade, indicações, documentos a partir de modelos, assinatura eletrônica |
| Orçamentos | 🟡 | Tabelas de preço cadastráveis, valor de convênio, impressão/PDF, envio, contrato, odontograma ligado ao orçamento |
| Odontograma | 🟡 | Faces, status A realizar/Executado/Existente vindo dos procedimentos |
| Anamnese | 🟡 | Editor de modelos, preenchimento pelo paciente via link, assinatura |
| CRC (9 filas kanban) | ❌ | Só a lista de inativos; nenhuma fila, nenhum registro de interação |
| Financeiro | 🟡 | Modelo de dados unificado; fornecedores; contas bancárias; caixa; OFX; cheques; taxas; DDA; edição de lançamentos |
| Metas | 🟡 | Por profissional/usuário |
| Relatórios (49) | 🟡 | ~10 hoje; faltam a maioria, filtros e exportação |
| Dashboard analítico | 🟡 | Vários gráficos com dados fictícios (inadimplência = 2% fixo, metas zeradas) |
| Profissionais | 🟡 | Agenda de trabalho não salva; inativar; cor da agenda não usada |
| Usuários e permissões | 🟡 | Permissões só escondem itens do menu; não valem no servidor; sem 2FA nem auditoria |
| Configurações (23 seções) | 🟡 | Dados da clínica, procedimentos/tabelas, modelos de documentos, régua de cobrança, assinatura, taxas, segurança, lixeira |
| Estoque · Protético · Indicação · Alinhadores · Planos · Portal | ❌ | Só placeholders |
| CRM de leads / campanhas | 🟡 | Campanhas de email/WhatsApp existem; falta funil de leads |

## Prioridade zero — segurança (antes de qualquer réplica)

Confirmado no código (`api/auth.js`):
1. `redefinir-senha` (l.116) **sem autenticação**: qualquer um troca a senha de qualquer `usuario_id` e recebe um token de sessão. É tomada de conta em produção.
2. `criar-usuario` (l.167) sem autenticação, com `clinica_id`/`perfil` vindos do corpo.
3. `alterar-senha` (l.439) sem autenticação (relatado pelo inventário).
4. `permissoes-salvar` sem checar admin; `billing.js`, `sync.js` e `clinicorp.js` sem autenticação; token do Clinicorp fixo no código de `importar-clinicorp`.

## Proposta de fases

0. **Segurança** — os itens acima. Pequeno, urgente.
1. **Fundação** — liberar slots em `/api` (`db.js`/`middleware.js` → `lib/`), migrations versionadas, roteador por mapa em `data.js`, roteamento por URL no front, paciente/profissional por **id**, unificar o modelo financeiro, permissões aplicadas no servidor, exclusão lógica (lixeira).
2. **Agenda completa** — compromissos/bloqueios, horários de funcionamento e de trabalho, categorias, cor do profissional, recorrência, lista de espera, alerta de retorno, check-in, impressão, preferências.
3. **Paciente e prontuário** — lista paginada, cadastro completo, 14 abas, notas, evolução, fichas por especialidade, documentos por modelo, anamnese editável/por link, odontograma com faces.
4. **Orçamentos e tabelas de preço** — CRUD de tabelas/procedimentos, convênio, PDF/envio, contrato, aprovação → plano de tratamento → financeiro.
5. **CRC** — as 9 filas em kanban com regras automáticas de entrada e saída + registro de interações.
6. **Financeiro** — conta corrente, fluxo, a pagar (fornecedores, recorrentes, anexos), a receber, controles, contas bancárias, OFX, caixa, taxas, régua de cobrança, Receita Saúde.
7. **Relatórios, dashboard e metas** — 49 relatórios no padrão filtro → listar → exportar, gráficos com dados reais, metas por profissional.
8. **Configurações** — as 23 seções.
9. **Módulos extras** — estoque, protético, indicações, leads, planos recorrentes (Asaas), portal de assinatura, alinhadores.
