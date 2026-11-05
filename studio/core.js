/**
 * The entry model — one description per kind of thing a preset can contain.
 *
 * Everything the panel shows is an *entry*: a file (or a row) with a type. The
 * type decides where it lives, how it is ordered, which frontmatter fields it
 * carries, and — the part that used to be implicit — **who consumes it**: the
 * preset-side plugin or provider that turns that folder into something the model
 * sees. A type is never fully "live" until every one of its consumers is wired
 * into the preset's patch, so the panel can state what is missing instead of
 * offering a button and hoping.
 *
 * Consumers are declared here and nowhere else. The old plugin hard-coded the
 * injector's package name inside its own route handlers, so the same contract
 * existed twice: once when writing the YAML, once when the plugin read it.
 * Now there is one table, and writing a row is the only place that formats it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readBoolean, readField, readNumber, splitFrontmatter } from './frontmatter.js'

/* ── paths ────────────────────────────────────────────────────────────────── */

/** Files listed inside one preset directory, in this order. */
const PRESET_FILES = ['cordis.patch.yml', 'package.json', '说明.md']

/** Extensions the panel may open. */
const ALLOWED_EXT = new Set(['.yml', '.yaml', '.json', '.md', '.txt'])

/** Skill-name grammar the provider accepts (documents and skills both use it). */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** True when `target` is inside `root` (or is `root` itself). */
export function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Compare two directory spellings the way Windows does. */
export function samePath(left, right) {
  const norm = (value) => String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(left) === norm(right)
}

/** Write one file atomically, so a failed write never truncates a preset file. */
export function writeAtomic(target, content) {
  const tmp = target + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, target)
}

function yamlString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

/** Keep non-ASCII text, drop what a file name cannot hold. */
export function safeFileName(name) {
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? '未命名' : cleaned
}

/* ── patch text helpers (line-based: never re-serialise a user's YAML) ─────── */

/** True when a patch `name:` owns the filesystem skill provider. */
const SKILL_PROVIDER = /dsh-skill-filesystem/

/**
 * Locate the `skill-filesystem` row and the shape of its `customSkillDirs` list.
 * Line-based on purpose: the writer must not reformat what it is not changing.
 */
function locateSkillRow(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const result = {
    eol,
    lines,
    rowIndex: -1,
    rowIndent: 0,
    blockEnd: lines.length,
    configIndex: -1,
    dirsIndex: -1,
    dirsInline: false,
    items: [],
  }
  let current = null
  for (let index = 0; index < lines.length; index += 1) {
    const idMatch = /^(\s*)-\s+id:\s*(.+?)\s*$/.exec(lines[index])
    if (idMatch) {
      current = { index, indent: idMatch[1].length }
      continue
    }
    if (!current) continue
    const nameMatch = /^(\s*)name:\s*(.+?)\s*$/.exec(lines[index])
    if (nameMatch && nameMatch[1].length === current.indent + 2 && SKILL_PROVIDER.test(nameMatch[2])) {
      result.rowIndex = current.index
      result.rowIndent = current.indent
      break
    }
  }
  if (result.rowIndex < 0) return result

  const base = result.rowIndent
  let seenDirs = false
  for (let index = result.rowIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (indent <= base) {
      result.blockEnd = index
      break
    }
    const trimmed = line.trim()
    if (indent === base + 2) {
      if (/^config:\s*$/.test(trimmed)) result.configIndex = index
      else if (seenDirs) break
      continue
    }
    if (indent === base + 4) {
      const dirsMatch = /^customSkillDirs:\s*(.*)$/.exec(trimmed)
      if (dirsMatch) {
        result.dirsIndex = index
        result.dirsInline = dirsMatch[1].trim() !== ''
        seenDirs = true
      } else if (seenDirs) {
        break
      }
      continue
    }
    if (seenDirs && indent === base + 6) {
      const itemMatch = /^-\s*(.+?)\s*$/.exec(trimmed)
      if (itemMatch) {
        result.items.push({ index, value: itemMatch[1].replace(/^['"]|['"]$/g, '') })
      }
    }
  }
  return result
}

/** The directories a preset currently wires. */
function readSkillDirs(text) {
  if (typeof text !== 'string' || text.trim() === '') return { hasRow: false, dirs: [] }
  const found = locateSkillRow(text)
  return { hasRow: found.rowIndex >= 0, dirs: found.items.map((item) => item.value) }
}

/** Add one directory to `customSkillDirs`, changing nothing else. */
function wireSkillDir(text, targetDir) {
  const found = locateSkillRow(text)
  if (found.rowIndex < 0) return { found: false }
  const pad = (size) => ' '.repeat(size)
  if (found.dirsInline) {
    const empty = /^\s*customSkillDirs:\s*\[\s*\]\s*$/.test(found.lines[found.dirsIndex])
    if (!empty) return { found: true, inline: true, text }
    found.lines[found.dirsIndex] = pad(found.rowIndent + 4) + 'customSkillDirs:'
  }
  if (found.items.some((item) => samePath(item.value, targetDir))) {
    return { found: true, changed: false, text }
  }
  const quoted = yamlString(targetDir)
  if (found.dirsIndex >= 0) {
    const at = found.items.length > 0 ? found.items[found.items.length - 1].index + 1 : found.dirsIndex + 1
    found.lines.splice(at, 0, pad(found.rowIndent + 6) + '- ' + quoted)
  } else if (found.configIndex >= 0) {
    found.lines.splice(found.configIndex + 1, 0, pad(found.rowIndent + 4) + 'customSkillDirs:', pad(found.rowIndent + 6) + '- ' + quoted)
  } else {
    found.lines.splice(
      found.blockEnd,
      0,
      pad(found.rowIndent + 2) + 'config:',
      pad(found.rowIndent + 4) + 'customSkillDirs:',
      pad(found.rowIndent + 6) + '- ' + quoted,
    )
  }
  return { found: true, changed: true, text: found.lines.join(found.eol) }
}

/** Locate the preset's `plugins:` list: its line, its indent, and its last line. */
function locatePluginsList(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let index = -1
  let indent = 0
  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const match = /^(\s*)plugins:\s*$/.exec(lines[cursor])
    if (match) {
      index = cursor
      indent = match[1].length
      break
    }
  }
  if (index < 0) return { found: false, lines, eol }
  let last = index
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (line.trim() === '') continue
    const level = line.length - line.trimStart().length
    if (level <= indent) break
    last = cursor
  }
  return { found: true, index, indent, last, lines, eol }
}

/** Append one entry at the end of the preset's `plugins:` list. */
function appendPluginsBlock(text, block) {
  const found = locatePluginsList(text)
  if (!found.found) return { found: false }
  const item = found.indent + 2
  const built = block.map(([depth, line]) => ' '.repeat(item + depth * 2) + line)
  found.lines.splice(found.last + 1, 0, ...built)
  return { found: true, text: found.lines.join(found.eol) }
}

/**
 * Read the patch's plugin rows without a YAML parser: list items that look like
 * `- id: <name>` plus the `name`, `group` and `disabled` properties one level
 * deeper.
 */
export function parsePatchRows(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const rows = []
  const stack = []
  let current = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const idMatch = /^(\s*)-\s+id:\s*(.+?)\s*$/.exec(line)
    if (idMatch) {
      const indent = idMatch[1].length
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
      const parent = stack.length > 0 ? stack[stack.length - 1] : null
      const row = {
        id: idMatch[2].replace(/^['"]|['"]$/g, ''),
        line: index,
        indent,
        name: '',
        group: parent && parent.groupOnly ? parent.id : null,
        disabled: undefined,
        groupOnly: false,
      }
      rows.push(row)
      stack.push(row)
      current = row
      continue
    }
    if (!current) continue
    const indent = line.length - line.trimStart().length
    if (indent <= current.indent) continue
    if (current.name === '') {
      const nameMatch = /^\s*name:\s*(.+?)\s*$/.exec(line)
      if (nameMatch) {
        current.name = nameMatch[1].replace(/^['"]|['"]$/g, '')
        continue
      }
    }
    const groupMatch = /^\s*group:\s*(true|false)\s*$/.exec(line)
    if (groupMatch) current.groupOnly = groupMatch[1] === 'true'
    const disabledMatch = /^\s*disabled:\s*(.+?)\s*$/.exec(line)
    if (disabledMatch) current.disabled = disabledMatch[1]
  }
  return rows
}

/** True when a patch row's package name looks like a model-facing tool row. */
export function isToolRow(name) {
  if (typeof name !== 'string' || name === '') return false
  return /(^|[-/])dsh-tool-/.test(name) || /\/tools$/.test(name)
}

/* ── consumers: what makes an entry type actually live ────────────────────── */

/**
 * A consumer turns one preset directory into something the model can see.
 * `row` writes a plugin row; `skill-dir` appends to customSkillDirs.
 */
const CONSUMER_DEFS = {
  'skill-dir': { label: '技能目录' },
  inject: { label: '投递器', row: { id: 'studio-inject', name: '@local/dsh-studio-inject' } },
  docs: { label: '写回工具', row: { id: 'studio-docs', name: '@local/dsh-studio-docs' } },
}

/** The row a consumer owns, if it owns one. */
function consumerRow(id) {
  return CONSUMER_DEFS[id]?.row ?? null
}

/* ── the entry types ──────────────────────────────────────────────────────── */

/**
 * The five types. `shape` drives the reader and the create form:
 *   files  — the preset's own config files (no consumer, never created here)
 *   flat   — `<dir>/*.md`, one file per entry
 *   folder — `<dir>/<name>/SKILL.md`, one directory per entry
 *   rows   — entries are plugin rows inside cordis.patch.yml
 */
export const TYPES = [
  {
    id: 'inject',
    label: '注入',
    dir: '注入',
    shape: 'flat',
    orderBy: 'order',
    consumers: ['inject'],
    toggleField: 'enabled',
    hint: '按序号拼进系统提示词或运行上下文；关掉的不投递。',
    create: {
      fields: [
        { key: 'name', label: '名字', required: true, hint: '随便写，中文也行；文件名会用它。' },
        {
          key: 'role',
          label: '落点',
          kind: 'select',
          default: 'system',
          hint: '系统提示词 = 常驻，规则放这；对话上下文 = 贴在当前轮后面；助手块没有独立通道，等同对话上下文。',
          options: [
            { value: 'system', label: '系统提示词（常驻，最稳）' },
            { value: 'user', label: '对话上下文（贴在当前轮后面）' },
            { value: 'assistant', label: '助手块（无独立通道，等同对话上下文）' },
          ],
        },
        {
          key: 'order',
          label: '序号',
          kind: 'number',
          default: 10,
          hint: '按段位：10 人设 / 20 风格 / 30 纪律 / 50 字数 / 70 模式 / 90 补丁。数字留空位，以后插新的不用重排。',
        },
      ],
      body: '在这里写这条注入的内容。\n',
    },
  },
  {
    id: 'doc',
    label: '文档',
    dir: '文档',
    shape: 'flat',
    orderBy: 'name',
    consumers: ['skill-dir', 'docs'],
    toggleField: 'disable-model-invocation',
    hint: '模型在技能目录里看到一句话，需要时才翻开全文；接上写回工具后它能自己改。',
    create: {
      slug: true,
      fields: [
        { key: 'name', label: '文档名（小写英文）', required: true, slug: true },
        { key: 'description', label: '什么时候想起', required: true },
      ],
      body: '在这里写这篇文档的内容。\n',
    },
  },
  {
    id: 'skill',
    label: '技能',
    dir: '技能',
    shape: 'folder',
    orderBy: 'name',
    consumers: ['skill-dir'],
    toggleField: 'disable-model-invocation',
    hint: '模型在做某类活之前主动打开的步骤说明。',
    create: {
      slug: true,
      fields: [
        { key: 'name', label: '技能名（小写英文）', required: true, slug: true },
        { key: 'description', label: '一句话说明', required: true },
      ],
      body: '在这里写这个技能被调用时要做的事。\n',
    },
  },
  {
    id: 'tool',
    label: '工具',
    dir: null,
    shape: 'rows',
    orderBy: 'id',
    consumers: [],
    toggleField: 'disabled',
    hint: '写在 cordis.patch.yml 里的插件行；关掉的不会加载。',
    create: { catalog: true },
  },
  {
    id: 'files',
    label: '文件',
    dir: null,
    shape: 'files',
    orderBy: 'preset',
    consumers: [],
    toggleField: null,
    hint: '预设自己的两个配置文件，改完由 DSH 在下次挂载时读取。',
    create: null,
  },
]

/** The type descriptors the client renders. */
export function typeCatalog() {
  return TYPES.map((type) => ({
    id: type.id,
    label: type.label,
    dir: type.dir,
    shape: type.shape,
    orderBy: type.orderBy,
    toggleField: type.toggleField,
    consumers: type.consumers.map((id) => CONSUMER_DEFS[id].label),
    hint: type.hint,
    create: type.create
      ? {
          fields: type.create.fields ?? [],
          hasCatalog: type.create.catalog === true,
        }
      : null,
  }))
}

/* ── readers ──────────────────────────────────────────────────────────────── */

function readFlat(type, preset) {
  const dir = path.join(preset.dir, type.dir)
  let exists = false
  try {
    exists = fs.statSync(dir).isDirectory()
  } catch {
    exists = false
  }
  const items = []
  let children = []
  if (exists) {
    try {
      children = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      children = []
    }
  }
  for (const child of children) {
    if (!child.isFile() || !child.name.toLowerCase().endsWith('.md')) continue
    const file = path.join(dir, child.name)
    let text = ''
    let mtime = 0
    try {
      text = fs.readFileSync(file, 'utf8')
      mtime = fs.statSync(file).mtimeMs
    } catch {
      continue
    }
    const split = splitFrontmatter(text)
    const head = split ? split.head : ''
    const body = split ? split.rest : text
    const name = readField(head, 'name') || child.name.slice(0, -3)
    const description = readField(head, 'description') || ''
    if (type.id === 'inject') {
      const rawRole = (readField(head, 'role') || 'system').toLowerCase()
      const role = rawRole === 'user' || rawRole === 'assistant' ? rawRole : 'system'
      items.push({
        name,
        fileName: child.name,
        path: file,
        role,
        order: readNumber(head, 'order') ?? 999,
        enabled: readBoolean(readField(head, type.toggleField)) !== false,
        valid: split !== null,
        preview: body.trim().split(/\r?\n/)[0] || '',
        mtime,
      })
    } else {
      items.push({
        name,
        fileName: child.name,
        path: file,
        description,
        chars: body.trim().length,
        enabled: readBoolean(readField(head, type.toggleField)) !== true,
        valid: split !== null && SLUG.test(name) && description !== '',
        mtime,
      })
    }
  }
  items.sort((a, b) =>
    type.orderBy === 'order'
      ? a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans-CN')
      : a.name.localeCompare(b.name, 'zh-Hans-CN'),
  )
  return { dir, exists, items }
}

function readFolder(type, preset) {
  const dir = path.join(preset.dir, type.dir)
  let exists = false
  try {
    exists = fs.statSync(dir).isDirectory()
  } catch {
    exists = false
  }
  const items = []
  let children = []
  if (exists) {
    try {
      children = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      children = []
    }
  }
  for (const child of children) {
    let file = null
    let dirName = null
    if (child.isDirectory()) {
      const candidate = path.join(dir, child.name, 'SKILL.md')
      try {
        if (fs.statSync(candidate).isFile()) {
          file = candidate
          dirName = child.name
        }
      } catch {
        file = null
      }
    } else if (child.isFile() && child.name.toLowerCase().endsWith('.md')) {
      file = path.join(dir, child.name)
      dirName = child.name.slice(0, -3)
    }
    if (!file) continue
    let text = ''
    let mtime = 0
    try {
      text = fs.readFileSync(file, 'utf8')
      mtime = fs.statSync(file).mtimeMs
    } catch {
      continue
    }
    const split = splitFrontmatter(text)
    const head = split ? split.head : ''
    const name = readField(head, 'name') || dirName
    items.push({
      name,
      dirName,
      path: file,
      description: readField(head, 'description') || '',
      enabled: readBoolean(readField(head, type.toggleField)) !== true,
      valid: split !== null,
      mtime,
    })
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return { dir, exists, items }
}

function readRows(type, preset, rows) {
  const items = []
  for (const row of rows) {
    if (row.groupOnly) continue
    if (!isToolRow(row.name)) continue
    const raw = typeof row.disabled === 'string' ? row.disabled : ''
    const auto = raw.includes('!!js')
    const disabled = auto ? false : raw.trim().toLowerCase() === 'true'
    items.push({
      name: row.id,
      id: row.id,
      packageName: row.name,
      group: row.group,
      auto,
      disabled,
      enabled: auto ? true : !disabled,
      expression: auto ? raw : undefined,
    })
  }
  items.sort((a, b) => a.id.localeCompare(b.id))
  return { dir: null, exists: true, items }
}

/* ── wiring state ─────────────────────────────────────────────────────────── */

function wiringOf(type, preset, patchText, rows) {
  const dir = type.dir ? path.join(preset.dir, type.dir) : null
  const dirs = readSkillDirs(patchText)
  const missing = []
  for (const id of type.consumers) {
    if (id === 'skill-dir') {
      if (!dirs.dirs.some((entry) => samePath(entry, dir))) missing.push(CONSUMER_DEFS[id].label)
      continue
    }
    const row = consumerRow(id)
    const present = rows.some((item) => item.name === row.name && !item.groupOnly)
    if (!present) missing.push(CONSUMER_DEFS[id].label)
  }
  return {
    dir,
    wired: type.consumers.length === 0 || missing.length === 0,
    missing,
    consumers: type.consumers.map((id) => ({ id, label: CONSUMER_DEFS[id].label })),
    skillDirs: dirs.dirs,
  }
}

/** Everything the panel needs about one type inside one preset. */
function readType(type, preset, patchText, rows) {
  let read
  if (type.shape === 'flat') read = readFlat(type, preset)
  else if (type.shape === 'folder') read = readFolder(type, preset)
  else if (type.shape === 'rows') read = readRows(type, preset, rows)
  else read = null
  const wiring = wiringOf(type, preset, patchText, rows)
  return {
    id: type.id,
    label: type.label,
    dir: read ? read.dir : null,
    exists: read ? read.exists : true,
    items: read ? read.items : [],
    wiring,
  }
}

/** The preset's own files, in the order a preset is read. */
function discoverFiles(preset) {
  const files = []
  for (const name of PRESET_FILES) {
    const abs = path.join(preset.dir, name)
    try {
      const stat = fs.statSync(abs)
      files.push({
        name,
        path: abs,
        label: preset.name + ' / ' + name,
        group: preset.name,
        size: stat.size,
        mtime: stat.mtimeMs,
      })
    } catch {
      /* missing files simply do not appear */
    }
  }
  return files
}

/** A preset directory's manifest, or the reason it cannot be installed. */
export function readPresetManifest(dir) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return { ok: false, reason: '这个预设的 package.json 不存在，或者不是有效 JSON' }
  }
  if (typeof parsed?.name !== 'string' || parsed.name.trim() === '') {
    return { ok: false, reason: '这个预设的 package.json 里没有 name' }
  }
  const patch = parsed?.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.trim() === '') {
    return { ok: false, reason: 'package.json 里缺 dsh.bundle.patch：DSH 不认它是一个预设包' }
  }
  return { ok: true, name: parsed.name.trim(), version: parsed.version, patch: patch.trim() }
}

/** Read one preset completely. */
export function readPreset(preset) {
  const patchPath = path.join(preset.dir, 'cordis.patch.yml')
  let patchText = ''
  let patchExists = true
  try {
    patchText = fs.readFileSync(patchPath, 'utf8')
  } catch {
    patchExists = false
  }
  const rows = parsePatchRows(patchText)
  const entries = {}
  for (const type of TYPES) entries[type.id] = readType(type, preset, patchText, rows)
  return {
    name: preset.name,
    dir: preset.dir,
    package: preset.package,
    patchPath,
    patchExists,
    files: discoverFiles(preset),
    entries,
  }
}

/* ── writing: create an entry ─────────────────────────────────────────────── */

function frontmatterFor(type, values) {
  const lines = []
  for (const field of type.create.fields ?? []) {
    const raw = values[field.key] !== undefined && values[field.key] !== '' ? values[field.key] : field.default
    if (raw === undefined) continue
    if (field.key === 'name') lines.push('name: ' + raw)
    else if (field.kind === 'number') lines.push(field.key + ': ' + Number(raw))
    else if (field.key === 'description') lines.push('description: ' + JSON.stringify(String(raw)))
    else if (field.kind === 'select') lines.push(field.key + ': ' + raw)
  }
  if (type.toggleField === 'enabled') lines.push('enabled: true')
  if (type.toggleField === 'disable-model-invocation') lines.push('disable-model-invocation: false')
  return '---\n' + lines.join('\n') + '\n---\n\n' + (type.create.body ?? '') 
}

/** Create one entry; returns the file it created so the client can open it. */
export function createEntry(preset, typeId, values) {
  const type = TYPES.find((item) => item.id === typeId)
  if (!type || !type.create) throw new Error('这种条目不能新建')
  const name = String(values.name ?? '').trim()
  if (name === '') throw new Error('名字不能为空')
  if (type.create.slug && !SLUG.test(name)) throw new Error('名字只能用小写字母、数字和连字符，例如 cast-notes')
  for (const field of type.create.fields ?? []) {
    if (field.required && String(values[field.key] ?? '').trim() === '') throw new Error(field.label + '不能为空')
  }
  const dir = path.join(preset.dir, type.dir)
  const file = type.shape === 'folder' ? path.join(dir, name, 'SKILL.md') : path.join(dir, safeFileName(name) + '.md')
  if (!isInside(preset.dir, file)) throw new Error('path is outside the preset')
  if (fs.existsSync(file)) throw new Error('同名的' + type.label + '已存在')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeAtomic(file, frontmatterFor(type, values))
  return { path: file, name }
}

/* ── writing: toggle one entry ────────────────────────────────────────────── */

export function toggleEntry(typeId, file, enabled) {
  const type = TYPES.find((item) => item.id === typeId)
  if (!type || !type.toggleField) throw new Error('这种条目没有开关')
  if (typeId === 'tool') throw new Error('工具开关按行处理')
  const split = splitFrontmatter(fs.readFileSync(file, 'utf8'))
  if (!split) throw new Error('这个文件没有 frontmatter，无法开关')
  const value = type.toggleField === 'enabled' ? (enabled ? 'true' : 'false') : enabled ? 'false' : 'true'
  const head = setField(split.head, type.toggleField, value)
  writeAtomic(file, '---' + split.eol + head + split.eol + '---' + split.eol + split.rest)
  return { path: file, enabled }
}

/** Set one frontmatter field, adding it when absent. */
function setField(head, key, value) {
  const re = new RegExp('^(' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*).*$')
  const eol = head.includes('\r\n') ? '\r\n' : '\n'
  let replaced = false
  const next = head.split(/\r?\n/).map((line) => {
    if (!re.test(line)) return line
    replaced = true
    return key + ': ' + value
  })
  if (!replaced) next.push(key + ': ' + value)
  return next.join(eol)
}

/* ── writing: wire one type ───────────────────────────────────────────────── */

/**
 * Perform every missing consumer step for one type.
 * Returns the steps that actually changed something.
 */
export function wireType(preset, typeId) {
  const type = TYPES.find((item) => item.id === typeId)
  if (!type || type.consumers.length === 0) throw new Error('这种条目不需要接线')
  const patchPath = path.join(preset.dir, 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) throw new Error('这个预设没有 cordis.patch.yml')
  let text = fs.readFileSync(patchPath, 'utf8')
  if (text.trim() === '') throw new Error('这个预设的 cordis.patch.yml 还是空的。先照「示例预设」抄一份过来，再接。')
  const dir = path.join(preset.dir, type.dir)
  const rows = parsePatchRows(text)
  const done = []
  for (const id of type.consumers) {
    if (id === 'skill-dir') {
      const result = wireSkillDir(text, dir)
      if (!result.found) throw new Error('这个预设有 cordis.patch.yml，但里面没有 skill-filesystem 那一行。照「示例预设」抄那三行过来，再接。')
      if (result.inline) throw new Error('customSkillDirs 现在是行内写法，面板改不了，请手动改成多行列表')
      if (result.changed) {
        text = result.text
        done.push('技能目录')
      }
      continue
    }
    const row = consumerRow(id)
    if (rows.some((item) => item.name === row.name && !item.groupOnly)) continue
    const result = appendPluginsBlock(text, [
      [0, '- id: ' + row.id],
      [1, "name: '" + row.name + "'"],
      [1, 'config:'],
      [2, 'dir: ' + yamlString(dir)],
    ])
    if (!result.found) throw new Error('这个预设的 cordis.patch.yml 里找不到 plugins: 列表。照「示例预设」抄一份再试。')
    text = result.text
    done.push(CONSUMER_DEFS[id].label)
  }
  if (done.length > 0) writeAtomic(patchPath, text)
  fs.mkdirSync(dir, { recursive: true })
  return { changed: done.length > 0, steps: done, patchPath }
}

/* ── writing: tools are patch rows ────────────────────────────────────────── */

/** Every row that is a model-facing tool, with its resolved enabled state. */
export function readToolRows(preset) {
  let text = ''
  try {
    text = fs.readFileSync(path.join(preset.dir, 'cordis.patch.yml'), 'utf8')
  } catch {
    return []
  }
  return readRows(TYPES.find((type) => type.id === 'tool'), preset, parsePatchRows(text)).items
}

/** Switch one tool row on or off by editing only its `disabled:` line. */
export function toggleToolRow(preset, id, enabled) {
  const patchPath = path.join(preset.dir, 'cordis.patch.yml')
  const text = fs.readFileSync(patchPath, 'utf8')
  const lines = text.split(/\r?\n/)
  const row = parsePatchRows(text).find((item) => item.id === id)
  if (!row) throw new Error('这个预设里没有这一行：' + id)
  const raw = typeof row.disabled === 'string' ? row.disabled : ''
  if (raw.includes('!!js')) throw new Error('这一行由平台决定，不能在面板里开关')
  const indent = ' '.repeat(row.indent + 2)
  let disabledAt = -1
  for (let index = row.line + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '') continue
    const level = lines[index].length - lines[index].trimStart().length
    if (level <= row.indent) break
    if (/^\s*disabled:\s*/.test(lines[index])) {
      disabledAt = index
      break
    }
  }
  const next = enabled ? indent + 'disabled: false' : indent + 'disabled: true'
  if (disabledAt >= 0) lines[disabledAt] = next
  else lines.splice(row.line + 1, 0, next)
  writeAtomic(patchPath, lines.join('\n'))
  return { id, enabled }
}

/** Append one tool row from the catalog. */
export function addToolRow(preset, entry) {
  const patchPath = path.join(preset.dir, 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) throw new Error('这个预设没有 cordis.patch.yml')
  const text = fs.readFileSync(patchPath, 'utf8')
  if (text.trim() === '') throw new Error('这个预设的 cordis.patch.yml 还是空的。先照「示例预设」抄一份过来，再加工具。')
  if (parsePatchRows(text).some((row) => row.id === entry.id || row.name === entry.name)) {
    throw new Error('这个预设里已经有 ' + entry.name + ' 了（同 id 或同包都算一个）')
  }
  const block = [
    [0, '- id: ' + entry.id],
    [1, "name: '" + entry.name.replace(/'/g, "''") + "'"],
  ]
  if (entry.guard) block.push([1, 'disabled: !!js ' + entry.guard])
  if (Array.isArray(entry.config) && entry.config.length > 0) {
    block.push([1, 'config:'])
    for (const line of entry.config) block.push([2, line])
  }
  const result = appendPluginsBlock(text, block)
  if (!result.found) throw new Error('这个预设的 cordis.patch.yml 里找不到 plugins: 列表。照「示例预设」抄一份再试。')
  writeAtomic(patchPath, result.text)
  return { id: entry.id, name: entry.name }
}

/* ── roots ────────────────────────────────────────────────────────────────── */

/** Resolve the configured roots to absolute directories that exist. */
export function resolveRoots(config) {
  const declared = []
  if (typeof config?.root === 'string') declared.push(config.root)
  if (Array.isArray(config?.roots)) declared.push(...config.roots.filter((x) => typeof x === 'string'))
  return declared
    .map((dir) => path.resolve(dir))
    .filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory()
      } catch {
        return false
      }
    })
}

/** Every preset directory under the configured roots. */
export function presetDirs(roots) {
  const found = []
  for (const root of roots) {
    let children = []
    try {
      children = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      children = []
    }
    for (const child of children) {
      if (!child.isDirectory()) continue
      const dir = path.join(root, child.name)
      let hasPatch = false
      try {
        hasPatch = fs.statSync(path.join(dir, 'cordis.patch.yml')).isFile()
      } catch {
        hasPatch = false
      }
      if (!hasPatch) continue
      const manifest = readPresetManifest(dir)
      found.push({ name: child.name, dir, package: manifest.ok ? manifest.name : null })
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return found
}

/** Resolve a request path against the roots, or throw a client-safe error. */
export function assertAllowed(roots, input) {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('path is required')
  const abs = path.resolve(input)
  if (!roots.some((root) => isInside(root, abs))) throw new Error('path is outside the configured roots')
  if (!ALLOWED_EXT.has(path.extname(abs).toLowerCase())) throw new Error('unsupported file type: ' + path.extname(abs))
  return abs
}

/* ── templates: a new preset is a copy with its placeholders filled in ────── */

const PLACEHOLDER_EXT = new Set(['.json', '.yml', '.yaml', '.md', '.txt'])

/** Every file under `dir`, recursively. */
function walkFiles(dir, out = []) {
  let children = []
  try {
    children = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of children) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** The template directory configured for this studio, or ''. */
export function resolveTemplate(config) {
  const declared = typeof config?.template === 'string' ? config.template.trim() : ''
  return declared === '' ? '' : path.resolve(declared)
}

/** What the panel needs to know before offering "new preset". */
export function readTemplateInfo(config) {
  const dir = resolveTemplate(config)
  if (dir === '') return { dir: '', exists: false, reason: '没有配置模板目录' }
  let exists = false
  try {
    exists = fs.statSync(path.join(dir, 'cordis.patch.yml')).isFile()
  } catch {
    exists = false
  }
  return { dir, exists, reason: exists ? '' : '模板目录不完整：找不到 cordis.patch.yml' }
}

/**
 * Copy the template into `root` and fill its placeholders.
 *
 * The template must not carry absolute paths, so every preset-specific value
 * arrives here as `__NAME__` and is substituted in place. Files keep their
 * exact shape otherwise: the panel's line-based readers depend on it.
 */
export function createPresetFromTemplate(config, root, values) {
  const info = readTemplateInfo(config)
  if (!info.exists) throw new Error(info.reason)
  const title = String(values?.title ?? '').trim()
  const id = String(values?.id ?? '').trim()
  if (title === '') throw new Error('显示名不能为空')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('预设 id 只能用小写字母、数字和连字符，例如 my-preset')
  const dir = path.join(root, safeFileName(title))
  if (!isInside(root, dir)) throw new Error('path is outside the configured roots')
  if (fs.existsSync(dir)) throw new Error('这个名字的目录已经存在：' + path.basename(dir))
  fs.mkdirSync(root, { recursive: true })
  fs.cpSync(info.dir, dir, { recursive: true })
  // The template's own guide explains the template; it must not ship inside a
  // preset. `说明.md` (without the prefix) is the per-preset README and stays.
  const guide = path.join(dir, '模板说明.md')
  if (fs.existsSync(guide)) fs.rmSync(guide)
  const replacements = [
    ['__PACKAGE__', '@local/dsh-preset-' + id],
    ['__PRESET_ID__', id],
    ['__TITLE__', title],
    ['__DIR__', dir],
    ['__PERSONA__', '你是「' + title + '」。完整的工作规则在系统提示词后面的各条注入里，逐条执行。'],
  ]
  let touched = 0
  for (const file of walkFiles(dir)) {
    if (!PLACEHOLDER_EXT.has(path.extname(file).toLowerCase())) continue
    const text = fs.readFileSync(file, 'utf8')
    let next = text
    for (const [key, value] of replacements) next = next.split(key).join(value)
    if (next !== text) {
      fs.writeFileSync(file, next, 'utf8')
      touched += 1
    }
  }
  return { dir, id, title, files: touched }
}
