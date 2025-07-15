import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { visit } from 'unist-util-visit'

/**
 * Remark plugin to resolve reference-style links from global.md
 */
export function remarkGlobalReferences() {
  let globalRefs: Record<string, string> | null = null

  function loadGlobalReferences() {
    if (globalRefs !== null) return globalRefs

    try {
      const globalMdPath = join(
        process.cwd(),
        'src/content/references/global.md',
      )
      const content = readFileSync(globalMdPath, 'utf-8')

      globalRefs = {}

      // Parse reference-style link definitions: [label]: url
      const lines = content.split('\n')
      for (const line of lines) {
        const match = line.match(/^\[([^\]]+)\]:\s*(.+)$/)
        if (match) {
          const [, label, url] = match
          globalRefs[label] = url.trim()
        }
      }

      console.log('Loaded global references:', globalRefs)
      return globalRefs
    } catch (error: any) {
      console.warn('Could not load global.md references:', error.message)
      globalRefs = {}
      return globalRefs
    }
  }

  return function transformer(tree: any) {
    const refs = loadGlobalReferences()

    // Find all reference-style links in the format [text][]
    visit(tree, 'linkReference', (node) => {
      if (
        node.referenceType === 'shortcut' ||
        node.referenceType === 'collapsed'
      ) {
        const label = node.label || node.children?.[0]?.value

        if (label && refs[label]) {
          // Convert linkReference to a regular link
          node.type = 'link'
          node.url = refs[label]
          delete node.referenceType
          delete node.identifier
          delete node.label

          console.log(`Resolved reference [${label}][] to ${refs[label]}`)
        }
      }
    })

    // Also look for escaped reference-style links in text nodes: \[label]\[]
    visit(tree, 'text', (node, index, parent) => {
      if (!node.value) return

      // Find escaped reference-style links: \[label]\[]
      const pattern = /\\?\[([^\]]+)\\?\]\\?\[\]/g
      const replacements = []
      let match: RegExpExecArray | null = null

      match = pattern.exec(node.value)
      while (match !== null) {
        const [fullMatch, label] = match
        if (refs[label]) {
          replacements.push({
            start: match.index,
            end: match.index + fullMatch.length,
            label,
            url: refs[label],
          })
          console.log(`Found escaped reference ${fullMatch} -> ${refs[label]}`)
        }
        match = pattern.exec(node.value)
      }

      // Apply replacements from right to left to maintain indices
      if (replacements.length > 0) {
        const newNodes = []
        let lastIndex = 0

        for (const replacement of replacements) {
          // Add text before the replacement
          if (replacement.start > lastIndex) {
            newNodes.push({
              type: 'text',
              value: node.value.slice(lastIndex, replacement.start),
            })
          }

          // Add the link
          newNodes.push({
            type: 'link',
            url: replacement.url,
            children: [{ type: 'text', value: replacement.label }],
          })

          lastIndex = replacement.end
        }

        // Add remaining text
        if (lastIndex < node.value.length) {
          newNodes.push({
            type: 'text',
            value: node.value.slice(lastIndex),
          })
        }

        // Replace the current node with the new nodes
        if (parent && typeof index === 'number') {
          parent.children.splice(index, 1, ...newNodes)
        }
      }
    })
  }
}
