'use client'
import React from 'react'
import { FileArchive, GraduationCap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { PlanLevel } from '@services/plans/plans'
import { useOrg } from '@components/Contexts/OrgContext'

interface ImportTypeSelectorProps {
  onSelectType: (type: 'scorm' | 'learnhouse') => void
  currentPlan: PlanLevel
}

function ImportTypeSelector({ onSelectType, currentPlan }: ImportTypeSelectorProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const rf = org?.config?.config?.resolved_features
  const canUseScorm = rf?.scorm?.enabled === true

  return (
    <div className="min-w-[400px] py-2">
      <div className="grid grid-cols-2 gap-4">
        {/* SCORM Import Option - Enterprise only */}
        <button
          onClick={() => canUseScorm && onSelectType('scorm')}
          disabled={!canUseScorm}
          className={`group flex flex-col items-center p-6 rounded-xl border-2 transition-all duration-200 ${
            canUseScorm
              ? 'border-gray-200 bg-white hover:border-black hover:shadow-lg cursor-pointer'
              : 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
          }`}
        >
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 transition-colors ${
            canUseScorm
              ? 'bg-orange-50 group-hover:bg-orange-100'
              : 'bg-gray-100'
          }`}>
            <GraduationCap size={28} className={canUseScorm ? 'text-orange-600' : 'text-gray-400'} />
          </div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`font-semibold ${canUseScorm ? 'text-gray-900' : 'text-gray-500'}`}>
              {t('courses.import.scorm_package')}
            </h3>
            <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.scorm?.required_plan || 'enterprise') as PlanLevel} size="sm" />
          </div>
          <p className={`text-sm text-center ${canUseScorm ? 'text-gray-500' : 'text-gray-400'}`}>
            {t('courses.import.scorm_description')}
          </p>
        </button>

        {/* LearnHouse Import Option */}
        <button
          onClick={() => onSelectType('learnhouse')}
          className="group flex flex-col items-center p-6 rounded-xl border-2 border-gray-200 bg-white hover:border-black hover:shadow-lg transition-all duration-200"
        >
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors">
            <FileArchive size={28} className="text-blue-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">
            {t('courses.import.learnhouse_courses')}
          </h3>
          <p className="text-sm text-gray-500 text-center">
            {t('courses.import.learnhouse_description')}
          </p>
        </button>
      </div>
    </div>
  )
}

export default ImportTypeSelector
