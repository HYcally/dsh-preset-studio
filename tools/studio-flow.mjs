/**
 * Drive the studio's routes against a throwaway root: create, toggle, wire,
 * add a tool, read/write a file. No HTTP, no reload — the module's handlers are
 * called directly, so a broken contract fails here instead of in the panel.
 *
 *   node tools/studio-flow.mjs
 */
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BUNDLE = fileURLToPath(new URL('../packages/studio/index.js', import.meta.url))
const mod = await import(pathToFileURL(BUNDLE).href)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-flow-'))
const make = (name, patch) => {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), patch, 'utf8')
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@local/preset-' + name, version: '0.0.1', dsh: { bundle: { patch: 'cordis.patch.yml' } } }),
    'utf8',
  )
  return dir
}

const BARE = [
  '- insert:',
  '    - id: preset-x',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: x',
  '        order: 9',
  '        plugins:',
  '          - id: skill-filesystem',
  "            name: '@deepseek-ai/dsh-skill-filesystem'",
  '            config:',
  '              customSkillDirs: []',
  '          - id: tool-skill',
  "            name: '@deepseek-ai/dsh-tool-skill'",
  '',
].join('\n')

const bareDir = make('bare', BARE)
const emptyDir = make('empty', '')

/* a template: no absolute paths, only placeholders */
const templateDir = path.join(root, '_template')
fs.mkdirSync(path.join(templateDir, '注入'), { recursive: true })
fs.writeFileSync(
  path.join(templateDir, 'package.json'),
  JSON.stringify({ name: '__PACKAGE__', version: '0.1.0', description: '__TITLE__', dsh: { bundle: { patch: 'cordis.patch.yml' } } }, null, 2),
  'utf8',
)
fs.writeFileSync(
  path.join(templateDir, 'cordis.patch.yml'),
  [
    '- insert:',
    '    - id: __PRESET_ID__',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: __PRESET_ID__',
    '        plugins:',
    '          - id: persona',
    "            name: '@deepseek-ai/dsh-persona'",
    '            config:',
    "              prefix: '__PERSONA__'",
    '          - id: studio-inject',
    "            name: 'dsh-preset-studio/inject'",
    '            config:',
    "              dir: '__DIR__\\注入'",
    '',
  ].join('\n'),
  'utf8',
)
fs.writeFileSync(
  path.join(templateDir, '注入', '10-人设.md'),
  '---\nname: 10-人设\nrole: system\norder: 10\nenabled: true\n---\n\n__TITLE__ 的人设。\n',
  'utf8',
)

const routes = new Map()
const ctx = {
  logger: { info: () => {}, warn: () => {} },
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  effect: (fn) => fn(),
  get: () => undefined,
}
mod.apply(ctx, { root, template: templateDir })

async function call(method, routePath, payload) {
  const route = routes.get(routePath.split('?')[0])
  if (!route) throw new Error('no route ' + routePath)
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload), 'utf8')])
  req.method = method
  req.url = routePath
  req.socket = { remoteAddress: '127.0.0.1' }
  let status = 0
  let body = ''
  await route.handler(req, {
    writeHead(code) {
      status = code
    },
    end(chunk) {
      body = String(chunk)
    },
  })
  let json = null
  try {
    json = JSON.parse(body)
  } catch {}
  return { status, json, body }
}

const problems = []
const expect = (ok, message) => {
  if (!ok) problems.push(message)
}
const R = mod.ROUTES
const patchText = () => fs.readFileSync(path.join(bareDir, 'cordis.patch.yml'), 'utf8')
const presetOf = (payload, dir) => {
  const found = (payload.presets || []).find((item) => item.dir === dir)
  return found
}

/* ── 1. the listing is the whole model ── */
const listed = await call('GET', R.presets)
expect(listed.status === 200, 'presets route must answer 200')
expect(listed.json.types.map((type) => type.id).join(',') === 'inject,doc,skill,tool,files', 'type catalog drifted')
expect((listed.json.tools || []).length >= 10, 'the tool catalog must ship with the payload')
const bare = presetOf(listed.json, bareDir)
expect(bare && bare.entries.inject.wiring.missing.length === 1, 'a bare preset must miss exactly its injector')
expect(bare && bare.entries.doc.wiring.missing.length === 2, 'a bare preset must miss both doc consumers')
expect(bare && bare.entries.skill.wiring.missing.length === 1, 'a bare preset must miss the skill dir')
expect(bare && bare.entries.files.items.length === 0, 'files are not entries; they ride on preset.files')
expect(bare && bare.files.length === 2, 'both preset files must be discovered')

/* ── 2. create one entry of each kind ── */
const inj = await call('POST', R.create, { preset: bareDir, type: 'inject', values: { name: '05-开场', role: 'user', order: 5 } })
expect(inj.status === 200, 'inject create failed: ' + inj.body)
const injFile = path.join(bareDir, '注入', '05-开场.md')
const injText = fs.existsSync(injFile) ? fs.readFileSync(injFile, 'utf8') : ''
console.log('=== 注入 frontmatter ===')
console.log(injText.split('\n').slice(0, 7).join('\n'))
expect(injText.includes('name: 05-开场'), 'inject frontmatter lost the name')
expect(injText.includes('role: user'), 'inject frontmatter lost the role')
expect(injText.includes('order: 5'), 'inject frontmatter lost the order')
expect(injText.includes('enabled: true'), 'a new injection starts enabled')

const doc = await call('POST', R.create, { preset: bareDir, type: 'doc', values: { name: 'cast-notes', description: '人物认知' } })
expect(doc.status === 200, 'doc create failed: ' + doc.body)
expect(fs.existsSync(path.join(bareDir, '文档', 'cast-notes.md')), 'the document file is missing')

const skill = await call('POST', R.create, { preset: bareDir, type: 'skill', values: { name: 'write-scene', description: '写一场戏' } })
expect(skill.status === 200, 'skill create failed: ' + skill.body)
expect(fs.existsSync(path.join(bareDir, '技能', 'write-scene', 'SKILL.md')), 'the skill folder is missing')

/* ── 3. toggle one entry ── */
const toggled = await call('POST', R.toggle, { type: 'inject', path: injFile, enabled: false })
expect(toggled.status === 200, 'inject toggle failed')
expect(fs.readFileSync(injFile, 'utf8').includes('enabled: false'), 'the injection did not switch off')
const docOff = await call('POST', R.toggle, { type: 'doc', path: path.join(bareDir, '文档', 'cast-notes.md'), enabled: false })
expect(docOff.status === 200, 'doc toggle failed')
expect(
  fs.readFileSync(path.join(bareDir, '文档', 'cast-notes.md'), 'utf8').includes('disable-model-invocation: true'),
  'a document must switch off through disable-model-invocation',
)

/* ── 4. wire: one call per type, all consumers, idempotent ── */
const wiredDoc = await call('POST', R.wire, { preset: bareDir, type: 'doc' })
const afterWire = patchText()
console.log('\n=== 接上文档之后 ===')
console.log(afterWire)
expect(wiredDoc.status === 200, 'doc wire failed: ' + wiredDoc.body)
expect(wiredDoc.json.steps.length === 2, 'doc wire must report both steps, got ' + JSON.stringify(wiredDoc.json.steps))
expect(afterWire.includes("'" + path.join(bareDir, '文档') + "'"), 'the doc dir is not in customSkillDirs')
expect(afterWire.includes("name: 'dsh-preset-studio/docs'"), 'the write-back row is missing')
expect(afterWire.includes("dir: '" + path.join(bareDir, '文档') + "'"), 'the write-back row points elsewhere')
const again = await call('POST', R.wire, { preset: bareDir, type: 'doc' })
expect(again.json.changed === false, 'a second wire must be a no-op')
expect(patchText() === afterWire, 'a second wire must not touch the file')

const wiredInject = await call('POST', R.wire, { preset: bareDir, type: 'inject' })
expect(wiredInject.json.steps.join(',') === '投递器', 'inject wire must add exactly the injector')
expect(patchText().includes("name: 'dsh-preset-studio/inject'"), 'the injector row is missing')

/* ── 5. the listing now agrees ── */
const after = presetOf((await call('GET', R.presets)).json, bareDir)
expect(after.entries.inject.wiring.wired === true, 'inject still reports unwired')
expect(after.entries.doc.wiring.wired === true, 'doc still reports unwired')
expect(after.entries.inject.items[0].name === '05-开场', 'the created injection is not listed')
expect(after.entries.inject.items[0].enabled === false, 'the switched-off injection reads as enabled')
expect(after.entries.doc.items[0].valid === true, 'the created document must be valid')

/* ── 6. tools are rows ── */
const rows = after.entries.tool.items
expect(rows.length === 1, 'expected the one tool row already in the patch, got ' + rows.length)
const added = await call('POST', R.toolAdd, { preset: bareDir, id: 'tool-fs' })
expect(added.status === 200, 'tool add failed: ' + added.body)
expect(patchText().includes("id: tool-fs"), 'the tool row was not written')
const toolOff = await call('POST', R.toolToggle, { preset: bareDir, id: 'tool-fs', enabled: false })
expect(toolOff.status === 200, 'tool toggle failed')
expect(/id: tool-fs[\s\S]{0,120}?disabled: true/.test(patchText()), 'the tool row did not switch off')

/* ── 7. read / write through the panel ── */
const read = await call('GET', R.read + '?path=' + encodeURIComponent(path.join(bareDir, 'cordis.patch.yml')))
expect(read.status === 200 && read.json.content.length > 0, 'read route failed')
const write = await call('POST', R.write, { path: path.join(bareDir, 'cordis.patch.yml'), content: read.json.content, baseMtime: read.json.mtime })
expect(write.status === 200, 'write route failed')

/* ── 8. refusals ── */
const badSlug = await call('POST', R.create, { preset: bareDir, type: 'doc', values: { name: '人物卡', description: 'x' } })
expect(badSlug.status === 400, 'a non-ASCII document name must be refused')
console.log('\n中文文档名 ->', badSlug.status, badSlug.json && badSlug.json.error)

const noDesc = await call('POST', R.create, { preset: bareDir, type: 'doc', values: { name: 'ok-name', description: '  ' } })
expect(noDesc.status === 400, 'an empty description must be refused')

const dup = await call('POST', R.create, { preset: bareDir, type: 'doc', values: { name: 'cast-notes', description: 'y' } })
expect(dup.status === 400, 'a duplicate name must be refused')

const outside = await call('POST', R.create, { preset: 'C:/Windows', type: 'doc', values: { name: 'x', description: 'y' } })
expect(outside.status === 400, 'a preset outside the roots must be refused')

const empty = await call('POST', R.wire, { preset: emptyDir, type: 'inject' })
expect(empty.status === 400, 'wiring an empty patch must be refused')
console.log('空 patch 接线 ->', empty.status, empty.json && empty.json.error)

const notEntry = await call('POST', R.toggle, { type: 'files', path: path.join(bareDir, 'package.json'), enabled: false })
expect(notEntry.status === 400, 'files must not be toggleable')

/* ── 9. a new preset is a template copy with the placeholders filled in ── */
const created2 = await call('POST', R.presetCreate, { title: '测试预设', id: 'test-preset' })
expect(created2.status === 200, 'preset create failed: ' + created2.body)
const newDir = path.join(root, '测试预设')
expect(fs.existsSync(path.join(newDir, 'cordis.patch.yml')), 'the new preset has no patch')
const newPatch = fs.existsSync(path.join(newDir, 'cordis.patch.yml')) ? fs.readFileSync(path.join(newDir, 'cordis.patch.yml'), 'utf8') : ''
const newManifest = fs.existsSync(path.join(newDir, 'package.json')) ? fs.readFileSync(path.join(newDir, 'package.json'), 'utf8') : ''
console.log('\n=== 从模板新建 ===')
console.log(newPatch)
expect(!/__[A-Z_]+__/.test(newPatch), 'the patch still contains placeholders')
expect(!/__[A-Z_]+__/.test(newManifest), 'the manifest still contains placeholders')
expect(newManifest.includes('@local/dsh-preset-test-preset'), 'the package name was not derived from the id')
expect(newPatch.includes("id: test-preset"), 'the patch id was not substituted')
expect(newPatch.includes("dir: '" + path.join(newDir, '注入') + "'"), 'the patch path was not substituted')
const newListed = presetOf((await call('GET', R.presets)).json, newDir)
expect(newListed && newListed.entries.inject.wiring.wired === true, 'a freshly created preset must come pre-wired')
expect(newListed && newListed.entries.inject.items.length === 1, 'the template injection was not copied')

const dupPreset = await call('POST', R.presetCreate, { title: '测试预设', id: 'other-id' })
expect(dupPreset.status === 400, 'creating a preset over an existing folder must be refused')
const badId = await call('POST', R.presetCreate, { title: '另一个', id: '中文id' })
expect(badId.status === 400, 'a non-ASCII preset id must be refused')
console.log('重复目录 ->', dupPreset.status, dupPreset.json && dupPreset.json.error)

fs.rmSync(root, { recursive: true, force: true })

if (problems.length > 0) {
  console.log('\nFAILED:')
  for (const item of problems) console.log(' -', item)
  process.exit(1)
}
console.log('\nOK: entries are created, toggled and wired through one model; bad input is refused')
