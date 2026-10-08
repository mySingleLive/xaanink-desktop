const imageUpload=/^\/api\/novels\/[A-Za-z0-9_-]{1,200}\/(?:cover|(?:characters|items|scenes)\/[A-Za-z0-9_-]{1,200})\/images$/
export const MAX_LOCAL_BODY_BYTES=10*1024*1024+128*1024
/** Original image controls accept 10MiB files; multipart headers need a small bounded allowance. */
export function localBodyLimit(method:string,path:string,contentType:string|null|undefined){
 return method==="POST"&&imageUpload.test(path)&&/^multipart\/form-data\s*;/i.test(contentType??"")?MAX_LOCAL_BODY_BYTES:8*1024*1024
}
