'use client'

import React from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAllUserCertificates } from '@services/courses/certifications'
import { getUriWithOrg } from '@services/config/config'
import { Award, ExternalLink, Calendar, Hash, Building } from 'lucide-react'
import Link from 'next/link'
import useSWR from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'

interface UserCertificatesProps {
  orgslug: string
}

const UserCertificates: React.FC<UserCertificatesProps> = ({ orgslug }) => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const { data: certificates, error, isLoading } = useSWR(
    access_token ? `${getAPIUrl()}certifications/user/all` : null,
    (url) => swrFetcher(url, access_token)
  )

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Award className="w-6 h-6 text-yellow-500" />
          <h2 className="text-xl font-semibold text-gray-900">My Certificates</h2>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-100 h-20 rounded-lg"></div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Award className="w-6 h-6 text-yellow-500" />
          <h2 className="text-xl font-semibold text-gray-900">My Certificates</h2>
        </div>
        <div className="text-center py-8">
          <p className="text-gray-500">Failed to load certificates</p>
        </div>
      </div>
    )
  }

  // Handle the actual API response structure - certificates are returned as an array directly
  const certificatesData = Array.isArray(certificates) ? certificates : certificates?.data || []

  if (!certificatesData || certificatesData.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Award className="w-6 h-6 text-yellow-500" />
          <h2 className="text-xl font-semibold text-gray-900">My Certificates</h2>
        </div>
        <div className="text-center py-8">
          <Award className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No certificates earned yet</p>
          <p className="text-sm text-gray-400 mt-1">Complete courses to earn certificates</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center space-x-3 mb-6">
        <Award className="w-6 h-6 text-yellow-500" />
        <h2 className="text-xl font-semibold text-gray-900">My Certificates</h2>
        <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
          {certificatesData.length}
        </span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {certificatesData.map((certificate: any) => {
          const verificationLink = getUriWithOrg(orgslug, `/certificates/${certificate.certificate_user.user_certification_uuid}/verify`)
          const awardedDate = new Date(certificate.certificate_user.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })

          return (
            <div key={certificate.certificate_user.user_certification_uuid} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Award className="w-4 h-4 text-yellow-500" />
                  <h3 className="font-semibold text-gray-900 text-sm truncate">
                    {certificate.certification.config.certification_name}
                  </h3>
                </div>
                
                <div className="space-y-2 text-xs text-gray-600">
                  <div className="flex items-center space-x-2">
                    <Building className="w-3 h-3" />
                    <span className="truncate">{certificate.course.name}</span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Calendar className="w-3 h-3" />
                    <span>Awarded {awardedDate}</span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Hash className="w-3 h-3" />
                    <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded truncate">
                      {certificate.certificate_user.user_certification_uuid}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <div className="text-xs text-gray-500 capitalize">
                    {certificate.certification.config.certification_type.replace('_', ' ')}
                  </div>
                  <Link
                    href={verificationLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-700 text-xs font-medium"
                  >
                    <span>Verify</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default UserCertificates 