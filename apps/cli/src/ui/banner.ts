import pc from 'picocolors'
import { VERSION } from '../constants.js'

const LOGO = `
  _                      _   _
 | |    ___  __ _ _ _ _ | | | | ___  _   _ ___  ___
 | |   / _ \\/ _\` | '__| | |_| |/ _ \\| | | / __|/ _ \\
 | |__|  __/ (_| | |  | |  _  | (_) | |_| \\__ \\  __/
 |_____\\___|\\__,_|_|  |_|_| |_|\\___/ \\__,_|___/\\___|
`

export function printBanner() {
  console.log(pc.cyan(LOGO))
  console.log(pc.dim(`  Self-Hosting CLI v${VERSION}`))
  console.log()
}
