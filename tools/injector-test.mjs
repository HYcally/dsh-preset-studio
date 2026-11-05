/**
 * Drive the real injector.js against real injection folders with a recording
 * fake ctx, so "what gets registered" is observed instead of assumed.
 *
 * The last two sections are the regressions this file exists for:
 *   • editing an injection must change what the model reads on the next turn;
 *   • creating one must not wait for the preset to be mounted again.
 *
 *   node tools/injector-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const INJECTOR = fileURLToPath(new URL('../runtime-inject/index.js', import.meta.url))

const { apply, name } = await import(pathToFileURL(INJECTOR).href)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fakeCtx() {
  const record = { sections: [], contexts: [], warnings: [], info: [], disposed: [] }
  const drop = (list, entry) => {
    const at = list.indexOf(entry)
    if (at >= 0) list.splice(at, 1)
  }
  return {
    record,
    logger: {
      warn: (message) => record.warnings.push(String(message)),
      info: (message) => record.info.push(String(message)),
    },
    systemPrompt: {
      section: (entry) => {
        record.sections.push(entry)
        return () => {
          record.disposed.push(entry.name)
          drop(record.sections, entry)
        }
      },
      context: (entry) => {
        record.contexts.push(entry)
        return () => {
          record.disposed.push(entry.name)
          drop(record.contexts, entry)
        }
      },
    },
  }
}

const problems = []
const expect = (ok, message) => {
  if (!ok) problems.push(message)
}
const bodyOf = (entry) => (typeof entry.text === 'function' ? entry.text() : String(entry.text))

/* ── 1. a two-file folder: one enabled system entry, one disabled ── */
const solo = path.join(os.tmpdir(), 'injector-solo-' + Date.now())
fs.mkdirSync(solo, { recursive: true })
fs.writeFileSync(
  path.join(solo, '开场约束.md'),
  '---\nname: 开场约束\nrole: system\norder: 1\nenabled: true\n---\n\n第一段只写环境，不写人物心理。\n',
  'utf8',
)
fs.writeFileSync(
  path.join(solo, '禁用总结.md'),
  '---\nname: 禁用总结\nrole: system\norder: 2\nenabled: false\n---\n\n不该出现。\n',
  'utf8',
)

const demo = fakeCtx()
apply(demo, { dir: solo })

console.log('=== 单独文件夹 ===')
console.log('sections :', demo.record.sections.map((entry) => entry.name + '@' + entry.order).join(', '))
console.log('contexts :', demo.record.contexts.map((entry) => entry.name + '@' + entry.order).join(', '))

expect(demo.record.sections.length === 1, 'expected exactly 1 section, got ' + demo.record.sections.length)
const first = demo.record.sections[0] || {}
expect(first.name === 'custom-inject:开场约束', 'section name wrong: ' + first.name)
expect(first.order === 8001, 'section order must be 8000+序号=8001, got ' + first.order)
expect(first.interpolate === false, 'section must opt out of {{}} interpolation')
expect(typeof first.text === 'function', 'section text must be a function so edits are not frozen at mount')
expect(bodyOf(first).includes('第一段只写环境'), 'section body missing: ' + bodyOf(first))
expect(
  !demo.record.sections.some((entry) => String(entry.name).includes('禁用总结')),
  'the disabled injection must not be registered',
)
fs.rmSync(solo, { recursive: true, force: true })

/* ── 2. a folder with every role, plus junk ── */
const scratch = path.join(os.tmpdir(), 'injector-test-' + Date.now())
fs.mkdirSync(scratch, { recursive: true })
const write = (file, text) => fs.writeFileSync(path.join(scratch, file), text, 'utf8')

write('a-system.md', '---\nname: 系统条\nrole: system\norder: 2\nenabled: true\n---\n\n系统说了算 {{not_a_variable}}\n')
write('b-user.md', '---\nname: 用户条\nrole: user\norder: 1\nenabled: true\n---\n\n用户说了算\n')
write('c-assistant.md', '---\nname: 助手条\nrole: assistant\norder: 3\nenabled: true\n---\n\n助手的口吻\n')
write('d-off.md', '---\nname: 关掉的\nrole: user\norder: 4\nenabled: false\n---\n\n不该出现\n')
write('e-empty.md', '---\nname: 空的\nrole: user\norder: 5\nenabled: true\n---\n\n')
write('f-nofm.md', '没有 frontmatter 的文件\n')

const mixed = fakeCtx()
apply(mixed, { dir: scratch })

console.log('\n=== 混合角色 ===')
console.log('sections :', mixed.record.sections.map((entry) => entry.name + '@' + entry.order).join(', '))
console.log('contexts :', mixed.record.contexts.map((entry) => entry.name + '@' + entry.order).join(', '))

expect(mixed.record.sections.length === 1, 'mixed: expected 1 section (system role only)')
expect(mixed.record.contexts.length === 2, 'mixed: expected 2 contexts (user + assistant)')
expect(
  mixed.record.contexts.map((entry) => entry.name).sort().join(',') === 'custom-inject:助手条,custom-inject:用户条',
  'mixed: context names wrong',
)
expect(
  mixed.record.contexts.every((entry) => entry.interpolate === false),
  'mixed: every context must opt out of interpolation',
)
expect(
  !mixed.record.contexts.some((entry) => String(entry.name).includes('关掉的')),
  'mixed: disabled entry leaked in',
)
expect(
  !mixed.record.contexts.some((entry) => String(entry.name).includes('空的')),
  'mixed: empty-body entry leaked in',
)
expect(
  !mixed.record.sections.some((entry) => String(entry.name).includes('空的')),
  'mixed: files without frontmatter must be skipped',
)

/* ── 3. ordering: 序号 decides, not the file name ── */
const userOrders = mixed.record.contexts.filter((entry) => entry.name.indexOf('用户条') >= 0)
expect(
  userOrders[0] && userOrders[0].order === 501,
  'user order must be 500+序号=501, got ' + (userOrders[0] && userOrders[0].order),
)

/* ── 4. editing a file changes what the contribution returns ── */
const userEntry = mixed.record.contexts.find((entry) => entry.name === 'custom-inject:用户条')
write('b-user.md', '---\nname: 用户条\nrole: user\norder: 1\nenabled: true\n---\n\n改过的正文\n')
expect(
  userEntry && bodyOf(userEntry).includes('改过的正文'),
  'editing an injection must be visible without a remount, got: ' + (userEntry && bodyOf(userEntry)),
)
expect(
  !bodyOf(userEntry).includes('用户说了算'),
  'the old body must be gone after the edit',
)

/* ── 5. a new file is picked up by the watcher ── */
const before = mixed.record.contexts.length
write('z-late.md', '---\nname: 迟到的\nrole: user\norder: 9\nenabled: true\n---\n\n刚建的\n')
await sleep(600)
console.log('\n=== 新建一枚之后 ===')
console.log('disposed :', mixed.record.disposed.join(', ') || '(none)')
console.log('contexts :', mixed.record.contexts.map((entry) => entry.name).join(', '))
expect(
  mixed.record.contexts.some((entry) => entry.name === 'custom-inject:迟到的'),
  'a newly created injection must be registered without remounting the preset',
)
expect(mixed.record.disposed.length > 0, 'the rebuild must dispose the previous registrations')

/* ── 6. a deleted file is dropped ── */
fs.rmSync(path.join(scratch, 'c-assistant.md'))
await sleep(600)
expect(
  !mixed.record.contexts.some((entry) => entry.name === 'custom-inject:助手条'),
  'a deleted injection must disappear from the registration set',
)

/* ── 7. hostile configs must not throw ── */
const broken = fakeCtx()
try {
  apply(broken, {})
  expect(broken.record.warnings.length >= 1, 'missing dir must warn')
} catch (error) {
  problems.push('missing dir threw: ' + error.message)
}
try {
  apply(fakeCtx(), { dir: path.join(scratch, 'nope') })
} catch (error) {
  problems.push('missing folder threw: ' + error.message)
}

fs.rmSync(scratch, { recursive: true, force: true })

console.log('\nplugin name:', name)
if (problems.length > 0) {
  console.log('\nFAILED:')
  for (const item of problems) console.log(' -', item)
  process.exit(1)
}
console.log('\nOK: injector registers the right sections and contexts, follows edits and file changes, never throws')
// Every fake ctx keeps a live directory watcher (a real ctx disposes it), so the
// loop would never drain on its own.
process.exit(0)
