import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// runtime.ts 的 DSH_HOME 迁移（2026-10-27）：打包版可变状态必须落在 userData，不许写 .app 内。
// app 面用可变 holder：每个用例改 isPackaged / userData / resourcesPath，再 resetModules 重新导入
// （ensureWritableHome 有模块级缓存）。
const holder = {
  isPackaged: true,
  userData: '',
  appPath: '',
  resourcesPath: ''
}
vi.mock('electron', () => ({
  app: {
    get isPackaged() { return holder.isPackaged },
    getAppPath: () => holder.appPath,
    getPath: () => holder.userData
  }
}))

const stage = join(tmpdir(), 'zj-runtime-home-test')
const resources = join(stage, 'App/Contents/Resources')
const runtime = join(resources, 'dsh-runtime')
const userData = join(stage, 'userData')

const seedTemplate = () => {
  mkdirSync(join(runtime, 'dshhome/profiles/sdk'), { recursive: true })
  mkdirSync(join(runtime, 'dshhome/profiles/headless'), { recursive: true })
  mkdirSync(join(runtime, 'dshhome/sessions/p1'), { recursive: true })
  writeFileSync(join(runtime, 'dshhome/settings.yaml'), 'llm:\n  providers: {}\n')
  writeFileSync(join(runtime, 'dshhome/profiles/sdk/cordis.yml'), 'plugins: [sdk]\n')
  writeFileSync(join(runtime, 'dshhome/profiles/headless/index.js'), '// headless\n')
  writeFileSync(join(runtime, 'dshhome/sessions/p1/session.jsonl'), '{"old":true}\n')
}

const load = async () => {
  vi.resetModules()
  return await import('../../src/main/agent/runtime')
}

beforeEach(() => {
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  holder.isPackaged = true
  holder.userData = userData
  holder.appPath = join(stage, 'repo')
  holder.resourcesPath = resources
  ;(process as any).resourcesPath = resources
  delete process.env.ZHJUAN_DSH_RUNTIME
  seedTemplate()
})

afterEach(() => {
  delete (process as any).resourcesPath
})

describe('ensureWritableHome（DSH_HOME 迁到 userData，packaged）', () => {
  it('首启把基础层复制到 userData/dshhome，run 也在 userData，只读树不被写', async () => {
    const M = await load()
    const boot = M.ensureWritableHome()
    expect(boot.copied).toBe(true)
    expect(boot.home).toBe(join(userData, 'dshhome'))
    expect(boot.root).toBe(userData)
    expect(existsSync(join(userData, 'dshhome/settings.yaml'))).toBe(true)
    expect(existsSync(join(userData, 'dshhome/profiles/sdk/cordis.yml'))).toBe(true)
    expect(existsSync(join(userData, 'dshhome/profiles/headless/index.js'))).toBe(true)
    expect(M.runDir()).toBe(join(userData, 'run'))
    expect(M.dshHome()).toBe(boot.home)
    // 复制不含 node_modules（打包已排），也不在只读树里留 run/
    expect(existsSync(join(userData, 'dshhome/profiles/node_modules'))).toBe(false)
    expect(existsSync(join(runtime, 'run'))).toBe(false)
    // 不残留 staging
    expect(existsSync(join(userData, 'dshhome.boot-1'))).toBe(false)
  })

  it('二次启动（已就位）不再复制', async () => {
    const first = await load()
    const home = first.ensureWritableHome().home
    const second = await load()
    const boot = second.ensureWritableHome()
    expect(boot.copied).toBe(false)
    expect(boot.home).toBe(home)
  })

  it('模板缺失 → 回退引擎树内旧路径，并在 note 里说明', async () => {
    holder.resourcesPath = join(stage, 'App/Contents/Resources-missing')
    ;(process as any).resourcesPath = holder.resourcesPath
    const M = await load()
    const boot = M.ensureWritableHome()
    expect(boot.home).toBe(join(holder.resourcesPath, 'dsh-runtime/dshhome'))
    expect(boot.root).toBe(join(holder.resourcesPath, 'dsh-runtime'))
    expect(boot.note).toMatch(/回退引擎树内 DSH_HOME/)
  })

  it('dev（未打包）行为不变：DSH_HOME / run 仍指引擎树', async () => {
    holder.isPackaged = false
    const M = await load()
    const boot = M.ensureWritableHome()
    expect(boot.home).toBe(join(holder.appPath, 'dsh-runtime/dshhome'))
    expect(M.runDir()).toBe(join(holder.appPath, 'dsh-runtime/run'))
    expect(boot.copied).toBe(false)
  })
})