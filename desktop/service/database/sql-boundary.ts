/** Inspect top-level SQL only. Dollar-quoted function/DO bodies, literals and
 * nested comments must not be mistaken for transaction commands. */
export function migrationStatements(sql: string): string[] {
  const firstWords: string[] = []
  const statements: Array<{ words: string[]; sql: string; hasToken: boolean }> = []
  let statementStart = 0
  let hasToken = false
  let i = 0
  while (i < sql.length) {
    if (/\s/.test(sql[i])) { i++; continue }
    if (sql.startsWith("--", i)) { const end = sql.indexOf("\n", i + 2); i = end < 0 ? sql.length : end + 1; continue }
    if (sql.startsWith("/*", i)) {
      let depth = 1; i += 2
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2 }
        else if (sql.startsWith("*/", i)) { depth--; i += 2 }
        else i++
      }
      if (depth) throw new Error("Unterminated SQL comment")
      continue
    }
    if (sql[i] === ";") {
      statements.push({ words: firstWords.splice(0), sql: sql.slice(statementStart, i), hasToken })
      i++; statementStart = i; hasToken = false; continue
    }
    hasToken = true
    if (sql[i] === "'" || sql[i] === '"') {
      const escaped = sql[i] === "'" && /[eE]/.test(sql[i - 1] ?? "") && (i < 2 || !/[a-zA-Z_0-9$]/.test(sql[i - 2]))
      const quote = sql[i++]; const literalStart = i; let closed = false
      while (i < sql.length) {
        if (sql[i] === quote) {
          i++
          if (sql[i] === quote) { i++; continue }
          closed = true; break
        }
        if (escaped && sql[i] === "\\" && sql[i + 1]) i += 2
        else i++
      }
      if (!closed) throw new Error("Unterminated SQL literal")
      if (quote === '"' && firstWords.length < 3) firstWords.push(sql.slice(literalStart, i - 1).replaceAll('""', '"').toUpperCase())
      continue
    }
    if (sql[i] === "$") {
      const tag = /^(\$[a-zA-Z_\u0080-\uffff][a-zA-Z_0-9\u0080-\uffff]*\$|\$\$)/.exec(sql.slice(i))?.[0]
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length)
        if (end < 0) throw new Error("Unterminated SQL function body")
        i = end + tag.length; continue
      }
    }
    // PostgreSQL permits $ inside an unquoted identifier. Consume the whole
    // identifier, so table$tag$ cannot hide a later COMMIT as a dollar body.
    const word = /^[a-zA-Z_\u0080-\uffff][a-zA-Z_0-9$\u0080-\uffff]*/.exec(sql.slice(i))?.[0]
    if (word) { if (firstWords.length < 3) firstWords.push(word.toUpperCase()); i += word.length }
    else i++
  }
  statements.push({ words: firstWords, sql: sql.slice(statementStart), hasToken })
  for (const { words } of statements) {
    const [first, second] = words
    if (["BEGIN", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE"].includes(first) ||
      (["START", "PREPARE"].includes(first) && second === "TRANSACTION")) throw new Error("Top-level transaction control is not allowed in a migration")
    if (first === "SET" && words.some(word => ["STANDARD_CONFORMING_STRINGS", "BACKSLASH_QUOTE"].includes(word))) throw new Error("Migration cannot change SQL literal parsing")
  }
  return statements.filter(statement => statement.hasToken).map(statement => statement.sql)
}
export function assertMigrationTransactionBoundary(sql: string): void { migrationStatements(sql) }
