import { NextRequest, NextResponse } from 'next/server'
import { getFeedbackForStudent } from '@services/custom-dev/peer-coursework/peerCourseworkService'

export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get('studentId')

  if (!studentId) {
    return NextResponse.json(
      { error: 'studentId is required' },
      { status: 400 }
    )
  }

  const feedback = getFeedbackForStudent(studentId)
  return NextResponse.json(feedback)
}