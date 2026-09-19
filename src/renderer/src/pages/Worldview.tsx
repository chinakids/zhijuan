import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import DocSection from '../features/docs/DocSection'
import { useFsChanged } from '../features/fs/useFsEvents'
import { orphanWorldFiles } from '../../../shared/slices'

export default function Worldview() {
  const { id = '' } = useParams()
  // 孤儿切片文件标注（2026-09-19 创作层）：切片改名后 切片_<旧名>.md 保留为历史（退出活跃流），
  // 「世界文件列表 − 活跃切片集合」判孤儿；世界文件增删时重算（DocSection 列表同源刷新），
  // 切片改名发生在 Novel 页（本页未挂载），挂载/切项目即最新。
  const [stale, setStale] = useState<Set<string>>(new Set())
  const reloadStale = useCallback(() => {
    if (!id) return
    void Promise.all([window.zhijuan.listDocs(id, '世界观'), window.zhijuan.listSlices(id)])
      .then(([files, slices]) => {
        setStale(new Set(orphanWorldFiles(files.map((d) => d.file), slices.map((s) => s.name))))
      })
      .catch(() => {
        /* 算不出孤儿集合时维持空集（零标注），不阻塞文档列表 */
      })
  }, [id])

  useEffect(() => {
    reloadStale()
  }, [reloadStale])

  useFsChanged(id, '世界观/', reloadStale)

  return (
    <DocSection
      relDir="世界观"
      overviewFile="世界观/总纲.md"
      addLabel="设定文档"
      addHint="新建设定文档（如：力量体系 / 地理 / 势力）"
      listLabel="世界观设定"
      foldKey="worldview"
      emptyHint="还没有设定文档。总纲在新建项目时已生成。"
      templateFor={(name) => `# ${name}\n\n> 按时间切片维护：每个切片的当刻事实由「切片同步」维护，这里写不变的部分。\n\n## 具体规则\n\n\n## 各切片当刻状态\n`}
      fileTitle={(n) => n.replace(/^_/, '')}
      staleDocFiles={stale}
    />
  )
}
