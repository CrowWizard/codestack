#!/usr/bin/env bun

import fs from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'

import { getProjectFileTree } from '@codebuff/common/project-file-tree'
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query'
import { Command } from 'commander'
import { cyan, green, red, yellow } from 'picocolors'
import React from 'react'

import { App } from './app'
import { initializeApp } from './init/init-app'
import { getProjectRoot, setProjectRoot } from './project-files'
import { getAuthToken, getAuthTokenDetails } from './utils/auth'
import { resetCodebuffClient } from './utils/codebuff-client'
import { setApiClientAuthToken } from './utils/codebuff-api'
import { getCliEnv } from './utils/env'
import { clearLogFile, logger } from './utils/logger'
import { shouldShowProjectPicker } from './utils/project-picker'
import { saveRecentProject } from './utils/recent-projects'
import { installProcessCleanupHandlers, TERMINAL_RESET_SEQUENCES } from './utils/renderer-cleanup'
import { initializeSkillRegistry } from './utils/skill-registry'
import { detectTerminalTheme } from './utils/terminal-color-detection'
import { setOscDetectedTheme } from './utils/theme-system'

import type { AgentMode } from './utils/constants'
import type { FileTreeNode } from '@codebuff/common/util/file'

const require = createRequire(import.meta.url)

function loadPackageVersion(): string {
  const env = getCliEnv()
  if (env.CODEBUFF_CLI_VERSION) {
    return env.CODEBUFF_CLI_VERSION
  }

  try {
    const pkg = require('../package.json') as { version?: string }
    if (pkg.version) {
      return pkg.version
    }
  } catch {
    // Continue to dev fallback
  }

  return 'dev'
}

// Configure TanStack Query's focusManager for terminal environments
// This is required because there's no browser visibility API in terminal apps
// Without this, refetchInterval won't work because TanStack Query thinks the app is "unfocused"
focusManager.setEventListener(() => {
  // No-op: no event listeners in CLI environment (no window focus/visibility events)
  return () => { }
})
focusManager.setFocused(true)

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes - auth tokens don't change frequently
        gcTime: 10 * 60 * 1000, // 10 minutes - keep cached data a bit longer
        retry: false, // Don't retry failed auth queries automatically
        refetchOnWindowFocus: false, // CLI doesn't have window focus
        refetchOnReconnect: true, // Refetch when network reconnects
        refetchOnMount: false, // Don't refetch on every mount
      },
      mutations: {
        retry: 1, // Retry mutations once on failure
      },
    },
  })
}

type ParsedArgs = {
  initialPrompt: string | null
  agent?: string
  clearLogs: boolean
  continue: boolean
  continueId?: string | null
  cwd?: string
  initialMode?: AgentMode
}

function parseArgs(): ParsedArgs {
  const program = new Command()

  // Codebuff: full CLI with all options
  program
    .name('codebuff')
    .description('Codebuff CLI - AI-powered coding assistant')
    .version(loadPackageVersion(), '-v, --version', 'Print the CLI version')
    .option(
      '--agent <agent-id>',
      'Run a specific agent id (skips loading local .agents overrides)',
    )
    .option('--clear-logs', 'Remove any existing CLI log files before starting')
    .option(
      '--continue [conversation-id]',
      'Continue from a previous conversation (optionally specify a conversation id)',
    )
    .option(
      '--cwd <directory>',
      'Set the working directory (default: current directory)',
    )
    .option('--lite', 'Start in LITE mode')
    .option('--free', 'Start in LITE mode (deprecated alias)')
    .option('--max', 'Start in MAX mode')
    .option('--plan', 'Start in PLAN mode')
    .addHelpText('after', '\nCommands:\n  login                          Log in to your account\n  publish                        Publish agents to the registry')
    .helpOption('-h, --help', 'Show this help message')
    .argument('[prompt...]', 'Initial prompt to send to the agent')
    .allowExcessArguments(true)
    .parse(process.argv)

  const options = program.opts()
  const args = program.args

  const continueFlag = options.continue

  // Determine initial mode from flags (last flag wins if multiple specified)
  // Freebuff always uses LITE mode
  let initialMode: AgentMode | undefined
  if (options.free || options.lite) initialMode = 'LITE'
  if (options.max) initialMode = 'MAX'
  if (options.plan) initialMode = 'PLAN'

  return {
    initialPrompt: args.length > 0 ? args.join(' ') : null,
    agent: options.agent,
    clearLogs: options.clearLogs || false,
    continue: Boolean(continueFlag),
    continueId:
      typeof continueFlag === 'string' && continueFlag.trim().length > 0
        ? continueFlag.trim()
        : null,
    cwd: options.cwd,
    initialMode,
  }
}

async function main(): Promise<void> {
  // Run OSC theme detection BEFORE anything else.
  // This MUST happen before OpenTUI starts because OSC responses come through stdin,
  // and OpenTUI also listens to stdin. Running detection here ensures stdin is clean.
  if (process.stdin.isTTY && process.platform !== 'win32') {
    try {
      const oscTheme = await detectTerminalTheme()
      if (oscTheme) {
        setOscDetectedTheme(oscTheme)
      }
    } catch {
      // Silently ignore OSC detection failures
    }
  }

  const {
    initialPrompt,
    agent,
    clearLogs,
    continue: continueChat,
    continueId,
    cwd,
    initialMode,
  } = parseArgs()

  const hasAgentOverride = Boolean(agent?.trim())

  await initializeApp({ cwd })

  // Set the auth token for the API client
  setApiClientAuthToken(getAuthToken())


  // Show project picker only when user starts at the home directory or an ancestor
  const projectRoot = getProjectRoot()
  const homeDir = os.homedir()
  const startCwd = process.cwd()
  const showProjectPicker = shouldShowProjectPicker(startCwd, homeDir)

  // Initialize skill registry (loads skills from .agents/skills)
  await initializeSkillRegistry()

  if (clearLogs) {
    clearLogFile()
  }

  const queryClient = createQueryClient()

  const AppWithAsyncAuth = () => {
    const [requireAuth, setRequireAuth] = React.useState<boolean | null>(null)
    const [hasInvalidCredentials, setHasInvalidCredentials] =
      React.useState(false)
    const [fileTree, setFileTree] = React.useState<FileTreeNode[]>([])
    const [currentProjectRoot, setCurrentProjectRoot] =
      React.useState(projectRoot)
    const [showProjectPickerScreen, setShowProjectPickerScreen] =
      React.useState(showProjectPicker)

    React.useEffect(() => {
      const apiKey = getAuthTokenDetails().token ?? ''

      if (!apiKey) {
        setRequireAuth(true)
        setHasInvalidCredentials(false)
        return
      }

      setHasInvalidCredentials(true)
      setRequireAuth(false)
    }, [])

    const loadFileTree = React.useCallback(async (root: string) => {
      try {
        if (root) {
          const tree = await getProjectFileTree({
            projectRoot: root,
            fs: fs.promises,
          })
          setFileTree(tree)
        }
      } catch (error) {
        // Silently fail - fileTree is optional for @ menu
      }
    }, [])

    React.useEffect(() => {
      loadFileTree(currentProjectRoot)
    }, [currentProjectRoot, loadFileTree])

    // Callback for when user selects a new project from the picker
    const handleProjectChange = React.useCallback(
      async (newProjectPath: string) => {
        // Change process working directory
        process.chdir(newProjectPath)

        // Update the project root in the module state
        setProjectRoot(newProjectPath)
        // Reset client to ensure tools use the updated project root
        resetCodebuffClient()
        // Save to recent projects list
        saveRecentProject(newProjectPath)
        // Update local state
        setCurrentProjectRoot(newProjectPath)
        // Reset file tree state to trigger reload
        setFileTree([])
        // Hide the picker and show the chat
        setShowProjectPickerScreen(false)
      },
      [],
    )

    return (
      <App
        initialPrompt={initialPrompt}
        agentId={agent}
        requireAuth={requireAuth}
        hasInvalidCredentials={hasInvalidCredentials}
        fileTree={fileTree}
        continueChat={continueChat}
        continueChatId={continueId ?? undefined}
        initialMode={initialMode}
        showProjectPicker={showProjectPickerScreen}
        onProjectChange={handleProjectChange}
      />
    )
  }

  // Install early error handlers BEFORE renderer creation.
  // If the renderer crashes during init, these ensure the error is visible
  // by exiting the alternate screen buffer before printing the error.
  const earlyFatalHandler = (error: unknown) => {
    try {
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(false)
      }
    } catch {
      // stdin may be closed
    }
    try {
      if (process.stdout.isTTY) {
        process.stdout.write(TERMINAL_RESET_SEQUENCES)
      }
    } catch {
      // stdout may be closed
    }
    try {
      console.error('Fatal error during startup:', error)
    } catch {
      // stderr may be closed
    }
    process.exit(1)
  }
  process.on('uncaughtException', earlyFatalHandler)
  process.on('unhandledRejection', earlyFatalHandler)

  const renderer = await createCliRenderer({
    backgroundColor: 'transparent',
    exitOnCtrlC: false,
    useAlternateScreen: true,
  })

  // Remove early handlers — proper cleanup handlers (with renderer access) take over
  process.removeListener('uncaughtException', earlyFatalHandler)
  process.removeListener('unhandledRejection', earlyFatalHandler)
  installProcessCleanupHandlers(renderer)
  createRoot(renderer).render(
    <QueryClientProvider client={queryClient}>
      <AppWithAsyncAuth />
    </QueryClientProvider>,
  )
}

void main()