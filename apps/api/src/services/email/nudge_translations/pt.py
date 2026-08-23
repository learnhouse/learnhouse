"""Portuguese nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Cancelar inscrição nestes e-mails",
    "nudge.common.footer": "Você recebeu este e-mail porque é administrador de {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Cursos",
    "nudge.stat.chapters": "Capítulos",
    "nudge.stat.lessons": "Aulas",
    "nudge.stat.members": "Membros",
    "nudge.stat.learners": "Alunos",
    "nudge.stat.completed": "Concluídos",

    "nudge.activation.first_course_d1.subject": "Seu primeiro curso na {org_name}",
    "nudge.activation.first_course_d1.heading": "Quando você quiser",
    "nudge.activation.first_course_d1.body": "A {org_name} está pronta e esperando o primeiro curso. A maioria começa pequeno: um tema, algumas aulas. Você pode ampliar depois.",
    "nudge.activation.first_course_d1.cta": "Criar seu primeiro curso",

    "nudge.activation.come_back_d2.subject": "Continuar de onde você parou",
    "nudge.activation.come_back_d2.heading": "Sua configuração continua esperando",
    "nudge.activation.come_back_d2.body": "Você criou a {org_name} e não voltou desde então. Está tudo lá, e colocar um primeiro curso no ar leva uns dez minutos.",
    "nudge.activation.come_back_d2.cta": "Ir para o painel",

    "nudge.activation.ai_course_help_d4.subject": "A página em branco é a parte difícil",
    "nudge.activation.ai_course_help_d4.heading": "Deixe a IA escrever o roteiro",
    "nudge.activation.ai_course_help_d4.body": "Se a {org_name} ainda está vazia porque você não sabe por onde começar, descreva o tema e a IA vai esboçar os capítulos e as aulas. A edição fica com você.",
    "nudge.activation.ai_course_help_d4.cta": "Criar um curso com IA",

    "nudge.activation.import_existing_d5.subject": "Traga o que você já tem",
    "nudge.activation.import_existing_d5.heading": "Não precisa começar do zero",
    "nudge.activation.import_existing_d5.body": "Se o seu material já existe como documentos, slides ou uma exportação de outra plataforma, dá para trazer tudo para a {org_name} em vez de digitar de novo.",
    "nudge.activation.import_existing_d5.cta": "Importar seu material",

    "nudge.activation.setup_checklist_d7.subject": "Quinze minutos para uma academia funcionando",
    "nudge.activation.setup_checklist_d7.heading": "Uma lista curta",
    "nudge.activation.setup_checklist_d7.body": "A {org_name} ainda espera o primeiro curso. A lista de configuração guia você em poucos passos — a maioria termina em uns quinze minutos.",
    "nudge.activation.setup_checklist_d7.cta": "Abrir a lista",

    "nudge.activation.whats_blocking_d14.subject": "O que atrapalhou?",
    "nudge.activation.whats_blocking_d14.heading": "Podemos perguntar o que travou?",
    "nudge.activation.whats_blocking_d14.body": "Você criou a {org_name} há duas semanas e ainda não adicionou um curso. Se algo ficou confuso ou faltou, gostaríamos de saber — é só responder a este e-mail, que chega direto para nós.",

    "nudge.activation.last_call_d30.subject": "Último e-mail sobre a {org_name}",
    "nudge.activation.last_call_d30.heading": "Este é o último",
    "nudge.activation.last_call_d30.body": "A {org_name} ficou parada por um mês, então vamos parar com estes e-mails. Sua conta e tudo o que está nela continuam ali — se você voltar, vai encontrar tudo como deixou.",
    "nudge.activation.last_call_d30.cta": "Abrir seu painel",

    "nudge.content.course_no_chapter_d1.subject": "{course_name} precisa do primeiro capítulo",
    "nudge.content.course_no_chapter_d1.heading": "Falta um capítulo",
    "nudge.content.course_no_chapter_d1.body": "{course_name} existe mas ainda não tem capítulos, então não há nada para abrir. Capítulos são só seções — um por tema funciona bem.",
    "nudge.content.course_no_chapter_d1.cta": "Adicionar um capítulo",

    "nudge.content.chapter_no_activity_d1.subject": "Adicione a primeira aula a {course_name}",
    "nudge.content.chapter_no_activity_d1.heading": "Os capítulos estão prontos",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} tem capítulos, mas ainda estão vazios. Uma aula pode ser uma página de texto, um vídeo, um quiz — o que combinar com o tema.",
    "nudge.content.chapter_no_activity_d1.cta": "Adicionar uma aula",

    "nudge.content.activity_unpublished_d2.subject": "Suas aulas em {course_name} ainda não aparecem",
    "nudge.content.activity_unpublished_d2.heading": "As aulas continuam escondidas",
    "nudge.content.activity_unpublished_d2.body": "Você escreveu aulas em {course_name}, mas nenhuma está publicada, então quem entra vê um curso vazio. Publicar não trava nada — dá para continuar editando.",
    "nudge.content.activity_unpublished_d2.cta": "Publicar suas aulas",

    "nudge.content.course_draft_d3.subject": "{course_name} ainda é um rascunho",
    "nudge.content.course_draft_d3.heading": "{course_name} está quase lá",
    "nudge.content.course_draft_d3.body": "Você adicionou aulas a {course_name}, mas ele não está publicado, então ninguém consegue abrir. Não precisa estar pronto — publicar só o torna visível, e você pode continuar editando.",
    "nudge.content.course_draft_d3.cta": "Publicar",

    "nudge.content.course_draft_d10.subject": "{course_name} está como rascunho há um tempo",
    "nudge.content.course_draft_d10.heading": "Provavelmente já está pronto",
    "nudge.content.course_draft_d10.body": "{course_name} está sem publicar há mais de uma semana. Curso raramente parece terminado — publicar deixa visível, e você pode seguir melhorando com gente já lendo.",
    "nudge.content.course_draft_d10.cta": "Publicar",

    "nudge.content.thin_course_d5.subject": "{course_name} pede um pouco mais",
    "nudge.content.thin_course_d5.heading": "Uma ou duas aulas",
    "nudge.content.thin_course_d5.body": "{course_name} tem uma ou duas aulas até agora. Cursos costumam funcionar melhor com algumas a mais, e a IA pode esboçar as próximas a partir do que já existe.",
    "nudge.content.thin_course_d5.cta": "Adicionar mais aulas",

    "nudge.content.assignment_no_submissions_d5.subject": "Ainda sem entregas na {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Ninguém entregou nada",
    "nudge.content.assignment_no_submissions_d5.body": "Você criou uma atividade avaliativa na {org_name} mas nada foi entregue. Vale conferir se ela está publicada e se os alunos conseguem chegar ao curso a que ela pertence.",
    "nudge.content.assignment_no_submissions_d5.cta": "Conferir suas atividades",

    "nudge.audience.published_no_members_d1.subject": "{course_name} está no ar, mas ainda sem ninguém",
    "nudge.audience.published_no_members_d1.heading": "Hora de convidar alguém",
    "nudge.audience.published_no_members_d1.body": "{course_name} está publicado e pronto para leitura. A {org_name} ainda não tem alunos, então o próximo passo é convidar as pessoas para quem você escreveu.",
    "nudge.audience.published_no_members_d1.cta": "Convidar alunos",

    "nudge.audience.published_no_members_d7.subject": "{course_name} continua sem alunos",
    "nudge.audience.published_no_members_d7.heading": "Uma semana no ar e ninguém lendo",
    "nudge.audience.published_no_members_d7.body": "{course_name} está publicado há uma semana e a {org_name} continua sem alunos. Dá para convidar um a um, colar uma lista ou simplesmente compartilhar o link de entrada.",
    "nudge.audience.published_no_members_d7.cta": "Convidar pessoas",

    "nudge.audience.members_no_enrollment_d3.subject": "Seus alunos ainda não começaram",
    "nudge.audience.members_no_enrollment_d3.heading": "Entraram mas não abriram nada",
    "nudge.audience.members_no_enrollment_d3.body": "Pessoas entraram na {org_name} mas ninguém começou um curso. Uma mensagem curta com link direto costuma resolver — a maioria só não achou o caminho.",
    "nudge.audience.members_no_enrollment_d3.cta": "Ver seus membros",

    "nudge.audience.share_public_page_d14.subject": "Sua página de curso é pública — aqui está o link",
    "nudge.audience.share_public_page_d14.heading": "Qualquer pessoa com o link consegue ler",
    "nudge.audience.share_public_page_d14.body": "{course_name} é público, então você pode divulgar em qualquer lugar sem que ninguém precise de convite. O link abaixo é o que deve ser enviado.",
    "nudge.audience.share_public_page_d14.cta": "Ver a página pública",

    "nudge.audience.stalled_learners_d14.subject": "Alguns alunos pararam no meio",
    "nudge.audience.stalled_learners_d14.heading": "Algumas pessoas travaram",
    "nudge.audience.stalled_learners_d14.body": "Alguns alunos da {org_name} começaram um curso e não voltam há duas semanas. Costuma valer uma mensagem sua, ou uma olhada em onde eles pararam.",
    "nudge.audience.stalled_learners_d14.cta": "Ver seus alunos",

    "nudge.monetization.course_limit_d1.subject": "Você usou todos os cursos do plano {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Você atingiu o limite de cursos",
    "nudge.monetization.course_limit_d1.body": "A {org_name} está no plano {plan_name} e usou todos os cursos incluídos. Mudar para {next_plan} remove esse limite, se você quiser continuar criando.",
    "nudge.monetization.course_limit_d1.cta": "Ver planos",

    "nudge.monetization.member_limit_near.subject": "Você está perto do limite de membros do plano {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Quase no limite de membros",
    "nudge.monetization.member_limit_near.body": "A {org_name} está chegando ao número de membros que o plano {plan_name} permite. Mudar para {next_plan} aumenta esse número, para ninguém ficar de fora no meio do cadastro.",
    "nudge.monetization.member_limit_near.cta": "Ver planos",

    "nudge.monetization.ai_credits_low.subject": "Seus créditos de IA estão quase no fim",
    "nudge.monetization.ai_credits_low.heading": "Poucos créditos de IA restantes",
    "nudge.monetization.ai_credits_low.body": "A {org_name} usou a maior parte dos créditos de IA incluídos no plano {plan_name}. O plano {next_plan} vem com mais, se a IA virou parte de como você monta cursos.",
    "nudge.monetization.ai_credits_low.cta": "Ver planos",

    "nudge.monetization.upgrade_recap_d21.subject": "O que o {next_plan} traria para a {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Você construiu algo de verdade",
    "nudge.monetization.upgrade_recap_d21.body": "A {org_name} tem cursos publicados e gente lendo. O plano {next_plan} dá espaço para crescer e inclui coisas que o plano {plan_name} não tem — vale olhar se você pretende expandir.",
    "nudge.monetization.upgrade_recap_d21.cta": "Comparar planos",

    "nudge.dormancy.no_login_14d.subject": "A {org_name} andou quieta",
    "nudge.dormancy.no_login_14d.heading": "Já faz duas semanas",
    "nudge.dormancy.no_login_14d.body": "Nada mudou na {org_name} desde a sua última visita. Se você estava no meio de alguma coisa, está exatamente onde você deixou.",
    "nudge.dormancy.no_login_14d.cta": "Abrir seu painel",

    "nudge.dormancy.no_login_30d.subject": "Seus cursos na {org_name} continuam aqui",
    "nudge.dormancy.no_login_30d.heading": "Já faz algumas semanas",
    "nudge.dormancy.no_login_30d.body": "Nada mudou enquanto você esteve fora — a {org_name} e tudo nela está exatamente onde você deixou. Retomar é um clique.",
    "nudge.dormancy.no_login_30d.cta": "Abrir seu painel",

    "nudge.dormancy.no_login_60d.subject": "Última mensagem sobre a {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Vamos deixar você em paz",
    "nudge.dormancy.no_login_60d.body": "A {org_name} está parada há uns dois meses, então este é o último destes e-mails por ora. Tudo o que você construiu fica exatamente como está, para quando quiser.",
    "nudge.dormancy.no_login_60d.cta": "Abrir seu painel",

    "nudge.dormancy.winback_q.subject": "O que mudou desde a sua última visita à {org_name}",
    "nudge.dormancy.winback_q.heading": "Algumas coisas mudaram",
    "nudge.dormancy.winback_q.body": "Faz um tempo que você não passa pela {org_name}. O produto avançou bastante desde então, e tudo o que você construiu continua lá.",
    "nudge.dormancy.winback_q.cta": "Dar uma olhada",

    "nudge.milestone.first_course_published.subject": "{course_name} está no ar",
    "nudge.milestone.first_course_published.heading": "Você publicou seu primeiro curso",
    "nudge.milestone.first_course_published.body": "{course_name} está no ar e pode ser lido. O que faz diferença agora é ter alguém lendo — mesmo que sejam uma ou duas pessoas para começar.",
    "nudge.milestone.first_course_published.cta": "Convidar seus primeiros alunos",

    "nudge.milestone.first_learner_enrolled.subject": "Alguém começou {course_name}",
    "nudge.milestone.first_learner_enrolled.heading": "Seu primeiro aluno chegou",
    "nudge.milestone.first_learner_enrolled.body": "Pela primeira vez alguém começou um curso na {org_name}. Você pode acompanhar o progresso pelo painel.",
    "nudge.milestone.first_learner_enrolled.cta": "Ver o progresso",

    "nudge.milestone.first_completion.subject": "Alguém concluiu um curso na {org_name}",
    "nudge.milestone.first_completion.heading": "Primeira conclusão",
    "nudge.milestone.first_completion.body": "Um aluno concluiu um curso da {org_name} do início ao fim. Se quiser registrar isso, dá para adicionar um certificado — ou começar a montar o próximo.",
    "nudge.milestone.first_completion.cta": "Abrir seu painel",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Sua academia na {org_name} continua aqui",
    "nudge.reactivation.opener.heading": "Continua aqui, do jeito que você deixou",
    "nudge.reactivation.opener.body": "Ninguém mexeu na {org_name} desde a sua última visita — cada curso, capítulo e aula está onde você deixou. Retomar é um clique.",
    "nudge.reactivation.opener.cta": "Abrir seu painel",
    "nudge.reactivation.whats_changed.subject": "Algumas coisas mudaram no LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Desde a sua última visita",
    "nudge.reactivation.whats_changed.body": "O produto avançou bastante enquanto a {org_name} esteve parada: o editor, as ferramentas de curso e o percurso dos alunos foram bem trabalhados. Tudo o que você construiu continua funcionando como antes.",
    "nudge.reactivation.whats_changed.cta": "Ver as novidades",
    "nudge.reactivation.need_a_hand.subject": "Precisa de ajuda para voltar à {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "Teve algo atrapalhando?",
    "nudge.reactivation.need_a_hand.body": "Se houve um motivo para a {org_name} parar — algo confuso, algo faltando ou simplesmente falta de tempo — a gente gostaria muito de saber. Responda a este e-mail, que chega direto para nós.",
    "nudge.reactivation.closing.subject": "Última mensagem sobre a {org_name}",
    "nudge.reactivation.closing.heading": "Paramos por aqui",
    "nudge.reactivation.closing.body": "Este é o último destes e-mails. A {org_name} fica exatamente como está e nada expira — se um dia quiser voltar, tudo estará esperando.",
    "nudge.reactivation.closing.cta": "Abrir seu painel",
}
