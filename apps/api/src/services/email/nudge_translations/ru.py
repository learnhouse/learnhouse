"""Russian nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Отписаться от этих писем",
    "nudge.common.footer": "Вы получили это письмо, так как являетесь администратором {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Курсы",
    "nudge.stat.chapters": "Главы",
    "nudge.stat.lessons": "Уроки",
    "nudge.stat.members": "Участники",
    "nudge.stat.learners": "Учащиеся",
    "nudge.stat.completed": "Завершено",

    "nudge.activation.first_course_d1.subject": "Ваш первый курс в {org_name}",
    "nudge.activation.first_course_d1.heading": "Когда будет удобно",
    "nudge.activation.first_course_d1.body": "{org_name} готова и ждёт первый курс. Большинство начинает с малого: одна тема, несколько уроков. Дополнить можно в любой момент.",
    "nudge.activation.first_course_d1.cta": "Создать первый курс",

    "nudge.activation.come_back_d2.subject": "Продолжить с того места, где остановились",
    "nudge.activation.come_back_d2.heading": "Всё настроенное вас ждёт",
    "nudge.activation.come_back_d2.body": "Вы создали {org_name} и с тех пор не возвращались. Всё на месте, а на публикацию первого курса уходит около десяти минут.",
    "nudge.activation.come_back_d2.cta": "Перейти в панель",

    "nudge.activation.ai_course_help_d4.subject": "Самое сложное — чистый лист",
    "nudge.activation.ai_course_help_d4.heading": "Пусть ИИ напишет план",
    "nudge.activation.ai_course_help_d4.body": "Если {org_name} всё ещё пуста, потому что непонятно, с чего начать, — опишите тему, и ИИ подготовит главы и уроки. Дальше правите вы.",
    "nudge.activation.ai_course_help_d4.cta": "Создать курс с ИИ",

    "nudge.activation.import_existing_d5.subject": "Перенесите то, что уже есть",
    "nudge.activation.import_existing_d5.heading": "Не обязательно начинать с нуля",
    "nudge.activation.import_existing_d5.body": "Если материалы уже существуют в виде документов, презентаций или выгрузки с другой платформы, их можно перенести в {org_name}, а не набирать заново.",
    "nudge.activation.import_existing_d5.cta": "Импортировать материалы",

    "nudge.activation.setup_checklist_d7.subject": "Пятнадцать минут до работающей академии",
    "nudge.activation.setup_checklist_d7.heading": "Короткий чек-лист",
    "nudge.activation.setup_checklist_d7.body": "{org_name} всё ещё ждёт первый курс. Чек-лист проведёт вас за несколько шагов — большинство укладывается в четверть часа.",
    "nudge.activation.setup_checklist_d7.cta": "Открыть чек-лист",

    "nudge.activation.whats_blocking_d14.subject": "Что помешало?",
    "nudge.activation.whats_blocking_d14.heading": "Можно спросить, что вас остановило?",
    "nudge.activation.whats_blocking_d14.body": "Вы создали {org_name} пару недель назад и пока не добавили курс. Если что-то было непонятно или чего-то не хватило, нам важно об этом знать — просто ответьте на это письмо, оно придёт напрямую к нам.",

    "nudge.activation.last_call_d30.subject": "Последнее письмо про {org_name}",
    "nudge.activation.last_call_d30.heading": "Это последнее",
    "nudge.activation.last_call_d30.body": "{org_name} молчит уже месяц, поэтому мы перестаём отправлять такие письма. Аккаунт и всё его содержимое остаются на месте — вернётесь, и всё будет там, где вы оставили.",
    "nudge.activation.last_call_d30.cta": "Открыть панель",

    "nudge.content.course_no_chapter_d1.subject": "Курсу «{course_name}» нужна первая глава",
    "nudge.content.course_no_chapter_d1.heading": "Осталась одна глава",
    "nudge.content.course_no_chapter_d1.body": "Курс «{course_name}» создан, но глав в нём пока нет, поэтому открывать нечего. Главы — это просто разделы, по одной на тему работает хорошо.",
    "nudge.content.course_no_chapter_d1.cta": "Добавить главу",

    "nudge.content.chapter_no_activity_d1.subject": "Добавьте первый урок в «{course_name}»",
    "nudge.content.chapter_no_activity_d1.heading": "Главы готовы",
    "nudge.content.chapter_no_activity_d1.body": "В курсе «{course_name}» есть главы, но они пока пустые. Урок может быть страницей текста, видео, тестом — тем, что подходит теме.",
    "nudge.content.chapter_no_activity_d1.cta": "Добавить урок",

    "nudge.content.activity_unpublished_d2.subject": "Ваши уроки в «{course_name}» пока не видны",
    "nudge.content.activity_unpublished_d2.heading": "Уроки всё ещё скрыты",
    "nudge.content.activity_unpublished_d2.body": "Вы написали уроки в курсе «{course_name}», но ни один не опубликован, поэтому участники видят пустой курс. Публикация ничего не фиксирует — редактировать можно и дальше.",
    "nudge.content.activity_unpublished_d2.cta": "Опубликовать уроки",

    "nudge.content.course_draft_d3.subject": "«{course_name}» всё ещё черновик",
    "nudge.content.course_draft_d3.heading": "«{course_name}» почти готов",
    "nudge.content.course_draft_d3.body": "Вы добавили уроки в «{course_name}», но курс не опубликован, поэтому его никто не откроет. Ему не обязательно быть завершённым — публикация лишь делает его видимым, редактировать можно и после.",
    "nudge.content.course_draft_d3.cta": "Опубликовать",

    "nudge.content.course_draft_d10.subject": "«{course_name}» уже давно в черновиках",
    "nudge.content.course_draft_d10.heading": "Скорее всего, он готов",
    "nudge.content.course_draft_d10.body": "«{course_name}» лежит неопубликованным больше недели. Курс редко кажется законченным — публикация делает его видимым, а улучшать можно и когда его уже читают.",
    "nudge.content.course_draft_d10.cta": "Опубликовать",

    "nudge.content.thin_course_d5.subject": "«{course_name}» не помешает дополнить",
    "nudge.content.thin_course_d5.heading": "Один-два урока",
    "nudge.content.thin_course_d5.body": "В курсе «{course_name}» пока один-два урока. Курсы обычно воспринимаются лучше, когда их несколько, и ИИ может подготовить следующие на основе уже написанного.",
    "nudge.content.thin_course_d5.cta": "Добавить уроки",

    "nudge.content.assignment_no_submissions_d5.subject": "В {org_name} пока нет ни одной работы",
    "nudge.content.assignment_no_submissions_d5.heading": "Никто ничего не сдал",
    "nudge.content.assignment_no_submissions_d5.body": "Вы создали задание в {org_name}, но работ пока нет. Стоит проверить, опубликовано ли оно и есть ли у участников доступ к соответствующему курсу.",
    "nudge.content.assignment_no_submissions_d5.cta": "Проверить задания",

    "nudge.audience.published_no_members_d1.subject": "«{course_name}» опубликован, но там никого нет",
    "nudge.audience.published_no_members_d1.heading": "Пора кого-нибудь пригласить",
    "nudge.audience.published_no_members_d1.body": "«{course_name}» опубликован и готов к чтению. В {org_name} пока нет участников, поэтому следующий шаг — пригласить тех, для кого вы его писали.",
    "nudge.audience.published_no_members_d1.cta": "Пригласить участников",

    "nudge.audience.published_no_members_d7.subject": "У «{course_name}» до сих пор нет участников",
    "nudge.audience.published_no_members_d7.heading": "Неделя онлайн, никто не читает",
    "nudge.audience.published_no_members_d7.body": "«{course_name}» опубликован неделю назад, а в {org_name} по-прежнему нет участников. Можно приглашать по одному, вставить список или просто поделиться ссылкой.",
    "nudge.audience.published_no_members_d7.cta": "Пригласить людей",

    "nudge.audience.members_no_enrollment_d3.subject": "Ваши участники ещё не начали",
    "nudge.audience.members_no_enrollment_d3.heading": "Присоединились, но ничего не открыли",
    "nudge.audience.members_no_enrollment_d3.body": "Люди присоединились к {org_name}, но никто не начал курс. Обычно достаточно короткого сообщения с прямой ссылкой — большинство просто не нашли вход.",
    "nudge.audience.members_no_enrollment_d3.cta": "Посмотреть участников",

    "nudge.audience.share_public_page_d14.subject": "Страница курса публичная — вот ссылка",
    "nudge.audience.share_public_page_d14.heading": "Прочитать может любой по ссылке",
    "nudge.audience.share_public_page_d14.body": "«{course_name}» открыт публично, так что делиться им можно где угодно и без приглашений. Ссылка ниже — та самая, которую стоит отправлять.",
    "nudge.audience.share_public_page_d14.cta": "Открыть публичную страницу",

    "nudge.audience.stalled_learners_d14.subject": "Некоторые участники остановились на середине",
    "nudge.audience.stalled_learners_d14.heading": "Несколько человек застряли",
    "nudge.audience.stalled_learners_d14.body": "Некоторые участники {org_name} начали курс и не возвращались уже пару недель. Часто помогает сообщение от вас — или взгляд на то, где именно они остановились.",
    "nudge.audience.stalled_learners_d14.cta": "Посмотреть участников",

    "nudge.monetization.course_limit_d1.subject": "Вы использовали все курсы тарифа {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Достигнут лимит курсов",
    "nudge.monetization.course_limit_d1.body": "{org_name} на тарифе {plan_name} и использовала все включённые в него курсы. Переход на {next_plan} снимает это ограничение, если хотите продолжать.",
    "nudge.monetization.course_limit_d1.cta": "Посмотреть тарифы",

    "nudge.monetization.member_limit_near.subject": "Вы близко к лимиту участников на тарифе {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Почти достигнут лимит участников",
    "nudge.monetization.member_limit_near.body": "{org_name} приближается к числу участников, которое допускает тариф {plan_name}. Переход на {next_plan} поднимает его, чтобы никто не остановился на полпути к регистрации.",
    "nudge.monetization.member_limit_near.cta": "Посмотреть тарифы",

    "nudge.monetization.ai_credits_low.subject": "Кредиты ИИ почти закончились",
    "nudge.monetization.ai_credits_low.heading": "Кредитов ИИ осталось мало",
    "nudge.monetization.ai_credits_low.body": "{org_name} израсходовала большую часть кредитов ИИ, включённых в тариф {plan_name}. На тарифе {next_plan} их больше — если ИИ стал частью того, как вы готовите курсы.",
    "nudge.monetization.ai_credits_low.cta": "Посмотреть тарифы",

    "nudge.monetization.upgrade_recap_d21.subject": "Что {next_plan} даст {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Вы построили что-то настоящее",
    "nudge.monetization.upgrade_recap_d21.body": "В {org_name} есть опубликованные курсы и люди, которые их читают. Тариф {next_plan} даёт запас для роста и несколько вещей, которых нет в тарифе {plan_name}, — стоит взглянуть, если планируете расширяться.",
    "nudge.monetization.upgrade_recap_d21.cta": "Сравнить тарифы",

    "nudge.dormancy.no_login_14d.subject": "В {org_name} было тихо",
    "nudge.dormancy.no_login_14d.heading": "Прошло пару недель",
    "nudge.dormancy.no_login_14d.body": "С вашего последнего визита в {org_name} ничего не изменилось. Если вы были в процессе, всё лежит ровно там, где вы оставили.",
    "nudge.dormancy.no_login_14d.cta": "Открыть панель",

    "nudge.dormancy.no_login_30d.subject": "Ваши курсы в {org_name} никуда не делись",
    "nudge.dormancy.no_login_30d.heading": "Прошло несколько недель",
    "nudge.dormancy.no_login_30d.body": "Пока вас не было, ничего не изменилось — {org_name} и всё в ней ровно там, где вы оставили. Вернуться — это один клик.",
    "nudge.dormancy.no_login_30d.cta": "Открыть панель",

    "nudge.dormancy.no_login_60d.subject": "Последнее сообщение про {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Больше не беспокоим",
    "nudge.dormancy.no_login_60d.body": "{org_name} молчит уже пару месяцев, так что это последнее такое письмо. Всё, что вы построили, остаётся как есть — на случай, когда понадобится.",
    "nudge.dormancy.no_login_60d.cta": "Открыть панель",

    "nudge.dormancy.winback_q.subject": "Что нового с вашего последнего визита в {org_name}",
    "nudge.dormancy.winback_q.heading": "Кое-что изменилось",
    "nudge.dormancy.winback_q.body": "Вы давно не заходили в {org_name}. Продукт с тех пор заметно продвинулся, а всё, что вы построили, по-прежнему на месте.",
    "nudge.dormancy.winback_q.cta": "Посмотреть",

    "nudge.milestone.first_course_published.subject": "«{course_name}» опубликован",
    "nudge.milestone.first_course_published.heading": "Вы опубликовали первый курс",
    "nudge.milestone.first_course_published.body": "«{course_name}» опубликован, и его можно читать. Дальше главное — чтобы кто-то его прочитал, пусть даже один-два человека для начала.",
    "nudge.milestone.first_course_published.cta": "Пригласить первых участников",

    "nudge.milestone.first_learner_enrolled.subject": "Кто-то начал «{course_name}»",
    "nudge.milestone.first_learner_enrolled.heading": "У вас первый участник",
    "nudge.milestone.first_learner_enrolled.body": "Впервые кто-то начал курс в {org_name}. Следить за прогрессом можно в панели.",
    "nudge.milestone.first_learner_enrolled.cta": "Посмотреть прогресс",

    "nudge.milestone.first_completion.subject": "Кто-то прошёл курс в {org_name}",
    "nudge.milestone.first_completion.heading": "Первое завершение",
    "nudge.milestone.first_completion.body": "Участник прошёл курс в {org_name} от начала до конца. Чтобы отметить это как следует, можно добавить сертификат — или начать готовить следующий курс.",
    "nudge.milestone.first_completion.cta": "Открыть панель",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Ваша академия в {org_name} никуда не делась",
    "nudge.reactivation.opener.heading": "Всё на месте, ровно как вы оставили",
    "nudge.reactivation.opener.body": "С вашего последнего визита {org_name} никто не трогал — каждый курс, раздел и урок там, где вы их оставили. Вернуться — один клик.",
    "nudge.reactivation.opener.cta": "Открыть панель",
    "nudge.reactivation.whats_changed.subject": "В LearnHouse кое-что изменилось",
    "nudge.reactivation.whats_changed.heading": "С вашего последнего визита",
    "nudge.reactivation.whats_changed.body": "Пока {org_name} молчала, продукт заметно продвинулся: редактор, инструменты курсов и путь учащегося серьёзно переработаны. Всё, что вы построили, работает как прежде.",
    "nudge.reactivation.whats_changed.cta": "Посмотреть новое",
    "nudge.reactivation.need_a_hand.subject": "Нужна помощь, чтобы вернуться в {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "Что-то помешало?",
    "nudge.reactivation.need_a_hand.body": "Если была причина, по которой {org_name} остановилась — что-то непонятное, чего-то не хватило или просто не было времени — нам важно об этом знать. Ответьте на это письмо, оно придёт напрямую к нам.",
    "nudge.reactivation.closing.subject": "Последнее письмо про {org_name}",
    "nudge.reactivation.closing.heading": "На этом остановимся",
    "nudge.reactivation.closing.body": "Это последнее такое письмо. {org_name} остаётся ровно как есть, и ничего не сгорает — захотите вернуться, всё будет ждать вас.",
    "nudge.reactivation.closing.cta": "Открыть панель",
}
