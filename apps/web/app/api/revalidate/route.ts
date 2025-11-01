import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

export async function GET(request: NextRequest) {
  const tag = request.nextUrl.searchParams.get('tag')
  
  if (!tag) {
    return NextResponse.json(
      { error: 'Tag parameter is required' },
      { status: 400 }
    )
  }
  
  revalidateTag(tag, {})

  return NextResponse.json(
    { revalidated: true, now: Date.now(), tag },
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    }
  )
}