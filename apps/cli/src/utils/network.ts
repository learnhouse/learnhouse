import net from 'node:net'

export function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port)
  })
}

export function checkTcpConnection(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

export function parsePostgresUrl(connString: string): { host: string; port: number } | null {
  try {
    const url = new URL(connString)
    return { host: url.hostname, port: url.port ? parseInt(url.port, 10) : 5432 }
  } catch {
    return null
  }
}

export function parseRedisUrl(connString: string): { host: string; port: number } | null {
  try {
    const url = new URL(connString)
    return { host: url.hostname, port: url.port ? parseInt(url.port, 10) : 6379 }
  } catch {
    return null
  }
}
