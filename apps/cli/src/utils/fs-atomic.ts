import fs from 'node:fs'
import path from 'node:path'

/**
 * Replace a file's contents atomically: write a sibling temp file, fsync it,
 * then rename over the target. A crash or ENOSPC mid-write leaves the old file
 * intact instead of a truncated .env / docker-compose.yml.
 *
 * Without `mode`, an existing file keeps its permissions (so a 0600 .env stays
 * 0600); a new file gets 0644.
 */
export function writeFileAtomic(filePath: string, data: string, mode?: number): void {
  let finalMode = mode
  if (finalMode === undefined) {
    try {
      finalMode = fs.statSync(filePath).mode & 0o777
    } catch {
      finalMode = 0o644
    }
  }
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`)
  const fd = fs.openSync(tmp, 'w', finalMode)
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    // openSync's mode is filtered by the umask; set the exact bits explicitly.
    fs.chmodSync(tmp, finalMode)
    fs.renameSync(tmp, filePath)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
}
