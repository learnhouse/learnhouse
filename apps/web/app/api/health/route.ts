export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
export async function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  )
}
