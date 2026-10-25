"""Build synthetic Moodle backups (2.x+ ``.mbz`` layout and 1.9 ``moodle.xml``) for tests.

The layout and element names follow what Moodle's backup steps write
(``backup/moodle2/backup_stepslib.php`` and each module's
``backup_<mod>_stepslib.php``), trimmed to the fields the reader uses.
"""

from __future__ import annotations

import hashlib
import io
import os
from typing import Optional
from xml.sax.saxutils import escape


def esc(text) -> str:
    return escape(str(text))


def png_bytes(width: int = 4, height: int = 3, color=(200, 30, 30)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, "PNG")
    return buf.getvalue()


PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
MP4_BYTES = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 32


class Mbz:
    """Moodle 2.x - 5.x backup directory."""

    def __init__(self, root: str, course_ctx: str = "23"):
        self.root = str(root)
        self.course_ctx = course_ctx
        self.files: list[str] = []
        self.activities: list[str] = []
        self.sections: list[str] = []
        self.settings: list[str] = []
        os.makedirs(self.root, exist_ok=True)

    # files.xml -------------------------------------------------------------

    def add_file(self, data: bytes, ctx: str, component: str, filearea: str, itemid, filename: str,
                 filepath: str = "/", sortorder: int = 0, mimetype: str = "") -> str:
        digest = hashlib.sha1(data).hexdigest()
        folder = os.path.join(self.root, "files", digest[:2])
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, digest), "wb") as f:
            f.write(data)
        fid = len(self.files) + 1
        self.files.append(
            f'<file id="{fid}"><contenthash>{digest}</contenthash><contextid>{ctx}</contextid>'
            f"<component>{component}</component><filearea>{filearea}</filearea><itemid>{itemid}</itemid>"
            f"<filepath>{esc(filepath)}</filepath><filename>{esc(filename)}</filename><userid>2</userid>"
            f"<filesize>{len(data)}</filesize><mimetype>{mimetype}</mimetype><status>0</status>"
            f"<timecreated>1700000000</timecreated><timemodified>1700000000</timemodified>"
            f"<source>{esc(filename)}</source><author>Teacher</author><license>allrightsreserved</license>"
            f"<sortorder>{sortorder}</sortorder><repositorytype>$@NULL@$</repositorytype>"
            f"<repositoryid>$@NULL@$</repositoryid><reference>$@NULL@$</reference></file>"
        )
        # Moodle also lists the directory entry of every area
        self.files.append(
            f'<file id="{fid}000"><contenthash>da39a3ee5e6b4b0d3255bfef95601890afd80709</contenthash>'
            f"<contextid>{ctx}</contextid><component>{component}</component><filearea>{filearea}</filearea>"
            f"<itemid>{itemid}</itemid><filepath>/</filepath><filename>.</filename><sortorder>0</sortorder></file>"
        )
        return digest

    # structure -------------------------------------------------------------

    def section(self, sid, number, name: str = "$@NULL@$", summary: str = "", sequence=(), visible: int = 1,
                component: str = "$@NULL@$", itemid: str = "$@NULL@$") -> None:
        directory = f"sections/section_{sid}"
        os.makedirs(os.path.join(self.root, directory), exist_ok=True)
        xml = (
            f'<?xml version="1.0" encoding="UTF-8"?>\n<section id="{sid}"><number>{number}</number>'
            f"<name>{esc(name)}</name><summary>{esc(summary)}</summary><summaryformat>1</summaryformat>"
            f"<sequence>{','.join(str(s) for s in sequence)}</sequence><visible>{visible}</visible>"
            f"<availabilityjson>$@NULL@$</availabilityjson><component>{component}</component>"
            f"<itemid>{itemid}</itemid><timemodified>1700000000</timemodified></section>"
        )
        with open(os.path.join(self.root, directory, "section.xml"), "w", encoding="utf-8") as f:
            f.write(xml)
        self.sections.append(f"<section><sectionid>{sid}</sectionid><title>{number}</title>"
                             f"<directory>{directory}</directory></section>")

    def activity(self, modname: str, moduleid, sectionid, inner: str, ctx: str, instance=None, *,
                 visible: int = 1, visibleoncoursepage: Optional[int] = 1, showdescription: int = 0,
                 grades: Optional[str] = None, title: Optional[str] = None, write_module: bool = True,
                 write_dir: bool = True) -> None:
        instance = instance or moduleid
        directory = f"activities/{modname}_{moduleid}"
        self.activities.append(
            f"<activity><moduleid>{moduleid}</moduleid><sectionid>{sectionid}</sectionid>"
            f"<modulename>{modname}</modulename><title>{esc(title or modname)}</title>"
            f"<directory>{directory}</directory></activity>"
        )
        if not write_dir:
            return
        path = os.path.join(self.root, directory)
        os.makedirs(path, exist_ok=True)
        if write_module:
            with open(os.path.join(path, "module.xml"), "w", encoding="utf-8") as f:
                f.write(
                    f'<?xml version="1.0" encoding="UTF-8"?>\n<module id="{moduleid}" version="2022112800">'
                    f"<modulename>{modname}</modulename><sectionid>{sectionid}</sectionid>"
                    f"<sectionnumber>1</sectionnumber><idnumber></idnumber><added>1700000000</added>"
                    f"<score>0</score><indent>0</indent><visible>{visible}</visible>"
                    + (f"<visibleoncoursepage>{visibleoncoursepage}</visibleoncoursepage>"
                       if visibleoncoursepage is not None else "")
                    + "<visibleold>1</visibleold>"
                    f"<groupmode>0</groupmode><groupingid>0</groupingid><completion>0</completion>"
                    f"<availability>$@NULL@$</availability><showdescription>{showdescription}</showdescription>"
                    f"<downloadcontent>1</downloadcontent><lang></lang><tags></tags></module>"
                )
        with open(os.path.join(path, f"{modname}.xml"), "w", encoding="utf-8") as f:
            f.write(
                f'<?xml version="1.0" encoding="UTF-8"?>\n<activity id="{instance}" moduleid="{moduleid}" '
                f'modulename="{modname}" contextid="{ctx}"><{modname} id="{instance}">{inner}</{modname}>'
                f"</activity>"
            )
        if grades is not None:
            with open(os.path.join(path, "grades.xml"), "w", encoding="utf-8") as f:
                f.write(f"<activity_gradebook><grade_items>{grades}</grade_items><grade_letters/>"
                        f"</activity_gradebook>")

    def exclude(self, name: str) -> None:
        self.settings.append(f"<setting><level>activity</level><activity>{name}</activity>"
                             f"<name>{name}_included</name><value>0</value></setting>")

    def write(self, course_xml: Optional[str], questions_xml: str = "", fullname: str = "Backup name",
              site_hash: str = "0123456789abcdef0123", backup_type: str = "course") -> str:
        if course_xml is not None:
            os.makedirs(os.path.join(self.root, "course"), exist_ok=True)
            with open(os.path.join(self.root, "course", "course.xml"), "w", encoding="utf-8") as f:
                f.write('<?xml version="1.0" encoding="UTF-8"?>\n' + course_xml)
        with open(os.path.join(self.root, "files.xml"), "w", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n<files>' + "".join(self.files) + "</files>")
        with open(os.path.join(self.root, "questions.xml"), "w", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n<question_categories>' + questions_xml
                    + "</question_categories>")
        with open(os.path.join(self.root, "moodle_backup.xml"), "w", encoding="utf-8") as f:
            f.write(
                '<?xml version="1.0" encoding="UTF-8"?>\n<moodle_backup><information>'
                "<name>backup-moodle2-course-2-test.mbz</name><moodle_version>2022112800</moodle_version>"
                "<moodle_release>4.1 (Build: 20221128)</moodle_release><backup_version>2022112800</backup_version>"
                f"<original_course_id>2</original_course_id><original_course_format>topics</original_course_format>"
                f"<original_course_fullname>{esc(fullname)}</original_course_fullname>"
                f"<original_course_shortname>BK</original_course_shortname>"
                f"<original_course_contextid>{self.course_ctx}</original_course_contextid>"
                f"<original_site_identifier_hash>{site_hash}</original_site_identifier_hash>"
                f'<details><detail backup_id="x"><type>{backup_type}</type><format>moodle2</format></detail></details>'
                "<contents><activities>" + "".join(self.activities) + "</activities><sections>"
                + "".join(self.sections) + "</sections><course><courseid>2</courseid><title>BK</title>"
                "<directory>course</directory></course></contents><settings>"
                "<setting><level>root</level><name>users</name><value>0</value></setting>"
                + "".join(self.settings) + "</settings></information></moodle_backup>"
            )
        return self.root


def course_xml(ctx: str = "23", fullname: str = "Intro to Testing", fmt: str = "topics", summary: str = "",
               lang: str = "fr", tags=("Python", "Testing"), startdate: int = 1700000000) -> str:
    tag_xml = "".join(f'<tag id="{i}"><name>{esc(t.lower())}</name><rawname>{esc(t)}</rawname></tag>'
                      for i, t in enumerate(tags, start=1))
    return (
        f'<course id="2" contextid="{ctx}"><shortname>TEST101</shortname><fullname>{esc(fullname)}</fullname>'
        f"<idnumber></idnumber><summary>{esc(summary)}</summary><summaryformat>1</summaryformat>"
        f"<format>{fmt}</format><showgrades>1</showgrades><newsitems>5</newsitems>"
        f"<startdate>{startdate}</startdate><enddate>0</enddate><visible>1</visible><lang>{lang}</lang>"
        f'<category id="1"><name>Misc</name><description>$@NULL@$</description></category>'
        f"<tags>{tag_xml}</tags></course>"
    )


def question(qid, qtype: str, text: str, plugin: str = "", name: str = "", defaultmark: str = "1.0000000",
             parent: str = "0", feedback: str = "", textformat: str = "1") -> str:
    plug = f"<plugin_qtype_{qtype}_question>{plugin}</plugin_qtype_{qtype}_question>" if plugin else ""
    return (
        f'<question id="{qid}"><parent>{parent}</parent><name>{esc(name or f"Q{qid}")}</name>'
        f"<questiontext>{esc(text)}</questiontext><questiontextformat>{textformat}</questiontextformat>"
        f"<generalfeedback>{esc(feedback)}</generalfeedback><generalfeedbackformat>1</generalfeedbackformat>"
        f"<defaultmark>{defaultmark}</defaultmark><penalty>0.3333333</penalty><qtype>{qtype}</qtype>"
        f"<length>1</length><stamp>s{qid}</stamp><timecreated>0</timecreated><timemodified>0</timemodified>"
        f"{plug}<question_hints></question_hints><tags></tags></question>"
    )


def answers(*items) -> str:
    """``(id, text, fraction[, feedback])`` tuples."""
    out = []
    for item in items:
        aid, text, fraction = item[:3]
        fb = item[3] if len(item) > 3 else ""
        out.append(f'<answer id="{aid}"><answertext>{esc(text)}</answertext><answerformat>1</answerformat>'
                   f"<fraction>{fraction}</fraction><feedback>{esc(fb)}</feedback>"
                   f"<feedbackformat>1</feedbackformat></answer>")
    return "<answers>" + "".join(out) + "</answers>"


def entry(eid, cat, *versions) -> str:
    """Moodle 4.x question bank entry; ``versions`` are ``(version, status, question_xml)``."""
    vxml = "".join(f'<question_versions id="{eid}{v}"><version>{v}</version><status>{st}</status>'
                   f"<questions>{qxml}</questions></question_versions>" for v, st, qxml in versions)
    return (f'<question_bank_entry id="{eid}"><questioncategoryid>{cat}</questioncategoryid>'
            f"<idnumber>$@NULL@$</idnumber><ownerid>2</ownerid><question_version>{vxml}</question_version>"
            f"</question_bank_entry>")


def category4(cid, name: str, ctx: str, entries_xml: str, parent: str = "0") -> str:
    return (f'<question_category id="{cid}"><name>{esc(name)}</name><contextid>{ctx}</contextid>'
            f"<contextlevel>50</contextlevel><contextinstanceid>2</contextinstanceid><info></info>"
            f"<infoformat>0</infoformat><stamp>c{cid}</stamp><parent>{parent}</parent><sortorder>999</sortorder>"
            f"<idnumber>$@NULL@$</idnumber><question_bank_entries>{entries_xml}</question_bank_entries>"
            f"</question_category>")


def category3(cid, name: str, ctx: str, questions_xml: str, parent: str = "0") -> str:
    return (f'<question_category id="{cid}"><name>{esc(name)}</name><contextid>{ctx}</contextid>'
            f"<contextlevel>50</contextlevel><contextinstanceid>2</contextinstanceid><info></info>"
            f"<infoformat>0</infoformat><stamp>c{cid}</stamp><parent>{parent}</parent><sortorder>999</sortorder>"
            f"<questions>{questions_xml}</questions></question_category>")
