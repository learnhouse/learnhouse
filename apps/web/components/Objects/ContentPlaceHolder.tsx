'use client';
import React from 'react'
import { useTranslation } from 'react-i18next'
import useAdminStatus from '../Hooks/useAdminStatus'


// Terrible name and terible implementation, need to be refactored asap 
function ContentPlaceHolderIfUserIsNotAdmin({ text }: { text: string }) {
    const { isAdmin: isUserAdmin } = useAdminStatus()
    const { t } = useTranslation()
    return (
        <span>{isUserAdmin ? text : t('common.no_content_yet')}</span>
    )
}

export default ContentPlaceHolderIfUserIsNotAdmin