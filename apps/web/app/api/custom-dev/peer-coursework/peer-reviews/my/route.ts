import { NextRequest, NextResponse } from 'next/server'
import { getAssignedReviewsForStudent } from '@/services/custom-dev/peer-coursework/peerActivity.service'

export async function GET(req: NextRequest) {
  const reviewerId = req.nextUrl.searchParams.get('reviewerId')

  if (!reviewerId) {
    return NextResponse.json(
      { error: 'reviewerId is required' },
      { status: 400 }
    )
  }

  const reviews = getAssignedReviewsForStudent(reviewerId)
  return NextResponse.json(reviews)
}