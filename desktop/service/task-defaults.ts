import { AsyncLocalStorage } from "node:async_hooks"
import type { TaskDefaults } from "../shared/task-defaults"
import { readLocalTaskDefaults } from "./models"
const context = new AsyncLocalStorage<TaskDefaults>()
export function currentTaskDefaults(): TaskDefaults | undefined { return context.getStore() }
export function runWithTaskDefaults<T>(snapshot: TaskDefaults, run: () => T): T { return context.run(snapshot, run) }
export async function runWithNewTaskDefaults<T>(run: () => T): Promise<Awaited<T>> { return await context.run(await readLocalTaskDefaults(), run) }
export async function taskDefaults(): Promise<TaskDefaults> { return context.getStore() ?? readLocalTaskDefaults() }
