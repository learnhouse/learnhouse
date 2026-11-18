import type { Metadata } from 'next'
import TasksPage from '@ee/components/Backoffice/Tasks/TasksPage'

export const metadata: Metadata = {
  title: 'Tasks',
}

export default function BackofficeTasksPage() {
  return <TasksPage />
}
