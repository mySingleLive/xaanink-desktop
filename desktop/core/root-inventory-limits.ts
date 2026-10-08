/** Root migration includes existing application-package history; package-local
 * 17 limits remain unchanged. Unknown entries consume scan/preserved budgets,
 * never the owned-file or owned-directory counts. */
const files=100000,entries=125000
// Rollback can retain each file at target and stage, plus directories. The
// combined manifest <= entries; recovery is target-only, plus one unknown-
// target marker. Preserve both locations rather than truncate pending paths.
export const ROOT_MIGRATION_LIMITS={files,directories:25000,entries,pending:entries+files+2,journalBytes:64*1024*1024} as const
