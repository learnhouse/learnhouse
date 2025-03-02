'use client'

import React from 'react'
import { LandingSection } from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import useSWR from 'swr'
import { getOrgCourses } from '@services/courses/courses'
import { useLHSession } from '@components/Contexts/LHSessionContext'

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
            <div className="text-center w-full max-w-4xl mx-auto px-4 sm:px-6">
              <h1 
                className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 sm:mb-4"
                style={{ color: section.heading.color }}
              >
                {section.heading.text}
              </h1>
              <h2
                className="text-sm sm:text-base md:text-lg mb-4 sm:mb-6 md:mb-8 font-medium px-4 max-w-2xl mx-auto"
                style={{ color: section.subheading.color }}
              >
                {section.subheading.text}
              </h2>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center">
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
        )
      case 'text-and-image':
        return (
          <div 
            key={`text-image-${section.title}`}
            className="mt-[20px] sm:mt-[40px] mx-2 sm:mx-4 lg:mx-16 w-full"
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
                <div className="relative w-full aspect-[4/3] max-w-[500px] mx-auto">
                  <img
                    src={section.image.url}
                    alt={section.image.alt}
                    className="object-cover w-full h-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )
      case 'logos':
        return (
          <div 
            key={`logos-${section.type}`}
            className="mt-[20px] sm:mt-[40px] mx-2 sm:mx-4 lg:mx-16 w-full py-20"
          >
            {section.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-left mb-16 text-gray-900">{section.title}</h2>
            )}
            <div className="flex justify-center w-full">
              <div className="flex flex-wrap justify-center gap-16 max-w-6xl">
                {section.logos.map((logo, index) => (
                  <div key={index} className="flex items-center justify-center w-[140px] h-[80px]">
                    <img
                      src={logo.url}
                      alt={logo.alt}
                      className="max-h-16 max-w-[120px] object-contain hover:opacity-80 transition-opacity"
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
            className="mt-[20px] sm:mt-[40px] mx-2 sm:mx-4 lg:mx-16 w-full py-16"
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
              className="mt-[20px] sm:mt-[40px] mx-2 sm:mx-4 lg:mx-16 w-full py-12"
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
            className="mt-[20px] sm:mt-[40px] mx-2 sm:mx-4 lg:mx-16 w-full py-12"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-left mb-6 text-gray-900">{section.title}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
              {featuredCourses.map((course: any) => (
                <div key={course.course_uuid} >
                  <CourseThumbnail
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