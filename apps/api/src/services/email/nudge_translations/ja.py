"""Japanese nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "このメールの配信を停止する",
    "nudge.common.footer": "{org_name} の管理者であるため、このメールが届いています。",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "コース",
    "nudge.stat.chapters": "章",
    "nudge.stat.lessons": "レッスン",
    "nudge.stat.members": "メンバー",
    "nudge.stat.learners": "受講者",
    "nudge.stat.completed": "修了",

    "nudge.activation.first_course_d1.subject": "{org_name} での最初のコース",
    "nudge.activation.first_course_d1.heading": "準備ができたときに",
    "nudge.activation.first_course_d1.body": "{org_name} の設定は完了し、最初のコースを待っています。多くの方は小さく始めます。テーマを一つ、レッスンを数本。あとから足していけます。",
    "nudge.activation.first_course_d1.cta": "最初のコースを作る",

    "nudge.activation.come_back_d2.subject": "続きから再開しませんか",
    "nudge.activation.come_back_d2.heading": "設定はそのまま残っています",
    "nudge.activation.come_back_d2.body": "{org_name} を作成したあと、まだ戻られていません。設定はすべて残っており、最初のコースを公開するまでは十分ほどです。",
    "nudge.activation.come_back_d2.cta": "ダッシュボードへ",

    "nudge.activation.ai_course_help_d4.subject": "白紙が一番むずかしい",
    "nudge.activation.ai_course_help_d4.heading": "構成はAIに任せる",
    "nudge.activation.ai_course_help_d4.body": "何から始めるか決まらず {org_name} がまだ空のままなら、テーマを書くだけでAIが章とレッスンの下書きを作ります。そこからの編集はご自身で。",
    "nudge.activation.ai_course_help_d4.cta": "AIでコースを作る",

    "nudge.activation.import_existing_d5.subject": "すでにある教材を持ち込む",
    "nudge.activation.import_existing_d5.heading": "ゼロから始める必要はありません",
    "nudge.activation.import_existing_d5.body": "資料やスライド、他サービスからの書き出しがすでにあるなら、打ち直さずそのまま {org_name} に取り込めます。",
    "nudge.activation.import_existing_d5.cta": "教材をインポートする",

    "nudge.activation.setup_checklist_d7.subject": "15分で使えるアカデミーに",
    "nudge.activation.setup_checklist_d7.heading": "短いチェックリスト",
    "nudge.activation.setup_checklist_d7.body": "{org_name} はまだ最初のコースを待っています。セットアップのチェックリストが数ステップで案内します。多くの方は15分ほどで終わります。",
    "nudge.activation.setup_checklist_d7.cta": "チェックリストを開く",

    "nudge.activation.whats_blocking_d14.subject": "何かつまずきましたか",
    "nudge.activation.whats_blocking_d14.heading": "何が止めてしまったか、伺えますか",
    "nudge.activation.whats_blocking_d14.body": "{org_name} を作成されてから2週間ほど経ちますが、まだコースが追加されていません。分かりにくい点や足りない点があれば知りたいので、このメールにそのまま返信してください。私たちに直接届きます。",

    "nudge.activation.last_call_d30.subject": "{org_name} に関する最後のメール",
    "nudge.activation.last_call_d30.heading": "これが最後です",
    "nudge.activation.last_call_d30.body": "{org_name} は1か月動きがないため、この種のメールは停止します。アカウントと中身はそのまま残りますので、戻られたときには元のままです。",
    "nudge.activation.last_call_d30.cta": "ダッシュボードを開く",

    "nudge.content.course_no_chapter_d1.subject": "「{course_name}」に最初の章を",
    "nudge.content.course_no_chapter_d1.heading": "あと章がひとつ",
    "nudge.content.course_no_chapter_d1.body": "「{course_name}」はありますが章がまだないため、開くものがありません。章は単なる区切りで、テーマごとに一つが扱いやすいです。",
    "nudge.content.course_no_chapter_d1.cta": "章を追加する",

    "nudge.content.chapter_no_activity_d1.subject": "「{course_name}」に最初のレッスンを",
    "nudge.content.chapter_no_activity_d1.heading": "章の準備はできています",
    "nudge.content.chapter_no_activity_d1.body": "「{course_name}」には章がありますが、中身がまだ空です。レッスンはテキストのページでも、動画でも、小テストでも、テーマに合うもので構いません。",
    "nudge.content.chapter_no_activity_d1.cta": "レッスンを追加する",

    "nudge.content.activity_unpublished_d2.subject": "「{course_name}」のレッスンがまだ表示されません",
    "nudge.content.activity_unpublished_d2.heading": "レッスンは非公開のままです",
    "nudge.content.activity_unpublished_d2.body": "「{course_name}」にレッスンを書かれていますが、どれも公開されていないため、受講者には空のコースが見えています。公開しても固定されるわけではなく、あとから編集できます。",
    "nudge.content.activity_unpublished_d2.cta": "レッスンを公開する",

    "nudge.content.course_draft_d3.subject": "「{course_name}」はまだ下書きです",
    "nudge.content.course_draft_d3.heading": "「{course_name}」はもう少しで公開できます",
    "nudge.content.course_draft_d3.body": "「{course_name}」にレッスンを追加されましたが、まだ公開されていないため誰も開けません。完成している必要はありません。公開は見えるようにするだけで、そのあとも編集できます。",
    "nudge.content.course_draft_d3.cta": "公開する",

    "nudge.content.course_draft_d10.subject": "「{course_name}」が下書きのままです",
    "nudge.content.course_draft_d10.heading": "おそらくもう十分です",
    "nudge.content.course_draft_d10.body": "「{course_name}」は1週間以上、未公開のままです。コースが完成したと感じられることはめったにありません。公開すれば見えるようになり、読まれながら改善していけます。",
    "nudge.content.course_draft_d10.cta": "公開する",

    "nudge.content.thin_course_d5.subject": "「{course_name}」にもう少し中身を",
    "nudge.content.thin_course_d5.heading": "レッスンが1、2本",
    "nudge.content.thin_course_d5.body": "「{course_name}」には今のところレッスンが1、2本です。コースはいくつか揃うと伝わりやすくなります。AIが既存の内容から次のレッスンを下書きできます。",
    "nudge.content.thin_course_d5.cta": "レッスンを追加する",

    "nudge.content.assignment_no_submissions_d5.subject": "{org_name} でまだ提出がありません",
    "nudge.content.assignment_no_submissions_d5.heading": "誰も提出していません",
    "nudge.content.assignment_no_submissions_d5.body": "{org_name} で課題を作成されましたが、提出がまだありません。公開されているか、受講者が該当コースにアクセスできるかを確認してみてください。",
    "nudge.content.assignment_no_submissions_d5.cta": "課題を確認する",

    "nudge.audience.published_no_members_d1.subject": "「{course_name}」は公開済みですが、まだ誰もいません",
    "nudge.audience.published_no_members_d1.heading": "誰かを招待するころあいです",
    "nudge.audience.published_no_members_d1.body": "「{course_name}」は公開され、読める状態です。{org_name} にはまだ受講者がいないので、次は書いた相手を招待することです。",
    "nudge.audience.published_no_members_d1.cta": "受講者を招待する",

    "nudge.audience.published_no_members_d7.subject": "「{course_name}」にまだ受講者がいません",
    "nudge.audience.published_no_members_d7.heading": "公開から1週間、読まれていません",
    "nudge.audience.published_no_members_d7.body": "「{course_name}」を公開して1週間経ちますが、{org_name} にはまだ受講者がいません。個別に招待しても、リストを貼り付けても、参加リンクを共有するだけでも構いません。",
    "nudge.audience.published_no_members_d7.cta": "招待する",

    "nudge.audience.members_no_enrollment_d3.subject": "受講者がまだ始めていません",
    "nudge.audience.members_no_enrollment_d3.heading": "参加はしたものの、何も開いていません",
    "nudge.audience.members_no_enrollment_d3.body": "{org_name} に参加した方はいますが、まだ誰もコースを始めていません。直接のリンクを添えた短いメッセージでたいてい動きます。多くは入口が分からないだけです。",
    "nudge.audience.members_no_enrollment_d3.cta": "メンバーを見る",

    "nudge.audience.share_public_page_d14.subject": "コースページは公開中です。リンクはこちら",
    "nudge.audience.share_public_page_d14.heading": "リンクがあれば誰でも読めます",
    "nudge.audience.share_public_page_d14.body": "「{course_name}」は公開設定なので、招待なしでどこにでも共有できます。下のリンクがそのまま送れるものです。",
    "nudge.audience.share_public_page_d14.cta": "公開ページを見る",

    "nudge.audience.stalled_learners_d14.subject": "途中で止まっている受講者がいます",
    "nudge.audience.stalled_learners_d14.heading": "何人か止まっています",
    "nudge.audience.stalled_learners_d14.body": "{org_name} の受講者の何人かがコースを始めたまま、2週間ほど戻っていません。ひとこと声をかけるか、どこで止まったかを見てみると効果的です。",
    "nudge.audience.stalled_learners_d14.cta": "受講者を確認する",

    "nudge.monetization.course_limit_d1.subject": "{plan_name} プランのコース枠を使い切りました",
    "nudge.monetization.course_limit_d1.heading": "コース数の上限に達しました",
    "nudge.monetization.course_limit_d1.body": "{org_name} は {plan_name} プランで、含まれるコース枠をすべて使い切りました。作り続けるなら、{next_plan} プランに上げるとこの上限がなくなります。",
    "nudge.monetization.course_limit_d1.cta": "プランを見る",

    "nudge.monetization.member_limit_near.subject": "{plan_name} プランのメンバー上限が近づいています",
    "nudge.monetization.member_limit_near.heading": "メンバー上限まであとわずか",
    "nudge.monetization.member_limit_near.body": "{org_name} は {plan_name} プランで認められたメンバー数に近づいています。{next_plan} プランに上げれば枠が増え、登録の途中で断られる方が出ずにすみます。",
    "nudge.monetization.member_limit_near.cta": "プランを見る",

    "nudge.monetization.ai_credits_low.subject": "AIクレジットが残りわずかです",
    "nudge.monetization.ai_credits_low.heading": "AIクレジットが少なくなっています",
    "nudge.monetization.ai_credits_low.body": "{org_name} は {plan_name} プランに含まれるAIクレジットの大半を使いました。AIがコース作りの一部になっているなら、{next_plan} プランにはより多く含まれています。",
    "nudge.monetization.ai_credits_low.cta": "プランを見る",

    "nudge.monetization.upgrade_recap_d21.subject": "{next_plan} が {org_name} にもたらすもの",
    "nudge.monetization.upgrade_recap_d21.heading": "確かなものを築かれました",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} には公開済みのコースと、それを読む方がいます。{next_plan} プランには広げる余地と、{plan_name} プランにはない機能がいくつかあります。拡大をお考えなら見てみる価値があります。",
    "nudge.monetization.upgrade_recap_d21.cta": "プランを比較する",

    "nudge.dormancy.no_login_14d.subject": "{org_name} が静かなままです",
    "nudge.dormancy.no_login_14d.heading": "2週間ほど経ちました",
    "nudge.dormancy.no_login_14d.body": "前回いらしてから {org_name} に変化はありません。途中だったものがあれば、そのままの状態で残っています。",
    "nudge.dormancy.no_login_14d.cta": "ダッシュボードを開く",

    "nudge.dormancy.no_login_30d.subject": "{org_name} のコースはそのままあります",
    "nudge.dormancy.no_login_30d.heading": "数週間が経ちました",
    "nudge.dormancy.no_login_30d.body": "留守のあいだに変わったことはありません。{org_name} も中身も、置いていかれたそのままです。再開はワンクリックです。",
    "nudge.dormancy.no_login_30d.cta": "ダッシュボードを開く",

    "nudge.dormancy.no_login_60d.subject": "{org_name} についての最後のご連絡",
    "nudge.dormancy.no_login_60d.heading": "ここでいったん失礼します",
    "nudge.dormancy.no_login_60d.body": "{org_name} は2か月ほど動きがないため、この種のご連絡はこれで最後にします。作られたものはそのまま残りますので、必要になったときにお使いください。",
    "nudge.dormancy.no_login_60d.cta": "ダッシュボードを開く",

    "nudge.dormancy.winback_q.subject": "前回 {org_name} をご覧になってからの変更点",
    "nudge.dormancy.winback_q.heading": "いくつか変わりました",
    "nudge.dormancy.winback_q.body": "{org_name} をご覧になってからしばらく経ちました。その間に製品はかなり進み、作られたものはすべてそのまま残っています。",
    "nudge.dormancy.winback_q.cta": "見てみる",

    "nudge.milestone.first_course_published.subject": "「{course_name}」を公開しました",
    "nudge.milestone.first_course_published.heading": "最初のコースが公開されました",
    "nudge.milestone.first_course_published.body": "「{course_name}」は公開され、読める状態です。ここから効いてくるのは読む人がいることです。まずは1人か2人でも構いません。",
    "nudge.milestone.first_course_published.cta": "最初の受講者を招待する",

    "nudge.milestone.first_learner_enrolled.subject": "「{course_name}」を始めた方がいます",
    "nudge.milestone.first_learner_enrolled.heading": "最初の受講者が入りました",
    "nudge.milestone.first_learner_enrolled.body": "{org_name} で初めてコースを始めた方が出ました。進み具合はダッシュボードから追えます。",
    "nudge.milestone.first_learner_enrolled.cta": "進捗を見る",

    "nudge.milestone.first_completion.subject": "{org_name} でコースを修了した方がいます",
    "nudge.milestone.first_completion.heading": "はじめての修了",
    "nudge.milestone.first_completion.body": "受講者が {org_name} のコースを最後まで終えました。きちんと形にするなら修了証を追加できますし、次のコースに取りかかることもできます。",
    "nudge.milestone.first_completion.cta": "ダッシュボードを開く",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "{org_name} のアカデミーはそのまま残っています",
    "nudge.reactivation.opener.heading": "そのまま、置いていかれた状態で",
    "nudge.reactivation.opener.body": "前回いらしてから {org_name} には誰も手を触れていません。コースも章もレッスンも、すべて残っています。再開はワンクリックです。",
    "nudge.reactivation.opener.cta": "ダッシュボードを開く",
    "nudge.reactivation.whats_changed.subject": "LearnHouse でいくつか変わりました",
    "nudge.reactivation.whats_changed.heading": "前回のご訪問から",
    "nudge.reactivation.whats_changed.body": "{org_name} が静かなあいだに製品はかなり進みました。エディター、コース作成まわり、受講者の進み方に手が入っています。作られたものはこれまでどおり動きます。",
    "nudge.reactivation.whats_changed.cta": "変更点を見る",
    "nudge.reactivation.need_a_hand.subject": "{org_name} に戻るお手伝いをしましょうか",
    "nudge.reactivation.need_a_hand.heading": "何か引っかかりましたか",
    "nudge.reactivation.need_a_hand.body": "{org_name} が止まった理由があれば — 分かりにくかった、足りなかった、単に時間がなかった — ぜひ伺いたいです。このメールにそのまま返信してください。私たちに直接届きます。",
    "nudge.reactivation.closing.subject": "{org_name} についての最後のご連絡",
    "nudge.reactivation.closing.heading": "ここで失礼します",
    "nudge.reactivation.closing.body": "この種のご連絡はこれで最後です。{org_name} はそのまま残り、期限もありません。戻りたくなったときには、すべてお待ちしています。",
    "nudge.reactivation.closing.cta": "ダッシュボードを開く",
}
