/** Stable, occurrence-preserving line merge for report text fields. */
export function mergeSignature(source, target) {
  return JSON.stringify([String(source ?? ''), String(target ?? '')])
}

export function mergeClearToken(merge) {
  return JSON.stringify([merge?.signature ?? '', String(merge?.text ?? '')])
}

export function buildLineMerge(source, target, previous) {
  const signature = mergeSignature(source, target)
  if (previous?.signature === signature && Array.isArray(previous.lines)) return { ...previous, lines: previous.lines.map(line => ({ ...line })) }
  const left = String(source ?? '').split('\n')
  const right = String(target ?? '').split('\n')
  const rows = left.length * right.length <= 250000 ? lcs(left, right) : simpleAlignment(left, right)
  const lines = []
  for (const row of rows) lines.push({ ...row, keep: row.side !== 'source' })
  return { signature, lines, text: lines.filter(line => line.keep).map(line => line.text).join('\n'), edited: false }
}

export function lineMergeText(lines) {
  return lines.filter(line => line.keep).map(line => String(line.text ?? '')).join('\n')
}

export function regenerateLineMerge(merge) {
  return { ...merge, text: lineMergeText(merge.lines), edited: false }
}

function lcs(source, target) {
  const rows = source.length + 1, cols = target.length + 1
  const table = Array.from({ length: rows }, () => new Uint32Array(cols))
  for (let i = source.length - 1; i >= 0; i--) for (let j = target.length - 1; j >= 0; j--) {
    table[i][j] = source[i] === target[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  }
  const out = []; let i = 0, j = 0
  while (i < source.length || j < target.length) {
    if (i < source.length && j < target.length && source[i] === target[j]) {
      out.push({ side: 'common', text: source[i++] }); j++; continue
    }
    const startI = i, startJ = j
    while (i < source.length && j < target.length && source[i] !== target[j]) {
      if (table[i + 1][j] >= table[i][j + 1]) i++; else j++
    }
    for (let k = startJ; k < j; k++) out.push({ side: 'target', text: target[k] })
    for (let k = startI; k < i; k++) out.push({ side: 'source', text: source[k] })
    if (i === startI && j === startJ) {
      if (i < source.length) out.push({ side: 'source', text: source[i++] })
      else if (j < target.length) out.push({ side: 'target', text: target[j++] })
    }
  }
  return out
}

function simpleAlignment(source, target) {
  const out = [], shared = new Map()
  for (const line of target) shared.set(line, (shared.get(line) || 0) + 1)
  const remaining = new Map(shared)
  for (const line of source) {
    const count = remaining.get(line) || 0
    if (count) { out.push({ side: 'common', text: line }); remaining.set(line, count - 1) }
    else out.push({ side: 'source', text: line })
  }
  const sourceCounts = new Map(); for (const line of source) sourceCounts.set(line, (sourceCounts.get(line) || 0) + 1)
  for (const line of target) { const count = sourceCounts.get(line) || 0; if (count) sourceCounts.set(line, count - 1); else out.push({ side: 'target', text: line }) }
  return out
}
