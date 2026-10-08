import type { WizardTemplate } from "../taxonomy"
import { THEME_A_TEMPLATES } from "./theme-a"
import { THEME_B_TEMPLATES } from "./theme-b"
import { WORLD_A_TEMPLATES } from "./world-a"
import { WORLD_B_TEMPLATES } from "./world-b"
import { CHAR_A_TEMPLATES } from "./char-a"
import { CHAR_B_TEMPLATES } from "./char-b"
import { PLOT_A_TEMPLATES } from "./plot-a"
import { PLOT_B_TEMPLATES } from "./plot-b"

export const WIZARD_TEMPLATES: readonly WizardTemplate[] = [
  ...THEME_A_TEMPLATES,
  ...THEME_B_TEMPLATES,
  ...WORLD_A_TEMPLATES,
  ...WORLD_B_TEMPLATES,
  ...CHAR_A_TEMPLATES,
  ...CHAR_B_TEMPLATES,
  ...PLOT_A_TEMPLATES,
  ...PLOT_B_TEMPLATES,
]
