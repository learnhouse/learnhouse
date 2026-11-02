// OSS stub: selling chapters and lessons requires Enterprise Edition.
export type PaidTarget = {
  courseUuid: string
  resourceUuid: string
  resourceName: string
}

type PaidAccess = {
  uuid: string
  rule: 'included' | 'free_preview'
  ownOffers: any[]
  courseOffers: any[]
  state: 'free' | 'paid' | 'free_preview'
}

export function usePaidAccess(_target: PaidTarget | undefined, _noun: 'chapter' | 'activity'): PaidAccess | null {
  return null
}

export default function PaidAccessSection(_props: { target: PaidTarget; noun: 'chapter' | 'activity'; paid: PaidAccess }) {
  return null
}
