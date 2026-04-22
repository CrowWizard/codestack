/**
 * Re-exports from @codebuff/common/config/codestack-config.
 * The single source of truth is common/src/config/codestack-config.ts.
 */

export {
  loadCodefluffConfig as loadCodestackConfig,
  getConfiguredKeys,
  getDefaultMode,
  getSearchProviders as getConfiguredSearchProviders,
  costModes,
  resetCodefluffConfigCache,
} from '@codebuff/common/config/codestack-config'

export type {
  CodefluffConfig as CodestackConfig,
  CostMode,
  ProviderKeyConfig,
} from '@codebuff/common/config/codestack-config'
