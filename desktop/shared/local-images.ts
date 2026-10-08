const uuid="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
const workImage=new RegExp(`^/_desktop/assets/(${uuid})/(${uuid}\\.(?:png|jpg|webp|gif))$`)
const sceneImage=new RegExp(`^/api/novels/([A-Za-z0-9_-]{1,200})/scenes/([A-Za-z0-9_-]{1,200})/images/(${uuid})/asset$`)
export function localImageRequest(input:string):{kind:"work";workspaceId:string;filename:string}|{kind:"scene";path:string}|null{
 if(input.length>1000||/[?#%\\]/.test(input))return null
 const work=workImage.exec(input);if(work)return{kind:"work",workspaceId:work[1],filename:work[2]}
 return sceneImage.test(input)?{kind:"scene",path:input}:null
}
