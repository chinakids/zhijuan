// ===== 织卷 · 构建 dsh 边车插件 =====
// 把 src/plugins/*.ts 逐个用 esbuild 打成自包含 mjs，按包名挂进 dsh-runtime 的
// node_modules（边车 profile 按包名加载）。重复执行是幂等的：只重建目标插件。
import { build } from 'esbuild'
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src', 'plugins')
const outBase = join(root, 'dsh-runtime', 'node_modules')

const entries = readdirSync(srcDir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map((f) => f.slice(0, -3)) // 文件名即包名（如 zj-core / zj-questions）

for (const name of entries) {
  const outDir = join(outBase, name)
  const outfile = join(outDir, 'index.mjs')
  mkdirSync(outDir, { recursive: true })
  await build({
    entryPoints: [join(srcDir, name + '.ts')],
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
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    main: 'index.mjs',
    description: '织卷 dsh 边车插件：' + name
  }
  writeFileSync(join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  console.log(name, '已构建 →', outfile)
}
