"""
Secure file validation utilities.
Blocks SVG files entirely to prevent XSS attacks (CWE-79).
Validates file types and content to prevent unrestricted uploads (CWE-434).
"""

import os
import re
from typing import Any, List, Optional, Tuple
from fastapi import HTTPException, UploadFile

# Uncompressed-size ceiling applied to every zip-based upload (zip, OOXML,
# SCORM). Shared by the buffer- and stream-based zip validators.
_MAX_UNCOMPRESSED_ZIP = 500 * 1024 * 1024

# Magic-byte validators only ever look at a file header, so validation reads a
# bounded prefix instead of the whole upload.
_MAGIC_PREFIX_BYTES = 64 * 1024


def validate_image_content(content: bytes) -> bool:
    """Validate image content using magic bytes (no deprecated modules)."""
    if len(content) < 12:
        return False
    
    # Check common image format magic bytes
    magic_bytes = content[:12]
    
    # JPEG: FF D8 FF
    if magic_bytes.startswith(b'\xff\xd8\xff'):
        return True
    
    # PNG: 89 50 4E 47 0D 0A 1A 0A
    if magic_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
        return True
    
    # GIF: GIF87a or GIF89a
    if magic_bytes.startswith(b'GIF87a') or magic_bytes.startswith(b'GIF89a'):
        return True
    
    # WebP: RIFF....WEBP
    if magic_bytes.startswith(b'RIFF') and b'WEBP' in content[:16]:
        return True
    
    return False


def validate_video_content(content: bytes) -> bool:
    """Validate video content using magic bytes."""
    if len(content) < 12:
        return False

    magic_bytes = content[:12]

    # MP4: starts with specific ftyp box signatures
    if (magic_bytes[4:8] == b'ftyp' and
        (b'mp4' in magic_bytes[8:12] or b'M4V' in magic_bytes[8:12] or b'isom' in magic_bytes[8:12])):
        return True

    # WebM: EBML header
    if magic_bytes.startswith(b'\x1a\x45\xdf\xa3'):
        return True

    return False


def validate_audio_content(content: bytes) -> bool:
    """Validate audio content using magic bytes."""
    if len(content) < 12:
        return False

    magic_bytes = content[:12]

    # MP3: ID3 tag or MPEG sync word
    if magic_bytes.startswith(b'ID3') or magic_bytes[:2] == b'\xff\xfb' or magic_bytes[:2] == b'\xff\xf3' or magic_bytes[:2] == b'\xff\xf2':
        return True

    # WAV: RIFF....WAVE
    if magic_bytes.startswith(b'RIFF') and content[8:12] == b'WAVE':
        return True

    # OGG: OggS
    if magic_bytes.startswith(b'OggS'):
        return True

    # M4A/AAC: ftyp box
    if magic_bytes[4:8] == b'ftyp' and (b'M4A' in magic_bytes[8:12] or b'mp4' in magic_bytes[8:12] or b'isom' in magic_bytes[8:12] or b'dash' in magic_bytes[8:12]):
        return True

    return False


def validate_zip_content(content: bytes) -> bool:
    """Validate ZIP file using magic bytes and check for zip bombs."""
    if len(content) < 4:
        return False

    if not (content[:4] == b'PK\x03\x04' or content[:4] == b'PK\x05\x06'):
        return False

    import io
    import zipfile

    # 500 MB uncompressed limit — protects against zip bomb attacks.
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            total = sum(info.file_size for info in zf.infolist())
            if total > _MAX_UNCOMPRESSED_ZIP:
                return False
    except Exception:
        return False

    return True


def validate_zip_stream(stream: Any) -> bool:
    """Same checks as :func:`validate_zip_content`, but against a seekable stream.

    ``validate_zip_content`` has to copy its ``bytes`` into an ``io.BytesIO``,
    doubling the memory cost of every zip/OOXML upload. ``zipfile`` only needs a
    seekable file object and ``UploadFile.file`` (a SpooledTemporaryFile) already
    is one, so a multi-hundred-MB archive is never held in RAM twice.
    """
    import zipfile

    try:
        stream.seek(0)
        if stream.read(4) not in (b'PK\x03\x04', b'PK\x05\x06'):
            return False
        stream.seek(0)
        # ZipFile does not close a file object that was passed in to it.
        with zipfile.ZipFile(stream) as zf:
            total = sum(info.file_size for info in zf.infolist())
            if total > _MAX_UNCOMPRESSED_ZIP:
                return False
    except Exception:
        return False
    finally:
        _rewind(stream)

    return True


def _rewind(stream: Any) -> None:
    """Best-effort seek back to the start; upload streams are reused downstream."""
    try:
        stream.seek(0)
    except Exception:
        pass


def _stream_length(stream: Any) -> Optional[int]:
    """Byte length of a seekable stream, measured by seeking — never by reading.

    Returns ``None`` when the stream cannot be measured (non-seekable, or a test
    double), in which case the caller falls back to a bounded read.
    """
    try:
        stream.seek(0, os.SEEK_END)
        length = stream.tell()
        stream.seek(0)
    except Exception:
        return None
    return length if isinstance(length, int) else None


def validate_ole_content(content: bytes) -> bool:
    """Validate a legacy MS Office (OLE2 compound) file via magic bytes.

    Covers the binary .doc/.xls/.ppt formats. These can embed VBA macros, but
    media files are only ever served as downloads (never executed server-side
    or rendered inline), so the residual risk is the same as any file-share —
    the user must explicitly open and enable macros locally.
    """
    return content[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'


# Per-type size caps. Two risks, not one: storage-fill DoS, and memory
# exhaustion — an accepted upload is handed to the caller as a single `bytes`
# object (see upload_content.upload_file), so the cap is also the per-request
# RAM ceiling and a handful of concurrent uploads at the old multi-GB caps
# could OOM the worker for every tenant on the pod.
#
# Caps are sized to the flows that actually reach this validator: media
# library, activity/assignment attachments, org branding, podcasts. The course
# migration dropzone's 5 GB-per-file ceiling does NOT come through here — that
# path streams to a temp file in migration_service with its own limits.
_GB = 1024 * 1024 * 1024
_MB = 1024 * 1024
FILE_TYPES = {
    'image': {
        'extensions': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
        'mime_types': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        'max_size': 15 * _MB,
        'validator': validate_image_content
    },
    'video': {
        'extensions': ['.mp4', '.webm'],
        'mime_types': ['video/mp4', 'video/webm'],
        'max_size': 5 * _GB,
        'validator': validate_video_content
    },
    'document': {
        'extensions': ['.pdf'],
        'mime_types': ['application/pdf'],
        'max_size': 500 * _MB,
        'validator': lambda content: content.startswith(b'%PDF-')
    },
    'audio': {
        'extensions': ['.mp3', '.wav', '.ogg', '.m4a'],
        'mime_types': ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'],
        'max_size': 1 * _GB,
        'validator': validate_audio_content
    },
    'scorm': {
        'extensions': ['.zip'],
        'mime_types': ['application/zip', 'application/x-zip-compressed'],
        'max_size': 5 * _GB,  # bounded further by the zip-bomb guard
        'validator': validate_zip_content,
        'stream_validator': validate_zip_stream
    },
    'database': {
        'extensions': ['.sqlite', '.db', '.sqlite3'],
        'mime_types': ['application/vnd.sqlite3', 'application/x-sqlite3', 'application/octet-stream'],
        'max_size': 50 * _MB,
        'validator': lambda content: content[:16].startswith(b'SQLite format 3\x00')
    },
    'office': {
        # Modern, macro-free OOXML (Word / Excel / PowerPoint). Macro-enabled
        # variants (.docm/.xlsm/.pptm) are intentionally excluded.
        'extensions': ['.docx', '.xlsx', '.pptx'],
        'mime_types': [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
        'max_size': 500 * _MB,
        'validator': validate_zip_content,  # OOXML formats are ZIP-based
        'stream_validator': validate_zip_stream
    },
    'office_legacy': {
        # Binary OLE2 Word / Excel / PowerPoint.
        'extensions': ['.doc', '.xls', '.ppt'],
        'mime_types': [
            'application/msword',
            'application/vnd.ms-excel',
            'application/vnd.ms-powerpoint',
        ],
        'max_size': 100 * _MB,
        'validator': validate_ole_content
    },
    'archive': {
        'extensions': ['.zip'],
        'mime_types': ['application/zip', 'application/x-zip-compressed'],
        'max_size': 2 * _GB,  # bounded further by the zip-bomb guard
        'validator': validate_zip_content,
        'stream_validator': validate_zip_stream
    }
}


EXT_TO_CANONICAL_MIME = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.zip': 'application/zip',
    '.sqlite': 'application/vnd.sqlite3',
    '.db': 'application/vnd.sqlite3',
    '.sqlite3': 'application/vnd.sqlite3',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.doc': 'application/msword',
    '.xls': 'application/vnd.ms-excel',
    '.ppt': 'application/vnd.ms-powerpoint',
}


MIME_TO_SAFE_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/vnd.sqlite3': 'sqlite3',
    'application/x-sqlite3': 'sqlite3',
    'application/octet-stream': 'bin',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.ms-powerpoint': 'ppt',
}


def validate_upload(
    file: UploadFile,
    allowed_types: List[str],
    max_size: Optional[int] = None
) -> Tuple[str, bytes]:
    """
    Validate uploaded file for security and type compliance.
    
    Args:
        file: The uploaded file
        allowed_types: List of allowed file types ('image', 'video', 'document')
        max_size: Maximum file size in bytes (auto-determined if None)
        
    Returns:
        Tuple of (mime_type, file_content)
        
    Raises:
        HTTPException: If validation fails
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Get file extension and block SVG explicitly
    ext = '.' + file.filename.split('.')[-1].lower()
    if ext == '.svg':
        raise HTTPException(status_code=415, detail="SVG files are not allowed for security reasons")

    # Find matching file type configuration
    config = None
    for file_type in allowed_types:
        if file_type in FILE_TYPES and ext in FILE_TYPES[file_type]['extensions']:
            config = FILE_TYPES[file_type]
            break

    if not config:
        allowed_exts = [ext for t in allowed_types for ext in FILE_TYPES.get(t, {}).get('extensions', [])]
        raise HTTPException(status_code=415, detail=f"File type not allowed. Allowed: {allowed_exts}")

    size_limit = max_size or config.get('max_size')

    # SECURITY: decide on size BEFORE any of the body is pulled into memory.
    # The multipart parser has already spooled the part to a temp file, so both
    # the declared part size and a seek to the end are free; reading first (the
    # previous behaviour) let an oversized upload allocate its full size in RAM
    # before the limit was ever consulted.
    buffered: Optional[bytes] = None
    if size_limit:
        declared_size = getattr(file, 'size', None)
        stream_size = _stream_length(file.file)
        for measured in (declared_size, stream_size):
            if isinstance(measured, int) and measured > size_limit:
                _rewind(file.file)
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large (> {size_limit/1024/1024:.1f}MB)"
                )
        if stream_size is None:
            # Stream we cannot measure: fall back to a bounded read of at most
            # size_limit + 1 bytes, still never buffering more than the cap.
            buffered = file.file.read(size_limit + 1)
            if len(buffered) > size_limit:
                _rewind(file.file)
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large (> {size_limit/1024/1024:.1f}MB)"
                )

    # Validate from a bounded sample: magic-byte validators only need a header,
    # and zip-based types are checked straight off the seekable stream rather
    # than through a second full in-memory copy.
    stream_validator = config.get('stream_validator')
    if buffered is not None:
        valid = config['validator'](buffered)
    elif stream_validator is not None:
        valid = stream_validator(file.file)
    else:
        _rewind(file.file)
        valid = config['validator'](file.file.read(_MAGIC_PREFIX_BYTES))
    _rewind(file.file)

    if not valid:
        raise HTTPException(status_code=415, detail="File appears to be corrupted or invalid")

    # Callers still receive the bytes (see services/utils/upload_content.py),
    # so the size cap above doubles as the per-request memory ceiling.
    content = buffered if buffered is not None else file.file.read()
    _rewind(file.file)

    canonical_type = EXT_TO_CANONICAL_MIME.get(ext, file.content_type)
    return canonical_type, content


def get_safe_filename(
    original_filename: str,
    prefix: str = "",
    content_type: Optional[str] = None,
) -> str:
    """Generate a safe filename with a UUID prefix and a safe extension.

    When ``content_type`` is provided (the validated, server-determined MIME
    type from ``validate_upload``), the stored extension is derived from that
    type via ``MIME_TO_SAFE_EXT`` — NOT from the client-supplied filename.
    This prevents a client from controlling the stored file's extension (e.g.
    uploading image bytes under a ".html" name). When no content_type is
    given, fall back to the (sanitized) client extension for backward
    compatibility.
    """
    if content_type is not None:
        safe_ext = MIME_TO_SAFE_EXT.get(content_type)
        if safe_ext:
            return f"{prefix}.{safe_ext}"
        return f"{prefix}.bin"

    if not original_filename:
        return f"{prefix}.bin"

    ext = original_filename.split('.')[-1].lower()
    # Only allow safe alphanumeric extensions
    if re.match(r'^[a-zA-Z0-9]+$', ext):
        return f"{prefix}.{ext}"

    return f"{prefix}.bin"
