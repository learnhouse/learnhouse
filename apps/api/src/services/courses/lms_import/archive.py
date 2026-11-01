"""
Safe extraction of LMS export archives.

Exports arrive as ZIP (Canvas .imscc, Blackboard, Brightspace, Moodle 2.x
"zip" backups) or tar (Moodle .mbz since 2.6, Open edX .tar.gz). Everything in
them is untrusted: entry names are normalized and kept inside the destination,
links and device files are refused, and both the entry count and the total
uncompressed size are capped so a crafted archive cannot fill the disk.
"""

from __future__ import annotations

import os
import shutil
import stat
import tarfile
import zipfile
import zlib
from dataclasses import dataclass

from .report import error_text


class ArchiveError(Exception):
    """The input is not a readable archive or breaks an extraction limit."""


@dataclass
class ExtractLimits:
    max_entries: int = 200_000
    max_total_bytes: int = 20 * 1024 * 1024 * 1024  # 20 GB
    max_entry_bytes: int = 10 * 1024 * 1024 * 1024  # 10 GB
    # Uncompressed / compressed, over the whole archive. XML-heavy backups
    # deflate well, so this is far looser than the native package check.
    max_ratio: int = 200


DEFAULT_LIMITS = ExtractLimits()

_COPY_CHUNK = 8 * 1024 * 1024

# Raised while inflating a damaged or unsupported entry (bad CRC, truncated
# stream, encrypted or Deflate64 member...)
_READ_ERRORS = (zipfile.BadZipFile, tarfile.TarError, zlib.error, EOFError, RuntimeError, NotImplementedError,
                ValueError)
# An entry whose path collides with a file or folder written before it
_PATH_CONFLICTS = (IsADirectoryError, NotADirectoryError, FileExistsError)


def _safe_member_path(dest_real: str, name: str) -> str | None:
    """Destination path for an archive entry, or None when it must be skipped."""
    name = name.replace("\\", "/")
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    if ":" in parts[0]:  # "C:..." drive letters from Windows-made archives
        return None
    target = os.path.realpath(os.path.join(dest_real, *parts))
    if target != dest_real and not target.startswith(dest_real + os.sep):
        return None
    return target


def is_archive(path: str) -> bool:
    if not os.path.isfile(path):
        return False
    if zipfile.is_zipfile(path):
        return True
    try:
        return tarfile.is_tarfile(path)
    except OSError:
        return False


def extract_archive(src: str, dest: str, limits: ExtractLimits = DEFAULT_LIMITS) -> str:
    """Extract ``src`` into ``dest`` (created if needed) and return ``dest``.

    A directory ``src`` is accepted as already extracted and returned as is.
    """
    if os.path.isdir(src):
        return os.path.realpath(src)
    if not os.path.isfile(src):
        raise ArchiveError(f"File not found: {src}")

    os.makedirs(dest, exist_ok=True)
    dest_real = os.path.realpath(dest)

    if zipfile.is_zipfile(src):
        extract = _extract_zip
    else:
        try:
            is_tar = tarfile.is_tarfile(src)
        except OSError:
            is_tar = False
        if not is_tar:
            raise ArchiveError("Unsupported file: expected a .zip, .imscc, .mbz or .tar.gz export")
        extract = _extract_tar
    try:
        extract(src, dest_real, limits)
    except _READ_ERRORS as e:
        raise ArchiveError(f"Corrupted archive: {error_text(e)}") from e
    return dest_real


def _zip_member_name(info: zipfile.ZipInfo) -> str:
    """Entry name, fixing UTF-8 names stored without the UTF-8 flag.

    zipfile decodes such names as cp437 ("kunngj├╕ringer.pdf"), so files the
    export's metadata names in UTF-8 would be "missing".
    """
    name = info.filename
    if not info.flag_bits & 0x800:
        try:
            name = name.encode("cp437").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return name


def _extract_zip(src: str, dest_real: str, limits: ExtractLimits) -> None:
    compressed_size = max(os.path.getsize(src), 1)
    try:
        zf = zipfile.ZipFile(src)
    except zipfile.BadZipFile as e:
        raise ArchiveError(f"Corrupted ZIP archive: {error_text(e)}") from e
    with zf:
        infos = zf.infolist()
        if len(infos) > limits.max_entries:
            raise ArchiveError(f"Archive has too many entries ({len(infos)})")
        total = sum(i.file_size for i in infos)
        if total > limits.max_total_bytes:
            raise ArchiveError("Archive is too large once extracted")
        if total / compressed_size > limits.max_ratio:
            raise ArchiveError("Archive compression ratio is suspicious")

        written = 0
        for info in infos:
            # Unix mode bits live in the high word; refuse symlinks
            mode = (info.external_attr >> 16) & 0xFFFF
            if mode and stat.S_ISLNK(mode):
                continue
            target = _safe_member_path(dest_real, _zip_member_name(info))
            if target is None:
                continue
            if info.is_dir():
                try:
                    os.makedirs(target, exist_ok=True)
                except _PATH_CONFLICTS:
                    pass
                continue
            if info.file_size > limits.max_entry_bytes:
                raise ArchiveError(f"Archive entry is too large: {info.filename}")
            try:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                out = open(target, "wb")
            except _PATH_CONFLICTS:
                continue
            # Count the bytes actually inflated; the header sizes are only a claim
            entry_written = 0
            with zf.open(info) as source, out:
                while True:
                    chunk = source.read(_COPY_CHUNK)
                    if not chunk:
                        break
                    entry_written += len(chunk)
                    written += len(chunk)
                    if entry_written > limits.max_entry_bytes or written > limits.max_total_bytes:
                        raise ArchiveError("Archive is too large once extracted")
                    out.write(chunk)


def _extract_tar(src: str, dest_real: str, limits: ExtractLimits) -> None:
    compressed_size = max(os.path.getsize(src), 1)
    try:
        tf = tarfile.open(src, "r:*")
    except (tarfile.TarError, OSError) as e:
        raise ArchiveError(f"Corrupted tar archive: {error_text(e)}") from e
    with tf:
        count = 0
        written = 0
        for member in tf:
            count += 1
            if count > limits.max_entries:
                raise ArchiveError("Archive has too many entries")
            if not (member.isfile() or member.isdir()):
                continue  # links, devices, fifos
            target = _safe_member_path(dest_real, member.name)
            if target is None:
                continue
            if member.isdir():
                try:
                    os.makedirs(target, exist_ok=True)
                except _PATH_CONFLICTS:
                    pass
                continue
            if member.size > limits.max_entry_bytes:
                raise ArchiveError(f"Archive entry is too large: {member.name}")
            written += member.size
            if written > limits.max_total_bytes:
                raise ArchiveError("Archive is too large once extracted")
            if written / compressed_size > limits.max_ratio and written > 64 * 1024 * 1024:
                raise ArchiveError("Archive compression ratio is suspicious")
            source = tf.extractfile(member)
            if source is None:  # pragma: no cover - regular members always have data
                continue
            try:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                out = open(target, "wb")
            except _PATH_CONFLICTS:
                source.close()
                continue
            with source, out:
                shutil.copyfileobj(source, out, _COPY_CHUNK)


def find_file(root: str, name: str, max_depth: int = 3) -> str | None:
    """First file called ``name`` (case-insensitive) within ``max_depth`` levels."""
    name = name.lower()
    root = os.path.realpath(root)
    base_depth = root.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root):
        depth = dirpath.rstrip(os.sep).count(os.sep) - base_depth
        if depth >= max_depth:
            dirnames[:] = []
        dirnames.sort()
        for f in sorted(filenames):
            if f.lower() == name:
                return os.path.join(dirpath, f)
    return None


def safe_join(root: str, rel: str) -> str | None:
    """Resolve ``rel`` (a path taken from export metadata) inside ``root``."""
    if rel is None:
        return None
    return _safe_member_path(os.path.realpath(root), str(rel))
