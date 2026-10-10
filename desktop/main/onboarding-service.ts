import type { ModelRepository } from "./model-repository"
import type { AvatarAssetService } from "./avatar-assets"
import { onboardingActionSchema, OnboardingError } from "../shared/onboarding"
export interface OnboardingServiceOptions { repository:Pick<ModelRepository,"commitOnboarding">;avatarAssets:AvatarAssetService }
/** Real session/window admission stays with main's caller; avatar paths never cross IPC. */
export class OnboardingService {
 constructor(private readonly options:OnboardingServiceOptions){}
 async commit(owner:string,input:unknown,assertCurrent:()=>void){
  const guard=()=>{try{assertCurrent()}catch{throw new OnboardingError("OWNER_UNAVAILABLE")}}
  const parsed=onboardingActionSchema.safeParse(input)
  if(!parsed.success)throw new OnboardingError("INVALID_ACTION")
  const action=parsed.data
  try{
   guard()
   const state=await this.options.repository.commitOnboarding(action,guard,action.type==="profile"?async before=>{
    guard()
    const {avatarSessionId,avatarDraftId,user}=action
    if(user.avatarAssetId!==before.settings.user.avatarAssetId)throw new OnboardingError("AVATAR_UNAVAILABLE")
    this.options.avatarAssets.begin(owner,avatarSessionId)
    this.options.avatarAssets.assertActive(owner,avatarSessionId,avatarDraftId)
    const asset=avatarDraftId?await this.options.avatarAssets.persistDraft(owner,avatarSessionId,avatarDraftId):null
    guard();this.options.avatarAssets.assertActive(owner,avatarSessionId,avatarDraftId)
    return asset?.assetId??user.avatarAssetId
   }:undefined)
   guard()
   if(action.type==="profile")this.options.avatarAssets.cancel(owner,action.avatarSessionId,action.avatarDraftId)
   return state
  }catch(error){if(error instanceof OnboardingError)throw error;throw new OnboardingError("AVATAR_UNAVAILABLE")}
 }
}
