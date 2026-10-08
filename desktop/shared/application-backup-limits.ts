/** Shared by file validation and the renderer-safe public backup summary. */
export const APPLICATION_BACKUP_LIMITS={bytes:1024*1024*1024,fileBytes:512*1024*1024,files:20000,directories:5000,metadataBytes:16*1024*1024,packages:1000} as const
