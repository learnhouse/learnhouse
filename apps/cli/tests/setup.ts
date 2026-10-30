import os from 'node:os'

// Tests isolate the CLI's ~/.learnhouse by pointing HOME at a temp dir. On
// POSIX, os.homedir() follows HOME; on Windows it reads USERPROFILE instead,
// so every such test would read the runner's real profile. Make os.homedir()
// honor HOME there too, for the test process only.
if (process.platform === 'win32') {
  const realHomedir = os.homedir.bind(os)
  ;(os as { homedir: () => string }).homedir = () => process.env.HOME || realHomedir()
}

// Never print the npm update notice from code paths exercised in tests.
process.env.LEARNHOUSE_NO_UPDATE_CHECK = '1'
