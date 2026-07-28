"""Korean nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "이 이메일 수신 거부",
    "nudge.common.footer": "{org_name}의 관리자이기 때문에 이 이메일을 받았습니다.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "코스",
    "nudge.stat.chapters": "챕터",
    "nudge.stat.lessons": "레슨",
    "nudge.stat.members": "멤버",
    "nudge.stat.learners": "학습자",
    "nudge.stat.completed": "수료",

    "nudge.activation.first_course_d1.subject": "{org_name}의 첫 코스",
    "nudge.activation.first_course_d1.heading": "준비되셨을 때",
    "nudge.activation.first_course_d1.body": "{org_name} 설정이 끝나고 첫 코스를 기다리고 있습니다. 대부분 작게 시작합니다. 주제 하나, 레슨 몇 개. 나중에 얼마든지 늘릴 수 있습니다.",
    "nudge.activation.first_course_d1.cta": "첫 코스 만들기",

    "nudge.activation.come_back_d2.subject": "하시던 곳부터 이어서",
    "nudge.activation.come_back_d2.heading": "설정해 두신 것이 그대로 있습니다",
    "nudge.activation.come_back_d2.body": "{org_name}을 만드신 뒤로 아직 다시 오지 않으셨습니다. 모두 그대로 있고, 첫 코스를 공개하는 데는 10분쯤 걸립니다.",
    "nudge.activation.come_back_d2.cta": "대시보드로 가기",

    "nudge.activation.ai_course_help_d4.subject": "빈 화면이 가장 어렵습니다",
    "nudge.activation.ai_course_help_d4.heading": "개요는 AI에게 맡기세요",
    "nudge.activation.ai_course_help_d4.body": "어디서 시작할지 정하지 못해 {org_name}이 아직 비어 있다면, 주제만 적어 주시면 AI가 챕터와 레슨의 초안을 만듭니다. 이후 편집은 직접 하시면 됩니다.",
    "nudge.activation.ai_course_help_d4.cta": "AI로 코스 만들기",

    "nudge.activation.import_existing_d5.subject": "이미 가지고 계신 자료를 가져오세요",
    "nudge.activation.import_existing_d5.heading": "처음부터 만들 필요는 없습니다",
    "nudge.activation.import_existing_d5.body": "자료가 이미 문서나 슬라이드, 다른 플랫폼에서 내보낸 파일로 있다면 다시 입력하는 대신 {org_name}으로 가져올 수 있습니다.",
    "nudge.activation.import_existing_d5.cta": "자료 가져오기",

    "nudge.activation.setup_checklist_d7.subject": "15분이면 쓸 수 있는 아카데미가 됩니다",
    "nudge.activation.setup_checklist_d7.heading": "짧은 체크리스트",
    "nudge.activation.setup_checklist_d7.body": "{org_name}은 아직 첫 코스를 기다리고 있습니다. 설정 체크리스트가 몇 단계로 안내해 드리며, 대부분 15분 정도면 끝냅니다.",
    "nudge.activation.setup_checklist_d7.cta": "체크리스트 열기",

    "nudge.activation.whats_blocking_d14.subject": "무엇이 걸리셨나요?",
    "nudge.activation.whats_blocking_d14.heading": "무엇 때문에 멈추셨는지 여쭤봐도 될까요?",
    "nudge.activation.whats_blocking_d14.body": "{org_name}을 만드신 지 2주가 되었는데 아직 코스가 없습니다. 헷갈리거나 부족한 부분이 있었다면 알고 싶습니다. 이 메일에 그대로 답장해 주시면 저희에게 바로 전달됩니다.",

    "nudge.activation.last_call_d30.subject": "{org_name}에 대한 마지막 메일",
    "nudge.activation.last_call_d30.heading": "이번이 마지막입니다",
    "nudge.activation.last_call_d30.body": "{org_name}이 한 달째 조용해서 이런 메일은 여기서 멈추겠습니다. 계정과 그 안의 모든 것은 그대로 남으니, 돌아오시면 두고 가신 그대로입니다.",
    "nudge.activation.last_call_d30.cta": "대시보드 열기",

    "nudge.content.course_no_chapter_d1.subject": "'{course_name}'에 첫 챕터가 필요합니다",
    "nudge.content.course_no_chapter_d1.heading": "챕터 하나만 더",
    "nudge.content.course_no_chapter_d1.body": "'{course_name}'은 만들어졌지만 아직 챕터가 없어서 열어 볼 것이 없습니다. 챕터는 그저 구분일 뿐이고, 주제당 하나가 무난합니다.",
    "nudge.content.course_no_chapter_d1.cta": "챕터 추가하기",

    "nudge.content.chapter_no_activity_d1.subject": "'{course_name}'에 첫 레슨을 추가하세요",
    "nudge.content.chapter_no_activity_d1.heading": "챕터는 준비되었습니다",
    "nudge.content.chapter_no_activity_d1.body": "'{course_name}'에 챕터는 있지만 안이 아직 비어 있습니다. 레슨은 글 한 페이지, 영상, 퀴즈 등 주제에 맞는 무엇이든 됩니다.",
    "nudge.content.chapter_no_activity_d1.cta": "레슨 추가하기",

    "nudge.content.activity_unpublished_d2.subject": "'{course_name}'의 레슨이 아직 보이지 않습니다",
    "nudge.content.activity_unpublished_d2.heading": "레슨이 아직 숨겨져 있습니다",
    "nudge.content.activity_unpublished_d2.body": "'{course_name}'에 레슨을 작성하셨지만 공개된 것이 없어서 학습자에게는 빈 코스로 보입니다. 공개해도 잠기지 않으며 이후에도 계속 수정할 수 있습니다.",
    "nudge.content.activity_unpublished_d2.cta": "레슨 공개하기",

    "nudge.content.course_draft_d3.subject": "'{course_name}'이 아직 초안입니다",
    "nudge.content.course_draft_d3.heading": "'{course_name}'이 거의 다 되었습니다",
    "nudge.content.course_draft_d3.body": "'{course_name}'에 레슨을 추가하셨지만 공개되지 않아 아무도 열 수 없습니다. 완성될 필요는 없습니다. 공개는 보이게 할 뿐이고, 이후에도 계속 편집할 수 있습니다.",
    "nudge.content.course_draft_d3.cta": "공개하기",

    "nudge.content.course_draft_d10.subject": "'{course_name}'이 한동안 초안 상태입니다",
    "nudge.content.course_draft_d10.heading": "아마 준비되었을 겁니다",
    "nudge.content.course_draft_d10.body": "'{course_name}'이 일주일 넘게 공개되지 않은 채입니다. 코스가 다 됐다고 느껴지는 일은 드뭅니다. 공개하면 보이게 되고, 읽는 사람이 있는 동안에도 계속 다듬을 수 있습니다.",
    "nudge.content.course_draft_d10.cta": "공개하기",

    "nudge.content.thin_course_d5.subject": "'{course_name}'에 조금 더 채워 보세요",
    "nudge.content.thin_course_d5.heading": "레슨이 한두 개",
    "nudge.content.thin_course_d5.body": "'{course_name}'에는 지금 레슨이 한두 개 있습니다. 코스는 몇 개 더 있을 때 더 잘 전달되고, AI가 기존 내용을 바탕으로 다음 레슨 초안을 만들 수 있습니다.",
    "nudge.content.thin_course_d5.cta": "레슨 더 추가하기",

    "nudge.content.assignment_no_submissions_d5.subject": "{org_name}에 아직 제출물이 없습니다",
    "nudge.content.assignment_no_submissions_d5.heading": "아무도 제출하지 않았습니다",
    "nudge.content.assignment_no_submissions_d5.body": "{org_name}에 과제를 만드셨지만 제출된 것이 없습니다. 과제가 공개되어 있는지, 학습자가 해당 코스에 접근할 수 있는지 확인해 보시면 좋겠습니다.",
    "nudge.content.assignment_no_submissions_d5.cta": "과제 확인하기",

    "nudge.audience.published_no_members_d1.subject": "'{course_name}'은 공개됐지만 아직 아무도 없습니다",
    "nudge.audience.published_no_members_d1.heading": "이제 누군가를 초대할 때입니다",
    "nudge.audience.published_no_members_d1.body": "'{course_name}'이 공개되어 읽을 수 있습니다. {org_name}에는 아직 학습자가 없으니, 다음 단계는 이 코스를 위해 쓰신 그분들을 초대하는 것입니다.",
    "nudge.audience.published_no_members_d1.cta": "학습자 초대하기",

    "nudge.audience.published_no_members_d7.subject": "'{course_name}'에 아직 학습자가 없습니다",
    "nudge.audience.published_no_members_d7.heading": "공개한 지 일주일, 아무도 읽지 않았습니다",
    "nudge.audience.published_no_members_d7.body": "'{course_name}'을 공개한 지 일주일이 지났지만 {org_name}에는 여전히 학습자가 없습니다. 한 명씩 초대해도 되고, 명단을 붙여넣거나 참여 링크를 공유해도 됩니다.",
    "nudge.audience.published_no_members_d7.cta": "사람들 초대하기",

    "nudge.audience.members_no_enrollment_d3.subject": "학습자들이 아직 시작하지 않았습니다",
    "nudge.audience.members_no_enrollment_d3.heading": "가입은 했지만 아무것도 열지 않았습니다",
    "nudge.audience.members_no_enrollment_d3.body": "{org_name}에 가입한 분들은 있지만 아직 아무도 코스를 시작하지 않았습니다. 직접 링크가 담긴 짧은 메시지면 대개 움직입니다. 대부분은 입구를 못 찾았을 뿐입니다.",
    "nudge.audience.members_no_enrollment_d3.cta": "멤버 보기",

    "nudge.audience.share_public_page_d14.subject": "코스 페이지가 공개 상태입니다 — 링크는 여기 있습니다",
    "nudge.audience.share_public_page_d14.heading": "링크만 있으면 누구나 읽을 수 있습니다",
    "nudge.audience.share_public_page_d14.body": "'{course_name}'은 공개 설정이라 초대 없이도 어디에나 공유할 수 있습니다. 아래 링크가 그대로 보내시면 되는 주소입니다.",
    "nudge.audience.share_public_page_d14.cta": "공개 페이지 보기",

    "nudge.audience.stalled_learners_d14.subject": "중간에 멈춘 학습자가 있습니다",
    "nudge.audience.stalled_learners_d14.heading": "몇 분이 멈춰 있습니다",
    "nudge.audience.stalled_learners_d14.body": "{org_name}의 일부 학습자가 코스를 시작한 뒤 2주째 돌아오지 않고 있습니다. 짧은 연락이 도움이 될 때가 많고, 어디서 멈췄는지 살펴보는 것도 좋습니다.",
    "nudge.audience.stalled_learners_d14.cta": "학습자 확인하기",

    "nudge.monetization.course_limit_d1.subject": "{plan_name} 플랜의 코스를 모두 사용하셨습니다",
    "nudge.monetization.course_limit_d1.heading": "코스 한도에 도달했습니다",
    "nudge.monetization.course_limit_d1.body": "{org_name}은 {plan_name} 플랜이며 포함된 코스를 모두 사용했습니다. 계속 만들고 싶으시다면 {next_plan}으로 올리면 이 한도가 사라집니다.",
    "nudge.monetization.course_limit_d1.cta": "플랜 보기",

    "nudge.monetization.member_limit_near.subject": "{plan_name} 플랜의 멤버 한도에 가까워졌습니다",
    "nudge.monetization.member_limit_near.heading": "멤버 한도가 얼마 남지 않았습니다",
    "nudge.monetization.member_limit_near.body": "{org_name}이 {plan_name} 플랜에서 허용하는 멤버 수에 가까워지고 있습니다. {next_plan}으로 올리면 한도가 늘어나 가입 도중에 막히는 분이 생기지 않습니다.",
    "nudge.monetization.member_limit_near.cta": "플랜 보기",

    "nudge.monetization.ai_credits_low.subject": "AI 크레딧이 거의 소진되었습니다",
    "nudge.monetization.ai_credits_low.heading": "AI 크레딧이 얼마 남지 않았습니다",
    "nudge.monetization.ai_credits_low.body": "{org_name}이 {plan_name} 플랜에 포함된 AI 크레딧을 대부분 사용했습니다. AI가 코스를 만드는 방식의 일부가 되었다면 {next_plan} 플랜에는 더 많이 포함되어 있습니다.",
    "nudge.monetization.ai_credits_low.cta": "플랜 보기",

    "nudge.monetization.upgrade_recap_d21.subject": "{next_plan}이 {org_name}에 더해 줄 것",
    "nudge.monetization.upgrade_recap_d21.heading": "제대로 된 것을 만드셨습니다",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name}에는 공개된 코스와 그것을 읽는 사람들이 있습니다. {next_plan} 플랜은 성장할 여유와 {plan_name} 플랜에 없는 몇 가지를 제공합니다. 확장을 생각 중이라면 볼 만합니다.",
    "nudge.monetization.upgrade_recap_d21.cta": "플랜 비교하기",

    "nudge.dormancy.no_login_14d.subject": "{org_name}이 조용했습니다",
    "nudge.dormancy.no_login_14d.heading": "2주쯤 지났습니다",
    "nudge.dormancy.no_login_14d.body": "마지막으로 다녀가신 뒤 {org_name}에는 달라진 것이 없습니다. 하시던 중이었다면 두고 가신 그 자리에 그대로 있습니다.",
    "nudge.dormancy.no_login_14d.cta": "대시보드 열기",

    "nudge.dormancy.no_login_30d.subject": "{org_name}의 코스는 그대로 있습니다",
    "nudge.dormancy.no_login_30d.heading": "몇 주가 지났습니다",
    "nudge.dormancy.no_login_30d.body": "안 계신 동안 달라진 것은 없습니다. {org_name}과 그 안의 모든 것이 두고 가신 그대로입니다. 다시 시작하는 데는 클릭 한 번이면 됩니다.",
    "nudge.dormancy.no_login_30d.cta": "대시보드 열기",

    "nudge.dormancy.no_login_60d.subject": "{org_name}에 대한 마지막 안부",
    "nudge.dormancy.no_login_60d.heading": "이만 물러나겠습니다",
    "nudge.dormancy.no_login_60d.body": "{org_name}이 두 달째 조용해서 당분간 이런 메일은 이번이 마지막입니다. 만들어 두신 것은 그대로 남아 있으니 필요하실 때 쓰시면 됩니다.",
    "nudge.dormancy.no_login_60d.cta": "대시보드 열기",

    "nudge.dormancy.winback_q.subject": "{org_name}에 마지막으로 오신 뒤 달라진 점",
    "nudge.dormancy.winback_q.heading": "몇 가지가 바뀌었습니다",
    "nudge.dormancy.winback_q.body": "{org_name}에 다녀가신 지 꽤 되었습니다. 그동안 제품이 상당히 나아졌고, 만들어 두신 것은 모두 그대로 있습니다.",
    "nudge.dormancy.winback_q.cta": "둘러보기",

    "nudge.milestone.first_course_published.subject": "'{course_name}'이 공개되었습니다",
    "nudge.milestone.first_course_published.heading": "첫 코스를 공개하셨습니다",
    "nudge.milestone.first_course_published.body": "'{course_name}'이 공개되어 읽을 수 있습니다. 이제 차이를 만드는 것은 읽어 줄 사람입니다. 처음에는 한두 명이라도 좋습니다.",
    "nudge.milestone.first_course_published.cta": "첫 학습자 초대하기",

    "nudge.milestone.first_learner_enrolled.subject": "누군가 '{course_name}'을 시작했습니다",
    "nudge.milestone.first_learner_enrolled.heading": "첫 학습자가 들어왔습니다",
    "nudge.milestone.first_learner_enrolled.body": "{org_name}에서 처음으로 누군가 코스를 시작했습니다. 진행 상황은 대시보드에서 확인하실 수 있습니다.",
    "nudge.milestone.first_learner_enrolled.cta": "진행 상황 보기",

    "nudge.milestone.first_completion.subject": "누군가 {org_name}의 코스를 끝냈습니다",
    "nudge.milestone.first_completion.heading": "첫 수료",
    "nudge.milestone.first_completion.body": "한 학습자가 {org_name}의 코스를 처음부터 끝까지 마쳤습니다. 제대로 남기고 싶으시면 수료증을 추가하실 수 있고, 다음 코스를 시작하셔도 좋습니다.",
    "nudge.milestone.first_completion.cta": "대시보드 열기",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "{org_name}의 아카데미는 그대로 있습니다",
    "nudge.reactivation.opener.heading": "두고 가신 그대로입니다",
    "nudge.reactivation.opener.body": "마지막으로 다녀가신 뒤 {org_name}은 아무도 건드리지 않았습니다. 코스도 챕터도 레슨도 모두 그 자리에 있습니다. 다시 시작하는 데는 클릭 한 번이면 됩니다.",
    "nudge.reactivation.opener.cta": "대시보드 열기",
    "nudge.reactivation.whats_changed.subject": "LearnHouse에 몇 가지가 바뀌었습니다",
    "nudge.reactivation.whats_changed.heading": "마지막으로 오신 뒤로",
    "nudge.reactivation.whats_changed.body": "{org_name}이 조용한 사이 제품이 꽤 나아졌습니다. 에디터와 코스 도구, 학습자의 진행 방식에 실질적인 변화가 있었습니다. 만들어 두신 것은 예전 그대로 동작합니다.",
    "nudge.reactivation.whats_changed.cta": "달라진 점 보기",
    "nudge.reactivation.need_a_hand.subject": "{org_name}으로 돌아오시는 데 도움이 필요하신가요?",
    "nudge.reactivation.need_a_hand.heading": "무엇이 걸리셨나요?",
    "nudge.reactivation.need_a_hand.body": "{org_name}이 멈춘 이유가 있었다면 — 헷갈리는 부분, 빠진 기능, 아니면 그저 시간 — 정말 듣고 싶습니다. 이 메일에 그대로 답장해 주시면 저희에게 바로 전달됩니다.",
    "nudge.reactivation.closing.subject": "{org_name}에 대한 마지막 안내",
    "nudge.reactivation.closing.heading": "여기서 멈추겠습니다",
    "nudge.reactivation.closing.body": "이런 메일은 이번이 마지막입니다. {org_name}은 그대로 남고 만료되는 것도 없습니다. 언제든 돌아오고 싶으시면 모두 그대로 기다리고 있습니다.",
    "nudge.reactivation.closing.cta": "대시보드 열기",
}
