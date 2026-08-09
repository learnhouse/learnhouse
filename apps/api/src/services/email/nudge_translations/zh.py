"""Simplified Chinese nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "退订这些邮件",
    "nudge.common.footer": "您收到此邮件是因为您是 {org_name} 的管理员。",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "课程",
    "nudge.stat.chapters": "章节",
    "nudge.stat.lessons": "课时",
    "nudge.stat.members": "成员",
    "nudge.stat.learners": "学员",
    "nudge.stat.completed": "已完成",

    "nudge.activation.first_course_d1.subject": "您在 {org_name} 的第一门课程",
    "nudge.activation.first_course_d1.heading": "随时都可以开始",
    "nudge.activation.first_course_d1.body": "{org_name} 已经就绪，正等着第一门课程。多数人从小处入手：一个主题，几节课。之后随时可以补充。",
    "nudge.activation.first_course_d1.cta": "创建第一门课程",

    "nudge.activation.come_back_d2.subject": "接着上次继续",
    "nudge.activation.come_back_d2.heading": "您的设置还在等着",
    "nudge.activation.come_back_d2.body": "您创建了 {org_name}，之后就没再回来。一切都还在，把第一门课程发布出去大约需要十分钟。",
    "nudge.activation.come_back_d2.cta": "前往控制台",

    "nudge.activation.ai_course_help_d4.subject": "最难的是空白页",
    "nudge.activation.ai_course_help_d4.heading": "让 AI 写大纲",
    "nudge.activation.ai_course_help_d4.body": "如果 {org_name} 还空着，只是因为不知从何下手，那就描述一下主题，AI 会拟出章节和课时。之后由您来修改。",
    "nudge.activation.ai_course_help_d4.cta": "用 AI 起草课程",

    "nudge.activation.import_existing_d5.subject": "把现有的内容带过来",
    "nudge.activation.import_existing_d5.heading": "不必从零开始",
    "nudge.activation.import_existing_d5.body": "如果您的材料已经是文档、幻灯片，或从其他平台导出的文件，可以直接导入 {org_name}，不用重新录入。",
    "nudge.activation.import_existing_d5.cta": "导入您的材料",

    "nudge.activation.setup_checklist_d7.subject": "十五分钟搭起一个可用的学院",
    "nudge.activation.setup_checklist_d7.heading": "一份简短的清单",
    "nudge.activation.setup_checklist_d7.body": "{org_name} 仍在等待第一门课程。设置清单会用几个简短的步骤带您走完，多数人一刻钟左右就能完成。",
    "nudge.activation.setup_checklist_d7.cta": "打开清单",

    "nudge.activation.whats_blocking_d14.subject": "是什么挡住了？",
    "nudge.activation.whats_blocking_d14.heading": "能问问是什么让您停下的吗？",
    "nudge.activation.whats_blocking_d14.body": "您两周前创建了 {org_name}，到现在还没添加课程。如果有让人困惑或缺失的地方，我们很想知道——直接回复这封邮件就好，会直接到我们手上。",

    "nudge.activation.last_call_d30.subject": "关于 {org_name} 的最后一封邮件",
    "nudge.activation.last_call_d30.heading": "这是最后一封",
    "nudge.activation.last_call_d30.body": "{org_name} 已经安静了一个月，所以我们不再发这类邮件了。账户和里面的一切都会保留——您回来时，都还在原处。",
    "nudge.activation.last_call_d30.cta": "打开控制台",

    "nudge.content.course_no_chapter_d1.subject": "《{course_name}》还缺第一个章节",
    "nudge.content.course_no_chapter_d1.heading": "还差一个章节",
    "nudge.content.course_no_chapter_d1.body": "《{course_name}》已经建好，但还没有章节，所以没有内容可打开。章节就是分段，一个主题一个章节效果不错。",
    "nudge.content.course_no_chapter_d1.cta": "添加章节",

    "nudge.content.chapter_no_activity_d1.subject": "为《{course_name}》添加第一节课",
    "nudge.content.chapter_no_activity_d1.heading": "章节已经就位",
    "nudge.content.chapter_no_activity_d1.body": "《{course_name}》有章节，但里面还是空的。一节课可以是一页文字、一段视频、一份测验——只要贴合主题就行。",
    "nudge.content.chapter_no_activity_d1.cta": "添加课时",

    "nudge.content.activity_unpublished_d2.subject": "《{course_name}》中的课时还看不到",
    "nudge.content.activity_unpublished_d2.heading": "课时仍处于隐藏状态",
    "nudge.content.activity_unpublished_d2.body": "您在《{course_name}》里写了课时，但都没有发布，所以学员看到的是一门空课。发布不会锁定任何内容，之后仍可继续编辑。",
    "nudge.content.activity_unpublished_d2.cta": "发布课时",

    "nudge.content.course_draft_d3.subject": "《{course_name}》仍是草稿",
    "nudge.content.course_draft_d3.heading": "《{course_name}》就快好了",
    "nudge.content.course_draft_d3.body": "您已经为《{course_name}》添加了课时，但课程尚未发布，所以没人能打开。它不需要完全做完——发布只是让它可见，之后还能继续编辑。",
    "nudge.content.course_draft_d3.cta": "发布",

    "nudge.content.course_draft_d10.subject": "《{course_name}》做草稿有一阵子了",
    "nudge.content.course_draft_d10.heading": "多半已经可以了",
    "nudge.content.course_draft_d10.body": "《{course_name}》未发布已超过一周。课程很少会让人觉得真的做完了——发布让它可见，您可以在有人阅读的同时继续打磨。",
    "nudge.content.course_draft_d10.cta": "发布",

    "nudge.content.thin_course_d5.subject": "《{course_name}》可以再充实一点",
    "nudge.content.thin_course_d5.heading": "目前只有一两节课",
    "nudge.content.thin_course_d5.body": "《{course_name}》目前只有一两节课。课程通常内容多几节效果更好，AI 可以根据已有内容起草接下来的几节。",
    "nudge.content.thin_course_d5.cta": "添加更多课时",

    "nudge.content.assignment_no_submissions_d5.subject": "{org_name} 还没有任何提交",
    "nudge.content.assignment_no_submissions_d5.heading": "还没有人交作业",
    "nudge.content.assignment_no_submissions_d5.body": "您在 {org_name} 里创建了作业，但还没有人提交。可以检查一下它是否已发布，以及学员能否进入所属的课程。",
    "nudge.content.assignment_no_submissions_d5.cta": "检查作业",

    "nudge.audience.published_no_members_d1.subject": "《{course_name}》已上线，但还没有人",
    "nudge.audience.published_no_members_d1.heading": "该邀请人了",
    "nudge.audience.published_no_members_d1.body": "《{course_name}》已发布，随时可以阅读。{org_name} 还没有学员，所以下一步是邀请您为之而写的那些人。",
    "nudge.audience.published_no_members_d1.cta": "邀请学员",

    "nudge.audience.published_no_members_d7.subject": "《{course_name}》仍然没有学员",
    "nudge.audience.published_no_members_d7.heading": "上线一周，无人阅读",
    "nudge.audience.published_no_members_d7.body": "《{course_name}》已发布一周，{org_name} 依然没有学员。您可以逐个邀请、粘贴一份名单，或者直接分享加入链接。",
    "nudge.audience.published_no_members_d7.cta": "邀请他人",

    "nudge.audience.members_no_enrollment_d3.subject": "您的学员还没开始",
    "nudge.audience.members_no_enrollment_d3.heading": "加入了，但什么都没打开",
    "nudge.audience.members_no_enrollment_d3.body": "有人加入了 {org_name}，但还没有人开始学习课程。通常一条带直达链接的简短消息就够了——多数人只是没找到入口。",
    "nudge.audience.members_no_enrollment_d3.cta": "查看成员",

    "nudge.audience.share_public_page_d14.subject": "您的课程页面是公开的——链接在这里",
    "nudge.audience.share_public_page_d14.heading": "任何拿到链接的人都能阅读",
    "nudge.audience.share_public_page_d14.body": "《{course_name}》是公开的，因此可以随处分享，别人不需要邀请。下面这个链接就是可以发出去的那个。",
    "nudge.audience.share_public_page_d14.cta": "查看公开页面",

    "nudge.audience.stalled_learners_d14.subject": "有学员学到一半停下了",
    "nudge.audience.stalled_learners_d14.heading": "有几个人卡住了",
    "nudge.audience.stalled_learners_d14.body": "{org_name} 中有些学员开始了课程，但两周没再回来。您发一条消息往往管用，看看他们停在哪里也有帮助。",
    "nudge.audience.stalled_learners_d14.cta": "查看学员情况",

    "nudge.monetization.course_limit_d1.subject": "{plan_name} 方案的课程名额已用完",
    "nudge.monetization.course_limit_d1.heading": "已达到课程上限",
    "nudge.monetization.course_limit_d1.body": "{org_name} 使用的是 {plan_name} 方案，其中包含的课程名额已全部用完。如果想继续创建，升级到 {next_plan} 可以取消这个限制。",
    "nudge.monetization.course_limit_d1.cta": "查看方案",

    "nudge.monetization.member_limit_near.subject": "{plan_name} 方案的成员上限快到了",
    "nudge.monetization.member_limit_near.heading": "接近成员上限",
    "nudge.monetization.member_limit_near.body": "{org_name} 快要达到 {plan_name} 方案允许的成员数量。升级到 {next_plan} 会提高上限，避免有人在注册途中被挡下。",
    "nudge.monetization.member_limit_near.cta": "查看方案",

    "nudge.monetization.ai_credits_low.subject": "AI 额度快用完了",
    "nudge.monetization.ai_credits_low.heading": "AI 额度所剩不多",
    "nudge.monetization.ai_credits_low.body": "{org_name} 已用掉 {plan_name} 方案所含 AI 额度的大部分。如果 AI 已成为您做课程的一部分，{next_plan} 方案包含更多额度。",
    "nudge.monetization.ai_credits_low.cta": "查看方案",

    "nudge.monetization.upgrade_recap_d21.subject": "{next_plan} 能为 {org_name} 带来什么",
    "nudge.monetization.upgrade_recap_d21.heading": "您已经做出了实在的东西",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} 有已发布的课程，也有在读的人。{next_plan} 方案提供了成长空间，还包含一些 {plan_name} 方案没有的功能——如果打算扩展，值得看看。",
    "nudge.monetization.upgrade_recap_d21.cta": "对比方案",

    "nudge.dormancy.no_login_14d.subject": "{org_name} 最近很安静",
    "nudge.dormancy.no_login_14d.heading": "已经两周了",
    "nudge.dormancy.no_login_14d.body": "自您上次来过之后，{org_name} 没有任何变化。如果当时正做到一半，东西还在原来的地方。",
    "nudge.dormancy.no_login_14d.cta": "打开控制台",

    "nudge.dormancy.no_login_30d.subject": "{org_name} 上的课程都还在",
    "nudge.dormancy.no_login_30d.heading": "已经过去几周了",
    "nudge.dormancy.no_login_30d.body": "您不在的这段时间没有任何变化——{org_name} 和里面的一切都在原处。重新开始只需一次点击。",
    "nudge.dormancy.no_login_30d.cta": "打开控制台",

    "nudge.dormancy.no_login_60d.subject": "关于 {org_name} 的最后一次问候",
    "nudge.dormancy.no_login_60d.heading": "我们就不打扰了",
    "nudge.dormancy.no_login_60d.body": "{org_name} 已经安静了两个月，所以这暂时是最后一封这类邮件。您做的一切都会原样保留，等您需要时再用。",
    "nudge.dormancy.no_login_60d.cta": "打开控制台",

    "nudge.dormancy.winback_q.subject": "自您上次来 {org_name} 之后的新变化",
    "nudge.dormancy.winback_q.heading": "有一些变化",
    "nudge.dormancy.winback_q.body": "距离您上次来 {org_name} 已经有一段时间了。产品在这期间有不少推进，而您做过的一切都还在。",
    "nudge.dormancy.winback_q.cta": "去看看",

    "nudge.milestone.first_course_published.subject": "《{course_name}》已上线",
    "nudge.milestone.first_course_published.heading": "您发布了第一门课程",
    "nudge.milestone.first_course_published.body": "《{course_name}》已经上线，可以阅读了。接下来真正起作用的，是有人来读——哪怕先只有一两个人。",
    "nudge.milestone.first_course_published.cta": "邀请第一批学员",

    "nudge.milestone.first_learner_enrolled.subject": "有人开始学《{course_name}》了",
    "nudge.milestone.first_learner_enrolled.heading": "第一位学员来了",
    "nudge.milestone.first_learner_enrolled.body": "{org_name} 里第一次有人开始学习课程。您可以在控制台里跟进他的进度。",
    "nudge.milestone.first_learner_enrolled.cta": "查看进度",

    "nudge.milestone.first_completion.subject": "有人学完了 {org_name} 的一门课程",
    "nudge.milestone.first_completion.heading": "第一次结课",
    "nudge.milestone.first_completion.body": "有学员把 {org_name} 的一门课程从头学到尾。想正式记录一下，可以添加证书——或者开始筹备下一门。",
    "nudge.milestone.first_completion.cta": "打开控制台",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "您在 {org_name} 的学院还在",
    "nudge.reactivation.opener.heading": "一切照旧，和您离开时一样",
    "nudge.reactivation.opener.body": "自您上次来过之后，没人动过 {org_name}——每一门课程、章节和课时都在原处。想接着做，只需一次点击。",
    "nudge.reactivation.opener.cta": "打开控制台",
    "nudge.reactivation.whats_changed.subject": "LearnHouse 有了一些变化",
    "nudge.reactivation.whats_changed.heading": "自您上次来过之后",
    "nudge.reactivation.whats_changed.body": "在 {org_name} 安静的这段时间，产品推进了不少：编辑器、课程工具和学员的学习路径都做了实在的改动。您做过的一切仍照常运行。",
    "nudge.reactivation.whats_changed.cta": "看看有什么新变化",
    "nudge.reactivation.need_a_hand.subject": "需要帮您重新上手 {org_name} 吗？",
    "nudge.reactivation.need_a_hand.heading": "是有什么挡住了吗？",
    "nudge.reactivation.need_a_hand.body": "如果 {org_name} 停下来是有原因的——某处让人困惑、缺了什么，或者只是没时间——我们很想知道。直接回复这封邮件就好，会直接到我们手上。",
    "nudge.reactivation.closing.subject": "关于 {org_name} 的最后一封",
    "nudge.reactivation.closing.heading": "我们就说到这里",
    "nudge.reactivation.closing.body": "这是这类邮件的最后一封。{org_name} 会原样保留，也不会过期——哪天想回来，一切都还在。",
    "nudge.reactivation.closing.cta": "打开控制台",
}
