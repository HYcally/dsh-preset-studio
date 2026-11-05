/**
 * Injection delivery — a preset-side part with no UI of its own.
 *
 * A preset that wants its `注入` folder delivered adds one row to its patch:
 *
 *   - id: studio-inject
 *     name: '@local/dsh-studio-inject'
 *     config:
 *       dir: '<preset dir>\注入'
 *
 * Every enabled `<dir>/*.md` becomes one prompt contribution, ordered by the
 * file's `order` field:
 *
 *   role: system     → a prompt section, so it renders inside the system prompt
 *   role: user       → a runtime context block, which reaches the model as a
 *                      sourced user snapshot ("注入内容")
 *   role: assistant  → no native channel exists; delivered as a context block
 *
 * The relative `depth` field is not honoured: neither channel can place text
 * between conversation messages.
 *
 * Two things this deliberately does NOT do in a single mount:
 *
 *   1. The text of a contribution is a function that re-reads its file, so
 *      editing an injection in the panel lands on the next turn. A static
 *      string would freeze the body at mount time — the panel would save the
 *      file and the model would keep reading yesterday's text.
 *   2. The folder is watched, and the whole registration set is rebuilt when
 *      files are added, removed, or change role. Without this a newly created
 *      injection is invisible until the preset is mounted again, which looks
 *      exactly like "this feature does not work".
 *
 * The whole body is defensive. A preset row that throws fails the agent it
 * belongs to, so a bad injection folder must degrade to "nothing injected".
 */
import fs from 'node:fs'
import path from 'node:path'
import { readBoolean, readField, readNumber, splitFrontmatter } from './frontmatter.js'

/** Stable cordis plugin name. */
export const name = '@local/dsh-studio-inject'
/** The prompt registry is the only service this row needs. */
export const inject = ['systemPrompt']

/** User sections land after tool guidance and before the environment facts. */
const SECTION_BASE = 8000
/** User context blocks land after every built-in runtime fact. */
const CONTEXT_BASE = 500
/** Coalesce the burst of events one editor save produces. */
const WATCH_DEBOUNCE_MS = 150

/** The body of one injection file, without its frontmatter. */
function bodyOf(file) {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  const split = splitFrontmatter(text)
  if (!split) return ''
  return split.rest.trim()
}

/** Every injection file in one folder, ordered by its own 序号. */
function readEntries(dir) {
  let children = []
  try {
    children = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const entries = []
  for (const child of children) {
    if (!child.isFile() || !child.name.toLowerCase().endsWith('.md')) continue
    const file = path.join(dir, child.name)
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const split = splitFrontmatter(text)
    if (!split) continue
    if (split.rest.trim() === '') continue
    const rawRole = (readField(split.head, 'role') || 'system').toLowerCase()
    entries.push({
      file,
      name: readField(split.head, 'name') || child.name.slice(0, -3),
      role: rawRole === 'user' || rawRole === 'assistant' ? rawRole : 'system',
      order: readNumber(split.head, 'order') ?? 0,
      enabled: readBoolean(readField(split.head, 'enabled')) !== false,
    })
  }
  entries.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  return entries
}

/** Accept both disposable shapes Cordis hands back (function or `{ dispose }`). */
function runDisposer(handle) {
  if (typeof handle === 'function') handle()
  else if (handle && typeof handle.dispose === 'function') handle.dispose()
}

/** Mount the folder as prompt contributions, and keep them in step with it. */
export function apply(ctx, config) {
  try {
    const declared = typeof config?.dir === 'string' ? config.dir.trim() : ''
    if (declared === '') {
      ctx.logger?.warn?.('[studio-inject] config.dir is missing; nothing injected')
      return
    }
    const dir = path.resolve(declared)
    let handles = []

    const unmount = () => {
      for (const handle of handles) {
        try {
          runDisposer(handle)
        } catch {
          /* a disposer that fails must not block the rebuild */
        }
      }
      handles = []
    }

    const mount = () => {
      unmount()
      let sections = 0
      let contexts = 0
      for (const entry of readEntries(dir)) {
        if (!entry.enabled) continue
        const system = entry.role === 'system'
        const contribution = {
          name: 'custom-inject:' + entry.name,
          order: (system ? SECTION_BASE : CONTEXT_BASE) + entry.order,
          // Re-read on every assembly: editing the file is the normal case, and
          // a frozen body would silently contradict what the panel shows.
          text: () => bodyOf(entry.file),
          interpolate: false,
        }
        try {
          const handle = system ? ctx.systemPrompt.section(contribution) : ctx.systemPrompt.context(contribution)
          handles.push(handle)
          if (system) sections += 1
          else contexts += 1
        } catch (error) {
          ctx.logger?.warn?.('[studio-inject] ' + entry.file + ': ' + String(error?.message ?? error))
        }
      }
      ctx.logger?.info?.(
        '[studio-inject] ' + dir + ': ' + sections + ' section(s) + ' + contexts + ' context(s)',
      )
    }

    mount()

    // Structural changes need a fresh registration; text edits do not.
    let timer = null
    let watcher = null
    let dead = false
    const close = () => {
      dead = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      try {
        watcher?.close()
      } catch {
        /* already closed */
      }
      watcher = null
      unmount()
    }
    try {
      watcher = fs.watch(dir, { persistent: false }, () => {
        if (dead) return
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          if (dead) return
          try {
            mount()
          } catch (error) {
            ctx.logger?.warn?.('[studio-inject] remount failed: ' + String(error?.message ?? error))
          }
        }, WATCH_DEBOUNCE_MS)
      })
      if (typeof watcher.unref === 'function') watcher.unref()
    } catch (error) {
      ctx.logger?.warn?.('[studio-inject] cannot watch ' + dir + ': ' + String(error?.message ?? error))
    }

    if (typeof ctx.effect === 'function') ctx.effect(() => close, 'custom-injector.watch()')
    else if (typeof ctx.on === 'function') ctx.on('dispose', close)
  } catch (error) {
    ctx.logger?.warn?.('[studio-inject] failed: ' + String(error?.message ?? error))
  }
}
