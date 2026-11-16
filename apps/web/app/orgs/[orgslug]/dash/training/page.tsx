import { redirect } from 'next/navigation'

export default async function TrainingIndex(props: { params: Promise<{ orgslug: string }> }) {
  await props.params
  redirect('/dash/training/compliance')
}
