// ===== 织卷 S4 · 切片同步：保存正文后把当前切片的设定那几处也一并推进 =====
// 引擎固定走 harness（dsh 写作引擎）：模型可读章节与设定（当前章与相关设定由主进程装配注入），主进程返回解析好的补丁。
import { extractFrontMatter } from '../../../../shared/fmatter'
import { useProposalStore } from '../../store/proposals'

export async function runSliceSync(projectId: string, chapterRel: string): Promise<{ ok: boolean; items: number; error?: string }> {
  try {
    const r = await window.zhijuan.agentSync(projectId, chapterRel)
    if (!r.ok) return { ok: false, items: 0, error: r.error || '切片同步失败' }
    const clean = r.items ?? []
    const ch = (await window.zhijuan.readDoc(projectId, chapterRel)) ?? ''
    const slice = String(extractFrontMatter(ch).fm?.['切片'] ?? '')
    if (!clean.length) return { ok: true, items: 0 }
    const created = await window.zhijuan.createProposals(projectId, 'slice-sync', chapterRel, slice, clean)
    useProposalStore.getState().refresh(projectId)
    return { ok: true, items: created.length }
  } catch (e) {
    return { ok: false, items: 0, error: String((e as Error).message || e) }
  }
}
