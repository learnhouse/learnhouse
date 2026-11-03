import { NextResponse } from 'next/server'

// LTI is an Enterprise feature; without EE the hand-off check does not exist.
export async function POST() {
  return NextResponse.json({ detail: 'Not found' }, { status: 404 })
}
