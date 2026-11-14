'use client'
import React from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Medal, CheckCircle, Clock, ArrowSquareOut, Percent, ArrowCounterClockwise, Users } from '@phosphor-icons/react'
import { BTN_SECONDARY_SM, Chip, EmptyState, StatCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import toast from 'react-hot-toast'
import UserAvatar from '@components/Objects/UserAvatar'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { Path, reinstatePathCertificate, revokePathCertificate } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { queryKeys } from '@/lib/query/keys'
import { formatDate } from '@/lib/format'
import { usePathLearners } from '@/hooks/queries/usePaths'
import { usePathCache } from './usePathSave'

// Same subgrid table as the other dashboard lists: header and rows span the
// card's grid so the columns line up.
const TABLE_GRID =
  'lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] lg:gap-x-4'
const ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

function PathLearners({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { accessToken } = usePathCache()
  const { data: learners, isLoading } = usePathLearners(path.path_uuid)

  const total = learners?.length ?? 0
  const completed = learners?.filter((l) => l.completed_at).length ?? 0
  const certified = learners?.filter((l) => l.certificate_uuid && !l.certificate_revoked).length ?? 0

  const revoke = async (certificateUuid: string) => {
    try {
      await revokePathCertificate(path.path_uuid, certificateUuid, accessToken)
      queryClient.invalidateQueries({ queryKey: queryKeys.paths.learners(path.path_uuid) })
      toast.success(t('paths.dashboard.learners.revoked'))
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')))
    }
  }

  const reinstate = async (certificateUuid: string) => {
    try {
      await reinstatePathCertificate(path.path_uuid, certificateUuid, accessToken)
      queryClient.invalidateQueries({ queryKey: queryKeys.paths.learners(path.path_uuid) })
      toast.success(t('paths.dashboard.learners.reinstated'))
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')))
    }
  }

  const loading = isLoading
  const columns = ['learner', 'progress', 'started', 'status', 'certificate'] as const

  return (
    <div className="px-4 sm:px-10 pt-6 flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Users size={16} />}
          iconClass="bg-sky-50 text-sky-600"
          label={t('paths.dashboard.learners.enrolled')}
          value={loading ? null : total}
        />
        <StatCard
          icon={<CheckCircle size={16} />}
          iconClass="bg-emerald-50 text-emerald-600"
          label={t('paths.dashboard.learners.completed')}
          value={loading ? null : completed}
        />
        <StatCard
          icon={<Percent size={16} />}
          iconClass="bg-violet-50 text-violet-600"
          label={t('paths.dashboard.learners.completion_rate')}
          value={loading ? null : total ? `${Math.round((100 * completed) / total)}%` : '—'}
        />
        <StatCard
          icon={<Medal size={16} />}
          iconClass="bg-amber-50 text-amber-600"
          label={t('paths.dashboard.learners.certificates')}
          value={loading ? null : certified}
        />
      </div>

      <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${TABLE_GRID}`}>
        <div className={`hidden ${ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
          {columns.map((col) => (
            <span key={col} className={col === 'certificate' ? 'text-end' : ''}>
              {t(`paths.dashboard.learners.columns.${col}`)}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="animate-pulse divide-y divide-neutral-100 lg:col-span-full">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4">
                <div className="w-9 h-9 rounded-full bg-neutral-100 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-neutral-100 rounded w-1/4" />
                  <div className="h-3 bg-neutral-100 rounded w-1/3" />
                </div>
                <div className="hidden sm:block h-1.5 w-40 bg-neutral-100 rounded-full" />
              </div>
            ))}
          </div>
        ) : total === 0 ? (
          <div className="lg:col-span-full">
            <EmptyState
              icon={<Users size={22} />}
              title={t('paths.dashboard.learners.empty_title')}
              description={t('paths.dashboard.learners.empty_description')}
            />
          </div>
        ) : (
          <ul className={`divide-y divide-neutral-100 ${ROW_GRID}`}>
            {learners!.map((learner) => {
              const name =
                [learner.user.first_name, learner.user.last_name].map((part) => part?.trim()).filter(Boolean).join(' ') ||
                learner.user.username
              const done = !!learner.completed_at
              return (
                <li
                  key={learner.user.user_uuid}
                  className={`px-4 sm:px-5 py-3.5 hover:bg-neutral-50/70 transition-colors flex flex-col gap-3 lg:gap-y-0 ${ROW_GRID}`}
                >
                  {/* Learner */}
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      rounded="rounded-full"
                      width={36}
                      avatar_url={
                        learner.user.avatar_image
                          ? getUserAvatarMediaDirectory(learner.user.user_uuid, learner.user.avatar_image)
                          : ''
                      }
                      predefined_avatar={learner.user.avatar_image ? undefined : 'empty'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-neutral-900 truncate" dir="auto">{name}</div>
                      <div className="text-xs text-neutral-500 truncate">{learner.user.email}</div>
                    </div>
                    <span className="lg:hidden shrink-0">
                      <StatusChip done={done} />
                    </span>
                  </div>

                  {/* Progress */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-1.5 flex-1 bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-neutral-900'}`}
                        style={{ width: `${learner.percent}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-neutral-600 tabular-nums whitespace-nowrap">
                      {t('paths.progress_short', { done: learner.courses_done, total: learner.courses_needed })}
                    </span>
                  </div>

                  {/* Started */}
                  <div className="hidden lg:block text-sm text-neutral-600 tabular-nums whitespace-nowrap">
                    {formatDate(learner.enrolled_at, i18n.language)}
                  </div>

                  {/* Status */}
                  <div className="hidden lg:block">
                    <StatusChip done={done} />
                  </div>

                  {/* Certificate */}
                  <div className="flex items-center gap-2 lg:justify-end">
                    {learner.certificate_uuid && learner.certificate_revoked ? (
                      <>
                        <Chip tone="rose">{t('paths.dashboard.learners.revoked_badge')}</Chip>
                        <button
                          type="button"
                          onClick={() => reinstate(learner.certificate_uuid!)}
                          className={BTN_SECONDARY_SM}
                        >
                          <ArrowCounterClockwise size={13} />
                          {t('paths.dashboard.learners.reinstate')}
                        </button>
                      </>
                    ) : learner.certificate_uuid ? (
                      <>
                        <Link
                          href={getUriWithOrg(orgslug, `/paths/certificate/${learner.certificate_uuid}`)}
                          target="_blank"
                          className={BTN_SECONDARY_SM}
                        >
                          <Medal size={13} />
                          {t('paths.view_certificate')}
                          <ArrowSquareOut size={11} className="text-neutral-400" />
                        </Link>
                        <ConfirmationModal
                          confirmationButtonText={t('paths.dashboard.learners.revoke')}
                          confirmationMessage={t('paths.dashboard.learners.revoke_confirm', { name })}
                          dialogTitle={t('paths.dashboard.learners.revoke_title')}
                          dialogTrigger={
                            <button
                              type="button"
                              className="h-8 px-3 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              {t('paths.dashboard.learners.revoke')}
                            </button>
                          }
                          functionToExecute={() => revoke(learner.certificate_uuid!)}
                          status="warning"
                        />
                      </>
                    ) : (
                      <span className="hidden lg:inline text-xs text-neutral-300">—</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatusChip({ done }: { done: boolean }) {
  const { t } = useTranslation()
  return done ? (
    <Chip tone="emerald" icon={<CheckCircle size={12} />}>
      {t('paths.completed')}
    </Chip>
  ) : (
    <Chip tone="neutral" icon={<Clock size={12} />}>
      {t('paths.in_progress')}
    </Chip>
  )
}

export default PathLearners
