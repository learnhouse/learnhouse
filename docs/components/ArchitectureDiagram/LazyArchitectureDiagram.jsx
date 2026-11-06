'use client'

import dynamic from 'next/dynamic'

// The interactive diagram pulls in React Flow; load it only on the page that
// shows it, with a placeholder of the same height so nothing shifts.
const ArchitectureDiagram = dynamic(() => import('./ArchitectureDiagram'), {
  ssr: false,
  loading: () => <div style={{ height: 620, borderRadius: 12, background: '#fafafa' }} aria-hidden />,
})

export default ArchitectureDiagram
