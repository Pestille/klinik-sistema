// lib/followup/textos.js — Pitch de vendas do follow-up de orçamentos
// Klinov — Campo Grande, MS
//
// A régua tem 4 mensagens, todas centradas no cuidado com o paciente e em
// começar o tratamento o quanto antes. Valores e pagamento NÃO aparecem nas
// mensagens: só a assistente fala disso, e só se o paciente perguntar.
//   1. Cuidado      (D+2)  — retoma o plano e mostra por que ele importa
//   2. Dúvidas      (D+5)  — acolhe a dúvida mais comum daquele tratamento
//   3. Saúde        (D+10) — o que acontece se esperar + confiança na clínica
//   4. Porta aberta (D+20) — última mensagem, respeitosa, com saída elegante
//
// Mensagens iniciadas pela clínica só saem por TEMPLATE aprovado na Meta.
// O texto fixo de cada template está em TEMPLATES (é o que se cadastra no
// WhatsApp Manager); as partes que mudam por paciente entram como {{n}}.
// Regras da Meta para os parâmetros: sem quebra de linha, sem tab, sem mais de
// 4 espaços seguidos — limparParam() garante isso.

// ── Por tipo de tratamento ───────────────────────────────────────
// importancia → mensagem 1 · duvida → mensagem 2 · adiar → mensagem 3
// Tom: claro, honesto e acolhedor. Nada de promessa de resultado, nada de medo
// exagerado: o que está aqui é o que qualquer dentista assinaria embaixo.
var CATEGORIAS = {
    implante: {
        nome: 'implante dentário',
        re: /IMPLANT|ENXERTO|SEIO MAXILAR|PROTOCOLO|OVERDENTURE|CARGA IMEDIATA|ZIGOMATIC/,
        importancia: 'Repor o dente com implante devolve a firmeza para mastigar e a segurança para sorrir, e ajuda a preservar o osso da região, que tende a diminuir quando o espaço fica vazio.',
        duvida: 'A pergunta que mais ouvimos é se dói. O implante é feito com anestesia local, e a maioria dos pacientes relata um pós-operatório tranquilo, com orientações claras e acompanhamento de perto da nossa equipe em cada etapa.',
        adiar: 'Quando o espaço do dente fica vazio por muito tempo, o osso da região vai diminuindo e os dentes vizinhos podem se mover, o que costuma deixar o tratamento mais complexo lá na frente.'
    },
    ortodontia: {
        nome: 'ortodontia',
        re: /ORTOD|APARELHO|ALINHADOR|INVISALIGN|CONTENCAO|MANUTENCAO ORTO|BRACKET/,
        importancia: 'Alinhar os dentes vai além da estética: facilita a higiene, distribui melhor a força da mordida e ajuda a proteger dentes e gengiva ao longo dos anos.',
        duvida: 'Muita gente pergunta quanto tempo leva e se incomoda. O tempo depende de cada caso e é acompanhado de perto nas manutenções; o desconforto costuma ser leve e passageiro nos primeiros dias após cada ajuste.',
        adiar: 'Quanto antes o alinhamento começa, mais previsível tende a ser o tratamento, já que desgastes e apinhamentos costumam se acentuar com o tempo.'
    },
    estetica: {
        nome: 'estética do sorriso',
        re: /LENTE|FACETA|LAMINADO|CLAREAMENTO|ESTETIC|MOCK.?UP|DSD|GENGIVOPLASTIA/,
        importancia: 'Um sorriso planejado em harmonia com o seu rosto muda a forma como você se sente em fotos, no trabalho e no dia a dia, e o planejamento cuidadoso é o que garante um resultado natural.',
        duvida: 'Uma dúvida comum é se o resultado fica artificial. Por isso tudo é planejado antes com você, respeitando o formato do seu rosto e a cor que combina com você, para que o resultado seja natural.',
        adiar: 'Cada mês adiado é mais um mês sem o sorriso que você quer, e o planejamento que fizemos para você já está pronto para começar.'
    },
    harmonizacao: {
        nome: 'harmonização orofacial',
        re: /TOXINA|BOTOX|HARMONIZ|PREENCH|BIOESTIMUL|HIALURON|FIOS DE PDO|SKINBOOSTER/,
        importancia: 'A harmonização bem indicada realça seus traços com naturalidade e ajuda a cuidar dos sinais do tempo de forma gradual e segura.',
        duvida: 'Muita gente teme ficar com aspecto artificial. O planejamento é feito para valorizar os seus traços, com produtos de qualidade e doses pensadas para um resultado natural.',
        adiar: 'Os cuidados preventivos rendem mais quando começam cedo, e o plano que montamos para você foi pensado para o seu momento atual.'
    },
    protese: {
        nome: 'prótese dentária',
        re: /PROTESE|COROA|PONTE|PPR|DENTADURA|ONLAY|INLAY|OVERLAY|BLOCO|PROVISORIO|NUCLEO|PINO/,
        importancia: 'A prótese devolve a mastigação completa, protege os dentes que ainda estão enfraquecidos e devolve a confiança para sorrir e conversar sem preocupação.',
        duvida: 'Muitos pacientes perguntam se a prótese fica com aparência natural. Ela é planejada na cor e no formato dos seus dentes, para ficar confortável e discreta.',
        adiar: 'Um dente enfraquecido ou um espaço sem reposição pode trincar, sobrecarregar os vizinhos ou alterar a mordida, o que costuma aumentar o tratamento necessário depois.'
    },
    endodontia: {
        nome: 'canal',
        re: /ENDOD|CANAL|PULP|RETRATAMENTO/,
        importancia: 'O tratamento de canal é o que permite salvar o seu próprio dente, eliminando a infecção e preservando a sua estrutura natural.',
        duvida: 'A dúvida mais comum é se o canal dói. Hoje ele é feito com anestesia e técnicas modernas, e a maioria dos pacientes sente bem menos do que imagina, muitas vezes alívio logo em seguida.',
        adiar: 'Uma infecção no canal não costuma regredir sozinha: com o tempo ela pode causar dor, inchaço e até levar à perda do dente.'
    },
    periodontia: {
        nome: 'gengiva',
        re: /PERIODON|RASPAGEM|GENGIV|CURETAGEM|ALISAMENTO RADICULAR|ENXERTO GENGIVAL/,
        importancia: 'Cuidar da gengiva é cuidar da base que sustenta os dentes: o tratamento controla a inflamação e ajuda a evitar mobilidade e perda dentária.',
        duvida: 'Muitos pacientes perguntam se o tratamento incomoda. Ele é feito com anestesia quando necessário, e o desconforto costuma ser leve e passar em poucos dias.',
        adiar: 'A doença da gengiva costuma avançar sem dor, e quando os sinais aparecem ela já pode ter comprometido o osso que segura os dentes.'
    },
    cirurgia: {
        nome: 'cirurgia oral',
        re: /EXTRA|EXODONTIA|SISO|TERCEIRO MOLAR|INCLUSO|FRENECTOMIA|BIOPSIA|CIRURG/,
        importancia: 'Resolver agora evita que o problema evolua para dor, infecção ou danos aos dentes vizinhos, e permite fazer tudo de forma planejada e tranquila.',
        duvida: 'A dúvida mais comum é sobre a recuperação. Você sai com todas as orientações, e a maioria dos pacientes retoma a rotina em poucos dias, com acompanhamento da nossa equipe.',
        adiar: 'Quando a cirurgia é adiada, o risco é ela acabar acontecendo numa urgência, com dor ou infecção, em vez de um momento planejado por você.'
    },
    restauracao: {
        nome: 'restaurações',
        re: /RESTAURA|RESINA|CARIE|AMALGAMA/,
        importancia: 'Tratar agora preserva o máximo do seu dente natural, com procedimentos mais simples, rápidos e com melhor custo-benefício.',
        duvida: 'Muita gente pergunta se precisa de anestesia e se demora. As restaurações costumam ser rápidas, feitas com conforto, e você já sai com o dente pronto para usar.',
        adiar: 'Uma cárie não para de avançar sozinha: o que hoje é uma restauração simples pode virar um canal ou uma coroa com o tempo.'
    },
    prevencao: {
        nome: 'prevenção',
        re: /LIMPEZA|PROFILAXIA|FLUOR|SELANTE|TARTARO|PREVEN/,
        importancia: 'A prevenção é o investimento que mais protege o seu sorriso e o seu bolso, porque evita que pequenos problemas virem tratamentos maiores.',
        duvida: 'Muitos pacientes perguntam se é rápido. É, sim: são procedimentos simples, confortáveis e que já deixam aquela sensação de boca limpa na hora.',
        adiar: 'Tártaro e placa acumulados são o ponto de partida para gengivite e cáries, e quanto mais tempo passa, maior tende a ser o tratamento.'
    },
    geral: {
        nome: 'saúde bucal',
        re: null,
        importancia: 'O plano foi montado para cuidar da sua saúde bucal de forma completa, resolvendo o que precisa agora antes que vire algo maior.',
        duvida: 'É natural ter dúvidas antes de começar, e o nosso papel é explicar cada etapa com clareza para você decidir com segurança.',
        adiar: 'Na odontologia, adiar quase sempre significa um tratamento maior depois, enquanto agora o caminho já está planejado e pronto para começar.'
    }
}
// Ordem importa: o primeiro que bate ganha (implante antes de prótese, etc.)
var ORDEM = ['implante', 'harmonizacao', 'ortodontia', 'estetica', 'endodontia', 'periodontia', 'protese', 'cirurgia', 'restauracao', 'prevencao']

function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase() }

function categoriaDoItem(nome) {
    var n = norm(nome)
    for (var i = 0; i < ORDEM.length; i++) if (CATEGORIAS[ORDEM[i]].re.test(n)) return ORDEM[i]
    return 'geral'
}

// Categoria do orçamento = a do item (ou grupo de itens) de maior valor
function categoriaDoOrcamento(itens) {
    var soma = {}
    ;(itens || []).forEach(function (it) {
        var c = categoriaDoItem(it.procedimento_nome)
        soma[c] = (soma[c] || 0) + (Number(it.valor_unitario) || 0) * Math.max(Number(it.quantidade) || 1, 1)
    })
    var melhor = 'geral', max = -1
    Object.keys(soma).forEach(function (c) {
        // 'geral' só ganha se não houver nenhuma categoria reconhecida
        var v = c === 'geral' ? soma[c] - 1e12 : soma[c]
        if (v > max) { max = v; melhor = c }
    })
    return melhor
}

// ── Formatação ───────────────────────────────────────────────────
function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
function capitalizar(s) {
    var minus = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1 }
    return String(s || '').toLowerCase().split(/\s+/).filter(Boolean).map(function (p, i) { return i > 0 && minus[p] ? p : p.charAt(0).toUpperCase() + p.slice(1) }).join(' ')
}
function primeiroNome(n) { return capitalizar(String(n || '').trim().split(/\s+/)[0] || '') || 'tudo bem' }
function limparParam(s, max) {
    var t = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
    if (max && t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
    return t || '-'
}
function dataBr(ymd) { var p = String(ymd || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : '' }

// "Dra. Maisa Keffler" — usa o título que já estiver no cadastro; senão Dr(a).
function nomeDentista(nome) {
    var n = String(nome || '').trim()
    if (!n) return 'nossa equipe'
    var m = n.match(/^(DRA?\.?|DR\(A\)\.?)\s+(.*)$/i)
    var corpo = capitalizar(m ? m[2] : n).split(' ').slice(0, 2).join(' ')
    if (m) return (/^dra/i.test(m[1]) ? 'Dra. ' : 'Dr. ') + corpo
    return 'Dr(a). ' + corpo
}

// "a Dra. Maisa Keffler", "o Dr. João Silva", "a nossa equipe"; Dr(a). sem artigo
function comArtigo(n) { return /^Dra\. /.test(n) || n === 'nossa equipe' ? 'a ' + n : /^Dr\. /.test(n) ? 'o ' + n : n }

// Rótulo do tratamento: título do orçamento, senão o nome da categoria
function rotuloTratamento(orc, categoria) {
    var t = String(orc.titulo || '').trim()
    if (t && !/^or[cç]amento/i.test(t)) return capitalizar(t).replace(/^./, function (c) { return c.toLowerCase() })
    return CATEGORIAS[categoria].nome
}

// Frase de pagamento a partir da configuração da clínica. Só afirma o que a
// clínica configurou: sem número de parcelas, não promete número de parcelas;
// valor da parcela só aparece quando o parcelamento é sem juros.
function textoPagamento(cfg, valor) {
    if (cfg.texto_pagamento && String(cfg.texto_pagamento).trim()) return String(cfg.texto_pagamento).trim()
    var n = parseInt(cfg.parcelas_cartao, 10) || 0
    var cartao
    if (n > 1) cartao = 'parcelamento em até ' + n + 'x' + (cfg.sem_juros && valor > 0 ? ' de ' + moeda(valor / n) + ' sem juros' : '') + ' no cartão'
    else cartao = 'parcelamento no cartão de crédito'
    var nc = parseInt(cfg.parcelas_clube, 10) || 0
    if (cfg.klinik_club && nc > n) cartao += ' (ou em até ' + nc + 'x para assinantes do ' + (cfg.nome_clube || 'Klinik Club') + ')'
    var d = Number(cfg.desconto_pix) || 0
    var pix = d > 0
        ? String(d).replace('.', ',') + '% de desconto no pagamento à vista via Pix' + (valor > 0 ? ', que deixa o tratamento em ' + moeda(valor * (1 - d / 100)) : '')
        : 'pagamento à vista via Pix'
    return cartao + ' ou ' + pix
}

// "(67) 99991-5131"
function foneBr(t) {
    var d = String(t || '').replace(/\D/g, '')
    if (d.length >= 12 && d.slice(0, 2) === '55') d = d.slice(2)
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7)
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6)
    return ''
}

// ── Templates (texto fixo que vai para aprovação na Meta) ────────
// Categoria: MARKETING · Idioma: pt_BR · Botões de resposta rápida (os mesmos
// nos 4): "Quero agendar" · "Tenho uma dúvida" · "Não tenho interesse".
var BOTOES = ['Quero agendar', 'Tenho uma dúvida', 'Não tenho interesse']
var TEMPLATES = [
    {
        etapa: 1, chave: 'm1', nome_padrao: 'klinik_tratamento_cuidado', papel: 'Cuidado com o paciente',
        corpo: 'Olá, {{1}}! Aqui é da {{2}}. 😊\n\n' +
            'Passando para saber como você está e retomar o plano de tratamento que {{3}} preparou com tanto cuidado para você: *{{4}}*.\n\n' +
            '{{5}}\n\n' +
            'Por isso, queremos te ajudar a começar o quanto antes. Ficou alguma dúvida? É só responder esta mensagem que a gente te ajuda por aqui mesmo.',
        params: ['nome', 'clinica', 'dentista', 'tratamento', 'importancia']
    },
    {
        etapa: 2, chave: 'm2', nome_padrao: 'klinik_tratamento_duvidas', papel: 'Acolhimento das dúvidas',
        corpo: 'Oi, {{1}}, tudo bem?\n\n' +
            'Sabemos que começar o seu tratamento de {{2}} pode trazer algumas dúvidas, e queremos que você tenha toda a tranquilidade para decidir.\n\n' +
            '{{3}}\n\n' +
            'Se quiser, respondo suas dúvidas por aqui ou reservo um horário para você conversar de novo com {{4}}.',
        params: ['nome', 'tratamento', 'duvida', 'dentista']
    },
    {
        etapa: 3, chave: 'm3', nome_padrao: 'klinik_tratamento_saude', papel: 'Saúde e urgência',
        corpo: 'Oi, {{1}}! A nossa equipe segue atenta à sua saúde e ao seu tratamento de {{2}}.\n\n' +
            '{{3}}\n\n' +
            'Aqui na {{4}}, {{5}}. O seu plano está pronto, e a nossa recomendação é não adiar.\n\n' +
            'Posso reservar um horário para você esta semana?',
        params: ['nome', 'tratamento', 'adiar', 'clinica', 'prova_social']
    },
    {
        etapa: 4, chave: 'm4', nome_padrao: 'klinik_tratamento_ultima', papel: 'Porta aberta',
        corpo: 'Olá, {{1}}! Esta é a nossa última mensagem sobre o seu tratamento de {{2}}.\n\n' +
            'Respeitamos o seu momento, mas não queremos deixar de reforçar: cuidar disso o quanto antes faz diferença para você. O seu plano fica reservado {{3}}.\n\n' +
            'Quando decidir, é só responder aqui que a {{4}} cuida de tudo para você. Se preferir não receber mais mensagens sobre este tratamento, toque em "Não tenho interesse".',
        params: ['nome', 'tratamento', 'validade', 'clinica']
    }
]

// Variáveis de um paciente/orçamento → valores dos parâmetros
function variaveis(ctx) {
    var cat = CATEGORIAS[ctx.categoria] || CATEGORIAS.geral
    var cfg = ctx.cfg || {}
    var hoje = ctx.hoje
    var validade = ctx.orcamento.validade && String(ctx.orcamento.validade).slice(0, 10) >= hoje
        ? 'até ' + dataBr(ctx.orcamento.validade) : 'para você por mais alguns dias'
    return {
        nome: primeiroNome(ctx.paciente_nome),
        clinica: ctx.clinica_nome || 'Klinik Odontologia',
        dentista: comArtigo(nomeDentista(ctx.orcamento.profissional_nome)),
        tratamento: rotuloTratamento(ctx.orcamento, ctx.categoria),
        importancia: cat.importancia,
        duvida: cat.duvida,
        adiar: cat.adiar,
        pagamento: textoPagamento(cfg, ctx.valor),
        prova_social: cfg.prova_social || 'cuidamos de perto de cada etapa do seu tratamento',
        validade: validade
    }
}

// Monta os parâmetros (para a API) e o texto final (para histórico/prévia)
function montarMensagem(etapa, ctx) {
    var tpl = TEMPLATES[etapa - 1]
    var v = variaveis(ctx)
    var params = tpl.params.map(function (k) { return limparParam(v[k], k === 'importancia' || k === 'duvida' || k === 'adiar' || k === 'pagamento' ? 320 : 80) })
    var texto = tpl.corpo.replace(/\{\{(\d+)\}\}/g, function (_, i) { return params[Number(i) - 1] })
    return { template: tpl, params: params, texto: texto }
}

module.exports = {
    CATEGORIAS, TEMPLATES, BOTOES,
    categoriaDoItem, categoriaDoOrcamento, montarMensagem, variaveis, textoPagamento,
    primeiroNome, nomeDentista, moeda, limparParam, capitalizar, foneBr
}
