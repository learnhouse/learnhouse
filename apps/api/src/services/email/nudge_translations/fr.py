"""French nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Se désabonner de ces e-mails",
    "nudge.common.footer": "Vous recevez cet e-mail car vous êtes administrateur de {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Cours",
    "nudge.stat.chapters": "Chapitres",
    "nudge.stat.lessons": "Leçons",
    "nudge.stat.members": "Membres",
    "nudge.stat.learners": "Apprenants",
    "nudge.stat.completed": "Terminés",

    "nudge.activation.first_course_d1.subject": "Votre premier cours sur {org_name}",
    "nudge.activation.first_course_d1.heading": "Quand vous voulez",
    "nudge.activation.first_course_d1.body": "{org_name} est prêt et attend son premier cours. La plupart des gens commencent petit : un sujet, quelques leçons. Vous pourrez toujours compléter plus tard.",
    "nudge.activation.first_course_d1.cta": "Créer votre premier cours",

    "nudge.activation.come_back_d2.subject": "Reprendre là où vous en étiez",
    "nudge.activation.come_back_d2.heading": "Votre espace vous attend",
    "nudge.activation.come_back_d2.body": "Vous avez créé {org_name} et n'y êtes pas revenu depuis. Tout est resté en place, et mettre un premier cours en ligne prend une dizaine de minutes.",
    "nudge.activation.come_back_d2.cta": "Aller au tableau de bord",

    "nudge.activation.ai_course_help_d4.subject": "La page blanche, c'est le plus dur",
    "nudge.activation.ai_course_help_d4.heading": "Laissez l'IA écrire le plan",
    "nudge.activation.ai_course_help_d4.body": "Si {org_name} est encore vide parce que vous ne savez pas par où commencer, décrivez votre sujet et l'IA rédigera les chapitres et les leçons. Vous reprenez ensuite la main.",
    "nudge.activation.ai_course_help_d4.cta": "Créer un cours avec l'IA",

    "nudge.activation.import_existing_d5.subject": "Apportez ce que vous avez déjà",
    "nudge.activation.import_existing_d5.heading": "Pas besoin de repartir de zéro",
    "nudge.activation.import_existing_d5.body": "Si vos contenus existent déjà sous forme de documents, de diapositives ou d'un export d'une autre plateforme, vous pouvez les importer dans {org_name} plutôt que de tout ressaisir.",
    "nudge.activation.import_existing_d5.cta": "Importer vos contenus",

    "nudge.activation.setup_checklist_d7.subject": "Quinze minutes pour une académie fonctionnelle",
    "nudge.activation.setup_checklist_d7.heading": "Une courte liste d'étapes",
    "nudge.activation.setup_checklist_d7.body": "{org_name} attend toujours son premier cours. La liste de configuration vous guide en quelques étapes — la plupart des gens terminent en un quart d'heure.",
    "nudge.activation.setup_checklist_d7.cta": "Ouvrir la liste",

    "nudge.activation.whats_blocking_d14.subject": "Qu'est-ce qui vous a bloqué ?",
    "nudge.activation.whats_blocking_d14.heading": "Pouvons-nous vous demander ce qui vous a arrêté ?",
    "nudge.activation.whats_blocking_d14.body": "Vous avez créé {org_name} il y a deux semaines et n'avez pas encore ajouté de cours. Si quelque chose n'était pas clair ou manquait, nous aimerions le savoir — répondez simplement à cet e-mail, il nous parvient directement.",

    "nudge.activation.last_call_d30.subject": "Dernier e-mail au sujet de {org_name}",
    "nudge.activation.last_call_d30.heading": "C'est le dernier",
    "nudge.activation.last_call_d30.body": "{org_name} est resté silencieux pendant un mois, nous arrêtons donc ces e-mails. Votre compte et tout ce qu'il contient restent en place — si vous revenez, vous retrouverez tout tel quel.",
    "nudge.activation.last_call_d30.cta": "Ouvrir votre tableau de bord",

    "nudge.content.course_no_chapter_d1.subject": "{course_name} attend son premier chapitre",
    "nudge.content.course_no_chapter_d1.heading": "Plus qu'un chapitre",
    "nudge.content.course_no_chapter_d1.body": "{course_name} existe mais n'a pas encore de chapitre, il n'y a donc rien à ouvrir. Les chapitres ne sont que des sections — un par thème fonctionne bien.",
    "nudge.content.course_no_chapter_d1.cta": "Ajouter un chapitre",

    "nudge.content.chapter_no_activity_d1.subject": "Ajoutez votre première leçon à {course_name}",
    "nudge.content.chapter_no_activity_d1.heading": "Les chapitres sont prêts",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} a des chapitres, mais ils sont encore vides. Une leçon peut être une page de texte, une vidéo, un quiz — ce qui convient au sujet.",
    "nudge.content.chapter_no_activity_d1.cta": "Ajouter une leçon",

    "nudge.content.activity_unpublished_d2.subject": "Vos leçons dans {course_name} ne sont pas encore visibles",
    "nudge.content.activity_unpublished_d2.heading": "Les leçons sont encore masquées",
    "nudge.content.activity_unpublished_d2.body": "Vous avez rédigé des leçons dans {course_name}, mais aucune n'est publiée : les apprenants voient un cours vide. Publier ne fige rien — vous pourrez continuer à modifier.",
    "nudge.content.activity_unpublished_d2.cta": "Publier vos leçons",

    "nudge.content.course_draft_d3.subject": "{course_name} est encore un brouillon",
    "nudge.content.course_draft_d3.heading": "{course_name} y est presque",
    "nudge.content.course_draft_d3.body": "Vous avez ajouté des leçons à {course_name}, mais il n'est pas publié : personne ne peut l'ouvrir. Il n'a pas besoin d'être terminé — publier le rend simplement visible, et vous pourrez continuer à le modifier.",
    "nudge.content.course_draft_d3.cta": "Le publier",

    "nudge.content.course_draft_d10.subject": "{course_name} est un brouillon depuis un moment",
    "nudge.content.course_draft_d10.heading": "Il est sans doute prêt",
    "nudge.content.course_draft_d10.body": "{course_name} n'est pas publié depuis plus d'une semaine. Un cours semble rarement terminé — le publier le rend visible, et vous pouvez continuer à l'améliorer pendant que des gens le lisent.",
    "nudge.content.course_draft_d10.cta": "Le publier",

    "nudge.content.thin_course_d5.subject": "{course_name} mériterait un peu plus",
    "nudge.content.thin_course_d5.heading": "Une ou deux leçons",
    "nudge.content.thin_course_d5.body": "{course_name} compte pour l'instant une ou deux leçons. Les cours fonctionnent mieux avec quelques-unes de plus, et l'IA peut rédiger les suivantes à partir de l'existant.",
    "nudge.content.thin_course_d5.cta": "Ajouter des leçons",

    "nudge.content.assignment_no_submissions_d5.subject": "Aucun rendu pour l'instant dans {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Personne n'a rien rendu",
    "nudge.content.assignment_no_submissions_d5.body": "Vous avez créé un devoir dans {org_name} mais rien n'a été rendu. Vérifiez qu'il est bien publié et que vos apprenants ont accès au cours auquel il appartient.",
    "nudge.content.assignment_no_submissions_d5.cta": "Vérifier vos devoirs",

    "nudge.audience.published_no_members_d1.subject": "{course_name} est en ligne, mais personne n'est là",
    "nudge.audience.published_no_members_d1.heading": "Il est temps d'inviter quelqu'un",
    "nudge.audience.published_no_members_d1.body": "{course_name} est publié et prêt à être lu. {org_name} n'a encore aucun apprenant : l'étape suivante est d'inviter les personnes pour qui vous l'avez écrit.",
    "nudge.audience.published_no_members_d1.cta": "Inviter des apprenants",

    "nudge.audience.published_no_members_d7.subject": "{course_name} n'a toujours aucun apprenant",
    "nudge.audience.published_no_members_d7.heading": "Une semaine en ligne, personne pour le lire",
    "nudge.audience.published_no_members_d7.body": "{course_name} est publié depuis une semaine et {org_name} n'a toujours aucun apprenant. Vous pouvez inviter les gens un par un, coller une liste, ou simplement partager le lien d'inscription.",
    "nudge.audience.published_no_members_d7.cta": "Inviter des personnes",

    "nudge.audience.members_no_enrollment_d3.subject": "Vos apprenants n'ont pas encore commencé",
    "nudge.audience.members_no_enrollment_d3.heading": "Ils ont rejoint mais n'ont rien ouvert",
    "nudge.audience.members_no_enrollment_d3.body": "Des personnes ont rejoint {org_name} mais personne n'a commencé de cours. Un court message avec un lien direct suffit généralement — la plupart n'ont simplement pas trouvé l'entrée.",
    "nudge.audience.members_no_enrollment_d3.cta": "Voir vos membres",

    "nudge.audience.share_public_page_d14.subject": "Votre page de cours est publique — voici le lien",
    "nudge.audience.share_public_page_d14.heading": "Toute personne avec le lien peut lire",
    "nudge.audience.share_public_page_d14.body": "{course_name} est public : vous pouvez le partager partout sans que personne ait besoin d'une invitation. Le lien ci-dessous est celui à envoyer.",
    "nudge.audience.share_public_page_d14.cta": "Voir la page publique",

    "nudge.audience.stalled_learners_d14.subject": "Des apprenants se sont arrêtés en chemin",
    "nudge.audience.stalled_learners_d14.heading": "Quelques personnes sont bloquées",
    "nudge.audience.stalled_learners_d14.body": "Des apprenants de {org_name} ont commencé un cours et ne sont pas revenus depuis deux semaines. Un message de votre part aide souvent, tout comme regarder où ils se sont arrêtés.",
    "nudge.audience.stalled_learners_d14.cta": "Voir vos apprenants",

    "nudge.monetization.course_limit_d1.subject": "Vous avez utilisé tous les cours du forfait {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Vous avez atteint la limite de cours",
    "nudge.monetization.course_limit_d1.body": "{org_name} est sur le forfait {plan_name} et a utilisé tous les cours qu'il comprend. Passer à {next_plan} lève cette limite si vous voulez continuer.",
    "nudge.monetization.course_limit_d1.cta": "Voir les forfaits",

    "nudge.monetization.member_limit_near.subject": "Vous approchez la limite de membres du forfait {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Bientôt à la limite de membres",
    "nudge.monetization.member_limit_near.body": "{org_name} approche du nombre de membres autorisé par le forfait {plan_name}. Passer à {next_plan} l'augmente, pour que personne ne soit bloqué en pleine inscription.",
    "nudge.monetization.member_limit_near.cta": "Voir les forfaits",

    "nudge.monetization.ai_credits_low.subject": "Vos crédits IA sont presque épuisés",
    "nudge.monetization.ai_credits_low.heading": "Crédits IA bientôt épuisés",
    "nudge.monetization.ai_credits_low.body": "{org_name} a utilisé la majeure partie des crédits IA inclus dans le forfait {plan_name}. Le forfait {next_plan} en contient davantage, si l'IA fait désormais partie de votre façon de créer des cours.",
    "nudge.monetization.ai_credits_low.cta": "Voir les forfaits",

    "nudge.monetization.upgrade_recap_d21.subject": "Ce que {next_plan} apporterait à {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Vous avez construit quelque chose de solide",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} a des cours publiés et des personnes qui les lisent. Le forfait {next_plan} offre de la marge et quelques fonctionnalités absentes du forfait {plan_name} — à regarder si vous comptez grandir.",
    "nudge.monetization.upgrade_recap_d21.cta": "Comparer les forfaits",

    "nudge.dormancy.no_login_14d.subject": "{org_name} est resté silencieux",
    "nudge.dormancy.no_login_14d.heading": "Cela fait deux semaines",
    "nudge.dormancy.no_login_14d.body": "Rien n'a changé dans {org_name} depuis votre dernière visite. Si vous étiez en train de faire quelque chose, tout est resté exactement là où vous l'avez laissé.",
    "nudge.dormancy.no_login_14d.cta": "Ouvrir votre tableau de bord",

    "nudge.dormancy.no_login_30d.subject": "Vos cours sur {org_name} sont toujours là",
    "nudge.dormancy.no_login_30d.heading": "Cela fait quelques semaines",
    "nudge.dormancy.no_login_30d.body": "Rien n'a changé pendant votre absence — {org_name} et tout ce qu'il contient sont exactement là où vous les avez laissés. Reprendre ne prend qu'un clic.",
    "nudge.dormancy.no_login_30d.cta": "Ouvrir votre tableau de bord",

    "nudge.dormancy.no_login_60d.subject": "Dernier message au sujet de {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Nous vous laissons tranquille",
    "nudge.dormancy.no_login_60d.body": "{org_name} est silencieux depuis deux mois, c'est donc le dernier de ces e-mails pour l'instant. Tout ce que vous avez construit reste en l'état, pour le jour où vous en aurez besoin.",
    "nudge.dormancy.no_login_60d.cta": "Ouvrir votre tableau de bord",

    "nudge.dormancy.winback_q.subject": "Ce qui a changé depuis votre dernière visite sur {org_name}",
    "nudge.dormancy.winback_q.heading": "Quelques nouveautés",
    "nudge.dormancy.winback_q.body": "Cela fait un moment que vous n'êtes pas passé sur {org_name}. Le produit a pas mal évolué depuis, et tout ce que vous aviez construit est toujours là.",
    "nudge.dormancy.winback_q.cta": "Y jeter un œil",

    "nudge.milestone.first_course_published.subject": "{course_name} est en ligne",
    "nudge.milestone.first_course_published.heading": "Vous avez publié votre premier cours",
    "nudge.milestone.first_course_published.body": "{course_name} est en ligne et lisible. La suite qui change tout, c'est d'avoir quelqu'un pour le lire — même une ou deux personnes pour commencer.",
    "nudge.milestone.first_course_published.cta": "Inviter vos premiers apprenants",

    "nudge.milestone.first_learner_enrolled.subject": "Quelqu'un a commencé {course_name}",
    "nudge.milestone.first_learner_enrolled.heading": "Votre premier apprenant est là",
    "nudge.milestone.first_learner_enrolled.body": "Quelqu'un a commencé un cours dans {org_name} pour la première fois. Vous pouvez suivre sa progression depuis votre tableau de bord.",
    "nudge.milestone.first_learner_enrolled.cta": "Voir sa progression",

    "nudge.milestone.first_completion.subject": "Quelqu'un a terminé un cours dans {org_name}",
    "nudge.milestone.first_completion.heading": "Première réussite",
    "nudge.milestone.first_completion.body": "Un apprenant a terminé un cours de {org_name} du début à la fin. Pour le marquer comme il se doit, vous pouvez ajouter un certificat — ou commencer à préparer la suite.",
    "nudge.milestone.first_completion.cta": "Ouvrir votre tableau de bord",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Votre académie sur {org_name} est toujours là",
    "nudge.reactivation.opener.heading": "Toujours là, exactement comme vous l'avez laissée",
    "nudge.reactivation.opener.body": "Personne n'a touché à {org_name} depuis votre dernière visite : chaque cours, chapitre et leçon est resté en place. Pour reprendre, il suffit d'un clic.",
    "nudge.reactivation.opener.cta": "Ouvrir le tableau de bord",
    "nudge.reactivation.whats_changed.subject": "Quelques nouveautés sur LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Depuis votre dernier passage",
    "nudge.reactivation.whats_changed.body": "Le produit a bien avancé pendant que {org_name} était en pause : l'éditeur, les outils de cours et le parcours des apprenants ont tous été retravaillés. Tout ce que vous aviez créé fonctionne comme avant.",
    "nudge.reactivation.whats_changed.cta": "Voir les nouveautés",
    "nudge.reactivation.need_a_hand.subject": "Besoin d'aide pour revenir sur {org_name} ?",
    "nudge.reactivation.need_a_hand.heading": "Quelque chose vous a bloqué ?",
    "nudge.reactivation.need_a_hand.body": "S'il y avait une raison à l'arrêt de {org_name} — quelque chose de confus, de manquant, ou simplement le manque de temps — nous aimerions vraiment le savoir. Répondez à cet e-mail, il nous parvient directement.",
    "nudge.reactivation.closing.subject": "Dernier message au sujet de {org_name}",
    "nudge.reactivation.closing.heading": "Nous nous arrêtons là",
    "nudge.reactivation.closing.body": "C'est le dernier de ces e-mails. {org_name} reste exactement en l'état et rien n'expire : si vous souhaitez revenir un jour, tout vous attendra.",
    "nudge.reactivation.closing.cta": "Ouvrir le tableau de bord",
}
