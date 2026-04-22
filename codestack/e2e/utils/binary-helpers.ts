import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '../../..')

export function getcodestackBinaryPath(): string {
  if (process.env.codestack_BINARY) {
    return resolve(process.env.codestack_BINARY)
  }
  const basePath = resolve(REPO_ROOT, 'cli/bin/codestack')
  // On Windows, the binary has a .exe extension
  if (process.platform === 'win32' && existsSync(`${basePath}.exe`)) {
    return `${basePath}.exe`
  }
  return basePath
}

export function requirecodestackBinary(): string {
  const binaryPath = getcodestackBinaryPath()
  if (!existsSync(binaryPath)) {
    throw new Error(
      `codestack binary not found at ${binaryPath}. ` +
        'Build with: bun codestack/cli/build.ts <version>',
    )
  }
  return binaryPath
}
