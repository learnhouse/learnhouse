"""Copy for the emails LearnHouse sends an org's admins about their own plan:
the trial sequence and the notice when the org moves to the Free plan.

Merged into the shared email bundle (same ``t()`` lookup, English fallback per
key). Conventions, as for the nudges: plain subjects, no emoji, no manufactured
urgency, say what changes for the learners, one action per email. Plan names,
day counts and dates arrive as placeholders: ``{org_name}``, ``{plan_name}``,
``{days}``, ``{end_date}``.
"""

from typing import Final

PLAN_EMAIL_TRANSLATIONS: Final[dict[str, dict[str, str]]] = {
    "en": {
        "plan_email.common.footer": "You're receiving this because you're an admin of {org_name} on LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} has every {plan_name} feature for {days} days",
        "plan_email.trial_welcome.heading": "Everything is unlocked for {days} days",
        "plan_email.trial_welcome.body": "For the next {days} days, {org_name} runs on {plan_name}: certificates your learners can share, learning paths, live sessions, analytics and your own domain. No card needed. The quickest way to see what it changes is to publish one course and invite a few learners.",
        "plan_email.trial_welcome.cta": "Go to your courses",

        "plan_email.trial_tips.subject": "What keeps learners coming back",
        "plan_email.trial_tips.heading": "Three things that keep learners coming back",
        "plan_email.trial_tips.body": "Academies whose learners finish their courses tend to do three things early: hand out a certificate when a course is done, group courses into a path so people know what to take next, and check analytics to see where learners stop. All three are part of your trial.",
        "plan_email.trial_tips.cta": "Open your courses",

        "plan_email.trial_ends_3d.subject": "Your {plan_name} trial ends in {days} days",
        "plan_email.trial_ends_3d.heading": "{days} days left on {plan_name}",
        "plan_email.trial_ends_3d.body": "On {end_date}, {org_name} moves to the Free plan unless you choose a plan. Nothing is deleted: one course stays public, the others become private, and {plan_name} features pause until you upgrade.",
        "plan_email.trial_ends_3d.cta": "Choose a plan",

        "plan_email.trial_ends_1d.subject": "Your {plan_name} trial ends tomorrow",
        "plan_email.trial_ends_1d.heading": "Your trial ends tomorrow",
        "plan_email.trial_ends_1d.body": "If your learners rely on certificates, paths or live sessions, choose a plan today and nothing changes for them. If you do nothing, {org_name} moves to Free: your content stays, one course stays public and the others wait, private, until you upgrade.",
        "plan_email.trial_ends_1d.cta": "Keep {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} is on the Free plan now",
        "plan_email.trial_ended.heading": "Your {plan_name} trial has ended",
        "plan_email.trial_ended.body": "Nothing was deleted. One course stays public, your other courses are private for now, and {plan_name} features are paused. Choose a plan and everything comes back the way it was, course visibility included.",
        "plan_email.trial_ended.cta": "Choose a plan",

        "plan_email.plan_downgraded.subject": "{org_name} is on the Free plan now",
        "plan_email.plan_downgraded.heading": "You're on the Free plan",
        "plan_email.plan_downgraded.body": "Your {plan_name} subscription has ended. Nothing was deleted: one course stays public, your other courses are private for now, and {plan_name} features are paused. Upgrade again and everything comes back the way it was.",
        "plan_email.plan_downgraded.cta": "See your plan",
    },
    "fr": {
        "plan_email.common.footer": "Vous recevez cet e-mail parce que vous êtes administrateur de {org_name} sur LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} profite de toutes les fonctionnalités {plan_name} pendant {days} jours",
        "plan_email.trial_welcome.heading": "Tout est débloqué pendant {days} jours",
        "plan_email.trial_welcome.body": "Pendant les {days} prochains jours, {org_name} fonctionne avec {plan_name} : des certificats que vos apprenants peuvent partager, des parcours, des sessions en direct, des statistiques et votre propre domaine. Aucune carte bancaire n'est nécessaire. Le plus simple pour voir la différence, c'est de publier un cours et d'inviter quelques apprenants.",
        "plan_email.trial_welcome.cta": "Accéder à vos cours",

        "plan_email.trial_tips.subject": "Ce qui fait revenir les apprenants",
        "plan_email.trial_tips.heading": "Trois choses qui font revenir les apprenants",
        "plan_email.trial_tips.body": "Les académies dont les apprenants terminent leurs cours font souvent trois choses dès le début : remettre un certificat à la fin d'un cours, regrouper les cours en parcours pour que chacun sache quoi suivre ensuite, et consulter les statistiques pour voir où les apprenants s'arrêtent. Ces trois éléments font partie de votre essai.",
        "plan_email.trial_tips.cta": "Ouvrir vos cours",

        "plan_email.trial_ends_3d.subject": "Votre essai {plan_name} se termine dans {days} jours",
        "plan_email.trial_ends_3d.heading": "Plus que {days} jours de {plan_name}",
        "plan_email.trial_ends_3d.body": "Le {end_date}, {org_name} passera à la formule Free si vous ne choisissez pas de formule. Rien n'est supprimé : un cours reste public, les autres deviennent privés, et les fonctionnalités {plan_name} sont mises en pause jusqu'à ce que vous changiez de formule.",
        "plan_email.trial_ends_3d.cta": "Choisir une formule",

        "plan_email.trial_ends_1d.subject": "Votre essai {plan_name} se termine demain",
        "plan_email.trial_ends_1d.heading": "Votre essai se termine demain",
        "plan_email.trial_ends_1d.body": "Si vos apprenants utilisent les certificats, les parcours ou les sessions en direct, choisissez une formule aujourd'hui et rien ne changera pour eux. Si vous ne faites rien, {org_name} passera à la formule Free : votre contenu est conservé, un cours reste public et les autres restent privés en attendant que vous changiez de formule.",
        "plan_email.trial_ends_1d.cta": "Garder {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} est désormais sur la formule Free",
        "plan_email.trial_ended.heading": "Votre essai {plan_name} est terminé",
        "plan_email.trial_ended.body": "Rien n'a été supprimé. Un cours reste public, vos autres cours sont privés pour le moment, et les fonctionnalités {plan_name} sont en pause. Choisissez une formule et tout redevient comme avant, y compris la visibilité des cours.",
        "plan_email.trial_ended.cta": "Choisir une formule",

        "plan_email.plan_downgraded.subject": "{org_name} est désormais sur la formule Free",
        "plan_email.plan_downgraded.heading": "Vous êtes sur la formule Free",
        "plan_email.plan_downgraded.body": "Votre abonnement {plan_name} a pris fin. Rien n'a été supprimé : un cours reste public, vos autres cours sont privés pour le moment, et les fonctionnalités {plan_name} sont en pause. Reprenez une formule payante et tout redevient comme avant.",
        "plan_email.plan_downgraded.cta": "Voir votre formule",
    },
    "de": {
        "plan_email.common.footer": "Du erhältst diese E-Mail, weil du Admin von {org_name} auf LearnHouse bist.",

        "plan_email.trial_welcome.subject": "{org_name} hat {days} Tage lang alle {plan_name}-Funktionen",
        "plan_email.trial_welcome.heading": "{days} Tage lang ist alles freigeschaltet",
        "plan_email.trial_welcome.body": "In den nächsten {days} Tagen läuft {org_name} mit {plan_name}: Zertifikate, die deine Lernenden teilen können, Lernpfade, Live-Sessions, Analysen und deine eigene Domain. Keine Kreditkarte nötig. Am schnellsten siehst du den Unterschied, wenn du einen Kurs veröffentlichst und ein paar Lernende einlädst.",
        "plan_email.trial_welcome.cta": "Zu deinen Kursen",

        "plan_email.trial_tips.subject": "Was Lernende zurückkommen lässt",
        "plan_email.trial_tips.heading": "Drei Dinge, die Lernende zurückkommen lassen",
        "plan_email.trial_tips.body": "Akademien, deren Lernende ihre Kurse abschließen, machen meist früh drei Dinge: Sie vergeben ein Zertifikat, wenn ein Kurs abgeschlossen ist, fassen Kurse zu einem Lernpfad zusammen, damit klar ist, was als Nächstes kommt, und schauen in die Analysen, um zu sehen, wo Lernende aufhören. Alle drei sind Teil deiner Testphase.",
        "plan_email.trial_tips.cta": "Kurse öffnen",

        "plan_email.trial_ends_3d.subject": "Deine {plan_name}-Testphase endet in {days} Tagen",
        "plan_email.trial_ends_3d.heading": "Noch {days} Tage {plan_name}",
        "plan_email.trial_ends_3d.body": "Am {end_date} wechselt {org_name} in den Free-Plan, wenn du keinen Plan wählst. Es wird nichts gelöscht: Ein Kurs bleibt öffentlich, die anderen werden privat, und die {plan_name}-Funktionen pausieren, bis du upgradest.",
        "plan_email.trial_ends_3d.cta": "Plan wählen",

        "plan_email.trial_ends_1d.subject": "Deine {plan_name}-Testphase endet morgen",
        "plan_email.trial_ends_1d.heading": "Deine Testphase endet morgen",
        "plan_email.trial_ends_1d.body": "Wenn deine Lernenden Zertifikate, Lernpfade oder Live-Sessions nutzen, wähle heute einen Plan, dann ändert sich für sie nichts. Wenn du nichts tust, wechselt {org_name} zu Free: Deine Inhalte bleiben, ein Kurs bleibt öffentlich und die anderen warten privat, bis du upgradest.",
        "plan_email.trial_ends_1d.cta": "{plan_name} behalten",

        "plan_email.trial_ended.subject": "{org_name} ist jetzt im Free-Plan",
        "plan_email.trial_ended.heading": "Deine {plan_name}-Testphase ist beendet",
        "plan_email.trial_ended.body": "Es wurde nichts gelöscht. Ein Kurs bleibt öffentlich, deine anderen Kurse sind vorerst privat, und die {plan_name}-Funktionen sind pausiert. Wähle einen Plan, und alles ist wieder wie vorher, auch die Sichtbarkeit der Kurse.",
        "plan_email.trial_ended.cta": "Plan wählen",

        "plan_email.plan_downgraded.subject": "{org_name} ist jetzt im Free-Plan",
        "plan_email.plan_downgraded.heading": "Du bist jetzt im Free-Plan",
        "plan_email.plan_downgraded.body": "Dein {plan_name}-Abo ist beendet. Es wurde nichts gelöscht: Ein Kurs bleibt öffentlich, deine anderen Kurse sind vorerst privat, und die {plan_name}-Funktionen sind pausiert. Wenn du wieder upgradest, ist alles wie vorher.",
        "plan_email.plan_downgraded.cta": "Deinen Plan ansehen",
    },
    "es": {
        "plan_email.common.footer": "Recibes este correo porque administras {org_name} en LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} tiene todas las funciones de {plan_name} durante {days} días",
        "plan_email.trial_welcome.heading": "Todo desbloqueado durante {days} días",
        "plan_email.trial_welcome.body": "Durante los próximos {days} días, {org_name} funciona con {plan_name}: certificados que tus estudiantes pueden compartir, rutas de aprendizaje, sesiones en directo, analíticas y tu propio dominio. No hace falta tarjeta. La forma más rápida de ver la diferencia es publicar un curso e invitar a algunos estudiantes.",
        "plan_email.trial_welcome.cta": "Ir a tus cursos",

        "plan_email.trial_tips.subject": "Qué hace que los estudiantes vuelvan",
        "plan_email.trial_tips.heading": "Tres cosas que hacen que los estudiantes vuelvan",
        "plan_email.trial_tips.body": "Las academias cuyos estudiantes terminan sus cursos suelen hacer tres cosas desde el principio: entregan un certificado al terminar un curso, agrupan los cursos en una ruta para que cada persona sepa qué hacer después y revisan las analíticas para ver dónde se detienen los estudiantes. Las tres están incluidas en tu prueba.",
        "plan_email.trial_tips.cta": "Abrir tus cursos",

        "plan_email.trial_ends_3d.subject": "Tu prueba de {plan_name} termina en {days} días",
        "plan_email.trial_ends_3d.heading": "Quedan {days} días de {plan_name}",
        "plan_email.trial_ends_3d.body": "El {end_date}, {org_name} pasará al plan Free si no eliges un plan. No se borra nada: un curso sigue siendo público, los demás pasan a ser privados y las funciones de {plan_name} quedan en pausa hasta que mejores tu plan.",
        "plan_email.trial_ends_3d.cta": "Elegir un plan",

        "plan_email.trial_ends_1d.subject": "Tu prueba de {plan_name} termina mañana",
        "plan_email.trial_ends_1d.heading": "Tu prueba termina mañana",
        "plan_email.trial_ends_1d.body": "Si tus estudiantes usan certificados, rutas o sesiones en directo, elige un plan hoy y para ellos no cambiará nada. Si no haces nada, {org_name} pasará a Free: tu contenido se conserva, un curso sigue siendo público y los demás esperan, en privado, hasta que mejores tu plan.",
        "plan_email.trial_ends_1d.cta": "Mantener {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} está ahora en el plan Free",
        "plan_email.trial_ended.heading": "Tu prueba de {plan_name} ha terminado",
        "plan_email.trial_ended.body": "No se ha borrado nada. Un curso sigue siendo público, tus otros cursos son privados por ahora y las funciones de {plan_name} están en pausa. Elige un plan y todo volverá a estar como antes, incluida la visibilidad de los cursos.",
        "plan_email.trial_ended.cta": "Elegir un plan",

        "plan_email.plan_downgraded.subject": "{org_name} está ahora en el plan Free",
        "plan_email.plan_downgraded.heading": "Estás en el plan Free",
        "plan_email.plan_downgraded.body": "Tu suscripción a {plan_name} ha terminado. No se ha borrado nada: un curso sigue siendo público, tus otros cursos son privados por ahora y las funciones de {plan_name} están en pausa. Vuelve a mejorar tu plan y todo volverá a estar como antes.",
        "plan_email.plan_downgraded.cta": "Ver tu plan",
    },
    "ar": {
        "plan_email.common.footer": "تصلك هذه الرسالة لأنك مسؤول في {org_name} على LearnHouse.",

        "plan_email.trial_welcome.subject": "كل ميزات {plan_name} متاحة لـ {org_name} لمدة {days} يومًا",
        "plan_email.trial_welcome.heading": "كل شيء مفتوح لمدة {days} يومًا",
        "plan_email.trial_welcome.body": "خلال الأيام الـ {days} القادمة، تعمل {org_name} بخطة {plan_name}: شهادات يمكن لمتعلميك مشاركتها، ومسارات تعلّم، وجلسات مباشرة، وتحليلات، ونطاقك الخاص. لا حاجة إلى بطاقة. أسرع طريقة لترى الفرق هي أن تنشر دورة واحدة وتدعو بعض المتعلمين.",
        "plan_email.trial_welcome.cta": "انتقل إلى دوراتك",

        "plan_email.trial_tips.subject": "ما الذي يعيد المتعلمين",
        "plan_email.trial_tips.heading": "ثلاثة أشياء تجعل المتعلمين يعودون",
        "plan_email.trial_tips.body": "الأكاديميات التي يُكمل متعلموها دوراتهم تفعل عادةً ثلاثة أشياء مبكرًا: تمنح شهادة عند إتمام الدورة، وتجمع الدورات في مسار ليعرف الناس ما يأخذونه بعد ذلك، وتراجع التحليلات لترى أين يتوقف المتعلمون. الثلاثة كلها ضمن فترتك التجريبية.",
        "plan_email.trial_tips.cta": "افتح دوراتك",

        "plan_email.trial_ends_3d.subject": "تنتهي فترتك التجريبية لـ {plan_name} بعد {days} أيام",
        "plan_email.trial_ends_3d.heading": "بقيت {days} أيام في {plan_name}",
        "plan_email.trial_ends_3d.body": "في {end_date}، تنتقل {org_name} إلى خطة Free ما لم تختر خطة. لن يُحذف شيء: تبقى دورة واحدة عامة، وتصبح الدورات الأخرى خاصة، وتتوقف ميزات {plan_name} مؤقتًا حتى تقوم بالترقية.",
        "plan_email.trial_ends_3d.cta": "اختر خطة",

        "plan_email.trial_ends_1d.subject": "تنتهي فترتك التجريبية لـ {plan_name} غدًا",
        "plan_email.trial_ends_1d.heading": "تنتهي فترتك التجريبية غدًا",
        "plan_email.trial_ends_1d.body": "إذا كان متعلموك يعتمدون على الشهادات أو المسارات أو الجلسات المباشرة، فاختر خطة اليوم ولن يتغير شيء بالنسبة لهم. إذا لم تفعل شيئًا، تنتقل {org_name} إلى خطة Free: يبقى محتواك، وتبقى دورة واحدة عامة، وتنتظر الدورات الأخرى بشكل خاص حتى تقوم بالترقية.",
        "plan_email.trial_ends_1d.cta": "احتفظ بـ {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} الآن على خطة Free",
        "plan_email.trial_ended.heading": "انتهت فترتك التجريبية لـ {plan_name}",
        "plan_email.trial_ended.body": "لم يُحذف شيء. تبقى دورة واحدة عامة، ودوراتك الأخرى خاصة حاليًا، وميزات {plan_name} متوقفة مؤقتًا. اختر خطة وسيعود كل شيء كما كان، بما في ذلك ظهور الدورات.",
        "plan_email.trial_ended.cta": "اختر خطة",

        "plan_email.plan_downgraded.subject": "{org_name} الآن على خطة Free",
        "plan_email.plan_downgraded.heading": "أنت الآن على خطة Free",
        "plan_email.plan_downgraded.body": "انتهى اشتراكك في {plan_name}. لم يُحذف شيء: تبقى دورة واحدة عامة، ودوراتك الأخرى خاصة حاليًا، وميزات {plan_name} متوقفة مؤقتًا. قم بالترقية مجددًا وسيعود كل شيء كما كان.",
        "plan_email.plan_downgraded.cta": "اعرض خطتك",
    },
    "ja": {
        "plan_email.common.footer": "このメールは、LearnHouse の {org_name} の管理者の方にお送りしています。",

        "plan_email.trial_welcome.subject": "{org_name} で {plan_name} の全機能を {days} 日間ご利用いただけます",
        "plan_email.trial_welcome.heading": "{days} 日間、すべての機能が使えます",
        "plan_email.trial_welcome.body": "これから {days} 日間、{org_name} は {plan_name} でご利用いただけます。受講者が共有できる修了証、ラーニングパス、ライブセッション、アナリティクス、独自ドメインが使えます。カードの登録は不要です。違いを確かめるいちばんの近道は、コースを1つ公開して受講者を何人か招待することです。",
        "plan_email.trial_welcome.cta": "コース一覧へ",

        "plan_email.trial_tips.subject": "受講者が戻ってくる理由",
        "plan_email.trial_tips.heading": "受講者が戻ってくる3つの工夫",
        "plan_email.trial_tips.body": "受講者が最後までコースを終えるアカデミーは、早い段階で3つのことをしています。コースを終えたら修了証を渡すこと、次に何を受ければよいか分かるようにコースをパスにまとめること、そしてアナリティクスで受講者がどこで止まっているかを確認することです。3つともトライアルに含まれています。",
        "plan_email.trial_tips.cta": "コースを開く",

        "plan_email.trial_ends_3d.subject": "{plan_name} のトライアルはあと {days} 日で終了します",
        "plan_email.trial_ends_3d.heading": "{plan_name} の残り {days} 日",
        "plan_email.trial_ends_3d.body": "プランを選ばない場合、{end_date} に {org_name} は Free プランに移行します。データは削除されません。1つのコースは公開のまま、ほかのコースは非公開になり、{plan_name} の機能はアップグレードするまで一時停止します。",
        "plan_email.trial_ends_3d.cta": "プランを選ぶ",

        "plan_email.trial_ends_1d.subject": "{plan_name} のトライアルは明日終了します",
        "plan_email.trial_ends_1d.heading": "トライアルは明日終了します",
        "plan_email.trial_ends_1d.body": "受講者が修了証、パス、ライブセッションを使っているなら、今日プランを選べば受講者側は何も変わりません。何もしない場合、{org_name} は Free に移行します。コンテンツはそのまま残り、1つのコースは公開のまま、ほかのコースはアップグレードするまで非公開で保管されます。",
        "plan_email.trial_ends_1d.cta": "{plan_name} を続ける",

        "plan_email.trial_ended.subject": "{org_name} は Free プランになりました",
        "plan_email.trial_ended.heading": "{plan_name} のトライアルが終了しました",
        "plan_email.trial_ended.body": "削除されたものはありません。1つのコースは公開のまま、ほかのコースは当面非公開になり、{plan_name} の機能は一時停止しています。プランを選べば、コースの公開設定も含めてすべて元どおりになります。",
        "plan_email.trial_ended.cta": "プランを選ぶ",

        "plan_email.plan_downgraded.subject": "{org_name} は Free プランになりました",
        "plan_email.plan_downgraded.heading": "Free プランをご利用中です",
        "plan_email.plan_downgraded.body": "{plan_name} のサブスクリプションが終了しました。削除されたものはありません。1つのコースは公開のまま、ほかのコースは当面非公開になり、{plan_name} の機能は一時停止しています。再度アップグレードすれば、すべて元どおりになります。",
        "plan_email.plan_downgraded.cta": "プランを確認する",
    },
    "pt": {
        "plan_email.common.footer": "Você está recebendo este e-mail porque é administrador de {org_name} no LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} tem todos os recursos do {plan_name} por {days} dias",
        "plan_email.trial_welcome.heading": "Tudo liberado por {days} dias",
        "plan_email.trial_welcome.body": "Nos próximos {days} dias, {org_name} usa o {plan_name}: certificados que seus alunos podem compartilhar, trilhas de aprendizagem, sessões ao vivo, análises e seu próprio domínio. Não precisa de cartão. O jeito mais rápido de ver a diferença é publicar um curso e convidar alguns alunos.",
        "plan_email.trial_welcome.cta": "Ir para seus cursos",

        "plan_email.trial_tips.subject": "O que faz os alunos voltarem",
        "plan_email.trial_tips.heading": "Três coisas que fazem os alunos voltarem",
        "plan_email.trial_tips.body": "As academias cujos alunos concluem os cursos costumam fazer três coisas logo no início: entregam um certificado quando o curso termina, agrupam os cursos em uma trilha para que todos saibam o que fazer em seguida e acompanham as análises para ver onde os alunos param. As três fazem parte do seu teste.",
        "plan_email.trial_tips.cta": "Abrir seus cursos",

        "plan_email.trial_ends_3d.subject": "Seu teste do {plan_name} termina em {days} dias",
        "plan_email.trial_ends_3d.heading": "Faltam {days} dias de {plan_name}",
        "plan_email.trial_ends_3d.body": "Em {end_date}, {org_name} passa para o plano Free, a menos que você escolha um plano. Nada é excluído: um curso continua público, os outros ficam privados e os recursos do {plan_name} ficam pausados até você fazer upgrade.",
        "plan_email.trial_ends_3d.cta": "Escolher um plano",

        "plan_email.trial_ends_1d.subject": "Seu teste do {plan_name} termina amanhã",
        "plan_email.trial_ends_1d.heading": "Seu teste termina amanhã",
        "plan_email.trial_ends_1d.body": "Se seus alunos dependem de certificados, trilhas ou sessões ao vivo, escolha um plano hoje e nada muda para eles. Se você não fizer nada, {org_name} passa para o Free: seu conteúdo fica, um curso continua público e os outros aguardam, privados, até você fazer upgrade.",
        "plan_email.trial_ends_1d.cta": "Manter o {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} agora está no plano Free",
        "plan_email.trial_ended.heading": "Seu teste do {plan_name} terminou",
        "plan_email.trial_ended.body": "Nada foi excluído. Um curso continua público, seus outros cursos estão privados por enquanto e os recursos do {plan_name} estão pausados. Escolha um plano e tudo volta a ser como antes, inclusive a visibilidade dos cursos.",
        "plan_email.trial_ended.cta": "Escolher um plano",

        "plan_email.plan_downgraded.subject": "{org_name} agora está no plano Free",
        "plan_email.plan_downgraded.heading": "Você está no plano Free",
        "plan_email.plan_downgraded.body": "Sua assinatura do {plan_name} terminou. Nada foi excluído: um curso continua público, seus outros cursos estão privados por enquanto e os recursos do {plan_name} estão pausados. Faça upgrade de novo e tudo volta a ser como antes.",
        "plan_email.plan_downgraded.cta": "Ver seu plano",
    },
    "ru": {
        "plan_email.common.footer": "Вы получили это письмо, потому что являетесь администратором {org_name} в LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name}: все возможности {plan_name} на {days} дн.",
        "plan_email.trial_welcome.heading": "Всё открыто на {days} дн.",
        "plan_email.trial_welcome.body": "Следующие {days} дн. {org_name} работает на тарифе {plan_name}: сертификаты, которыми ученики могут поделиться, учебные треки, живые занятия, аналитика и собственный домен. Карта не нужна. Чтобы быстро увидеть разницу, опубликуйте один курс и пригласите нескольких учеников.",
        "plan_email.trial_welcome.cta": "Перейти к курсам",

        "plan_email.trial_tips.subject": "Почему ученики возвращаются",
        "plan_email.trial_tips.heading": "Три вещи, ради которых ученики возвращаются",
        "plan_email.trial_tips.body": "Академии, где ученики доходят до конца курсов, обычно с самого начала делают три вещи: выдают сертификат по завершении курса, объединяют курсы в трек, чтобы было понятно, что проходить дальше, и смотрят аналитику, чтобы понять, где ученики останавливаются. Всё это входит в ваш пробный период.",
        "plan_email.trial_tips.cta": "Открыть курсы",

        "plan_email.trial_ends_3d.subject": "Пробный период {plan_name} закончится через {days} дн.",
        "plan_email.trial_ends_3d.heading": "До конца {plan_name} осталось {days} дн.",
        "plan_email.trial_ends_3d.body": "{end_date} {org_name} перейдёт на тариф Free, если вы не выберете тариф. Ничего не удаляется: один курс останется открытым, остальные станут закрытыми, а функции {plan_name} будут приостановлены до перехода на платный тариф.",
        "plan_email.trial_ends_3d.cta": "Выбрать тариф",

        "plan_email.trial_ends_1d.subject": "Пробный период {plan_name} закончится завтра",
        "plan_email.trial_ends_1d.heading": "Пробный период закончится завтра",
        "plan_email.trial_ends_1d.body": "Если ваши ученики пользуются сертификатами, треками или живыми занятиями, выберите тариф сегодня, и для них ничего не изменится. Если ничего не делать, {org_name} перейдёт на Free: материалы сохранятся, один курс останется открытым, а остальные будут ждать в закрытом виде, пока вы не смените тариф.",
        "plan_email.trial_ends_1d.cta": "Сохранить {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} теперь на тарифе Free",
        "plan_email.trial_ended.heading": "Пробный период {plan_name} закончился",
        "plan_email.trial_ended.body": "Ничего не удалено. Один курс остаётся открытым, остальные курсы пока закрыты, а функции {plan_name} приостановлены. Выберите тариф, и всё вернётся как было, включая видимость курсов.",
        "plan_email.trial_ended.cta": "Выбрать тариф",

        "plan_email.plan_downgraded.subject": "{org_name} теперь на тарифе Free",
        "plan_email.plan_downgraded.heading": "Вы на тарифе Free",
        "plan_email.plan_downgraded.body": "Ваша подписка на {plan_name} закончилась. Ничего не удалено: один курс остаётся открытым, остальные курсы пока закрыты, а функции {plan_name} приостановлены. Оформите тариф снова, и всё вернётся как было.",
        "plan_email.plan_downgraded.cta": "Посмотреть тариф",
    },
    "zh": {
        "plan_email.common.footer": "你收到这封邮件，是因为你是 LearnHouse 上 {org_name} 的管理员。",

        "plan_email.trial_welcome.subject": "{org_name} 可在 {days} 天内使用 {plan_name} 的全部功能",
        "plan_email.trial_welcome.heading": "{days} 天内全部功能开放",
        "plan_email.trial_welcome.body": "接下来 {days} 天，{org_name} 将使用 {plan_name}：学员可分享的证书、学习路径、直播课、数据分析，以及你自己的域名。无需绑定银行卡。想最快看到变化，就发布一门课程并邀请几位学员。",
        "plan_email.trial_welcome.cta": "前往你的课程",

        "plan_email.trial_tips.subject": "让学员持续回来的方法",
        "plan_email.trial_tips.heading": "让学员持续回来的三件事",
        "plan_email.trial_tips.body": "学员能完成课程的学院，通常很早就做了三件事：课程结束时颁发证书；把课程组合成学习路径，让大家知道下一步学什么；查看数据分析，了解学员在哪里停下。这三项都包含在你的试用中。",
        "plan_email.trial_tips.cta": "打开你的课程",

        "plan_email.trial_ends_3d.subject": "你的 {plan_name} 试用将在 {days} 天后结束",
        "plan_email.trial_ends_3d.heading": "{plan_name} 还剩 {days} 天",
        "plan_email.trial_ends_3d.body": "如果你没有选择套餐，{org_name} 将在 {end_date} 转为 Free 套餐。不会删除任何内容：一门课程保持公开，其余课程转为私密，{plan_name} 功能会暂停，直到你升级。",
        "plan_email.trial_ends_3d.cta": "选择套餐",

        "plan_email.trial_ends_1d.subject": "你的 {plan_name} 试用明天结束",
        "plan_email.trial_ends_1d.heading": "你的试用明天结束",
        "plan_email.trial_ends_1d.body": "如果你的学员依赖证书、学习路径或直播课，今天选择一个套餐，他们就不会受到任何影响。如果你不做任何操作，{org_name} 将转为 Free：内容都会保留，一门课程保持公开，其余课程转为私密，直到你升级。",
        "plan_email.trial_ends_1d.cta": "继续使用 {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} 现已使用 Free 套餐",
        "plan_email.trial_ended.heading": "你的 {plan_name} 试用已结束",
        "plan_email.trial_ended.body": "没有删除任何内容。一门课程保持公开，其余课程暂时为私密，{plan_name} 功能已暂停。选择一个套餐后，一切都会恢复原样，包括课程的可见性。",
        "plan_email.trial_ended.cta": "选择套餐",

        "plan_email.plan_downgraded.subject": "{org_name} 现已使用 Free 套餐",
        "plan_email.plan_downgraded.heading": "你现在使用的是 Free 套餐",
        "plan_email.plan_downgraded.body": "你的 {plan_name} 订阅已结束。没有删除任何内容：一门课程保持公开，其余课程暂时为私密，{plan_name} 功能已暂停。重新升级后，一切都会恢复原样。",
        "plan_email.plan_downgraded.cta": "查看你的套餐",
    },
    "hi": {
        "plan_email.common.footer": "आपको यह ईमेल इसलिए मिला है क्योंकि आप LearnHouse पर {org_name} के एडमिन हैं।",

        "plan_email.trial_welcome.subject": "{org_name} के पास {days} दिनों तक {plan_name} की हर सुविधा है",
        "plan_email.trial_welcome.heading": "{days} दिनों तक सब कुछ खुला है",
        "plan_email.trial_welcome.body": "अगले {days} दिनों तक {org_name} {plan_name} पर चलेगा: ऐसे सर्टिफ़िकेट जिन्हें आपके शिक्षार्थी शेयर कर सकें, लर्निंग पाथ, लाइव सेशन, एनालिटिक्स और आपका अपना डोमेन। कोई कार्ड नहीं चाहिए। फ़र्क देखने का सबसे तेज़ तरीका है कि एक कोर्स प्रकाशित करें और कुछ शिक्षार्थियों को आमंत्रित करें।",
        "plan_email.trial_welcome.cta": "अपने कोर्स पर जाएं",

        "plan_email.trial_tips.subject": "शिक्षार्थी बार-बार क्यों लौटते हैं",
        "plan_email.trial_tips.heading": "तीन चीज़ें जो शिक्षार्थियों को वापस लाती हैं",
        "plan_email.trial_tips.body": "जिन अकादमियों के शिक्षार्थी अपने कोर्स पूरे करते हैं, वे शुरुआत में ही तीन काम करती हैं: कोर्स पूरा होने पर सर्टिफ़िकेट देना, कोर्सों को एक पाथ में जोड़ना ताकि लोगों को पता रहे कि आगे क्या लेना है, और एनालिटिक्स देखना कि शिक्षार्थी कहाँ रुकते हैं। ये तीनों आपके ट्रायल में शामिल हैं।",
        "plan_email.trial_tips.cta": "अपने कोर्स खोलें",

        "plan_email.trial_ends_3d.subject": "आपका {plan_name} ट्रायल {days} दिनों में खत्म हो रहा है",
        "plan_email.trial_ends_3d.heading": "{plan_name} के {days} दिन बाकी",
        "plan_email.trial_ends_3d.body": "अगर आप कोई प्लान नहीं चुनते, तो {end_date} को {org_name} Free प्लान पर चला जाएगा। कुछ भी डिलीट नहीं होगा: एक कोर्स सार्वजनिक रहेगा, बाकी निजी हो जाएंगे, और {plan_name} की सुविधाएं अपग्रेड करने तक रुकी रहेंगी।",
        "plan_email.trial_ends_3d.cta": "प्लान चुनें",

        "plan_email.trial_ends_1d.subject": "आपका {plan_name} ट्रायल कल खत्म हो रहा है",
        "plan_email.trial_ends_1d.heading": "आपका ट्रायल कल खत्म हो रहा है",
        "plan_email.trial_ends_1d.body": "अगर आपके शिक्षार्थी सर्टिफ़िकेट, पाथ या लाइव सेशन पर निर्भर हैं, तो आज ही प्लान चुनें और उनके लिए कुछ नहीं बदलेगा। अगर आप कुछ नहीं करते, तो {org_name} Free पर चला जाएगा: आपका कंटेंट बना रहेगा, एक कोर्स सार्वजनिक रहेगा और बाकी अपग्रेड करने तक निजी रहेंगे।",
        "plan_email.trial_ends_1d.cta": "{plan_name} जारी रखें",

        "plan_email.trial_ended.subject": "{org_name} अब Free प्लान पर है",
        "plan_email.trial_ended.heading": "आपका {plan_name} ट्रायल खत्म हो गया है",
        "plan_email.trial_ended.body": "कुछ भी डिलीट नहीं हुआ। एक कोर्स सार्वजनिक है, आपके बाकी कोर्स फ़िलहाल निजी हैं, और {plan_name} की सुविधाएं रुकी हुई हैं। प्लान चुनें और कोर्स की दृश्यता समेत सब कुछ पहले जैसा हो जाएगा।",
        "plan_email.trial_ended.cta": "प्लान चुनें",

        "plan_email.plan_downgraded.subject": "{org_name} अब Free प्लान पर है",
        "plan_email.plan_downgraded.heading": "आप Free प्लान पर हैं",
        "plan_email.plan_downgraded.body": "आपकी {plan_name} सदस्यता खत्म हो गई है। कुछ भी डिलीट नहीं हुआ: एक कोर्स सार्वजनिक है, आपके बाकी कोर्स फ़िलहाल निजी हैं, और {plan_name} की सुविधाएं रुकी हुई हैं। फिर से अपग्रेड करें और सब कुछ पहले जैसा हो जाएगा।",
        "plan_email.plan_downgraded.cta": "अपना प्लान देखें",
    },
    "ko": {
        "plan_email.common.footer": "LearnHouse에서 {org_name}의 관리자이기 때문에 이 메일을 받았어요.",

        "plan_email.trial_welcome.subject": "{org_name}에서 {days}일 동안 {plan_name}의 모든 기능을 쓸 수 있어요",
        "plan_email.trial_welcome.heading": "{days}일 동안 모든 기능이 열려 있어요",
        "plan_email.trial_welcome.body": "앞으로 {days}일 동안 {org_name}은(는) {plan_name} 플랜으로 운영돼요. 학습자가 공유할 수 있는 수료증, 학습 경로, 라이브 세션, 분석, 나만의 도메인을 쓸 수 있어요. 카드 등록은 필요 없어요. 무엇이 달라지는지 가장 빨리 확인하려면 코스 하나를 게시하고 학습자 몇 명을 초대해 보세요.",
        "plan_email.trial_welcome.cta": "내 코스로 가기",

        "plan_email.trial_tips.subject": "학습자가 다시 찾아오는 이유",
        "plan_email.trial_tips.heading": "학습자가 다시 찾아오게 만드는 세 가지",
        "plan_email.trial_tips.body": "학습자가 코스를 끝까지 마치는 아카데미는 대개 초기에 세 가지를 해요. 코스를 마치면 수료증을 주고, 다음에 무엇을 들을지 알 수 있도록 코스를 경로로 묶고, 분석을 보며 학습자가 어디서 멈추는지 확인해요. 세 가지 모두 체험 기간에 포함되어 있어요.",
        "plan_email.trial_tips.cta": "코스 열기",

        "plan_email.trial_ends_3d.subject": "{plan_name} 체험이 {days}일 후에 끝나요",
        "plan_email.trial_ends_3d.heading": "{plan_name} 체험 {days}일 남음",
        "plan_email.trial_ends_3d.body": "플랜을 선택하지 않으면 {end_date}에 {org_name}은(는) Free 플랜으로 바뀌어요. 삭제되는 것은 없어요. 코스 하나는 공개 상태로 남고, 나머지는 비공개로 바뀌며, {plan_name} 기능은 업그레이드할 때까지 일시 중지돼요.",
        "plan_email.trial_ends_3d.cta": "플랜 선택하기",

        "plan_email.trial_ends_1d.subject": "{plan_name} 체험이 내일 끝나요",
        "plan_email.trial_ends_1d.heading": "체험이 내일 끝나요",
        "plan_email.trial_ends_1d.body": "학습자가 수료증, 경로, 라이브 세션을 사용하고 있다면 오늘 플랜을 선택하세요. 학습자에게는 아무것도 바뀌지 않아요. 아무것도 하지 않으면 {org_name}은(는) Free로 바뀌어요. 콘텐츠는 그대로 남고, 코스 하나는 공개 상태로 유지되며, 나머지는 업그레이드할 때까지 비공개로 기다려요.",
        "plan_email.trial_ends_1d.cta": "{plan_name} 계속 쓰기",

        "plan_email.trial_ended.subject": "{org_name}은(는) 이제 Free 플랜이에요",
        "plan_email.trial_ended.heading": "{plan_name} 체험이 끝났어요",
        "plan_email.trial_ended.body": "삭제된 것은 없어요. 코스 하나는 공개 상태이고, 나머지 코스는 당분간 비공개이며, {plan_name} 기능은 일시 중지되었어요. 플랜을 선택하면 코스 공개 설정까지 모두 이전처럼 돌아와요.",
        "plan_email.trial_ended.cta": "플랜 선택하기",

        "plan_email.plan_downgraded.subject": "{org_name}은(는) 이제 Free 플랜이에요",
        "plan_email.plan_downgraded.heading": "Free 플랜을 사용 중이에요",
        "plan_email.plan_downgraded.body": "{plan_name} 구독이 끝났어요. 삭제된 것은 없어요. 코스 하나는 공개 상태이고, 나머지 코스는 당분간 비공개이며, {plan_name} 기능은 일시 중지되었어요. 다시 업그레이드하면 모두 이전처럼 돌아와요.",
        "plan_email.plan_downgraded.cta": "내 플랜 보기",
    },
    "it": {
        "plan_email.common.footer": "Ricevi questa email perché sei amministratore di {org_name} su LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} ha tutte le funzionalità di {plan_name} per {days} giorni",
        "plan_email.trial_welcome.heading": "Tutto sbloccato per {days} giorni",
        "plan_email.trial_welcome.body": "Per i prossimi {days} giorni, {org_name} usa {plan_name}: certificati che i tuoi studenti possono condividere, percorsi di apprendimento, sessioni dal vivo, analisi e il tuo dominio. Nessuna carta richiesta. Il modo più rapido per vedere la differenza è pubblicare un corso e invitare qualche studente.",
        "plan_email.trial_welcome.cta": "Vai ai tuoi corsi",

        "plan_email.trial_tips.subject": "Cosa fa tornare gli studenti",
        "plan_email.trial_tips.heading": "Tre cose che fanno tornare gli studenti",
        "plan_email.trial_tips.body": "Le accademie i cui studenti finiscono i corsi di solito fanno tre cose fin dall'inizio: consegnano un certificato quando un corso è completato, raggruppano i corsi in un percorso così le persone sanno cosa seguire dopo, e controllano le analisi per vedere dove gli studenti si fermano. Tutte e tre fanno parte della tua prova.",
        "plan_email.trial_tips.cta": "Apri i tuoi corsi",

        "plan_email.trial_ends_3d.subject": "La tua prova di {plan_name} termina tra {days} giorni",
        "plan_email.trial_ends_3d.heading": "Ancora {days} giorni di {plan_name}",
        "plan_email.trial_ends_3d.body": "Il {end_date}, {org_name} passa al piano Free se non scegli un piano. Non viene eliminato nulla: un corso resta pubblico, gli altri diventano privati e le funzionalità di {plan_name} restano in pausa finché non passi a un piano superiore.",
        "plan_email.trial_ends_3d.cta": "Scegli un piano",

        "plan_email.trial_ends_1d.subject": "La tua prova di {plan_name} termina domani",
        "plan_email.trial_ends_1d.heading": "La tua prova termina domani",
        "plan_email.trial_ends_1d.body": "Se i tuoi studenti usano certificati, percorsi o sessioni dal vivo, scegli un piano oggi e per loro non cambia nulla. Se non fai nulla, {org_name} passa a Free: i tuoi contenuti restano, un corso resta pubblico e gli altri aspettano, privati, finché non passi a un piano superiore.",
        "plan_email.trial_ends_1d.cta": "Mantieni {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} ora è sul piano Free",
        "plan_email.trial_ended.heading": "La tua prova di {plan_name} è terminata",
        "plan_email.trial_ended.body": "Non è stato eliminato nulla. Un corso resta pubblico, gli altri tuoi corsi sono privati per ora e le funzionalità di {plan_name} sono in pausa. Scegli un piano e tutto torna com'era, compresa la visibilità dei corsi.",
        "plan_email.trial_ended.cta": "Scegli un piano",

        "plan_email.plan_downgraded.subject": "{org_name} ora è sul piano Free",
        "plan_email.plan_downgraded.heading": "Sei sul piano Free",
        "plan_email.plan_downgraded.body": "Il tuo abbonamento a {plan_name} è terminato. Non è stato eliminato nulla: un corso resta pubblico, gli altri tuoi corsi sono privati per ora e le funzionalità di {plan_name} sono in pausa. Passa di nuovo a un piano superiore e tutto torna com'era.",
        "plan_email.plan_downgraded.cta": "Vedi il tuo piano",
    },
    "tr": {
        "plan_email.common.footer": "Bu e-postayı LearnHouse'ta {org_name} yöneticisi olduğun için alıyorsun.",

        "plan_email.trial_welcome.subject": "{org_name}, {days} gün boyunca tüm {plan_name} özelliklerine sahip",
        "plan_email.trial_welcome.heading": "{days} gün boyunca her şey açık",
        "plan_email.trial_welcome.body": "Önümüzdeki {days} gün boyunca {org_name}, {plan_name} ile çalışıyor: öğrencilerinin paylaşabileceği sertifikalar, öğrenme yolları, canlı oturumlar, analizler ve kendi alan adın. Kart gerekmez. Neyin değiştiğini görmenin en hızlı yolu bir kurs yayınlayıp birkaç öğrenciyi davet etmek.",
        "plan_email.trial_welcome.cta": "Kurslarına git",

        "plan_email.trial_tips.subject": "Öğrencileri geri getiren şey",
        "plan_email.trial_tips.heading": "Öğrencileri geri getiren üç şey",
        "plan_email.trial_tips.body": "Öğrencileri kurslarını bitiren akademiler genellikle erkenden üç şey yapar: bir kurs bittiğinde sertifika verir, insanlar sırada ne olduğunu bilsin diye kursları bir yolda toplar ve öğrencilerin nerede durduğunu görmek için analizlere bakar. Üçü de denemene dahil.",
        "plan_email.trial_tips.cta": "Kurslarını aç",

        "plan_email.trial_ends_3d.subject": "{plan_name} denemen {days} gün içinde bitiyor",
        "plan_email.trial_ends_3d.heading": "{plan_name} için {days} gün kaldı",
        "plan_email.trial_ends_3d.body": "Bir plan seçmezsen {org_name}, {end_date} tarihinde Free plana geçer. Hiçbir şey silinmez: bir kurs herkese açık kalır, diğerleri gizli olur ve {plan_name} özellikleri sen yükseltene kadar duraklatılır.",
        "plan_email.trial_ends_3d.cta": "Plan seç",

        "plan_email.trial_ends_1d.subject": "{plan_name} denemen yarın bitiyor",
        "plan_email.trial_ends_1d.heading": "Denemen yarın bitiyor",
        "plan_email.trial_ends_1d.body": "Öğrencilerin sertifikalara, yollara veya canlı oturumlara güveniyorsa bugün bir plan seç; onlar için hiçbir şey değişmez. Hiçbir şey yapmazsan {org_name} Free plana geçer: içeriğin kalır, bir kurs herkese açık kalır ve diğerleri sen yükseltene kadar gizli olarak bekler.",
        "plan_email.trial_ends_1d.cta": "{plan_name} ile devam et",

        "plan_email.trial_ended.subject": "{org_name} artık Free planda",
        "plan_email.trial_ended.heading": "{plan_name} denemen sona erdi",
        "plan_email.trial_ended.body": "Hiçbir şey silinmedi. Bir kurs herkese açık kalıyor, diğer kursların şimdilik gizli ve {plan_name} özellikleri duraklatıldı. Bir plan seçtiğinde kurs görünürlüğü dahil her şey eskisi gibi olur.",
        "plan_email.trial_ended.cta": "Plan seç",

        "plan_email.plan_downgraded.subject": "{org_name} artık Free planda",
        "plan_email.plan_downgraded.heading": "Free plandasın",
        "plan_email.plan_downgraded.body": "{plan_name} aboneliğin sona erdi. Hiçbir şey silinmedi: bir kurs herkese açık kalıyor, diğer kursların şimdilik gizli ve {plan_name} özellikleri duraklatıldı. Yeniden yükselttiğinde her şey eskisi gibi olur.",
        "plan_email.plan_downgraded.cta": "Planını gör",
    },
    "vi": {
        "plan_email.common.footer": "Bạn nhận được email này vì bạn là quản trị viên của {org_name} trên LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} có mọi tính năng của {plan_name} trong {days} ngày",
        "plan_email.trial_welcome.heading": "Mọi thứ đã mở khóa trong {days} ngày",
        "plan_email.trial_welcome.body": "Trong {days} ngày tới, {org_name} dùng gói {plan_name}: chứng chỉ học viên có thể chia sẻ, lộ trình học, buổi học trực tiếp, số liệu phân tích và tên miền riêng của bạn. Không cần thẻ. Cách nhanh nhất để thấy sự khác biệt là đăng một khóa học và mời vài học viên.",
        "plan_email.trial_welcome.cta": "Đến khóa học của bạn",

        "plan_email.trial_tips.subject": "Điều khiến học viên quay lại",
        "plan_email.trial_tips.heading": "Ba điều khiến học viên quay lại",
        "plan_email.trial_tips.body": "Những học viện có học viên học hết khóa thường làm sớm ba việc: trao chứng chỉ khi học xong một khóa, gom các khóa học thành lộ trình để mọi người biết nên học gì tiếp theo, và xem số liệu phân tích để biết học viên dừng lại ở đâu. Cả ba đều có trong bản dùng thử của bạn.",
        "plan_email.trial_tips.cta": "Mở khóa học của bạn",

        "plan_email.trial_ends_3d.subject": "Bản dùng thử {plan_name} của bạn kết thúc sau {days} ngày",
        "plan_email.trial_ends_3d.heading": "Còn {days} ngày dùng {plan_name}",
        "plan_email.trial_ends_3d.body": "Vào {end_date}, {org_name} sẽ chuyển sang gói Free nếu bạn không chọn gói. Không có gì bị xóa: một khóa học vẫn công khai, các khóa khác chuyển sang riêng tư, và các tính năng {plan_name} tạm dừng cho đến khi bạn nâng cấp.",
        "plan_email.trial_ends_3d.cta": "Chọn gói",

        "plan_email.trial_ends_1d.subject": "Bản dùng thử {plan_name} của bạn kết thúc vào ngày mai",
        "plan_email.trial_ends_1d.heading": "Bản dùng thử kết thúc vào ngày mai",
        "plan_email.trial_ends_1d.body": "Nếu học viên của bạn cần chứng chỉ, lộ trình hoặc buổi học trực tiếp, hãy chọn gói hôm nay và mọi thứ vẫn như cũ với họ. Nếu bạn không làm gì, {org_name} sẽ chuyển sang Free: nội dung vẫn còn, một khóa học vẫn công khai và các khóa khác chờ ở chế độ riêng tư cho đến khi bạn nâng cấp.",
        "plan_email.trial_ends_1d.cta": "Giữ {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} hiện dùng gói Free",
        "plan_email.trial_ended.heading": "Bản dùng thử {plan_name} đã kết thúc",
        "plan_email.trial_ended.body": "Không có gì bị xóa. Một khóa học vẫn công khai, các khóa học khác tạm thời ở chế độ riêng tư, và các tính năng {plan_name} đang tạm dừng. Chọn một gói và mọi thứ sẽ trở lại như cũ, kể cả chế độ hiển thị khóa học.",
        "plan_email.trial_ended.cta": "Chọn gói",

        "plan_email.plan_downgraded.subject": "{org_name} hiện dùng gói Free",
        "plan_email.plan_downgraded.heading": "Bạn đang dùng gói Free",
        "plan_email.plan_downgraded.body": "Gói đăng ký {plan_name} của bạn đã kết thúc. Không có gì bị xóa: một khóa học vẫn công khai, các khóa học khác tạm thời ở chế độ riêng tư, và các tính năng {plan_name} đang tạm dừng. Nâng cấp lại và mọi thứ sẽ trở lại như cũ.",
        "plan_email.plan_downgraded.cta": "Xem gói của bạn",
    },
    "id": {
        "plan_email.common.footer": "Anda menerima email ini karena Anda admin {org_name} di LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} mendapat semua fitur {plan_name} selama {days} hari",
        "plan_email.trial_welcome.heading": "Semua fitur terbuka selama {days} hari",
        "plan_email.trial_welcome.body": "Selama {days} hari ke depan, {org_name} memakai {plan_name}: sertifikat yang bisa dibagikan peserta, jalur belajar, sesi langsung, analitik, dan domain Anda sendiri. Tidak perlu kartu. Cara tercepat untuk melihat bedanya adalah menerbitkan satu kursus dan mengundang beberapa peserta.",
        "plan_email.trial_welcome.cta": "Ke kursus Anda",

        "plan_email.trial_tips.subject": "Yang membuat peserta kembali",
        "plan_email.trial_tips.heading": "Tiga hal yang membuat peserta kembali",
        "plan_email.trial_tips.body": "Akademi yang pesertanya menyelesaikan kursus biasanya melakukan tiga hal sejak awal: memberikan sertifikat saat kursus selesai, mengelompokkan kursus ke dalam jalur agar orang tahu apa yang diambil berikutnya, dan memeriksa analitik untuk melihat di mana peserta berhenti. Ketiganya termasuk dalam masa uji coba Anda.",
        "plan_email.trial_tips.cta": "Buka kursus Anda",

        "plan_email.trial_ends_3d.subject": "Uji coba {plan_name} Anda berakhir dalam {days} hari",
        "plan_email.trial_ends_3d.heading": "Sisa {days} hari untuk {plan_name}",
        "plan_email.trial_ends_3d.body": "Pada {end_date}, {org_name} pindah ke paket Free kecuali Anda memilih paket. Tidak ada yang dihapus: satu kursus tetap publik, yang lain menjadi privat, dan fitur {plan_name} dijeda sampai Anda upgrade.",
        "plan_email.trial_ends_3d.cta": "Pilih paket",

        "plan_email.trial_ends_1d.subject": "Uji coba {plan_name} Anda berakhir besok",
        "plan_email.trial_ends_1d.heading": "Uji coba Anda berakhir besok",
        "plan_email.trial_ends_1d.body": "Jika peserta Anda mengandalkan sertifikat, jalur, atau sesi langsung, pilih paket hari ini dan tidak ada yang berubah bagi mereka. Jika Anda tidak melakukan apa pun, {org_name} pindah ke Free: konten Anda tetap ada, satu kursus tetap publik, dan yang lain menunggu dalam keadaan privat sampai Anda upgrade.",
        "plan_email.trial_ends_1d.cta": "Tetap pakai {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} sekarang memakai paket Free",
        "plan_email.trial_ended.heading": "Uji coba {plan_name} Anda telah berakhir",
        "plan_email.trial_ended.body": "Tidak ada yang dihapus. Satu kursus tetap publik, kursus Anda yang lain privat untuk sementara, dan fitur {plan_name} dijeda. Pilih paket dan semuanya kembali seperti semula, termasuk visibilitas kursus.",
        "plan_email.trial_ended.cta": "Pilih paket",

        "plan_email.plan_downgraded.subject": "{org_name} sekarang memakai paket Free",
        "plan_email.plan_downgraded.heading": "Anda memakai paket Free",
        "plan_email.plan_downgraded.body": "Langganan {plan_name} Anda telah berakhir. Tidak ada yang dihapus: satu kursus tetap publik, kursus Anda yang lain privat untuk sementara, dan fitur {plan_name} dijeda. Upgrade lagi dan semuanya kembali seperti semula.",
        "plan_email.plan_downgraded.cta": "Lihat paket Anda",
    },
    "pl": {
        "plan_email.common.footer": "Otrzymujesz tę wiadomość, ponieważ administrujesz {org_name} w LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} ma wszystkie funkcje {plan_name} przez {days} dni",
        "plan_email.trial_welcome.heading": "Wszystko odblokowane na {days} dni",
        "plan_email.trial_welcome.body": "Przez najbliższe {days} dni {org_name} działa na planie {plan_name}: certyfikaty, które uczestnicy mogą udostępniać, ścieżki nauki, sesje na żywo, statystyki i własna domena. Karta nie jest potrzebna. Najszybciej zobaczysz różnicę, gdy opublikujesz jeden kurs i zaprosisz kilku uczestników.",
        "plan_email.trial_welcome.cta": "Przejdź do kursów",

        "plan_email.trial_tips.subject": "Co sprawia, że uczestnicy wracają",
        "plan_email.trial_tips.heading": "Trzy rzeczy, dzięki którym uczestnicy wracają",
        "plan_email.trial_tips.body": "Akademie, w których uczestnicy kończą kursy, zwykle od początku robią trzy rzeczy: wręczają certyfikat po ukończeniu kursu, łączą kursy w ścieżkę, żeby było jasne, co dalej, i sprawdzają statystyki, żeby zobaczyć, gdzie uczestnicy się zatrzymują. Wszystkie trzy są częścią Twojego okresu próbnego.",
        "plan_email.trial_tips.cta": "Otwórz kursy",

        "plan_email.trial_ends_3d.subject": "Okres próbny {plan_name} kończy się za {days} dni",
        "plan_email.trial_ends_3d.heading": "Zostało {days} dni planu {plan_name}",
        "plan_email.trial_ends_3d.body": "Dnia {end_date} {org_name} przejdzie na plan Free, jeśli nie wybierzesz planu. Nic nie zostanie usunięte: jeden kurs pozostanie publiczny, pozostałe staną się prywatne, a funkcje {plan_name} zostaną wstrzymane do czasu zmiany planu na wyższy.",
        "plan_email.trial_ends_3d.cta": "Wybierz plan",

        "plan_email.trial_ends_1d.subject": "Okres próbny {plan_name} kończy się jutro",
        "plan_email.trial_ends_1d.heading": "Okres próbny kończy się jutro",
        "plan_email.trial_ends_1d.body": "Jeśli Twoi uczestnicy korzystają z certyfikatów, ścieżek lub sesji na żywo, wybierz plan jeszcze dziś, a dla nich nic się nie zmieni. Jeśli nic nie zrobisz, {org_name} przejdzie na Free: Twoje treści zostaną, jeden kurs pozostanie publiczny, a pozostałe poczekają jako prywatne, aż zmienisz plan na wyższy.",
        "plan_email.trial_ends_1d.cta": "Zostań przy {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} korzysta teraz z planu Free",
        "plan_email.trial_ended.heading": "Okres próbny {plan_name} dobiegł końca",
        "plan_email.trial_ended.body": "Nic nie zostało usunięte. Jeden kurs pozostaje publiczny, pozostałe kursy są na razie prywatne, a funkcje {plan_name} są wstrzymane. Wybierz plan, a wszystko wróci do poprzedniego stanu, łącznie z widocznością kursów.",
        "plan_email.trial_ended.cta": "Wybierz plan",

        "plan_email.plan_downgraded.subject": "{org_name} korzysta teraz z planu Free",
        "plan_email.plan_downgraded.heading": "Korzystasz z planu Free",
        "plan_email.plan_downgraded.body": "Twoja subskrypcja {plan_name} dobiegła końca. Nic nie zostało usunięte: jeden kurs pozostaje publiczny, pozostałe kursy są na razie prywatne, a funkcje {plan_name} są wstrzymane. Gdy znów zmienisz plan na wyższy, wszystko wróci do poprzedniego stanu.",
        "plan_email.plan_downgraded.cta": "Zobacz swój plan",
    },
    "uk": {
        "plan_email.common.footer": "Ви отримали цей лист, тому що є адміністратором {org_name} у LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name}: усі можливості {plan_name} на {days} дн.",
        "plan_email.trial_welcome.heading": "Усе відкрито на {days} дн.",
        "plan_email.trial_welcome.body": "Наступні {days} дн. {org_name} працює на тарифі {plan_name}: сертифікати, якими учні можуть поділитися, навчальні траєкторії, живі заняття, аналітика та власний домен. Картка не потрібна. Щоб швидко побачити різницю, опублікуйте один курс і запросіть кількох учнів.",
        "plan_email.trial_welcome.cta": "Перейти до курсів",

        "plan_email.trial_tips.subject": "Чому учні повертаються",
        "plan_email.trial_tips.heading": "Три речі, заради яких учні повертаються",
        "plan_email.trial_tips.body": "Академії, де учні доходять до кінця курсів, зазвичай із самого початку роблять три речі: видають сертифікат після завершення курсу, об'єднують курси в траєкторію, щоб було зрозуміло, що проходити далі, і дивляться аналітику, щоб побачити, де учні зупиняються. Усе це входить у ваш пробний період.",
        "plan_email.trial_tips.cta": "Відкрити курси",

        "plan_email.trial_ends_3d.subject": "Пробний період {plan_name} закінчиться через {days} дн.",
        "plan_email.trial_ends_3d.heading": "До кінця {plan_name} залишилося {days} дн.",
        "plan_email.trial_ends_3d.body": "{end_date} {org_name} перейде на тариф Free, якщо ви не оберете тариф. Нічого не видаляється: один курс залишиться відкритим, інші стануть закритими, а функції {plan_name} буде призупинено, доки ви не перейдете на платний тариф.",
        "plan_email.trial_ends_3d.cta": "Обрати тариф",

        "plan_email.trial_ends_1d.subject": "Пробний період {plan_name} закінчиться завтра",
        "plan_email.trial_ends_1d.heading": "Пробний період закінчиться завтра",
        "plan_email.trial_ends_1d.body": "Якщо ваші учні користуються сертифікатами, траєкторіями чи живими заняттями, оберіть тариф сьогодні, і для них нічого не зміниться. Якщо нічого не робити, {org_name} перейде на Free: матеріали збережуться, один курс залишиться відкритим, а інші чекатимуть у закритому режимі, доки ви не зміните тариф.",
        "plan_email.trial_ends_1d.cta": "Залишити {plan_name}",

        "plan_email.trial_ended.subject": "{org_name} тепер на тарифі Free",
        "plan_email.trial_ended.heading": "Пробний період {plan_name} закінчився",
        "plan_email.trial_ended.body": "Нічого не видалено. Один курс залишається відкритим, інші курси поки закриті, а функції {plan_name} призупинено. Оберіть тариф, і все повернеться як було, разом із видимістю курсів.",
        "plan_email.trial_ended.cta": "Обрати тариф",

        "plan_email.plan_downgraded.subject": "{org_name} тепер на тарифі Free",
        "plan_email.plan_downgraded.heading": "Ви на тарифі Free",
        "plan_email.plan_downgraded.body": "Ваша підписка на {plan_name} закінчилася. Нічого не видалено: один курс залишається відкритим, інші курси поки закриті, а функції {plan_name} призупинено. Оформіть тариф знову, і все повернеться як було.",
        "plan_email.plan_downgraded.cta": "Переглянути тариф",
    },
    "nl": {
        "plan_email.common.footer": "Je ontvangt deze e-mail omdat je beheerder bent van {org_name} op LearnHouse.",

        "plan_email.trial_welcome.subject": "{org_name} heeft {days} dagen lang alle functies van {plan_name}",
        "plan_email.trial_welcome.heading": "{days} dagen lang staat alles open",
        "plan_email.trial_welcome.body": "De komende {days} dagen draait {org_name} op {plan_name}: certificaten die je cursisten kunnen delen, leerpaden, livesessies, statistieken en je eigen domein. Geen creditcard nodig. De snelste manier om het verschil te zien: publiceer één cursus en nodig een paar cursisten uit.",
        "plan_email.trial_welcome.cta": "Naar je cursussen",

        "plan_email.trial_tips.subject": "Waardoor cursisten terugkomen",
        "plan_email.trial_tips.heading": "Drie dingen waardoor cursisten terugkomen",
        "plan_email.trial_tips.body": "Academies waar cursisten hun cursussen afmaken, doen meestal al vroeg drie dingen: ze geven een certificaat als een cursus klaar is, ze bundelen cursussen in een leerpad zodat mensen weten wat ze daarna kunnen volgen, en ze bekijken de statistieken om te zien waar cursisten afhaken. Alle drie zitten in je proefperiode.",
        "plan_email.trial_tips.cta": "Open je cursussen",

        "plan_email.trial_ends_3d.subject": "Je proefperiode van {plan_name} eindigt over {days} dagen",
        "plan_email.trial_ends_3d.heading": "Nog {days} dagen {plan_name}",
        "plan_email.trial_ends_3d.body": "Op {end_date} stapt {org_name} over op het Free-abonnement, tenzij je een abonnement kiest. Er wordt niets verwijderd: één cursus blijft openbaar, de andere worden privé en de functies van {plan_name} staan stil tot je upgradet.",
        "plan_email.trial_ends_3d.cta": "Kies een abonnement",

        "plan_email.trial_ends_1d.subject": "Je proefperiode van {plan_name} eindigt morgen",
        "plan_email.trial_ends_1d.heading": "Je proefperiode eindigt morgen",
        "plan_email.trial_ends_1d.body": "Gebruiken je cursisten certificaten, leerpaden of livesessies? Kies dan vandaag een abonnement, dan verandert er voor hen niets. Doe je niets, dan stapt {org_name} over op Free: je content blijft, één cursus blijft openbaar en de andere wachten privé tot je upgradet.",
        "plan_email.trial_ends_1d.cta": "{plan_name} houden",

        "plan_email.trial_ended.subject": "{org_name} gebruikt nu het Free-abonnement",
        "plan_email.trial_ended.heading": "Je proefperiode van {plan_name} is afgelopen",
        "plan_email.trial_ended.body": "Er is niets verwijderd. Eén cursus blijft openbaar, je andere cursussen zijn voorlopig privé en de functies van {plan_name} staan stil. Kies een abonnement en alles wordt weer zoals het was, inclusief de zichtbaarheid van cursussen.",
        "plan_email.trial_ended.cta": "Kies een abonnement",

        "plan_email.plan_downgraded.subject": "{org_name} gebruikt nu het Free-abonnement",
        "plan_email.plan_downgraded.heading": "Je zit nu op het Free-abonnement",
        "plan_email.plan_downgraded.body": "Je abonnement op {plan_name} is beëindigd. Er is niets verwijderd: één cursus blijft openbaar, je andere cursussen zijn voorlopig privé en de functies van {plan_name} staan stil. Upgrade opnieuw en alles wordt weer zoals het was.",
        "plan_email.plan_downgraded.cta": "Bekijk je abonnement",
    },
    "th": {
        "plan_email.common.footer": "คุณได้รับอีเมลนี้เพราะคุณเป็นผู้ดูแลของ {org_name} บน LearnHouse",

        "plan_email.trial_welcome.subject": "{org_name} ใช้ฟีเจอร์ทั้งหมดของ {plan_name} ได้ {days} วัน",
        "plan_email.trial_welcome.heading": "ปลดล็อกทุกอย่างเป็นเวลา {days} วัน",
        "plan_email.trial_welcome.body": "ตลอด {days} วันข้างหน้า {org_name} จะใช้ {plan_name} ได้แก่ ใบประกาศนียบัตรที่ผู้เรียนแชร์ได้ เส้นทางการเรียนรู้ ไลฟ์เซสชัน การวิเคราะห์ข้อมูล และโดเมนของคุณเอง ไม่ต้องใช้บัตร วิธีที่เร็วที่สุดในการเห็นความแตกต่างคือเผยแพร่คอร์สหนึ่งคอร์สแล้วเชิญผู้เรียนสักสองสามคน",
        "plan_email.trial_welcome.cta": "ไปที่คอร์สของคุณ",

        "plan_email.trial_tips.subject": "สิ่งที่ทำให้ผู้เรียนกลับมา",
        "plan_email.trial_tips.heading": "สามสิ่งที่ทำให้ผู้เรียนกลับมา",
        "plan_email.trial_tips.body": "สถาบันที่ผู้เรียนเรียนจบคอร์สมักทำสามอย่างตั้งแต่แรก คือ มอบใบประกาศนียบัตรเมื่อเรียนจบคอร์ส จัดคอร์สเป็นเส้นทางการเรียนรู้เพื่อให้ผู้เรียนรู้ว่าควรเรียนอะไรต่อ และดูการวิเคราะห์ข้อมูลเพื่อดูว่าผู้เรียนหยุดตรงไหน ทั้งสามอย่างรวมอยู่ในช่วงทดลองใช้ของคุณ",
        "plan_email.trial_tips.cta": "เปิดคอร์สของคุณ",

        "plan_email.trial_ends_3d.subject": "ช่วงทดลองใช้ {plan_name} ของคุณจะสิ้นสุดในอีก {days} วัน",
        "plan_email.trial_ends_3d.heading": "เหลืออีก {days} วันสำหรับ {plan_name}",
        "plan_email.trial_ends_3d.body": "ในวันที่ {end_date} {org_name} จะย้ายไปใช้แพ็กเกจ Free หากคุณไม่เลือกแพ็กเกจ ไม่มีอะไรถูกลบ คอร์สหนึ่งคอร์สยังคงเป็นสาธารณะ คอร์สอื่นจะเป็นส่วนตัว และฟีเจอร์ของ {plan_name} จะหยุดชั่วคราวจนกว่าคุณจะอัปเกรด",
        "plan_email.trial_ends_3d.cta": "เลือกแพ็กเกจ",

        "plan_email.trial_ends_1d.subject": "ช่วงทดลองใช้ {plan_name} ของคุณจะสิ้นสุดพรุ่งนี้",
        "plan_email.trial_ends_1d.heading": "ช่วงทดลองใช้ของคุณจะสิ้นสุดพรุ่งนี้",
        "plan_email.trial_ends_1d.body": "หากผู้เรียนของคุณใช้ใบประกาศนียบัตร เส้นทางการเรียนรู้ หรือไลฟ์เซสชัน ให้เลือกแพ็กเกจวันนี้ แล้วผู้เรียนจะไม่พบการเปลี่ยนแปลงใด ๆ หากคุณไม่ทำอะไร {org_name} จะย้ายไปใช้ Free เนื้อหาของคุณยังอยู่ คอร์สหนึ่งคอร์สยังคงเป็นสาธารณะ และคอร์สอื่นจะรอเป็นส่วนตัวจนกว่าคุณจะอัปเกรด",
        "plan_email.trial_ends_1d.cta": "ใช้ {plan_name} ต่อ",

        "plan_email.trial_ended.subject": "ตอนนี้ {org_name} ใช้แพ็กเกจ Free แล้ว",
        "plan_email.trial_ended.heading": "ช่วงทดลองใช้ {plan_name} ของคุณสิ้นสุดแล้ว",
        "plan_email.trial_ended.body": "ไม่มีอะไรถูกลบ คอร์สหนึ่งคอร์สยังคงเป็นสาธารณะ คอร์สอื่นของคุณเป็นส่วนตัวไว้ก่อน และฟีเจอร์ของ {plan_name} หยุดชั่วคราว เลือกแพ็กเกจแล้วทุกอย่างจะกลับเป็นเหมือนเดิม รวมถึงการมองเห็นคอร์สด้วย",
        "plan_email.trial_ended.cta": "เลือกแพ็กเกจ",

        "plan_email.plan_downgraded.subject": "ตอนนี้ {org_name} ใช้แพ็กเกจ Free แล้ว",
        "plan_email.plan_downgraded.heading": "คุณใช้แพ็กเกจ Free อยู่",
        "plan_email.plan_downgraded.body": "การสมัครใช้ {plan_name} ของคุณสิ้นสุดแล้ว ไม่มีอะไรถูกลบ คอร์สหนึ่งคอร์สยังคงเป็นสาธารณะ คอร์สอื่นของคุณเป็นส่วนตัวไว้ก่อน และฟีเจอร์ของ {plan_name} หยุดชั่วคราว อัปเกรดอีกครั้งแล้วทุกอย่างจะกลับเป็นเหมือนเดิม",
        "plan_email.plan_downgraded.cta": "ดูแพ็กเกจของคุณ",
    },
    "bn": {
        "plan_email.common.footer": "আপনি এই ইমেলটি পাচ্ছেন কারণ আপনি LearnHouse-এ {org_name}-এর অ্যাডমিন।",

        "plan_email.trial_welcome.subject": "{days} দিনের জন্য {org_name}-এ {plan_name}-এর সব ফিচার চালু",
        "plan_email.trial_welcome.heading": "{days} দিনের জন্য সবকিছু খোলা",
        "plan_email.trial_welcome.body": "আগামী {days} দিন {org_name} চলবে {plan_name}-এ: শিক্ষার্থীরা শেয়ার করতে পারে এমন সার্টিফিকেট, লার্নিং পাথ, লাইভ সেশন, অ্যানালিটিক্স এবং আপনার নিজের ডোমেইন। কোনো কার্ড লাগবে না। পার্থক্যটা দেখার সবচেয়ে দ্রুত উপায় হলো একটি কোর্স প্রকাশ করে কয়েকজন শিক্ষার্থীকে আমন্ত্রণ জানানো।",
        "plan_email.trial_welcome.cta": "আপনার কোর্সে যান",

        "plan_email.trial_tips.subject": "শিক্ষার্থীরা কেন ফিরে আসে",
        "plan_email.trial_tips.heading": "তিনটি জিনিস যা শিক্ষার্থীদের ফিরিয়ে আনে",
        "plan_email.trial_tips.body": "যেসব অ্যাকাডেমির শিক্ষার্থীরা কোর্স শেষ করে, তারা সাধারণত শুরুতেই তিনটি কাজ করে: কোর্স শেষ হলে সার্টিফিকেট দেয়, কোর্সগুলো একটি পাথে সাজায় যাতে সবাই জানে এরপর কী নিতে হবে, আর অ্যানালিটিক্স দেখে বোঝে শিক্ষার্থীরা কোথায় থেমে যায়। তিনটিই আপনার ট্রায়ালে আছে।",
        "plan_email.trial_tips.cta": "আপনার কোর্স খুলুন",

        "plan_email.trial_ends_3d.subject": "আপনার {plan_name} ট্রায়াল {days} দিনের মধ্যে শেষ হবে",
        "plan_email.trial_ends_3d.heading": "{plan_name}-এ আর {days} দিন বাকি",
        "plan_email.trial_ends_3d.body": "আপনি কোনো প্ল্যান বেছে না নিলে {end_date} তারিখে {org_name} Free প্ল্যানে চলে যাবে। কিছুই মুছে ফেলা হবে না: একটি কোর্স পাবলিক থাকবে, বাকিগুলো প্রাইভেট হয়ে যাবে, এবং আপগ্রেড না করা পর্যন্ত {plan_name}-এর ফিচারগুলো বন্ধ থাকবে।",
        "plan_email.trial_ends_3d.cta": "প্ল্যান বেছে নিন",

        "plan_email.trial_ends_1d.subject": "আপনার {plan_name} ট্রায়াল আগামীকাল শেষ হবে",
        "plan_email.trial_ends_1d.heading": "আপনার ট্রায়াল আগামীকাল শেষ হবে",
        "plan_email.trial_ends_1d.body": "আপনার শিক্ষার্থীরা যদি সার্টিফিকেট, পাথ বা লাইভ সেশনের ওপর নির্ভর করে, তাহলে আজই একটি প্ল্যান বেছে নিন, তাদের জন্য কিছুই বদলাবে না। আপনি কিছু না করলে {org_name} Free-তে চলে যাবে: আপনার কনটেন্ট থেকে যাবে, একটি কোর্স পাবলিক থাকবে এবং বাকিগুলো আপগ্রেড না করা পর্যন্ত প্রাইভেট অবস্থায় অপেক্ষা করবে।",
        "plan_email.trial_ends_1d.cta": "{plan_name} রাখুন",

        "plan_email.trial_ended.subject": "{org_name} এখন Free প্ল্যানে আছে",
        "plan_email.trial_ended.heading": "আপনার {plan_name} ট্রায়াল শেষ হয়েছে",
        "plan_email.trial_ended.body": "কিছুই মুছে ফেলা হয়নি। একটি কোর্স পাবলিক আছে, আপনার অন্য কোর্সগুলো আপাতত প্রাইভেট, এবং {plan_name}-এর ফিচারগুলো বন্ধ রাখা হয়েছে। একটি প্ল্যান বেছে নিন, কোর্সের দৃশ্যমানতাসহ সবকিছু আগের মতো ফিরে আসবে।",
        "plan_email.trial_ended.cta": "প্ল্যান বেছে নিন",

        "plan_email.plan_downgraded.subject": "{org_name} এখন Free প্ল্যানে আছে",
        "plan_email.plan_downgraded.heading": "আপনি Free প্ল্যানে আছেন",
        "plan_email.plan_downgraded.body": "আপনার {plan_name} সাবস্ক্রিপশন শেষ হয়েছে। কিছুই মুছে ফেলা হয়নি: একটি কোর্স পাবলিক আছে, আপনার অন্য কোর্সগুলো আপাতত প্রাইভেট, এবং {plan_name}-এর ফিচারগুলো বন্ধ রাখা হয়েছে। আবার আপগ্রেড করলে সবকিছু আগের মতো ফিরে আসবে।",
        "plan_email.plan_downgraded.cta": "আপনার প্ল্যান দেখুন",
    },
}
