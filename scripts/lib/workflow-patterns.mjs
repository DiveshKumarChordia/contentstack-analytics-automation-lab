/**
 * Workflow stage-transition "walk patterns" — shared by seed-workflows.mjs and
 * branch-lifecycle.mjs so both drive the SAME mix of transition shapes.
 *
 * A pattern maps a workflow's stage count to an ordered list of stage indices
 * to step through (repetitions allowed). Picked per entry by weight.
 *
 *   linear        — every stage in order (Draft→Review→Approved): most transitions.
 *   skip          — jump first→last in one transit ("approved on first review").
 *   rework        — 0→1→0→1→final: back-and-forth "needs revisions"; toggles a
 *                   stage twice so "Stalled by Stage" picks it up.
 *   partialStall  — walk to a middle stage and stop (entry sits there).
 *   firstOnly     — assign the first stage only (emits stage_added, no progress).
 */

export function planWalkIndices(stageCount, pattern) {
  if (stageCount <= 0) return []
  const last = stageCount - 1
  const mid = Math.min(Math.max(1, Math.floor(stageCount / 2)), last)
  switch (pattern) {
    case 'linear':
      return Array.from({ length: stageCount }, (_, i) => i)
    case 'skip':
      return stageCount >= 2 ? [0, last] : [0]
    case 'rework': {
      if (stageCount < 3) return [0, last]
      const seq = [0, 1, 0, 1]
      if (last > 1) seq.push(last)
      return seq
    }
    case 'partialStall':
      return [0, mid]
    case 'firstOnly':
      return [0]
    default:
      return [0]
  }
}

export const DEFAULT_PATTERN_WEIGHTS = {
  linear: 0.3,
  skip: 0.15,
  rework: 0.15,
  partialStall: 0.25,
  firstOnly: 0.15,
}

/** Pick a key from { key: weight } proportionally to its weight. */
export function pickWeighted(distribution, rng) {
  const entries = Object.entries(distribution)
  const total = entries.reduce((a, [, w]) => a + w, 0)
  if (total <= 0) return entries[0]?.[0]
  const r = rng() * total
  let acc = 0
  for (const [key, w] of entries) {
    acc += w
    if (r <= acc) return key
  }
  return entries[entries.length - 1][0]
}

/** Small deterministic PRNG so a run is reproducible from a seed. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Is this the workflow's terminal/approved stage (where publish rules fire)? */
export function isApprovedStageName(name) {
  return ['Approved', 'Ready to Publish', 'Done', 'Published'].includes(name)
}
