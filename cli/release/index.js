#!/usr/bin/env node

const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const tar = require('tar')
const { createReleaseHttpClient } = require('./http')

const packageName = 'codebuff'

/**
 * Terminal escape sequences to reset terminal state after the child process exits.
 * When the binary is SIGKILL'd, it can't clean up its own terminal state.
 * The wrapper (this process) survives and must reset these modes.
 *
 * Keep in sync with TERMINAL_RESET_SEQUENCES in cli/src/utils/renderer-cleanup.ts
 */
const TERMINAL_RESET_SEQUENCES =
  '\x1b[?1049l' + // Exit alternate screen buffer
  '\x1b[?1000l' + // Disable X10 mouse mode
  '\x1b[?1002l' + // Disable button event mouse mode
  '\x1b[?1003l' + // Disable any-event mouse mode (all motion)
  '\x1b[?1006l' + // Disable SGR extended mouse mode
  '\x1b[?1004l' + // Disable focus reporting
  '\x1b[?2004l' + // Disable bracketed paste mode
  '\x1b[?25h' // Show cursor

function resetTerminal() {
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
}

function createConfig(packageName) {
  const homeDir = os.homedir()
  const configDir = path.join(homeDir, '.config', 'manicode')
  const binaryName =
    process.platform === 'win32' ? `${packageName}.exe` : packageName

  return {
    homeDir,
    configDir,
    binaryName,
    binaryPath: path.join(configDir, binaryName),
    metadataPath: path.join(configDir, 'codebuff-metadata.json'),
    tempDownloadDir: path.join(configDir, '.download-temp'),
    userAgent: `${packageName}-cli`,
    requestTimeout: 20000,
  }
}

const CONFIG = createConfig(packageName)
const { getProxyUrl, httpGet } = createReleaseHttpClient({
  env: process.env,
  userAgent: CONFIG.userAgent,
  requestTimeout: CONFIG.requestTimeout,
})


const PLATFORM_TARGETS = {
  'linux-x64': `${packageName}-linux-x64.tar.gz`,
  'linux-arm64': `${packageName}-linux-arm64.tar.gz`,
  'darwin-x64': `${packageName}-darwin-x64.tar.gz`,
  'darwin-arm64': `${packageName}-darwin-arm64.tar.gz`,
  'win32-x64': `${packageName}-win32-x64.tar.gz`,
}

const term = {
  clearLine: () => {
    if (process.stderr.isTTY) {
      process.stderr.write('\r\x1b[K')
    }
  },
  write: (text) => {
    term.clearLine()
    process.stderr.write(text)
  },
  writeLine: (text) => {
    term.clearLine()
    process.stderr.write(text + '\n')
  },
}

async function getLatestVersion() {
  try {
    const res = await httpGet(
      `https://registry.npmjs.org/${packageName}/latest`,
    )

    if (res.statusCode !== 200) return null

    const body = await streamToString(res)
    const packageData = JSON.parse(body)

    return packageData.version || null
  } catch (error) {
    return null
  }
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    let data = ''
    stream.on('data', (chunk) => (data += chunk))
    stream.on('end', () => resolve(data))
    stream.on('error', reject)
  })
}

function getCurrentVersion() {
  try {
    if (!fs.existsSync(CONFIG.metadataPath)) {
      return null
    }
    const metadata = JSON.parse(fs.readFileSync(CONFIG.metadataPath, 'utf8'))
    // Also verify the binary still exists
    if (!fs.existsSync(CONFIG.binaryPath)) {
      return null
    }
    return metadata.version || null
  } catch (error) {
    return null
  }
}

function compareVersions(v1, v2) {
  if (!v1 || !v2) return 0

  // Always update if the current version is not a valid semver
  // e.g. 1.0.420-beta.1
  if (!v1.match(/^\d+(\.\d+)*$/)) {
    return -1
  }

  const parseVersion = (version) => {
    const parts = version.split('-')
    const mainParts = parts[0].split('.').map(Number)
    const prereleaseParts = parts[1] ? parts[1].split('.') : []
    return { main: mainParts, prerelease: prereleaseParts }
  }

  const p1 = parseVersion(v1)
  const p2 = parseVersion(v2)

  for (let i = 0; i < Math.max(p1.main.length, p2.main.length); i++) {
    const n1 = p1.main[i] || 0
    const n2 = p2.main[i] || 0

    if (n1 < n2) return -1
    if (n1 > n2) return 1
  }

  if (p1.prerelease.length === 0 && p2.prerelease.length === 0) {
    return 0
  } else if (p1.prerelease.length === 0) {
    return 1
  } else if (p2.prerelease.length === 0) {
    return -1
  } else {
    for (
      let i = 0;
      i < Math.max(p1.prerelease.length, p2.prerelease.length);
      i++
    ) {
      const pr1 = p1.prerelease[i] || ''
      const pr2 = p2.prerelease[i] || ''

      const isNum1 = !isNaN(parseInt(pr1))
      const isNum2 = !isNaN(parseInt(pr2))

      if (isNum1 && isNum2) {
        const num1 = parseInt(pr1)
        const num2 = parseInt(pr2)
        if (num1 < num2) return -1
        if (num1 > num2) return 1
      } else if (isNum1 && !isNum2) {
        return 1
      } else if (!isNum1 && isNum2) {
        return -1
      } else if (pr1 < pr2) {
        return -1
      } else if (pr1 > pr2) {
        return 1
      }
    }
    return 0
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function createProgressBar(percentage, width = 30) {
  const filled = Math.round((width * percentage) / 100)
  const empty = width - filled
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']'
}

function printCrashDiagnostics(code, signal) {
  // Windows NTSTATUS codes (unsigned DWORD)
  const unsignedCode = code != null && code < 0 ? (code >>> 0) : code
  const isIllegalInstruction =
    signal === 'SIGILL' ||
    (process.platform === 'win32' && unsignedCode === 0xC000001D)
  const isAccessViolation =
    signal === 'SIGSEGV' ||
    (process.platform === 'win32' && unsignedCode === 0xC0000005)
  const isBusError = signal === 'SIGBUS'
  const isAbort =
    signal === 'SIGABRT' ||
    (process.platform === 'win32' && unsignedCode === 0xC0000409)

  if (!isIllegalInstruction && !isAccessViolation && !isBusError && !isAbort) return

  const exitInfo = signal ? `signal ${signal}` : `code ${code}`
  console.error('')
  console.error(`❌ ${packageName} exited immediately (${exitInfo})`)
  console.error('')

  if (isIllegalInstruction) {
    console.error('Your CPU may not support the required instruction set (AVX2).')
    console.error('This typically affects CPUs from before 2013.')
    console.error('Unfortunately, this binary is not compatible with your system.')
    console.error('')
  } else if (isAccessViolation) {
    console.error('The binary crashed with an access violation.')
    console.error('')
  } else if (isBusError) {
    console.error('The binary crashed with a bus error.')
    console.error('This may indicate a platform compatibility issue.')
    console.error('')
  } else if (isAbort) {
    console.error('The binary crashed with an abort signal.')
    console.error('')
  }

  console.error('System info:')
  console.error(`  Platform: ${process.platform} ${process.arch}`)
  console.error(`  Node:     ${process.version}`)
  console.error(`  Binary:   ${CONFIG.binaryPath}`)
  console.error('')
  console.error('Please report this issue at:')
  console.error('  https://github.com/CodebuffAI/codebuff/issues')
  console.error('')
}

async function main() {
  const child = spawn(CONFIG.binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
  })

  const exitListener = (code, signal) => {
    resetTerminal()
    printCrashDiagnostics(code, signal)
    process.exit(signal ? 1 : (code || 0))
  }

  child.on('exit', exitListener)

  child.on('error', (err) => {
    console.error('Failed to start codebuff:', err.message)
    process.exit(1)
  })
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error.message)
  process.exit(1)
})
