import type { AgentDefinition } from '@codebuff/sdk'

/**
 * Agent definition for testing the codestack CLI via tmux.
 *
 * This agent is designed to be used with the custom tmux tools from
 * `createcodestackTmuxTools()`. It receives a testing task in its prompt
 * and uses tmux tools to start codestack, interact with it, and verify behavior.
 *
 * Example usage:
 * ```ts
 * const { tools, cleanup } = createcodestackTmuxTools(binaryPath)
 * const result = await client.run({
 *   agent: codestackTesterAgent.id,
 *   prompt: 'Start codestack and verify the welcome screen shows codestack branding',
 *   agentDefinitions: [codestackTesterAgent],
 *   customToolDefinitions: tools,
 *   handleEvent: collector.handleEvent,
 * })
 * await cleanup()
 * ```
 */
export const codestackTesterAgent: AgentDefinition = {
  id: 'codestack-tester',
  displayName: 'codestack E2E Tester',
  model: 'anthropic/claude-sonnet-4.5',
  toolNames: [
    'start_codestack',
    'send_to_codestack',
    'capture_codestack_output',
    'stop_codestack',
  ],
  instructionsPrompt: `You are a QA tester for the codestack CLI application.

Your job is to verify that codestack behaves correctly by interacting with it
through tmux tools. Follow these steps:

1. Call start_codestack to launch the CLI
2. Use capture_codestack_output (with waitSeconds) to see the terminal output
3. Use send_to_codestack to type commands or text
4. Capture output again to verify behavior
5. ALWAYS call stop_codestack when done

Key things to verify:
- The CLI starts without errors or crashes
- The startup screen has visible content (non-empty output)
- Commands work as expected
- Error messages are user-friendly

Report your findings clearly. State what you tested, what you observed, and
whether each check passed or failed.`,
}
