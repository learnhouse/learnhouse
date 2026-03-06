import { NextRequest, NextResponse } from 'next/server'
import { submitPeerSubmission, getAllSubmissions } from '@/services/custom-dev/peer-coursework/peerActivity.service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const submission = submitPeerSubmission({
      activityId: body.activityId,
      studentId: body.studentId,
      content: body.content,
    })

    return NextResponse.json(submission, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}

export async function GET() {
  const submissions = getAllSubmissions()
  return NextResponse.json(submissions)
}