// Onboarding walkthrough videos. Made with the LearnHouse video guide pipeline
// (real app recordings, narrated). Served from /public/onboarding-media by default (kept out of the proxy matcher);
// NEXT_PUBLIC_LEARNHOUSE_ONBOARDING_MEDIA_URL points them at a CDN instead.
const BASE = (process.env.NEXT_PUBLIC_LEARNHOUSE_ONBOARDING_MEDIA_URL || '/onboarding-media').replace(/\/$/, '')

export type OnboardingVideo = { src: string; poster: string; captions: string; duration: number }

// Durations in seconds, shown on the poster before the file loads.
const DURATIONS: Record<string, number> = {
  ob1: 36,
  ob2: 32,
  ob3: 32,
  ob4: 32,
  ob5: 32,
  ob6: 30,
  ob7: 28,
}

export function onboardingVideo(id: string): OnboardingVideo {
  return {
    src: `${BASE}/${id}.mp4`,
    poster: `${BASE}/${id}.jpg`,
    captions: `${BASE}/${id}.vtt`,
    duration: DURATIONS[id] ?? 30,
  }
}

export const WELCOME_VIDEO = 'ob1'
