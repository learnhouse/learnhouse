import { NextRequest, NextResponse } from 'next/server'
import { submitPeerReview } from '@services/custom-dev/peer-coursework/peerCourseworkService'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const result = submitPeerReview({
      submissionId: body.submissionId,
      reviewerId: body.reviewerId,
      feedback: body.feedback,
      score: body.score,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}