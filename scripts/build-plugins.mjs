// ===== 织卷 · 构建 dsh 写作域插件 =====
// 把 src/plugins/zj-core.ts 用 esbuild 打成自包含 mjs，按包名挂进 dsh-runtime 的
// node_modules（边车 profile 按包名加载它）。重复执行是幂等的：只重建 zj-core。
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'dsh-runtime', 'node_modules', 'zj-core')
const outfile = join(outDir, 'index.mjs')

mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'plugins', 'zj-core.ts')],
  bundle: true,
  write: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile,
  sourcemap: false,
  external: ['node:*'],
  logLevel: 'warning'
})

// 包描述（mjs 以 ESM 引入）——保持幂等，避免每次覆盖
const pkg = {
  name: 'zj-core',
  version: '0.1.0',
  private: true,
  type: 'module',
  main: 'index.mjs',
  description: '织卷写作域工具（只读：列文档/读文档/全文搜索/作品结构）'
}
writeFileSync(join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

console.log('zj-core 已构建 →', outfile)
