/**
 * pi-diff-guard — Edit safety for Pi
 * Tracks all file changes, warns on large deletions, logs edit history.
 *
 * /diffguard status — show edit stats
 * /diffguard log — recent edits with diffs
 */
import type { ExtensionAPI } from '@anthropic-ai/claude-code'

interface EditRecord { file: string; linesAdded: number; linesRemoved: number; timestamp: number; tool: string }
const edits: EditRecord[] = []
let totalAdded = 0, totalRemoved = 0, totalEdits = 0, largeDeleteWarnings = 0

export default function init(pi: ExtensionAPI) {
  pi.on('post_edit', (event: any) => {
    const oldText = event.oldText || ''
    const newText = event.newText || ''
    const added = newText.split('\n').length
    const removed = oldText.split('\n').length
    const file = event.path || 'unknown'

    totalAdded += added; totalRemoved += removed; totalEdits++
    edits.push({ file, linesAdded: added, linesRemoved: removed, timestamp: Date.now(), tool: 'edit' })
    if (edits.length > 200) edits.shift()

    // Warn on large deletions (>50 lines removed, <5 added)
    if (removed > 50 && added < 5) {
      largeDeleteWarnings++
      pi.sendMessage({
        content: `⚠️ **Large deletion detected** in \`${file}\`: ${removed} lines removed, only ${added} added. Use \`/rewind\` if this was wrong.`,
        display: true,
      }, { triggerTurn: false })
    }
    return event
  })

  pi.on('post_write', (event: any) => {
    const content = event.content || ''
    const lines = content.split('\n').length
    const file = event.path || 'unknown'
    totalAdded += lines; totalEdits++
    edits.push({ file, linesAdded: lines, linesRemoved: 0, timestamp: Date.now(), tool: 'write' })
    if (edits.length > 200) edits.shift()
    return event
  })

  pi.addCommand({ name: 'diffguard', description: 'Edit safety — stats and log',
    handler: async (args) => {
      const sub = args.trim().toLowerCase()
      if (sub === 'log') {
        const recent = edits.slice(-15).reverse()
        if (!recent.length) { pi.sendMessage({ content: 'No edits tracked yet.', display: true }, { triggerTurn: false }); return }
        const rows = recent.map(e => {
          const ago = Math.round((Date.now() - e.timestamp) / 1000)
          return `- ${ago}s ago — \`${e.file}\` +${e.linesAdded}/-${e.linesRemoved} (${e.tool})`
        })
        pi.sendMessage({ content: `## Edit Log\n\n${rows.join('\n')}`, display: true }, { triggerTurn: false })
        return
      }
      pi.sendMessage({ content: [
        '## Diff Guard',
        '', `**Total edits:** ${totalEdits}`,
        `**Lines added:** ${totalAdded}`, `**Lines removed:** ${totalRemoved}`,
        `**Net:** ${totalAdded - totalRemoved > 0 ? '+' : ''}${totalAdded - totalRemoved}`,
        `**Large deletion warnings:** ${largeDeleteWarnings}`,
        `**Files touched:** ${new Set(edits.map(e => e.file)).size}`,
      ].join('\n'), display: true }, { triggerTurn: false })
    }
  })

  pi.addTool({ name: 'diffguard_status', description: 'Show edit statistics — lines added/removed, warnings.',
    parameters: { type: 'object', properties: {} },
    handler: async () => `Edits: ${totalEdits} | +${totalAdded}/-${totalRemoved} lines | Warnings: ${largeDeleteWarnings}`
  })
}
