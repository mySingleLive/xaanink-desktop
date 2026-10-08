import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, relative } from "node:path"

const root = process.cwd()
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => ["generated","retired"].includes(entry.name) ? [] : entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)])
const suites = ["tests/unit", "tests/integration"].flatMap(walk).filter(path => path.endsWith(".test.ts")).map(path => relative(root, path) || path)
const args = ["--import", "tsx", "--test", "--test-reporter=tap", ...suites]
const startedAt = new Date().toISOString()
const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 10_000_000 })
const sanitize = text => text.replaceAll(root, "<repo>").replaceAll(tmpdir(), "<isolated-temp>").replaceAll(homedir(), "<home>")
const output = sanitize((result.stdout ?? "") + (result.stderr ?? ""))
process.stdout.write(output)
if (result.error) process.stderr.write(sanitize(String(result.error)))
const directory = "docs/evidence/implementation-01"
mkdirSync(directory, { recursive: true })
writeFileSync(join(directory, "core-latest.tap"), output)
const files = ["package-lock.json", "prisma/schema.prisma", ...["desktop", "src", "tests"].flatMap(walk)].filter(path => /\.(?:tsx?|json|prisma)$/.test(path))
const sources = Object.fromEntries(files.sort().map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]))
const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()
writeFileSync(join(directory, "core-latest.json"), JSON.stringify({
  scope: "Local core/unit/integration only; not a packaged App or completion of any full multi-platform acceptance case",
  startedAt, completedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.version,
  sourceCommit: commit, worktreeSources: sources, command: "node " + args.join(" "), packageHash: null,
  exitCode: result.status, status: result.status === 0 ? "passed" : "failed",
}, null, 2) + "\n")
process.exitCode = result.status ?? 1
