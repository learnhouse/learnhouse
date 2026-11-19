"""Dates as people read them in an email: "2 December 2026", never "2026-12-02",
in the email's language ("2 décembre 2026", "2026年12月2日")."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional, Union

# Month names as they appear in a full date (the genitive where the language
# uses one) and the pattern around them. Languages not listed use English.
_MONTHS: dict[str, tuple[str, ...]] = {
    "en": ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"),
    "fr": ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"),
    "de": ("Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"),
    "es": ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"),
    "pt": ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"),
    "it": ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"),
    "nl": ("januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"),
    "pl": ("stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"),
    "tr": ("Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"),
    "id": ("Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"),
    "ru": ("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"),
    "uk": ("січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"),
    "ar": ("يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"),
    "hi": ("जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्तूबर", "नवंबर", "दिसंबर"),
    "th": ("มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"),
    "bn": ("জানুয়ারী", "ফেব্রুয়ারী", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"),
}

# {d} day, {m} month name, {n} month number, {y} year.
_PATTERNS: dict[str, str] = {
    "de": "{d}. {m} {y}",
    "es": "{d} de {m} de {y}",
    "pt": "{d} de {m} de {y}",
    "ru": "{d} {m} {y} г.",
    "uk": "{d} {m} {y} р.",
    "ja": "{y}年{n}月{d}日",
    "zh": "{y}年{n}月{d}日",
    "ko": "{y}년 {n}월 {d}일",
    "vi": "{d} tháng {n}, {y}",
}


def human_date(value: Optional[Union[date, datetime, str]], lang: Optional[str] = "en") -> str:
    """``2 December 2026`` for a date, datetime or ISO string, in ``lang``
    (English when it isn't a known one); "" when empty.

    A string that is not an ISO date is returned unchanged, so a value that
    was already formatted passes through.
    """
    if not value:
        return ""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    code = (lang or "en").split("-")[0].lower()
    months = _MONTHS.get(code, _MONTHS["en"])
    pattern = _PATTERNS.get(code, "{d} {m} {y}")
    return pattern.format(d=value.day, m=months[value.month - 1], n=value.month, y=value.year)
