import type { StreamStatus } from '../hooks/use-message-queue'

export type StatusIndicatorState =
  | { kind: 'idle' }
  | { kind: 'clipboard'; message: string }
  | { kind: 'ctrlC' }
  | { kind: 'connecting' }
  | { kind: 'retrying' }
  | { kind: 'waiting' }
  | { kind: 'streaming' }
  | { kind: 'reconnected' }
  | { kind: 'paused' }


export type StatusIndicatorStateArgs = {
  statusMessage?: string | null
  streamStatus: StreamStatus
  nextCtrlCWillExit: boolean
  isRetrying?: boolean
  /**
   * Whether to show a transient "Reconnected" status message.
   * This should only be true for a short period after a reconnection event.
   */
  /**
   * Whether the ask_user tool is currently active (waiting for user input).
   * When true, hides the "working..." and "thinking..." indicators.
   */
  isAskUserActive?: boolean
}

/**
 * Determines the status indicator state based on current context.
 *
 * State priority (highest to lowest):
 * 1. nextCtrlCWillExit - User pressed Ctrl+C once, warn about exit
 * 2. statusMessage - Temporary feedback for clipboard operations
 * 3. connecting - Not connected to backend
 * 4. waiting - Waiting for AI response to start
 * 5. streaming - AI is actively responding
 * 6. idle - No activity
 *
 * @param args - Context for determining indicator state
 * @returns The appropriate state indicator
 */
export const getStatusIndicatorState = ({
  statusMessage,
  streamStatus,
  nextCtrlCWillExit,
  isRetrying = false,
  isAskUserActive = false,
}: StatusIndicatorStateArgs): StatusIndicatorState => {
  if (nextCtrlCWillExit) {
    return { kind: 'ctrlC' }
  }

  if (statusMessage) {
    return { kind: 'clipboard', message: statusMessage }
  }

  // If we're online but the auth request hit a retryable error and is auto-retrying,
  // surface that explicitly to the user.
  if (isRetrying) {
    return { kind: 'retrying' }
  }

  // Show paused state when ask_user is active (timer stays visible but frozen)
  if (isAskUserActive) {
    return { kind: 'paused' }
  }

  if (streamStatus === 'waiting') {
    return { kind: 'waiting' }
  }

  if (streamStatus === 'streaming') {
    return { kind: 'streaming' }
  }

  return { kind: 'idle' }
}
