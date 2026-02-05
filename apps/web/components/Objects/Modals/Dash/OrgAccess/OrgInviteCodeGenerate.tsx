import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { createInviteCode } from '@services/organizations/invites'
import { swrFetcher } from '@services/utils/ts/requests'
import { Ticket, UserSquare, Users } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

type OrgInviteCodeGenerateProps = {
    setInvitesModal: any
}

function OrgInviteCodeGenerate(props: OrgInviteCodeGenerateProps) {
  const { t } = useTranslation()
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const [mode, setMode] = React.useState<'normal' | 'usergroup'>('normal');
    const [usergroup_id, setUsergroup_id] = React.useState(0);

    const { data: usergroups } = useSWR(
        org ? `${getAPIUrl()}usergroups/org/${org.id}?org_id=${org.id}` : null,
        (url) => swrFetcher(url, access_token)
    )

    async function handleGenerate() {
        const ugId = mode === 'usergroup' && usergroup_id ? usergroup_id : undefined
        let res = await createInviteCode(org.id, session.data?.tokens?.access_token, ugId)
        if (res.status == 200) {
            mutate(`${getAPIUrl()}orgs/${org.id}/invites`)
            props.setInvitesModal(false)
        } else {
            toast.error(t('dashboard.users.signups.generate_modal.toasts.error', { status: res.status, detail: res.data.detail }))
        }
    }

    useEffect(() => {
        if (usergroups && usergroups.length > 0) {
            setUsergroup_id(usergroups[0].id)
        }
    }, [usergroups])

    return (
        <div className='flex flex-col space-y-4 pt-2'>
            {/* Mode selection — two clickable cards side by side */}
            <div className='flex space-x-3'>
                {/* Normal invite card */}
                <div
                    onClick={() => setMode('normal')}
                    className={`flex flex-col items-center justify-center w-full h-[120px] rounded-xl cursor-pointer transition-all
                        ${mode === 'normal'
                            ? 'bg-green-50 ring-2 ring-green-600'
                            : 'bg-slate-100 hover:bg-slate-200'
                        }`}
                >
                    <Users className={`w-7 h-7 mb-2 ${mode === 'normal' ? 'text-green-700' : 'text-slate-400'}`} />
                    <span className={`text-sm font-bold ${mode === 'normal' ? 'text-green-800' : 'text-slate-600'}`}>
                        {t('dashboard.users.signups.generate_modal.normal_title')}
                    </span>
                    <span className={`text-xs mt-0.5 ${mode === 'normal' ? 'text-green-600' : 'text-slate-400'}`}>
                        {t('dashboard.users.signups.generate_modal.normal_description')}
                    </span>
                </div>

                {/* Linked to usergroup card */}
                <div
                    onClick={() => {
                        if (usergroups && usergroups.length > 0) setMode('usergroup')
                    }}
                    className={`flex flex-col items-center justify-center w-full h-[120px] rounded-xl cursor-pointer transition-all
                        ${!usergroups || usergroups.length === 0
                            ? 'opacity-50 cursor-not-allowed bg-slate-100'
                            : mode === 'usergroup'
                                ? 'bg-blue-50 ring-2 ring-blue-600'
                                : 'bg-slate-100 hover:bg-slate-200'
                        }`}
                >
                    <UserSquare className={`w-7 h-7 mb-2 ${mode === 'usergroup' ? 'text-blue-700' : 'text-slate-400'}`} />
                    <span className={`text-sm font-bold ${mode === 'usergroup' ? 'text-blue-800' : 'text-slate-600'}`}>
                        {t('dashboard.users.signups.generate_modal.linked_title')}
                    </span>
                    <span className={`text-xs mt-0.5 ${mode === 'usergroup' ? 'text-blue-600' : 'text-slate-400'}`}>
                        {t('dashboard.users.signups.generate_modal.linked_description')}
                    </span>
                </div>
            </div>

            {/* Usergroup selector — slides in when usergroup mode is active */}
            {mode === 'usergroup' && usergroups && usergroups.length > 0 && (
                <div className='bg-blue-50 rounded-lg p-3'>
                    <label className='text-xs font-medium text-blue-700 mb-1.5 block'>Select User Group</label>
                    <select
                        value={usergroup_id}
                        onChange={(e) => setUsergroup_id(Number(e.target.value))}
                        className='w-full p-2 rounded-md text-sm bg-white border border-blue-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none'
                    >
                        {usergroups.map((usergroup: any) => (
                            <option key={usergroup.id} value={usergroup.id}>
                                {usergroup.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* No usergroups hint */}
            {(!usergroups || usergroups.length === 0) && (
                <div className='flex items-center justify-center space-x-3 text-xs py-1'>
                    <span className='text-yellow-700 font-medium'>
                        {t('dashboard.users.signups.generate_modal.no_usergroups')}
                    </span>
                    <Link
                        className='px-3 text-blue-700 font-bold rounded-full py-1 bg-blue-100'
                        target='_blank'
                        href={getUriWithOrg(org.slug, '/dash/users/settings/usergroups')}
                    >
                        {t('dashboard.users.signups.generate_modal.create_usergroup_link')}
                    </Link>
                </div>
            )}

            {/* Generate button */}
            <div className='flex justify-end pt-1'>
                <button
                    onClick={handleGenerate}
                    className={`flex space-x-2 hover:cursor-pointer p-2 px-5 rounded-lg font-bold items-center text-sm transition-colors
                        ${mode === 'usergroup'
                            ? 'bg-blue-700 text-blue-100 hover:bg-blue-800'
                            : 'bg-green-700 text-green-100 hover:bg-green-800'
                        }`}
                >
                    <Ticket className="w-4 h-4" />
                    <span>{t('dashboard.users.signups.generate_modal.generate_button')}</span>
                </button>
            </div>
        </div>
    )
}

export default OrgInviteCodeGenerate
