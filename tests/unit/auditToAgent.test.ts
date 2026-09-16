import { describe, expect, it } from 'vitest'
import { auditItemToAgentPrompt } from '../../src/shared/auditToAgent'

describe('auditItemToAgentPrompt（审计条目 → agent 指令文本）', () => {
  it('完整条目：包含类型/严重度/位置/现象/建议/关联档案与 zj_edit_doc 引导', () => {
    const t = auditItemToAgentPrompt({
      severity: 'high',
      type: 'setting-conflict',
      where: '第2章 · 灯塔夜访（正文/第02章_灯塔夜访.md）',
      what: '“顾岸的旧车”前文是烟青色，这里写成了黑色',
      suggest: '统一为烟青色并顺手修正后文描写',
      target: '人物/顾岸.md'
    })
    expect(t).toContain('请处理下面这条审读发现')
    expect(t).toContain('setting-conflict')
    expect(t).toContain('严重度 high')
    expect(t).toContain('第2章 · 灯塔夜访')
    expect(t).toContain('顾岸的旧车')
    expect(t).toContain('统一为烟青色')
    expect(t).toContain('人物/顾岸.md')
    expect(t).toContain('zj_edit_doc')
    expect(t).toContain('不要整篇替换')
    expect(t).toContain('只处理这一条发现')
    expect(t).toContain('不需要 zj_search 全库搜索')
    expect(t).toContain('一次给出修改方案')
  })

  it('无 target：不出现关联档案行', () => {
    const t = auditItemToAgentPrompt({
      severity: 'low',
      type: 'foreshadow',
      where: '第1章 · 雾港之夜',
      what: '墙角提到一封信，之后没有回收',
      suggest: '后续任一章节提一笔，或在文中删掉'
    })
    expect(t).not.toContain('关联档案')
    expect(t).toContain('foreshadow')
  })

  it('refFile（别名登记处指路）：出现关联档案行并引导读档案核实', () => {
    const t = auditItemToAgentPrompt({
      severity: 'low',
      type: 'character',
      where: '雾港（正文/第01章_雾港.md）',
      what: '正文出现了「沈爷」——这是「沈藏」档案登记的别名，但本章约定头「涉及人物」没有列 TA。',
      suggest: '若「沈藏」确实在这一章出场，把 TA 加进本章约定头的「涉及人物」。',
      refFile: '人物/沈藏.md'
    })
    expect(t).toContain('关联档案：人物/沈藏.md')
    expect(t).toContain('zj_read_doc')
    expect(t).toContain('zj_edit_doc')
    expect(t).toContain('不要整篇替换')
  })

  it('字段含换行/特殊字符时按行拼接不破坏', () => {
    const t = auditItemToAgentPrompt({
      severity: 'medium',
      type: 'prose',
      where: '第3章',
      what: '沈确的称呼在“你”与“您”之间跳了两次\n（第二行）',
      suggest: '保持固定称呼'
    })
    expect(t).toContain('现象：沈确的称呼在“你”与“您”之间跳了两次\n（第二行）')
    expect(t.split('\n')).toContain('建议：保持固定称呼')
  })
})
