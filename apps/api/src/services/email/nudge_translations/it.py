"""Italian nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Annulla l'iscrizione a queste email",
    "nudge.common.footer": "Ricevi questa email perché sei amministratore di {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Corsi",
    "nudge.stat.chapters": "Capitoli",
    "nudge.stat.lessons": "Lezioni",
    "nudge.stat.members": "Membri",
    "nudge.stat.learners": "Studenti",
    "nudge.stat.completed": "Completati",

    "nudge.activation.first_course_d1.subject": "Il tuo primo corso su {org_name}",
    "nudge.activation.first_course_d1.heading": "Quando vuoi",
    "nudge.activation.first_course_d1.body": "{org_name} è pronta e aspetta il suo primo corso. Quasi tutti iniziano in piccolo: un argomento, qualche lezione. Potrai ampliarlo in seguito.",
    "nudge.activation.first_course_d1.cta": "Crea il tuo primo corso",

    "nudge.activation.come_back_d2.subject": "Riprendere da dove eri rimasto",
    "nudge.activation.come_back_d2.heading": "La tua configurazione è ancora lì",
    "nudge.activation.come_back_d2.body": "Hai creato {org_name} e non sei più tornato. È tutto ancora al suo posto, e mettere online un primo corso richiede una decina di minuti.",
    "nudge.activation.come_back_d2.cta": "Vai alla dashboard",

    "nudge.activation.ai_course_help_d4.subject": "La pagina bianca è la parte difficile",
    "nudge.activation.ai_course_help_d4.heading": "Lascia che l'IA scriva la scaletta",
    "nudge.activation.ai_course_help_d4.body": "Se {org_name} è ancora vuota perché non sai da dove partire, descrivi l'argomento e l'IA preparerà capitoli e lezioni. Poi la modifica è tua.",
    "nudge.activation.ai_course_help_d4.cta": "Crea un corso con l'IA",

    "nudge.activation.import_existing_d5.subject": "Porta quello che hai già",
    "nudge.activation.import_existing_d5.heading": "Non devi ripartire da zero",
    "nudge.activation.import_existing_d5.body": "Se il tuo materiale esiste già come documenti, slide o esportazione da un'altra piattaforma, puoi portarlo in {org_name} invece di riscriverlo.",
    "nudge.activation.import_existing_d5.cta": "Importa il materiale",

    "nudge.activation.setup_checklist_d7.subject": "Quindici minuti per un'accademia funzionante",
    "nudge.activation.setup_checklist_d7.heading": "Una breve lista",
    "nudge.activation.setup_checklist_d7.body": "{org_name} aspetta ancora il primo corso. La lista di configurazione ti guida in pochi passaggi: quasi tutti finiscono in un quarto d'ora.",
    "nudge.activation.setup_checklist_d7.cta": "Apri la lista",

    "nudge.activation.whats_blocking_d14.subject": "Cosa si è messo di mezzo?",
    "nudge.activation.whats_blocking_d14.heading": "Possiamo chiederti cosa ti ha fermato?",
    "nudge.activation.whats_blocking_d14.body": "Hai creato {org_name} un paio di settimane fa e non hai ancora aggiunto un corso. Se qualcosa non era chiaro o mancava, ci farebbe piacere saperlo: rispondi a questa email, arriva direttamente a noi.",

    "nudge.activation.last_call_d30.subject": "Ultima email su {org_name}",
    "nudge.activation.last_call_d30.heading": "Questa è l'ultima",
    "nudge.activation.last_call_d30.body": "{org_name} è rimasta ferma per un mese, quindi smettiamo di inviare queste email. Il tuo account e tutto ciò che contiene restano lì: se torni, ritroverai ogni cosa.",
    "nudge.activation.last_call_d30.cta": "Apri la dashboard",

    "nudge.content.course_no_chapter_d1.subject": "{course_name} ha bisogno del primo capitolo",
    "nudge.content.course_no_chapter_d1.heading": "Manca un capitolo",
    "nudge.content.course_no_chapter_d1.body": "{course_name} esiste ma non ha ancora capitoli, quindi non c'è nulla da aprire. I capitoli sono semplici sezioni: uno per argomento funziona bene.",
    "nudge.content.course_no_chapter_d1.cta": "Aggiungi un capitolo",

    "nudge.content.chapter_no_activity_d1.subject": "Aggiungi la prima lezione a {course_name}",
    "nudge.content.chapter_no_activity_d1.heading": "I capitoli sono pronti",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} ha capitoli, ma sono ancora vuoti. Una lezione può essere una pagina di testo, un video, un quiz: quello che si adatta all'argomento.",
    "nudge.content.chapter_no_activity_d1.cta": "Aggiungi una lezione",

    "nudge.content.activity_unpublished_d2.subject": "Le tue lezioni in {course_name} non si vedono ancora",
    "nudge.content.activity_unpublished_d2.heading": "Le lezioni sono ancora nascoste",
    "nudge.content.activity_unpublished_d2.body": "Hai scritto lezioni in {course_name}, ma nessuna è pubblicata: chi entra vede un corso vuoto. Pubblicare non blocca nulla, puoi continuare a modificare.",
    "nudge.content.activity_unpublished_d2.cta": "Pubblica le lezioni",

    "nudge.content.course_draft_d3.subject": "{course_name} è ancora una bozza",
    "nudge.content.course_draft_d3.heading": "{course_name} ci siamo quasi",
    "nudge.content.course_draft_d3.body": "Hai aggiunto lezioni a {course_name}, ma non è pubblicato, quindi nessuno può aprirlo. Non deve essere finito: pubblicare lo rende solo visibile, e puoi continuare a modificarlo.",
    "nudge.content.course_draft_d3.cta": "Pubblicalo",

    "nudge.content.course_draft_d10.subject": "{course_name} è in bozza da un po'",
    "nudge.content.course_draft_d10.heading": "Probabilmente è pronto",
    "nudge.content.course_draft_d10.body": "{course_name} è non pubblicato da oltre una settimana. Un corso raramente sembra finito: pubblicarlo lo rende visibile, e puoi continuare a migliorarlo mentre qualcuno già legge.",
    "nudge.content.course_draft_d10.cta": "Pubblicalo",

    "nudge.content.thin_course_d5.subject": "{course_name} meriterebbe qualcosa in più",
    "nudge.content.thin_course_d5.heading": "Una o due lezioni",
    "nudge.content.thin_course_d5.body": "{course_name} ha una o due lezioni finora. I corsi funzionano meglio con qualcuna in più, e l'IA può preparare le prossime partendo da ciò che c'è già.",
    "nudge.content.thin_course_d5.cta": "Aggiungi altre lezioni",

    "nudge.content.assignment_no_submissions_d5.subject": "Ancora nessuna consegna in {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Nessuno ha consegnato nulla",
    "nudge.content.assignment_no_submissions_d5.body": "Hai creato un compito in {org_name} ma non è stato consegnato niente. Vale la pena controllare che sia pubblicato e che gli studenti riescano a raggiungere il corso a cui appartiene.",
    "nudge.content.assignment_no_submissions_d5.cta": "Controlla i compiti",

    "nudge.audience.published_no_members_d1.subject": "{course_name} è online, ma non c'è nessuno",
    "nudge.audience.published_no_members_d1.heading": "È il momento di invitare qualcuno",
    "nudge.audience.published_no_members_d1.body": "{course_name} è pubblicato e pronto da leggere. {org_name} non ha ancora studenti, quindi il passo successivo è invitare le persone per cui l'hai scritto.",
    "nudge.audience.published_no_members_d1.cta": "Invita studenti",

    "nudge.audience.published_no_members_d7.subject": "{course_name} non ha ancora studenti",
    "nudge.audience.published_no_members_d7.heading": "Una settimana online, nessun lettore",
    "nudge.audience.published_no_members_d7.body": "{course_name} è pubblicato da una settimana e {org_name} non ha ancora studenti. Puoi invitare uno per uno, incollare un elenco o semplicemente condividere il link di accesso.",
    "nudge.audience.published_no_members_d7.cta": "Invita persone",

    "nudge.audience.members_no_enrollment_d3.subject": "I tuoi studenti non hanno ancora iniziato",
    "nudge.audience.members_no_enrollment_d3.heading": "Si sono iscritti ma non hanno aperto nulla",
    "nudge.audience.members_no_enrollment_d3.body": "Alcune persone si sono unite a {org_name} ma nessuno ha iniziato un corso. Di solito basta un messaggio breve con un link diretto: molti semplicemente non hanno trovato l'ingresso.",
    "nudge.audience.members_no_enrollment_d3.cta": "Vedi i membri",

    "nudge.audience.share_public_page_d14.subject": "La pagina del corso è pubblica: ecco il link",
    "nudge.audience.share_public_page_d14.heading": "Chiunque abbia il link può leggere",
    "nudge.audience.share_public_page_d14.body": "{course_name} è pubblico, quindi puoi condividerlo ovunque senza che serva un invito. Il link qui sotto è quello da mandare.",
    "nudge.audience.share_public_page_d14.cta": "Vedi la pagina pubblica",

    "nudge.audience.stalled_learners_d14.subject": "Alcuni studenti si sono fermati a metà",
    "nudge.audience.stalled_learners_d14.heading": "Qualcuno si è bloccato",
    "nudge.audience.stalled_learners_d14.body": "Alcuni studenti di {org_name} hanno iniziato un corso e non tornano da un paio di settimane. Spesso serve un tuo messaggio, o un'occhiata a dove si sono fermati.",
    "nudge.audience.stalled_learners_d14.cta": "Controlla gli studenti",

    "nudge.monetization.course_limit_d1.subject": "Hai usato tutti i corsi del piano {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Hai raggiunto il limite di corsi",
    "nudge.monetization.course_limit_d1.body": "{org_name} è sul piano {plan_name} e ha usato tutti i corsi inclusi. Passare a {next_plan} elimina quel limite, se vuoi continuare a creare.",
    "nudge.monetization.course_limit_d1.cta": "Vedi i piani",

    "nudge.monetization.member_limit_near.subject": "Sei vicino al limite di membri del piano {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Quasi al limite di membri",
    "nudge.monetization.member_limit_near.body": "{org_name} si sta avvicinando al numero di membri consentito dal piano {plan_name}. Passare a {next_plan} lo alza, così nessuno resta fuori a metà iscrizione.",
    "nudge.monetization.member_limit_near.cta": "Vedi i piani",

    "nudge.monetization.ai_credits_low.subject": "I tuoi crediti IA stanno finendo",
    "nudge.monetization.ai_credits_low.heading": "Pochi crediti IA rimasti",
    "nudge.monetization.ai_credits_low.body": "{org_name} ha usato quasi tutti i crediti IA inclusi nel piano {plan_name}. Il piano {next_plan} ne offre di più, se l'IA è ormai parte di come costruisci i corsi.",
    "nudge.monetization.ai_credits_low.cta": "Vedi i piani",

    "nudge.monetization.upgrade_recap_d21.subject": "Cosa aggiungerebbe {next_plan} a {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Hai costruito qualcosa di concreto",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} ha corsi pubblicati e persone che li leggono. Il piano {next_plan} dà spazio per crescere e include cose assenti dal piano {plan_name}: vale un'occhiata se pensi di ampliare.",
    "nudge.monetization.upgrade_recap_d21.cta": "Confronta i piani",

    "nudge.dormancy.no_login_14d.subject": "{org_name} è rimasta ferma",
    "nudge.dormancy.no_login_14d.heading": "Sono passate un paio di settimane",
    "nudge.dormancy.no_login_14d.body": "In {org_name} non è cambiato nulla dalla tua ultima visita. Se eri nel mezzo di qualcosa, è esattamente dove l'hai lasciato.",
    "nudge.dormancy.no_login_14d.cta": "Apri la dashboard",

    "nudge.dormancy.no_login_30d.subject": "I tuoi corsi su {org_name} sono ancora qui",
    "nudge.dormancy.no_login_30d.heading": "Sono passate alcune settimane",
    "nudge.dormancy.no_login_30d.body": "Non è cambiato nulla mentre eri via: {org_name} e tutto ciò che contiene è esattamente dove l'hai lasciato. Riprendere è questione di un clic.",
    "nudge.dormancy.no_login_30d.cta": "Apri la dashboard",

    "nudge.dormancy.no_login_60d.subject": "Ultimo messaggio su {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Ti lasciamo in pace",
    "nudge.dormancy.no_login_60d.body": "{org_name} è ferma da un paio di mesi, quindi questa è l'ultima di queste email per ora. Tutto ciò che hai costruito resta com'è, per quando ti servirà.",
    "nudge.dormancy.no_login_60d.cta": "Apri la dashboard",

    "nudge.dormancy.winback_q.subject": "Cosa è cambiato dalla tua ultima visita a {org_name}",
    "nudge.dormancy.winback_q.heading": "Qualcosa è cambiato",
    "nudge.dormancy.winback_q.body": "È passato un po' da quando sei stato in {org_name}. Il prodotto è andato avanti parecchio da allora, e tutto quello che avevi costruito è ancora lì.",
    "nudge.dormancy.winback_q.cta": "Dai un'occhiata",

    "nudge.milestone.first_course_published.subject": "{course_name} è online",
    "nudge.milestone.first_course_published.heading": "Hai pubblicato il tuo primo corso",
    "nudge.milestone.first_course_published.body": "{course_name} è online e leggibile. La cosa che fa davvero la differenza adesso è avere qualcuno che lo legga, anche solo una o due persone per iniziare.",
    "nudge.milestone.first_course_published.cta": "Invita i primi studenti",

    "nudge.milestone.first_learner_enrolled.subject": "Qualcuno ha iniziato {course_name}",
    "nudge.milestone.first_learner_enrolled.heading": "Il tuo primo studente è arrivato",
    "nudge.milestone.first_learner_enrolled.body": "Per la prima volta qualcuno ha iniziato un corso in {org_name}. Puoi seguire i suoi progressi dalla dashboard.",
    "nudge.milestone.first_learner_enrolled.cta": "Vedi i progressi",

    "nudge.milestone.first_completion.subject": "Qualcuno ha completato un corso in {org_name}",
    "nudge.milestone.first_completion.heading": "Primo completamento",
    "nudge.milestone.first_completion.body": "Uno studente ha completato un corso di {org_name} dall'inizio alla fine. Se vuoi darne atto puoi aggiungere un certificato, oppure iniziare a preparare il prossimo.",
    "nudge.milestone.first_completion.cta": "Apri la dashboard",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "La tua accademia su {org_name} è ancora qui",
    "nudge.reactivation.opener.heading": "Ancora qui, esattamente come l'hai lasciata",
    "nudge.reactivation.opener.body": "Nessuno ha toccato {org_name} dalla tua ultima visita: ogni corso, capitolo e lezione è dove l'hai lasciato. Riprendere è questione di un clic.",
    "nudge.reactivation.opener.cta": "Apri la dashboard",
    "nudge.reactivation.whats_changed.subject": "Qualcosa è cambiato su LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Dalla tua ultima visita",
    "nudge.reactivation.whats_changed.body": "Il prodotto è andato avanti parecchio mentre {org_name} era ferma: editor, strumenti dei corsi e percorso degli studenti sono stati rivisti a fondo. Tutto ciò che avevi creato funziona come prima.",
    "nudge.reactivation.whats_changed.cta": "Vedi le novità",
    "nudge.reactivation.need_a_hand.subject": "Ti serve una mano per tornare su {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "C'era qualcosa di mezzo?",
    "nudge.reactivation.need_a_hand.body": "Se c'è stato un motivo per cui {org_name} si è fermata — qualcosa di poco chiaro, qualcosa che mancava, o semplicemente il tempo — ci farebbe piacere saperlo. Rispondi a questa email, arriva direttamente a noi.",
    "nudge.reactivation.closing.subject": "Ultimo messaggio su {org_name}",
    "nudge.reactivation.closing.heading": "Ci fermiamo qui",
    "nudge.reactivation.closing.body": "Questa è l'ultima di queste email. {org_name} resta esattamente com'è e nulla scade: se un giorno vorrai tornare, troverai tutto ad aspettarti.",
    "nudge.reactivation.closing.cta": "Apri la dashboard",
}
