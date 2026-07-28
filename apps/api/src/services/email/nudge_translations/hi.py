"""Hindi nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "इन ईमेल की सदस्यता समाप्त करें",
    "nudge.common.footer": "आपको यह ईमेल इसलिए मिला है क्योंकि आप {org_name} के व्यवस्थापक हैं।",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "कोर्स",
    "nudge.stat.chapters": "अध्याय",
    "nudge.stat.lessons": "पाठ",
    "nudge.stat.members": "सदस्य",
    "nudge.stat.learners": "शिक्षार्थी",
    "nudge.stat.completed": "पूर्ण",

    "nudge.activation.first_course_d1.subject": "{org_name} पर आपका पहला कोर्स",
    "nudge.activation.first_course_d1.heading": "जब आप तैयार हों",
    "nudge.activation.first_course_d1.body": "{org_name} तैयार है और अपने पहले कोर्स का इंतज़ार कर रही है। ज़्यादातर लोग छोटे से शुरू करते हैं: एक विषय, कुछ पाठ। आगे जोड़ते रहना हमेशा संभव है।",
    "nudge.activation.first_course_d1.cta": "अपना पहला कोर्स बनाएँ",

    "nudge.activation.come_back_d2.subject": "जहाँ छोड़ा था, वहीं से आगे",
    "nudge.activation.come_back_d2.heading": "आपका सेटअप अब भी तैयार है",
    "nudge.activation.come_back_d2.body": "आपने {org_name} बनाई और उसके बाद लौटे नहीं। सब कुछ वैसा ही है, और पहला कोर्स प्रकाशित करने में लगभग दस मिनट लगते हैं।",
    "nudge.activation.come_back_d2.cta": "डैशबोर्ड पर जाएँ",

    "nudge.activation.ai_course_help_d4.subject": "खाली पन्ना ही सबसे मुश्किल है",
    "nudge.activation.ai_course_help_d4.heading": "रूपरेखा AI को लिखने दें",
    "nudge.activation.ai_course_help_d4.body": "अगर {org_name} अब भी खाली है क्योंकि शुरुआत कहाँ से करें यह तय नहीं हो रहा, तो बस विषय बताइए और AI अध्याय और पाठ का मसौदा बना देगा। संपादन आपका।",
    "nudge.activation.ai_course_help_d4.cta": "AI से कोर्स बनाएँ",

    "nudge.activation.import_existing_d5.subject": "जो पहले से है, उसे ले आइए",
    "nudge.activation.import_existing_d5.heading": "शून्य से शुरू करना ज़रूरी नहीं",
    "nudge.activation.import_existing_d5.body": "अगर आपकी सामग्री पहले से दस्तावेज़, स्लाइड या किसी और प्लेटफ़ॉर्म के निर्यात के रूप में मौजूद है, तो उसे दोबारा टाइप करने के बजाय {org_name} में ला सकते हैं।",
    "nudge.activation.import_existing_d5.cta": "अपनी सामग्री आयात करें",

    "nudge.activation.setup_checklist_d7.subject": "पंद्रह मिनट में चलती-फिरती अकादमी",
    "nudge.activation.setup_checklist_d7.heading": "एक छोटी सूची",
    "nudge.activation.setup_checklist_d7.body": "{org_name} अब भी पहले कोर्स का इंतज़ार कर रही है। सेटअप सूची कुछ छोटे चरणों में रास्ता दिखाती है — ज़्यादातर लोग पंद्रह मिनट में पूरा कर लेते हैं।",
    "nudge.activation.setup_checklist_d7.cta": "सूची खोलें",

    "nudge.activation.whats_blocking_d14.subject": "बीच में क्या आ गया?",
    "nudge.activation.whats_blocking_d14.heading": "पूछ सकते हैं कि किस वजह से रुक गए?",
    "nudge.activation.whats_blocking_d14.body": "आपने {org_name} दो हफ़्ते पहले बनाई थी और अब तक कोई कोर्स नहीं जोड़ा। अगर कुछ उलझन भरा था या कुछ कमी रह गई, तो हम जानना चाहेंगे — इस ईमेल का जवाब दीजिए, वह सीधे हम तक पहुँचता है।",

    "nudge.activation.last_call_d30.subject": "{org_name} के बारे में आखिरी ईमेल",
    "nudge.activation.last_call_d30.heading": "यह आखिरी है",
    "nudge.activation.last_call_d30.body": "{org_name} एक महीने से शांत है, इसलिए हम ये ईमेल भेजना बंद कर रहे हैं। आपका खाता और उसमें सब कुछ वैसा ही रहेगा — लौटेंगे तो सब जहाँ छोड़ा था वहीं मिलेगा।",
    "nudge.activation.last_call_d30.cta": "अपना डैशबोर्ड खोलें",

    "nudge.content.course_no_chapter_d1.subject": "«{course_name}» को पहला अध्याय चाहिए",
    "nudge.content.course_no_chapter_d1.heading": "बस एक अध्याय बाकी",
    "nudge.content.course_no_chapter_d1.body": "«{course_name}» बन चुका है पर अभी कोई अध्याय नहीं है, इसलिए खोलने को कुछ नहीं। अध्याय बस खंड होते हैं — एक विषय पर एक अच्छा रहता है।",
    "nudge.content.course_no_chapter_d1.cta": "अध्याय जोड़ें",

    "nudge.content.chapter_no_activity_d1.subject": "«{course_name}» में पहला पाठ जोड़ें",
    "nudge.content.chapter_no_activity_d1.heading": "अध्याय तैयार हैं",
    "nudge.content.chapter_no_activity_d1.body": "«{course_name}» में अध्याय हैं, पर वे अभी खाली हैं। पाठ एक पन्ना लेख, वीडियो या क्विज़ हो सकता है — जो विषय के अनुकूल हो।",
    "nudge.content.chapter_no_activity_d1.cta": "पाठ जोड़ें",

    "nudge.content.activity_unpublished_d2.subject": "«{course_name}» के आपके पाठ अभी दिख नहीं रहे",
    "nudge.content.activity_unpublished_d2.heading": "पाठ अब भी छिपे हैं",
    "nudge.content.activity_unpublished_d2.body": "आपने «{course_name}» में पाठ लिखे हैं, पर कोई प्रकाशित नहीं है, इसलिए सीखने वालों को खाली कोर्स दिखता है। प्रकाशित करने से कुछ लॉक नहीं होता — बाद में भी संपादन कर सकते हैं।",
    "nudge.content.activity_unpublished_d2.cta": "अपने पाठ प्रकाशित करें",

    "nudge.content.course_draft_d3.subject": "«{course_name}» अब भी ड्राफ़्ट है",
    "nudge.content.course_draft_d3.heading": "«{course_name}» लगभग तैयार है",
    "nudge.content.course_draft_d3.body": "आपने «{course_name}» में पाठ जोड़े हैं, पर वह प्रकाशित नहीं है, इसलिए कोई खोल नहीं सकता। पूरा होना ज़रूरी नहीं — प्रकाशित करना बस उसे दृश्य बनाता है, और उसके बाद भी संपादन चलता रहता है।",
    "nudge.content.course_draft_d3.cta": "प्रकाशित करें",

    "nudge.content.course_draft_d10.subject": "«{course_name}» काफ़ी समय से ड्राफ़्ट है",
    "nudge.content.course_draft_d10.heading": "शायद यह तैयार है",
    "nudge.content.course_draft_d10.body": "«{course_name}» एक हफ़्ते से ज़्यादा से अप्रकाशित पड़ा है। कोर्स शायद ही कभी पूरा लगता है — प्रकाशित करने से वह दिखने लगता है, और पढ़ने वालों के रहते भी आप उसे बेहतर करते रह सकते हैं।",
    "nudge.content.course_draft_d10.cta": "प्रकाशित करें",

    "nudge.content.thin_course_d5.subject": "«{course_name}» में थोड़ा और जोड़ा जा सकता है",
    "nudge.content.thin_course_d5.heading": "एक-दो पाठ",
    "nudge.content.thin_course_d5.body": "«{course_name}» में अभी एक-दो पाठ हैं। कुछ और पाठों के साथ कोर्स बेहतर बैठते हैं, और AI मौजूदा सामग्री से अगले पाठों का मसौदा बना सकता है।",
    "nudge.content.thin_course_d5.cta": "और पाठ जोड़ें",

    "nudge.content.assignment_no_submissions_d5.subject": "{org_name} में अभी कोई जमा नहीं हुआ",
    "nudge.content.assignment_no_submissions_d5.heading": "किसी ने कुछ जमा नहीं किया",
    "nudge.content.assignment_no_submissions_d5.body": "आपने {org_name} में असाइनमेंट बनाया था, पर कुछ जमा नहीं हुआ। देख लीजिए कि वह प्रकाशित है या नहीं और सीखने वाले संबंधित कोर्स तक पहुँच पा रहे हैं या नहीं।",
    "nudge.content.assignment_no_submissions_d5.cta": "अपने असाइनमेंट देखें",

    "nudge.audience.published_no_members_d1.subject": "«{course_name}» प्रकाशित है, पर वहाँ कोई नहीं",
    "nudge.audience.published_no_members_d1.heading": "किसी को बुलाने का समय",
    "nudge.audience.published_no_members_d1.body": "«{course_name}» प्रकाशित है और पढ़ने के लिए तैयार। {org_name} में अभी कोई सीखने वाला नहीं है, इसलिए अगला कदम है उन लोगों को बुलाना जिनके लिए आपने इसे लिखा।",
    "nudge.audience.published_no_members_d1.cta": "सीखने वालों को आमंत्रित करें",

    "nudge.audience.published_no_members_d7.subject": "«{course_name}» में अब भी कोई सीखने वाला नहीं",
    "nudge.audience.published_no_members_d7.heading": "एक हफ़्ता हो गया, कोई पढ़ नहीं रहा",
    "nudge.audience.published_no_members_d7.body": "«{course_name}» को प्रकाशित हुए एक हफ़्ता हो गया और {org_name} में अब भी कोई सीखने वाला नहीं है। एक-एक करके बुला सकते हैं, सूची चिपका सकते हैं, या बस जुड़ने का लिंक साझा कर सकते हैं।",
    "nudge.audience.published_no_members_d7.cta": "लोगों को आमंत्रित करें",

    "nudge.audience.members_no_enrollment_d3.subject": "आपके सीखने वालों ने अभी शुरुआत नहीं की",
    "nudge.audience.members_no_enrollment_d3.heading": "जुड़ गए, पर कुछ खोला नहीं",
    "nudge.audience.members_no_enrollment_d3.body": "लोग {org_name} से जुड़े हैं, पर किसी ने कोर्स शुरू नहीं किया। सीधे लिंक के साथ एक छोटा संदेश आम तौर पर काम कर जाता है — ज़्यादातर को बस रास्ता नहीं मिला।",
    "nudge.audience.members_no_enrollment_d3.cta": "अपने सदस्य देखें",

    "nudge.audience.share_public_page_d14.subject": "आपका कोर्स पेज सार्वजनिक है — लिंक यह रहा",
    "nudge.audience.share_public_page_d14.heading": "लिंक वाला कोई भी पढ़ सकता है",
    "nudge.audience.share_public_page_d14.body": "«{course_name}» सार्वजनिक है, इसलिए आप उसे कहीं भी साझा कर सकते हैं और किसी को आमंत्रण की ज़रूरत नहीं। नीचे दिया लिंक वही है जो भेजना है।",
    "nudge.audience.share_public_page_d14.cta": "सार्वजनिक पेज देखें",

    "nudge.audience.stalled_learners_d14.subject": "कुछ सीखने वाले बीच में रुक गए",
    "nudge.audience.stalled_learners_d14.heading": "कुछ लोग अटक गए हैं",
    "nudge.audience.stalled_learners_d14.body": "{org_name} के कुछ सीखने वालों ने कोर्स शुरू किया था और दो हफ़्ते से लौटे नहीं। आपकी ओर से एक संदेश अक्सर काम करता है, और यह देखना भी कि वे कहाँ रुके।",
    "nudge.audience.stalled_learners_d14.cta": "अपने सीखने वालों को देखें",

    "nudge.monetization.course_limit_d1.subject": "आपने {plan_name} योजना के सारे कोर्स इस्तेमाल कर लिए",
    "nudge.monetization.course_limit_d1.heading": "आप कोर्स की सीमा तक पहुँच गए",
    "nudge.monetization.course_limit_d1.body": "{org_name} {plan_name} योजना पर है और उसमें शामिल सारे कोर्स इस्तेमाल हो चुके हैं। आगे बनाते रहना है तो {next_plan} पर जाने से यह सीमा हट जाती है।",
    "nudge.monetization.course_limit_d1.cta": "योजनाएँ देखें",

    "nudge.monetization.member_limit_near.subject": "आप {plan_name} योजना की सदस्य सीमा के पास हैं",
    "nudge.monetization.member_limit_near.heading": "सदस्य सीमा लगभग पूरी",
    "nudge.monetization.member_limit_near.body": "{org_name} उस सदस्य संख्या के पास पहुँच रही है जिसकी {plan_name} योजना अनुमति देती है। {next_plan} पर जाने से वह बढ़ जाती है, ताकि कोई साइन-अप के बीच में न रुके।",
    "nudge.monetization.member_limit_near.cta": "योजनाएँ देखें",

    "nudge.monetization.ai_credits_low.subject": "आपके AI क्रेडिट लगभग खत्म हैं",
    "nudge.monetization.ai_credits_low.heading": "AI क्रेडिट कम बचे हैं",
    "nudge.monetization.ai_credits_low.body": "{org_name} ने {plan_name} योजना में शामिल AI क्रेडिट का ज़्यादातर हिस्सा इस्तेमाल कर लिया है। अगर AI आपके कोर्स बनाने का हिस्सा बन चुका है, तो {next_plan} योजना में और ज़्यादा मिलते हैं।",
    "nudge.monetization.ai_credits_low.cta": "योजनाएँ देखें",

    "nudge.monetization.upgrade_recap_d21.subject": "{next_plan} {org_name} में क्या जोड़ेगी",
    "nudge.monetization.upgrade_recap_d21.heading": "आपने कुछ ठोस बनाया है",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} में प्रकाशित कोर्स हैं और उन्हें पढ़ने वाले लोग भी। {next_plan} योजना बढ़ने की गुंजाइश देती है और उसमें कुछ ऐसा है जो {plan_name} योजना में नहीं — विस्तार की सोच रहे हैं तो देखने लायक है।",
    "nudge.monetization.upgrade_recap_d21.cta": "योजनाओं की तुलना करें",

    "nudge.dormancy.no_login_14d.subject": "{org_name} शांत रही है",
    "nudge.dormancy.no_login_14d.heading": "दो हफ़्ते बीत गए",
    "nudge.dormancy.no_login_14d.body": "आपकी पिछली बार आने के बाद से {org_name} में कुछ नहीं बदला। अगर आप किसी काम के बीच में थे, तो वह ठीक वहीं है जहाँ छोड़ा था।",
    "nudge.dormancy.no_login_14d.cta": "अपना डैशबोर्ड खोलें",

    "nudge.dormancy.no_login_30d.subject": "{org_name} पर आपके कोर्स अब भी यहीं हैं",
    "nudge.dormancy.no_login_30d.heading": "कुछ हफ़्ते बीत गए",
    "nudge.dormancy.no_login_30d.body": "आपकी अनुपस्थिति में कुछ नहीं बदला — {org_name} और उसमें सब कुछ ठीक वहीं है जहाँ आपने छोड़ा था। दोबारा शुरू करना एक क्लिक का काम है।",
    "nudge.dormancy.no_login_30d.cta": "अपना डैशबोर्ड खोलें",

    "nudge.dormancy.no_login_60d.subject": "{org_name} के बारे में आखिरी संदेश",
    "nudge.dormancy.no_login_60d.heading": "अब हम आपको परेशान नहीं करेंगे",
    "nudge.dormancy.no_login_60d.body": "{org_name} दो महीने से शांत है, इसलिए फ़िलहाल यह इस तरह का आखिरी ईमेल है। आपने जो बनाया वह वैसा ही रहेगा, जब भी ज़रूरत हो।",
    "nudge.dormancy.no_login_60d.cta": "अपना डैशबोर्ड खोलें",

    "nudge.dormancy.winback_q.subject": "{org_name} में आपकी पिछली बार के बाद क्या नया है",
    "nudge.dormancy.winback_q.heading": "कुछ चीज़ें बदली हैं",
    "nudge.dormancy.winback_q.body": "{org_name} में आए हुए आपको काफ़ी समय हो गया। तब से उत्पाद काफ़ी आगे बढ़ा है, और आपने जो बनाया वह सब अब भी वहीं है।",
    "nudge.dormancy.winback_q.cta": "एक नज़र डालें",

    "nudge.milestone.first_course_published.subject": "«{course_name}» प्रकाशित हो गया",
    "nudge.milestone.first_course_published.heading": "आपने अपना पहला कोर्स प्रकाशित किया",
    "nudge.milestone.first_course_published.body": "«{course_name}» प्रकाशित है और पढ़ा जा सकता है। अब फ़र्क यह पड़ता है कि कोई उसे पढ़े — शुरुआत में एक-दो लोग भी काफ़ी हैं।",
    "nudge.milestone.first_course_published.cta": "अपने पहले सीखने वालों को बुलाएँ",

    "nudge.milestone.first_learner_enrolled.subject": "किसी ने «{course_name}» शुरू किया",
    "nudge.milestone.first_learner_enrolled.heading": "आपका पहला सीखने वाला आ गया",
    "nudge.milestone.first_learner_enrolled.body": "{org_name} में पहली बार किसी ने कोर्स शुरू किया है। उनकी प्रगति आप डैशबोर्ड से देख सकते हैं।",
    "nudge.milestone.first_learner_enrolled.cta": "प्रगति देखें",

    "nudge.milestone.first_completion.subject": "किसी ने {org_name} का एक कोर्स पूरा किया",
    "nudge.milestone.first_completion.heading": "पहली बार कोर्स पूरा हुआ",
    "nudge.milestone.first_completion.body": "एक सीखने वाले ने {org_name} का कोर्स शुरू से अंत तक पूरा किया। इसे ठीक से दर्ज करना हो तो प्रमाणपत्र जोड़ सकते हैं — या अगला कोर्स बनाना शुरू कर सकते हैं।",
    "nudge.milestone.first_completion.cta": "अपना डैशबोर्ड खोलें",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "{org_name} पर आपकी अकादमी अब भी यहीं है",
    "nudge.reactivation.opener.heading": "वैसी ही, जैसी आपने छोड़ी थी",
    "nudge.reactivation.opener.body": "आपकी पिछली बार के बाद {org_name} को किसी ने नहीं छुआ — हर कोर्स, अध्याय और पाठ वहीं है जहाँ आपने छोड़ा था। दोबारा शुरू करना एक क्लिक का काम है।",
    "nudge.reactivation.opener.cta": "अपना डैशबोर्ड खोलें",
    "nudge.reactivation.whats_changed.subject": "LearnHouse में कुछ चीज़ें बदली हैं",
    "nudge.reactivation.whats_changed.heading": "आपकी पिछली बार के बाद",
    "nudge.reactivation.whats_changed.body": "{org_name} के शांत रहते हुए उत्पाद काफ़ी आगे बढ़ा है: एडिटर, कोर्स के उपकरण और सीखने वालों का रास्ता — सब पर असली काम हुआ है। आपने जो बनाया वह पहले जैसा ही चलता है।",
    "nudge.reactivation.whats_changed.cta": "नया क्या है देखें",
    "nudge.reactivation.need_a_hand.subject": "{org_name} पर लौटने में मदद चाहिए?",
    "nudge.reactivation.need_a_hand.heading": "कुछ रास्ते में आ गया था?",
    "nudge.reactivation.need_a_hand.body": "अगर {org_name} के रुकने की कोई वजह थी — कुछ उलझन भरा, कुछ कमी, या बस समय की कमी — तो हम सचमुच जानना चाहेंगे। इस ईमेल का जवाब दीजिए, वह सीधे हम तक पहुँचता है।",
    "nudge.reactivation.closing.subject": "{org_name} के बारे में आखिरी बात",
    "nudge.reactivation.closing.heading": "हम यहीं रुकते हैं",
    "nudge.reactivation.closing.body": "यह इस तरह का आखिरी ईमेल है। {org_name} जस की तस बनी रहेगी और कुछ भी समाप्त नहीं होता — कभी लौटना चाहें, तो सब इंतज़ार में मिलेगा।",
    "nudge.reactivation.closing.cta": "अपना डैशबोर्ड खोलें",
}
