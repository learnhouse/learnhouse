import 'dotenv/config'
import { Server } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import jwt from 'jsonwebtoken'

const PORT = parseInt(process.env.COLLAB_PORT || '4000', 10)
const API_URL = process.env.LEARNHOUSE_API_URL || 'http://localhost:8000'
const SECRET_KEY = process.env.LEARNHOUSE_AUTH_JWT_SECRET_KEY || ''
const INTERNAL_KEY = process.env.COLLAB_INTERNAL_KEY || ''

function extractBoardUuid(documentName: string): string | null {
  // Room naming: board:{board_uuid}
  const match = documentName.match(/^board:(.+)$/)
  return match ? match[1] : null
}

const server = Server.configure({
  port: PORT,

  async onAuthenticate({ token, documentName }) {
    if (!token) {
      throw new Error('Authentication required')
    }

    // Verify JWT using same secret + algorithm as backend
    let payload: any
    try {
      payload = jwt.verify(token, SECRET_KEY, { algorithms: ['HS256'] })
    } catch {
      throw new Error('Invalid token')
    }

    const boardUuid = extractBoardUuid(documentName)
    if (!boardUuid) {
      throw new Error('Invalid document name')
    }

    // Verify board membership via backend API
    const response = await fetch(
      `${API_URL}/api/v1/boards/${boardUuid}/membership`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    )

    if (!response.ok) {
      throw new Error('Not authorized for this board')
    }

    const membership = await response.json()

    return {
      user: {
        id: payload.sub,
        name: membership.username || 'Unknown',
        role: membership.role,
      },
    }
  },

  extensions: [
    new Database({
      async fetch({ documentName }) {
        const boardUuid = extractBoardUuid(documentName)
        if (!boardUuid) return null

        try {
          const url = `${API_URL}/api/v1/boards/${boardUuid}/ydoc`
          console.log(`[collab] Fetching ydoc from ${url}`)
          const response = await fetch(url, {
            headers: {
              'X-Internal-Key': INTERNAL_KEY,
            },
          })

          if (!response.ok) {
            console.error(`[collab] Failed to fetch ydoc for ${boardUuid}: ${response.status} ${response.statusText}`)
            return null
          }

          const buffer = await response.arrayBuffer()
          console.log(`[collab] Fetched ydoc for ${boardUuid}: ${buffer.byteLength} bytes`)
          return buffer.byteLength > 0
            ? new Uint8Array(buffer)
            : null
        } catch (err) {
          console.error(`[collab] Error fetching ydoc for ${boardUuid}:`, err)
          return null
        }
      },

      async store({ documentName, state }) {
        const boardUuid = extractBoardUuid(documentName)
        if (!boardUuid) return

        try {
          const url = `${API_URL}/api/v1/boards/${boardUuid}/ydoc`
          console.log(`[collab] Storing ydoc for ${boardUuid}: ${state.byteLength} bytes`)
          const response = await fetch(url, {
            method: 'PUT',
            headers: {
              'X-Internal-Key': INTERNAL_KEY,
              'Content-Type': 'application/octet-stream',
            },
            body: state,
          })
          if (!response.ok) {
            console.error(`[collab] Failed to store ydoc for ${boardUuid}: ${response.status} ${response.statusText}`)
          } else {
            console.log(`[collab] Stored ydoc for ${boardUuid} successfully`)
          }
        } catch (err) {
          console.error(`[collab] Error storing ydoc for ${boardUuid}:`, err)
        }
      },
    }),
  ],
})

server.listen().then(() => {
  console.log(`Hocuspocus collab server running on port ${PORT}`)
})
