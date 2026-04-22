import type { Logger } from './logger'

/**
 * Properties that can be tracked with an event.
 */
export type EventProperties = Record<string, unknown>

/**
 * Signature for the trackEvent function used in agent runtime.
 * This is a more structured version that includes userId and logger.
 */
export type TrackEventFn = (params: {
  event: string
  userId: string
  properties?: EventProperties
  logger: Logger
}) => void
