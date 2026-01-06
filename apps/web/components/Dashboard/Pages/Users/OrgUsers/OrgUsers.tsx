'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import RolesUpdate from '@components/Objects/Modals/Dash/OrgUsers/RolesUpdate'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import { getAPIUrl } from '@services/config/config'
import { removeUserFromOrg } from '@services/organizations/orgs'
import { swrFetcher } from '@services/utils/ts/requests'
import { KeyRound, LogOut } from 'lucide-react'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'

function OrgUsers() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const { data: orgUsers } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/users` : null,
    (url) => swrFetcher(url, access_token)
  )
  const [rolesModal, setRolesModal] = React.useState(false)
  const [selectedUser, setSelectedUser] = React.useState(null) as any
  const [isLoading, setIsLoading] = React.useState(true)

  const handleRolesModal = (user_uuid: any) => {
    setSelectedUser(user_uuid)
    setRolesModal(!rolesModal)
  }

  const handleRemoveUser = async (user_id: any) => {
    const toastId = toast.loading(t('dashboard.users.active_users.actions.removing'));
    const res = await removeUserFromOrg(org.id, user_id,access_token)
    if (res.status === 200) {
      await mutate(`${getAPIUrl()}orgs/${org.id}/users`)
      toast.success(t('dashboard.users.active_users.actions.remove_success'), {id:toastId});
    } else {
      toast.error(t('dashboard.users.active_users.actions.remove_error'), {id:toastId});
    }
  }

  useEffect(() => {
    if (orgUsers) {
      setIsLoading(false)
    }
  }, [org, orgUsers])

  return (
    <div>
      {isLoading ? (
        <div>
          <PageLoading />
        </div>
      ) : (
        <>
          <Toast></Toast>
          <div className="h-6"></div>
          <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-xs px-4 py-4  ">
            <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mb-3 ">
              <h1 className="font-bold text-xl text-gray-800">{t('dashboard.users.active_users.title')}</h1>
              <h2 className="text-gray-500  text-md">
                {' '}
                {t('dashboard.users.active_users.subtitle')}{' '}
              </h2>
            </div>
            <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
              <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                <tr className="font-bolder text-sm">
                  <th className="py-3 px-4">{t('dashboard.users.active_users.table.user')}</th>
                  <th className="py-3 px-4">{t('dashboard.users.active_users.table.role')}</th>
                  <th className="py-3 px-4">{t('dashboard.users.active_users.table.actions')}</th>
                </tr>
              </thead>
              <>
                <tbody className="mt-5 bg-white rounded-md">
                  {orgUsers?.map((user: any) => (
                    <tr
                      key={user.user.id}
                      className="border-b border-gray-200 border-dashed"
                    >
                      <td className="py-3 px-4 flex space-x-2 items-center">
                        <span>
                          {user.user.first_name + ' ' + user.user.last_name}
                        </span>
                        <span className="text-xs bg-neutral-100 p-1 px-2 rounded-full text-neutral-400 font-semibold">
                          @{user.user.username}
                        </span>
                      </td>
                      <td className="py-3 px-4">{user.role.name}</td>
                      <td className="py-3 px-4 flex space-x-2 items-end">
                        <Modal
                          isDialogOpen={
                            rolesModal && selectedUser === user.user.user_uuid
                          }
                          onOpenChange={() =>
                            handleRolesModal(user.user.user_uuid)
                          }
                          minHeight="no-min"
                          dialogContent={
                            <RolesUpdate
                              alreadyAssignedRole={user.role.role_uuid}
                              setRolesModal={setRolesModal}
                              user={user}
                            />
                          }
                          dialogTitle={t('dashboard.users.active_users.modals.update_role.title')}
                          dialogDescription={
                            t('dashboard.users.active_users.modals.update_role.description', { username: user.user.username })
                          }
                          dialogTrigger={
                            <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-yellow-700 rounded-md font-bold items-center text-sm text-yellow-100">
                              <KeyRound className="w-4 h-4" />
                              <span> {t('dashboard.users.active_users.actions.edit_role')}</span>
                            </button>
                          }
                        />

                        <ConfirmationModal
                          confirmationButtonText={t('dashboard.users.active_users.modals.remove_user.button')}
                          confirmationMessage={t('dashboard.users.active_users.modals.remove_user.message')}
                          dialogTitle={t('dashboard.users.active_users.modals.remove_user.title', { username: user.user.username })}
                          dialogTrigger={
                            <button className="mr-2 flex space-x-2 hover:cursor-pointer p-1 px-3 bg-rose-700 rounded-md font-bold items-center text-sm text-rose-100">
                              <LogOut className="w-4 h-4" />
                              <span> {t('dashboard.users.active_users.actions.remove_from_org')}</span>
                            </button>
                          }
                          functionToExecute={() => {
                            handleRemoveUser(user.user.id)
                          }}
                          status="warning"
                        ></ConfirmationModal>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default OrgUsers
