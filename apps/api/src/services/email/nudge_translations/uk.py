"""Ukrainian nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Відписатися від цих листів",
    "nudge.common.footer": "Ви отримали цей лист, оскільки ви адміністратор {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Курси",
    "nudge.stat.chapters": "Розділи",
    "nudge.stat.lessons": "Уроки",
    "nudge.stat.members": "Учасники",
    "nudge.stat.learners": "Слухачі",
    "nudge.stat.completed": "Завершено",

    "nudge.activation.first_course_d1.subject": "Ваш перший курс у {org_name}",
    "nudge.activation.first_course_d1.heading": "Коли вам зручно",
    "nudge.activation.first_course_d1.body": "{org_name} готова й чекає на перший курс. Більшість починає з малого: одна тема, кілька уроків. Доповнити можна будь-коли.",
    "nudge.activation.first_course_d1.cta": "Створити перший курс",

    "nudge.activation.come_back_d2.subject": "Продовжити з того місця, де спинилися",
    "nudge.activation.come_back_d2.heading": "Усе налаштоване вас чекає",
    "nudge.activation.come_back_d2.body": "Ви створили {org_name} і відтоді не поверталися. Усе на місці, а щоб опублікувати перший курс, потрібно хвилин десять.",
    "nudge.activation.come_back_d2.cta": "Перейти до панелі",

    "nudge.activation.ai_course_help_d4.subject": "Найважче — чистий аркуш",
    "nudge.activation.ai_course_help_d4.heading": "Хай ШІ напише план",
    "nudge.activation.ai_course_help_d4.body": "Якщо {org_name} досі порожня, бо незрозуміло, з чого почати, — опишіть тему, і ШІ підготує розділи та уроки. Далі редагуєте ви.",
    "nudge.activation.ai_course_help_d4.cta": "Створити курс із ШІ",

    "nudge.activation.import_existing_d5.subject": "Перенесіть те, що вже маєте",
    "nudge.activation.import_existing_d5.heading": "Не обов'язково починати з нуля",
    "nudge.activation.import_existing_d5.body": "Якщо ваші матеріали вже існують як документи, презентації чи експорт з іншої платформи, їх можна перенести в {org_name}, а не набирати заново.",
    "nudge.activation.import_existing_d5.cta": "Імпортувати матеріали",

    "nudge.activation.setup_checklist_d7.subject": "П'ятнадцять хвилин до робочої академії",
    "nudge.activation.setup_checklist_d7.heading": "Короткий список кроків",
    "nudge.activation.setup_checklist_d7.body": "{org_name} досі чекає на перший курс. Список налаштування проведе вас за кілька кроків — більшість вкладається у чверть години.",
    "nudge.activation.setup_checklist_d7.cta": "Відкрити список",

    "nudge.activation.whats_blocking_d14.subject": "Що завадило?",
    "nudge.activation.whats_blocking_d14.heading": "Можна запитати, що вас спинило?",
    "nudge.activation.whats_blocking_d14.body": "Ви створили {org_name} два тижні тому й досі не додали курс. Якщо щось було незрозуміло або чогось бракувало, нам важливо про це знати — просто відповідайте на цей лист, він надійде прямо до нас.",

    "nudge.activation.last_call_d30.subject": "Останній лист про {org_name}",
    "nudge.activation.last_call_d30.heading": "Це останній",
    "nudge.activation.last_call_d30.body": "{org_name} мовчить уже місяць, тож ми припиняємо надсилати такі листи. Обліковий запис і все в ньому лишається на місці — повернетеся, і все буде там, де ви залишили.",
    "nudge.activation.last_call_d30.cta": "Відкрити панель",

    "nudge.content.course_no_chapter_d1.subject": "Курсу «{course_name}» потрібен перший розділ",
    "nudge.content.course_no_chapter_d1.heading": "Лишився один розділ",
    "nudge.content.course_no_chapter_d1.body": "Курс «{course_name}» створено, але розділів у ньому ще немає, тож відкривати нічого. Розділи — це просто секції, по одному на тему працює добре.",
    "nudge.content.course_no_chapter_d1.cta": "Додати розділ",

    "nudge.content.chapter_no_activity_d1.subject": "Додайте перший урок до «{course_name}»",
    "nudge.content.chapter_no_activity_d1.heading": "Розділи готові",
    "nudge.content.chapter_no_activity_d1.body": "У курсі «{course_name}» є розділи, але вони поки порожні. Урок може бути сторінкою тексту, відео, тестом — тим, що пасує до теми.",
    "nudge.content.chapter_no_activity_d1.cta": "Додати урок",

    "nudge.content.activity_unpublished_d2.subject": "Ваші уроки в «{course_name}» ще не видно",
    "nudge.content.activity_unpublished_d2.heading": "Уроки досі приховані",
    "nudge.content.activity_unpublished_d2.body": "Ви написали уроки в курсі «{course_name}», але жоден не опубліковано, тож учасники бачать порожній курс. Публікація нічого не фіксує — редагувати можна й далі.",
    "nudge.content.activity_unpublished_d2.cta": "Опублікувати уроки",

    "nudge.content.course_draft_d3.subject": "«{course_name}» досі чернетка",
    "nudge.content.course_draft_d3.heading": "«{course_name}» майже готовий",
    "nudge.content.course_draft_d3.body": "Ви додали уроки до «{course_name}», але курс не опубліковано, тож ніхто його не відкриє. Він не мусить бути завершеним — публікація лише робить його видимим, редагувати можна й потім.",
    "nudge.content.course_draft_d3.cta": "Опублікувати",

    "nudge.content.course_draft_d10.subject": "«{course_name}» вже давно в чернетках",
    "nudge.content.course_draft_d10.heading": "Найімовірніше, він готовий",
    "nudge.content.course_draft_d10.body": "«{course_name}» лежить неопублікованим понад тиждень. Курс рідко здається завершеним — публікація робить його видимим, а вдосконалювати можна й тоді, коли його вже читають.",
    "nudge.content.course_draft_d10.cta": "Опублікувати",

    "nudge.content.thin_course_d5.subject": "«{course_name}» варто трохи доповнити",
    "nudge.content.thin_course_d5.heading": "Один-два уроки",
    "nudge.content.thin_course_d5.body": "У курсі «{course_name}» поки один-два уроки. Курси зазвичай сприймаються краще, коли їх кілька, і ШІ може підготувати наступні на основі вже написаного.",
    "nudge.content.thin_course_d5.cta": "Додати уроки",

    "nudge.content.assignment_no_submissions_d5.subject": "У {org_name} поки немає жодної роботи",
    "nudge.content.assignment_no_submissions_d5.heading": "Ніхто нічого не здав",
    "nudge.content.assignment_no_submissions_d5.body": "Ви створили завдання в {org_name}, але робіт поки немає. Варто перевірити, чи воно опубліковане та чи мають учасники доступ до відповідного курсу.",
    "nudge.content.assignment_no_submissions_d5.cta": "Перевірити завдання",

    "nudge.audience.published_no_members_d1.subject": "«{course_name}» опубліковано, але там нікого немає",
    "nudge.audience.published_no_members_d1.heading": "Час когось запросити",
    "nudge.audience.published_no_members_d1.body": "«{course_name}» опубліковано й готово до читання. У {org_name} поки немає учасників, тож наступний крок — запросити тих, для кого ви його писали.",
    "nudge.audience.published_no_members_d1.cta": "Запросити учасників",

    "nudge.audience.published_no_members_d7.subject": "У «{course_name}» досі немає учасників",
    "nudge.audience.published_no_members_d7.heading": "Тиждень онлайн, ніхто не читає",
    "nudge.audience.published_no_members_d7.body": "«{course_name}» опубліковано тиждень тому, а в {org_name} досі немає учасників. Можна запрошувати по одному, вставити список або просто поділитися посиланням.",
    "nudge.audience.published_no_members_d7.cta": "Запросити людей",

    "nudge.audience.members_no_enrollment_d3.subject": "Ваші учасники ще не почали",
    "nudge.audience.members_no_enrollment_d3.heading": "Приєдналися, але нічого не відкрили",
    "nudge.audience.members_no_enrollment_d3.body": "Люди приєдналися до {org_name}, але ніхто не почав курс. Зазвичай достатньо короткого повідомлення з прямим посиланням — більшість просто не знайшли вхід.",
    "nudge.audience.members_no_enrollment_d3.cta": "Переглянути учасників",

    "nudge.audience.share_public_page_d14.subject": "Сторінка курсу публічна — ось посилання",
    "nudge.audience.share_public_page_d14.heading": "Прочитати може будь-хто за посиланням",
    "nudge.audience.share_public_page_d14.body": "«{course_name}» відкрито публічно, тож ділитися ним можна будь-де й без запрошень. Посилання нижче — саме те, яке варто надсилати.",
    "nudge.audience.share_public_page_d14.cta": "Відкрити публічну сторінку",

    "nudge.audience.stalled_learners_d14.subject": "Дехто з учасників спинився на середині",
    "nudge.audience.stalled_learners_d14.heading": "Кілька людей застрягли",
    "nudge.audience.stalled_learners_d14.body": "Дехто з учасників {org_name} почав курс і не повертався вже два тижні. Часто допомагає повідомлення від вас — або погляд на те, де саме вони спинилися.",
    "nudge.audience.stalled_learners_d14.cta": "Переглянути учасників",

    "nudge.monetization.course_limit_d1.subject": "Ви використали всі курси тарифу {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Досягнуто ліміт курсів",
    "nudge.monetization.course_limit_d1.body": "{org_name} на тарифі {plan_name} і використала всі включені курси. Перехід на {next_plan} знімає це обмеження, якщо хочете продовжувати.",
    "nudge.monetization.course_limit_d1.cta": "Переглянути тарифи",

    "nudge.monetization.member_limit_near.subject": "Ви близько до ліміту учасників на тарифі {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Майже досягнуто ліміт учасників",
    "nudge.monetization.member_limit_near.body": "{org_name} наближається до кількості учасників, яку дозволяє тариф {plan_name}. Перехід на {next_plan} піднімає її, щоб ніхто не спинився на пів дорозі до реєстрації.",
    "nudge.monetization.member_limit_near.cta": "Переглянути тарифи",

    "nudge.monetization.ai_credits_low.subject": "Кредити ШІ майже вичерпано",
    "nudge.monetization.ai_credits_low.heading": "Кредитів ШІ лишилося мало",
    "nudge.monetization.ai_credits_low.body": "{org_name} витратила більшу частину кредитів ШІ, включених у тариф {plan_name}. На тарифі {next_plan} їх більше — якщо ШІ став частиною того, як ви готуєте курси.",
    "nudge.monetization.ai_credits_low.cta": "Переглянути тарифи",

    "nudge.monetization.upgrade_recap_d21.subject": "Що {next_plan} дасть {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Ви побудували щось справжнє",
    "nudge.monetization.upgrade_recap_d21.body": "У {org_name} є опубліковані курси й люди, які їх читають. Тариф {next_plan} дає запас для зростання та кілька речей, яких немає в тарифі {plan_name}, — варто глянути, якщо плануєте розширюватися.",
    "nudge.monetization.upgrade_recap_d21.cta": "Порівняти тарифи",

    "nudge.dormancy.no_login_14d.subject": "У {org_name} було тихо",
    "nudge.dormancy.no_login_14d.heading": "Минуло два тижні",
    "nudge.dormancy.no_login_14d.body": "Від вашого останнього візиту в {org_name} нічого не змінилося. Якщо ви були в процесі, усе лежить саме там, де ви залишили.",
    "nudge.dormancy.no_login_14d.cta": "Відкрити панель",

    "nudge.dormancy.no_login_30d.subject": "Ваші курси в {org_name} нікуди не поділися",
    "nudge.dormancy.no_login_30d.heading": "Минуло кілька тижнів",
    "nudge.dormancy.no_login_30d.body": "Поки вас не було, нічого не змінилося — {org_name} і все в ній саме там, де ви залишили. Повернутися — це один клік.",
    "nudge.dormancy.no_login_30d.cta": "Відкрити панель",

    "nudge.dormancy.no_login_60d.subject": "Останнє повідомлення про {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Більше не турбуємо",
    "nudge.dormancy.no_login_60d.body": "{org_name} мовчить уже пару місяців, тож це останній такий лист. Усе, що ви побудували, лишається як є — на випадок, коли знадобиться.",
    "nudge.dormancy.no_login_60d.cta": "Відкрити панель",

    "nudge.dormancy.winback_q.subject": "Що нового від вашого останнього візиту в {org_name}",
    "nudge.dormancy.winback_q.heading": "Дещо змінилося",
    "nudge.dormancy.winback_q.body": "Ви давно не заходили в {org_name}. Продукт відтоді помітно просунувся, а все, що ви побудували, досі на місці.",
    "nudge.dormancy.winback_q.cta": "Подивитися",

    "nudge.milestone.first_course_published.subject": "«{course_name}» опубліковано",
    "nudge.milestone.first_course_published.heading": "Ви опублікували перший курс",
    "nudge.milestone.first_course_published.body": "«{course_name}» опубліковано, і його можна читати. Далі головне — щоб хтось його прочитав, нехай навіть одна-дві людини для початку.",
    "nudge.milestone.first_course_published.cta": "Запросити перших учасників",

    "nudge.milestone.first_learner_enrolled.subject": "Хтось почав «{course_name}»",
    "nudge.milestone.first_learner_enrolled.heading": "У вас перший учасник",
    "nudge.milestone.first_learner_enrolled.body": "Уперше хтось почав курс у {org_name}. Стежити за прогресом можна в панелі.",
    "nudge.milestone.first_learner_enrolled.cta": "Переглянути прогрес",

    "nudge.milestone.first_completion.subject": "Хтось пройшов курс у {org_name}",
    "nudge.milestone.first_completion.heading": "Перше завершення",
    "nudge.milestone.first_completion.body": "Учасник пройшов курс у {org_name} від початку до кінця. Щоб відзначити це як належить, можна додати сертифікат — або почати готувати наступний курс.",
    "nudge.milestone.first_completion.cta": "Відкрити панель",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Ваша академія в {org_name} нікуди не поділася",
    "nudge.reactivation.opener.heading": "Усе на місці, саме так, як ви залишили",
    "nudge.reactivation.opener.body": "Від вашого останнього візиту {org_name} ніхто не чіпав — кожен курс, розділ і урок там, де ви їх залишили. Повернутися — один клік.",
    "nudge.reactivation.opener.cta": "Відкрити панель",
    "nudge.reactivation.whats_changed.subject": "У LearnHouse дещо змінилося",
    "nudge.reactivation.whats_changed.heading": "Від вашого останнього візиту",
    "nudge.reactivation.whats_changed.body": "Поки {org_name} мовчала, продукт помітно просунувся: редактор, інструменти курсів і шлях слухача серйозно перероблено. Усе, що ви побудували, працює як і раніше.",
    "nudge.reactivation.whats_changed.cta": "Подивитися нове",
    "nudge.reactivation.need_a_hand.subject": "Потрібна допомога, щоб повернутися в {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "Щось завадило?",
    "nudge.reactivation.need_a_hand.body": "Якщо була причина, чому {org_name} спинилася — щось незрозуміле, чогось бракувало або просто не було часу — нам важливо про це знати. Відповідайте на цей лист, він надійде прямо до нас.",
    "nudge.reactivation.closing.subject": "Останній лист про {org_name}",
    "nudge.reactivation.closing.heading": "На цьому спинимося",
    "nudge.reactivation.closing.body": "Це останній такий лист. {org_name} лишається саме такою, як є, і нічого не згорає — захочете повернутися, усе чекатиме на вас.",
    "nudge.reactivation.closing.cta": "Відкрити панель",
}
