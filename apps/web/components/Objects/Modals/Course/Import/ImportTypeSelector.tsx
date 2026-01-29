'use client'
import React from 'react'
import { FileArchive, GraduationCap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ImportTypeSelectorProps {
  onSelectType: (type: 'scorm' | 'learnhouse') => void
}

function ImportTypeSelector({ onSelectType }: ImportTypeSelectorProps) {
  const { t } = useTranslation()

  return (
    <div className="min-w-[400px] py-2">
      <div className="grid grid-cols-2 gap-4">
        {/* SCORM Import Option */}
        <button
          onClick={() => onSelectType('scorm')}
          className="group flex flex-col items-center p-6 rounded-xl border-2 border-gray-200 bg-white hover:border-black hover:shadow-lg transition-all duration-200"
        >
          <div className="w-14 h-14 rounded-full bg-orange-50 flex items-center justify-center mb-4 group-hover:bg-orange-100 transition-colors">
            <GraduationCap size={28} className="text-orange-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">
            {t('courses.import.scorm_package')}
          </h3>
          <p className="text-sm text-gray-500 text-center">
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
