import { NextResponse } from 'next/server'

// SCORM is an Enterprise feature; without EE the proxy route does not exist.
export async function GET() {
  return NextResponse.json({ detail: 'Not found' }, { status: 404 })
}
