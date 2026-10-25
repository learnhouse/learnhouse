"""archive: safe extraction of untrusted ZIP / tar exports."""

from __future__ import annotations

import io
import os
import stat
import tarfile
import zipfile

import pytest

from src.services.courses.lms_import import archive
from src.services.courses.lms_import.archive import (
    ArchiveError,
    ExtractLimits,
    extract_archive,
    find_file,
    is_archive,
    safe_join,
)


def make_zip(path, entries, compression=zipfile.ZIP_DEFLATED):
    """entries: list of (name, bytes | None for a directory, optional external_attr)."""
    with zipfile.ZipFile(path, "w", compression) as zf:
        for entry in entries:
            name, data = entry[0], entry[1]
            info = zipfile.ZipInfo(name)
            info.compress_type = compression
            if len(entry) > 2:
                info.external_attr = entry[2]
            if data is None:
                info.external_attr |= 0x10
                zf.writestr(info, b"")
            else:
                zf.writestr(info, data)
    return str(path)


def make_tar(path, members, mode="w:gz"):
    """members: list of (TarInfo kwargs dict, bytes | None)."""
    with tarfile.open(path, mode) as tf:
        for spec, data in members:
            info = tarfile.TarInfo(spec["name"])
            for k, v in spec.items():
                if k != "name":
                    setattr(info, k, v)
            if data is not None:
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))
            else:
                tf.addfile(info)
    return str(path)


def listing(root):
    out = []
    for dirpath, dirs, files in os.walk(root):
        for f in files:
            out.append(os.path.relpath(os.path.join(dirpath, f), root).replace(os.sep, "/"))
    return sorted(out)


# ---------------------------------------------------------------------------
# ZIP
# ---------------------------------------------------------------------------


def test_zip_extracts_files_and_directories(tmp_path):
    src = make_zip(tmp_path / "a.zip", [("dir/", None), ("dir/a.txt", b"A"), ("b/c/d.txt", b"D"),
                                         ("./e.txt", b"E"), ("win\\path\\f.txt", b"F")])
    dest = extract_archive(src, str(tmp_path / "out"))
    assert dest == os.path.realpath(tmp_path / "out")
    assert listing(dest) == ["b/c/d.txt", "dir/a.txt", "e.txt", "win/path/f.txt"]
    assert open(os.path.join(dest, "dir", "a.txt"), "rb").read() == b"A"


def test_zip_path_traversal_and_absolute_paths(tmp_path):
    src = make_zip(tmp_path / "evil.zip", [
        ("../escape.txt", b"x"), ("a/../../escape2.txt", b"x"), ("/etc/abs.txt", b"abs"),
        ("C:/windows/drive.txt", b"x"), ("C:drive2.txt", b"x"), ("ok.txt", b"ok"), ("", b"x"), ("./", None),
    ])
    dest = extract_archive(src, str(tmp_path / "out"))
    # absolute names are made relative to the destination, never written outside it
    assert listing(dest) == ["etc/abs.txt", "ok.txt"]
    assert not (tmp_path / "escape.txt").exists() and not (tmp_path / "escape2.txt").exists()


def test_zip_symlink_entries_are_skipped(tmp_path):
    link_attr = (stat.S_IFLNK | 0o777) << 16
    src = make_zip(tmp_path / "l.zip", [("link", b"/etc/passwd", link_attr), ("real.txt", b"r", 0o644 << 16)])
    dest = extract_archive(src, str(tmp_path / "out"))
    assert listing(dest) == ["real.txt"]
    assert not os.path.islink(os.path.join(dest, "link"))


def test_zip_entry_count_limit(tmp_path):
    src = make_zip(tmp_path / "n.zip", [(f"{i}.txt", b"x") for i in range(3)])
    with pytest.raises(ArchiveError, match="too many entries"):
        extract_archive(src, str(tmp_path / "out"), ExtractLimits(max_entries=2))


def test_zip_total_size_limit(tmp_path):
    src = make_zip(tmp_path / "s.zip", [("a", b"x" * 100), ("b", b"x" * 100)], zipfile.ZIP_STORED)
    with pytest.raises(ArchiveError, match="too large"):
        extract_archive(src, str(tmp_path / "out"), ExtractLimits(max_total_bytes=150))


def test_zip_entry_size_limit(tmp_path):
    src = make_zip(tmp_path / "e.zip", [("a", b"x" * 100)], zipfile.ZIP_STORED)
    with pytest.raises(ArchiveError, match="entry is too large"):
        extract_archive(src, str(tmp_path / "out"), ExtractLimits(max_entry_bytes=50))


def test_zip_ratio_limit(tmp_path):
    src = make_zip(tmp_path / "bomb.zip", [("zeros", b"\0" * 1_000_000)])
    with pytest.raises(ArchiveError, match="ratio"):
        extract_archive(src, str(tmp_path / "out"), ExtractLimits(max_ratio=50))
    # the default limit lets it through
    assert listing(extract_archive(src, str(tmp_path / "ok"), ExtractLimits(max_ratio=10_000))) == ["zeros"]


def test_zip_inflated_bytes_are_counted(tmp_path, monkeypatch):
    """Header sizes are only a claim: the bytes really inflated are capped too."""
    src = make_zip(tmp_path / "lie.zip", [("a", b"x")], zipfile.ZIP_STORED)

    class Liar(io.BytesIO):
        def __enter__(self):
            return self

    monkeypatch.setattr(zipfile.ZipFile, "open", lambda self, info, *a, **k: Liar(b"y" * 1000))
    with pytest.raises(ArchiveError, match="too large"):
        extract_archive(src, str(tmp_path / "out"), ExtractLimits(max_entry_bytes=100, max_total_bytes=10_000))


def test_zip_corrupted_entry_raises_archive_error(tmp_path):
    path = tmp_path / "crc.zip"
    make_zip(path, [("a.txt", b"hello world " * 100)], zipfile.ZIP_STORED)
    data = bytearray(path.read_bytes())
    offset = data.index(b"hello world")
    data[offset:offset + 5] = b"HELLO"  # breaks the CRC, not the structure
    path.write_bytes(bytes(data))
    with pytest.raises(ArchiveError, match="Corrupted archive"):
        extract_archive(str(path), str(tmp_path / "out"))


def test_zip_unsupported_member_raises_archive_error(tmp_path, monkeypatch):
    """Encrypted or Deflate64 members fail on open; that is a bad export, not a crash."""
    src = make_zip(tmp_path / "enc.zip", [("secret.txt", b"x")])

    def refuse(self, info, *a, **k):
        raise NotImplementedError("That compression method is not supported")

    monkeypatch.setattr(zipfile.ZipFile, "open", refuse)
    with pytest.raises(ArchiveError, match="not supported"):
        extract_archive(src, str(tmp_path / "out"))


def test_zip_bad_file_raises(tmp_path, monkeypatch):
    path = make_zip(tmp_path / "x.zip", [("a", b"x")])

    def boom(*_a, **_k):
        raise zipfile.BadZipFile("broken central directory")

    monkeypatch.setattr(archive.zipfile, "ZipFile", boom)
    with pytest.raises(ArchiveError, match="Corrupted ZIP"):
        extract_archive(path, str(tmp_path / "out"))


def test_zip_file_and_folder_with_the_same_name(tmp_path):
    src = make_zip(tmp_path / "c.zip", [("a", b"file"), ("a/b.txt", b"x"), ("a/", None), ("d/", None),
                                         ("d", b"file over dir"), ("ok", b"ok")])
    dest = extract_archive(src, str(tmp_path / "out"))
    assert listing(dest) == ["a", "ok"]
    assert os.path.isdir(os.path.join(dest, "d"))


# ---------------------------------------------------------------------------
# tar
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["w", "w:gz", "w:bz2", "w:xz"])
def test_tar_variants(tmp_path, mode):
    src = make_tar(tmp_path / "a.tar", [({"name": "course", "type": tarfile.DIRTYPE}, None),
                                        ({"name": "course/course.xml"}, b"<course/>")], mode)
    dest = extract_archive(src, str(tmp_path / "out"))
    assert listing(dest) == ["course/course.xml"]


def test_tar_links_devices_and_traversal(tmp_path):
    src = make_tar(tmp_path / "evil.tar.gz", [
        ({"name": "sym", "type": tarfile.SYMTYPE, "linkname": "/etc/passwd"}, None),
        ({"name": "hard", "type": tarfile.LNKTYPE, "linkname": "ok.txt"}, None),
        ({"name": "dev", "type": tarfile.CHRTYPE}, None),
        ({"name": "fifo", "type": tarfile.FIFOTYPE}, None),
        ({"name": "../up.txt"}, b"x"),
        ({"name": "/abs/a.txt"}, b"a"),
        ({"name": "D:/x.txt"}, b"x"),
        ({"name": "ok.txt"}, b"ok"),
    ])
    dest = extract_archive(src, str(tmp_path / "out"))
    assert listing(dest) == ["abs/a.txt", "ok.txt"]
    assert not (tmp_path / "up.txt").exists()


def test_tar_entry_count_limit(tmp_path):
    src = make_tar(tmp_path / "n.tar", [({"name": f"{i}"}, b"x") for i in range(3)], "w")
    with pytest.raises(ArchiveError, match="too many entries"):
        extract_archive(src, str(tmp_path / "out"), ExtractLimits(max_entries=2))


def test_tar_entry_and_total_size_limits(tmp_path):
    src = make_tar(tmp_path / "s.tar", [({"name": "a"}, b"x" * 100), ({"name": "b"}, b"x" * 100)], "w")
    with pytest.raises(ArchiveError, match="entry is too large"):
        extract_archive(src, str(tmp_path / "o1"), ExtractLimits(max_entry_bytes=50))
    with pytest.raises(ArchiveError, match="too large once extracted"):
        extract_archive(src, str(tmp_path / "o2"), ExtractLimits(max_total_bytes=150))


def test_tar_ratio_limit(tmp_path):
    class Zeros(io.RawIOBase):
        def __init__(self, n):
            self.left = n

        def readable(self):
            return True

        def readinto(self, b):
            n = min(len(b), self.left)
            b[:n] = b"\0" * n
            self.left -= n
            return n

    size = 65 * 1024 * 1024
    path = tmp_path / "bomb.tar.gz"
    with tarfile.open(path, "w:gz") as tf:
        info = tarfile.TarInfo("zeros")
        info.size = size
        tf.addfile(info, Zeros(size))
    with pytest.raises(ArchiveError, match="ratio"):
        extract_archive(str(path), str(tmp_path / "out"))
    assert not (tmp_path / "out" / "zeros").exists()


def test_truncated_tar_raises_archive_error(tmp_path):
    path = tmp_path / "t.tar.gz"
    make_tar(path, [({"name": f"f{i}"}, os.urandom(20_000)) for i in range(5)])
    data = path.read_bytes()
    path.write_bytes(data[: len(data) // 2])
    with pytest.raises(ArchiveError):
        extract_archive(str(path), str(tmp_path / "out"))


def test_tar_open_error(tmp_path, monkeypatch):
    path = make_tar(tmp_path / "x.tar", [({"name": "a"}, b"x")], "w")

    def boom(*_a, **_k):
        raise tarfile.ReadError("nope")

    monkeypatch.setattr(archive.tarfile, "is_tarfile", lambda _p: True)
    monkeypatch.setattr(archive.tarfile, "open", boom)
    with pytest.raises(ArchiveError, match="Corrupted tar"):
        extract_archive(path, str(tmp_path / "out"))


def test_tar_file_and_folder_with_the_same_name(tmp_path):
    src = make_tar(tmp_path / "c.tar", [({"name": "a"}, b"file"), ({"name": "a/b.txt"}, b"x"),
                                        ({"name": "a", "type": tarfile.DIRTYPE}, None),
                                        ({"name": "d", "type": tarfile.DIRTYPE}, None),
                                        ({"name": "d"}, b"over dir"), ({"name": "ok"}, b"ok")], "w")
    dest = extract_archive(src, str(tmp_path / "out"))
    assert listing(dest) == ["a", "ok"]


# ---------------------------------------------------------------------------
# Inputs that are not archives
# ---------------------------------------------------------------------------


def test_directory_is_returned_as_is(tmp_path):
    (tmp_path / "src").mkdir()
    assert extract_archive(str(tmp_path / "src"), str(tmp_path / "unused")) == os.path.realpath(tmp_path / "src")
    assert not (tmp_path / "unused").exists()


def test_missing_and_non_archive_files(tmp_path):
    with pytest.raises(ArchiveError, match="not found"):
        extract_archive(str(tmp_path / "nope.zip"), str(tmp_path / "out"))
    txt = tmp_path / "notes.txt"
    txt.write_text("hello")
    with pytest.raises(ArchiveError, match="Unsupported file"):
        extract_archive(str(txt), str(tmp_path / "out"))


def test_is_tarfile_oserror_is_handled(tmp_path, monkeypatch):
    f = tmp_path / "f.bin"
    f.write_bytes(b"\0" * 10)

    def boom(_p):
        raise OSError("unreadable")

    monkeypatch.setattr(archive.tarfile, "is_tarfile", boom)
    assert is_archive(str(f)) is False
    with pytest.raises(ArchiveError, match="Unsupported"):
        extract_archive(str(f), str(tmp_path / "out"))


def test_is_archive(tmp_path):
    z = make_zip(tmp_path / "a.zip", [("a", b"x")])
    t = make_tar(tmp_path / "a.tgz", [({"name": "a"}, b"x")])
    txt = tmp_path / "a.txt"
    txt.write_text("plain")
    assert is_archive(z) and is_archive(t)
    assert not is_archive(str(txt))
    assert not is_archive(str(tmp_path))
    assert not is_archive(str(tmp_path / "missing"))


# ---------------------------------------------------------------------------
# find_file / safe_join
# ---------------------------------------------------------------------------


def test_find_file_depth_and_case(tmp_path):
    (tmp_path / "a" / "b" / "c").mkdir(parents=True)
    (tmp_path / "a" / "b" / "c" / "deep.xml").write_text("x")
    (tmp_path / "a" / "Moodle_Backup.XML").write_text("x")
    (tmp_path / "z").mkdir()
    (tmp_path / "z" / "moodle_backup.xml").write_text("x")
    found = find_file(str(tmp_path), "moodle_backup.xml")
    assert found == os.path.join(os.path.realpath(tmp_path), "a", "Moodle_Backup.XML")  # sorted walk
    assert find_file(str(tmp_path), "deep.xml", max_depth=3) is not None
    assert find_file(str(tmp_path), "deep.xml", max_depth=2) is None
    assert find_file(str(tmp_path), "moodle_backup.xml", max_depth=0) is None
    (tmp_path / "root.xml").write_text("x")
    assert find_file(str(tmp_path), "ROOT.xml", max_depth=0) is not None
    assert find_file(str(tmp_path), "absent.xml") is None


def test_safe_join(tmp_path):
    root = os.path.realpath(tmp_path)
    assert safe_join(str(tmp_path), "a/b.txt") == os.path.join(root, "a", "b.txt")
    assert safe_join(str(tmp_path), "/a/b.txt") == os.path.join(root, "a", "b.txt")
    assert safe_join(str(tmp_path), "a\\b.txt") == os.path.join(root, "a", "b.txt")
    assert safe_join(str(tmp_path), "../x") is None
    assert safe_join(str(tmp_path), "a/../../x") is None
    assert safe_join(str(tmp_path), "C:/x") is None
    assert safe_join(str(tmp_path), "") is None
    assert safe_join(str(tmp_path), ".") is None
    assert safe_join(str(tmp_path), None) is None


def test_safe_join_refuses_symlink_escape(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    root = tmp_path / "root"
    root.mkdir()
    os.symlink(outside, root / "link")
    assert safe_join(str(root), "link/file.txt") is None


def test_zip_member_name_without_utf8_flag_that_cp437_cannot_encode():
    info = zipfile.ZipInfo("café €.txt")  # flag_bits 0; the euro sign has no cp437 code
    assert archive._zip_member_name(info) == "café €.txt"
