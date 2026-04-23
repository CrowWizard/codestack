/**
 * Provide sensible defaults for required client env vars during SDK tests.
 * Keeps tests from failing when a developer hasn't exported the full web env.
 */
const testDefaults: Record<string, string> = {
  NEXT_PUBLIC_CB_ENVIRONMENT: 'test',
  NEXT_PUBLIC_CODEBUFF_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_WEB_PORT: '3000',
}

const serverDefaults: Record<string, string> = {
  OPEN_ROUTER_API_KEY: 'test',
  OPENAI_API_KEY: 'test',
  LINKUP_API_KEY: 'test',
  PORT: '4242',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  CODEBUFF_GITHUB_ID: 'test-id',
  CODEBUFF_GITHUB_SECRET: 'test-secret',
  NEXTAUTH_SECRET: 'test-secret',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET_KEY: 'whsec_dummy',
  STRIPE_TEAM_FEE_PRICE_ID: 'price_test',
  LOOPS_API_KEY: 'test',
  DISCORD_PUBLIC_KEY: 'test',
  DISCORD_BOT_TOKEN: 'test',
  DISCORD_APPLICATION_ID: 'test',
}

for (const [key, value] of Object.entries(testDefaults)) {
  if (!process.env[key]) {
    process.env[key] = value
  }
}

for (const [key, value] of Object.entries(serverDefaults)) {
  if (!process.env[key]) {
    process.env[key] = value
  }
}

if (process.env.CI !== 'true' && process.env.CI !== '1') {
  process.env.CI = 'true'
}

// Hint to downstream code that this is a test runtime
process.env.NODE_ENV ||= 'test'
process.env.BUN_ENV ||= 'test'
