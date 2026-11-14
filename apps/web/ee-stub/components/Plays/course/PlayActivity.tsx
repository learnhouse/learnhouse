'use client'
// OSS stub: plays require Enterprise Edition. A play activity (e.g. from an
// imported course) shows a neutral notice; learners mark it complete
// themselves so it never blocks the course (the API allows it here).
import PlayUnavailable from '@components/Objects/Activities/Play/PlayUnavailable'

function PlayActivity(props: { activity: any; course?: any; orgslug?: string }) {
  return <PlayUnavailable {...props} reason="enterprise" />
}

export default PlayActivity
