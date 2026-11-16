'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { removeCourse } from '@services/courses/activity'
import { getCourseMetadata } from '@services/courses/courses'
import { revalidateTags } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUserCertificates } from '@services/courses/certifications'
import { useCourseCertification } from '@components/Hooks/useCourseCertification'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { ArrowRight, ArrowSquareOut, CheckCircle, CircleNotch, DotsThree, Medal, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import CourseCard from '@components/Objects/Thumbnails/CourseCard'
import { Chip, ConfirmDialog } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"

interface TrailCourseCardProps {
  course: any
  run: any
  orgslug: string
  /** The first unfinished activity, shown as the card's call to action. */
  nextActivity?: { name: string; href: string } | null
}

function TrailCourseCard(props: TrailCourseCardProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const courseid = props.course.course_uuid.replace('course_', '')
  const course = props.course
  const router = useRouter()
  const course_total_steps = props.run.course_total_steps
  const course_completed_steps = props.run.steps.length
  const orgID = org?.id
  const course_progress = course_total_steps > 0
    ? Math.round((course_completed_steps / course_total_steps) * 100)
    : 0

  const [courseCertificate, setCourseCertificate] = useState<any>(null)
  const [isLoadingCertificate, setIsLoadingCertificate] = useState(false)
  const queryClient = useQueryClient()

  // Only a definitive "this course has no certification" hides the certificate
  // row; a pending or failed lookup keeps the existing behaviour. Asked for only
  // at 100%: that is the only progress where anything below consumes it, and a
  // trail of N unfinished courses must not fire N certification requests.
  const {
    isEnabled: certificationEnabled,
    isUnknown: certificationUnknown,
    isLoading: isLoadingCertificationStatus,
  } = useCourseCertification(
    course_progress === 100 ? props.course.course_uuid : undefined
  )
  const showCertificateUI = certificationEnabled || certificationUnknown

  const handleMouseEnter = () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.courses.meta(courseid),
      queryFn: () => getCourseMetadata(courseid, {}, access_token, { slim: true }),
      staleTime: 60_000,
    })
  }

  async function quitCourse(course_uuid: string) {
    let activity = await removeCourse(course_uuid, props.orgslug, access_token)
    await revalidateTags(['courses'], props.orgslug)
    router.refresh()
    if (orgID) {
      queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(orgID) })
    }
  }

  useEffect(() => {
    const fetchCourseCertificate = async () => {
      if (!access_token || course_progress < 100 || !org?.id) return;
      if (isLoadingCertificationStatus || !showCertificateUI) return;

      setIsLoadingCertificate(true);
      try {
        const result = await getUserCertificates(
          props.course.course_uuid,
          org.id,
          access_token
        );

        if (result.success && result.data && result.data.length > 0) {
          setCourseCertificate(result.data[0]);
        }
      } catch (error) {
        console.error('Error fetching course certificate:', error);
      } finally {
        setIsLoadingCertificate(false);
      }
    };

    fetchCourseCertificate();
  }, [access_token, course_progress, props.course.course_uuid, org?.id, isLoadingCertificationStatus, showCertificateUI]);

  useEffect(() => { }, [props.course, org])

  const courseLink = getUriWithOrg(props.orgslug, '/course/' + courseid)

  const done = course_progress === 100
  const [quitOpen, setQuitOpen] = useState(false)

  return (
    <>
      <CourseCard
        course={course}
        orgUuid={org?.org_uuid}
        href={courseLink}
        onWarm={handleMouseEnter}
        badges={
          done ? (
            <Chip tone="emerald" icon={<CheckCircle size={12} />}>{t('common.completed')}</Chip>
          ) : undefined
        }
        topEnd={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t('courses.actions')}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors"
              >
                <DotsThree size={18} weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
              <DropdownMenuItem
                onSelect={() => setQuitOpen(true)}
                className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50"
              >
                <Trash size={15} /> {t('courses.quit_course')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        footer={
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${done ? 'bg-emerald-500' : 'lh-t-progress bg-teal-500'}`}
                  style={{ width: `${course_progress}%` }}
                />
              </div>
              <span className={`text-xs font-semibold tabular-nums ${done ? 'text-emerald-600' : 'text-neutral-700'}`}>
                {course_progress}%
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-neutral-400 truncate">
                {t('courses.completed_of', { completed: course_completed_steps, total: course_total_steps })}
              </span>
              {done && showCertificateUI && (isLoadingCertificate || isLoadingCertificationStatus) ? (
                <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                  <CircleNotch size={12} className="animate-spin" />
                  {t('common.loading')}
                </span>
              ) : done && showCertificateUI && courseCertificate ? (
                <Link
                  href={getUriWithOrg(props.orgslug, `/certificates/${courseCertificate.certificate_user.user_certification_uuid}/verify`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
                >
                  <Medal size={13} />
                  {t('certificate.verify')}
                  <ArrowSquareOut size={12} />
                </Link>
              ) : (
                <Link
                  href={!done && props.nextActivity ? props.nextActivity.href : courseLink}
                  title={!done && props.nextActivity ? props.nextActivity.name : undefined}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors min-w-0"
                >
                  <span className="truncate max-w-[150px]">
                    {done
                      ? t('courses.back_to_course')
                      : props.nextActivity
                        ? t('trail.card.next', { defaultValue: 'Next: {{name}}', name: props.nextActivity.name })
                        : t('courses.continue_learning')}
                  </span>
                  <ArrowRight size={12} weight="bold" className="shrink-0 rtl:rotate-180" />
                </Link>
              )}
            </div>
          </div>
        }
      />
      <ConfirmDialog
        open={quitOpen}
        onOpenChange={setQuitOpen}
        title={t('courses.quit_course_title')}
        message={t('courses.quit_course_confirm')}
        confirmLabel={t('courses.quit_course')}
        onConfirm={() => quitCourse(course.course_uuid)}
      />
    </>
  )
}

export default TrailCourseCard
