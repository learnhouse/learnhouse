"""Thai nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "ยกเลิกการรับอีเมลเหล่านี้",
    "nudge.common.footer": "คุณได้รับอีเมลนี้เพราะคุณเป็นผู้ดูแลของ {org_name}",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "คอร์ส",
    "nudge.stat.chapters": "บท",
    "nudge.stat.lessons": "บทเรียน",
    "nudge.stat.members": "สมาชิก",
    "nudge.stat.learners": "ผู้เรียน",
    "nudge.stat.completed": "เรียนจบ",

    "nudge.activation.first_course_d1.subject": "คอร์สแรกของคุณบน {org_name}",
    "nudge.activation.first_course_d1.heading": "เมื่อไหร่ที่คุณพร้อม",
    "nudge.activation.first_course_d1.body": "{org_name} ตั้งค่าเรียบร้อยและรอคอร์สแรกอยู่ ส่วนใหญ่เริ่มจากเล็ก ๆ คือหัวข้อเดียวกับบทเรียนไม่กี่บท เพิ่มทีหลังได้เสมอ",
    "nudge.activation.first_course_d1.cta": "สร้างคอร์สแรกของคุณ",

    "nudge.activation.come_back_d2.subject": "ทำต่อจากที่ค้างไว้",
    "nudge.activation.come_back_d2.heading": "สิ่งที่ตั้งค่าไว้ยังรออยู่",
    "nudge.activation.come_back_d2.body": "คุณสร้าง {org_name} ไว้แล้วยังไม่ได้กลับมาอีกเลย ทุกอย่างยังอยู่ครบ และการเผยแพร่คอร์สแรกใช้เวลาราวสิบนาที",
    "nudge.activation.come_back_d2.cta": "ไปที่แดชบอร์ด",

    "nudge.activation.ai_course_help_d4.subject": "หน้ากระดาษเปล่าคือส่วนที่ยากที่สุด",
    "nudge.activation.ai_course_help_d4.heading": "ให้ AI ร่างโครงให้",
    "nudge.activation.ai_course_help_d4.body": "ถ้า {org_name} ยังว่างเพราะไม่รู้จะเริ่มตรงไหน ลองอธิบายหัวข้อของคุณ แล้ว AI จะร่างบทและบทเรียนให้ จากนั้นคุณค่อยแก้ไข",
    "nudge.activation.ai_course_help_d4.cta": "สร้างคอร์สด้วย AI",

    "nudge.activation.import_existing_d5.subject": "นำสิ่งที่คุณมีอยู่แล้วมาใช้",
    "nudge.activation.import_existing_d5.heading": "ไม่ต้องเริ่มจากศูนย์",
    "nudge.activation.import_existing_d5.body": "ถ้าเนื้อหาของคุณมีอยู่แล้วในรูปเอกสาร สไลด์ หรือไฟล์ส่งออกจากแพลตฟอร์มอื่น คุณนำเข้ามาที่ {org_name} ได้เลย ไม่ต้องพิมพ์ใหม่",
    "nudge.activation.import_existing_d5.cta": "นำเข้าเนื้อหาของคุณ",

    "nudge.activation.setup_checklist_d7.subject": "สิบห้านาทีสู่สถาบันที่ใช้งานได้",
    "nudge.activation.setup_checklist_d7.heading": "รายการสั้น ๆ",
    "nudge.activation.setup_checklist_d7.body": "{org_name} ยังรอคอร์สแรกอยู่ รายการตั้งค่าจะพาคุณผ่านไปทีละขั้นสั้น ๆ ส่วนใหญ่เสร็จภายในราวสิบห้านาที",
    "nudge.activation.setup_checklist_d7.cta": "เปิดรายการ",

    "nudge.activation.whats_blocking_d14.subject": "มีอะไรมาขวางหรือเปล่า",
    "nudge.activation.whats_blocking_d14.heading": "ขอถามได้ไหมว่าอะไรทำให้หยุด",
    "nudge.activation.whats_blocking_d14.body": "คุณสร้าง {org_name} เมื่อสองสัปดาห์ก่อนและยังไม่ได้เพิ่มคอร์ส ถ้ามีอะไรที่สับสนหรือขาดไป เราอยากรู้จริง ๆ ตอบกลับอีเมลฉบับนี้ได้เลย มันจะถึงเราโดยตรง",

    "nudge.activation.last_call_d30.subject": "อีเมลฉบับสุดท้ายเรื่อง {org_name}",
    "nudge.activation.last_call_d30.heading": "นี่คือฉบับสุดท้าย",
    "nudge.activation.last_call_d30.body": "{org_name} เงียบมาหนึ่งเดือนแล้ว เราจึงหยุดส่งอีเมลแบบนี้ บัญชีและทุกอย่างข้างในยังอยู่ครบ ถ้าคุณกลับมา ทุกอย่างจะอยู่ตรงที่คุณวางไว้",
    "nudge.activation.last_call_d30.cta": "เปิดแดชบอร์ดของคุณ",

    "nudge.content.course_no_chapter_d1.subject": "«{course_name}» ยังต้องการบทแรก",
    "nudge.content.course_no_chapter_d1.heading": "เหลืออีกหนึ่งบท",
    "nudge.content.course_no_chapter_d1.body": "«{course_name}» มีอยู่แล้วแต่ยังไม่มีบท จึงยังไม่มีอะไรให้เปิด บทก็คือส่วนย่อย หนึ่งหัวข้อต่อหนึ่งบทกำลังดี",
    "nudge.content.course_no_chapter_d1.cta": "เพิ่มบท",

    "nudge.content.chapter_no_activity_d1.subject": "เพิ่มบทเรียนแรกให้ «{course_name}»",
    "nudge.content.chapter_no_activity_d1.heading": "บทต่าง ๆ พร้อมแล้ว",
    "nudge.content.chapter_no_activity_d1.body": "«{course_name}» มีบทแล้วแต่ข้างในยังว่าง บทเรียนจะเป็นหน้าข้อความ วิดีโอ หรือแบบทดสอบก็ได้ แล้วแต่ว่าอะไรเข้ากับหัวข้อ",
    "nudge.content.chapter_no_activity_d1.cta": "เพิ่มบทเรียน",

    "nudge.content.activity_unpublished_d2.subject": "บทเรียนใน «{course_name}» ยังไม่ปรากฏ",
    "nudge.content.activity_unpublished_d2.heading": "บทเรียนยังถูกซ่อนอยู่",
    "nudge.content.activity_unpublished_d2.body": "คุณเขียนบทเรียนใน «{course_name}» แล้ว แต่ยังไม่ได้เผยแพร่สักบท ผู้เรียนจึงเห็นคอร์สว่าง ๆ การเผยแพร่ไม่ได้ล็อกอะไร คุณยังแก้ไขต่อได้",
    "nudge.content.activity_unpublished_d2.cta": "เผยแพร่บทเรียนของคุณ",

    "nudge.content.course_draft_d3.subject": "«{course_name}» ยังเป็นฉบับร่าง",
    "nudge.content.course_draft_d3.heading": "«{course_name}» ใกล้เสร็จแล้ว",
    "nudge.content.course_draft_d3.body": "คุณเพิ่มบทเรียนให้ «{course_name}» แล้ว แต่ยังไม่ได้เผยแพร่ จึงยังไม่มีใครเปิดได้ ไม่จำเป็นต้องเสร็จสมบูรณ์ การเผยแพร่แค่ทำให้มองเห็น และคุณยังแก้ไขต่อได้",
    "nudge.content.course_draft_d3.cta": "เผยแพร่",

    "nudge.content.course_draft_d10.subject": "«{course_name}» เป็นฉบับร่างมาสักพักแล้ว",
    "nudge.content.course_draft_d10.heading": "น่าจะพร้อมแล้ว",
    "nudge.content.course_draft_d10.body": "«{course_name}» ยังไม่ได้เผยแพร่มากว่าหนึ่งสัปดาห์ คอร์สแทบไม่เคยรู้สึกว่าเสร็จ การเผยแพร่ทำให้คนเห็น และคุณยังปรับปรุงต่อได้ระหว่างที่มีคนอ่านอยู่",
    "nudge.content.course_draft_d10.cta": "เผยแพร่",

    "nudge.content.thin_course_d5.subject": "«{course_name}» เติมได้อีกนิด",
    "nudge.content.thin_course_d5.heading": "มีแค่หนึ่งถึงสองบทเรียน",
    "nudge.content.thin_course_d5.body": "ตอนนี้ «{course_name}» มีบทเรียนหนึ่งถึงสองบท คอร์สมักได้ผลดีกว่าเมื่อมีสักสองสามบท และ AI ร่างบทถัดไปจากเนื้อหาที่มีอยู่ได้",
    "nudge.content.thin_course_d5.cta": "เพิ่มบทเรียน",

    "nudge.content.assignment_no_submissions_d5.subject": "ยังไม่มีการส่งงานใน {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "ยังไม่มีใครส่งงาน",
    "nudge.content.assignment_no_submissions_d5.body": "คุณสร้างงานที่มอบหมายไว้ใน {org_name} แต่ยังไม่มีใครส่ง ลองตรวจดูว่าเผยแพร่แล้วหรือยัง และผู้เรียนเข้าถึงคอร์สที่งานนั้นสังกัดอยู่ได้หรือไม่",
    "nudge.content.assignment_no_submissions_d5.cta": "ตรวจงานที่มอบหมาย",

    "nudge.audience.published_no_members_d1.subject": "«{course_name}» เผยแพร่แล้ว แต่ยังไม่มีใครอยู่",
    "nudge.audience.published_no_members_d1.heading": "ถึงเวลาชวนใครสักคน",
    "nudge.audience.published_no_members_d1.body": "«{course_name}» เผยแพร่แล้วและพร้อมให้อ่าน {org_name} ยังไม่มีผู้เรียนเลย ขั้นต่อไปคือชวนคนที่คุณเขียนคอร์สนี้ให้",
    "nudge.audience.published_no_members_d1.cta": "เชิญผู้เรียน",

    "nudge.audience.published_no_members_d7.subject": "«{course_name}» ยังไม่มีผู้เรียน",
    "nudge.audience.published_no_members_d7.heading": "เผยแพร่มาหนึ่งสัปดาห์ ยังไม่มีใครอ่าน",
    "nudge.audience.published_no_members_d7.body": "«{course_name}» เผยแพร่มาหนึ่งสัปดาห์แล้วและ {org_name} ยังไม่มีผู้เรียน คุณจะเชิญทีละคน วางรายชื่อทั้งชุด หรือแค่แชร์ลิงก์เข้าร่วมก็ได้",
    "nudge.audience.published_no_members_d7.cta": "เชิญคนเข้าร่วม",

    "nudge.audience.members_no_enrollment_d3.subject": "ผู้เรียนของคุณยังไม่เริ่ม",
    "nudge.audience.members_no_enrollment_d3.heading": "เข้าร่วมแล้วแต่ยังไม่ได้เปิดอะไร",
    "nudge.audience.members_no_enrollment_d3.body": "มีคนเข้าร่วม {org_name} แล้ว แต่ยังไม่มีใครเริ่มคอร์ส ข้อความสั้น ๆ พร้อมลิงก์ตรงมักได้ผล ส่วนใหญ่แค่ยังหาทางเข้าไม่เจอ",
    "nudge.audience.members_no_enrollment_d3.cta": "ดูสมาชิกของคุณ",

    "nudge.audience.share_public_page_d14.subject": "หน้าคอร์สของคุณเป็นสาธารณะ — ลิงก์อยู่นี่",
    "nudge.audience.share_public_page_d14.heading": "ใครก็ตามที่มีลิงก์อ่านได้",
    "nudge.audience.share_public_page_d14.body": "«{course_name}» เป็นสาธารณะ คุณจึงแชร์ที่ไหนก็ได้โดยไม่ต้องให้ใครรอคำเชิญ ลิงก์ด้านล่างคือลิงก์ที่ส่งได้เลย",
    "nudge.audience.share_public_page_d14.cta": "ดูหน้าสาธารณะ",

    "nudge.audience.stalled_learners_d14.subject": "ผู้เรียนบางคนหยุดกลางทาง",
    "nudge.audience.stalled_learners_d14.heading": "มีบางคนติดอยู่",
    "nudge.audience.stalled_learners_d14.body": "ผู้เรียนบางคนใน {org_name} เริ่มคอร์สไว้แล้วไม่กลับมาสองสัปดาห์ ข้อความจากคุณมักช่วยได้ และการดูว่าเขาหยุดตรงไหนก็เช่นกัน",
    "nudge.audience.stalled_learners_d14.cta": "ดูผู้เรียนของคุณ",

    "nudge.monetization.course_limit_d1.subject": "คุณใช้คอร์สในแพ็กเกจ {plan_name} หมดแล้ว",
    "nudge.monetization.course_limit_d1.heading": "คุณถึงขีดจำกัดจำนวนคอร์สแล้ว",
    "nudge.monetization.course_limit_d1.body": "{org_name} อยู่บนแพ็กเกจ {plan_name} และใช้คอร์สที่รวมมาหมดแล้ว ถ้าอยากสร้างต่อ การเปลี่ยนไป {next_plan} จะปลดขีดจำกัดนี้",
    "nudge.monetization.course_limit_d1.cta": "ดูแพ็กเกจ",

    "nudge.monetization.member_limit_near.subject": "คุณใกล้ถึงขีดจำกัดสมาชิกของแพ็กเกจ {plan_name}",
    "nudge.monetization.member_limit_near.heading": "เกือบถึงขีดจำกัดสมาชิก",
    "nudge.monetization.member_limit_near.body": "{org_name} กำลังเข้าใกล้จำนวนสมาชิกที่แพ็กเกจ {plan_name} อนุญาต การเปลี่ยนไป {next_plan} จะเพิ่มจำนวนนั้น เพื่อไม่ให้ใครถูกปฏิเสธกลางคันตอนสมัคร",
    "nudge.monetization.member_limit_near.cta": "ดูแพ็กเกจ",

    "nudge.monetization.ai_credits_low.subject": "เครดิต AI ของคุณใกล้หมด",
    "nudge.monetization.ai_credits_low.heading": "เครดิต AI เหลือน้อย",
    "nudge.monetization.ai_credits_low.body": "{org_name} ใช้เครดิต AI ที่รวมมากับแพ็กเกจ {plan_name} ไปเกือบหมดแล้ว ถ้า AI กลายเป็นส่วนหนึ่งของวิธีสร้างคอร์สของคุณ แพ็กเกจ {next_plan} มีให้มากกว่า",
    "nudge.monetization.ai_credits_low.cta": "ดูแพ็กเกจ",

    "nudge.monetization.upgrade_recap_d21.subject": "{next_plan} จะเพิ่มอะไรให้ {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "คุณสร้างอะไรที่เป็นรูปเป็นร่างแล้ว",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} มีคอร์สที่เผยแพร่แล้วและมีคนอ่าน แพ็กเกจ {next_plan} ให้พื้นที่เติบโตและมีบางอย่างที่แพ็กเกจ {plan_name} ไม่มี น่าดูไว้ถ้าคุณคิดจะขยาย",
    "nudge.monetization.upgrade_recap_d21.cta": "เปรียบเทียบแพ็กเกจ",

    "nudge.dormancy.no_login_14d.subject": "{org_name} เงียบไปพักหนึ่ง",
    "nudge.dormancy.no_login_14d.heading": "ผ่านมาสองสัปดาห์แล้ว",
    "nudge.dormancy.no_login_14d.body": "ไม่มีอะไรเปลี่ยนใน {org_name} นับจากครั้งล่าสุดที่คุณเข้ามา ถ้าคุณกำลังทำอะไรค้างไว้ มันยังอยู่ตรงที่คุณวางไว้",
    "nudge.dormancy.no_login_14d.cta": "เปิดแดชบอร์ดของคุณ",

    "nudge.dormancy.no_login_30d.subject": "คอร์สของคุณบน {org_name} ยังอยู่ครบ",
    "nudge.dormancy.no_login_30d.heading": "ผ่านมาหลายสัปดาห์แล้ว",
    "nudge.dormancy.no_login_30d.body": "ระหว่างที่คุณไม่อยู่ไม่มีอะไรเปลี่ยน {org_name} และทุกอย่างข้างในยังอยู่ตรงที่คุณวางไว้ กลับมาทำต่อแค่คลิกเดียว",
    "nudge.dormancy.no_login_30d.cta": "เปิดแดชบอร์ดของคุณ",

    "nudge.dormancy.no_login_60d.subject": "ข้อความสุดท้ายเรื่อง {org_name}",
    "nudge.dormancy.no_login_60d.heading": "เราจะไม่รบกวนแล้ว",
    "nudge.dormancy.no_login_60d.body": "{org_name} เงียบมาราวสองเดือน นี่จึงเป็นอีเมลแบบนี้ฉบับสุดท้ายไปก่อน ทุกอย่างที่คุณสร้างไว้ยังคงอยู่เหมือนเดิม เมื่อไหร่ที่คุณต้องการ",
    "nudge.dormancy.no_login_60d.cta": "เปิดแดชบอร์ดของคุณ",

    "nudge.dormancy.winback_q.subject": "มีอะไรใหม่นับจากครั้งล่าสุดที่คุณเข้า {org_name}",
    "nudge.dormancy.winback_q.heading": "มีบางอย่างเปลี่ยนไป",
    "nudge.dormancy.winback_q.body": "ผ่านมาสักพักแล้วนับจากที่คุณเข้า {org_name} ครั้งล่าสุด ผลิตภัณฑ์พัฒนาไปพอสมควร และทุกอย่างที่คุณสร้างไว้ยังอยู่",
    "nudge.dormancy.winback_q.cta": "ลองดูสักหน่อย",

    "nudge.milestone.first_course_published.subject": "«{course_name}» เผยแพร่แล้ว",
    "nudge.milestone.first_course_published.heading": "คุณเผยแพร่คอร์สแรกแล้ว",
    "nudge.milestone.first_course_published.body": "«{course_name}» เผยแพร่แล้วและอ่านได้ สิ่งที่ทำให้ต่างจากนี้ไปคือการมีคนอ่าน แค่หนึ่งถึงสองคนตอนเริ่มก็พอ",
    "nudge.milestone.first_course_published.cta": "เชิญผู้เรียนกลุ่มแรก",

    "nudge.milestone.first_learner_enrolled.subject": "มีคนเริ่มเรียน «{course_name}» แล้ว",
    "nudge.milestone.first_learner_enrolled.heading": "ผู้เรียนคนแรกของคุณมาแล้ว",
    "nudge.milestone.first_learner_enrolled.body": "มีคนเริ่มเรียนคอร์สใน {org_name} เป็นครั้งแรก คุณติดตามความคืบหน้าได้จากแดชบอร์ด",
    "nudge.milestone.first_learner_enrolled.cta": "ดูความคืบหน้า",

    "nudge.milestone.first_completion.subject": "มีคนเรียนจบคอร์สใน {org_name}",
    "nudge.milestone.first_completion.heading": "การเรียนจบครั้งแรก",
    "nudge.milestone.first_completion.body": "ผู้เรียนคนหนึ่งเรียนคอร์สใน {org_name} จบตั้งแต่ต้นจนจบ ถ้าอยากบันทึกไว้ให้เป็นเรื่องเป็นราว คุณเพิ่มใบรับรองได้ หรือจะเริ่มสร้างคอร์สถัดไปก็ได้",
    "nudge.milestone.first_completion.cta": "เปิดแดชบอร์ดของคุณ",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "สถาบันของคุณบน {org_name} ยังอยู่",
    "nudge.reactivation.opener.heading": "ยังอยู่ ตรงที่คุณวางไว้",
    "nudge.reactivation.opener.body": "ไม่มีใครแตะ {org_name} เลยนับจากครั้งล่าสุดที่คุณเข้ามา ทุกคอร์ส ทุกบท ทุกบทเรียนยังอยู่ที่เดิม กลับมาทำต่อแค่คลิกเดียว",
    "nudge.reactivation.opener.cta": "เปิดแดชบอร์ดของคุณ",
    "nudge.reactivation.whats_changed.subject": "มีบางอย่างเปลี่ยนไปบน LearnHouse",
    "nudge.reactivation.whats_changed.heading": "นับจากครั้งล่าสุดที่คุณเข้ามา",
    "nudge.reactivation.whats_changed.body": "ระหว่างที่ {org_name} เงียบ ผลิตภัณฑ์พัฒนาไปพอสมควร ทั้งตัวแก้ไข เครื่องมือสร้างคอร์ส และเส้นทางของผู้เรียนได้รับการปรับจริงจัง ทุกอย่างที่คุณสร้างไว้ยังทำงานเหมือนเดิม",
    "nudge.reactivation.whats_changed.cta": "ดูสิ่งที่เปลี่ยนไป",
    "nudge.reactivation.need_a_hand.subject": "ให้เราช่วยพาคุณกลับเข้า {org_name} ไหม",
    "nudge.reactivation.need_a_hand.heading": "มีอะไรมาขวางหรือเปล่า",
    "nudge.reactivation.need_a_hand.body": "ถ้ามีเหตุผลที่ทำให้ {org_name} หยุดไป ไม่ว่าจะสับสนตรงไหน ขาดอะไร หรือแค่ไม่มีเวลา เราอยากรู้จริง ๆ ตอบกลับอีเมลฉบับนี้ได้เลย มันจะถึงเราโดยตรง",
    "nudge.reactivation.closing.subject": "ข้อความสุดท้ายเรื่อง {org_name}",
    "nudge.reactivation.closing.heading": "เราขอหยุดไว้เท่านี้",
    "nudge.reactivation.closing.body": "นี่คืออีเมลแบบนี้ฉบับสุดท้าย {org_name} ยังคงอยู่เหมือนเดิมและไม่มีอะไรหมดอายุ หากวันหนึ่งคุณอยากกลับมา ทุกอย่างจะรออยู่",
    "nudge.reactivation.closing.cta": "เปิดแดชบอร์ดของคุณ",
}
