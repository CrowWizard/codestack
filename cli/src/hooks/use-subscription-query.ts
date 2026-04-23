import { useActivityQuery } from './use-activity-query'
import { getAuthToken } from '../utils/auth'
import { logger as defaultLogger } from '../utils/logger'

import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { SubscriptionResponse } from '@codebuff/common/types/subscription'

export type { SubscriptionResponse }

export const subscriptionQueryKeys = {
  all: ['subscription'] as const,
  current: () => [...subscriptionQueryKeys.all, 'current'] as const,
}

export interface UseSubscriptionQueryDeps {
  logger?: Logger
  enabled?: boolean
  refetchInterval?: number | false
  refetchOnActivity?: boolean
  pauseWhenIdle?: boolean
  idleThreshold?: number
}

export function useSubscriptionQuery(deps: UseSubscriptionQueryDeps = {}) {
  const {
    logger = defaultLogger,
    enabled = true,
    refetchInterval = 60 * 1000,
    refetchOnActivity = true,
    pauseWhenIdle = true,
    idleThreshold = 30_000,
  } = deps

  const authToken = getAuthToken()

  return useActivityQuery({
    queryKey: subscriptionQueryKeys.current(),
    enabled: enabled && !!authToken,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnMount: true,
    refetchInterval,
    refetchOnActivity,
    pauseWhenIdle,
    idleThreshold,
  })
}
