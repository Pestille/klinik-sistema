# Klinik Sistema — Guia de Design Frontend

## Stack
HTML estático + CSS inline no `index.html` + Vercel Serverless Node.js + Turso DB (libSQL).
Sem bundler, sem framework JS. Tudo em um único `index.html`.

## Banco de Dados (Turso) — Backup 20/03/2026
Dados importados do Clinicorp e agora autônomos. O sistema opera 100% a partir do Turso.

| Tabela | Registros | Descrição |
|---|---|---|
| pacientes | 1.112 | Cadastro completo com nome, CPF, telefone, email, nascimento |
| agendamentos | 4.845 | Com profissional_id, paciente_nome, hora_fim, status |
| pagamentos | 1.104 | Formas, bandeiras, parcelas, treatment_id, titular, checkout |
| procedimentos | 688 | 5 tabelas de preço (PARTICULAR, PREVIDENT, etc.) |
| financeiro | 71 | Recibos com valor e data_pagamento |
| profissionais | 8 | Com CPF, email, telefone, CRO, especialidade |
| usuarios | 1 | Sistema de autenticação próprio |

**API Clinicorp desconectada.** Dados do Clinicorp servem apenas como base histórica.
Todas as novas operações (cadastros, agendamentos, financeiro) são feitas diretamente no Turso.

---

## Paleta de cores

```css
--green:      #034030;   /* primário — ações principais, sidebar ativa, badges */
--green2:     #1B5E3B;   /* topbar, hover em itens de navegação */
--green3:     #2E7D52;   /* botões secundários, bordas de destaque */
--green-light:#E8F5E9;   /* backgrounds de estado positivo, tags "ativo" */
--orange:     #E65100;   /* CTA principal, alertas de ação, badges urgentes */
--orange2:    #FF6D00;   /* hover do CTA */
--orange-light:#FFF3E0;  /* backgrounds de alerta suave */

--bg:         #F5F5F5;   /* fundo geral da página */
--surface:    #FFFFFF;   /* cards, modais, painéis */
--surface2:   #FAFAFA;   /* linhas alternadas, inputs desabilitados */

--text:       #1A1A1A;   /* títulos, labels */
--text2:      #424242;   /* corpo de texto */
--text3:      #757575;   /* placeholders, metadados, rodapés de card */

--border:     #E0E0E0;   /* divisórias, bordas de card */
--border2:    #F0F0F0;   /* separadores internos sutis */

--blue:       #1565C0;   /* links, informação */
--red:        #C62828;   /* erros, exclusão */
--teal:       #00695C;   /* status especiais */
```

Nunca use cores fora desta paleta. Nunca use gradientes decorativos.

---

## Tipografia

**Fonte:** Roboto (já carregada via Google Fonts)

| Uso                        | Size  | Weight | Color      |
|----------------------------|-------|--------|------------|
| Título de seção/página     | 20px  | 500    | `--text`   |
| Subtítulo / label de card  | 13px  | 500    | `--text3`  uppercase |
| Corpo padrão               | 14px  | 400    | `--text2`  |
| Dado numérico destacado    | 28px  | 300    | `--text`   |
| Caption / metadado         | 12px  | 400    | `--text3`  |
| Botão                      | 13px  | 500    | —          |

- `letter-spacing: 0.04em` em labels uppercase (subtítulos de seção)
- `letter-spacing: -0.02em` em números grandes
- `line-height: 1.5` no corpo, `1.2` em títulos

---

## Espaçamento

Sistema baseado em múltiplos de 4px:

```
4px  — separação mínima (ícone/texto dentro de um componente)
8px  — padding interno compacto (badges, chips)
12px — padding interno padrão (botões, inputs)
16px — padding de card
20px — gap entre seções dentro de um card
24px — gap entre cards / margem lateral de painéis
32px — separação entre blocos de conteúdo maiores
```

Nunca use padding/margin arbitrário fora desta escala.

---

## Cards

```css
background: var(--surface);
border-radius: 8px;
border: 1px solid var(--border);
box-shadow: 0 1px 3px rgba(0,0,0,.08);
padding: 20px 24px;
```

- Header do card: `font-size: 13px; font-weight: 500; color: var(--text3); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 16px`
- Nunca use `box-shadow` pesado em cards (sem `blur > 12px`)
- Cards de KPI: número grande (`font-size: 28px; font-weight: 300`) + label abaixo

---

## Botões

**Primário (CTA):**
```css
background: var(--orange);
color: #fff;
border: none;
border-radius: 6px;
padding: 10px 20px;
font-size: 13px;
font-weight: 500;
cursor: pointer;
transition: background .15s, transform .1s;
```
Hover: `background: var(--orange2)`
Active: `transform: scale(.98)`

**Secundário:**
```css
background: transparent;
color: var(--green);
border: 1.5px solid var(--green3);
border-radius: 6px;
padding: 9px 20px;
```
Hover: `background: var(--green-light)`

**Ghost / ícone:**
```css
background: transparent;
border: none;
color: var(--text3);
border-radius: 6px;
padding: 8px;
```
Hover: `background: var(--border2); color: var(--text)`

Nunca use botões com `border-radius > 8px` (sem pill buttons).

---

## Inputs e Selects

```css
border: 1.5px solid var(--border);
border-radius: 6px;
padding: 9px 12px;
font-size: 14px;
color: var(--text);
background: var(--surface);
transition: border-color .15s;
outline: none;
```
Focus: `border-color: var(--green3); box-shadow: 0 0 0 3px rgba(46,125,82,.12)`
Inválido: `border-color: var(--red)`

Label sempre **acima** do input, nunca como placeholder flutuante.

---

## Tabelas

```css
width: 100%;
border-collapse: collapse;
font-size: 14px;
```

```css
th {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--text3);
  padding: 10px 16px;
  border-bottom: 2px solid var(--border);
  text-align: left;
}
td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border2);
  color: var(--text2);
}
tr:hover td { background: var(--surface2) }
```

- Nunca use `border` em todas as células (zebra ou hover apenas)
- Colunas numéricas: `text-align: right; font-variant-numeric: tabular-nums`

---

## Badges e Status

```css
/* base */
display: inline-flex;
align-items: center;
gap: 4px;
padding: 3px 10px;
border-radius: 4px;
font-size: 11px;
font-weight: 500;
text-transform: uppercase;
letter-spacing: .04em;
```

| Estado      | Background       | Cor do texto |
|-------------|------------------|--------------|
| ativo/pago  | `--green-light`  | `--green`    |
| pendente    | `--orange-light` | `--orange`   |
| inativo     | `--border`       | `--text3`    |
| erro        | `#FFEBEE`        | `--red`      |

---

## Micro-interações

Todas as transições devem usar `ease` com duração **80–150ms**. Nunca use `linear`.

```css
/* Regra global */
button, a, input, select, .card, tr { transition-duration: .12s; transition-timing-function: ease }
```

Padrões obrigatórios:
- Hover em botão: mudança de cor de fundo
- Click em botão primário: `transform: scale(.98)`
- Hover em linha de tabela: `background` suave
- Focus em input: borda colorida + `box-shadow` de foco
- Abertura de modal: `opacity 0→1` + `transform: translateY(8px)→translateY(0)` em 150ms
- Loading state: skeleton com `animation: shimmer 1.4s infinite` (nunca spinner piscante)

---

## Sidebar e Navegação

- Item ativo: `background: rgba(255,255,255,.15); color: #fff; border-left: 3px solid #fff`
- Item inativo: `color: rgba(255,255,255,.75)`
- Hover: `background: rgba(255,255,255,.08)`
- Ícone sempre 20px, alinhado com o texto por `gap: 10px`

---

## Regras que nunca devem ser quebradas

1. **Sem sombras pesadas.** `box-shadow` máximo: `0 4px 12px rgba(0,0,0,.12)`
2. **Sem border-radius exagerado.** Máximo `8px` em containers, `6px` em inputs/botões, `4px` em badges
3. **Sem cores fora da paleta.** Nem para efeitos hover
4. **Sem texto centralizado em blocos longos.** Centralizar apenas em KPIs e estados vazios
5. **Sem ícones decorativos sem propósito.** Ícone sempre acompanha ação ou dado
6. **Sem animações longas.** Máximo 300ms em qualquer transição
7. **Sem estilos genéricos de IA** — nada de gradientes azul-roxo, cards com sombra enorme, ou tipografia heroica desconectada do conteúdo
