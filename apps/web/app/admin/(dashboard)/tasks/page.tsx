import type { Metadata } from 'next'
import TasksPage from '@components/Admin/Tasks/TasksPage'

export const metadata: Metadata = {
  title: 'Tasks',
}

export default function AdminTasksPage() {
  return <TasksPage />
}
