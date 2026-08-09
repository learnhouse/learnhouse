"""Vietnamese nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Hủy đăng ký nhận những email này",
    "nudge.common.footer": "Bạn nhận được email này vì bạn là quản trị viên của {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Khóa học",
    "nudge.stat.chapters": "Chương",
    "nudge.stat.lessons": "Bài học",
    "nudge.stat.members": "Thành viên",
    "nudge.stat.learners": "Người học",
    "nudge.stat.completed": "Hoàn thành",

    "nudge.activation.first_course_d1.subject": "Khóa học đầu tiên của bạn trên {org_name}",
    "nudge.activation.first_course_d1.heading": "Khi nào bạn sẵn sàng",
    "nudge.activation.first_course_d1.body": "{org_name} đã sẵn sàng và đang chờ khóa học đầu tiên. Phần lớn mọi người bắt đầu từ nhỏ: một chủ đề, vài bài học. Bạn luôn có thể bổ sung sau.",
    "nudge.activation.first_course_d1.cta": "Tạo khóa học đầu tiên",

    "nudge.activation.come_back_d2.subject": "Tiếp tục từ chỗ bạn dừng lại",
    "nudge.activation.come_back_d2.heading": "Phần thiết lập vẫn đang chờ bạn",
    "nudge.activation.come_back_d2.body": "Bạn đã tạo {org_name} và chưa quay lại từ đó. Mọi thứ vẫn còn nguyên, và đưa khóa học đầu tiên lên chỉ mất khoảng mười phút.",
    "nudge.activation.come_back_d2.cta": "Vào bảng điều khiển",

    "nudge.activation.ai_course_help_d4.subject": "Trang trắng mới là phần khó",
    "nudge.activation.ai_course_help_d4.heading": "Để AI viết dàn ý",
    "nudge.activation.ai_course_help_d4.body": "Nếu {org_name} vẫn trống vì bạn chưa biết bắt đầu từ đâu, hãy mô tả chủ đề và AI sẽ phác thảo các chương và bài học. Phần chỉnh sửa là của bạn.",
    "nudge.activation.ai_course_help_d4.cta": "Tạo khóa học bằng AI",

    "nudge.activation.import_existing_d5.subject": "Mang theo những gì bạn đã có",
    "nudge.activation.import_existing_d5.heading": "Không cần bắt đầu từ con số không",
    "nudge.activation.import_existing_d5.body": "Nếu tài liệu của bạn đã tồn tại dưới dạng văn bản, slide hay bản xuất từ nền tảng khác, bạn có thể đưa vào {org_name} thay vì gõ lại.",
    "nudge.activation.import_existing_d5.cta": "Nhập tài liệu của bạn",

    "nudge.activation.setup_checklist_d7.subject": "Mười lăm phút để có một học viện chạy được",
    "nudge.activation.setup_checklist_d7.heading": "Một danh sách ngắn",
    "nudge.activation.setup_checklist_d7.body": "{org_name} vẫn đang chờ khóa học đầu tiên. Danh sách thiết lập sẽ dẫn bạn qua vài bước ngắn — phần lớn mọi người xong trong khoảng mười lăm phút.",
    "nudge.activation.setup_checklist_d7.cta": "Mở danh sách",

    "nudge.activation.whats_blocking_d14.subject": "Điều gì đã cản trở?",
    "nudge.activation.whats_blocking_d14.heading": "Chúng tôi hỏi được không, điều gì khiến bạn dừng lại?",
    "nudge.activation.whats_blocking_d14.body": "Bạn tạo {org_name} cách đây hai tuần và vẫn chưa thêm khóa học nào. Nếu có gì khó hiểu hoặc còn thiếu, chúng tôi rất muốn biết — chỉ cần trả lời email này, nó đến thẳng chỗ chúng tôi.",

    "nudge.activation.last_call_d30.subject": "Email cuối về {org_name}",
    "nudge.activation.last_call_d30.heading": "Đây là email cuối",
    "nudge.activation.last_call_d30.body": "{org_name} đã im ắng một tháng, nên chúng tôi sẽ dừng gửi những email này. Tài khoản và mọi thứ trong đó vẫn còn nguyên — nếu bạn quay lại, mọi thứ vẫn ở chỗ cũ.",
    "nudge.activation.last_call_d30.cta": "Mở bảng điều khiển",

    "nudge.content.course_no_chapter_d1.subject": "«{course_name}» cần chương đầu tiên",
    "nudge.content.course_no_chapter_d1.heading": "Còn thiếu một chương",
    "nudge.content.course_no_chapter_d1.body": "«{course_name}» đã có nhưng chưa có chương nào, nên chưa có gì để mở. Chương chỉ là các phần — mỗi chủ đề một chương là hợp lý.",
    "nudge.content.course_no_chapter_d1.cta": "Thêm một chương",

    "nudge.content.chapter_no_activity_d1.subject": "Thêm bài học đầu tiên vào «{course_name}»",
    "nudge.content.chapter_no_activity_d1.heading": "Các chương đã sẵn sàng",
    "nudge.content.chapter_no_activity_d1.body": "«{course_name}» có chương nhưng bên trong vẫn trống. Một bài học có thể là trang văn bản, video hay bài trắc nghiệm — tùy chủ đề.",
    "nudge.content.chapter_no_activity_d1.cta": "Thêm bài học",

    "nudge.content.activity_unpublished_d2.subject": "Các bài học trong «{course_name}» vẫn chưa hiển thị",
    "nudge.content.activity_unpublished_d2.heading": "Bài học vẫn đang ẩn",
    "nudge.content.activity_unpublished_d2.body": "Bạn đã viết bài học trong «{course_name}», nhưng chưa bài nào được xuất bản nên người học chỉ thấy một khóa trống. Xuất bản không khóa gì cả — bạn vẫn chỉnh sửa được sau đó.",
    "nudge.content.activity_unpublished_d2.cta": "Xuất bản bài học",

    "nudge.content.course_draft_d3.subject": "«{course_name}» vẫn là bản nháp",
    "nudge.content.course_draft_d3.heading": "«{course_name}» sắp xong rồi",
    "nudge.content.course_draft_d3.body": "Bạn đã thêm bài học vào «{course_name}», nhưng khóa chưa được xuất bản nên không ai mở được. Không cần phải hoàn chỉnh — xuất bản chỉ làm nó hiển thị, và bạn vẫn chỉnh sửa tiếp được.",
    "nudge.content.course_draft_d3.cta": "Xuất bản",

    "nudge.content.course_draft_d10.subject": "«{course_name}» đã ở dạng nháp khá lâu",
    "nudge.content.course_draft_d10.heading": "Chắc là đã đủ rồi",
    "nudge.content.course_draft_d10.body": "«{course_name}» chưa xuất bản đã hơn một tuần. Khóa học hiếm khi có cảm giác hoàn chỉnh — xuất bản làm nó hiển thị, và bạn vẫn cải thiện được khi đã có người đọc.",
    "nudge.content.course_draft_d10.cta": "Xuất bản",

    "nudge.content.thin_course_d5.subject": "«{course_name}» có thể thêm chút nữa",
    "nudge.content.thin_course_d5.heading": "Mới có một hai bài",
    "nudge.content.thin_course_d5.body": "«{course_name}» hiện có một hai bài học. Khóa học thường thuyết phục hơn khi có thêm vài bài, và AI có thể phác thảo các bài tiếp theo từ nội dung sẵn có.",
    "nudge.content.thin_course_d5.cta": "Thêm bài học",

    "nudge.content.assignment_no_submissions_d5.subject": "Chưa có bài nộp nào trong {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Chưa ai nộp bài",
    "nudge.content.assignment_no_submissions_d5.body": "Bạn đã tạo bài tập trong {org_name} nhưng chưa có ai nộp. Nên kiểm tra xem nó đã được xuất bản chưa và người học có vào được khóa liên quan không.",
    "nudge.content.assignment_no_submissions_d5.cta": "Kiểm tra bài tập",

    "nudge.audience.published_no_members_d1.subject": "«{course_name}» đã lên nhưng chưa có ai",
    "nudge.audience.published_no_members_d1.heading": "Đã đến lúc mời ai đó",
    "nudge.audience.published_no_members_d1.body": "«{course_name}» đã xuất bản và sẵn sàng để đọc. {org_name} chưa có người học nào, nên bước tiếp theo là mời những người mà bạn viết cho họ.",
    "nudge.audience.published_no_members_d1.cta": "Mời người học",

    "nudge.audience.published_no_members_d7.subject": "«{course_name}» vẫn chưa có người học",
    "nudge.audience.published_no_members_d7.heading": "Một tuần đã lên, chưa ai đọc",
    "nudge.audience.published_no_members_d7.body": "«{course_name}» đã xuất bản được một tuần và {org_name} vẫn chưa có người học. Bạn có thể mời từng người, dán một danh sách, hoặc chỉ cần chia sẻ liên kết tham gia.",
    "nudge.audience.published_no_members_d7.cta": "Mời mọi người",

    "nudge.audience.members_no_enrollment_d3.subject": "Người học của bạn vẫn chưa bắt đầu",
    "nudge.audience.members_no_enrollment_d3.heading": "Đã tham gia nhưng chưa mở gì",
    "nudge.audience.members_no_enrollment_d3.body": "Có người đã tham gia {org_name} nhưng chưa ai bắt đầu khóa học. Một tin nhắn ngắn kèm liên kết trực tiếp thường là đủ — phần lớn chỉ là chưa tìm ra lối vào.",
    "nudge.audience.members_no_enrollment_d3.cta": "Xem thành viên",

    "nudge.audience.share_public_page_d14.subject": "Trang khóa học của bạn là công khai — liên kết đây",
    "nudge.audience.share_public_page_d14.heading": "Ai có liên kết đều đọc được",
    "nudge.audience.share_public_page_d14.body": "«{course_name}» ở chế độ công khai, nên bạn có thể chia sẻ ở bất cứ đâu mà không ai cần lời mời. Liên kết bên dưới là cái để gửi đi.",
    "nudge.audience.share_public_page_d14.cta": "Xem trang công khai",

    "nudge.audience.stalled_learners_d14.subject": "Một số người học dừng giữa chừng",
    "nudge.audience.stalled_learners_d14.heading": "Vài người đang mắc lại",
    "nudge.audience.stalled_learners_d14.body": "Một số người học trong {org_name} đã bắt đầu khóa học và hai tuần nay chưa quay lại. Một tin nhắn từ bạn thường có tác dụng, hoặc xem họ dừng ở đâu.",
    "nudge.audience.stalled_learners_d14.cta": "Kiểm tra người học",

    "nudge.monetization.course_limit_d1.subject": "Bạn đã dùng hết số khóa học của gói {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Bạn đã chạm giới hạn khóa học",
    "nudge.monetization.course_limit_d1.body": "{org_name} đang dùng gói {plan_name} và đã dùng hết số khóa học đi kèm. Chuyển lên {next_plan} sẽ bỏ giới hạn đó nếu bạn muốn tiếp tục.",
    "nudge.monetization.course_limit_d1.cta": "Xem các gói",

    "nudge.monetization.member_limit_near.subject": "Bạn sắp chạm giới hạn thành viên của gói {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Gần chạm giới hạn thành viên",
    "nudge.monetization.member_limit_near.body": "{org_name} đang tiến gần số thành viên mà gói {plan_name} cho phép. Chuyển lên {next_plan} sẽ nâng con số đó, để không ai bị chặn giữa chừng khi đăng ký.",
    "nudge.monetization.member_limit_near.cta": "Xem các gói",

    "nudge.monetization.ai_credits_low.subject": "Tín dụng AI của bạn sắp hết",
    "nudge.monetization.ai_credits_low.heading": "Còn ít tín dụng AI",
    "nudge.monetization.ai_credits_low.body": "{org_name} đã dùng gần hết tín dụng AI đi kèm gói {plan_name}. Gói {next_plan} có nhiều hơn, nếu AI đã thành một phần trong cách bạn xây khóa học.",
    "nudge.monetization.ai_credits_low.cta": "Xem các gói",

    "nudge.monetization.upgrade_recap_d21.subject": "{next_plan} sẽ mang lại gì cho {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Bạn đã dựng được điều gì đó thật sự",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} có khóa học đã xuất bản và người đọc chúng. Gói {next_plan} cho thêm chỗ để lớn lên và vài thứ mà gói {plan_name} không có — đáng xem nếu bạn định mở rộng.",
    "nudge.monetization.upgrade_recap_d21.cta": "So sánh các gói",

    "nudge.dormancy.no_login_14d.subject": "{org_name} đã im ắng",
    "nudge.dormancy.no_login_14d.heading": "Đã hai tuần trôi qua",
    "nudge.dormancy.no_login_14d.body": "Không có gì thay đổi trong {org_name} kể từ lần cuối bạn ghé. Nếu bạn đang làm dở việc gì, nó vẫn nằm đúng chỗ bạn để lại.",
    "nudge.dormancy.no_login_14d.cta": "Mở bảng điều khiển",

    "nudge.dormancy.no_login_30d.subject": "Các khóa học của bạn trên {org_name} vẫn còn đây",
    "nudge.dormancy.no_login_30d.heading": "Đã vài tuần trôi qua",
    "nudge.dormancy.no_login_30d.body": "Không có gì thay đổi khi bạn vắng mặt — {org_name} và mọi thứ trong đó vẫn đúng chỗ bạn để lại. Quay lại chỉ mất một cú nhấp.",
    "nudge.dormancy.no_login_30d.cta": "Mở bảng điều khiển",

    "nudge.dormancy.no_login_60d.subject": "Lời nhắn cuối về {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Chúng tôi sẽ không làm phiền nữa",
    "nudge.dormancy.no_login_60d.body": "{org_name} đã im ắng khoảng hai tháng, nên đây là email cuối thuộc loại này. Mọi thứ bạn đã dựng vẫn giữ nguyên, chờ khi nào bạn cần.",
    "nudge.dormancy.no_login_60d.cta": "Mở bảng điều khiển",

    "nudge.dormancy.winback_q.subject": "Có gì mới kể từ lần cuối bạn vào {org_name}",
    "nudge.dormancy.winback_q.heading": "Một vài thứ đã thay đổi",
    "nudge.dormancy.winback_q.body": "Đã lâu rồi bạn chưa ghé {org_name}. Sản phẩm đã tiến khá xa kể từ đó, và mọi thứ bạn dựng vẫn còn nguyên.",
    "nudge.dormancy.winback_q.cta": "Ghé xem",

    "nudge.milestone.first_course_published.subject": "«{course_name}» đã lên",
    "nudge.milestone.first_course_published.heading": "Bạn đã xuất bản khóa học đầu tiên",
    "nudge.milestone.first_course_published.body": "«{course_name}» đã lên và đọc được. Điều tạo khác biệt lúc này là có người đọc nó — dù ban đầu chỉ một hai người.",
    "nudge.milestone.first_course_published.cta": "Mời những người học đầu tiên",

    "nudge.milestone.first_learner_enrolled.subject": "Có người đã bắt đầu «{course_name}»",
    "nudge.milestone.first_learner_enrolled.heading": "Người học đầu tiên đã vào",
    "nudge.milestone.first_learner_enrolled.body": "Lần đầu tiên có người bắt đầu một khóa học trong {org_name}. Bạn có thể theo dõi tiến độ từ bảng điều khiển.",
    "nudge.milestone.first_learner_enrolled.cta": "Xem tiến độ",

    "nudge.milestone.first_completion.subject": "Có người hoàn thành một khóa học trong {org_name}",
    "nudge.milestone.first_completion.heading": "Lần hoàn thành đầu tiên",
    "nudge.milestone.first_completion.body": "Một người học đã hoàn thành khóa học trong {org_name} từ đầu đến cuối. Nếu muốn ghi nhận đàng hoàng, bạn có thể thêm chứng chỉ — hoặc bắt tay vào khóa tiếp theo.",
    "nudge.milestone.first_completion.cta": "Mở bảng điều khiển",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Học viện của bạn trên {org_name} vẫn còn đây",
    "nudge.reactivation.opener.heading": "Vẫn ở đây, đúng như bạn để lại",
    "nudge.reactivation.opener.body": "Không ai động vào {org_name} kể từ lần cuối bạn ghé — mọi khóa học, chương và bài học đều ở nguyên chỗ. Quay lại chỉ mất một cú nhấp.",
    "nudge.reactivation.opener.cta": "Mở bảng điều khiển",
    "nudge.reactivation.whats_changed.subject": "Có vài thay đổi trên LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Kể từ lần cuối bạn ghé",
    "nudge.reactivation.whats_changed.body": "Sản phẩm đã tiến khá xa trong lúc {org_name} im ắng: trình soạn thảo, công cụ khóa học và lộ trình của người học đều đã được làm lại đáng kể. Mọi thứ bạn dựng vẫn chạy như cũ.",
    "nudge.reactivation.whats_changed.cta": "Xem điều gì mới",
    "nudge.reactivation.need_a_hand.subject": "Cần hỗ trợ để quay lại {org_name} không?",
    "nudge.reactivation.need_a_hand.heading": "Có gì cản trở không?",
    "nudge.reactivation.need_a_hand.body": "Nếu có lý do khiến {org_name} dừng lại — điều gì đó khó hiểu, thiếu sót, hay đơn giản là không có thời gian — chúng tôi thật sự muốn nghe. Trả lời email này, nó đến thẳng chỗ chúng tôi.",
    "nudge.reactivation.closing.subject": "Lời nhắn cuối về {org_name}",
    "nudge.reactivation.closing.heading": "Chúng tôi dừng ở đây",
    "nudge.reactivation.closing.body": "Đây là email cuối thuộc loại này. {org_name} vẫn giữ nguyên và không có gì hết hạn — nếu có ngày bạn muốn quay lại, mọi thứ vẫn đang chờ.",
    "nudge.reactivation.closing.cta": "Mở bảng điều khiển",
}
