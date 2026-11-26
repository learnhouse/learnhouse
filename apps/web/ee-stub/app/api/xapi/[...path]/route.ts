import { NextResponse } from 'next/server'

// xAPI is an Enterprise feature; without EE the LRS proxy does not exist.
async function notFound() {
  return NextResponse.json({ detail: 'Not found' }, { status: 404 })
}

export const GET = notFound
export const HEAD = notFound
export const OPTIONS = notFound
export const PUT = notFound
export const POST = notFound
export const DELETE = notFound
