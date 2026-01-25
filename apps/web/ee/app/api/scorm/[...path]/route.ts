import { NextRequest, NextResponse } from 'next/server'
import { getAPIUrl } from '@services/config/config'

/**
 * Proxy route for SCORM content
 * This serves SCORM content from the same origin as the frontend,
 * which is required for the SCORM API to work properly in iframes.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params
    const pathString = path.join('/')

    // Get query string from the request
    const queryString = request.nextUrl.search

    // Build the backend URL (include query string if present)
    const backendUrl = `${getAPIUrl()}scorm/${pathString}${queryString}`

    const response = await fetch(backendUrl, {
      method: 'GET',
    })

    if (!response.ok) {
      return new NextResponse(null, { status: response.status })
    }

    // Get the content type from the response
    const contentType = response.headers.get('content-type') || 'application/octet-stream'

    // Get the response body
    const body = await response.arrayBuffer()

    // Return the response with appropriate headers
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('SCORM proxy error:', error)
    return new NextResponse(null, { status: 500 })
  }
}
