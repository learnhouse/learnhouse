"""German nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Diese E-Mails abbestellen",
    "nudge.common.footer": "Sie erhalten diese E-Mail, weil Sie Administrator von {org_name} sind.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Kurse",
    "nudge.stat.chapters": "Kapitel",
    "nudge.stat.lessons": "Lektionen",
    "nudge.stat.members": "Mitglieder",
    "nudge.stat.learners": "Lernende",
    "nudge.stat.completed": "Abgeschlossen",

    "nudge.activation.first_course_d1.subject": "Ihr erster Kurs auf {org_name}",
    "nudge.activation.first_course_d1.heading": "Wann immer Sie möchten",
    "nudge.activation.first_course_d1.body": "{org_name} ist eingerichtet und wartet auf den ersten Kurs. Die meisten fangen klein an: ein Thema, ein paar Lektionen. Ergänzen können Sie jederzeit.",
    "nudge.activation.first_course_d1.cta": "Ersten Kurs erstellen",

    "nudge.activation.come_back_d2.subject": "Da weitermachen, wo Sie aufgehört haben",
    "nudge.activation.come_back_d2.heading": "Ihre Einrichtung wartet noch",
    "nudge.activation.come_back_d2.body": "Sie haben {org_name} eingerichtet und waren seitdem nicht mehr da. Alles ist noch vorhanden, und ein erster Kurs ist in etwa zehn Minuten online.",
    "nudge.activation.come_back_d2.cta": "Zum Dashboard",

    "nudge.activation.ai_course_help_d4.subject": "Das leere Blatt ist das Schwierigste",
    "nudge.activation.ai_course_help_d4.heading": "Lassen Sie die KI die Gliederung schreiben",
    "nudge.activation.ai_course_help_d4.body": "Wenn {org_name} noch leer ist, weil der Anfang schwerfällt: Beschreiben Sie Ihr Thema, und die KI entwirft Kapitel und Lektionen. Den Rest übernehmen Sie.",
    "nudge.activation.ai_course_help_d4.cta": "Kurs mit KI entwerfen",

    "nudge.activation.import_existing_d5.subject": "Bringen Sie mit, was Sie schon haben",
    "nudge.activation.import_existing_d5.heading": "Sie müssen nicht bei null anfangen",
    "nudge.activation.import_existing_d5.body": "Wenn Ihr Material bereits als Dokument, Präsentation oder Export einer anderen Plattform vorliegt, können Sie es nach {org_name} übernehmen, statt alles neu zu tippen.",
    "nudge.activation.import_existing_d5.cta": "Material importieren",

    "nudge.activation.setup_checklist_d7.subject": "Fünfzehn Minuten bis zur fertigen Akademie",
    "nudge.activation.setup_checklist_d7.heading": "Eine kurze Checkliste",
    "nudge.activation.setup_checklist_d7.body": "{org_name} wartet noch auf den ersten Kurs. Die Checkliste führt Sie in wenigen Schritten hindurch — die meisten sind in einer Viertelstunde fertig.",
    "nudge.activation.setup_checklist_d7.cta": "Checkliste öffnen",

    "nudge.activation.whats_blocking_d14.subject": "Was ist dazwischengekommen?",
    "nudge.activation.whats_blocking_d14.heading": "Dürfen wir fragen, woran es lag?",
    "nudge.activation.whats_blocking_d14.body": "Sie haben {org_name} vor zwei Wochen eingerichtet und noch keinen Kurs angelegt. Wenn etwas unklar war oder gefehlt hat, würden wir das gern wissen — antworten Sie einfach auf diese E-Mail, sie kommt direkt bei uns an.",

    "nudge.activation.last_call_d30.subject": "Letzte E-Mail zu {org_name}",
    "nudge.activation.last_call_d30.heading": "Das ist die letzte",
    "nudge.activation.last_call_d30.body": "{org_name} war einen Monat lang still, deshalb hören wir mit diesen E-Mails auf. Ihr Konto und alles darin bleibt bestehen — wenn Sie zurückkommen, ist alles noch da.",
    "nudge.activation.last_call_d30.cta": "Dashboard öffnen",

    "nudge.content.course_no_chapter_d1.subject": "{course_name} braucht sein erstes Kapitel",
    "nudge.content.course_no_chapter_d1.heading": "Nur noch ein Kapitel",
    "nudge.content.course_no_chapter_d1.body": "{course_name} existiert, hat aber noch keine Kapitel — es gibt also nichts zu öffnen. Kapitel sind einfach Abschnitte, eines pro Thema funktioniert gut.",
    "nudge.content.course_no_chapter_d1.cta": "Kapitel hinzufügen",

    "nudge.content.chapter_no_activity_d1.subject": "Fügen Sie {course_name} die erste Lektion hinzu",
    "nudge.content.chapter_no_activity_d1.heading": "Die Kapitel stehen",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} hat Kapitel, aber noch keinen Inhalt darin. Eine Lektion kann eine Textseite sein, ein Video, ein Quiz — was zum Thema passt.",
    "nudge.content.chapter_no_activity_d1.cta": "Lektion hinzufügen",

    "nudge.content.activity_unpublished_d2.subject": "Ihre Lektionen in {course_name} sind noch nicht sichtbar",
    "nudge.content.activity_unpublished_d2.heading": "Die Lektionen sind noch verborgen",
    "nudge.content.activity_unpublished_d2.body": "Sie haben Lektionen in {course_name} geschrieben, aber keine ist veröffentlicht — Lernende sehen einen leeren Kurs. Veröffentlichen sperrt nichts, Sie können weiter bearbeiten.",
    "nudge.content.activity_unpublished_d2.cta": "Lektionen veröffentlichen",

    "nudge.content.course_draft_d3.subject": "{course_name} ist noch ein Entwurf",
    "nudge.content.course_draft_d3.heading": "{course_name} ist fast fertig",
    "nudge.content.course_draft_d3.body": "Sie haben {course_name} Lektionen hinzugefügt, aber der Kurs ist nicht veröffentlicht — niemand kann ihn öffnen. Er muss nicht fertig sein: Veröffentlichen macht ihn nur sichtbar, und Sie können weiter daran arbeiten.",
    "nudge.content.course_draft_d3.cta": "Jetzt veröffentlichen",

    "nudge.content.course_draft_d10.subject": "{course_name} ist schon eine Weile ein Entwurf",
    "nudge.content.course_draft_d10.heading": "Wahrscheinlich ist er so weit",
    "nudge.content.course_draft_d10.body": "{course_name} liegt seit über einer Woche unveröffentlicht da. Ein Kurs fühlt sich selten fertig an — Veröffentlichen macht ihn sichtbar, und Sie können ihn weiter verbessern, während schon jemand liest.",
    "nudge.content.course_draft_d10.cta": "Jetzt veröffentlichen",

    "nudge.content.thin_course_d5.subject": "{course_name} verträgt noch etwas mehr",
    "nudge.content.thin_course_d5.heading": "Ein, zwei Lektionen",
    "nudge.content.thin_course_d5.body": "{course_name} hat bisher ein, zwei Lektionen. Kurse wirken mit einer Handvoll meist besser, und die KI kann die nächsten aus dem Vorhandenen entwerfen.",
    "nudge.content.thin_course_d5.cta": "Weitere Lektionen hinzufügen",

    "nudge.content.assignment_no_submissions_d5.subject": "Noch keine Abgaben in {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Niemand hat etwas abgegeben",
    "nudge.content.assignment_no_submissions_d5.body": "Sie haben in {org_name} eine Aufgabe angelegt, aber es wurde nichts eingereicht. Prüfen Sie, ob sie veröffentlicht ist und ob Ihre Lernenden den zugehörigen Kurs erreichen.",
    "nudge.content.assignment_no_submissions_d5.cta": "Aufgaben prüfen",

    "nudge.audience.published_no_members_d1.subject": "{course_name} ist online, aber noch ist niemand da",
    "nudge.audience.published_no_members_d1.heading": "Zeit, jemanden einzuladen",
    "nudge.audience.published_no_members_d1.body": "{course_name} ist veröffentlicht und bereit. {org_name} hat noch keine Lernenden — der nächste Schritt ist, die Menschen einzuladen, für die Sie ihn geschrieben haben.",
    "nudge.audience.published_no_members_d1.cta": "Lernende einladen",

    "nudge.audience.published_no_members_d7.subject": "{course_name} hat weiterhin keine Lernenden",
    "nudge.audience.published_no_members_d7.heading": "Eine Woche online, niemand liest",
    "nudge.audience.published_no_members_d7.body": "{course_name} ist seit einer Woche veröffentlicht und {org_name} hat immer noch keine Lernenden. Sie können einzeln einladen, eine Liste einfügen oder einfach den Beitrittslink teilen.",
    "nudge.audience.published_no_members_d7.cta": "Personen einladen",

    "nudge.audience.members_no_enrollment_d3.subject": "Ihre Lernenden haben noch nicht angefangen",
    "nudge.audience.members_no_enrollment_d3.heading": "Beigetreten, aber nichts geöffnet",
    "nudge.audience.members_no_enrollment_d3.body": "Es sind Leute {org_name} beigetreten, aber niemand hat einen Kurs begonnen. Eine kurze Nachricht mit einem direkten Link genügt meist — die meisten haben schlicht den Einstieg nicht gefunden.",
    "nudge.audience.members_no_enrollment_d3.cta": "Mitglieder ansehen",

    "nudge.audience.share_public_page_d14.subject": "Ihre Kursseite ist öffentlich — hier ist der Link",
    "nudge.audience.share_public_page_d14.heading": "Jeder mit dem Link kann lesen",
    "nudge.audience.share_public_page_d14.body": "{course_name} ist öffentlich, Sie können ihn also überall teilen, ohne dass jemand eine Einladung braucht. Der Link unten ist der richtige.",
    "nudge.audience.share_public_page_d14.cta": "Öffentliche Seite ansehen",

    "nudge.audience.stalled_learners_d14.subject": "Einige Lernende sind mittendrin stehen geblieben",
    "nudge.audience.stalled_learners_d14.heading": "Ein paar sind hängen geblieben",
    "nudge.audience.stalled_learners_d14.body": "Einige Lernende in {org_name} haben einen Kurs begonnen und sind seit zwei Wochen nicht zurückgekehrt. Oft hilft eine Nachricht von Ihnen — oder ein Blick darauf, wo sie aufgehört haben.",
    "nudge.audience.stalled_learners_d14.cta": "Lernende ansehen",

    "nudge.monetization.course_limit_d1.subject": "Sie haben alle Kurse im Tarif {plan_name} genutzt",
    "nudge.monetization.course_limit_d1.heading": "Sie haben das Kurslimit erreicht",
    "nudge.monetization.course_limit_d1.body": "{org_name} nutzt den Tarif {plan_name} und hat alle darin enthaltenen Kurse verbraucht. Der Wechsel zu {next_plan} hebt dieses Limit auf, wenn Sie weiterbauen möchten.",
    "nudge.monetization.course_limit_d1.cta": "Tarife ansehen",

    "nudge.monetization.member_limit_near.subject": "Sie nähern sich dem Mitgliederlimit von {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Fast am Mitgliederlimit",
    "nudge.monetization.member_limit_near.body": "{org_name} nähert sich der Zahl an Mitgliedern, die der Tarif {plan_name} erlaubt. Ein Wechsel zu {next_plan} erhöht sie, damit niemand mitten in der Anmeldung abgewiesen wird.",
    "nudge.monetization.member_limit_near.cta": "Tarife ansehen",

    "nudge.monetization.ai_credits_low.subject": "Ihre KI-Credits sind fast aufgebraucht",
    "nudge.monetization.ai_credits_low.heading": "KI-Credits gehen zur Neige",
    "nudge.monetization.ai_credits_low.body": "{org_name} hat den Großteil der im Tarif {plan_name} enthaltenen KI-Credits verbraucht. Der Tarif {next_plan} enthält mehr davon, falls KI inzwischen fester Teil Ihrer Kursarbeit ist.",
    "nudge.monetization.ai_credits_low.cta": "Tarife ansehen",

    "nudge.monetization.upgrade_recap_d21.subject": "Was {next_plan} für {org_name} bringen würde",
    "nudge.monetization.upgrade_recap_d21.heading": "Sie haben etwas Echtes aufgebaut",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} hat veröffentlichte Kurse und Menschen, die sie lesen. Der Tarif {next_plan} bietet Luft zum Wachsen und einiges, was im Tarif {plan_name} fehlt — einen Blick wert, wenn Sie größer werden wollen.",
    "nudge.monetization.upgrade_recap_d21.cta": "Tarife vergleichen",

    "nudge.dormancy.no_login_14d.subject": "In {org_name} war es still",
    "nudge.dormancy.no_login_14d.heading": "Es sind zwei Wochen vergangen",
    "nudge.dormancy.no_login_14d.body": "In {org_name} hat sich seit Ihrem letzten Besuch nichts geändert. Falls Sie mitten in etwas waren: Es liegt noch genau so da, wie Sie es verlassen haben.",
    "nudge.dormancy.no_login_14d.cta": "Dashboard öffnen",

    "nudge.dormancy.no_login_30d.subject": "Ihre Kurse auf {org_name} sind noch da",
    "nudge.dormancy.no_login_30d.heading": "Es sind ein paar Wochen vergangen",
    "nudge.dormancy.no_login_30d.body": "Während Ihrer Abwesenheit hat sich nichts geändert — {org_name} und alles darin ist genau dort, wo Sie es gelassen haben. Ein Klick, und Sie sind wieder drin.",
    "nudge.dormancy.no_login_30d.cta": "Dashboard öffnen",

    "nudge.dormancy.no_login_60d.subject": "Letzte Nachricht zu {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Wir lassen Sie in Ruhe",
    "nudge.dormancy.no_login_60d.body": "In {org_name} war es zwei Monate still, deshalb ist das vorerst die letzte dieser E-Mails. Alles, was Sie aufgebaut haben, bleibt unverändert bestehen — für wann immer Sie es brauchen.",
    "nudge.dormancy.no_login_60d.cta": "Dashboard öffnen",

    "nudge.dormancy.winback_q.subject": "Was sich seit Ihrem letzten Besuch in {org_name} getan hat",
    "nudge.dormancy.winback_q.heading": "Einiges ist neu",
    "nudge.dormancy.winback_q.body": "Es ist eine Weile her, dass Sie in {org_name} waren. Das Produkt hat sich seitdem deutlich weiterentwickelt, und alles, was Sie aufgebaut haben, ist noch da.",
    "nudge.dormancy.winback_q.cta": "Ansehen",

    "nudge.milestone.first_course_published.subject": "{course_name} ist online",
    "nudge.milestone.first_course_published.heading": "Ihr erster Kurs ist veröffentlicht",
    "nudge.milestone.first_course_published.body": "{course_name} ist online und lesbar. Den größten Unterschied macht jetzt jemand, der ihn liest — auch ein, zwei Personen für den Anfang.",
    "nudge.milestone.first_course_published.cta": "Erste Lernende einladen",

    "nudge.milestone.first_learner_enrolled.subject": "Jemand hat {course_name} begonnen",
    "nudge.milestone.first_learner_enrolled.heading": "Ihr erster Lernender ist da",
    "nudge.milestone.first_learner_enrolled.body": "Zum ersten Mal hat jemand einen Kurs in {org_name} begonnen. Den Fortschritt können Sie in Ihrem Dashboard verfolgen.",
    "nudge.milestone.first_learner_enrolled.cta": "Fortschritt ansehen",

    "nudge.milestone.first_completion.subject": "Jemand hat einen Kurs in {org_name} abgeschlossen",
    "nudge.milestone.first_completion.heading": "Erster Abschluss",
    "nudge.milestone.first_completion.body": "Ein Lernender hat einen Kurs in {org_name} von Anfang bis Ende abgeschlossen. Wenn Sie das gebührend festhalten wollen, können Sie ein Zertifikat hinzufügen — oder mit dem Nächsten beginnen.",
    "nudge.milestone.first_completion.cta": "Dashboard öffnen",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Ihre Akademie auf {org_name} ist noch da",
    "nudge.reactivation.opener.heading": "Noch da, genau wie Sie sie verlassen haben",
    "nudge.reactivation.opener.body": "Seit Ihrem letzten Besuch hat niemand {org_name} angerührt — jeder Kurs, jedes Kapitel und jede Lektion liegt unverändert da. Ein Klick, und Sie machen weiter.",
    "nudge.reactivation.opener.cta": "Dashboard öffnen",
    "nudge.reactivation.whats_changed.subject": "Auf LearnHouse hat sich einiges getan",
    "nudge.reactivation.whats_changed.heading": "Seit Ihrem letzten Besuch",
    "nudge.reactivation.whats_changed.body": "Während {org_name} still war, hat sich das Produkt deutlich weiterentwickelt: Editor, Kurswerkzeuge und der Lernweg wurden gründlich überarbeitet. Alles, was Sie aufgebaut haben, funktioniert unverändert.",
    "nudge.reactivation.whats_changed.cta": "Neuerungen ansehen",
    "nudge.reactivation.need_a_hand.subject": "Brauchen Sie Hilfe beim Wiedereinstieg in {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "Stand etwas im Weg?",
    "nudge.reactivation.need_a_hand.body": "Falls es einen Grund gab, warum {org_name} liegen blieb — etwas Unklares, etwas Fehlendes oder schlicht keine Zeit — würden wir das gern erfahren. Antworten Sie einfach auf diese E-Mail, sie kommt direkt bei uns an.",
    "nudge.reactivation.closing.subject": "Letzte Nachricht zu {org_name}",
    "nudge.reactivation.closing.heading": "Hier hören wir auf",
    "nudge.reactivation.closing.body": "Das ist die letzte dieser E-Mails. {org_name} bleibt genau so bestehen und nichts verfällt — wenn Sie zurückkommen möchten, wartet alles auf Sie.",
    "nudge.reactivation.closing.cta": "Dashboard öffnen",
}
