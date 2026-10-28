#!/usr/bin/env node
// 构建打包用 pi 运行时（PowerShell 独立 tree）：build/pi-runtime/node_modules
// piRuntime 打包后从 resources/pi-runtime 解析 @earendil-works/pi-coding-agent。
// 幂等：已安装同版本则跳过。产物 gitignore，electron-builder extraResources 复制。
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'build', 'pi-runtime')
const PKG = '@earendil-works/pi-coding-agent'
const VER = '1.4.0'
const marker = join(dir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json')

if (existsSync(marker)) {
  try {
    const v = JSON.parse(readFileSync(marker, 'utf-8')).version
    if (v === VER) {
      console.log(`[pi-runtime] 已就绪 ${PKG}@${v}`)
      process.exit(0)
    }
  } catch {}
}

mkdirSync(dir, { recursive: true })
writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify({ name: 'zhijuan-pi-runtime', private: true, version: '1.0.0', dependencies: { [PKG]: VER } }, null, 2)
)
console.log(`[pi-runtime] 安装 ${PKG}@${VER} …`)
execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: dir,
  stdio: 'inherit'
})
console.log('[pi-runtime] 完成')