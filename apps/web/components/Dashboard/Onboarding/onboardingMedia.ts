// Onboarding walkthrough videos. Made with the LearnHouse video guide pipeline
// (real app recordings, narrated) and hosted as unlisted videos on the
// LearnHouse YouTube channel.
export type OnboardingVideo = { youtubeId: string; poster: string; duration: number }

// YouTube ids, and durations in seconds shown before the player loads.
const VIDEOS: Record<string, { youtubeId: string; duration: number }> = {
  ob1: { youtubeId: '5UNjzIuEAl0', duration: 37 },
  ob2: { youtubeId: 'UUnoT-xfnnY', duration: 34 },
  ob3: { youtubeId: '6mmWspi12wY', duration: 32 },
  ob4: { youtubeId: 'gOnapJb1JJU', duration: 32 },
  ob5: { youtubeId: 'jnrhaySDCt4', duration: 32 },
  ob6: { youtubeId: 'flESwP0B87g', duration: 32 },
  ob7: { youtubeId: '3lGZuUoZRXY', duration: 28 },
}

export function onboardingVideo(id: string): OnboardingVideo {
  const v = VIDEOS[id] ?? VIDEOS.ob1
  return { ...v, poster: `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg` }
}

export const WELCOME_VIDEO = 'ob1'
