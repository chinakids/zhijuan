/**
 * 守卫「未建档」条目批量快速建档（渲染层；与 GuardIssuesNote 单条建档同一语义）。
 * 写前 readDoc 查存在——已有档案（作者在别处已建、列表未刷新）绝不覆盖（writeDoc 是覆盖写）；
 * 不存在则按项目引导同款模板（shared/charDoc quickCharDocMarkdown）写 人物/<名>.md。
 * 返回已建 / 已存在的 target 原值列表，调用方做状态呈现。
 */
import type { SyncIssue } from '../../../../shared/types'
import { quickCharDocMarkdown } from '../../../../shared/charDoc'
import { personRelOf } from './guardCreate'

export interface QuickCreateResult {
  /** 本次实际新建的 target 原值 */
  created: string[]
  /** 已存在（未覆盖）的 target 原值 */
  skipped: string[]
}

export async function bulkQuickCreate(projectId: string, issues: SyncIssue[]): Promise<QuickCreateResult> {
  const created: string[] = []
  const skipped: string[] = []
  for (const it of issues) {
    const rel = personRelOf(it.target)
    if (!rel) continue
    const existing = await window.zhijuan.readDoc(projectId, rel)
    if (existing === null) {
      const name = rel.slice('人物/'.length).replace(/\.md$/, '')
      await window.zhijuan.writeDoc(projectId, rel, quickCharDocMarkdown(name))
      created.push(it.target)
    } else {
      skipped.push(it.target)
    }
  }
  return { created, skipped }
}
