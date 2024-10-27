export const ACCEPTED_FILE_FORMATS = {
    video: 'video/*',
    mp4: 'video/mp4',
    webm: 'video/webm',
    image: 'image/*',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
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