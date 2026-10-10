import type {StateSnapshot,ModelRequiredNotice} from '@desktop/shared/ipc'
import type {OnboardingStep} from '@desktop/shared/onboarding'
export type OnboardingRoute={flow:'full'|'models';step:OnboardingStep|'entry'}
export function onboardingStartup(state:StateSnapshot):OnboardingRoute|null{
 const progress=state.onboarding
 if(!progress?.completed)return{flow:'full',step:progress?.step??'theme'}
 return state.models.some(model=>model.kind==='TEXT')?null:{flow:'models',step:'entry'}
}
export function modelOnboardingNeeded(state:StateSnapshot,notice:ModelRequiredNotice):boolean{
 return notice.code==='MODEL_NOT_CONFIGURED'&&notice.role!=='image'&&!state.models.some(model=>model.kind==='TEXT')
}
export function onboardingCanShow(state:{ready:boolean;closing:boolean;migration:boolean;lease:boolean;recovery:boolean}):boolean{
 return state.ready&&!state.closing&&!state.migration&&!state.lease&&!state.recovery
}
