export const ACCEPTED_FILE_FORMATS = {
    video: 'video/*',
    mp4: 'video/mp4',
    webm: 'video/webm',
    // Removed 'image: image/*' to prevent SVG uploads - use specific formats instead
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zip: 'application/zip,application/x-zip-compressed'
} as const;

/**
 * Constructs the 'accept' attribute value for an input element
 */
export function constructAcceptValue(types : (keyof typeof ACCEPTED_FILE_FORMATS)[]): string {
    return types.map(type => ACCEPTED_FILE_FORMATS[type]).filter(Boolean).join(",")
}