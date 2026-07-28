"""Arabic nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "إلغاء الاشتراك في هذه الرسائل",
    "nudge.common.footer": "تصلك هذه الرسالة لأنك مسؤول في {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "الدورات",
    "nudge.stat.chapters": "الفصول",
    "nudge.stat.lessons": "الدروس",
    "nudge.stat.members": "الأعضاء",
    "nudge.stat.learners": "المتعلمون",
    "nudge.stat.completed": "مكتملة",

    "nudge.activation.first_course_d1.subject": "دورتك الأولى في {org_name}",
    "nudge.activation.first_course_d1.heading": "متى ما كنت مستعدًا",
    "nudge.activation.first_course_d1.body": "{org_name} جاهزة وتنتظر دورتها الأولى. معظم الناس يبدؤون بشيء صغير: موضوع واحد وبضعة دروس. يمكنك التوسّع لاحقًا.",
    "nudge.activation.first_course_d1.cta": "أنشئ دورتك الأولى",

    "nudge.activation.come_back_d2.subject": "أكمل من حيث توقفت",
    "nudge.activation.come_back_d2.heading": "إعداداتك ما زالت في انتظارك",
    "nudge.activation.come_back_d2.body": "أنشأت {org_name} ولم تعد منذ ذلك الحين. كل شيء ما زال موجودًا، ونشر أول دورة يستغرق نحو عشر دقائق.",
    "nudge.activation.come_back_d2.cta": "اذهب إلى لوحة التحكم",

    "nudge.activation.ai_course_help_d4.subject": "الصفحة الفارغة هي الجزء الصعب",
    "nudge.activation.ai_course_help_d4.heading": "دع الذكاء الاصطناعي يكتب المخطط",
    "nudge.activation.ai_course_help_d4.body": "إن كانت {org_name} ما زالت فارغة لأنك لا تعرف من أين تبدأ، فاكتب موضوعك وسيصوغ الذكاء الاصطناعي الفصول والدروس. التحرير بعد ذلك لك.",
    "nudge.activation.ai_course_help_d4.cta": "أنشئ دورة بالذكاء الاصطناعي",

    "nudge.activation.import_existing_d5.subject": "أحضر ما لديك بالفعل",
    "nudge.activation.import_existing_d5.heading": "لا داعي للبدء من الصفر",
    "nudge.activation.import_existing_d5.body": "إن كانت موادك موجودة أصلًا كمستندات أو شرائح أو تصدير من منصة أخرى، يمكنك نقلها إلى {org_name} بدل إعادة كتابتها.",
    "nudge.activation.import_existing_d5.cta": "استورد موادك",

    "nudge.activation.setup_checklist_d7.subject": "خمس عشرة دقيقة إلى أكاديمية جاهزة",
    "nudge.activation.setup_checklist_d7.heading": "قائمة قصيرة",
    "nudge.activation.setup_checklist_d7.body": "{org_name} ما زالت تنتظر دورتها الأولى. قائمة الإعداد ترشدك عبر خطوات قصيرة، ومعظم الناس ينتهون خلال ربع ساعة.",
    "nudge.activation.setup_checklist_d7.cta": "افتح القائمة",

    "nudge.activation.whats_blocking_d14.subject": "ما الذي حال دون ذلك؟",
    "nudge.activation.whats_blocking_d14.heading": "هل لنا أن نسأل ما الذي أوقفك؟",
    "nudge.activation.whats_blocking_d14.body": "أنشأت {org_name} قبل أسبوعين ولم تضف دورة بعد. إن كان هناك ما أربكك أو نقص شيء، يهمّنا أن نعرف — يكفي أن ترد على هذه الرسالة، وستصلنا مباشرة.",

    "nudge.activation.last_call_d30.subject": "آخر رسالة بخصوص {org_name}",
    "nudge.activation.last_call_d30.heading": "هذه الأخيرة",
    "nudge.activation.last_call_d30.body": "{org_name} هادئة منذ شهر، لذا سنتوقف عن إرسال هذه الرسائل. حسابك وكل ما فيه يبقى كما هو — إن عدت، ستجد كل شيء في مكانه.",
    "nudge.activation.last_call_d30.cta": "افتح لوحة التحكم",

    "nudge.content.course_no_chapter_d1.subject": "«{course_name}» بحاجة إلى فصلها الأول",
    "nudge.content.course_no_chapter_d1.heading": "بقي فصل واحد",
    "nudge.content.course_no_chapter_d1.body": "«{course_name}» موجودة لكن بلا فصول بعد، فلا شيء يمكن فتحه. الفصول مجرد أقسام، وواحد لكل موضوع يعمل جيدًا.",
    "nudge.content.course_no_chapter_d1.cta": "أضف فصلًا",

    "nudge.content.chapter_no_activity_d1.subject": "أضف درسك الأول إلى «{course_name}»",
    "nudge.content.chapter_no_activity_d1.heading": "الفصول جاهزة",
    "nudge.content.chapter_no_activity_d1.body": "«{course_name}» فيها فصول لكنها ما زالت فارغة. الدرس قد يكون صفحة نص أو مقطع فيديو أو اختبارًا قصيرًا — ما يناسب الموضوع.",
    "nudge.content.chapter_no_activity_d1.cta": "أضف درسًا",

    "nudge.content.activity_unpublished_d2.subject": "دروسك في «{course_name}» غير ظاهرة بعد",
    "nudge.content.activity_unpublished_d2.heading": "الدروس ما زالت مخفية",
    "nudge.content.activity_unpublished_d2.body": "كتبت دروسًا في «{course_name}» لكن لم يُنشر أي منها، فيرى المتعلمون دورة فارغة. النشر لا يقفل شيئًا، ويمكنك مواصلة التعديل بعده.",
    "nudge.content.activity_unpublished_d2.cta": "انشر دروسك",

    "nudge.content.course_draft_d3.subject": "«{course_name}» ما زالت مسودة",
    "nudge.content.course_draft_d3.heading": "«{course_name}» شارفت على الاكتمال",
    "nudge.content.course_draft_d3.body": "أضفت دروسًا إلى «{course_name}» لكنها غير منشورة، فلا يستطيع أحد فتحها. لا يلزم أن تكون مكتملة — النشر يجعلها ظاهرة فقط، ويمكنك التعديل بعده.",
    "nudge.content.course_draft_d3.cta": "انشرها",

    "nudge.content.course_draft_d10.subject": "«{course_name}» مسودة منذ فترة",
    "nudge.content.course_draft_d10.heading": "على الأرجح جاهزة",
    "nudge.content.course_draft_d10.body": "«{course_name}» غير منشورة منذ أكثر من أسبوع. نادرًا ما تبدو الدورة مكتملة — النشر يجعلها ظاهرة، ويمكنك تحسينها بينما يقرأها الناس.",
    "nudge.content.course_draft_d10.cta": "انشرها",

    "nudge.content.thin_course_d5.subject": "«{course_name}» تحتمل المزيد",
    "nudge.content.thin_course_d5.heading": "درس أو درسان",
    "nudge.content.thin_course_d5.body": "«{course_name}» فيها درس أو درسان حتى الآن. الدورات تصل أفضل مع بضعة دروس، والذكاء الاصطناعي يستطيع صياغة التالية اعتمادًا على الموجود.",
    "nudge.content.thin_course_d5.cta": "أضف دروسًا أخرى",

    "nudge.content.assignment_no_submissions_d5.subject": "لا تسليمات بعد في {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "لم يسلّم أحد شيئًا",
    "nudge.content.assignment_no_submissions_d5.body": "أنشأت واجبًا في {org_name} لكن لم يُسلَّم شيء. يستحق الأمر التأكد من أنه منشور وأن المتعلمين يستطيعون الوصول إلى الدورة التابع لها.",
    "nudge.content.assignment_no_submissions_d5.cta": "راجع واجباتك",

    "nudge.audience.published_no_members_d1.subject": "«{course_name}» منشورة لكن لا أحد هناك",
    "nudge.audience.published_no_members_d1.heading": "حان وقت دعوة أحدهم",
    "nudge.audience.published_no_members_d1.body": "«{course_name}» منشورة وجاهزة للقراءة. {org_name} ليس فيها متعلمون بعد، فالخطوة التالية دعوة من كتبتها لأجلهم.",
    "nudge.audience.published_no_members_d1.cta": "ادعُ متعلمين",

    "nudge.audience.published_no_members_d7.subject": "«{course_name}» ما زالت بلا متعلمين",
    "nudge.audience.published_no_members_d7.heading": "أسبوع على النشر ولا أحد يقرأ",
    "nudge.audience.published_no_members_d7.body": "مضى أسبوع على نشر «{course_name}» و{org_name} ما زالت بلا متعلمين. يمكنك الدعوة فردًا فردًا، أو لصق قائمة، أو مشاركة رابط الانضمام فقط.",
    "nudge.audience.published_no_members_d7.cta": "ادعُ أشخاصًا",

    "nudge.audience.members_no_enrollment_d3.subject": "متعلموك لم يبدأوا بعد",
    "nudge.audience.members_no_enrollment_d3.heading": "انضموا لكنهم لم يفتحوا شيئًا",
    "nudge.audience.members_no_enrollment_d3.body": "انضم أشخاص إلى {org_name} لكن لم يبدأ أحد دورة. رسالة قصيرة مع رابط مباشر تكفي عادة — معظمهم ببساطة لم يجدوا المدخل.",
    "nudge.audience.members_no_enrollment_d3.cta": "اطّلع على الأعضاء",

    "nudge.audience.share_public_page_d14.subject": "صفحة دورتك عامة — هذا هو الرابط",
    "nudge.audience.share_public_page_d14.heading": "أي شخص لديه الرابط يستطيع القراءة",
    "nudge.audience.share_public_page_d14.body": "«{course_name}» عامة، فيمكنك مشاركتها في أي مكان دون حاجة أحد إلى دعوة. الرابط أدناه هو ما ترسله.",
    "nudge.audience.share_public_page_d14.cta": "اعرض الصفحة العامة",

    "nudge.audience.stalled_learners_d14.subject": "بعض المتعلمين توقفوا في المنتصف",
    "nudge.audience.stalled_learners_d14.heading": "بضعة أشخاص تعثّروا",
    "nudge.audience.stalled_learners_d14.body": "بعض المتعلمين في {org_name} بدأوا دورة ولم يعودوا منذ أسبوعين. غالبًا ما تنفع رسالة منك، أو نظرة على الموضع الذي توقفوا عنده.",
    "nudge.audience.stalled_learners_d14.cta": "تفقّد متعلميك",

    "nudge.monetization.course_limit_d1.subject": "استخدمت كل الدورات في خطة {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "بلغت حد الدورات",
    "nudge.monetization.course_limit_d1.body": "{org_name} على خطة {plan_name} واستهلكت كل الدورات المتاحة فيها. الانتقال إلى {next_plan} يرفع هذا الحد إن أردت المواصلة.",
    "nudge.monetization.course_limit_d1.cta": "اطّلع على الخطط",

    "nudge.monetization.member_limit_near.subject": "أنت قريب من حد الأعضاء في خطة {plan_name}",
    "nudge.monetization.member_limit_near.heading": "اقتربت من حد الأعضاء",
    "nudge.monetization.member_limit_near.body": "{org_name} تقترب من عدد الأعضاء الذي تسمح به خطة {plan_name}. الانتقال إلى {next_plan} يرفعه، فلا يُمنع أحد في منتصف التسجيل.",
    "nudge.monetization.member_limit_near.cta": "اطّلع على الخطط",

    "nudge.monetization.ai_credits_low.subject": "أرصدة الذكاء الاصطناعي شارفت على الانتهاء",
    "nudge.monetization.ai_credits_low.heading": "تبقّى القليل من أرصدة الذكاء الاصطناعي",
    "nudge.monetization.ai_credits_low.body": "استهلكت {org_name} معظم أرصدة الذكاء الاصطناعي المتضمنة في خطة {plan_name}. خطة {next_plan} تتضمن المزيد، إن صار الذكاء الاصطناعي جزءًا من طريقتك في بناء الدورات.",
    "nudge.monetization.ai_credits_low.cta": "اطّلع على الخطط",

    "nudge.monetization.upgrade_recap_d21.subject": "ما ستضيفه {next_plan} إلى {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "بنيت شيئًا حقيقيًا",
    "nudge.monetization.upgrade_recap_d21.body": "لدى {org_name} دورات منشورة وأشخاص يقرؤونها. خطة {next_plan} تمنح مساحة للنمو وأشياء لا تتضمنها خطة {plan_name} — تستحق النظر إن كنت تنوي التوسّع.",
    "nudge.monetization.upgrade_recap_d21.cta": "قارن الخطط",

    "nudge.dormancy.no_login_14d.subject": "{org_name} كانت هادئة",
    "nudge.dormancy.no_login_14d.heading": "مضى أسبوعان",
    "nudge.dormancy.no_login_14d.body": "لم يتغير شيء في {org_name} منذ زيارتك الأخيرة. إن كنت في منتصف عمل ما، فهو تمامًا حيث تركته.",
    "nudge.dormancy.no_login_14d.cta": "افتح لوحة التحكم",

    "nudge.dormancy.no_login_30d.subject": "دوراتك في {org_name} ما زالت هنا",
    "nudge.dormancy.no_login_30d.heading": "مضت بضعة أسابيع",
    "nudge.dormancy.no_login_30d.body": "لم يتغير شيء أثناء غيابك — {org_name} وكل ما فيها تمامًا حيث تركته. العودة تحتاج نقرة واحدة.",
    "nudge.dormancy.no_login_30d.cta": "افتح لوحة التحكم",

    "nudge.dormancy.no_login_60d.subject": "آخر تواصل بخصوص {org_name}",
    "nudge.dormancy.no_login_60d.heading": "سنتركك وشأنك",
    "nudge.dormancy.no_login_60d.body": "{org_name} هادئة منذ شهرين، لذا هذه آخر رسالة من هذا النوع في الوقت الحالي. كل ما بنيته يبقى كما هو، متى ما احتجته.",
    "nudge.dormancy.no_login_60d.cta": "افتح لوحة التحكم",

    "nudge.dormancy.winback_q.subject": "ما الجديد منذ آخر زيارة لك إلى {org_name}",
    "nudge.dormancy.winback_q.heading": "تغيّرت بعض الأمور",
    "nudge.dormancy.winback_q.body": "مضى وقت منذ آخر مرة دخلت فيها {org_name}. تطوّر المنتج كثيرًا منذ ذلك الحين، وكل ما بنيته ما زال موجودًا.",
    "nudge.dormancy.winback_q.cta": "ألقِ نظرة",

    "nudge.milestone.first_course_published.subject": "«{course_name}» أصبحت منشورة",
    "nudge.milestone.first_course_published.heading": "نشرت دورتك الأولى",
    "nudge.milestone.first_course_published.body": "«{course_name}» منشورة وقابلة للقراءة. ما يصنع الفارق الآن هو وجود من يقرؤها — ولو شخص أو اثنان في البداية.",
    "nudge.milestone.first_course_published.cta": "ادعُ أول متعلمين لديك",

    "nudge.milestone.first_learner_enrolled.subject": "أحدهم بدأ «{course_name}»",
    "nudge.milestone.first_learner_enrolled.heading": "وصل أول متعلم لديك",
    "nudge.milestone.first_learner_enrolled.body": "بدأ أحدهم دورة في {org_name} لأول مرة. يمكنك متابعة تقدمه من لوحة التحكم.",
    "nudge.milestone.first_learner_enrolled.cta": "اعرض تقدّمه",

    "nudge.milestone.first_completion.subject": "أحدهم أنهى دورة في {org_name}",
    "nudge.milestone.first_completion.heading": "أول إتمام",
    "nudge.milestone.first_completion.body": "أنهى متعلم دورة في {org_name} من أولها إلى آخرها. إن أردت توثيق ذلك، يمكنك إضافة شهادة — أو البدء ببناء ما يليها.",
    "nudge.milestone.first_completion.cta": "افتح لوحة التحكم",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "أكاديميتك على {org_name} ما زالت هنا",
    "nudge.reactivation.opener.heading": "ما زالت هنا، تمامًا كما تركتها",
    "nudge.reactivation.opener.body": "لم يمسّ أحد {org_name} منذ زيارتك الأخيرة — كل دورة وفصل ودرس في مكانه. للعودة يكفي نقرة واحدة.",
    "nudge.reactivation.opener.cta": "افتح لوحة التحكم",
    "nudge.reactivation.whats_changed.subject": "تغيّرت بعض الأمور في LearnHouse",
    "nudge.reactivation.whats_changed.heading": "منذ آخر زيارة لك",
    "nudge.reactivation.whats_changed.body": "تطوّر المنتج كثيرًا بينما كانت {org_name} هادئة: المحرّر وأدوات الدورات ومسار المتعلمين نالت جميعها عملًا حقيقيًا. كل ما بنيته يعمل كما كان.",
    "nudge.reactivation.whats_changed.cta": "اطّلع على الجديد",
    "nudge.reactivation.need_a_hand.subject": "هل تحتاج مساعدة للعودة إلى {org_name}؟",
    "nudge.reactivation.need_a_hand.heading": "هل اعترض شيء طريقك؟",
    "nudge.reactivation.need_a_hand.body": "إن كان هناك سبب لتوقّف {org_name} — شيء مربك أو ناقص أو ببساطة ضيق الوقت — فنحن نودّ سماعه. ردّ على هذه الرسالة وستصلنا مباشرة.",
    "nudge.reactivation.closing.subject": "آخر رسالة بخصوص {org_name}",
    "nudge.reactivation.closing.heading": "سنتوقف هنا",
    "nudge.reactivation.closing.body": "هذه آخر رسالة من هذا النوع. تبقى {org_name} كما هي ولا ينتهي شيء — إن أردت العودة يومًا، سيكون كل شيء في انتظارك.",
    "nudge.reactivation.closing.cta": "افتح لوحة التحكم",
}
