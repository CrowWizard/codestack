import { validateSingleAgent } from '@codebuff/common/templates/agent-validation'
import { DynamicAgentTemplateSchema } from '@codebuff/common/types/dynamic-agent-template'
import { getErrorObject } from '@codebuff/common/util/error'
import z from 'zod/v4'

import { WEBSITE_URL } from '../constants'
import {
  createAuthError,
  createNetworkError,
  createServerError,
  createHttpError,
  isRetryableStatusCode,
} from '../error-utils'
import {
  MAX_RETRIES_PER_MESSAGE,
  RETRY_BACKOFF_BASE_DELAY_MS,
  RETRY_BACKOFF_MAX_DELAY_MS,
} from '../retry-config'

import type {
  AddAgentStepFn,
  FetchAgentFromDatabaseFn,
  FinishAgentRunFn,
  GetUserInfoFromApiKeyInput,
  GetUserInfoFromApiKeyOutput,
  StartAgentRunFn,
  UserColumn,
} from '@codebuff/common/types/contracts/database'
import type { DynamicAgentTemplate } from '@codebuff/common/types/dynamic-agent-template'
import type { ParamsOf } from '@codebuff/common/types/function-params'

type CachedUserInfo = Partial<
  NonNullable<Awaited<GetUserInfoFromApiKeyOutput<UserColumn>>>
>

const userInfoCache: Record<
  string,
  CachedUserInfo | null
> = {}

const agentsResponseSchema = z.object({
  version: z.string(),
  data: DynamicAgentTemplateSchema,
})

/**
 * Fetch with retry logic for transient errors (502, 503, etc.)
 * Implements exponential backoff between retries.
 */
async function fetchWithRetry(
  url: URL | string,
  options: RequestInit,
  logger?: { warn: (obj: object, msg: string) => void },
): Promise<Response> {
  let lastError: Error | null = null
  let backoffDelay = RETRY_BACKOFF_BASE_DELAY_MS

  for (let attempt = 0; attempt <= MAX_RETRIES_PER_MESSAGE; attempt++) {
    try {
      const response = await fetch(url, options)

      // If response is OK or not retryable, return it
      if (response.ok || !isRetryableStatusCode(response.status)) {
        return response
      }

      // Retryable error - log and continue to retry
      if (attempt < MAX_RETRIES_PER_MESSAGE) {
        logger?.warn(
          { status: response.status, attempt: attempt + 1, url: String(url) },
          `Retryable HTTP error, retrying in ${backoffDelay}ms`,
        )
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        backoffDelay = Math.min(backoffDelay * 2, RETRY_BACKOFF_MAX_DELAY_MS)
      } else {
        // Last attempt, return the response even if it's an error
        return response
      }
    } catch (error) {
      // Network-level error (DNS, connection refused, etc.)
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < MAX_RETRIES_PER_MESSAGE) {
        logger?.warn(
          { error: getErrorObject(lastError), attempt: attempt + 1, url: String(url) },
          `Network error, retrying in ${backoffDelay}ms`,
        )
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        backoffDelay = Math.min(backoffDelay * 2, RETRY_BACKOFF_MAX_DELAY_MS)
      }
    }
  }

  // All retries exhausted - throw the last error
  throw lastError ?? new Error('Request failed after retries')
}

export async function fetchAgentFromDatabase(
  params: ParamsOf<FetchAgentFromDatabaseFn>,
): ReturnType<FetchAgentFromDatabaseFn> {
  const { parsedAgentId, logger } = params
  const { publisherId, agentId, version } = parsedAgentId

  const url = new URL(
    `/api/v1/agents/${publisherId}/${agentId}/${version ? version : 'latest'}`,
    WEBSITE_URL,
  )

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      logger,
    )

    if (!response.ok) {
      logger.error({ response }, 'fetchAgentFromDatabase request failed')
      return null
    }

    const responseJson = await response.json()
    const parseResult = agentsResponseSchema.safeParse(responseJson)
    if (!parseResult.success) {
      logger.error(
        { responseJson, parseResult },
        `fetchAgentFromDatabase parse error`,
      )
      return null
    }

    const agentConfig = parseResult.data
    const rawAgentData = agentConfig.data as DynamicAgentTemplate

    // Validate the raw agent data with the original agentId (not full identifier)
    const validationResult = validateSingleAgent({
      template: { ...rawAgentData, id: agentId, version: agentConfig.version },
      filePath: `${publisherId}/${agentId}@${agentConfig.version}`,
    })

    if (!validationResult.success) {
      logger.error(
        {
          publisherId,
          agentId,
          version: agentConfig.version,
          error: validationResult.error,
        },
        'fetchAgentFromDatabase: Agent validation failed',
      )
      return null
    }

    // Set the correct full agent ID for the final template
    const agentTemplate = {
      ...validationResult.agentTemplate!,
      id: `${publisherId}/${agentId}@${agentConfig.version}`,
    }

    logger.debug(
      {
        publisherId,
        agentId,
        version: agentConfig.version,
        fullAgentId: agentTemplate.id,
        parsedAgentId,
      },
      'fetchAgentFromDatabase: Successfully loaded and validated agent from database',
    )

    return agentTemplate
  } catch (error) {
    logger.error(
      { error: getErrorObject(error), parsedAgentId },
      'fetchAgentFromDatabase error',
    )
    return null
  }
}

export async function startAgentRun(
  params: ParamsOf<StartAgentRunFn>,
): ReturnType<StartAgentRunFn> {
  const { agentId, logger } = params

  try {
    return crypto.randomUUID()
  } catch (error) {
    logger.error(
      { error: getErrorObject(error), agentId },
      'startAgentRun error',
    )
    return null
  }
}

export async function finishAgentRun(
  params: ParamsOf<FinishAgentRunFn>,
): ReturnType<FinishAgentRunFn> {
}

export async function addAgentStep(
  params: ParamsOf<AddAgentStepFn>,
): ReturnType<AddAgentStepFn> {
  const {
    agentRunId,
    stepNumber,
    credits,
    childRunIds,
    messageId,
    status = 'completed',
    errorMessage,
    startTime,
    logger,
  } = params

  try {
    return crypto.randomUUID()
  } catch (error) {
    logger.error(
      {
        error: getErrorObject(error),
        agentRunId,
        stepNumber,
        credits,
        childRunIds,
        messageId,
        status,
        errorMessage,
        startTime,
      },
      'addAgentStep error',
    )
    return null
  }
}
