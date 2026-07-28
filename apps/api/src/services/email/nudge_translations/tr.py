"""Turkish nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Bu e-postalardan çık",
    "nudge.common.footer": "Bu e-postayı {org_name} yöneticisi olduğunuz için alıyorsunuz.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Kurslar",
    "nudge.stat.chapters": "Bölümler",
    "nudge.stat.lessons": "Dersler",
    "nudge.stat.members": "Üyeler",
    "nudge.stat.learners": "Katılımcılar",
    "nudge.stat.completed": "Tamamlanan",

    "nudge.activation.first_course_d1.subject": "{org_name} üzerindeki ilk kursunuz",
    "nudge.activation.first_course_d1.heading": "Hazır olduğunuzda",
    "nudge.activation.first_course_d1.body": "{org_name} kuruldu ve ilk kursunu bekliyor. Çoğu kişi küçük başlıyor: bir konu, birkaç ders. Sonradan her zaman ekleyebilirsiniz.",
    "nudge.activation.first_course_d1.cta": "İlk kursunuzu oluşturun",

    "nudge.activation.come_back_d2.subject": "Kaldığınız yerden devam edin",
    "nudge.activation.come_back_d2.heading": "Kurulumunuz sizi bekliyor",
    "nudge.activation.come_back_d2.body": "{org_name} kurumunu oluşturdunuz ama o günden beri uğramadınız. Her şey yerinde duruyor; ilk kursu yayına almak yaklaşık on dakika sürüyor.",
    "nudge.activation.come_back_d2.cta": "Panele git",

    "nudge.activation.ai_course_help_d4.subject": "Zor olan kısım boş sayfa",
    "nudge.activation.ai_course_help_d4.heading": "Taslağı yapay zekâ yazsın",
    "nudge.activation.ai_course_help_d4.body": "{org_name} nereden başlayacağınızı bilemediğiniz için hâlâ boşsa, konunuzu anlatın; yapay zekâ bölümleri ve dersleri taslak olarak hazırlasın. Düzenleme sizde.",
    "nudge.activation.ai_course_help_d4.cta": "Yapay zekâ ile kurs oluştur",

    "nudge.activation.import_existing_d5.subject": "Elinizdekini getirin",
    "nudge.activation.import_existing_d5.heading": "Sıfırdan başlamanıza gerek yok",
    "nudge.activation.import_existing_d5.body": "Materyalleriniz zaten belge, sunum veya başka bir platformdan dışa aktarım olarak varsa, yeniden yazmak yerine {org_name} içine aktarabilirsiniz.",
    "nudge.activation.import_existing_d5.cta": "Materyallerinizi içe aktarın",

    "nudge.activation.setup_checklist_d7.subject": "Çalışan bir akademiye on beş dakika",
    "nudge.activation.setup_checklist_d7.heading": "Kısa bir kontrol listesi",
    "nudge.activation.setup_checklist_d7.body": "{org_name} hâlâ ilk kursunu bekliyor. Kurulum listesi birkaç kısa adımda yol gösteriyor; çoğu kişi on beş dakikada bitiriyor.",
    "nudge.activation.setup_checklist_d7.cta": "Listeyi aç",

    "nudge.activation.whats_blocking_d14.subject": "Araya ne girdi?",
    "nudge.activation.whats_blocking_d14.heading": "Sizi ne durdurdu, sorabilir miyiz?",
    "nudge.activation.whats_blocking_d14.body": "{org_name} kurumunu iki hafta önce oluşturdunuz ve henüz kurs eklemediniz. Kafa karıştıran ya da eksik bir şey olduysa bilmek isteriz — bu e-postayı yanıtlamanız yeterli, doğrudan bize ulaşıyor.",

    "nudge.activation.last_call_d30.subject": "{org_name} hakkında son e-posta",
    "nudge.activation.last_call_d30.heading": "Bu sonuncusu",
    "nudge.activation.last_call_d30.body": "{org_name} bir aydır sessiz, bu yüzden bu e-postaları göndermeyi bırakıyoruz. Hesabınız ve içindeki her şey duruyor — dönerseniz bıraktığınız gibi bulacaksınız.",
    "nudge.activation.last_call_d30.cta": "Panelinizi açın",

    "nudge.content.course_no_chapter_d1.subject": "{course_name} ilk bölümünü bekliyor",
    "nudge.content.course_no_chapter_d1.heading": "Bir bölüm kaldı",
    "nudge.content.course_no_chapter_d1.body": "{course_name} var ama henüz bölümü yok, dolayısıyla açılacak bir şey de yok. Bölümler sadece başlıklar — konu başına bir tane iyi işliyor.",
    "nudge.content.course_no_chapter_d1.cta": "Bölüm ekle",

    "nudge.content.chapter_no_activity_d1.subject": "{course_name} kursuna ilk dersinizi ekleyin",
    "nudge.content.chapter_no_activity_d1.heading": "Bölümler hazır",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} bölümlere sahip ama içleri hâlâ boş. Bir ders metin sayfası, video ya da kısa sınav olabilir — konuya ne uyuyorsa.",
    "nudge.content.chapter_no_activity_d1.cta": "Ders ekle",

    "nudge.content.activity_unpublished_d2.subject": "{course_name} içindeki dersleriniz henüz görünmüyor",
    "nudge.content.activity_unpublished_d2.heading": "Dersler hâlâ gizli",
    "nudge.content.activity_unpublished_d2.body": "{course_name} içinde dersler yazdınız ama hiçbiri yayında değil; katılımcılar boş bir kurs görüyor. Yayınlamak hiçbir şeyi kilitlemez, düzenlemeye devam edebilirsiniz.",
    "nudge.content.activity_unpublished_d2.cta": "Derslerinizi yayınlayın",

    "nudge.content.course_draft_d3.subject": "{course_name} hâlâ taslak",
    "nudge.content.course_draft_d3.heading": "{course_name} neredeyse hazır",
    "nudge.content.course_draft_d3.body": "{course_name} kursuna dersler eklediniz ama yayında değil, bu yüzden kimse açamıyor. Bitmiş olması gerekmiyor — yayınlamak yalnızca görünür kılar, sonrasında düzenlemeye devam edebilirsiniz.",
    "nudge.content.course_draft_d3.cta": "Yayınla",

    "nudge.content.course_draft_d10.subject": "{course_name} bir süredir taslak halinde",
    "nudge.content.course_draft_d10.heading": "Muhtemelen hazır",
    "nudge.content.course_draft_d10.body": "{course_name} bir haftadan uzun süredir yayınlanmadı. Bir kurs nadiren bitmiş hissettirir — yayınlamak görünür kılar, birileri okurken geliştirmeye devam edebilirsiniz.",
    "nudge.content.course_draft_d10.cta": "Yayınla",

    "nudge.content.thin_course_d5.subject": "{course_name} biraz daha isteyebilir",
    "nudge.content.thin_course_d5.heading": "Bir iki ders var",
    "nudge.content.thin_course_d5.body": "{course_name} şimdilik bir iki derse sahip. Kurslar birkaç dersle daha iyi oturuyor ve yapay zekâ mevcut içerikten sonrakileri taslak olarak yazabilir.",
    "nudge.content.thin_course_d5.cta": "Daha fazla ders ekle",

    "nudge.content.assignment_no_submissions_d5.subject": "{org_name} içinde henüz teslim yok",
    "nudge.content.assignment_no_submissions_d5.heading": "Kimse bir şey teslim etmedi",
    "nudge.content.assignment_no_submissions_d5.body": "{org_name} içinde bir ödev oluşturdunuz ama hiçbir şey teslim edilmedi. Yayında olduğunu ve katılımcıların ilgili kursa erişebildiğini kontrol etmekte fayda var.",
    "nudge.content.assignment_no_submissions_d5.cta": "Ödevlerinizi kontrol edin",

    "nudge.audience.published_no_members_d1.subject": "{course_name} yayında ama henüz kimse yok",
    "nudge.audience.published_no_members_d1.heading": "Birini davet etme zamanı",
    "nudge.audience.published_no_members_d1.body": "{course_name} yayında ve okunmaya hazır. {org_name} henüz katılımcıya sahip değil; sıradaki adım, onu kimin için yazdıysanız onları davet etmek.",
    "nudge.audience.published_no_members_d1.cta": "Katılımcı davet et",

    "nudge.audience.published_no_members_d7.subject": "{course_name} hâlâ katılımcısız",
    "nudge.audience.published_no_members_d7.heading": "Bir haftadır yayında, okuyan yok",
    "nudge.audience.published_no_members_d7.body": "{course_name} bir haftadır yayında ve {org_name} hâlâ katılımcıya sahip değil. Tek tek davet edebilir, bir liste yapıştırabilir ya da katılım bağlantısını paylaşabilirsiniz.",
    "nudge.audience.published_no_members_d7.cta": "Kişileri davet et",

    "nudge.audience.members_no_enrollment_d3.subject": "Katılımcılarınız henüz başlamadı",
    "nudge.audience.members_no_enrollment_d3.heading": "Katıldılar ama hiçbir şey açmadılar",
    "nudge.audience.members_no_enrollment_d3.body": "{org_name} kurumuna katılanlar oldu ama kimse kursa başlamadı. Doğrudan bağlantı içeren kısa bir mesaj genelde yeterli oluyor — çoğu kişi sadece girişi bulamıyor.",
    "nudge.audience.members_no_enrollment_d3.cta": "Üyelerinizi görün",

    "nudge.audience.share_public_page_d14.subject": "Kurs sayfanız herkese açık — bağlantı burada",
    "nudge.audience.share_public_page_d14.heading": "Bağlantısı olan herkes okuyabilir",
    "nudge.audience.share_public_page_d14.body": "{course_name} herkese açık; yani kimsenin davete ihtiyacı olmadan istediğiniz yerde paylaşabilirsiniz. Aşağıdaki bağlantı gönderilecek olan.",
    "nudge.audience.share_public_page_d14.cta": "Herkese açık sayfayı gör",

    "nudge.audience.stalled_learners_d14.subject": "Bazı katılımcılar yarıda kaldı",
    "nudge.audience.stalled_learners_d14.heading": "Birkaç kişi takıldı",
    "nudge.audience.stalled_learners_d14.body": "{org_name} içindeki bazı katılımcılar bir kursa başladı ve iki haftadır dönmedi. Sizden gelecek bir mesaj çoğu zaman işe yarar; nerede durduklarına bakmak da öyle.",
    "nudge.audience.stalled_learners_d14.cta": "Katılımcıları kontrol et",

    "nudge.monetization.course_limit_d1.subject": "{plan_name} planındaki tüm kursları kullandınız",
    "nudge.monetization.course_limit_d1.heading": "Kurs sınırına ulaştınız",
    "nudge.monetization.course_limit_d1.body": "{org_name} {plan_name} planında ve dahil olan tüm kursları kullandı. Devam etmek isterseniz {next_plan} planına geçmek bu sınırı kaldırır.",
    "nudge.monetization.course_limit_d1.cta": "Planları gör",

    "nudge.monetization.member_limit_near.subject": "{plan_name} planının üye sınırına yaklaştınız",
    "nudge.monetization.member_limit_near.heading": "Üye sınırına az kaldı",
    "nudge.monetization.member_limit_near.body": "{org_name} {plan_name} planının izin verdiği üye sayısına yaklaşıyor. {next_plan} planına geçmek bu sayıyı artırır; böylece kimse kayıt olurken geri çevrilmez.",
    "nudge.monetization.member_limit_near.cta": "Planları gör",

    "nudge.monetization.ai_credits_low.subject": "Yapay zekâ krediniz bitmek üzere",
    "nudge.monetization.ai_credits_low.heading": "Yapay zekâ kredisi azalıyor",
    "nudge.monetization.ai_credits_low.body": "{org_name} {plan_name} planına dahil yapay zekâ kredilerinin çoğunu kullandı. Yapay zekâ artık kurs hazırlama biçiminizin parçasıysa {next_plan} planı daha fazlasını içeriyor.",
    "nudge.monetization.ai_credits_low.cta": "Planları gör",

    "nudge.monetization.upgrade_recap_d21.subject": "{next_plan} planının {org_name} için katacakları",
    "nudge.monetization.upgrade_recap_d21.heading": "Gerçek bir şey kurdunuz",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} yayınlanmış kurslara ve onları okuyan kişilere sahip. {next_plan} planı büyümek için alan ve {plan_name} planında bulunmayan birkaç şey sunuyor — genişlemeyi düşünüyorsanız bakmaya değer.",
    "nudge.monetization.upgrade_recap_d21.cta": "Planları karşılaştır",

    "nudge.dormancy.no_login_14d.subject": "{org_name} sessizdi",
    "nudge.dormancy.no_login_14d.heading": "Aradan iki hafta geçti",
    "nudge.dormancy.no_login_14d.body": "Son ziyaretinizden bu yana {org_name} içinde hiçbir şey değişmedi. Bir şeyin ortasındaysanız, tam bıraktığınız yerde duruyor.",
    "nudge.dormancy.no_login_14d.cta": "Panelinizi açın",

    "nudge.dormancy.no_login_30d.subject": "{org_name} üzerindeki kurslarınız hâlâ burada",
    "nudge.dormancy.no_login_30d.heading": "Birkaç hafta geçti",
    "nudge.dormancy.no_login_30d.body": "Siz yokken hiçbir şey değişmedi — {org_name} ve içindeki her şey tam bıraktığınız yerde. Kaldığınız yerden devam etmek tek tık.",
    "nudge.dormancy.no_login_30d.cta": "Panelinizi açın",

    "nudge.dormancy.no_login_60d.subject": "{org_name} hakkında son mesaj",
    "nudge.dormancy.no_login_60d.heading": "Sizi rahat bırakıyoruz",
    "nudge.dormancy.no_login_60d.body": "{org_name} birkaç aydır sessiz, bu yüzden şimdilik bu e-postaların sonuncusu. Kurduğunuz her şey olduğu gibi kalıyor, ihtiyacınız olduğu an için.",
    "nudge.dormancy.no_login_60d.cta": "Panelinizi açın",

    "nudge.dormancy.winback_q.subject": "{org_name} kurumuna son uğrayışınızdan bu yana yenilikler",
    "nudge.dormancy.winback_q.heading": "Birkaç şey değişti",
    "nudge.dormancy.winback_q.body": "{org_name} içinde son bulunuşunuzun üzerinden bir süre geçti. Ürün o zamandan bu yana epey yol aldı ve kurduğunuz her şey hâlâ orada.",
    "nudge.dormancy.winback_q.cta": "Bir göz atın",

    "nudge.milestone.first_course_published.subject": "{course_name} yayında",
    "nudge.milestone.first_course_published.heading": "İlk kursunuzu yayınladınız",
    "nudge.milestone.first_course_published.body": "{course_name} yayında ve okunabilir durumda. Şimdi asıl fark yaratacak olan, onu okuyacak birinin olması — başlangıç için bir iki kişi bile yeter.",
    "nudge.milestone.first_course_published.cta": "İlk katılımcılarınızı davet edin",

    "nudge.milestone.first_learner_enrolled.subject": "Biri {course_name} kursuna başladı",
    "nudge.milestone.first_learner_enrolled.heading": "İlk katılımcınız geldi",
    "nudge.milestone.first_learner_enrolled.body": "İlk kez biri {org_name} içinde bir kursa başladı. Nasıl ilerlediğini panelinizden takip edebilirsiniz.",
    "nudge.milestone.first_learner_enrolled.cta": "İlerlemeyi gör",

    "nudge.milestone.first_completion.subject": "Biri {org_name} içinde bir kursu tamamladı",
    "nudge.milestone.first_completion.heading": "İlk tamamlama",
    "nudge.milestone.first_completion.body": "Bir katılımcı {org_name} içindeki bir kursu baştan sona tamamladı. Bunu düzgün biçimde işaretlemek isterseniz sertifika ekleyebilir ya da sıradakini kurmaya başlayabilirsiniz.",
    "nudge.milestone.first_completion.cta": "Panelinizi açın",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "{org_name} üzerindeki akademiniz hâlâ burada",
    "nudge.reactivation.opener.heading": "Hâlâ burada, bıraktığınız gibi",
    "nudge.reactivation.opener.body": "Son ziyaretinizden bu yana {org_name} kuruluşuna kimse dokunmadı — her kurs, bölüm ve ders bıraktığınız yerde. Kaldığınız yerden devam etmek tek tık.",
    "nudge.reactivation.opener.cta": "Panelinizi açın",
    "nudge.reactivation.whats_changed.subject": "LearnHouse'ta birkaç şey değişti",
    "nudge.reactivation.whats_changed.heading": "Son ziyaretinizden bu yana",
    "nudge.reactivation.whats_changed.body": "{org_name} sessizken ürün epey yol aldı: editör, kurs araçları ve katılımcıların ilerleyişi baştan ele alındı. Kurduğunuz her şey eskisi gibi çalışıyor.",
    "nudge.reactivation.whats_changed.cta": "Yenilikleri görün",
    "nudge.reactivation.need_a_hand.subject": "{org_name} kuruluşuna dönmek için yardım ister misiniz?",
    "nudge.reactivation.need_a_hand.heading": "Araya bir şey mi girdi?",
    "nudge.reactivation.need_a_hand.body": "{org_name} durduysa bunun bir nedeni varsa — kafa karıştıran bir şey, eksik bir şey ya da sadece zaman — bunu gerçekten bilmek isteriz. Bu e-postayı yanıtlayın, doğrudan bize ulaşır.",
    "nudge.reactivation.closing.subject": "{org_name} hakkında son not",
    "nudge.reactivation.closing.heading": "Burada duruyoruz",
    "nudge.reactivation.closing.body": "Bu, bu e-postaların sonuncusu. {org_name} olduğu gibi kalıyor ve hiçbir şeyin süresi dolmuyor — bir gün dönmek isterseniz her şey sizi bekliyor olacak.",
    "nudge.reactivation.closing.cta": "Panelinizi açın",
}
