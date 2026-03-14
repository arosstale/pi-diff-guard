/**
 * pi-diff-guard v1.1 — Edit awareness for Pi
 *
 * Tracks all file changes, warns on large deletions, shows edit heatmap.
 * pi-rewind = undo. pi-diff-guard = awareness.
 *
 * /diffguard status  — edit stats
 * /diffguard log     — recent edits
 * /diffguard report  — edit heatmap (which files changed most)
 */
import type { ExtensionAPI } from '@anthropic-ai/claude-code'

interface EditRecord { file: string; linesAdded: number; linesRemoved: number; timestamp: number; tool: string }
const edits: EditRecord[] = []
let totalAdded = 0, totalRemoved = 0, totalEdits = 0, largeDeleteWarnings = 0

export default function init(pi: ExtensionAPI) {
  // Track edit tool results
  pi.on('tool_result', (event: any) => {
    if (event.toolName === 'edit') {
      const details = event.details
      const file = event.input?.path || 'unknown'
      const oldText = event.input?.oldText || ''
      const newText = event.input?.newText || ''
      const removed = oldText.split('\n').length
      const added = newText.split('\n').length

      totalAdded += added; totalRemoved += removed; totalEdits++
      edits.push({ file, linesAdded: added, linesRemoved: removed, timestamp: Date.now(), tool: 'edit' })
      if (edits.length > 500) edits.shift()

      if (removed > 50 && added < 5) {
        largeDeleteWarnings++
        pi.sendMessage({
          content: `⚠️ **Large deletion** in \`${file}\`: −${removed}/+${added} lines. Use \`/rewind\` if wrong.`,
          display: true,
        }, { triggerTurn: false })
      }
    }

    if (event.toolName === 'write') {
      const file = event.input?.path || 'unknown'
      const content = event.input?.content || ''
      const lines = content.split('\n').length
      totalAdded += lines; totalEdits++
      edits.push({ file, linesAdded: lines, linesRemoved: 0, timestamp: Date.now(), tool: 'write' })
      if (edits.length > 500) edits.shift()
    }
  })

  pi.addCommand({ name: 'diffguard', description: 'Edit awareness — stats, log, heatmap',
    handler: async (args) => {
      const sub = args.trim().toLowerCase()

      if (sub === 'log') {
        const recent = edits.slice(-15).reverse()
        if (!recent.length) { pi.sendMessage({ content: 'No edits yet.', display: true }, { triggerTurn: false }); return }
        const rows = recent.map(e => {
          const ago = Math.round((Date.now() - e.timestamp) / 1000)
          const agoStr = ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`
          return `- ${agoStr} ago — \`${e.file}\` +${e.linesAdded}/−${e.linesRemoved} (${e.tool})`
        })
        pi.sendMessage({ content: `## Edit Log\n\n${rows.join('\n')}`, display: true }, { triggerTurn: false })
        return
      }

      if (sub === 'report' || sub === 'heatmap') {
        // Group by file, show which files changed most
        const fileMap = new Map<string, { edits: number; added: number; removed: number }>()
        for (const e of edits) {
          const f = fileMap.get(e.file) || { edits: 0, added: 0, removed: 0 }
          f.edits++; f.added += e.linesAdded; f.removed += e.linesRemoved
          fileMap.set(e.file, f)
        }

        if (fileMap.size === 0) { pi.sendMessage({ content: 'No edits to report.', display: true }, { triggerTurn: false }); return }

        const sorted = Array.from(fileMap.entries()).sort((a, b) => b[1].edits - a[1].edits)
        const maxEdits = sorted[0][1].edits
        const rows = ['| File | Edits | +/− | Heat |', '|------|-------|-----|------|']

        for (const [file, stats] of sorted.slice(0, 20)) {
          const barLen = Math.round((stats.edits / maxEdits) * 10)
          const heat = '🟥'.repeat(Math.min(barLen, 5)) + '🟧'.repeat(Math.max(0, barLen - 5))
          const net = stats.added - stats.removed
          rows.push(`| \`${file}\` | ${stats.edits} | +${stats.added}/−${stats.removed} (${net >= 0 ? '+' : ''}${net}) | ${heat || '🟩'} |`)
        }

        pi.sendMessage({ content: `## Edit Heatmap\n\n${rows.join('\n')}\n\n_${fileMap.size} files touched, ${totalEdits} total edits_`, display: true }, { triggerTurn: false })
        return
      }

      // Status
      pi.sendMessage({ content: [
        '## Diff Guard', '',
        `**Edits:** ${totalEdits}`,
        `**Lines added:** ${totalAdded}`, `**Lines removed:** ${totalRemoved}`,
        `**Net:** ${totalAdded - totalRemoved >= 0 ? '+' : ''}${totalAdded - totalRemoved}`,
        `**Warnings:** ${largeDeleteWarnings}`,
        `**Files:** ${new Set(edits.map(e => e.file)).size}`,
        '', '`/diffguard log` · `/diffguard report`',
      ].join('\n'), display: true }, { triggerTurn: false })
    }
  })

  pi.addTool({ name: 'diffguard_status', description: 'Edit stats — lines added/removed, warnings, file count.',
    parameters: { type: 'object', properties: {} },
    handler: async () => `Edits: ${totalEdits} | +${totalAdded}/−${totalRemoved} | ${new Set(edits.map(e => e.file)).size} files | ${largeDeleteWarnings} warnings`
  })
}
