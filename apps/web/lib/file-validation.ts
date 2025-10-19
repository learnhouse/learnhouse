/**
 * Frontend file validation utilities
 * Provides consistent validation across all upload components
 */

// File type configurations (matches backend)
export const FILE_TYPES = {
  image: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 10 * 1024 * 1024, // 10MB
  },
  video: {
    extensions: ['.mp4', '.webm'],
    mimeTypes: ['video/mp4', 'video/webm'],
    maxSize: 100 * 1024 * 1024, // 100MB
  },
  document: {
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    maxSize: 50 * 1024 * 1024, // 50MB
  },
} as const

export type FileType = keyof typeof FILE_TYPES

/**
 * Validate a file against allowed types and size limits
 */
export function validateFile(
  file: File,
  allowedTypes: FileType[],
  customMaxSize?: number
): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file selected' }
  }

  // Block SVG files explicitly for security
  if (file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml') {
    return { valid: false, error: 'SVG files are not allowed for security reasons' }
  }

  // Find matching file type
  let matchedType: FileType | null = null
  for (const type of allowedTypes) {
    const config = FILE_TYPES[type]
    if ((config.mimeTypes as readonly string[]).includes(file.type)) {
      matchedType = type
      break
    }
  }

  if (!matchedType) {
    const allowedMimes = allowedTypes.flatMap(type => FILE_TYPES[type].mimeTypes)
    return { 
      valid: false, 
      error: `Invalid file type: ${file.type}. Allowed types: ${allowedMimes.join(', ')}` 
    }
  }

  // Check file size
  const maxSize = customMaxSize || FILE_TYPES[matchedType].maxSize
  if (file.size > maxSize) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1)
    const maxSizeMB = (maxSize / 1024 / 1024).toFixed(1)
    return { 
      valid: false, 
      error: `File too large (${sizeMB}MB). Maximum size: ${maxSizeMB}MB` 
    }
  }

  return { valid: true }
}

/**
 * Get accept attribute value for file inputs
 */
export function getAcceptValue(allowedTypes: FileType[]): string {
  return allowedTypes
    .flatMap(type => FILE_TYPES[type].mimeTypes)
    .join(',')
}

/**
 * Get human-readable description of allowed file types
 */
export function getFileTypeDescription(allowedTypes: FileType[]): string {
  const extensions = allowedTypes
    .flatMap(type => FILE_TYPES[type].extensions)
    .map(ext => ext.toUpperCase().slice(1))
    .join(', ')
  
  const maxSizes = Array.from(new Set(allowedTypes.map(type => FILE_TYPES[type].maxSize)))
  const maxSizeStr = maxSizes.length === 1 
    ? `${maxSizes[0] / 1024 / 1024}MB`
    : 'varies'

  return `${extensions} (max ${maxSizeStr})`
}
