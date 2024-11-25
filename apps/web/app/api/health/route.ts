export const dynamic = 'force-dynamic' // defaults to auto
export const revalidate = 0

import { NextResponse } from 'next/server';
import { checkHealth } from '@services/utils/health';

export async function GET() {
  const health = await checkHealth()
  if (health.success === true) {
    return NextResponse.json(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        health: health.data,
      },
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  } else {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        health: null,
        error: health.HTTPmessage,
      },
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}
