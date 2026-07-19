import fs from 'node:fs'

import { build } from 'esbuild'

const packageDirectory = new URL('../', import.meta.url)
const publicDirectory = new URL('../dist/public/', import.meta.url)

fs.mkdirSync(publicDirectory, { recursive: true })

await build({
  bundle: true,
  entryPoints: [new URL('../src/web/main.ts', import.meta.url).pathname],
  format: 'esm',
  outfile: new URL('./editor.js', publicDirectory).pathname,
  platform: 'browser',
  target: 'es2022',
})

fs.copyFileSync(new URL('./src/web/index.html', packageDirectory), new URL('./index.html', publicDirectory))
fs.copyFileSync(new URL('./src/web/styles.css', packageDirectory), new URL('./styles.css', publicDirectory))
fs.chmodSync(new URL('../dist/cli/index.js', import.meta.url), 0o755)
