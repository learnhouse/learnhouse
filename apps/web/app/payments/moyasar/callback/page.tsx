'use client';
import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getEnrollmentStatus } from '@services/payments/providers/moyasar';

type PollState = 'polling' | 'success' | 'failed' | 'timeout';

function MoyasarCallbackInner() {
  const search = useSearchParams();
  const router = useRouter();
  const session = useLHSession() as any;
  const enrollmentId = Number(search.get('enrollment_id') || '0');
  const [status, setStatus] = useState<PollState>('polling');

  useEffect(() => {
    if (!enrollmentId || !session?.data?.tokens?.access_token) return;
    let attempts = 0;
    const MAX = 7; // ~10.5 s total at 1.5 s intervals
    let cancelled = false;

    const tick = async () => {
      attempts += 1;
      try {
        const res = await getEnrollmentStatus(enrollmentId, session.data.tokens.access_token);
        if (cancelled) return;
        if (res?.status === 'ACTIVE') {
          setStatus('success');
          setTimeout(() => router.push('/'), 1500);
          return true;
        }
        if (res?.status === 'CANCELLED' || res?.status === 'FAILED') {
          setStatus('failed');
          return true;
        }
      } catch {
        // ignore — will retry
      }
      if (attempts >= MAX && !cancelled) {
        setStatus('timeout');
        return true;
      }
      return false;
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      const done = await tick();
      if (!done && !cancelled) {
        timer = setTimeout(loop, 1500);
      }
    };
    loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enrollmentId, session?.data?.tokens?.access_token, router]);

  return (
    <div className="h-screen flex items-center justify-center bg-[#f8f8f8]">
      <div className="text-center px-6 max-w-sm">
        {status === 'polling' && (
          <>
            <Loader2 size={36} className="mx-auto animate-spin text-gray-600 mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">Confirming your payment…</h1>
            <p className="text-sm text-gray-500 mt-1">This usually takes a few seconds.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={36} className="mx-auto text-green-600 mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">You're enrolled!</h1>
            <p className="text-sm text-gray-500 mt-1">Redirecting…</p>
          </>
        )}
        {status === 'failed' && (
          <>
            <AlertTriangle size={36} className="mx-auto text-red-600 mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">Payment was not completed</h1>
            <p className="text-sm text-gray-500 mt-1">Please try again.</p>
          </>
        )}
        {status === 'timeout' && (
          <>
            <Clock size={36} className="mx-auto text-gray-400 mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">Still confirming…</h1>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              Refresh in a moment, or check your enrollment in the dashboard.
            </p>
            <button
              onClick={() => location.reload()}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800"
            >
              Refresh
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function MoyasarCallback() {
  return (
    <Suspense fallback={<div className="h-screen" />}>
      <MoyasarCallbackInner />
    </Suspense>
  );
}
