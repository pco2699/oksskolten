/**
 * Print a snapshot of how the engagement score is currently distributed.
 *
 * Read-only: safe to run while the server holds the database open (WAL allows
 * concurrent readers). Save the JSON form before changing anything about
 * scoring — it is the only reference a later change can be measured against.
 *
 *   npm run score:baseline                        # human-readable report
 *   npm run score:baseline -- --json              # JSON to stdout
 *   npm run score:baseline -- --out baseline.json # JSON to a file
 */
import { writeFileSync } from 'node:fs'
import { collectScoreBaseline } from '../server/db/score-stats.js'
import type { Distribution, ScoreBaseline } from '../server/db/score-stats.js'

function num(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return '-'
  return v.toFixed(digits)
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join('  ')
  return [line(headers), widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n')
}

function distributionRow(label: string, d: Distribution, digits = 2): string[] {
  return [
    label,
    String(d.count),
    num(d.min, digits),
    num(d.p10, digits),
    num(d.p25, digits),
    num(d.p50, digits),
    num(d.p75, digits),
    num(d.p90, digits),
    num(d.p99, digits),
    num(d.max, digits),
    num(d.mean, digits),
  ]
}

function render(b: ScoreBaseline): string {
  const out: string[] = []
  const { corpus, score } = b

  out.push(`Engagement score baseline — ${b.generated_at}`)
  out.push('')

  out.push('## Corpus')
  out.push(table(
    ['metric', 'articles', 'share'],
    [
      ['active', String(corpus.total), pct(1)],
      ['unread (read_at IS NULL)', String(corpus.unread), pct(corpus.unread / (corpus.total || 1))],
      ['unseen (seen_at IS NULL)', String(corpus.unseen), pct(corpus.unseen / (corpus.total || 1))],
      ['liked', String(corpus.liked), pct(corpus.liked / (corpus.total || 1))],
      ['bookmarked', String(corpus.bookmarked), pct(corpus.bookmarked / (corpus.total || 1))],
      ['translated', String(corpus.translated), pct(corpus.translated / (corpus.total || 1))],
      ['engaged (any signal)', String(corpus.engaged), pct(corpus.engaged / (corpus.total || 1))],
    ],
  ))
  out.push('')

  out.push('## Score coverage')
  out.push(`score = 0:            ${score.zero} of ${corpus.total} (${pct(score.zero_share)})`)
  out.push(`score > 0:            ${score.nonzero}`)
  out.push(`distinct score values: ${score.distinct_values}`)
  out.push(`unengaged yet score > 0: ${score.unengaged_nonzero}  (stale rows the recalc cron has not reached)`)
  out.push('')
  out.push(table(
    ['score range', 'articles', 'share'],
    score.buckets.map(bk => [
      bk.to === 0 ? '= 0' : bk.to === null ? `>= ${bk.from}` : `${bk.from} – ${bk.to}`,
      String(bk.articles),
      pct(bk.share),
    ]),
  ))
  out.push('')

  out.push('## Raw engagement (before decay)')
  out.push(table(
    ['engagement', 'articles', 'share'],
    b.engagement.map(e => [String(e.engagement), String(e.articles), pct(e.share)]),
  ))
  out.push('')

  out.push('## Distributions')
  out.push(table(
    ['series', 'n', 'min', 'p10', 'p25', 'p50', 'p75', 'p90', 'p99', 'max', 'mean'],
    [
      distributionRow('score (non-zero)', score.nonzero_distribution, 3),
      distributionRow('days since activity', b.days_since_activity, 1),
      distributionRow('decay factor', b.decay, 3),
    ],
  ))
  out.push('')

  out.push('## Candidate windows (what a ranker would sort)')
  out.push(table(
    ['window', 'articles', 'unread', 'score = 0', 'share', 'distinct scores'],
    b.candidate_windows.map(w => [
      w.hours < 48 ? `${w.hours}h` : `${w.hours / 24}d`,
      String(w.articles),
      String(w.unread),
      String(w.zero_score),
      pct(w.zero_score_share),
      String(w.distinct_scores),
    ]),
  ))
  out.push('')

  out.push('## Stored vs freshly computed score')
  out.push(`compared:      ${b.drift.articles} articles`)
  out.push(`mean abs diff: ${num(b.drift.mean_abs, 4)}`)
  out.push(`max abs diff:  ${num(b.drift.max_abs, 4)}`)
  out.push(`off by >1%:    ${b.drift.over_tolerance}`)

  return out.join('\n')
}

function main(): void {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const outIndex = args.indexOf('--out')
  const outPath = outIndex >= 0 ? args[outIndex + 1] : null

  if (outIndex >= 0 && !outPath) {
    console.error('--out requires a file path')
    process.exit(1)
  }

  const baseline = collectScoreBaseline()
  const json = JSON.stringify(baseline, null, 2)

  if (outPath) {
    writeFileSync(outPath, `${json}\n`)
    console.error(`Wrote baseline to ${outPath}`)
  }
  console.log(asJson ? json : render(baseline))
}

main()
