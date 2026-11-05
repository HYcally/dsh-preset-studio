/**
 * Studio — the panel's host half, and nothing else.
 *
 * It owns exactly two jobs:
 *   1. read and write files inside the configured preset roots;
 *   2. install/uninstall a preset as a DSH bundle.
 *
 * It knows nothing about how an injection is delivered or how a document is
 * written back: those are separate packages, declared as *consumers* in the
 * entry model (see core.js). The panel only ever writes the row that connects
 * them, using the same table the runtime packages are named in.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TYPES,
  addToolRow,
  assertAllowed,
  createEntry,
  createPresetFromTemplate,
  isInside,
  parsePatchRows,
  presetDirs,
  readPreset,
  readPresetManifest,
  readTemplateInfo,
  resolveRoots,
  samePath,
  toggleEntry,
  toggleToolRow,
  typeCatalog,
  wireType,
  writeAtomic,
} from './core.js'

/** Stable cordis plugin name. */
export const name = '@local/dsh-studio'
/** The web server is the only service these routes need. */
export const inject = ['webServer']

/** Route table mirrored by the client half (document-relative there). */
export const ROUTES = {
  presets: '/api/studio/presets',
  read: '/api/studio/read',
  write: '/api/studio/write',
  create: '/api/studio/entry/create',
  toggle: '/api/studio/entry/toggle',
  toolToggle: '/api/studio/tool/toggle',
  toolAdd: '/api/studio/tool/add',
  wire: '/api/studio/wire',
  presetCreate: '/api/studio/preset/create',
  install: '/api/studio/preset/install',
  uninstall: '/api/studio/preset/uninstall',
}

/**
 * Tools a preset can add from the panel. Required config is written with the
 * row: a package that declares a required key and gets none fails to mount,
 * and that failure surfaces far from here (as "the preset will not load").
 * Tools needing companion plugins (subagent, workflow) are deliberately absent.
 */
const TOOL_CATALOG = [
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', label: '读写文件', hint: 'read · write · edit · ls' },
  {
    id: 'tool-fs-search',
    name: '@deepseek-ai/dsh-tool-fs-search',
    label: '查找文件与内容',
    hint: 'glob · grep',
    config: ['sampleOverCapGlobResults: false'],
  },
  {
    id: 'tool-pwsh',
    name: '@deepseek-ai/dsh-tool-pwsh',
    label: '终端（Windows）',
    hint: 'pwsh',
    platforms: ['win32'],
    guard: "process.platform !== 'win32'",
  },
  {
    id: 'tool-bash',
    name: '@deepseek-ai/dsh-tool-bash',
    label: '终端（Unix）',
    hint: 'bash',
    platforms: ['darwin', 'linux'],
    guard: "process.platform === 'win32'",
  },
  { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs', label: '后台任务', hint: '跑长命令、读输出' },
  { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule', label: '定时提醒', hint: '到点再叫你' },
  {
    id: 'tool-todo',
    name: '@deepseek-ai/dsh-tool-todo',
    label: '待办清单',
    hint: '多步任务的进度',
    config: ['allowParallelInProgress: true'],
  },
  { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user', label: '向你提问', hint: '拿不准时问你' },
  {
    id: 'tool-web',
    name: '@deepseek-ai/dsh-tool-web',
    label: '联网搜索与抓取',
    hint: 'web_search · web_fetch',
    config: ['fetch: true', 'searchTimeoutMs: 60000'],
  },
  { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill', label: '调用技能', hint: '让模型主动用技能' },
  { id: 'tool-present', name: '@deepseek-ai/dsh-tool-present', label: '交付文件', hint: '把结果摆到你面前' },
  { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal', label: '长期目标', hint: '跨轮次推进' },
]

/** The catalog entries this platform can actually run. */
function availableTools() {
  return TOOL_CATALOG.filter((entry) => !entry.platforms || entry.platforms.includes(process.platform))
}

/* ── transport ────────────────────────────────────────────────────────────── */

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function guard(req, res, method) {
  if (!isLoopback(req)) {
    sendJson(res, 403, { error: 'forbidden: loopback-only' })
    return false
  }
  if (req.method !== method) {
    sendJson(res, 405, { error: 'method not allowed: ' + req.method })
    return false
  }
  return true
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('invalid JSON body')
  }
}

/* ── preset installation (the only thing here that touches DSH itself) ────── */

const INSTALL_ERRORS = {
  'already-installed': '这个预设已经装过了',
  'not-bundle': '这个包不是预设包：它的 package.json 里缺 dsh.bundle',
  'ambiguous-install': '装完之后分不清装的是哪个包，没敢继续',
  'incompatible-version': '这个包要求的 DSH 版本对不上',
  'invalid-spec': '安装路径不合法',
  'not-removable': '这个包不能从面板里卸载',
  'stop-profile': '这个包还在运行，得先重启 DSH 才能卸',
  'bundle-in-use': '这个包正在被使用，卸不掉',
}

function humanize(error) {
  const message = String(error?.message ?? error).trim()
  return INSTALL_ERRORS[message] ?? message
}

function describeFailure(result) {
  const failure = result && result.error
  if (!failure) return '未知错误'
  const diagnostic = typeof failure.diagnostic === 'string' ? failure.diagnostic : ''
  if (diagnostic !== '') return diagnostic.split(/\r?\n/)[0]
  return String(failure.code ?? failure)
}

/** The bundles the plugin manager knows about, or [] when that service is absent. */
async function bundleList(ctx) {
  try {
    const manager = ctx.get('pluginManager')
    if (!manager) return []
    const list = await manager.listBundles()
    const entries = Array.isArray(list) ? list : list && Array.isArray(list.entries) ? list.entries : []
    return entries.map((item) => ({
      name: String(item.name ?? ''),
      source: typeof item.source === 'string' ? item.source : '',
      installed: item.installed === true,
      enabled: item.enabled === true,
      removable: item.removable === true,
    }))
  } catch {
    return []
  }
}

async function bundleFor(ctx, presetDir) {
  const wanted = readPresetManifest(presetDir)
  const bundles = await bundleList(ctx)
  return bundles.find((bundle) => {
    if (!bundle.installed) return false
    if (wanted.ok && bundle.name === wanted.name) return true
    const source = bundle.source.replace(/^link:/i, '')
    if (source === '') return false
    return samePath(source, presetDir)
  })
}

/**
 * pnpm leaves a `link:` bundle's junction behind after removal; it only bites
 * when the target disappears. Best effort: never fail the uninstall over it.
 */
function dropStaleLink(profileDir, bundleName, targetDir) {
  if (!profileDir || !bundleName) return false
  const linkPath = path.join(profileDir, 'node_modules', ...bundleName.split('/'))
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return false
  } catch {
    return false
  }
  let resolved = ''
  try {
    resolved = fs.realpathSync(linkPath)
  } catch {
    return false
  }
  if (!samePath(resolved, targetDir)) return false
  try {
    fs.rmdirSync(linkPath)
    return true
  } catch {
    return false
  }
}

/* ── routes ───────────────────────────────────────────────────────────────── */

/** The repository root: this package sits one level below it. */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

export function apply(ctx, config) {
  // The shipped patch carries no absolute paths: the bundle is expected to sit
  // next to `预设/` and `模板/`. A deployment that keeps them elsewhere says so
  // in the row's config, and that wins.
  const settings = { ...config }
  if (typeof settings.template !== 'string' || settings.template.trim() === '') {
    settings.template = path.join(REPO_ROOT, '模板', '基础')
  }
  const roots = resolveRoots(config)
  if (roots.length === 0) roots.push(path.join(REPO_ROOT, '预设'))
  ctx.logger?.info?.('[studio] roots: ' + roots.join(', '))

  const resolvePreset = (input) => {
    if (typeof input !== 'string' || input.trim() === '') throw new Error('preset is required')
    const abs = path.resolve(input)
    if (!roots.some((root) => isInside(root, abs))) throw new Error('这个预设不在面板管辖的目录里')
    if (!fs.existsSync(path.join(abs, 'cordis.patch.yml'))) throw new Error('这个目录不是预设：没有 cordis.patch.yml')
    return abs
  }

  const routes = [
    {
      kind: 'exact',
      path: ROUTES.presets,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const bundles = await bundleList(ctx)
          const presets = []
          for (const preset of presetDirs(roots)) {
            const model = readPreset(preset)
            const wanted = readPresetManifest(preset.dir)
            model.bundle =
              bundles.find((bundle) => {
                if (!bundle.installed) return false
                if (wanted.ok && bundle.name === wanted.name) return true
                const source = String(bundle.source || '').replace(/^link:/i, '')
                return source !== '' && samePath(source, preset.dir)
              }) || null
            presets.push(model)
          }
          sendJson(res, 200, {
            roots,
            template: readTemplateInfo(settings),
            types: typeCatalog(),
            tools: availableTools(),
            presets,
          })
        } catch (error) {
          sendJson(res, 500, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.read,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url, 'http://127.0.0.1')
          const target = assertAllowed(roots, url.searchParams.get('path'))
          const stat = fs.statSync(target)
          sendJson(res, 200, { path: target, content: fs.readFileSync(target, 'utf8'), mtime: stat.mtimeMs, size: stat.size })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.write,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const target = assertAllowed(roots, body?.path)
          const content = typeof body?.content === 'string' ? body.content : ''
          const baseMtime = typeof body?.baseMtime === 'number' ? body.baseMtime : null
          const before = fs.readFileSync(target, 'utf8')
          const stat = fs.statSync(target)
          if (baseMtime !== null && Math.abs(stat.mtimeMs - baseMtime) > 1 && before !== content) {
            sendJson(res, 409, { error: '文件在磁盘上已经变过了', content: before, mtime: stat.mtimeMs })
            return
          }
          writeAtomic(target, content)
          sendJson(res, 200, { path: target, mtime: fs.statSync(target).mtimeMs })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.create,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const presetDir = resolvePreset(body?.preset)
          const preset = { name: path.basename(presetDir), dir: presetDir, package: null }
          const result = createEntry(preset, String(body?.type ?? ''), body?.values ?? {})
          sendJson(res, 200, result)
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.toggle,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const target = assertAllowed(roots, body?.path)
          if (typeof body?.enabled !== 'boolean') throw new Error('enabled must be a boolean')
          if (String(body?.type ?? '') === 'tool') throw new Error('工具开关按行处理')
          const result = toggleEntry(String(body?.type ?? ''), target, body.enabled)
          sendJson(res, 200, { ...result, mtime: fs.statSync(target).mtimeMs })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.toolToggle,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const presetDir = resolvePreset(body?.preset)
          if (typeof body?.enabled !== 'boolean') throw new Error('enabled must be a boolean')
          const preset = { name: path.basename(presetDir), dir: presetDir, package: null }
          sendJson(res, 200, toggleToolRow(preset, String(body?.id ?? ''), body.enabled))
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.toolAdd,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const presetDir = resolvePreset(body?.preset)
          const entry = availableTools().find((item) => item.id === String(body?.id ?? ''))
          if (!entry) throw new Error('面板里没有这个工具：' + String(body?.id ?? ''))
          const preset = { name: path.basename(presetDir), dir: presetDir, package: null }
          const result = addToolRow(preset, entry)
          sendJson(res, 200, { ...result, mtime: fs.statSync(path.join(presetDir, 'cordis.patch.yml')).mtimeMs })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.wire,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const presetDir = resolvePreset(body?.preset)
          const preset = { name: path.basename(presetDir), dir: presetDir, package: null }
          const result = wireType(preset, String(body?.type ?? ''))
          sendJson(res, 200, { ...result, mtime: fs.statSync(path.join(presetDir, 'cordis.patch.yml')).mtimeMs })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.presetCreate,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const root = roots[0]
          if (!root) throw new Error('没有配置预设根目录')
          const result = createPresetFromTemplate(settings, root, { title: body?.title, id: body?.id })
          sendJson(res, 200, result)
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.install,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const presetDir = resolvePreset(body?.preset)
          const manifest = readPresetManifest(presetDir)
          if (!manifest.ok) throw new Error(manifest.reason)
          const manager = ctx.get('pluginManager')
          if (!manager) throw new Error('插件管理器不在，装不了')
          const existing = await bundleFor(ctx, presetDir)
          if (existing) throw new Error('这个预设已经装过了：' + existing.name)
          const result = await manager.installBundle('link:' + presetDir, {})
          if (result && result.application === 'failed') throw new Error(describeFailure(result))
          sendJson(res, 200, {
            bundle: result && result.bundle ? result.bundle : manifest.name,
            changed: !!(result && result.changed),
          })
        } catch (error) {
          sendJson(res, 400, { error: humanize(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.uninstall,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const presetDir = resolvePreset(body?.preset)
          const bundle = await bundleFor(ctx, presetDir)
          if (!bundle) throw new Error('这个预设没有装进 DSH')
          if (!bundle.removable) throw new Error('这个包不能从面板里卸载：' + bundle.name)
          const manager = ctx.get('pluginManager')
          if (!manager) throw new Error('插件管理器不在，卸不了')
          const result = await manager.removeBundle(bundle.name)
          if (result && result.application === 'failed') throw new Error(describeFailure(result))
          const profileDir = ctx.get('profileContext')?.dir ?? ''
          const cleaned = dropStaleLink(profileDir, bundle.name, presetDir)
          sendJson(res, 200, { bundle: bundle.name, changed: !!(result && result.changed), cleaned })
        } catch (error) {
          sendJson(res, 400, { error: humanize(error) })
        }
      },
    },
  ]

  const disposers = routes.map((route) => ctx.webServer.register(route))
  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        /* already gone */
      }
    }
  }, 'studio: routes')
}
