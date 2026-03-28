# Alexa Skill - Klinik Odontologia

## Passo a passo para publicar a skill

### 1. Criar a Skill no Amazon Developer Console

1. Acesse [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask)
2. Clique **Create Skill**
3. **Skill name**: `Klinik Odontologia`
4. **Primary locale**: `Portuguese (BR)`
5. **Type of experience**: Other
6. **Model**: Custom
7. **Hosting**: Provision your own
8. Clique **Create Skill** → selecione **Start from Scratch**

### 2. Configurar o Interaction Model

1. No menu lateral: **Interaction Model** → **JSON Editor**
2. Cole o conteúdo do arquivo `interaction-model.json`
3. Clique **Save Model** → **Build Model**

### 3. Configurar o Endpoint

1. Menu lateral: **Endpoint**
2. Selecione **HTTPS**
3. **Default Region**: `https://klinik-sistema.vercel.app/api/voz`
4. **SSL Certificate**: `My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority`
5. Clique **Save Endpoints**

### 4. Configurar Account Linking (vinculação de conta)

1. Menu lateral: **Account Linking**
2. Ative **Do you allow users to create an account or link to an existing account?**
3. **Authorization Grant Type**: `Implicit Grant`
4. **Authorization URI**: `https://klinik-sistema.vercel.app/app` (usuário faz login e obtém token)
5. Na prática, o profissional cola seu `token_voz` como Access Token

**Alternativa simplificada (sem OAuth):**
- O profissional gera o token no sistema
- Ao ativar a skill, informa o token via app Alexa

### 5. Testar

1. Menu: **Test** → ative teste em **Development**
2. Diga ou digite: `Alexa, abrir Klinik Odontologia`
3. Depois: `Quantos pacientes tenho hoje?`

### 6. Publicar

1. Menu: **Distribution**
2. Preencha:
   - **Public Name**: Klinik Odontologia
   - **One Sentence Description**: Consulte sua agenda odontológica por voz
   - **Detailed Description**: Profissionais de odontologia podem consultar sua agenda, ver próximos pacientes, verificar faltas e aniversariantes diretamente pela Alexa.
   - **Example Phrases**:
     - "Alexa, abrir Klinik Odontologia"
     - "Alexa, perguntar ao Klinik quantos pacientes tenho hoje"
     - "Alexa, perguntar ao Klinik minha agenda de amanhã"
   - **Category**: Health & Fitness
   - **Keywords**: odontologia, dentista, agenda, clínica, consultório
3. **Privacy & Compliance**: marque que a skill coleta informações pessoais (agenda médica)
4. **Availability**: Brazil
5. Clique **Submit for review**

### Comandos disponíveis

| Comando | O que faz |
|---------|-----------|
| "Alexa, abrir Klinik Odontologia" | Inicia a skill |
| "Minha agenda de hoje" | Lista pacientes do dia |
| "Agenda de amanhã" | Lista pacientes de amanhã |
| "Próximo paciente" | Mostra o próximo atendimento |
| "Quantos pacientes hoje" | Conta os agendamentos |
| "Faltas de hoje" | Conta pacientes que faltaram |
| "Aniversariantes do mês" | Lista aniversariantes |

### Como cada cliente (clínica) configura

1. No sistema Klinik, vá em **Assistente IA**
2. Clique **Gerar Meu Token Pessoal**
3. Copie o token
4. No app Alexa do celular, busque a skill **Klinik Odontologia**
5. Ative e vincule a conta com o token
6. Pronto! Diga "Alexa, abrir Klinik Odontologia"
