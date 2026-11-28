import { NextResponse } from 'next/server'

// Packages are an Enterprise feature; without EE the content route does not exist.
function notFound() {
  return NextResponse.json({ detail: 'Not found' }, { status: 404 })
}

export const GET = notFound
export const POST = notFound
export const OPTIONS = notFound
