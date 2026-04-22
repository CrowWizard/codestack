import { endFreebuffSessionBestEffort } from '../hooks/use-freebuff-session'
import { withTimeout } from './terminal-color-detection'

/** Cap on exit cleanup so a slow network doesn't block process exit. */
const EXIT_CLEANUP_TIMEOUT_MS = 1_000

/**
 * Release the freebuff seat (best-effort), then exit 0.
 * Shared by every freebuff-specific screen's Ctrl+C / X handler so they all
 * run the same cleanup.
 */
export async function exitFreebuffCleanly(): Promise<never> {
  await withTimeout(
    Promise.allSettled([endFreebuffSessionBestEffort()]),
    EXIT_CLEANUP_TIMEOUT_MS,
    undefined,
  )
  process.exit(0)
}
