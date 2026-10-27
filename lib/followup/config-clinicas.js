// lib/followup/config-clinicas.js — Configuração fixa do follow-up por clínica
// Klinov — Campo Grande, MS
//
// Enquanto a clínica não usa a tela de Configuração do Klinov, as condições
// ficam aqui (e têm prioridade sobre o que estiver salvo no banco). Mudou algo?
// Edite este arquivo e publique. Dados pessoais NÃO entram aqui (o repositório é
// público): o celular de teste vem da variável de ambiente FOLLOWUP_TELEFONE_TESTE.

module.exports = {
    // Klinik Odontologia (KLINIK_CLINICA_ID = 1)
    1: {
        ativo: true,
        // Modo teste: tudo vai para FOLLOWUP_TELEFONE_TESTE (até 3 orçamentos por dia).
        // Para enviar aos pacientes, troque para false e publique.
        modo_teste: true,

        // Pagamento (a assistente só fala disso se o paciente perguntar)
        parcelas_cartao: 12,
        sem_juros: true,
        klinik_club: true,
        nome_clube: 'Klinik Club',
        parcelas_clube: 21,
        desconto_pix: 10,
        entrada_boleto_pct: 30, // + restante no boleto, sujeito a aprovação

        // Quem atende quando a assistente transfere
        nome_equipe: 'nossa secretária',
        telefone_atendimento: '67999915131',
        email_alerta: 'contato@klinikodontologia.com.br',

        // Mensagem 3
        prova_social: 'já realizamos mais de 10 mil procedimentos em mais de 2.500 pacientes'
    }
}
