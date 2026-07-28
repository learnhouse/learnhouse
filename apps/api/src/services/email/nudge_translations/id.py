"""Indonesian nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Berhenti berlangganan email ini",
    "nudge.common.footer": "Anda menerima email ini karena Anda admin di {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Kursus",
    "nudge.stat.chapters": "Bab",
    "nudge.stat.lessons": "Pelajaran",
    "nudge.stat.members": "Anggota",
    "nudge.stat.learners": "Peserta",
    "nudge.stat.completed": "Selesai",

    "nudge.activation.first_course_d1.subject": "Kursus pertama Anda di {org_name}",
    "nudge.activation.first_course_d1.heading": "Kapan pun Anda siap",
    "nudge.activation.first_course_d1.body": "{org_name} sudah siap dan menunggu kursus pertamanya. Kebanyakan orang mulai dari yang kecil: satu topik, beberapa pelajaran. Menambah bisa kapan saja.",
    "nudge.activation.first_course_d1.cta": "Buat kursus pertama Anda",

    "nudge.activation.come_back_d2.subject": "Lanjutkan dari tempat Anda berhenti",
    "nudge.activation.come_back_d2.heading": "Pengaturan Anda masih menunggu",
    "nudge.activation.come_back_d2.body": "Anda membuat {org_name} dan belum kembali sejak itu. Semuanya masih ada, dan menerbitkan kursus pertama butuh sekitar sepuluh menit.",
    "nudge.activation.come_back_d2.cta": "Buka dasbor",

    "nudge.activation.ai_course_help_d4.subject": "Halaman kosong itu bagian tersulit",
    "nudge.activation.ai_course_help_d4.heading": "Biarkan AI menulis kerangkanya",
    "nudge.activation.ai_course_help_d4.body": "Kalau {org_name} masih kosong karena bingung mulai dari mana, cukup jelaskan topiknya dan AI akan menyusun draf bab serta pelajarannya. Penyuntingan tetap di tangan Anda.",
    "nudge.activation.ai_course_help_d4.cta": "Buat kursus dengan AI",

    "nudge.activation.import_existing_d5.subject": "Bawa yang sudah Anda punya",
    "nudge.activation.import_existing_d5.heading": "Tak perlu mulai dari nol",
    "nudge.activation.import_existing_d5.body": "Kalau materi Anda sudah ada dalam bentuk dokumen, slide, atau ekspor dari platform lain, Anda bisa memasukkannya ke {org_name} alih-alih mengetik ulang.",
    "nudge.activation.import_existing_d5.cta": "Impor materi Anda",

    "nudge.activation.setup_checklist_d7.subject": "Lima belas menit menuju akademi yang jalan",
    "nudge.activation.setup_checklist_d7.heading": "Daftar singkat",
    "nudge.activation.setup_checklist_d7.body": "{org_name} masih menunggu kursus pertamanya. Daftar penyiapan memandu Anda dalam beberapa langkah singkat — kebanyakan orang selesai dalam seperempat jam.",
    "nudge.activation.setup_checklist_d7.cta": "Buka daftarnya",

    "nudge.activation.whats_blocking_d14.subject": "Apa yang menghalangi?",
    "nudge.activation.whats_blocking_d14.heading": "Boleh kami tanya apa yang membuat Anda berhenti?",
    "nudge.activation.whats_blocking_d14.body": "Anda membuat {org_name} dua minggu lalu dan belum menambahkan kursus. Kalau ada yang membingungkan atau kurang, kami ingin tahu — balas saja email ini, langsung sampai ke kami.",

    "nudge.activation.last_call_d30.subject": "Email terakhir soal {org_name}",
    "nudge.activation.last_call_d30.heading": "Ini yang terakhir",
    "nudge.activation.last_call_d30.body": "{org_name} sudah sebulan sepi, jadi kami berhenti mengirim email seperti ini. Akun dan semua isinya tetap ada — kalau Anda kembali, semuanya masih di tempatnya.",
    "nudge.activation.last_call_d30.cta": "Buka dasbor Anda",

    "nudge.content.course_no_chapter_d1.subject": "«{course_name}» butuh bab pertamanya",
    "nudge.content.course_no_chapter_d1.heading": "Tinggal satu bab",
    "nudge.content.course_no_chapter_d1.body": "«{course_name}» sudah ada tapi belum punya bab, jadi belum ada yang bisa dibuka. Bab hanyalah bagian — satu per topik biasanya pas.",
    "nudge.content.course_no_chapter_d1.cta": "Tambah bab",

    "nudge.content.chapter_no_activity_d1.subject": "Tambahkan pelajaran pertama ke «{course_name}»",
    "nudge.content.chapter_no_activity_d1.heading": "Babnya sudah siap",
    "nudge.content.chapter_no_activity_d1.body": "«{course_name}» punya bab, tapi isinya masih kosong. Pelajaran bisa berupa halaman teks, video, atau kuis — apa pun yang cocok dengan topiknya.",
    "nudge.content.chapter_no_activity_d1.cta": "Tambah pelajaran",

    "nudge.content.activity_unpublished_d2.subject": "Pelajaran Anda di «{course_name}» belum terlihat",
    "nudge.content.activity_unpublished_d2.heading": "Pelajarannya masih tersembunyi",
    "nudge.content.activity_unpublished_d2.body": "Anda sudah menulis pelajaran di «{course_name}», tapi belum ada yang diterbitkan, jadi peserta melihat kursus kosong. Menerbitkan tidak mengunci apa pun — Anda tetap bisa menyunting.",
    "nudge.content.activity_unpublished_d2.cta": "Terbitkan pelajaran Anda",

    "nudge.content.course_draft_d3.subject": "«{course_name}» masih berupa draf",
    "nudge.content.course_draft_d3.heading": "«{course_name}» hampir jadi",
    "nudge.content.course_draft_d3.body": "Anda sudah menambahkan pelajaran ke «{course_name}», tapi belum diterbitkan sehingga tak ada yang bisa membukanya. Tidak harus selesai — menerbitkan hanya membuatnya terlihat, dan Anda tetap bisa menyunting sesudahnya.",
    "nudge.content.course_draft_d3.cta": "Terbitkan",

    "nudge.content.course_draft_d10.subject": "«{course_name}» sudah lama jadi draf",
    "nudge.content.course_draft_d10.heading": "Kemungkinan sudah siap",
    "nudge.content.course_draft_d10.body": "«{course_name}» belum diterbitkan selama lebih dari seminggu. Kursus jarang terasa selesai — menerbitkan membuatnya terlihat, dan Anda bisa terus memperbaiki sambil orang sudah membaca.",
    "nudge.content.course_draft_d10.cta": "Terbitkan",

    "nudge.content.thin_course_d5.subject": "«{course_name}» bisa ditambah sedikit lagi",
    "nudge.content.thin_course_d5.heading": "Baru satu dua pelajaran",
    "nudge.content.thin_course_d5.body": "«{course_name}» baru punya satu dua pelajaran. Kursus biasanya lebih mengena dengan beberapa pelajaran, dan AI bisa menyusun draf berikutnya dari yang sudah ada.",
    "nudge.content.thin_course_d5.cta": "Tambah pelajaran",

    "nudge.content.assignment_no_submissions_d5.subject": "Belum ada pengumpulan di {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Belum ada yang mengumpulkan",
    "nudge.content.assignment_no_submissions_d5.body": "Anda membuat tugas di {org_name} tapi belum ada yang dikumpulkan. Ada baiknya memeriksa apakah tugas itu sudah diterbitkan dan peserta bisa mengakses kursusnya.",
    "nudge.content.assignment_no_submissions_d5.cta": "Periksa tugas Anda",

    "nudge.audience.published_no_members_d1.subject": "«{course_name}» sudah tayang, tapi belum ada orang",
    "nudge.audience.published_no_members_d1.heading": "Saatnya mengundang seseorang",
    "nudge.audience.published_no_members_d1.body": "«{course_name}» sudah diterbitkan dan siap dibaca. {org_name} belum punya peserta, jadi langkah berikutnya adalah mengundang orang-orang yang Anda tuju saat menulisnya.",
    "nudge.audience.published_no_members_d1.cta": "Undang peserta",

    "nudge.audience.published_no_members_d7.subject": "«{course_name}» masih tanpa peserta",
    "nudge.audience.published_no_members_d7.heading": "Seminggu tayang, belum ada yang baca",
    "nudge.audience.published_no_members_d7.body": "«{course_name}» sudah seminggu terbit dan {org_name} masih belum punya peserta. Anda bisa mengundang satu per satu, menempel daftar, atau cukup membagikan tautan gabung.",
    "nudge.audience.published_no_members_d7.cta": "Undang orang",

    "nudge.audience.members_no_enrollment_d3.subject": "Peserta Anda belum mulai",
    "nudge.audience.members_no_enrollment_d3.heading": "Sudah bergabung tapi belum membuka apa pun",
    "nudge.audience.members_no_enrollment_d3.body": "Ada yang sudah bergabung ke {org_name} tapi belum ada yang memulai kursus. Pesan singkat dengan tautan langsung biasanya cukup — kebanyakan hanya belum menemukan pintunya.",
    "nudge.audience.members_no_enrollment_d3.cta": "Lihat anggota Anda",

    "nudge.audience.share_public_page_d14.subject": "Halaman kursus Anda publik — ini tautannya",
    "nudge.audience.share_public_page_d14.heading": "Siapa pun dengan tautannya bisa membaca",
    "nudge.audience.share_public_page_d14.body": "«{course_name}» bersifat publik, jadi bisa Anda bagikan di mana saja tanpa perlu undangan. Tautan di bawah inilah yang perlu dikirim.",
    "nudge.audience.share_public_page_d14.cta": "Lihat halaman publik",

    "nudge.audience.stalled_learners_d14.subject": "Beberapa peserta berhenti di tengah jalan",
    "nudge.audience.stalled_learners_d14.heading": "Beberapa orang tersendat",
    "nudge.audience.stalled_learners_d14.body": "Beberapa peserta di {org_name} memulai kursus dan sudah dua minggu tidak kembali. Pesan dari Anda sering membantu, begitu juga melihat di mana mereka berhenti.",
    "nudge.audience.stalled_learners_d14.cta": "Periksa peserta Anda",

    "nudge.monetization.course_limit_d1.subject": "Anda sudah memakai semua kursus di paket {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Anda mencapai batas kursus",
    "nudge.monetization.course_limit_d1.body": "{org_name} memakai paket {plan_name} dan sudah menghabiskan semua kursus yang termasuk. Naik ke {next_plan} menghapus batas itu kalau Anda ingin terus membuat.",
    "nudge.monetization.course_limit_d1.cta": "Lihat paket",

    "nudge.monetization.member_limit_near.subject": "Anda hampir mencapai batas anggota paket {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Hampir menyentuh batas anggota",
    "nudge.monetization.member_limit_near.body": "{org_name} mendekati jumlah anggota yang diizinkan paket {plan_name}. Naik ke {next_plan} menaikkan batasnya, supaya tak ada yang tertolak di tengah pendaftaran.",
    "nudge.monetization.member_limit_near.cta": "Lihat paket",

    "nudge.monetization.ai_credits_low.subject": "Kredit AI Anda hampir habis",
    "nudge.monetization.ai_credits_low.heading": "Kredit AI tinggal sedikit",
    "nudge.monetization.ai_credits_low.body": "{org_name} sudah memakai sebagian besar kredit AI yang termasuk dalam paket {plan_name}. Paket {next_plan} memberi lebih banyak, kalau AI sudah jadi bagian dari cara Anda menyusun kursus.",
    "nudge.monetization.ai_credits_low.cta": "Lihat paket",

    "nudge.monetization.upgrade_recap_d21.subject": "Apa yang {next_plan} tambahkan untuk {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Anda sudah membangun sesuatu yang nyata",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} punya kursus yang terbit dan orang yang membacanya. Paket {next_plan} memberi ruang untuk tumbuh dan beberapa hal yang tidak ada di paket {plan_name} — layak dilihat kalau Anda berencana memperluas.",
    "nudge.monetization.upgrade_recap_d21.cta": "Bandingkan paket",

    "nudge.dormancy.no_login_14d.subject": "{org_name} sedang sepi",
    "nudge.dormancy.no_login_14d.heading": "Sudah dua minggu",
    "nudge.dormancy.no_login_14d.body": "Tidak ada yang berubah di {org_name} sejak kunjungan terakhir Anda. Kalau Anda sedang di tengah sesuatu, semuanya masih persis di tempat Anda tinggalkan.",
    "nudge.dormancy.no_login_14d.cta": "Buka dasbor Anda",

    "nudge.dormancy.no_login_30d.subject": "Kursus Anda di {org_name} masih ada",
    "nudge.dormancy.no_login_30d.heading": "Sudah beberapa minggu",
    "nudge.dormancy.no_login_30d.body": "Tidak ada yang berubah selama Anda pergi — {org_name} dan semua isinya persis di tempat Anda tinggalkan. Melanjutkan hanya butuh satu klik.",
    "nudge.dormancy.no_login_30d.cta": "Buka dasbor Anda",

    "nudge.dormancy.no_login_60d.subject": "Pesan terakhir soal {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Kami tidak akan mengganggu lagi",
    "nudge.dormancy.no_login_60d.body": "{org_name} sudah sekitar dua bulan sepi, jadi ini email terakhir semacam ini untuk sekarang. Semua yang Anda bangun tetap apa adanya, untuk kapan pun Anda membutuhkannya.",
    "nudge.dormancy.no_login_60d.cta": "Buka dasbor Anda",

    "nudge.dormancy.winback_q.subject": "Apa yang baru sejak terakhir Anda di {org_name}",
    "nudge.dormancy.winback_q.heading": "Ada beberapa perubahan",
    "nudge.dormancy.winback_q.body": "Sudah lama sejak Anda terakhir masuk ke {org_name}. Produknya berkembang cukup jauh sejak itu, dan semua yang Anda bangun masih ada.",
    "nudge.dormancy.winback_q.cta": "Lihat sebentar",

    "nudge.milestone.first_course_published.subject": "«{course_name}» sudah tayang",
    "nudge.milestone.first_course_published.heading": "Anda menerbitkan kursus pertama",
    "nudge.milestone.first_course_published.body": "«{course_name}» sudah tayang dan bisa dibaca. Yang membuat perbedaan sekarang adalah ada yang membacanya — satu dua orang untuk awal pun cukup.",
    "nudge.milestone.first_course_published.cta": "Undang peserta pertama Anda",

    "nudge.milestone.first_learner_enrolled.subject": "Ada yang memulai «{course_name}»",
    "nudge.milestone.first_learner_enrolled.heading": "Peserta pertama Anda sudah masuk",
    "nudge.milestone.first_learner_enrolled.body": "Untuk pertama kalinya ada yang memulai kursus di {org_name}. Anda bisa memantau perkembangannya dari dasbor.",
    "nudge.milestone.first_learner_enrolled.cta": "Lihat perkembangannya",

    "nudge.milestone.first_completion.subject": "Ada yang menyelesaikan kursus di {org_name}",
    "nudge.milestone.first_completion.heading": "Penyelesaian pertama",
    "nudge.milestone.first_completion.body": "Seorang peserta menyelesaikan kursus di {org_name} dari awal sampai akhir. Kalau ingin mencatatnya dengan pantas, Anda bisa menambahkan sertifikat — atau mulai menyiapkan kursus berikutnya.",
    "nudge.milestone.first_completion.cta": "Buka dasbor Anda",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Akademi Anda di {org_name} masih ada",
    "nudge.reactivation.opener.heading": "Masih di sini, persis seperti Anda tinggalkan",
    "nudge.reactivation.opener.body": "Tak ada yang menyentuh {org_name} sejak kunjungan terakhir Anda — setiap kursus, bab, dan pelajaran ada di tempatnya. Melanjutkan hanya butuh satu klik.",
    "nudge.reactivation.opener.cta": "Buka dasbor Anda",
    "nudge.reactivation.whats_changed.subject": "Ada beberapa perubahan di LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Sejak terakhir Anda ke sini",
    "nudge.reactivation.whats_changed.body": "Produknya berkembang cukup jauh selagi {org_name} sepi: editor, perkakas kursus, dan alur peserta semuanya digarap serius. Semua yang Anda bangun tetap berjalan seperti dulu.",
    "nudge.reactivation.whats_changed.cta": "Lihat apa yang baru",
    "nudge.reactivation.need_a_hand.subject": "Perlu bantuan untuk kembali ke {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "Ada yang menghalangi?",
    "nudge.reactivation.need_a_hand.body": "Kalau ada alasan {org_name} berhenti — sesuatu yang membingungkan, ada yang kurang, atau memang tidak sempat — kami sungguh ingin mendengarnya. Balas email ini, langsung sampai ke kami.",
    "nudge.reactivation.closing.subject": "Catatan terakhir soal {org_name}",
    "nudge.reactivation.closing.heading": "Kami berhenti di sini",
    "nudge.reactivation.closing.body": "Ini yang terakhir dari email semacam ini. {org_name} tetap apa adanya dan tidak ada yang kedaluwarsa — kalau suatu saat ingin kembali, semuanya menunggu.",
    "nudge.reactivation.closing.cta": "Buka dasbor Anda",
}
