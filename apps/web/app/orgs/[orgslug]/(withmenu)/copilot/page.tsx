import { redirect } from 'next/navigation'

// Copilot moved into Messages as the built-in agent; keep old links working.
export default function CopilotPage() {
  redirect('/messages')
}
