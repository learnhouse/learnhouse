"""Bengali nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "এই ইমেলগুলি থেকে আনসাবস্ক্রাইব করুন",
    "nudge.common.footer": "আপনি এই ইমেলটি পাচ্ছেন কারণ আপনি {org_name}-এর একজন অ্যাডমিন।",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "কোর্স",
    "nudge.stat.chapters": "অধ্যায়",
    "nudge.stat.lessons": "পাঠ",
    "nudge.stat.members": "সদস্য",
    "nudge.stat.learners": "শিক্ষার্থী",
    "nudge.stat.completed": "সম্পন্ন",

    "nudge.activation.first_course_d1.subject": "{org_name}-এ আপনার প্রথম কোর্স",
    "nudge.activation.first_course_d1.heading": "যখন আপনি প্রস্তুত",
    "nudge.activation.first_course_d1.body": "{org_name} তৈরি হয়ে গেছে এবং প্রথম কোর্সের অপেক্ষায় আছে। বেশিরভাগ মানুষ ছোট থেকে শুরু করেন: একটি বিষয়, কয়েকটি পাঠ। পরে যোগ করা সবসময়ই সম্ভব।",
    "nudge.activation.first_course_d1.cta": "আপনার প্রথম কোর্স তৈরি করুন",

    "nudge.activation.come_back_d2.subject": "যেখানে থেমেছিলেন সেখান থেকে শুরু করুন",
    "nudge.activation.come_back_d2.heading": "আপনার সেটআপ এখনও অপেক্ষা করছে",
    "nudge.activation.come_back_d2.body": "আপনি {org_name} তৈরি করেছিলেন, তারপর আর ফেরেননি। সবকিছু ঠিক আগের মতোই আছে, আর প্রথম কোর্স প্রকাশ করতে মিনিট দশেক লাগে।",
    "nudge.activation.come_back_d2.cta": "ড্যাশবোর্ডে যান",

    "nudge.activation.ai_course_help_d4.subject": "ফাঁকা পাতাই সবচেয়ে কঠিন",
    "nudge.activation.ai_course_help_d4.heading": "রূপরেখাটা AI-কে লিখতে দিন",
    "nudge.activation.ai_course_help_d4.body": "কোথা থেকে শুরু করবেন বুঝতে না পারায় {org_name} যদি এখনও ফাঁকা থাকে, তাহলে শুধু বিষয়টা লিখুন — AI অধ্যায় ও পাঠের খসড়া করে দেবে। সম্পাদনা আপনার হাতে।",
    "nudge.activation.ai_course_help_d4.cta": "AI দিয়ে কোর্স তৈরি করুন",

    "nudge.activation.import_existing_d5.subject": "যা আছে তা-ই নিয়ে আসুন",
    "nudge.activation.import_existing_d5.heading": "শূন্য থেকে শুরু করতে হবে না",
    "nudge.activation.import_existing_d5.body": "আপনার উপকরণ যদি আগে থেকেই নথি, স্লাইড বা অন্য প্ল্যাটফর্মের এক্সপোর্ট হিসেবে থাকে, নতুন করে টাইপ না করে সেগুলো {org_name}-এ নিয়ে আসতে পারেন।",
    "nudge.activation.import_existing_d5.cta": "আপনার উপকরণ আমদানি করুন",

    "nudge.activation.setup_checklist_d7.subject": "পনেরো মিনিটে চালু একটি অ্যাকাডেমি",
    "nudge.activation.setup_checklist_d7.heading": "ছোট একটি তালিকা",
    "nudge.activation.setup_checklist_d7.body": "{org_name} এখনও প্রথম কোর্সের অপেক্ষায়। সেটআপ তালিকা কয়েকটি ছোট ধাপে পথ দেখিয়ে দেয় — বেশিরভাগ মানুষ পনেরো মিনিটের মধ্যেই শেষ করেন।",
    "nudge.activation.setup_checklist_d7.cta": "তালিকাটি খুলুন",

    "nudge.activation.whats_blocking_d14.subject": "মাঝখানে কী এসে দাঁড়াল?",
    "nudge.activation.whats_blocking_d14.heading": "জিজ্ঞেস করতে পারি, কী আপনাকে থামাল?",
    "nudge.activation.whats_blocking_d14.body": "সপ্তাহ দুয়েক আগে আপনি {org_name} তৈরি করেছিলেন, এখনও কোনো কোর্স যোগ করেননি। কিছু বিভ্রান্তিকর লেগে থাকলে বা কিছু কম পড়ে থাকলে আমরা জানতে চাই — এই ইমেলের উত্তর দিলেই সরাসরি আমাদের কাছে পৌঁছবে।",

    "nudge.activation.last_call_d30.subject": "{org_name} নিয়ে শেষ ইমেল",
    "nudge.activation.last_call_d30.heading": "এটাই শেষ",
    "nudge.activation.last_call_d30.body": "{org_name} এক মাস ধরে নিঃশব্দ, তাই আমরা এই ধরনের ইমেল পাঠানো বন্ধ করছি। আপনার অ্যাকাউন্ট ও ভেতরের সবকিছু থেকে যাবে — ফিরে এলে সব যেমন রেখে গিয়েছিলেন তেমনই পাবেন।",
    "nudge.activation.last_call_d30.cta": "আপনার ড্যাশবোর্ড খুলুন",

    "nudge.content.course_no_chapter_d1.subject": "«{course_name}»-এর প্রথম অধ্যায় দরকার",
    "nudge.content.course_no_chapter_d1.heading": "আর একটি অধ্যায় বাকি",
    "nudge.content.course_no_chapter_d1.body": "«{course_name}» তৈরি হয়েছে, কিন্তু এখনও কোনো অধ্যায় নেই, তাই খোলার মতো কিছু নেই। অধ্যায় আসলে শুধু ভাগ — বিষয়প্রতি একটি করে ভালো কাজ করে।",
    "nudge.content.course_no_chapter_d1.cta": "অধ্যায় যোগ করুন",

    "nudge.content.chapter_no_activity_d1.subject": "«{course_name}»-এ প্রথম পাঠ যোগ করুন",
    "nudge.content.chapter_no_activity_d1.heading": "অধ্যায়গুলো প্রস্তুত",
    "nudge.content.chapter_no_activity_d1.body": "«{course_name}»-এ অধ্যায় আছে, কিন্তু ভেতরটা এখনও ফাঁকা। একটি পাঠ হতে পারে এক পৃষ্ঠার লেখা, একটি ভিডিও বা একটি কুইজ — বিষয়ের সঙ্গে যা মানায়।",
    "nudge.content.chapter_no_activity_d1.cta": "পাঠ যোগ করুন",

    "nudge.content.activity_unpublished_d2.subject": "«{course_name}»-এর পাঠগুলো এখনও দেখা যাচ্ছে না",
    "nudge.content.activity_unpublished_d2.heading": "পাঠগুলো এখনও লুকানো",
    "nudge.content.activity_unpublished_d2.body": "আপনি «{course_name}»-এ পাঠ লিখেছেন, কিন্তু একটিও প্রকাশিত নয়, তাই শিক্ষার্থীরা একটি ফাঁকা কোর্স দেখছেন। প্রকাশ করলে কিছু আটকে যায় না — পরেও সম্পাদনা করা যায়।",
    "nudge.content.activity_unpublished_d2.cta": "আপনার পাঠ প্রকাশ করুন",

    "nudge.content.course_draft_d3.subject": "«{course_name}» এখনও খসড়া",
    "nudge.content.course_draft_d3.heading": "«{course_name}» প্রায় তৈরি",
    "nudge.content.course_draft_d3.body": "আপনি «{course_name}»-এ পাঠ যোগ করেছেন, কিন্তু এটি প্রকাশিত নয়, তাই কেউ খুলতে পারছে না। সম্পূর্ণ হওয়ার দরকার নেই — প্রকাশ করলে কেবল দৃশ্যমান হয়, পরেও সম্পাদনা চালিয়ে যেতে পারেন।",
    "nudge.content.course_draft_d3.cta": "প্রকাশ করুন",

    "nudge.content.course_draft_d10.subject": "«{course_name}» বেশ কিছুদিন ধরে খসড়া",
    "nudge.content.course_draft_d10.heading": "সম্ভবত এটি তৈরি",
    "nudge.content.course_draft_d10.body": "«{course_name}» এক সপ্তাহেরও বেশি সময় ধরে অপ্রকাশিত। কোর্স খুব কমই সম্পূর্ণ মনে হয় — প্রকাশ করলে দেখা যায়, আর পাঠক থাকা অবস্থাতেও উন্নত করা যায়।",
    "nudge.content.course_draft_d10.cta": "প্রকাশ করুন",

    "nudge.content.thin_course_d5.subject": "«{course_name}»-এ আরেকটু যোগ করা যায়",
    "nudge.content.thin_course_d5.heading": "এক-দুটি পাঠ",
    "nudge.content.thin_course_d5.body": "«{course_name}»-এ এখন পর্যন্ত এক-দুটি পাঠ আছে। কয়েকটি পাঠ থাকলে কোর্স সাধারণত বেশি কাজে দেয়, আর যা আছে তা থেকেই AI পরের পাঠগুলোর খসড়া করতে পারে।",
    "nudge.content.thin_course_d5.cta": "আরও পাঠ যোগ করুন",

    "nudge.content.assignment_no_submissions_d5.subject": "{org_name}-এ এখনও কোনো জমা পড়েনি",
    "nudge.content.assignment_no_submissions_d5.heading": "কেউ কিছু জমা দেয়নি",
    "nudge.content.assignment_no_submissions_d5.body": "আপনি {org_name}-এ একটি অ্যাসাইনমেন্ট তৈরি করেছিলেন, কিন্তু কিছু জমা পড়েনি। দেখে নেওয়া ভালো যে এটি প্রকাশিত কি না এবং শিক্ষার্থীরা সংশ্লিষ্ট কোর্সে পৌঁছাতে পারছেন কি না।",
    "nudge.content.assignment_no_submissions_d5.cta": "অ্যাসাইনমেন্ট দেখুন",

    "nudge.audience.published_no_members_d1.subject": "«{course_name}» প্রকাশিত, কিন্তু কেউ নেই",
    "nudge.audience.published_no_members_d1.heading": "কাউকে আমন্ত্রণ জানানোর সময়",
    "nudge.audience.published_no_members_d1.body": "«{course_name}» প্রকাশিত এবং পড়ার জন্য প্রস্তুত। {org_name}-এ এখনও কোনো শিক্ষার্থী নেই, তাই পরের ধাপ হলো যাদের জন্য লিখেছিলেন তাদের আমন্ত্রণ জানানো।",
    "nudge.audience.published_no_members_d1.cta": "শিক্ষার্থীদের আমন্ত্রণ জানান",

    "nudge.audience.published_no_members_d7.subject": "«{course_name}»-এ এখনও কোনো শিক্ষার্থী নেই",
    "nudge.audience.published_no_members_d7.heading": "এক সপ্তাহ প্রকাশিত, কেউ পড়ছে না",
    "nudge.audience.published_no_members_d7.body": "«{course_name}» এক সপ্তাহ ধরে প্রকাশিত, তবু {org_name}-এ কোনো শিক্ষার্থী নেই। একজন একজন করে আমন্ত্রণ জানাতে পারেন, তালিকা পেস্ট করতে পারেন, কিংবা কেবল যোগদানের লিংক ভাগ করে নিতে পারেন।",
    "nudge.audience.published_no_members_d7.cta": "মানুষজনকে আমন্ত্রণ জানান",

    "nudge.audience.members_no_enrollment_d3.subject": "আপনার শিক্ষার্থীরা এখনও শুরু করেননি",
    "nudge.audience.members_no_enrollment_d3.heading": "যোগ দিয়েছেন, কিন্তু কিছু খোলেননি",
    "nudge.audience.members_no_enrollment_d3.body": "কিছু মানুষ {org_name}-এ যোগ দিয়েছেন, কিন্তু কেউ কোর্স শুরু করেননি। সরাসরি লিংকসহ একটি ছোট বার্তা সাধারণত যথেষ্ট — বেশিরভাগই কেবল ঢোকার পথটা খুঁজে পাননি।",
    "nudge.audience.members_no_enrollment_d3.cta": "আপনার সদস্যদের দেখুন",

    "nudge.audience.share_public_page_d14.subject": "আপনার কোর্স পাতা সর্বজনীন — লিংকটি এখানে",
    "nudge.audience.share_public_page_d14.heading": "লিংক থাকলেই যে কেউ পড়তে পারবেন",
    "nudge.audience.share_public_page_d14.body": "«{course_name}» সর্বজনীন, তাই আমন্ত্রণ ছাড়াই যেকোনো জায়গায় ভাগ করে নিতে পারেন। নিচের লিংকটিই পাঠানোর জন্য।",
    "nudge.audience.share_public_page_d14.cta": "সর্বজনীন পাতা দেখুন",

    "nudge.audience.stalled_learners_d14.subject": "কয়েকজন শিক্ষার্থী মাঝপথে থেমে গেছেন",
    "nudge.audience.stalled_learners_d14.heading": "কয়েকজন আটকে আছেন",
    "nudge.audience.stalled_learners_d14.body": "{org_name}-এর কয়েকজন শিক্ষার্থী কোর্স শুরু করে দুই সপ্তাহ ধরে ফেরেননি। আপনার একটি বার্তা প্রায়ই কাজে দেয়, আর তাঁরা কোথায় থেমেছেন সেটা দেখাও।",
    "nudge.audience.stalled_learners_d14.cta": "শিক্ষার্থীদের দেখুন",

    "nudge.monetization.course_limit_d1.subject": "{plan_name} প্ল্যানের সব কোর্স ব্যবহার হয়ে গেছে",
    "nudge.monetization.course_limit_d1.heading": "আপনি কোর্সের সীমায় পৌঁছেছেন",
    "nudge.monetization.course_limit_d1.body": "{org_name} {plan_name} প্ল্যানে আছে এবং এতে থাকা সব কোর্স ব্যবহার করে ফেলেছে। বানিয়ে যেতে চাইলে {next_plan}-এ যাওয়া এই সীমা তুলে দেয়।",
    "nudge.monetization.course_limit_d1.cta": "প্ল্যানগুলো দেখুন",

    "nudge.monetization.member_limit_near.subject": "{plan_name} প্ল্যানের সদস্যসীমার কাছে চলে এসেছেন",
    "nudge.monetization.member_limit_near.heading": "সদস্যসীমা প্রায় ছুঁই ছুঁই",
    "nudge.monetization.member_limit_near.body": "{plan_name} প্ল্যান যত সদস্যের অনুমতি দেয়, {org_name} তার কাছাকাছি পৌঁছাচ্ছে। {next_plan}-এ গেলে সেটা বাড়ে, যাতে সাইন-আপের মাঝপথে কেউ আটকে না যান।",
    "nudge.monetization.member_limit_near.cta": "প্ল্যানগুলো দেখুন",

    "nudge.monetization.ai_credits_low.subject": "আপনার AI ক্রেডিট প্রায় শেষ",
    "nudge.monetization.ai_credits_low.heading": "AI ক্রেডিট কমে এসেছে",
    "nudge.monetization.ai_credits_low.body": "{plan_name} প্ল্যানে থাকা AI ক্রেডিটের বেশিরভাগই {org_name} ব্যবহার করে ফেলেছে। AI যদি আপনার কোর্স বানানোর অংশ হয়ে থাকে, {next_plan} প্ল্যানে আরও বেশি রয়েছে।",
    "nudge.monetization.ai_credits_low.cta": "প্ল্যানগুলো দেখুন",

    "nudge.monetization.upgrade_recap_d21.subject": "{next_plan} {org_name}-এ কী যোগ করবে",
    "nudge.monetization.upgrade_recap_d21.heading": "আপনি সত্যিকারের কিছু গড়েছেন",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name}-এ প্রকাশিত কোর্স আছে এবং তা পড়ার মানুষও আছে। {next_plan} প্ল্যান বাড়ার জায়গা দেয় এবং এতে এমন কিছু আছে যা {plan_name} প্ল্যানে নেই — বাড়ানোর পরিকল্পনা থাকলে দেখার মতো।",
    "nudge.monetization.upgrade_recap_d21.cta": "প্ল্যান তুলনা করুন",

    "nudge.dormancy.no_login_14d.subject": "{org_name} চুপচাপ ছিল",
    "nudge.dormancy.no_login_14d.heading": "দুই সপ্তাহ কেটে গেছে",
    "nudge.dormancy.no_login_14d.body": "আপনার শেষবার আসার পর {org_name}-এ কিছুই বদলায়নি। কোনো কাজের মাঝখানে থাকলে সেটা ঠিক যেখানে রেখেছিলেন সেখানেই আছে।",
    "nudge.dormancy.no_login_14d.cta": "আপনার ড্যাশবোর্ড খুলুন",

    "nudge.dormancy.no_login_30d.subject": "{org_name}-এ আপনার কোর্সগুলো এখনও আছে",
    "nudge.dormancy.no_login_30d.heading": "কয়েক সপ্তাহ কেটে গেছে",
    "nudge.dormancy.no_login_30d.body": "আপনি না থাকাকালে কিছুই বদলায়নি — {org_name} আর তার ভেতরের সবকিছু ঠিক যেখানে রেখেছিলেন সেখানেই। আবার শুরু করতে একটি ক্লিকই যথেষ্ট।",
    "nudge.dormancy.no_login_30d.cta": "আপনার ড্যাশবোর্ড খুলুন",

    "nudge.dormancy.no_login_60d.subject": "{org_name} নিয়ে শেষ বার্তা",
    "nudge.dormancy.no_login_60d.heading": "আমরা আর বিরক্ত করব না",
    "nudge.dormancy.no_login_60d.body": "{org_name} প্রায় দুই মাস ধরে নিঃশব্দ, তাই আপাতত এটাই এ ধরনের শেষ ইমেল। আপনার গড়া সবকিছু যেমন আছে তেমনই থাকবে, যখনই দরকার হয়।",
    "nudge.dormancy.no_login_60d.cta": "আপনার ড্যাশবোর্ড খুলুন",

    "nudge.dormancy.winback_q.subject": "{org_name}-এ শেষবার আসার পর কী নতুন হলো",
    "nudge.dormancy.winback_q.heading": "কিছু জিনিস বদলেছে",
    "nudge.dormancy.winback_q.body": "{org_name}-এ আপনার শেষবার আসার পর অনেকটা সময় গেছে। এর মধ্যে পণ্যটি বেশ এগিয়েছে, আর আপনার গড়া সবকিছু এখনও আছে।",
    "nudge.dormancy.winback_q.cta": "একবার দেখুন",

    "nudge.milestone.first_course_published.subject": "«{course_name}» প্রকাশিত হয়েছে",
    "nudge.milestone.first_course_published.heading": "আপনি আপনার প্রথম কোর্স প্রকাশ করেছেন",
    "nudge.milestone.first_course_published.body": "«{course_name}» প্রকাশিত এবং পড়া যাচ্ছে। এখন যেটা পার্থক্য গড়ে দেয় সেটা হলো কেউ একজন পড়ুক — শুরুতে এক-দুজন হলেও চলে।",
    "nudge.milestone.first_course_published.cta": "প্রথম শিক্ষার্থীদের আমন্ত্রণ জানান",

    "nudge.milestone.first_learner_enrolled.subject": "কেউ «{course_name}» শুরু করেছেন",
    "nudge.milestone.first_learner_enrolled.heading": "আপনার প্রথম শিক্ষার্থী এসেছেন",
    "nudge.milestone.first_learner_enrolled.body": "{org_name}-এ প্রথমবারের মতো কেউ একটি কোর্স শুরু করেছেন। ড্যাশবোর্ড থেকে তাঁর অগ্রগতি দেখতে পারেন।",
    "nudge.milestone.first_learner_enrolled.cta": "অগ্রগতি দেখুন",

    "nudge.milestone.first_completion.subject": "কেউ {org_name}-এর একটি কোর্স শেষ করেছেন",
    "nudge.milestone.first_completion.heading": "প্রথম সমাপ্তি",
    "nudge.milestone.first_completion.body": "একজন শিক্ষার্থী {org_name}-এর একটি কোর্স শুরু থেকে শেষ পর্যন্ত সম্পূর্ণ করেছেন। ঠিকভাবে চিহ্নিত করতে চাইলে একটি সার্টিফিকেট যোগ করতে পারেন — বা পরেরটি বানানো শুরু করতে পারেন।",
    "nudge.milestone.first_completion.cta": "আপনার ড্যাশবোর্ড খুলুন",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "{org_name}-এ আপনার অ্যাকাডেমি এখনও আছে",
    "nudge.reactivation.opener.heading": "এখনও এখানে, যেমন রেখে গিয়েছিলেন",
    "nudge.reactivation.opener.body": "আপনার শেষবার আসার পর {org_name}-এ কেউ হাত দেয়নি — প্রতিটি কোর্স, অধ্যায় আর পাঠ ঠিক জায়গাতেই আছে। আবার শুরু করতে একটি ক্লিকই যথেষ্ট।",
    "nudge.reactivation.opener.cta": "আপনার ড্যাশবোর্ড খুলুন",
    "nudge.reactivation.whats_changed.subject": "LearnHouse-এ কিছু বদলেছে",
    "nudge.reactivation.whats_changed.heading": "আপনার শেষবার আসার পর",
    "nudge.reactivation.whats_changed.body": "{org_name} চুপচাপ থাকার সময় পণ্যটি বেশ এগিয়েছে: এডিটর, কোর্স তৈরির সরঞ্জাম আর শিক্ষার্থীদের এগিয়ে চলার পথ — সবেতেই সত্যিকারের কাজ হয়েছে। আপনার গড়া সবকিছু আগের মতোই চলে।",
    "nudge.reactivation.whats_changed.cta": "কী নতুন হয়েছে দেখুন",
    "nudge.reactivation.need_a_hand.subject": "{org_name}-এ ফিরতে সাহায্য লাগবে?",
    "nudge.reactivation.need_a_hand.heading": "কিছু কি বাধা হয়ে দাঁড়িয়েছিল?",
    "nudge.reactivation.need_a_hand.body": "{org_name} থেমে যাওয়ার কোনো কারণ থাকলে — বিভ্রান্তিকর কিছু, কিছুর অভাব, কিংবা কেবল সময় না পাওয়া — আমরা সত্যিই জানতে চাই। এই ইমেলের উত্তর দিন, সেটি সরাসরি আমাদের কাছে পৌঁছবে।",
    "nudge.reactivation.closing.subject": "{org_name} নিয়ে শেষ কথা",
    "nudge.reactivation.closing.heading": "আমরা এখানেই থামছি",
    "nudge.reactivation.closing.body": "এ ধরনের ইমেলের মধ্যে এটিই শেষ। {org_name} যেমন আছে তেমনই থাকবে, কিছুই মেয়াদোত্তীর্ণ হয় না — কখনও ফিরতে চাইলে সবকিছু অপেক্ষায় থাকবে।",
    "nudge.reactivation.closing.cta": "আপনার ড্যাশবোর্ড খুলুন",
}
