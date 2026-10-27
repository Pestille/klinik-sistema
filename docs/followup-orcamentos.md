# Follow-up automático de orçamentos (WhatsApp + assistente virtual)

Recupera orçamentos que travaram no fechamento. Todo dia, por volta das 9h de Campo Grande, o sistema
pega os orçamentos em aberto, manda uma sequência de 4 mensagens pelo WhatsApp oficial da clínica e,
quando o paciente responde, uma assistente virtual (Claude) tira as dúvidas e passa para a equipe
assim que ele quer agendar ou negociar.

Painel: **CRC › Follow-up automático de orçamentos** (abas Conversas, Mensagens e Configuração).

## A régua

| Mensagem | Dia | Papel | O que faz |
|---|---|---|---|
| 1 | D+2 | Valor | Retoma o plano do dentista, explica por que o tratamento importa, apresenta as formas de pagamento |
| 2 | D+5 | Dúvidas | Responde a objeção mais comum daquele tratamento (dor, tempo, aparência…) e reforça o pagamento |
| 3 | D+10 | Custo de adiar | Mostra, com honestidade clínica, o que acontece se esperar + prova social; convida a reservar horário |
| 4 | D+20 | Porta aberta | Última mensagem, sem pressão, com saída elegante ("Não tenho interesse") |

- O texto muda conforme o tratamento do orçamento: implante, ortodontia, estética, harmonização, prótese,
  canal, gengiva, cirurgia, restauração, prevenção (o item de maior valor define a categoria).
- Todas têm 3 botões: **Quero agendar** · **Tenho uma dúvida** · **Não tenho interesse**.
- Os dias são configuráveis. Orçamentos antigos (até 90 dias, configurável) entram com a mensagem 1 no
  dia em que forem incluídos, priorizando os **maiores valores**, com limite de novos por dia.

### Quem fica de fora / quando a régua para
- Paciente com `aceita_marketing = 0`, inativo ou sem telefone.
- Paciente que já aprovou outro orçamento depois deste, ou que já tem outro orçamento na régua.
- Paciente com consulta marcada de hoje em diante (a régua espera a consulta passar).
- Até 3 dias depois de o paciente responder (configurável), para não atropelar a conversa.
- Orçamento **aprovado** → status *Fechou* (conta como valor recuperado). Reprovado/excluído → encerrado.
- Domingo (configurável).

### Quando o paciente responde
| Resposta | O que acontece |
|---|---|
| Botão **Quero agendar** | Resposta fixa, status *Precisa da equipe*, cartão do CRC vai para "Retornar novamente" (hoje) e e-mail de alerta |
| Botão **Tenho uma dúvida** | Pede a dúvida; a assistente responde a próxima mensagem |
| Botão **Não tenho interesse** | Agradece e pergunta o motivo (vira dado para melhorar a conversão) |
| "PARAR", "SAIR"… | Desliga o marketing no cadastro do paciente e confirma |
| Qualquer outra mensagem | A assistente responde com base no orçamento, nas formas de pagamento configuradas e no histórico |

A assistente **transfere para a equipe** quando o paciente quer agendar, pede para falar com alguém,
quer negociar algo fora do configurado, traz dúvida clínica, urgência ou reclamação. Ela nunca inventa
preço, desconto, parcela, prazo ou horário, não faz diagnóstico e se apresenta como assistente virtual
se perguntarem. Depois de transferida, ela para de responder aquela conversa. Também transfere se a IA
estiver fora do ar ou se a conversa passar de 15 respostas no dia.

A equipe pode responder pelo próprio painel (enquanto a janela de 24h do WhatsApp estiver aberta),
pausar a régua, assumir a conversa, devolvê-la para a assistente ou encerrar. Tudo fica registrado no
histórico do paciente no CRC.

## Como ativar (uma vez)

### 1. Cadastrar os 4 templates na Meta
WhatsApp Manager › Gerenciar modelos › Criar modelo. Para cada um: categoria **Marketing**,
idioma **Português (BR)**, os 3 botões de **resposta rápida** acima, e os valores de exemplo abaixo
(a Meta pede amostra de cada variável). O nome tem de ser exatamente este (ou ajuste em Configuração).

**1. `klinik_orcamento_valor`**
```
Olá, {{1}}! Aqui é da {{2}}. 😊

Passando para retomar o plano de tratamento que {{3}} preparou para você: *{{4}}*.

{{5}}

Para caber no seu planejamento, você pode contar com {{6}}.

Ficou alguma dúvida? É só responder esta mensagem que a gente te ajuda por aqui mesmo.
```
Amostras: {{1}} Maria · {{2}} Klinik Odontologia · {{3}} Dra. Maisa Keffler · {{4}} implante dentário ·
{{5}} Repor o dente com implante devolve a firmeza para mastigar e a segurança para sorrir, e ajuda a preservar o osso da região, que tende a diminuir quando o espaço fica vazio. ·
{{6}} parcelamento em até 12x de R$ 1.500,00 sem juros no cartão ou 5% de desconto no pagamento à vista via Pix

**2. `klinik_orcamento_duvidas`**
```
Oi, {{1}}, tudo bem?

Antes de começar o seu tratamento de {{2}}, é muito comum surgirem algumas dúvidas, e é exatamente para isso que estamos aqui.

{{3}}

Sobre o investimento, lembrando que você pode escolher entre {{4}}.

Se quiser, respondo suas dúvidas por aqui ou reservo um horário para você conversar de novo com {{5}}.
```
Amostras: {{1}} Maria · {{2}} implante dentário ·
{{3}} A pergunta que mais ouvimos é se dói. O implante é feito com anestesia local, e a maioria dos pacientes relata um pós-operatório tranquilo, com orientações claras e acompanhamento de perto da nossa equipe em cada etapa. ·
{{4}} parcelamento em até 12x de R$ 1.500,00 sem juros no cartão ou 5% de desconto no pagamento à vista via Pix · {{5}} Dra. Maisa Keffler

**3. `klinik_orcamento_adiar`**
```
Oi, {{1}}! Um lembrete importante sobre o seu tratamento de {{2}}.

{{3}}

Aqui na {{4}}, {{5}}, e o seu plano já está pronto para começar quando você quiser.

Posso reservar um horário para você esta semana?
```
Amostras: {{1}} Maria · {{2}} implante dentário ·
{{3}} Quando o espaço do dente fica vazio por muito tempo, o osso da região vai diminuindo e os dentes vizinhos podem se mover, o que costuma deixar o tratamento mais complexo lá na frente. ·
{{4}} Klinik Odontologia · {{5}} mais de 2.500 pacientes já confiaram o sorriso deles a nós

**4. `klinik_orcamento_ultima`**
```
Olá, {{1}}! Esta é a nossa última mensagem sobre o orçamento do seu tratamento de {{2}}.

Sabemos que cada pessoa tem o seu momento, e respeitamos o seu. O seu plano fica reservado {{3}}.

Quando decidir, é só responder aqui que a {{4}} cuida de tudo para você. Se preferir não receber mais mensagens sobre este orçamento, toque em "Não tenho interesse".
```
Amostras: {{1}} Maria · {{2}} implante dentário · {{3}} até 30/11 · {{4}} Klinik Odontologia

> A aprovação costuma sair em minutos ou poucas horas. Se a Meta reclassificar algum como "Utilidade"
> ou recusar, ajuste o texto fixo aqui e em `lib/followup/textos.js` (os dois precisam ser idênticos).

### 2. Variáveis de ambiente na Vercel (projeto klinik-sistema)
| Variável | Para quê | Situação |
|---|---|---|
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | Envio pela API oficial | já existem (confirmação de consultas) |
| `ANTHROPIC_API_KEY` | Assistente virtual | **nova** — criar em console.anthropic.com |
| `ANTHROPIC_MODEL` | Opcional; padrão `claude-sonnet-5-5` | opcional |
| `RESEND_API_KEY` | E-mail "precisa da equipe" | já existe |
| `CRON_SECRET` | Protege o cron | já existe |

O webhook já está assinado no campo `messages` (é o mesmo da confirmação de consultas): ele passa a
receber também os status de entrega/leitura, que alimentam o painel.

### 3. Testar e ligar
1. Configuração › ligue **Follow-up ligado** + **Modo teste** e informe o seu celular como telefone de teste.
   Preencha parcelas sem juros e desconto no Pix (sem isso, as mensagens falam só "parcelamento no
   cartão" e "pagamento à vista via Pix", sem números).
2. Clique **Rodar régua agora**: até 3 orçamentos reais geram mensagens, mas todas chegam no seu celular.
   Responda como se fosse o paciente (dúvidas, "achei caro", "quero agendar") e veja a conversa no painel.
3. Ajuste o que quiser e desligue o **Modo teste**: os registros de teste são apagados e, a partir da
   próxima execução, os pacientes reais começam a receber. Comece com 30 novos por dia e acompanhe a
   qualidade do número no WhatsApp Manager antes de aumentar.

## Rotina da equipe
- Filtro **Precisam da equipe** no painel (ou o e-mail de alerta): chamar o paciente e agendar.
- Ao aprovar o orçamento no sistema, o follow-up marca **Fechou** sozinho na execução seguinte.
- A aba **Conversas** mostra taxa de resposta, fechamentos, valor recuperado e as objeções mais comuns.

## Observações
- **Atendimento humano:** se o número usado pela API não estiver em modo *coexistência* com o app
  WhatsApp Business, a equipe não vê essas conversas no celular. Nesse caso, responda pelo painel
  (janela de 24h) ou ligue para o paciente.
- **LGPD:** só recebe quem tem `aceita_marketing` ativo; "PARAR" desliga na hora; toda mensagem fica
  registrada. A mensagem cita o tipo de tratamento, que é dado de saúde: mantenha o consentimento de
  comunicação dos pacientes atualizado.
- **Custo:** cada mensagem de marketing iniciada pela clínica é cobrada pela Meta por mensagem
  entregue; as respostas dentro das 24h abertas pelo paciente não são cobradas como marketing. A IA
  custa centavos por conversa.
