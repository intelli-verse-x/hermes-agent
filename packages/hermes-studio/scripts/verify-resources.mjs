import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const forbidden = [/node_modules/, /\.vsix$/i, /\.(zip|dmg|exe|appimage|tar\.gz)$/i, /dist[\\/].*\.(js|css)$/]
const maxSourceBytes = 512 * 1024

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue
    const full = path.join(directory, entry.name)
    const relative = path.relative(root, full)
    if (forbidden.some(pattern => pattern.test(relative))) throw new Error(`Forbidden packaged resource: ${relative}`)
    if (entry.isDirectory()) walk(full)
    else if (fs.statSync(full).size > maxSourceBytes) throw new Error(`Oversized foundation source: ${relative}`)
  }
}

walk(root)
console.log('Hermes Studio resource contract passed')
