import pc from 'picocolors'
import { VERSION } from '../constants.js'

const ICON = [
  '          ████████████████████          ',
  '         ██████████████████████         ',
  '         ██████████████████████         ',
  '       ████████████  ████████████       ',
  '     ██████████████  ██████████████     ',
  '██████████████████    ██████████████████',
  '█████████████████      █████████████████',
  '███████████████          ███████████████',
  '█████████████              █████████████',
  '███████████                  ███████████',
  '████████                        ████████',
]

const ICON_W = Math.max(...ICON.map((l) => l.length))

function center(s: string, width: number): string {
  const pad = Math.max(0, width - s.length)
  return ' '.repeat(Math.floor(pad / 2)) + s
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

function padStyled(styled: string, width: number): string {
  const visible = stripAnsi(styled).length
  return styled + ' '.repeat(Math.max(0, width - visible))
}

const BOX_W = 44

function boxLine(content: string): string {
  return pc.dim('│') + ' ' + padStyled(content, BOX_W) + ' ' + pc.dim('│')
}

function buildInfoBox(): string[] {
  const top = pc.dim('┌' + '─'.repeat(BOX_W + 2) + '┐')
  const bot = pc.dim('└' + '─'.repeat(BOX_W + 2) + '┘')
  const sep = pc.dim('─'.repeat(BOX_W))
  const empty = boxLine('')

  return [
    top,
    boxLine(pc.bold(pc.white('LearnHouse')) + pc.dim(` // v${VERSION}`)),
    boxLine(sep),
    boxLine(pc.white('Deploy LearnHouse with a single command.')),
    boxLine(pc.white('Handles configuration, Docker, SSL, DB.')),
    empty,
    boxLine(pc.white('> ') + pc.dim('npx learnhouse@latest')),
    bot,
  ]
}

export async function printBanner() {
  console.log()
  for (const line of ICON) {
    console.log(pc.white(center(line, ICON_W)))
  }

  console.log()
  const box = buildInfoBox()
  for (const line of box) {
    const visible = stripAnsi(line).length
    const pad = Math.max(0, Math.floor((ICON_W - visible) / 2))
    console.log(' '.repeat(pad) + line)
  }
  console.log()
}
