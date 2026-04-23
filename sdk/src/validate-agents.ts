import {
  validateAgents as validateAgentsCommon,
  type DynamicAgentValidationError,
} from '@codebuff/common/templates/agent-validation'

import type { AgentDefinition } from '@codebuff/common/templates/initial-agents-dir/types/agent-definition'

export interface ValidationResult {
  success: boolean
  validationErrors: Array<{
    id: string
    message: string
  }>
  errorCount: number
}

/**
 * Validates an array of agent definitions.
 * @param definitions - Array of agent definitions to validate
 * @param options - Optional configuration for validation
 * @returns Promise<ValidationResult> - Validation results with any errors
 */
export async function validateAgents(
  definitions: AgentDefinition[],
): Promise<ValidationResult> {
  // Convert array of definitions to Record<string, AgentDefinition> format
  // that the common validation functions expect
  // Use index as key to preserve all entries (including duplicates)
  const agentTemplates: Record<string, AgentDefinition> = {}
  for (const [index, definition] of definitions.entries()) {
    // Handle null/undefined gracefully
    if (!definition) {
      agentTemplates[`agent_${index}`] = definition
      continue
    }
    // Use index to ensure duplicates aren't overwritten
    const key = definition.id ? `${definition.id}_${index}` : `agent_${index}`
    agentTemplates[key] = definition
  }

  // Simple logger implementation for common validation functions
  const logger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
  }

  let validationErrors: DynamicAgentValidationError[] = []

  // Local validation: use common package validation logic
  const result = validateAgentsCommon({
    agentTemplates,
    logger,
  })

  validationErrors = result.validationErrors

  // Transform validation errors to the SDK format
  const transformedErrors = validationErrors.map((error) => ({
    id: error.filePath ?? 'unknown',
    message: error.message,
  }))

  return {
    success: transformedErrors.length === 0,
    validationErrors: transformedErrors,
    errorCount: transformedErrors.length,
  }
}
