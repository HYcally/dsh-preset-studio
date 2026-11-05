import fs from 'node:fs'

const asar = 'D:\\deepseek\\resources\\app.asar'
const needles = process.argv.slice(2)
const fd = fs.openSync(asar, 'r')
const sizeBuf = Buffer.alloc(8)
fs.readSync(fd, sizeBuf, 0, 8, null)
const headerSize = sizeBuf.readUInt32LE(4)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 8)
const jsonLen = headerBuf.readUInt32LE(4)
const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + jsonLen))
const dataStart = 8 + headerSize

const files = []
function walk(node, prefix) {
  for (const [name, value] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name
    if (value.files) walk(value, p)
    else if (typeof value.size === 'number') files.push({ path: p, size: value.size, offset: Number(value.offset) })
  }
}
walk(header, '')

let scanned = 0
for (const file of files) {
  if (!/\.(js|mjs|cjs|json|yml|yaml|md)$/.test(file.path)) continue
  if (file.size > 8 * 1024 * 1024) continue
  const buf = Buffer.alloc(file.size)
  fs.readSync(fd, buf, 0, file.size, dataStart + file.offset)
  const text = buf.toString('utf8')
  scanned += 1
  for (const needle of needles) {
    if (text.includes(needle)) {
      console.log('HIT[' + needle.slice(0, 28) + '] ' + file.path)
    }
  }
}
console.log('scanned', scanned, 'of', files.length)
fs.closeSync(fd)
