'use client'
import React from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Award, ExternalLink, Users } from 'lucide-react'
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm px-5 py-4">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  )
}

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

  return (
    <div className="px-4 sm:px-10 pt-6 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('paths.dashboard.learners.enrolled')} value={total} />
        <Stat label={t('paths.dashboard.learners.completed')} value={completed} />
        <Stat
          label={t('paths.dashboard.learners.completion_rate')}
          value={total ? `${Math.round((100 * completed) / total)}%` : '—'}
        />
        <Stat label={t('paths.dashboard.learners.certificates')} value={certified} />
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-gray-100 rounded" />
            ))}
          </div>
        ) : total === 0 ? (
          <div className="p-10 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="font-medium text-gray-700 mb-1">{t('paths.dashboard.learners.empty_title')}</h3>
            <p className="text-sm text-gray-500">{t('paths.dashboard.learners.empty_description')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['learner', 'progress', 'started', 'status', 'certificate'].map((col) => (
                    <th
                      key={col}
                      className={`text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3 ${
                        col === 'certificate' ? 'text-end' : 'text-start'
                      }`}
                    >
                      {t(`paths.dashboard.learners.columns.${col}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {learners!.map((learner) => {
                  const name = [learner.user.first_name, learner.user.last_name].map((part) => part?.trim()).filter(Boolean).join(' ') || learner.user.username
                  return (
                    <tr key={learner.user.user_uuid} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            rounded="rounded-full"
                            width={32}
                            avatar_url={
                              learner.user.avatar_image
                                ? getUserAvatarMediaDirectory(learner.user.user_uuid, learner.user.avatar_image)
                                : ''
                            }
                            predefined_avatar={learner.user.avatar_image ? undefined : 'empty'}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900 truncate">{name}</div>
                            <div className="text-xs text-gray-500 truncate">{learner.user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3 min-w-[180px]">
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-black rounded-full" style={{ width: `${learner.percent}%` }} />
                          </div>
                          <span className="text-xs font-medium text-gray-600 tabular-nums w-20 text-end">
                            {t('paths.progress_short', { done: learner.courses_done, total: learner.courses_needed })}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {formatDate(learner.enrolled_at, i18n.language)}
                      </td>
                      <td className="px-6 py-3">
                        {learner.completed_at ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-700 rounded-full">
                            {t('paths.completed')}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-gray-100 text-gray-600 rounded-full">
                            {t('paths.in_progress')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-end">
                        {learner.certificate_uuid && learner.certificate_revoked ? (
                          <div className="inline-flex items-center gap-2">
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-700 rounded-full">
                              {t('paths.dashboard.learners.revoked_badge')}
                            </span>
                            <button
                              type="button"
                              onClick={() => reinstate(learner.certificate_uuid!)}
                              className="text-xs font-medium text-gray-700 hover:text-black"
                            >
                              {t('paths.dashboard.learners.reinstate')}
                            </button>
                          </div>
                        ) : learner.certificate_uuid ? (
                          <div className="inline-flex items-center gap-2">
                            <Link
                              href={getUriWithOrg(orgslug, `/paths/certificate/${learner.certificate_uuid}`)}
                              target="_blank"
                              className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-black"
                            >
                              <Award size={14} />
                              {t('paths.view_certificate')}
                              <ExternalLink size={12} />
                            </Link>
                            <ConfirmationModal
                              confirmationButtonText={t('paths.dashboard.learners.revoke')}
                              confirmationMessage={t('paths.dashboard.learners.revoke_confirm', { name })}
                              dialogTitle={t('paths.dashboard.learners.revoke_title')}
                              dialogTrigger={
                                <button className="text-xs font-medium text-red-600 hover:text-red-700">
                                  {t('paths.dashboard.learners.revoke')}
                                </button>
                              }
                              functionToExecute={() => revoke(learner.certificate_uuid!)}
                              status="warning"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default PathLearners
