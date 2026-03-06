import { NextRequest, NextResponse } from 'next/server'
import { assignReviewer } from '@/services/custom-dev/peer-coursework/peerActivity.service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const review = assignReviewer({
      submissionId: body.submissionId,
      reviewerId: body.reviewerId,
    })

    return NextResponse.json(review, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}