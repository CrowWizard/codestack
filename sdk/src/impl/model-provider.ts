/**
 * Model provider abstraction for routing requests to the appropriate LLM provider.
 *
 * This module handles:
 * - Claude OAuth: Direct requests to Anthropic API using user's OAuth token
 * - ChatGPT OAuth: Direct requests to OpenAI API using user's OAuth token
 * - Default: Requests through Codebuff backend (which routes to OpenRouter)
 */

import path from 'path'

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import {
  loadCodestackConfig,
  getModelConfig,
} from '@codebuff/common/config/codestack-config'

import { getByokOpenrouterApiKeyFromEnv } from '../env'
import { BYOK_OPENROUTER_HEADER } from '@codebuff/common/constants/byok'
import { isFreeMode } from '@codebuff/common/constants/free-agents'
import {
  CHATGPT_BACKEND_BASE_URL,
  CHATGPT_OAUTH_ENABLED,
  isChatGptOAuthModelAllowed,
  isOpenAIProviderModel,
  toOpenAIModelId,
} from '@codebuff/common/constants/chatgpt-oauth'
import {
  CLAUDE_CODE_SYSTEM_PROMPT_PREFIX,
  CLAUDE_OAUTH_BETA_HEADERS,
  CLAUDE_OAUTH_ENABLED,
  isClaudeModel,
  toAnthropicModelId,
} from '@codebuff/common/constants/claude-oauth'
import {
  OpenAICompatibleChatLanguageModel,
  VERSION,
} from '@codebuff/internal/openai-compatible/index'
import { createOpenAICompatible } from '@codebuff/internal/openai-compatible/openai-compatible-provider'

import { WEBSITE_URL } from '../constants'
import {
  getValidChatGptOAuthCredentials,
  getValidClaudeOAuthCredentials,
} from '../credentials'

import {
  createChatGptBackendFetch,
  extractChatGptAccountId,
} from './chatgpt-backend-fetch'

import type { LanguageModel } from 'ai'

// ============================================================================
// Claude OAuth Rate Limit Cache
// ============================================================================

/** Timestamp (ms) when Claude OAuth rate limit expires, or null if not rate-limited */
let claudeOAuthRateLimitedUntil: number | null = null

/**
 * Mark Claude OAuth as rate-limited. Subsequent requests will skip Claude OAuth
 * and use Codebuff backend until the reset time.
 * @param resetAt - When the rate limit resets. If not provided, guesses 5 minutes from now.
 */
export function markClaudeOAuthRateLimited(resetAt?: Date): void {
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000
  claudeOAuthRateLimitedUntil = resetAt ? resetAt.getTime() : fiveMinutesFromNow
}

/**
 * Check if Claude OAuth is currently rate-limited.
 * Returns true if rate-limited and reset time hasn't passed.
 */
export function isClaudeOAuthRateLimited(): boolean {
  if (claudeOAuthRateLimitedUntil === null) {
    return false
  }
  if (Date.now() >= claudeOAuthRateLimitedUntil) {
    // Rate limit expired, clear the cache
    claudeOAuthRateLimitedUntil = null
    return false
  }
  return true
}

/**
 * Reset the Claude OAuth rate limit cache.
 * Call this when user reconnects their Claude subscription.
 */
export function resetClaudeOAuthRateLimit(): void {
  claudeOAuthRateLimitedUntil = null
}

// ============================================================================
// ChatGPT OAuth Rate Limit Cache
// ============================================================================

/** Timestamp (ms) when ChatGPT OAuth rate limit expires, or null if not rate-limited */
let chatGptOAuthRateLimitedUntil: number | null = null

/**
 * Mark ChatGPT OAuth as rate-limited. Subsequent requests will skip direct ChatGPT OAuth
 * and use Codebuff backend until the reset time.
 */
export function markChatGptOAuthRateLimited(resetAt?: Date): void {
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000
  chatGptOAuthRateLimitedUntil = resetAt
    ? resetAt.getTime()
    : fiveMinutesFromNow
}

/**
 * Check if ChatGPT OAuth is currently rate-limited.
 */
export function isChatGptOAuthRateLimited(): boolean {
  if (chatGptOAuthRateLimitedUntil === null) {
    return false
  }
  if (Date.now() >= chatGptOAuthRateLimitedUntil) {
    chatGptOAuthRateLimitedUntil = null
    return false
  }
  return true
}

/**
 * Reset the ChatGPT OAuth rate-limit cache.
 * Call this when user reconnects their ChatGPT subscription.
 */
export function resetChatGptOAuthRateLimit(): void {
  chatGptOAuthRateLimitedUntil = null
}

// ============================================================================
// Claude OAuth Quota Fetching
// ============================================================================

interface ClaudeQuotaWindow {
  utilization: number
  resets_at: string | null
}

interface ClaudeQuotaResponse {
  five_hour: ClaudeQuotaWindow | null
  seven_day: ClaudeQuotaWindow | null
  seven_day_oauth_apps: ClaudeQuotaWindow | null
  seven_day_opus: ClaudeQuotaWindow | null
}

/**
 * Fetch the rate limit reset time from Anthropic's quota API.
 * Returns the earliest reset time (whichever limit is more restrictive).
 * Returns null if fetch fails or no reset time is available.
 */
export async function fetchClaudeOAuthResetTime(accessToken: string): Promise<Date | null> {
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20,claude-code-20250219',
      },
    })

    if (!response.ok) {
      return null
    }

    const responseBody = await response.json()
    const data = responseBody as ClaudeQuotaResponse

    // Parse reset times
    const fiveHour = data.five_hour
    const sevenDay = data.seven_day

    const fiveHourRemaining = fiveHour ? Math.max(0, 100 - fiveHour.utilization) : 100
    const sevenDayRemaining = sevenDay ? Math.max(0, 100 - sevenDay.utilization) : 100

    // Return the reset time for whichever limit is more restrictive (lower remaining)
    if (fiveHourRemaining <= sevenDayRemaining && fiveHour?.resets_at) {
      return new Date(fiveHour.resets_at)
    } else if (sevenDay?.resets_at) {
      return new Date(sevenDay.resets_at)
    }

    return null
  } catch {
    return null
  }
}

/**
 * Parameters for requesting a model.
 */
export interface ModelRequestParams {
  /** Model ID (OpenRouter format, e.g., "anthropic/claude-sonnet-4") */
  model: string
  /** If true, skip Claude OAuth and use Codebuff backend (for fallback after rate limit) */
  skipClaudeOAuth?: boolean
  /** If true, skip ChatGPT OAuth and use Codebuff backend (for fallback after rate limit) */
  skipChatGptOAuth?: boolean
  /** Cost mode (e.g. 'free') — affects fallback behavior for OAuth routes */
  costMode?: string
  /**
 * Explicit, stable mapping key used to look up per-agent model overrides in Codestack.
 * This should be the agent template id (e.g. "basher", "file-picker", "editor-multi-prompt").
 */
  agentMappingKey?: string
  /**
   * Legacy identifier, often a runtime/run id. Kept for backwards compatibility.
   * Prefer agentMappingKey for mapping lookups.
   */
  agentId?: string
}

/**
 * Result from getModelForRequest.
 */
export interface ModelResult {
  /** The language model to use for requests */
  model: LanguageModel
  /** Whether this model uses Claude OAuth direct (affects cost tracking) */
  isClaudeOAuth: boolean
  /** Whether this model uses ChatGPT OAuth direct (affects cost tracking) */
  isChatGptOAuth: boolean
}

// Usage accounting type for OpenRouter/Codebuff backend responses
type OpenRouterUsageAccounting = {
  cost: number | null
  costDetails: {
    upstreamInferenceCost: number | null
  }
}

/**
 * Get the appropriate model for a request.
 *
 * If Claude OAuth credentials are available and the model is a Claude model,
 * returns an Anthropic direct model. Otherwise, returns the Codebuff backend model.
 * 
 * This function is async because it may need to refresh the OAuth token.
 */
export async function getModelForRequest(params: ModelRequestParams): Promise<ModelResult> {
  const { model, skipClaudeOAuth, skipChatGptOAuth, costMode } = params
  const resolvedModel = model

  if (!(isClaudeModel(model) || isOpenAIProviderModel(model) || isChatGptOAuthModelAllowed(model))) {
    return {
      model: createCodeStackDirectModel(resolvedModel),
      isClaudeOAuth: false,
      isChatGptOAuth: false,
    }
  }

  // Check if we should use Claude OAuth direct
  // Skip if feature disabled, explicitly requested, if rate-limited, or if not a Claude model
  if (CLAUDE_OAUTH_ENABLED && !skipClaudeOAuth && !isClaudeOAuthRateLimited() && isClaudeModel(model)) {
    // Get valid credentials (will refresh if needed)
    const claudeOAuthCredentials = await getValidClaudeOAuthCredentials()
    if (claudeOAuthCredentials) {
      return {
        model: createAnthropicOAuthModel(
          model,
          claudeOAuthCredentials.accessToken,
        ),
        isClaudeOAuth: true,
        isChatGptOAuth: false,
      }
    }
  }

  // Check if we should use ChatGPT OAuth direct
  // Only attempt for allowlisted models; non-allowlisted models silently fall through to backend.
  if (
    CHATGPT_OAUTH_ENABLED &&
    !skipChatGptOAuth &&
    isOpenAIProviderModel(model) &&
    isChatGptOAuthModelAllowed(model)
  ) {
    // In free mode, rate-limited ChatGPT OAuth must not silently fall through to
    // the Codebuff backend — freebuff should only use the direct OpenAI route or fail.
    if (isChatGptOAuthRateLimited()) {
      if (isFreeMode(costMode)) {
        throw new Error(
          'ChatGPT rate limit reached. Please wait a few minutes and try again.',
        )
      }
    } else {
      const chatGptOAuthCredentials = await getValidChatGptOAuthCredentials()

      if (chatGptOAuthCredentials) {
        return {
          model: createOpenAIOAuthModel(model, chatGptOAuthCredentials.accessToken),
          isClaudeOAuth: false,
          isChatGptOAuth: true,
        }
      }

      // In free mode, if credentials are unavailable, don't fall through to backend.
      if (isFreeMode(costMode)) {
        throw new Error(
          'ChatGPT OAuth credentials unavailable. Please reconnect with /connect:chatgpt.',
        )
      }
    }
  }

  // Default: use Codebuff backend (no longer supported without API key)
  throw new Error(
    `No API key configured for model "${model}". ` +
    `Please configure a provider key in ~/.config/manicode/config.json or connect an OAuth provider.`,
  )
}

/**
 * Create an OpenAI model that routes through the ChatGPT backend API (Codex endpoint).
 * Uses a custom fetch that transforms between Chat Completions and Responses API formats.
 */
function createOpenAIOAuthModel(model: string, oauthToken: string): LanguageModel {
  const openAIModelId = toOpenAIModelId(model)
  const accountId = extractChatGptAccountId(oauthToken)

  return new OpenAICompatibleChatLanguageModel(openAIModelId, {
    provider: 'openai',
    url: () => `${CHATGPT_BACKEND_BASE_URL}/codex/responses`,
    headers: () => ({
      Authorization: `Bearer ${oauthToken}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      accept: 'text/event-stream',
      'user-agent': `ai-sdk/openai-compatible/${VERSION}/codebuff-chatgpt-oauth`,
      ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
    }),
    fetch: createChatGptBackendFetch(),
    supportsStructuredOutputs: true,
    includeUsage: undefined,
  })
}

/**
 * Create an Anthropic model that uses OAuth Bearer token authentication.
 */
function createAnthropicOAuthModel(
  model: string,
  oauthToken: string,
): LanguageModel {
  // Convert OpenRouter model ID to Anthropic model ID
  const anthropicModelId = toAnthropicModelId(model)

  // Create Anthropic provider with custom fetch to use Bearer token auth
  // Custom fetch to handle OAuth Bearer token authentication and system prompt transformation
  const customFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers)

    // Remove the x-api-key header that the SDK adds
    headers.delete('x-api-key')

    // Add Bearer token authentication (for OAuth)
    headers.set('Authorization', `Bearer ${oauthToken}`)

    // Add required beta headers for OAuth (same as opencode)
    // These beta headers are required to access Claude 4+ models with OAuth
    const existingBeta = headers.get('anthropic-beta') ?? ''
    const betaList = existingBeta
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean)
    const mergedBetas = [
      ...new Set([...CLAUDE_OAUTH_BETA_HEADERS, ...betaList]),
    ].join(',')
    headers.set('anthropic-beta', mergedBetas)

    // Transform the request body to use the correct system prompt format for Claude OAuth
    // Anthropic requires the system prompt to be split into two separate blocks:
    // 1. First block: Claude Code identifier (required for OAuth access)
    // 2. Second block: The actual system prompt (if any)
    let modifiedInit = init
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body)
        // Always inject the Claude Code identifier for OAuth requests
        // Extract existing system prompt if present
        const existingSystem = body.system
          ? Array.isArray(body.system)
            ? body.system
              .map(
                (s: { text?: string; content?: string }) =>
                  s.text ?? s.content ?? '',
              )
              .join('\n\n')
            : typeof body.system === 'string'
              ? body.system
              : ''
          : ''

        // Build the system array with Claude Code identifier first
        body.system = [
          {
            type: 'text',
            text: CLAUDE_CODE_SYSTEM_PROMPT_PREFIX,
          },
          // Only add second block if there's actual content
          ...(existingSystem
            ? [
              {
                type: 'text',
                text: existingSystem,
              },
            ]
            : []),
        ]
        modifiedInit = { ...init, body: JSON.stringify(body) }
      } catch {
        // If parsing fails, continue with original body
      }
    }

    return globalThis.fetch(input, {
      ...modifiedInit,
      headers,
    })
  }

  // Pass empty apiKey like opencode does - this prevents the SDK from adding x-api-key header
  // The custom fetch will add the Bearer token instead
  const anthropic = createAnthropic({
    apiKey: '',
    fetch: customFetch as unknown as typeof globalThis.fetch,
  })

  // Cast to LanguageModel since the AI SDK types may be slightly different versions
  // Using unknown as intermediate to handle V2 vs V3 differences
  return anthropic(anthropicModelId) as unknown as LanguageModel
}

// ============================================================================
// Codestack BYOK Direct Provider Routing
// ============================================================================

type ProviderConfig = {
  key: string
  baseURL?: string
  style?: 'openai' | 'openai-completions' | 'anthropic' | 'google'
  headers?: Record<string, string>
}

function getProviderName(model: string): string {
  const slashIdx = model.indexOf('/')
  if (slashIdx === -1) return model
  return model.substring(0, slashIdx)
}

function getModelId(model: string): string {
  const slashIdx = model.indexOf('/')
  if (slashIdx === -1) return model
  return model.substring(slashIdx + 1)
}

function getCodestackProviderConfig(model: string): ProviderConfig | undefined {
  // Use shared config loader from common (Zod-validated with env-var interpolation)
  const config = loadCodestackConfig()
  const keys = config.keys ?? {}
  const providerName = getProviderName(model)
  const providerValue = keys[providerName]

  if (!providerValue) return undefined

  // Object config (custom provider)
  if (typeof providerValue === 'object' && providerValue !== null) {
    return {
      key: (providerValue as { key?: string }).key ?? '',
      baseURL: (providerValue as { baseURL?: string }).baseURL,
      style: ((providerValue as { style?: string }).style ?? 'openai') as
        | 'openai'
        | 'openai-completions'
        | 'anthropic'
        | 'google',
      headers: (providerValue as { headers?: Record<string, string> }).headers,
    }
  }

  return undefined
}

function createCodeStackDirectModel(model: string): LanguageModel {
  const providerConfig = getCodestackProviderConfig(model)
  const modelId = getModelId(model)

  if (!providerConfig || !providerConfig.key) {
    const providerName = getProviderName(model)
    throw new Error(
      `No API key configured for provider "${providerName}" (model: "${model}"). ` +
      `Add "${providerName}" to the "keys" section of ~/.config/maincode/config.json.`,
    )
  }

  const { key: apiKey, baseURL, style = 'openai', headers } = providerConfig
  const providerName = getProviderName(model)

  // Get model-specific configuration (extraBody, max_tokens)
  // Note: temperature, top_p, top_k are handled in llm.ts via providerOptions for all providers
  const modelConfig = getModelConfig(model)
  const extraBody = modelConfig?.extraBody
  const maxTokens = modelConfig?.max_tokens

  // Merge max_tokens into extraBody if configured
  // This ensures providers like Nvidia NIM get the correct max_tokens in the request
  const mergedExtraBody = maxTokens
    ? { ...extraBody, max_tokens: maxTokens }
    : extraBody

  if (style === 'anthropic') {
    const anthropicModelId = baseURL ? modelId : toAnthropicModelId(model)
    const anthropic = createAnthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    })
    // Note: Anthropic SDK doesn't support passing temperature/topP/topK at model creation time.
    // These settings are passed at request time via the model's second argument in streamText/generateText.
    // For BYOK mode, we store these in modelConfig and apply them in llm.ts providerOptions.
    return anthropic(anthropicModelId) as unknown as LanguageModel
  }

  const resolvedBaseURL = baseURL || 'https://api.openai.com/v1'
  if (style === 'openai-completions') {
    const customProvider = createOpenAICompatible({
      baseURL: resolvedBaseURL,
      name: providerName,
      apiKey,
      headers,
    })
    return customProvider.chatModel(modelId) as unknown as LanguageModel
  }

  // For standard OpenAI style, use OpenAI-compatible model to avoid version conflicts
  // This works with any OpenAI-compatible API and avoids AI SDK v5 version constraints
  return new OpenAICompatibleChatLanguageModel(modelId, {
    provider: providerName,
    url: () => `${resolvedBaseURL}/chat/completions`,
    headers: () => ({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    }),
    ...(mergedExtraBody ? { extraBody: mergedExtraBody } : {}),
    supportsStructuredOutputs: true,
    includeUsage: true,
  }) as unknown as LanguageModel
}

