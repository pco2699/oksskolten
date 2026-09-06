import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Piscina as PiscinaPool } from 'piscina'
import { fetchHtml } from './http.js'
import { fetchViaFlareSolverr } from './flaresolverr.js'
import { MIN_ARTICLE_BODY_LENGTH } from '../lib/blocked-body.js'
import type { CleanerConfig } from '../lib/cleaner/selectors.js'
import type { ParseHtmlInput, ParseHtmlResult } from './contentWorker.js'

// Worker pool for CPU-intensive DOM parsing (jsdom + Readability + Turndown).
// Runs on separate threads so the main event loop stays responsive for API requests.
//
// Resolve the worker file by checking the filesystem rather than branching on
// NODE_ENV. The compiled .js exists only in production builds (dist-server/),
// while the .ts source is what's on disk under tsx dev. tsx's loader hooks
// don't intercept the Worker entry-point URL — it must point at a file that
// actually exists.
//
// JSDOM allocates 3-4 instances per parse, so each worker needs heap headroom
// for heavy pages (Reuters, Medium-class sites with large inline scripts).
// Use Worker resourceLimits.maxOldGenerationSizeMb instead of putting
// --max-old-space-size in execArgv: Node validates worker execArgv and rejects
// V8 memory flags.
const jsWorkerUrl = new URL('./contentWorker.js', import.meta.url)
const tsWorkerUrl = new URL('./contentWorker.ts', import.meta.url)
const workerUrl = fs.existsSync(fileURLToPath(jsWorkerUrl)) ? jsWorkerUrl : tsWorkerUrl

/**
 * Factory for the Piscina worker pool. Exported so integration tests can
 * spawn an isolated pool without colliding with the production-side
 * singleton in `getPool()`. Production code must always go through
 * `getPool()`, not call this directly, to avoid duplicate pools.
 */
export function createWorkerPool(): PiscinaPool {
  return new PiscinaPool({
    filename: workerUrl.href,
    execArgv: process.execArgv,
    resourceLimits: {
      maxOldGenerationSizeMb: 512,
    },
    maxThreads: Number(process.env.PARSE_MAX_THREADS) || 2,
    // Keep at least one warm worker. minThreads: 0 forced a cold spawn for the
    // first task in every sparse batch; the spawn-plus-parse latency could
    // approach the per-task timeout under load.
    minThreads: 1,
    idleTimeout: 30_000,
  })
}

let _pool: PiscinaPool | null = null

function getPool(): PiscinaPool {
  if (!_pool) _pool = createWorkerPool()
  return _pool
}

/** Per-task timeout for worker pool. */
const WORKER_TIMEOUT_MS = 45_000

/**
 * Run a worker task with a cancellable timeout. Unlike AbortSignal.timeout(),
 * the underlying timer is cleared once the task settles, so the abort listener
 * never fires after the promise resolves. Without this, Piscina's internal
 * abort cleanup occasionally produced unhandled-rejection noise long after
 * the batch had completed.
 */
async function runWithTimeout(input: ParseHtmlInput, timeoutMs: number): Promise<ParseHtmlResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error('Worker timeout')), timeoutMs)
  try {
    return await getPool().run(input, { signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Minimum character count for extracted article text to be considered valid.
 * Shared between fetchFullText (FlareSolverr retry) and fetchArticleContent (RSS fallback).
 */
export const MIN_EXTRACTED_LENGTH = MIN_ARTICLE_BODY_LENGTH

export interface FetchFullTextOptions {
  cleanerConfig?: CleanerConfig
  requiresJsChallenge?: boolean
}

export async function fetchFullText(articleUrl: string, options?: FetchFullTextOptions): Promise<ParseHtmlResult> {
  const cleanerConfig = options?.cleanerConfig
  const requiresJsChallenge = options?.requiresJsChallenge ?? false

  // Step 1: Fetch HTML. Async I/O, so it does not hold the event loop.
  const { html } = await fetchHtml(articleUrl, { useFlareSolverr: requiresJsChallenge })

  // Step 2: Everything CPU-bound happens in the worker — anchor extraction,
  // tag stripping, Readability, Turndown, and the quality checks below. The
  // raw body goes across as-is; `parseHtml` prepares it on the other side.
  const result = await runWithTimeout({ html, articleUrl, cleanerConfig }, WORKER_TIMEOUT_MS)

  // Step 3: FlareSolverr fallback if the extraction is too short or looks like
  // garbage. Both verdicts are computed in the worker and travel back as
  // `textLength` and `looksGarbage`, so deciding costs no scan of `fullText`
  // here. This function used to re-scan the extracted text on the event loop.
  const needsRetry = result.textLength < MIN_EXTRACTED_LENGTH || result.looksGarbage
  if (needsRetry && !requiresJsChallenge) {
    const flare = await fetchViaFlareSolverr(articleUrl, {
      waitForSelector: 'article, main, [role="main"], .post-content, .entry-content',
    })
    if (flare) {
      const flareResult = await runWithTimeout(
        { html: flare.body, articleUrl, cleanerConfig },
        WORKER_TIMEOUT_MS,
      )
      if (flareResult.textLength > result.textLength) {
        return flareResult
      }
    }
  }

  return result
}

// Re-export markdown and HTML-prep utilities so existing import sites don't break.
// These live in separate files to avoid circular dependency: contentWorker.ts
// imports from them, but content.ts creates the Piscina pool that loads contentWorker.ts.
export { convertHtmlToMarkdown, markdownToExcerpt } from './markdown-utils.js'
export { stripHeavyTags, extractAnchoredContentHtml } from './html-prep.js'
