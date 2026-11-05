import fs from 'node:fs'

const asar = 'D:\\deepseek\\resources\\app.asar'
const filter = process.argv[2] ?? 'presets/'
const outDir = process.argv[3]

const fd = fs.openSync(asar, 'r')
const sizeBuf = Buffer.alloc(8)
fs.readSync(fd, sizeBuf, 0, 8, null)
const headerSize = sizeBuf.readUInt32LE(4)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 8)
const jsonLen = headerBuf.readUInt32LE(4)
const json = headerBuf.toString('utf8', 8, 8 + jsonLen)
const header = JSON.parse(json)
const dataStart = 8 + headerSize

const hits = []
function walk(node, prefix) {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (val.files) walk(val, p)
    else if (p.includes(filter)) hits.push({ path: p, size: val.size })
  }
}
walk(header, '')
hits.sort((a, b) => a.path.localeCompare(b.path))
for (const h of hits) console.log(h.path, h.size)

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  function get(node, parts) {
    let cur = node
    for (const part of parts) {
      cur = cur.files?.[part]
      if (!cur) return null
    }
    return cur
  }
  for (const h of hits) {
    const node = get(header, h.path.split('/'))
    if (!node || node.link) continue
    const buf = Buffer.alloc(node.size)
    fs.readSync(fd, buf, 0, node.size, dataStart + Number(node.offset))
    const name = h.path.split('/').pop()
    fs.writeFileSync(`${outDir}\\${name}`, buf)
    console.log('WROTE', name)
  }
}
fs.closeSync(fd)
