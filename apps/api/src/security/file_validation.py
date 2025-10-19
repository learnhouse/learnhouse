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


# File type configurations
FILE_TYPES = {
    'image': {
        'extensions': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
        'mime_types': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        'max_size': 10 * 1024 * 1024,  # 10MB
        'validator': validate_image_content
    },
    'video': {
        'extensions': ['.mp4', '.webm'],
        'mime_types': ['video/mp4', 'video/webm'],
        'max_size': 100 * 1024 * 1024,  # 100MB
        'validator': validate_video_content
    },
    'document': {
        'extensions': ['.pdf'],
        'mime_types': ['application/pdf'],
        'max_size': 50 * 1024 * 1024,  # 50MB
        'validator': lambda content: content.startswith(b'%PDF-')
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
    
    # Check file size
    size_limit = max_size or config['max_size']
    if len(content) > size_limit:
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
