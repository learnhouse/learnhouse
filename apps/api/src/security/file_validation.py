"""
Secure file validation utilities.
Blocks SVG files entirely to prevent XSS attacks (CWE-79).
Validates file types and content to prevent unrestricted uploads (CWE-434).
"""

import re
from typing import List, Optional, Tuple
from fastapi import HTTPException, UploadFile


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
    max_uncompressed = 500 * 1024 * 1024
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            total = sum(info.file_size for info in zf.infolist())
            if total > max_uncompressed:
                return False
    except Exception:
        return False

    return True


# Per-type size caps. Storage-fill DoS is the main risk; caps here are the
# last line of defence in addition to any edge/nginx client_max_body_size.
# Limits match or exceed the frontend's own client-side caps (including the
# course migration dropzone's 5 GB-per-file ceiling) so no legitimate upload
# flow hits a 413 it didn't already hit client-side.
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
        'validator': validate_zip_content
    },
    'database': {
        'extensions': ['.sqlite', '.db', '.sqlite3'],
        'mime_types': ['application/vnd.sqlite3', 'application/x-sqlite3', 'application/octet-stream'],
        'max_size': 50 * _MB,
        'validator': lambda content: content[:16].startswith(b'SQLite format 3\x00')
    },
    'office': {
        'extensions': ['.docx', '.pptx'],
        'mime_types': [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
        'max_size': 500 * _MB,
        'validator': validate_zip_content  # OOXML formats are ZIP-based
    }
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
    
    # Read file content once
    content = file.file.read()
    file.file.seek(0)
    
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
    
    # Check file size (skip if no limit set)
    size_limit = max_size or config.get('max_size')
    if size_limit and len(content) > size_limit:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content)/1024/1024:.1f}MB > {size_limit/1024/1024:.1f}MB)"
        )
    
    # Validate file content
    if not config['validator'](content):
        raise HTTPException(status_code=415, detail="File appears to be corrupted or invalid")
    
    return file.content_type, content


def get_safe_filename(original_filename: str, prefix: str = "") -> str:
    """Generate a safe filename with UUID and validated extension."""
    if not original_filename:
        return f"{prefix}.bin"
    
    ext = original_filename.split('.')[-1].lower()
    # Only allow safe alphanumeric extensions
    if re.match(r'^[a-zA-Z0-9]+$', ext):
        return f"{prefix}.{ext}"
    
    return f"{prefix}.bin"
