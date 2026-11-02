import { NextResponse } from 'next/server'

// LTI is an Enterprise feature; without EE the login hop does not exist.
export async function GET() {
  return NextResponse.json({ detail: 'Not found' }, { status: 404 })
}
