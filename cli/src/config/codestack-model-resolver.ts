import type { CostMode } from './codestack-config'
import type { Model } from '@codebuff/common/constants/model-config'

import { loadCodestackConfig } from './codestack-config'

/**
 * CLI model resolver - throws on configuration errors.
 *
 * Use for direct model resolution where config errors should halt execution.
 * Checks for agent-specific mapping first, then falls back to 'base'.
 *
 * @param costMode - The cost mode (free, normal, max, experimental, ask)
 * @param agentId - The agent ID to look up (optional, falls back to 'base' if not provided)
 * @returns The model string
 * @throws Error if no mapping exists for the mode or no 'base' is configured
 *
 * @note This differs from SDK's resolveCodestackModel which returns null to allow
 * graceful fallback to passed model in getModelForRequest.
 */
export function resolveModelForMode(
  costMode: CostMode,
  agentId?: string,
): Model {
  const config = loadCodestackConfig()

  const modeMapping = config.mapping?.[costMode]
  if (!modeMapping) {
    throw new Error(
      `No model configured for mode "${costMode}" in codestack config. ` +
        `Add a "${costMode}" entry to the "mapping" section of ~/.config/codestack/config.json.`,
    )
  }

  // Check for agent-specific mapping first
  // Strip version suffix (e.g., "file-picker@1.0.0" -> "file-picker")
  if (agentId) {
    const baseAgentId = agentId.split('@')[0]
    if (modeMapping[baseAgentId]) {
      return modeMapping[baseAgentId]
    }
  }

  // Fall back to 'base' as the default model
  const baseModel = modeMapping['base']
  if (!baseModel) {
    throw new Error(
      `No "base" model configured for mode "${costMode}". ` +
        `Add "base" to the "${costMode}" mapping in ~/.config/codestack/config.json.`,
    )
  }

  return baseModel
}

/**
 * Safe version that throws a more descriptive error.
 *
 * @param costMode - The cost mode
 * @param agentId - The agent ID (optional)
 * @returns The model string
 * @throws Error with descriptive message on failure
 */
export function resolveModelForModeSafe(
  costMode: CostMode,
  agentId?: string,
): Model {
  try {
    return resolveModelForMode(costMode, agentId)
  } catch (error) {
    // Rethrow instead of falling back to Codebuff defaults —
    // Codebuff's getModelForMode returns openrouter models that won't work
    // without a Codebuff API key, which codestack doesn't have.
    throw new Error(
      `Codestack model resolution failed for mode "${costMode}"${agentId ? `, agent "${agentId}"` : ''}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
