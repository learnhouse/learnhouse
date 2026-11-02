import { NextResponse } from 'next/server'

// LTI is an Enterprise feature; without EE the account link route does not exist.
export async function POST() {
  return NextResponse.json({ detail: 'Not found' }, { status: 404 })
}
