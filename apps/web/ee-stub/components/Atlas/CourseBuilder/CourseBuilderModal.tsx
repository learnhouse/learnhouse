// Open-source stand-in: never rendered (COURSE_BUILDER_AVAILABLE is false).
export interface CourseBuilderModalProps {
  isOpen: boolean
  onClose: () => void
  orgId: number
  orgslug: string
  accessToken: string
  initialChat?: string | null
}

export default function CourseBuilderModal(_props: CourseBuilderModalProps) {
  return null
}
