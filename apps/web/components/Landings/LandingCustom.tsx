'use client'

import React from 'react'
import { LandingSection } from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import useSWR from 'swr'
import { getOrgCourses } from '@services/courses/courses'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import CourseThumbnailLanding from '@components/Objects/Thumbnails/CourseThumbnailLanding'

interface LandingCustomProps {
  landing: {
    sections: LandingSection[]
    enabled: boolean
  }
  orgslug: string
}

function LandingCustom({ landing, orgslug }: LandingCustomProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  // Fetch all courses for the organization
  const { data: allCourses } = useSWR(
    orgslug ? [orgslug, access_token] : null,
    ([slug, token]) => getOrgCourses(slug, null, token)
  )

  const renderSection = (section: LandingSection) => {
    switch (section.type) {
      case 'hero':
        return (
          <div 
            key={`hero-${section.title}`}
            className="min-h-[400px] sm:min-h-[500px] mt-[20px] sm:mt-[40px] mx-2 sm:mx-4 lg:mx-16 w-full flex items-center justify-center rounded-xl border border-gray-100"
            style={{
              background: section.background.type === 'solid' 
                ? section.background.color 
                : section.background.type === 'gradient'
                ? `linear-gradient(${section.background.direction || '45deg'}, ${section.background.colors?.join(', ')})`
                : `url(${section.background.image}) center/cover`
            }}
          >
            <div className={`w-full h-full flex flex-col sm:flex-row ${
              section.illustration?.position === 'right' ? 'sm:flex-row-reverse' : 'sm:flex-row'
            } items-stretch`}>
              {/* Logo */}
              {section.illustration?.image.url && (
                <div className={`flex items-${section.illustration.verticalAlign} p-6 w-full ${
                  section.illustration.size === 'small' ? 'sm:w-1/4' :
                  section.illustration.size === 'medium' ? 'sm:w-1/3' :
                  'sm:w-2/5'
                }`}>
                  <img
                    src={section.illustration.image.url}
                    alt={section.illustration.image.alt}
                    className="w-full object-contain"
                  />
                </div>
              )}

              {/* Content */}
              <div className={`flex-1 flex items-center ${
                section.contentAlign === 'left' ? 'justify-start text-left' :
                section.contentAlign === 'right' ? 'justify-end text-right' :
                'justify-center text-center'
              } p-6`}>
                <div className="max-w-2xl">
                  <h1 
                    className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 sm:mb-4"
                    style={{ color: section.heading.color }}
                  >
                    {section.heading.text}
                  </h1>
                  <h2
                    className="text-sm sm:text-base md:text-lg mb-4 sm:mb-6 md:mb-8 font-medium"
                    style={{ color: section.subheading.color }}
                  >
                    {section.subheading.text}
                  </h2>
                  <div className={`flex flex-col sm:flex-row gap-3 sm:gap-4 ${
                    section.contentAlign === 'left' ? 'justify-start' :
                    section.contentAlign === 'right' ? 'justify-end' :
                    'justify-center'
                  } items-center`}>
                    {section.buttons.map((button, index) => (
                      <a
                        key={index}
                        href={button.link}
                        className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-extrabold shadow transition-transform hover:scale-105"
                        style={{
                          backgroundColor: button.background,
                          color: button.color
                        }}
                      >
                        {button.text}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      case 'text-and-image':
        return (
          <div 
            key={`text-image-${section.title}`}
            className="py-16 mx-2 sm:mx-4 lg:mx-16 w-full"
          >
            <div className={`flex flex-col md:flex-row items-center gap-8 md:gap-12 bg-white rounded-xl p-6 md:p-8 lg:p-12 nice-shadow ${
              section.flow === 'right' ? 'md:flex-row-reverse' : ''
            }`}>
              <div className="flex-1 w-full max-w-2xl">
                <h2 className="text-2xl md:text-3xl font-bold mb-4 text-gray-900 tracking-tight">{section.title}</h2>
                <div className="prose prose-lg prose-gray max-w-none">
                  <p className="text-base md:text-lg leading-relaxed text-gray-600 whitespace-pre-line">
                    {section.text}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 mt-8">
                  {section.buttons.map((button, index) => (
                    <a
                      key={index}
                      href={button.link}
                      className="px-6 py-3 rounded-xl font-medium shadow-sm transition-all duration-200 hover:scale-105"
                      style={{
                        backgroundColor: button.background,
                        color: button.color
                      }}
                    >
                      {button.text}
                    </a>
                  ))}
                </div>
              </div>
              <div className="flex-1 w-full md:w-auto">
                <div className="relative w-full max-w-[500px] mx-auto px-4 md:px-8">
                  <div className="relative w-full aspect-[4/3]">
                    <img
                      src={section.image.url}
                      alt={section.image.alt}
                      className="object-contain w-full h-full rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      case 'logos':
        return (
          <div 
            key={`logos-${section.type}`}
            className="py-16 mx-2 sm:mx-4 lg:mx-16 w-full"
          >
            {section.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-left mb-16 text-gray-900">{section.title}</h2>
            )}
            <div className="flex justify-center w-full">
              <div className="flex flex-wrap justify-center gap-16 max-w-7xl">
                {section.logos.map((logo, index) => (
                  <div key={index} className="flex items-center justify-center w-[220px] h-[120px]">
                    <img
                      src={logo.url}
                      alt={logo.alt}
                      className="max-h-24 max-w-[200px] object-contain hover:opacity-80 transition-opacity"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      case 'people':
        return (
          <div 
            key={`people-${section.title}`}
            className="py-16 mx-2 sm:mx-4 lg:mx-16 w-full"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-left mb-10 text-gray-900">{section.title}</h2>
            <div className="flex flex-wrap justify-center gap-x-20 gap-y-8">
              {section.people.map((person, index) => (
                <div key={index} className="w-[140px] flex flex-col items-center">
                  <div className="w-24 h-24 mb-4">
                    <img
                      src={person.image_url}
                      alt={person.name}
                      className="w-full h-full rounded-full object-cover border-4 border-white nice-shadow"
                    />
                  </div>
                  <h3 className="text-lg font-semibold text-center text-gray-900">{person.name}</h3>
                  <p className="text-sm text-center text-gray-600 mt-1">{person.description}</p>
                </div>
              ))}
            </div>
          </div>
        )
      case 'featured-courses':
        if (!allCourses) {
          return (
            <div 
              key={`featured-courses-${section.title}`}
              className="py-16 mx-2 sm:mx-4 lg:mx-16 w-full"
            >
              <h2 className="text-2xl md:text-3xl font-bold text-left mb-6 text-gray-900">{section.title}</h2>
              <div className="text-center py-6 text-gray-500">Loading courses...</div>
            </div>
          )
        }

        const featuredCourses = allCourses.filter((course: any) => 
          section.courses.includes(course.course_uuid)
        )

        return (
          <div 
            key={`featured-courses-${section.title}`}
            className="py-16 mx-2 sm:mx-4 lg:mx-16 w-full"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-left mb-6 text-gray-900">{section.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
              {featuredCourses.map((course: any) => (
                <div key={course.course_uuid} className="w-full flex justify-center">
                  <CourseThumbnailLanding
                    course={course}
                    orgslug={orgslug}
                  />
                </div>
              ))}
              {featuredCourses.length === 0 && (
                <div className="col-span-full text-center py-6 text-gray-500">
                  No featured courses selected
                </div>
              )}
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col items-center justify-between w-full max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-16 h-full">
      {landing.sections.map((section) => renderSection(section))}
    </div>
  )
}

export default LandingCustom