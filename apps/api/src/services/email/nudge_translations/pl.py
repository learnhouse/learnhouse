"""Polish nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Zrezygnuj z tych wiadomości",
    "nudge.common.footer": "Otrzymujesz tę wiadomość, ponieważ jesteś administratorem {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Kursy",
    "nudge.stat.chapters": "Rozdziały",
    "nudge.stat.lessons": "Lekcje",
    "nudge.stat.members": "Członkowie",
    "nudge.stat.learners": "Uczestnicy",
    "nudge.stat.completed": "Ukończone",

    "nudge.activation.first_course_d1.subject": "Twój pierwszy kurs w {org_name}",
    "nudge.activation.first_course_d1.heading": "Kiedy tylko zechcesz",
    "nudge.activation.first_course_d1.body": "{org_name} jest gotowa i czeka na pierwszy kurs. Większość zaczyna od małego: jeden temat, kilka lekcji. Rozbudować możesz później.",
    "nudge.activation.first_course_d1.cta": "Utwórz pierwszy kurs",

    "nudge.activation.come_back_d2.subject": "Wróć tam, gdzie skończyłeś",
    "nudge.activation.come_back_d2.heading": "Twoja konfiguracja wciąż czeka",
    "nudge.activation.come_back_d2.body": "Założyłeś {org_name} i od tamtej pory nie wróciłeś. Wszystko nadal tam jest, a pierwszy kurs da się uruchomić w jakieś dziesięć minut.",
    "nudge.activation.come_back_d2.cta": "Przejdź do panelu",

    "nudge.activation.ai_course_help_d4.subject": "Pusta strona to najtrudniejsze",
    "nudge.activation.ai_course_help_d4.heading": "Niech AI napisze konspekt",
    "nudge.activation.ai_course_help_d4.body": "Jeśli {org_name} wciąż jest pusta, bo nie wiesz, od czego zacząć — opisz temat, a AI przygotuje rozdziały i lekcje. Dalej redagujesz Ty.",
    "nudge.activation.ai_course_help_d4.cta": "Utwórz kurs z AI",

    "nudge.activation.import_existing_d5.subject": "Przenieś to, co już masz",
    "nudge.activation.import_existing_d5.heading": "Nie musisz zaczynać od zera",
    "nudge.activation.import_existing_d5.body": "Jeśli Twoje materiały istnieją już jako dokumenty, slajdy albo eksport z innej platformy, możesz je przenieść do {org_name} zamiast przepisywać.",
    "nudge.activation.import_existing_d5.cta": "Zaimportuj materiały",

    "nudge.activation.setup_checklist_d7.subject": "Kwadrans do działającej akademii",
    "nudge.activation.setup_checklist_d7.heading": "Krótka lista kroków",
    "nudge.activation.setup_checklist_d7.body": "{org_name} wciąż czeka na pierwszy kurs. Lista konfiguracyjna prowadzi przez to w kilku krokach — większość kończy w kwadrans.",
    "nudge.activation.setup_checklist_d7.cta": "Otwórz listę",

    "nudge.activation.whats_blocking_d14.subject": "Co stanęło na przeszkodzie?",
    "nudge.activation.whats_blocking_d14.heading": "Możemy zapytać, co Cię zatrzymało?",
    "nudge.activation.whats_blocking_d14.body": "Założyłeś {org_name} dwa tygodnie temu i nie dodałeś jeszcze kursu. Jeśli coś było niejasne albo czegoś zabrakło, chcielibyśmy o tym wiedzieć — odpowiedz na tę wiadomość, trafi prosto do nas.",

    "nudge.activation.last_call_d30.subject": "Ostatnia wiadomość o {org_name}",
    "nudge.activation.last_call_d30.heading": "To już ostatnia",
    "nudge.activation.last_call_d30.body": "{org_name} milczy od miesiąca, więc przestajemy wysyłać te wiadomości. Twoje konto i wszystko w nim zostaje — jeśli wrócisz, znajdziesz to tak, jak zostawiłeś.",
    "nudge.activation.last_call_d30.cta": "Otwórz panel",

    "nudge.content.course_no_chapter_d1.subject": "{course_name} potrzebuje pierwszego rozdziału",
    "nudge.content.course_no_chapter_d1.heading": "Został jeden rozdział",
    "nudge.content.course_no_chapter_d1.body": "{course_name} istnieje, ale nie ma jeszcze rozdziałów, więc nie ma czego otworzyć. Rozdziały to po prostu sekcje — jeden na temat sprawdza się dobrze.",
    "nudge.content.course_no_chapter_d1.cta": "Dodaj rozdział",

    "nudge.content.chapter_no_activity_d1.subject": "Dodaj pierwszą lekcję do {course_name}",
    "nudge.content.chapter_no_activity_d1.heading": "Rozdziały są gotowe",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} ma rozdziały, ale są jeszcze puste. Lekcja może być stroną tekstu, filmem, quizem — czymkolwiek, co pasuje do tematu.",
    "nudge.content.chapter_no_activity_d1.cta": "Dodaj lekcję",

    "nudge.content.activity_unpublished_d2.subject": "Twoje lekcje w {course_name} nie są jeszcze widoczne",
    "nudge.content.activity_unpublished_d2.heading": "Lekcje wciąż są ukryte",
    "nudge.content.activity_unpublished_d2.body": "Napisałeś lekcje w {course_name}, ale żadna nie jest opublikowana, więc uczestnicy widzą pusty kurs. Publikacja niczego nie blokuje — możesz dalej edytować.",
    "nudge.content.activity_unpublished_d2.cta": "Opublikuj lekcje",

    "nudge.content.course_draft_d3.subject": "{course_name} to wciąż wersja robocza",
    "nudge.content.course_draft_d3.heading": "{course_name} jest już blisko",
    "nudge.content.course_draft_d3.body": "Dodałeś lekcje do {course_name}, ale kurs nie jest opublikowany, więc nikt go nie otworzy. Nie musi być skończony — publikacja tylko go uwidacznia, a edytować możesz dalej.",
    "nudge.content.course_draft_d3.cta": "Opublikuj",

    "nudge.content.course_draft_d10.subject": "{course_name} od dłuższego czasu jest wersją roboczą",
    "nudge.content.course_draft_d10.heading": "Prawdopodobnie jest gotowy",
    "nudge.content.course_draft_d10.body": "{course_name} leży nieopublikowany od ponad tygodnia. Kurs rzadko wydaje się skończony — publikacja czyni go widocznym, a ulepszać możesz go dalej, gdy ktoś już czyta.",
    "nudge.content.course_draft_d10.cta": "Opublikuj",

    "nudge.content.thin_course_d5.subject": "{course_name} przydałoby się nieco więcej",
    "nudge.content.thin_course_d5.heading": "Jedna, dwie lekcje",
    "nudge.content.thin_course_d5.body": "{course_name} ma na razie jedną czy dwie lekcje. Kursy zwykle wypadają lepiej przy kilku, a AI potrafi przygotować kolejne na bazie tego, co już jest.",
    "nudge.content.thin_course_d5.cta": "Dodaj więcej lekcji",

    "nudge.content.assignment_no_submissions_d5.subject": "Wciąż brak prac w {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Nikt niczego nie oddał",
    "nudge.content.assignment_no_submissions_d5.body": "Utworzyłeś zadanie w {org_name}, ale nic nie zostało przesłane. Warto sprawdzić, czy jest opublikowane i czy uczestnicy mają dostęp do kursu, do którego należy.",
    "nudge.content.assignment_no_submissions_d5.cta": "Sprawdź zadania",

    "nudge.audience.published_no_members_d1.subject": "{course_name} jest opublikowany, ale nikogo tam nie ma",
    "nudge.audience.published_no_members_d1.heading": "Czas kogoś zaprosić",
    "nudge.audience.published_no_members_d1.body": "{course_name} jest opublikowany i gotowy do czytania. {org_name} nie ma jeszcze uczestników, więc następny krok to zaprosić tych, dla których go napisałeś.",
    "nudge.audience.published_no_members_d1.cta": "Zaproś uczestników",

    "nudge.audience.published_no_members_d7.subject": "{course_name} wciąż nie ma uczestników",
    "nudge.audience.published_no_members_d7.heading": "Tydzień online, nikt nie czyta",
    "nudge.audience.published_no_members_d7.body": "{course_name} jest opublikowany od tygodnia, a {org_name} nadal nie ma uczestników. Możesz zapraszać pojedynczo, wkleić listę albo po prostu udostępnić link.",
    "nudge.audience.published_no_members_d7.cta": "Zaproś osoby",

    "nudge.audience.members_no_enrollment_d3.subject": "Twoi uczestnicy jeszcze nie zaczęli",
    "nudge.audience.members_no_enrollment_d3.heading": "Dołączyli, ale nic nie otworzyli",
    "nudge.audience.members_no_enrollment_d3.body": "Ludzie dołączyli do {org_name}, ale nikt nie zaczął kursu. Zwykle wystarczy krótka wiadomość z bezpośrednim linkiem — większość po prostu nie trafiła do środka.",
    "nudge.audience.members_no_enrollment_d3.cta": "Zobacz członków",

    "nudge.audience.share_public_page_d14.subject": "Twoja strona kursu jest publiczna — oto link",
    "nudge.audience.share_public_page_d14.heading": "Każdy z linkiem może czytać",
    "nudge.audience.share_public_page_d14.body": "{course_name} jest publiczny, więc możesz go udostępniać wszędzie i nikt nie potrzebuje zaproszenia. Link poniżej to ten do wysłania.",
    "nudge.audience.share_public_page_d14.cta": "Zobacz stronę publiczną",

    "nudge.audience.stalled_learners_d14.subject": "Część uczestników zatrzymała się w połowie",
    "nudge.audience.stalled_learners_d14.heading": "Kilka osób utknęło",
    "nudge.audience.stalled_learners_d14.body": "Część uczestników w {org_name} zaczęła kurs i nie wróciła od dwóch tygodni. Często pomaga wiadomość od Ciebie albo sprawdzenie, gdzie się zatrzymali.",
    "nudge.audience.stalled_learners_d14.cta": "Sprawdź uczestników",

    "nudge.monetization.course_limit_d1.subject": "Wykorzystałeś wszystkie kursy w planie {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Osiągnąłeś limit kursów",
    "nudge.monetization.course_limit_d1.body": "{org_name} korzysta z planu {plan_name} i wykorzystała wszystkie zawarte w nim kursy. Przejście na {next_plan} znosi ten limit, jeśli chcesz tworzyć dalej.",
    "nudge.monetization.course_limit_d1.cta": "Zobacz plany",

    "nudge.monetization.member_limit_near.subject": "Zbliżasz się do limitu członków w planie {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Blisko limitu członków",
    "nudge.monetization.member_limit_near.body": "{org_name} zbliża się do liczby członków, na jaką pozwala plan {plan_name}. Przejście na {next_plan} podnosi ten limit, żeby nikt nie utknął w trakcie rejestracji.",
    "nudge.monetization.member_limit_near.cta": "Zobacz plany",

    "nudge.monetization.ai_credits_low.subject": "Twoje kredyty AI prawie się skończyły",
    "nudge.monetization.ai_credits_low.heading": "Zostało mało kredytów AI",
    "nudge.monetization.ai_credits_low.body": "{org_name} wykorzystała większość kredytów AI zawartych w planie {plan_name}. Plan {next_plan} zawiera ich więcej, jeśli AI stało się częścią tego, jak tworzysz kursy.",
    "nudge.monetization.ai_credits_low.cta": "Zobacz plany",

    "nudge.monetization.upgrade_recap_d21.subject": "Co {next_plan} dałby {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Zbudowałeś coś realnego",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} ma opublikowane kursy i ludzi, którzy je czytają. Plan {next_plan} daje przestrzeń do wzrostu i kilka rzeczy, których nie ma w planie {plan_name} — warto zerknąć, jeśli planujesz się rozwijać.",
    "nudge.monetization.upgrade_recap_d21.cta": "Porównaj plany",

    "nudge.dormancy.no_login_14d.subject": "W {org_name} było cicho",
    "nudge.dormancy.no_login_14d.heading": "Minęły dwa tygodnie",
    "nudge.dormancy.no_login_14d.body": "W {org_name} nic się nie zmieniło od Twojej ostatniej wizyty. Jeśli byłeś w trakcie czegoś, leży dokładnie tam, gdzie to zostawiłeś.",
    "nudge.dormancy.no_login_14d.cta": "Otwórz panel",

    "nudge.dormancy.no_login_30d.subject": "Twoje kursy w {org_name} wciąż tu są",
    "nudge.dormancy.no_login_30d.heading": "Minęło kilka tygodni",
    "nudge.dormancy.no_login_30d.body": "Podczas Twojej nieobecności nic się nie zmieniło — {org_name} i wszystko w niej jest dokładnie tam, gdzie to zostawiłeś. Powrót to jedno kliknięcie.",
    "nudge.dormancy.no_login_30d.cta": "Otwórz panel",

    "nudge.dormancy.no_login_60d.subject": "Ostatnia wiadomość o {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Zostawiamy Cię w spokoju",
    "nudge.dormancy.no_login_60d.body": "{org_name} milczy od dwóch miesięcy, więc to na razie ostatnia taka wiadomość. Wszystko, co zbudowałeś, zostaje bez zmian — na kiedy tylko zechcesz.",
    "nudge.dormancy.no_login_60d.cta": "Otwórz panel",

    "nudge.dormancy.winback_q.subject": "Co nowego od Twojej ostatniej wizyty w {org_name}",
    "nudge.dormancy.winback_q.heading": "Kilka rzeczy się zmieniło",
    "nudge.dormancy.winback_q.body": "Minęło trochę czasu, odkąd byłeś w {org_name}. Produkt sporo od tego czasu poszedł do przodu, a wszystko, co zbudowałeś, nadal tam jest.",
    "nudge.dormancy.winback_q.cta": "Rzuć okiem",

    "nudge.milestone.first_course_published.subject": "{course_name} jest opublikowany",
    "nudge.milestone.first_course_published.heading": "Opublikowałeś swój pierwszy kurs",
    "nudge.milestone.first_course_published.body": "{course_name} jest dostępny i można go czytać. To, co teraz robi różnicę, to ktoś, kto go przeczyta — nawet jedna czy dwie osoby na start.",
    "nudge.milestone.first_course_published.cta": "Zaproś pierwszych uczestników",

    "nudge.milestone.first_learner_enrolled.subject": "Ktoś zaczął {course_name}",
    "nudge.milestone.first_learner_enrolled.heading": "Masz pierwszego uczestnika",
    "nudge.milestone.first_learner_enrolled.body": "Ktoś po raz pierwszy zaczął kurs w {org_name}. Postępy możesz śledzić w panelu.",
    "nudge.milestone.first_learner_enrolled.cta": "Zobacz postępy",

    "nudge.milestone.first_completion.subject": "Ktoś ukończył kurs w {org_name}",
    "nudge.milestone.first_completion.heading": "Pierwsze ukończenie",
    "nudge.milestone.first_completion.body": "Uczestnik przeszedł kurs w {org_name} od początku do końca. Jeśli chcesz to odpowiednio odnotować, możesz dodać certyfikat — albo zacząć budować kolejny kurs.",
    "nudge.milestone.first_completion.cta": "Otwórz panel",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Twoja akademia w {org_name} wciąż tu jest",
    "nudge.reactivation.opener.heading": "Wciąż tutaj, dokładnie tak, jak zostawiłeś",
    "nudge.reactivation.opener.body": "Nikt nie ruszał {org_name} od Twojej ostatniej wizyty — każdy kurs, rozdział i lekcja są tam, gdzie je zostawiłeś. Powrót to jedno kliknięcie.",
    "nudge.reactivation.opener.cta": "Otwórz panel",
    "nudge.reactivation.whats_changed.subject": "Kilka rzeczy zmieniło się w LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Od Twojej ostatniej wizyty",
    "nudge.reactivation.whats_changed.body": "Produkt sporo poszedł do przodu, gdy {org_name} milczała: edytor, narzędzia kursów i ścieżka uczestników zostały porządnie przepracowane. Wszystko, co zbudowałeś, działa tak samo.",
    "nudge.reactivation.whats_changed.cta": "Zobacz nowości",
    "nudge.reactivation.need_a_hand.subject": "Potrzebujesz pomocy z powrotem do {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "Coś stanęło na przeszkodzie?",
    "nudge.reactivation.need_a_hand.body": "Jeśli był powód, dla którego {org_name} stanęła — coś niejasnego, czegoś brakowało albo po prostu brakło czasu — chcielibyśmy o tym wiedzieć. Odpowiedz na tę wiadomość, trafi prosto do nas.",
    "nudge.reactivation.closing.subject": "Ostatnia wiadomość o {org_name}",
    "nudge.reactivation.closing.heading": "Na tym kończymy",
    "nudge.reactivation.closing.body": "To ostatnia z takich wiadomości. {org_name} zostaje dokładnie taka, jaka jest, i nic nie wygasa — jeśli kiedyś zechcesz wrócić, wszystko będzie czekać.",
    "nudge.reactivation.closing.cta": "Otwórz panel",
}
