/**
 * Document write-back — a preset-side part with no UI of its own.
 *
 * A preset's documents (`<preset>/文档/*.md`) are listed to the model by the
 * skill provider, which only ever hands out text: there is no way for the model
 * to write one back. This plugin adds that one capability, and nothing else:
 * a single `doc_update` tool that appends to, or replaces, the body of a
 * document that already exists. It never creates a document and never touches
 * the frontmatter, so the catalog entry the model is looking at stays valid.
 *
 * It ships inside the `dsh-preset-studio` package as the `./docs` subpath, so
 * a preset adds one row and gets the tool:
 *
 *   - id: studio-docs
 *     name: 'dsh-preset-studio/docs'
 *     config:
 *       dir: '<preset dir>\文档'
 *
 * It deliberately imports no `@deepseek-ai/*` package: a tool definition is a
 * plain object (`tools.register` needs `output.render` and a JSON schema), so
 * this part runs — and can be unit-tested — without the host's module map.
 */
import fs from 'node:fs'
import path from 'node:path'
import { splitFrontmatter } from './frontmatter.js'

/** Stable cordis plugin name. */
export const name = 'dsh-preset-studio/docs'
/** The tool registry is the only service this plugin needs. */
export const inject = ['tools']

/** The two write modes. There is no "create": the panel owns that. */
const MODES = ['append', 'replace']

/** Every document in `dir`, with the name the model knows it by. */
function listDocs(dir) {
  let children = []
  try {
    children = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const docs = []
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
    const stem = child.name.slice(0, -3)
    const declared = split ? /^\s*name:\s*(.+?)\s*$/m.exec(split.head) : null
    const label = declared ? declared[1].replace(/^['"]|['"]$/g, '').trim() : stem
    docs.push({ file, text, split, stem, name: label || stem })
  }
  return docs
}

/** Write one file atomically, so a failed write never truncates a document. */
function writeAtomic(target, content) {
  const tmp = target + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, target)
}

/** The model-facing description. It must say when to call, not just what it does. */
const DESCRIPTION = [
  'Write something back into one of this preset\'s documents (文档), so a later turn — or a later conversation — starts from the updated understanding instead of the old one.',
  'The document list lives in the skill catalog: each document appears there by name with its description. Read the document with the `skill` tool first; that is the only way to see its current text.',
  'Use `append` (the default choice) to add a dated section after what is already there — this is how experience accumulates. Use `replace` only to rewrite the whole body, for example when earlier notes turned out to be wrong and would mislead a later turn.',
  'The frontmatter (name and description) is never changed by this tool.',
].join(' ')

/** The JSON schema shown to the model, and the contract its arguments obey. */
const PARAMETERS = {
  type: 'object',
  properties: {
    doc: {
      type: 'string',
      description: 'The document name exactly as it appears in the skill catalog (or its file name without .md).',
    },
    mode: {
      type: 'string',
      enum: MODES,
      description: 'append adds a new section at the end; replace overwrites the whole body.',
    },
    content: {
      type: 'string',
      description: 'The text to write, in Markdown. No frontmatter: it is preserved for you.',
    },
  },
  required: ['doc', 'mode', 'content'],
}

/** The validated output of one write, already in JSON Schema form. */
const OUTPUT = {
  type: 'object',
  properties: {
    doc: { type: 'string' },
    mode: { type: 'string' },
    path: { type: 'string' },
    chars: { type: 'integer' },
    lines: { type: 'integer' },
  },
  required: ['doc', 'mode', 'path', 'chars', 'lines'],
}

/**
 * Mount `doc_update`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - `{ dir }`, the preset's 文档 directory.
 */
export function apply(ctx, config) {
  const dir = typeof config?.dir === 'string' ? path.resolve(config.dir) : ''
  if (dir === '') {
    ctx.logger?.warn?.('[studio-docs] config.dir is missing; doc_update is not registered')
    return
  }
  ctx.tools.register({
    name: 'doc_update',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT,
      render: (_args, value) => [
        {
          type: 'text',
          text:
            'Wrote ' + value.chars + ' characters into `' + value.doc + '` (' + value.mode + '). ' +
            'The document now has ' + value.lines + ' lines. It keeps its place in the catalog.',
        },
      ],
    },
    execute(args) {
      const doc = typeof args?.doc === 'string' ? args.doc.trim() : ''
      const mode = typeof args?.mode === 'string' ? args.mode.trim() : ''
      const content = typeof args?.content === 'string' ? args.content : ''
      if (doc === '') throw new Error('doc is required: pass the document name from the skill catalog')
      if (!MODES.includes(mode)) throw new Error('mode must be one of: ' + MODES.join(', '))
      if (content.trim() === '') throw new Error('content is empty: nothing to write')
      const docs = listDocs(dir)
      if (docs.length === 0) throw new Error('this preset has no documents under ' + dir)
      const hit =
        docs.find((entry) => entry.name === doc) ||
        docs.find((entry) => entry.name.toLowerCase() === doc.toLowerCase()) ||
        docs.find((entry) => entry.stem.toLowerCase() === doc.toLowerCase())
      if (!hit) {
        throw new Error(
          'no document named "' + doc + '". Available: ' + docs.map((entry) => entry.name).join(', '),
        )
      }
      if (!hit.split) {
        throw new Error('document "' + hit.name + '" has no frontmatter, so the model cannot see it; fix it in the panel first')
      }
      const eol = hit.split.eol || '\n'
      const body = hit.split.rest || ''
      const next = mode === 'append' ? (body.trim() === '' ? content : body.replace(/\s+$/, '') + eol + eol + content) : content
      const text = '---' + eol + hit.split.head + eol + '---' + eol + next
      writeAtomic(hit.file, text)
      return {
        doc: hit.name,
        mode,
        path: hit.file,
        chars: content.length,
        lines: text.split(/\r?\n/).length,
      }
    },
  })
}
