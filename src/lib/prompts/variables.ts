/** The same placeholder syntax is used by editing, validation and rendering. */
export function extractPromptVariables(content: string): string[] {
  return [...new Set(Array.from(content.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g), match => match[1]))]
}

export const PROMPT_VARIABLE_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g
