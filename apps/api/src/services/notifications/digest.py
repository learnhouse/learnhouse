"""Daily / weekly email digest of unread important notifications.

People opt in from Notification settings (``email_digest``: off, daily,
weekly). On each scheduler tick, everyone whose digest is due gets one email
per organization listing their unread, important, not yet emailed rows in
the categories they left on for email. Rows go out at most once
(``emailed_at``), and an empty digest sends nothing (but still counts as a
run, so the next one waits a full period).

Email goes through the existing sender with the org's branding and default
language. ``LEARNHOUSE_NOTIFICATIONS_DIGEST_DISABLED`` turns it off.
"""

from __future__ import annotations

import html
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import or_, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.notifications import Notification, NotificationPreference
from src.services.notifications.notifications import wants_channel

logger = logging.getLogger(__name__)

PERIOD = {"daily": timedelta(hours=23), "weekly": timedelta(days=6, hours=23)}
MAX_ITEMS = 20

COPY: dict[str, dict[str, str]] = {
    "en": {"subject": "{count} notifications need your attention", "heading": "While you were away",
           "intro": "Here is what still needs your attention in {org}.", "cta": "Open notifications",
           "footer": "You get this digest because you turned it on in Notification settings."},
    "fr": {"subject": "{count} notifications attendent votre attention", "heading": "Pendant votre absence",
           "intro": "Voici ce qui attend encore votre attention dans {org}.", "cta": "Ouvrir les notifications",
           "footer": "Vous recevez ce récapitulatif car vous l'avez activé dans les paramètres de notification."},
    "de": {"subject": "{count} Benachrichtigungen brauchen deine Aufmerksamkeit", "heading": "Während du weg warst",
           "intro": "Das wartet in {org} noch auf dich.", "cta": "Benachrichtigungen öffnen",
           "footer": "Du erhältst diese Zusammenfassung, weil du sie in den Benachrichtigungseinstellungen aktiviert hast."},
    "es": {"subject": "{count} notificaciones requieren tu atención", "heading": "Mientras no estabas",
           "intro": "Esto es lo que aún requiere tu atención en {org}.", "cta": "Abrir notificaciones",
           "footer": "Recibes este resumen porque lo activaste en la configuración de notificaciones."},
    "ar": {"subject": "{count} إشعارات تحتاج إلى انتباهك", "heading": "أثناء غيابك",
           "intro": "إليك ما لا يزال يحتاج إلى انتباهك في {org}.", "cta": "فتح الإشعارات",
           "footer": "تصلك هذه الخلاصة لأنك فعّلتها في إعدادات الإشعارات."},
    "ja": {"subject": "対応が必要な通知が{count}件あります", "heading": "留守中のお知らせ",
           "intro": "{org}でまだ対応が必要な項目です。", "cta": "通知を開く",
           "footer": "通知設定でダイジェストをオンにしているため、このメールが届いています。"},
    "pt": {"subject": "{count} notificações precisam da sua atenção", "heading": "Enquanto você estava fora",
           "intro": "Veja o que ainda precisa da sua atenção em {org}.", "cta": "Abrir notificações",
           "footer": "Você recebe este resumo porque o ativou nas configurações de notificação."},
    "ru": {"subject": "{count} уведомлений ждут вашего внимания", "heading": "Пока вас не было",
           "intro": "Вот что всё ещё ждёт вашего внимания в {org}.", "cta": "Открыть уведомления",
           "footer": "Вы получаете эту сводку, потому что включили её в настройках уведомлений."},
    "zh": {"subject": "有 {count} 条通知需要你处理", "heading": "你不在时",
           "intro": "以下是 {org} 中仍需你处理的事项。", "cta": "打开通知",
           "footer": "你收到此摘要是因为你在通知设置中开启了它。"},
    "hi": {"subject": "{count} सूचनाओं पर आपका ध्यान चाहिए", "heading": "आपकी अनुपस्थिति में",
           "intro": "{org} में ये चीज़ें अभी भी आपका ध्यान चाहती हैं।", "cta": "सूचनाएँ खोलें",
           "footer": "आपको यह सारांश इसलिए मिल रहा है क्योंकि आपने इसे सूचना सेटिंग में चालू किया है।"},
    "ko": {"subject": "확인이 필요한 알림 {count}개", "heading": "자리를 비운 동안",
           "intro": "{org}에서 아직 확인이 필요한 항목입니다.", "cta": "알림 열기",
           "footer": "알림 설정에서 요약 이메일을 켜 두셨기 때문에 이 메일을 받으셨습니다."},
    "it": {"subject": "{count} notifiche richiedono la tua attenzione", "heading": "Mentre eri via",
           "intro": "Ecco cosa richiede ancora la tua attenzione in {org}.", "cta": "Apri le notifiche",
           "footer": "Ricevi questo riepilogo perché lo hai attivato nelle impostazioni delle notifiche."},
    "tr": {"subject": "{count} bildirim ilgini bekliyor", "heading": "Sen yokken",
           "intro": "{org} içinde hâlâ ilgini bekleyenler burada.", "cta": "Bildirimleri aç",
           "footer": "Bu özeti, bildirim ayarlarında açtığın için alıyorsun."},
    "vi": {"subject": "{count} thông báo cần bạn chú ý", "heading": "Trong lúc bạn vắng mặt",
           "intro": "Đây là những gì vẫn cần bạn chú ý trong {org}.", "cta": "Mở thông báo",
           "footer": "Bạn nhận bản tóm tắt này vì đã bật nó trong cài đặt thông báo."},
    "id": {"subject": "{count} notifikasi perlu perhatian Anda", "heading": "Selama Anda pergi",
           "intro": "Berikut hal yang masih perlu perhatian Anda di {org}.", "cta": "Buka notifikasi",
           "footer": "Anda menerima ringkasan ini karena mengaktifkannya di pengaturan notifikasi."},
    "pl": {"subject": "{count} powiadomień czeka na Twoją uwagę", "heading": "Gdy Cię nie było",
           "intro": "Oto, co nadal czeka na Twoją uwagę w {org}.", "cta": "Otwórz powiadomienia",
           "footer": "Otrzymujesz to podsumowanie, bo włączyłeś je w ustawieniach powiadomień."},
    "uk": {"subject": "{count} сповіщень чекають на вашу увагу", "heading": "Поки вас не було",
           "intro": "Ось що досі чекає на вашу увагу в {org}.", "cta": "Відкрити сповіщення",
           "footer": "Ви отримуєте цей підсумок, бо ввімкнули його в налаштуваннях сповіщень."},
    "nl": {"subject": "{count} meldingen vragen je aandacht", "heading": "Terwijl je weg was",
           "intro": "Dit vraagt nog je aandacht in {org}.", "cta": "Meldingen openen",
           "footer": "Je ontvangt dit overzicht omdat je het hebt ingeschakeld in de meldingsinstellingen."},
    "th": {"subject": "มี {count} การแจ้งเตือนที่ต้องการความสนใจ", "heading": "ระหว่างที่คุณไม่อยู่",
           "intro": "นี่คือสิ่งที่ยังต้องการความสนใจของคุณใน {org}", "cta": "เปิดการแจ้งเตือน",
           "footer": "คุณได้รับสรุปนี้เพราะเปิดไว้ในการตั้งค่าการแจ้งเตือน"},
    "bn": {"subject": "{count}টি বিজ্ঞপ্তি আপনার মনোযোগ চায়", "heading": "আপনার অনুপস্থিতিতে",
           "intro": "{org}-এ যা এখনও আপনার মনোযোগ চায়।", "cta": "বিজ্ঞপ্তি খুলুন",
           "footer": "বিজ্ঞপ্তি সেটিংসে চালু করায় আপনি এই সারসংক্ষেপ পাচ্ছেন।"},
}


def copy(lang: Optional[str], key: str, **fmt) -> str:
    code = (lang or "en").split("-")[0].lower()
    template = COPY.get(code, COPY["en"]).get(key) or COPY["en"][key]
    return template.format(**fmt)


def digest_disabled() -> bool:
    return bool(os.environ.get("LEARNHOUSE_NOTIFICATIONS_DIGEST_DISABLED"))


def _parse(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_due(pref: NotificationPreference, now: datetime) -> bool:
    period = PERIOD.get(pref.email_digest or "off")
    if period is None:
        return False
    last = _parse(pref.last_digest_at)
    return last is None or now - last >= period


def render(items: list[Notification], *, base_url: str, org_name: str, lang: str) -> str:
    rows = "".join(
        '<tr><td style="padding:10px 0;border-bottom:1px solid #eee">'
        f'<a href="{html.escape(base_url + ((n.data or {}).get("path") or "/notifications"))}" '
        'style="color:#111;text-decoration:none;font-weight:600">'
        f'{html.escape(n.title)}</a>'
        + (f'<div style="color:#666;font-size:13px;margin-top:2px">{html.escape(n.body[:180])}</div>' if n.body else "")
        + "</td></tr>"
        for n in items
    )
    return (
        f'<p>{html.escape(copy(lang, "intro", org=org_name))}</p>'
        f'<table role="presentation" width="100%" style="border-collapse:collapse">{rows}</table>'
    )


async def send_digest(db: AsyncSession, user, org_id: Optional[int], items: list[Notification]) -> bool:
    from src.db.organization_config import OrganizationConfig
    from src.db.organizations import Organization
    from src.services.email.branding import resolve_org_email_branding
    from src.services.nudges.links import org_base_url
    from src.services.users.emails import _brand_logo_html, _button_style, _email_layout, _send_notification_email

    org = await db.get(Organization, org_id) if org_id else None
    org_config = (await db.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first() if org_id else None
    branding = resolve_org_email_branding(org, org_config, None)
    base = (await org_base_url(org.slug, db, org.id)).rstrip("/") if org is not None else ""
    lang = branding.lang
    heading = copy(lang, "heading")
    body = render(items, base_url=base, org_name=branding.org_name or "LearnHouse", lang=lang) + (
        f'<p style="margin-top:20px"><a href="{html.escape(base + "/notifications")}" '
        f'style="{_button_style(branding.brand_color)}">{html.escape(copy(lang, "cta"))}</a></p>'
    )
    _send_notification_email(
        to=user.email,
        subject=copy(lang, "subject", count=len(items)),
        body=_email_layout(
            title=heading,
            body_content=f"<h1>{html.escape(heading)}</h1>{body}",
            footer_note=copy(lang, "footer"),
            logo_html=_brand_logo_html(branding.logo_url, branding.org_name or "LearnHouse"),
            powered_by=branding.powered_by,
            lang=lang,
        ),
        sender_name=branding.sender_name or None,
    )
    return True


async def run_digests(db: AsyncSession, now: Optional[datetime] = None) -> int:
    """Send every digest that is due. Returns emails sent. Never raises per user."""
    if digest_disabled():
        return 0
    from src.db.users import User

    now = now or datetime.now(timezone.utc)
    stamp = now.isoformat()
    rows_ = (await db.execute(
        select(NotificationPreference).where(NotificationPreference.email_digest.in_(tuple(PERIOD)))  # type: ignore[attr-defined]
    )).scalars().all()
    # Detached copies: a rollback for one person must not expire the rest.
    prefs = [NotificationPreference(**p.model_dump()) for p in rows_]
    sent = 0
    for pref in prefs:
        if not is_due(pref, now):
            continue
        user_id = pref.user_id
        try:
            user = await db.get(User, pref.user_id)
            rows = (await db.execute(
                select(Notification).where(
                    Notification.user_id == pref.user_id,
                    Notification.read_at.is_(None),  # type: ignore[union-attr]
                    Notification.archived_at.is_(None),  # type: ignore[union-attr]
                    Notification.emailed_at.is_(None),  # type: ignore[union-attr]
                    Notification.priority == "important",
                    or_(Notification.expires_at.is_(None), Notification.expires_at > stamp),  # type: ignore[union-attr,operator]
                ).order_by(Notification.id.desc())  # type: ignore[union-attr]
            )).scalars().all()
            rows = [n for n in rows if wants_channel(pref, n.category, "email")]
            by_org: dict[Optional[int], list[Notification]] = {}
            for n in rows:
                by_org.setdefault(n.org_id, []).append(n)
            if user is not None and user.email:
                for org_id, items in by_org.items():
                    if await send_digest(db, user, org_id, items[:MAX_ITEMS]):
                        sent += 1
            if rows:
                await db.execute(
                    update(Notification).where(Notification.id.in_([n.id for n in rows]))  # type: ignore[union-attr]
                    .values(emailed_at=stamp).execution_options(synchronize_session=False)
                )
            await db.execute(
                update(NotificationPreference).where(NotificationPreference.id == pref.id)  # type: ignore[arg-type]
                .values(last_digest_at=stamp).execution_options(synchronize_session=False)
            )
            await db.commit()
        except Exception:
            await db.rollback()
            logger.warning("Notification digest failed for user %s", user_id, exc_info=True)
    return sent
