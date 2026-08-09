"""Dutch nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Afmelden voor deze e-mails",
    "nudge.common.footer": "Je ontvangt deze e-mail omdat je beheerder bent van {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Cursussen",
    "nudge.stat.chapters": "Hoofdstukken",
    "nudge.stat.lessons": "Lessen",
    "nudge.stat.members": "Leden",
    "nudge.stat.learners": "Deelnemers",
    "nudge.stat.completed": "Afgerond",

    "nudge.activation.first_course_d1.subject": "Je eerste cursus op {org_name}",
    "nudge.activation.first_course_d1.heading": "Wanneer het jou uitkomt",
    "nudge.activation.first_course_d1.body": "{org_name} staat klaar en wacht op de eerste cursus. De meeste mensen beginnen klein: één onderwerp, een paar lessen. Uitbreiden kan altijd nog.",
    "nudge.activation.first_course_d1.cta": "Maak je eerste cursus",

    "nudge.activation.come_back_d2.subject": "Verder waar je gebleven was",
    "nudge.activation.come_back_d2.heading": "Je opzet staat nog klaar",
    "nudge.activation.come_back_d2.body": "Je hebt {org_name} opgezet en bent sindsdien niet meer geweest. Alles staat er nog, en een eerste cursus online zetten kost ongeveer tien minuten.",
    "nudge.activation.come_back_d2.cta": "Naar je dashboard",

    "nudge.activation.ai_course_help_d4.subject": "Het lege blad is het lastigste",
    "nudge.activation.ai_course_help_d4.heading": "Laat AI de opzet schrijven",
    "nudge.activation.ai_course_help_d4.body": "Als {org_name} nog leeg is omdat je niet weet waar te beginnen: beschrijf je onderwerp en AI schrijft de hoofdstukken en lessen alvast. Daarna pas jij het aan.",
    "nudge.activation.ai_course_help_d4.cta": "Cursus opzetten met AI",

    "nudge.activation.import_existing_d5.subject": "Neem mee wat je al hebt",
    "nudge.activation.import_existing_d5.heading": "Je hoeft niet opnieuw te beginnen",
    "nudge.activation.import_existing_d5.body": "Als je materiaal al bestaat als documenten, dia's of een export uit een ander platform, kun je het naar {org_name} halen in plaats van alles over te typen.",
    "nudge.activation.import_existing_d5.cta": "Materiaal importeren",

    "nudge.activation.setup_checklist_d7.subject": "Een kwartier tot een werkende academie",
    "nudge.activation.setup_checklist_d7.heading": "Een korte checklist",
    "nudge.activation.setup_checklist_d7.body": "{org_name} wacht nog op de eerste cursus. De checklist loopt het in een paar korte stappen met je door — de meesten zijn binnen een kwartier klaar.",
    "nudge.activation.setup_checklist_d7.cta": "Checklist openen",

    "nudge.activation.whats_blocking_d14.subject": "Wat kwam ertussen?",
    "nudge.activation.whats_blocking_d14.heading": "Mogen we vragen wat je tegenhield?",
    "nudge.activation.whats_blocking_d14.body": "Je hebt {org_name} een paar weken geleden opgezet en nog geen cursus toegevoegd. Als iets onduidelijk was of ontbrak, horen we dat graag — beantwoord deze e-mail, hij komt rechtstreeks bij ons binnen.",

    "nudge.activation.last_call_d30.subject": "Laatste e-mail over {org_name}",
    "nudge.activation.last_call_d30.heading": "Dit is de laatste",
    "nudge.activation.last_call_d30.body": "{org_name} is een maand stil geweest, dus we stoppen met deze e-mails. Je account en alles erin blijft staan — kom je terug, dan vind je het precies zoals je het achterliet.",
    "nudge.activation.last_call_d30.cta": "Dashboard openen",

    "nudge.content.course_no_chapter_d1.subject": "{course_name} heeft een eerste hoofdstuk nodig",
    "nudge.content.course_no_chapter_d1.heading": "Nog één hoofdstuk",
    "nudge.content.course_no_chapter_d1.body": "{course_name} bestaat maar heeft nog geen hoofdstukken, dus er valt niets te openen. Hoofdstukken zijn gewoon secties — één per onderwerp werkt prima.",
    "nudge.content.course_no_chapter_d1.cta": "Hoofdstuk toevoegen",

    "nudge.content.chapter_no_activity_d1.subject": "Voeg je eerste les toe aan {course_name}",
    "nudge.content.chapter_no_activity_d1.heading": "De hoofdstukken staan klaar",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} heeft hoofdstukken, maar ze zijn nog leeg. Een les kan een pagina tekst zijn, een video, een quiz — wat bij het onderwerp past.",
    "nudge.content.chapter_no_activity_d1.cta": "Les toevoegen",

    "nudge.content.activity_unpublished_d2.subject": "Je lessen in {course_name} zijn nog niet zichtbaar",
    "nudge.content.activity_unpublished_d2.heading": "De lessen staan nog verborgen",
    "nudge.content.activity_unpublished_d2.body": "Je hebt lessen geschreven in {course_name}, maar geen enkele is gepubliceerd, dus deelnemers zien een lege cursus. Publiceren zet niets vast — je kunt blijven bewerken.",
    "nudge.content.activity_unpublished_d2.cta": "Lessen publiceren",

    "nudge.content.course_draft_d3.subject": "{course_name} is nog een concept",
    "nudge.content.course_draft_d3.heading": "{course_name} is er bijna",
    "nudge.content.course_draft_d3.body": "Je hebt lessen toegevoegd aan {course_name}, maar de cursus is niet gepubliceerd, dus niemand kan hem openen. Hij hoeft niet af te zijn — publiceren maakt hem alleen zichtbaar, en je kunt daarna blijven bewerken.",
    "nudge.content.course_draft_d3.cta": "Publiceren",

    "nudge.content.course_draft_d10.subject": "{course_name} staat al een tijd als concept",
    "nudge.content.course_draft_d10.heading": "Waarschijnlijk is hij klaar",
    "nudge.content.course_draft_d10.body": "{course_name} staat al ruim een week ongepubliceerd. Een cursus voelt zelden af — publiceren maakt hem zichtbaar, en je kunt blijven verbeteren terwijl er al iemand leest.",
    "nudge.content.course_draft_d10.cta": "Publiceren",

    "nudge.content.thin_course_d5.subject": "{course_name} kan er nog wat bij hebben",
    "nudge.content.thin_course_d5.heading": "Een of twee lessen",
    "nudge.content.thin_course_d5.body": "{course_name} heeft tot nu toe een of twee lessen. Cursussen komen beter tot hun recht met een handvol, en AI kan de volgende schrijven op basis van wat er al is.",
    "nudge.content.thin_course_d5.cta": "Meer lessen toevoegen",

    "nudge.content.assignment_no_submissions_d5.subject": "Nog geen inzendingen in {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Niemand heeft iets ingeleverd",
    "nudge.content.assignment_no_submissions_d5.body": "Je hebt een opdracht aangemaakt in {org_name} maar er is niets ingeleverd. Controleer of hij gepubliceerd is en of je deelnemers bij de bijbehorende cursus kunnen.",
    "nudge.content.assignment_no_submissions_d5.cta": "Opdrachten controleren",

    "nudge.audience.published_no_members_d1.subject": "{course_name} staat live, maar er is nog niemand",
    "nudge.audience.published_no_members_d1.heading": "Tijd om iemand uit te nodigen",
    "nudge.audience.published_no_members_d1.body": "{course_name} is gepubliceerd en klaar om gelezen te worden. {org_name} heeft nog geen deelnemers, dus de volgende stap is de mensen uitnodigen voor wie je het schreef.",
    "nudge.audience.published_no_members_d1.cta": "Deelnemers uitnodigen",

    "nudge.audience.published_no_members_d7.subject": "{course_name} heeft nog steeds geen deelnemers",
    "nudge.audience.published_no_members_d7.heading": "Een week live, niemand leest mee",
    "nudge.audience.published_no_members_d7.body": "{course_name} staat een week live en {org_name} heeft nog steeds geen deelnemers. Je kunt mensen één voor één uitnodigen, een lijst plakken of gewoon de deelnamelink delen.",
    "nudge.audience.published_no_members_d7.cta": "Mensen uitnodigen",

    "nudge.audience.members_no_enrollment_d3.subject": "Je deelnemers zijn nog niet begonnen",
    "nudge.audience.members_no_enrollment_d3.heading": "Aangemeld maar niets geopend",
    "nudge.audience.members_no_enrollment_d3.body": "Er hebben zich mensen aangesloten bij {org_name}, maar niemand is aan een cursus begonnen. Een kort bericht met een directe link helpt meestal — de meesten hebben simpelweg de ingang niet gevonden.",
    "nudge.audience.members_no_enrollment_d3.cta": "Bekijk je leden",

    "nudge.audience.share_public_page_d14.subject": "Je cursuspagina is openbaar — hier is de link",
    "nudge.audience.share_public_page_d14.heading": "Iedereen met de link kan meelezen",
    "nudge.audience.share_public_page_d14.body": "{course_name} is openbaar, dus je kunt hem overal delen zonder dat iemand een uitnodiging nodig heeft. De link hieronder is degene om te versturen.",
    "nudge.audience.share_public_page_d14.cta": "Openbare pagina bekijken",

    "nudge.audience.stalled_learners_d14.subject": "Sommige deelnemers zijn halverwege gestopt",
    "nudge.audience.stalled_learners_d14.heading": "Een paar mensen zijn blijven steken",
    "nudge.audience.stalled_learners_d14.body": "Sommige deelnemers in {org_name} zijn aan een cursus begonnen en al twee weken niet teruggekomen. Een bericht van jou helpt vaak, net als kijken waar ze gestopt zijn.",
    "nudge.audience.stalled_learners_d14.cta": "Deelnemers bekijken",

    "nudge.monetization.course_limit_d1.subject": "Je hebt alle cursussen van het {plan_name}-abonnement gebruikt",
    "nudge.monetization.course_limit_d1.heading": "Je hebt de cursuslimiet bereikt",
    "nudge.monetization.course_limit_d1.body": "{org_name} zit op het {plan_name}-abonnement en heeft alle inbegrepen cursussen gebruikt. Overstappen naar {next_plan} haalt die limiet weg als je verder wilt bouwen.",
    "nudge.monetization.course_limit_d1.cta": "Abonnementen bekijken",

    "nudge.monetization.member_limit_near.subject": "Je nadert de ledenlimiet van {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Bijna aan de ledenlimiet",
    "nudge.monetization.member_limit_near.body": "{org_name} nadert het aantal leden dat het {plan_name}-abonnement toestaat. Overstappen naar {next_plan} verhoogt dat, zodat niemand halverwege het aanmelden wordt geweigerd.",
    "nudge.monetization.member_limit_near.cta": "Abonnementen bekijken",

    "nudge.monetization.ai_credits_low.subject": "Je AI-credits zijn bijna op",
    "nudge.monetization.ai_credits_low.heading": "Nog weinig AI-credits",
    "nudge.monetization.ai_credits_low.body": "{org_name} heeft de meeste AI-credits van het {plan_name}-abonnement gebruikt. Het {next_plan}-abonnement bevat er meer, als AI inmiddels onderdeel is van hoe je cursussen maakt.",
    "nudge.monetization.ai_credits_low.cta": "Abonnementen bekijken",

    "nudge.monetization.upgrade_recap_d21.subject": "Wat {next_plan} zou toevoegen voor {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Je hebt iets echts opgebouwd",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} heeft gepubliceerde cursussen en mensen die ze lezen. Het {next_plan}-abonnement geeft ruimte om te groeien en bevat dingen die in het {plan_name}-abonnement ontbreken — het bekijken waard als je wilt uitbreiden.",
    "nudge.monetization.upgrade_recap_d21.cta": "Abonnementen vergelijken",

    "nudge.dormancy.no_login_14d.subject": "Het was stil in {org_name}",
    "nudge.dormancy.no_login_14d.heading": "Het is een paar weken geleden",
    "nudge.dormancy.no_login_14d.body": "Er is niets veranderd in {org_name} sinds je er voor het laatst was. Was je ergens middenin, dan ligt het nog precies waar je het liet.",
    "nudge.dormancy.no_login_14d.cta": "Dashboard openen",

    "nudge.dormancy.no_login_30d.subject": "Je cursussen op {org_name} staan er nog",
    "nudge.dormancy.no_login_30d.heading": "Het is een paar weken geleden",
    "nudge.dormancy.no_login_30d.body": "Er is niets veranderd terwijl je weg was — {org_name} en alles erin staat precies waar je het liet. Weer oppakken is één klik.",
    "nudge.dormancy.no_login_30d.cta": "Dashboard openen",

    "nudge.dormancy.no_login_60d.subject": "Laatste bericht over {org_name}",
    "nudge.dormancy.no_login_60d.heading": "We laten je verder met rust",
    "nudge.dormancy.no_login_60d.body": "{org_name} is een paar maanden stil geweest, dus dit is voorlopig de laatste van deze e-mails. Alles wat je gebouwd hebt blijft precies zoals het is, voor wanneer je het nodig hebt.",
    "nudge.dormancy.no_login_60d.cta": "Dashboard openen",

    "nudge.dormancy.winback_q.subject": "Wat er nieuw is sinds je laatst in {org_name} was",
    "nudge.dormancy.winback_q.heading": "Er is het een en ander veranderd",
    "nudge.dormancy.winback_q.body": "Het is een tijd geleden dat je in {org_name} was. Het product is sindsdien flink doorontwikkeld, en alles wat je gebouwd hebt staat er nog.",
    "nudge.dormancy.winback_q.cta": "Even kijken",

    "nudge.milestone.first_course_published.subject": "{course_name} staat live",
    "nudge.milestone.first_course_published.heading": "Je hebt je eerste cursus gepubliceerd",
    "nudge.milestone.first_course_published.body": "{course_name} staat live en is te lezen. Wat nu het verschil maakt, is iemand die hem leest — al zijn het maar één of twee mensen om te beginnen.",
    "nudge.milestone.first_course_published.cta": "Nodig je eerste deelnemers uit",

    "nudge.milestone.first_learner_enrolled.subject": "Iemand is begonnen aan {course_name}",
    "nudge.milestone.first_learner_enrolled.heading": "Je eerste deelnemer is binnen",
    "nudge.milestone.first_learner_enrolled.body": "Voor het eerst is iemand begonnen aan een cursus in {org_name}. Je kunt de voortgang volgen vanaf je dashboard.",
    "nudge.milestone.first_learner_enrolled.cta": "Voortgang bekijken",

    "nudge.milestone.first_completion.subject": "Iemand heeft een cursus in {org_name} afgerond",
    "nudge.milestone.first_completion.heading": "Eerste afronding",
    "nudge.milestone.first_completion.body": "Een deelnemer heeft een cursus in {org_name} van begin tot eind afgerond. Wil je dat vastleggen, dan kun je een certificaat toevoegen — of beginnen aan wat hierna komt.",
    "nudge.milestone.first_completion.cta": "Dashboard openen",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Je academie op {org_name} staat er nog",
    "nudge.reactivation.opener.heading": "Nog steeds hier, precies zoals je het achterliet",
    "nudge.reactivation.opener.body": "Niemand heeft {org_name} aangeraakt sinds je laatste bezoek — elke cursus, elk hoofdstuk en elke les staat waar je het liet. Weer oppakken is één klik.",
    "nudge.reactivation.opener.cta": "Dashboard openen",
    "nudge.reactivation.whats_changed.subject": "Er is het een en ander veranderd op LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Sinds je laatste bezoek",
    "nudge.reactivation.whats_changed.body": "Het product is flink doorontwikkeld terwijl {org_name} stil lag: de editor, de cursustools en de route die deelnemers volgen zijn allemaal grondig aangepakt. Alles wat je bouwde werkt nog precies zo.",
    "nudge.reactivation.whats_changed.cta": "Bekijk wat nieuw is",
    "nudge.reactivation.need_a_hand.subject": "Hulp nodig om weer in {org_name} te komen?",
    "nudge.reactivation.need_a_hand.heading": "Zat er iets in de weg?",
    "nudge.reactivation.need_a_hand.body": "Als er een reden was dat {org_name} stil kwam te liggen — iets onduidelijks, iets dat ontbrak, of gewoon geen tijd — horen we dat graag. Beantwoord deze e-mail, hij komt rechtstreeks bij ons binnen.",
    "nudge.reactivation.closing.subject": "Laatste bericht over {org_name}",
    "nudge.reactivation.closing.heading": "Hier stoppen we",
    "nudge.reactivation.closing.body": "Dit is de laatste van deze e-mails. {org_name} blijft precies zoals het is en niets verloopt — wil je ooit terugkomen, dan staat alles klaar.",
    "nudge.reactivation.closing.cta": "Dashboard openen",
}
