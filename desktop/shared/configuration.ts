import type {ConfigurationImportChoices,ConfigurationImportPlan} from "../core/configuration-transfer"
export interface ConfigurationPreview {token:string;plan:ConfigurationImportPlan}
export type ConfigurationFileAction=
 |{type:"preview"|"export"|"cancel";sessionId:string}
 |{type:"apply";sessionId:string;token:string;choices:ConfigurationImportChoices}
