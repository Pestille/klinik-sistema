# Klinik Sistema — Módulo 1: CRM + Dashboard

Sistema de gestão odontológica para Klinik Odontologia.

## Deploy rápido (Vercel)

1. Acesse https://vercel.com e faça login com GitHub
2. Clique em "Add New → Project"
3. Arraste a pasta do projeto ou conecte ao GitHub
4. Clique em "Deploy" — pronto!

## Domínio personalizado (após deploy)

No painel Vercel:
Settings → Domains → Add → kliniksistema.com.br

## Estrutura

```
klinik-sistema/
├── public/
│   ├── index.html    ← Aplicação completa
│   └── favicon.svg   ← Ícone da Klinik
├── vercel.json       ← Configuração de hospedagem
└── README.md
```

## Tecnologias

- Frontend puro (HTML/CSS/JS) — zero dependências
- IA via Claude API (scripts WhatsApp)
- Deploy gratuito via Vercel

## Dados

Atualmente usando dados de demonstração extraídos da API Clinicorp.
Para conectar dados ao vivo: editar as constantes no topo do app.js
