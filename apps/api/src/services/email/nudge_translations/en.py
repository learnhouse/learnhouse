"""English nudge copy — the source text every other locale translates from."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Unsubscribe from these emails",
    "nudge.common.footer": "You're receiving this because you're an admin of {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Courses",
    "nudge.stat.chapters": "Chapters",
    "nudge.stat.lessons": "Lessons",
    "nudge.stat.members": "Members",
    "nudge.stat.learners": "Learners",
    "nudge.stat.completed": "Completed",

    # -- activation --------------------------------------------------------
    "nudge.activation.first_course_d1.subject": "Your first course on {org_name}",
    "nudge.activation.first_course_d1.heading": "Ready when you are",
    "nudge.activation.first_course_d1.body": "{org_name} is set up and waiting for its first course. Most people start small — one topic, a few lessons. You can always add to it later.",
    "nudge.activation.first_course_d1.cta": "Create your first course",

    "nudge.activation.come_back_d2.subject": "Picking up where you left off",
    "nudge.activation.come_back_d2.heading": "Your setup is still waiting",
    "nudge.activation.come_back_d2.body": "You set up {org_name} and haven't been back since. Everything is still there, and getting a first course in place takes about ten minutes.",
    "nudge.activation.come_back_d2.cta": "Go to your dashboard",

    "nudge.activation.ai_course_help_d4.subject": "The blank page is the hard part",
    "nudge.activation.ai_course_help_d4.heading": "Let AI write the outline",
    "nudge.activation.ai_course_help_d4.body": "If {org_name} is still empty because you're not sure where to start, describe your topic and AI will draft the chapters and lessons. You edit from there.",
    "nudge.activation.ai_course_help_d4.cta": "Draft a course with AI",

    "nudge.activation.import_existing_d5.subject": "Bring what you already have",
    "nudge.activation.import_existing_d5.heading": "You don't have to start from scratch",
    "nudge.activation.import_existing_d5.body": "If your material already exists as documents, slides or an export from another platform, you can bring it into {org_name} instead of retyping it.",
    "nudge.activation.import_existing_d5.cta": "Import your material",

    "nudge.activation.setup_checklist_d7.subject": "Fifteen minutes to a working academy",
    "nudge.activation.setup_checklist_d7.heading": "A short checklist",
    "nudge.activation.setup_checklist_d7.body": "{org_name} is still waiting on its first course. The setup checklist walks through it in a few short steps — most people finish in about fifteen minutes.",
    "nudge.activation.setup_checklist_d7.cta": "Open the checklist",

    "nudge.activation.whats_blocking_d14.subject": "What got in the way?",
    "nudge.activation.whats_blocking_d14.heading": "Can we ask what stopped you?",
    "nudge.activation.whats_blocking_d14.body": "You set up {org_name} a couple of weeks ago and haven't added a course yet. If something was confusing or missing, we'd like to know — reply to this email and it comes straight to us.",

    "nudge.activation.last_call_d30.subject": "Last email about {org_name}",
    "nudge.activation.last_call_d30.heading": "This is the last one",
    "nudge.activation.last_call_d30.body": "{org_name} has been quiet for a month, so we'll stop sending these. Your account and everything in it stays put — if you come back, it will all be where you left it.",
    "nudge.activation.last_call_d30.cta": "Open your dashboard",

    # -- content -----------------------------------------------------------
    "nudge.content.course_no_chapter_d1.subject": "{course_name} needs its first chapter",
    "nudge.content.course_no_chapter_d1.heading": "One chapter to go",
    "nudge.content.course_no_chapter_d1.body": "{course_name} exists but has no chapters yet, so there's nothing for anyone to open. Chapters are just sections — one per topic works well.",
    "nudge.content.course_no_chapter_d1.cta": "Add a chapter",

    "nudge.content.chapter_no_activity_d1.subject": "Add your first lesson to {course_name}",
    "nudge.content.chapter_no_activity_d1.heading": "The chapters are ready",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} has chapters but nothing in them yet. A lesson can be a page of text, a video, a quiz — whatever fits the topic.",
    "nudge.content.chapter_no_activity_d1.cta": "Add a lesson",

    "nudge.content.activity_unpublished_d2.subject": "Your lessons in {course_name} aren't visible yet",
    "nudge.content.activity_unpublished_d2.heading": "The lessons are still hidden",
    "nudge.content.activity_unpublished_d2.body": "You've written lessons in {course_name}, but none are published, so learners see an empty course. Publishing doesn't lock anything — you can keep editing afterwards.",
    "nudge.content.activity_unpublished_d2.cta": "Publish your lessons",

    "nudge.content.course_draft_d3.subject": "{course_name} is still a draft",
    "nudge.content.course_draft_d3.heading": "{course_name} is nearly there",
    "nudge.content.course_draft_d3.body": "You've added lessons to {course_name}, but it isn't published yet, so nobody can open it. It doesn't need to be finished — publishing only makes it visible, and you can keep editing afterwards.",
    "nudge.content.course_draft_d3.cta": "Publish it",

    "nudge.content.course_draft_d10.subject": "{course_name} has been a draft for a while",
    "nudge.content.course_draft_d10.heading": "It's probably ready",
    "nudge.content.course_draft_d10.body": "{course_name} has been sitting unpublished for over a week. A course rarely feels finished — publishing makes it visible, and you can keep improving it with people already reading.",
    "nudge.content.course_draft_d10.cta": "Publish it",

    "nudge.content.thin_course_d5.subject": "{course_name} could use a little more",
    "nudge.content.thin_course_d5.heading": "A lesson or two in",
    "nudge.content.thin_course_d5.body": "{course_name} has a couple of lessons so far. Courses tend to land better with a handful, and AI can draft the next few from what's already there.",
    "nudge.content.thin_course_d5.cta": "Add more lessons",

    "nudge.content.assignment_no_submissions_d5.subject": "No submissions yet in {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Nobody has handed anything in",
    "nudge.content.assignment_no_submissions_d5.body": "You set up an assignment in {org_name} but nothing has been submitted. It's worth checking that it's published and that your learners can reach the course it belongs to.",
    "nudge.content.assignment_no_submissions_d5.cta": "Check your assignments",

    # -- audience ----------------------------------------------------------
    "nudge.audience.published_no_members_d1.subject": "{course_name} is live, but nobody's there yet",
    "nudge.audience.published_no_members_d1.heading": "Time to invite someone",
    "nudge.audience.published_no_members_d1.body": "{course_name} is published and ready to read. {org_name} doesn't have any learners yet, so the next step is inviting the people you wrote it for.",
    "nudge.audience.published_no_members_d1.cta": "Invite learners",

    "nudge.audience.published_no_members_d7.subject": "{course_name} still has no learners",
    "nudge.audience.published_no_members_d7.heading": "A week live, nobody reading",
    "nudge.audience.published_no_members_d7.body": "{course_name} has been published for a week and {org_name} still has no learners. You can invite people one by one, paste in a list, or just share the join link.",
    "nudge.audience.published_no_members_d7.cta": "Invite people",

    "nudge.audience.members_no_enrollment_d3.subject": "Your learners haven't started yet",
    "nudge.audience.members_no_enrollment_d3.heading": "They joined but haven't opened anything",
    "nudge.audience.members_no_enrollment_d3.body": "People have joined {org_name} but nobody has started a course. A short message with a direct link usually does it — most people simply haven't found their way in.",
    "nudge.audience.members_no_enrollment_d3.cta": "See your members",

    "nudge.audience.share_public_page_d14.subject": "Your course page is public — here's the link",
    "nudge.audience.share_public_page_d14.heading": "Anyone with the link can read it",
    "nudge.audience.share_public_page_d14.body": "{course_name} is public, so you can share it anywhere without people needing an invitation first. The link below is the one to send.",
    "nudge.audience.share_public_page_d14.cta": "View the public page",

    "nudge.audience.stalled_learners_d14.subject": "Some learners stopped partway through",
    "nudge.audience.stalled_learners_d14.heading": "A few people stalled",
    "nudge.audience.stalled_learners_d14.body": "Some learners in {org_name} started a course and haven't come back for a couple of weeks. It's often worth a message from you, or a look at where they stopped.",
    "nudge.audience.stalled_learners_d14.cta": "Check on your learners",

    # -- monetization ------------------------------------------------------
    "nudge.monetization.course_limit_d1.subject": "You've used every course on the {plan_name} plan",
    "nudge.monetization.course_limit_d1.heading": "You've reached the course limit",
    "nudge.monetization.course_limit_d1.body": "{org_name} is on the {plan_name} plan and has used every course it includes. Moving up to {next_plan} lifts that limit if you want to keep building.",
    "nudge.monetization.course_limit_d1.cta": "See plans",

    "nudge.monetization.member_limit_near.subject": "You're close to the member limit on {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Nearly at the member limit",
    "nudge.monetization.member_limit_near.body": "{org_name} is approaching the number of members the {plan_name} plan allows. Moving to {next_plan} raises it, so nobody gets turned away partway through signing up.",
    "nudge.monetization.member_limit_near.cta": "See plans",

    "nudge.monetization.ai_credits_low.subject": "Your AI credits are nearly used up",
    "nudge.monetization.ai_credits_low.heading": "Running low on AI credits",
    "nudge.monetization.ai_credits_low.body": "{org_name} has used most of the AI credits included with the {plan_name} plan. The {next_plan} plan comes with more, if AI has become part of how you build courses.",
    "nudge.monetization.ai_credits_low.cta": "See plans",

    "nudge.monetization.upgrade_recap_d21.subject": "What {next_plan} would add for {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "You've built something real",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} has published courses and people reading them. The {next_plan} plan adds room to grow and a few things the {plan_name} plan doesn't include — worth a look if you're planning to expand.",
    "nudge.monetization.upgrade_recap_d21.cta": "Compare plans",

    # -- dormancy ----------------------------------------------------------
    "nudge.dormancy.no_login_14d.subject": "{org_name} has been quiet",
    "nudge.dormancy.no_login_14d.heading": "It's been a couple of weeks",
    "nudge.dormancy.no_login_14d.body": "Nothing has changed in {org_name} since you were last here. If you were in the middle of something, it's still exactly where you left it.",
    "nudge.dormancy.no_login_14d.cta": "Open your dashboard",

    "nudge.dormancy.no_login_30d.subject": "Your courses on {org_name} are still here",
    "nudge.dormancy.no_login_30d.heading": "It's been a few weeks",
    "nudge.dormancy.no_login_30d.body": "Nothing has changed while you were away — {org_name} and everything in it is exactly where you left it. Picking it back up takes one click.",
    "nudge.dormancy.no_login_30d.cta": "Open your dashboard",

    "nudge.dormancy.no_login_60d.subject": "Last check-in about {org_name}",
    "nudge.dormancy.no_login_60d.heading": "We'll leave you to it",
    "nudge.dormancy.no_login_60d.body": "{org_name} has been quiet for a couple of months, so this is the last of these for now. Everything you built stays exactly as it is, for whenever you want it.",
    "nudge.dormancy.no_login_60d.cta": "Open your dashboard",

    "nudge.dormancy.winback_q.subject": "What's new since you were last in {org_name}",
    "nudge.dormancy.winback_q.heading": "A few things have changed",
    "nudge.dormancy.winback_q.body": "It's been a while since you were in {org_name}. The product has moved on a fair bit since then, and everything you built is still there.",
    "nudge.dormancy.winback_q.cta": "Take a look",

    # -- milestone ---------------------------------------------------------
    "nudge.milestone.first_course_published.subject": "{course_name} is live",
    "nudge.milestone.first_course_published.heading": "You published your first course",
    "nudge.milestone.first_course_published.body": "{course_name} is live and readable. The next thing that makes a difference is having someone to read it — even one or two people to start.",
    "nudge.milestone.first_course_published.cta": "Invite your first learners",

    "nudge.milestone.first_learner_enrolled.subject": "Someone started {course_name}",
    "nudge.milestone.first_learner_enrolled.heading": "Your first learner is in",
    "nudge.milestone.first_learner_enrolled.body": "Someone has started a course in {org_name} for the first time. You can follow how they're getting on from your dashboard.",
    "nudge.milestone.first_learner_enrolled.cta": "See their progress",

    "nudge.milestone.first_completion.subject": "Someone finished a course in {org_name}",
    "nudge.milestone.first_completion.heading": "First completion",
    "nudge.milestone.first_completion.body": "A learner has finished a course in {org_name} end to end. If you want to mark that properly you can add a certificate — or start building what comes next.",
    "nudge.milestone.first_completion.cta": "Open your dashboard",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Your academy on {org_name} is still here",
    "nudge.reactivation.opener.heading": "Still here, exactly as you left it",
    "nudge.reactivation.opener.body": "Nobody has touched {org_name} since you were last in — every course, chapter and lesson is where you left it. If you want to pick it up again, it takes one click.",
    "nudge.reactivation.opener.cta": "Open your dashboard",
    "nudge.reactivation.whats_changed.subject": "A few things have changed on LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Since you were last here",
    "nudge.reactivation.whats_changed.body": "The product has moved on a fair bit while {org_name} has been quiet — the editor, the course tools and how learners work through material have all had real work. Everything you built still works exactly as before.",
    "nudge.reactivation.whats_changed.cta": "See what's new",
    "nudge.reactivation.need_a_hand.subject": "Need a hand getting back into {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "Is there something in the way?",
    "nudge.reactivation.need_a_hand.body": "If there was a reason {org_name} stalled — something confusing, something missing, or just no time — we'd genuinely like to hear it. Reply to this email and it comes straight to us.",
    "nudge.reactivation.closing.subject": "Last note about {org_name}",
    "nudge.reactivation.closing.heading": "We'll stop here",
    "nudge.reactivation.closing.body": "This is the last of these. {org_name} stays exactly as it is, and nothing expires — if you ever want to come back, everything will be waiting.",
    "nudge.reactivation.closing.cta": "Open your dashboard",
}
