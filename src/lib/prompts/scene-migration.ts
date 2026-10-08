import { contentHash } from "@/lib/services/content-commit"
import { getSeedTemplate } from "../../../prisma/seed-templates"
export const SCENARIO_ORGANIZE_PREVIOUS_HASH = "ca285eaf03749e1419e5d5d6573624defc5639ff2ebe730543cd61ee4f465f3b"
export function sceneOrganizeMigration(content: string) {return contentHash(content) === SCENARIO_ORGANIZE_PREVIOUS_HASH ? getSeedTemplate("scenario.organize")!.content : null}
