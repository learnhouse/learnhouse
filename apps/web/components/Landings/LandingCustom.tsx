'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import type { LandingSection } from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'
import CourseThumbnailLanding from '@components/Objects/Thumbnails/CourseThumbnailLanding'
import { getOrgCourses } from '@services/courses/courses'
import useSWR from 'swr'

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
            className="mx-2 mt-[20px] flex min-h-[400px] w-full items-center justify-center rounded-xl border border-gray-100 sm:mx-4 sm:mt-[40px] sm:min-h-[500px] lg:mx-16"
            style={{
              background:
                section.background.type === 'solid'
                  ? section.background.color
                  : section.background.type === 'gradient'
                    ? `linear-gradient(${section.background.direction || '45deg'}, ${section.background.colors?.join(', ')})`
                    : `url(${section.background.image}) center/cover`,
            }}
          >
            <div
              className={`flex h-full w-full flex-col sm:flex-row ${
                section.illustration?.position === 'right'
                  ? 'sm:flex-row-reverse'
                  : 'sm:flex-row'
              } items-stretch`}
            >
              {/* Logo */}
              {section.illustration?.image.url && (
                <div
                  className={`flex items-${section.illustration.verticalAlign} w-full p-6 ${
                    section.illustration.size === 'small'
                      ? 'sm:w-1/4'
                      : section.illustration.size === 'medium'
                        ? 'sm:w-1/3'
                        : 'sm:w-2/5'
                  }`}
                >
                  <img
                    src={section.illustration.image.url}
                    alt={section.illustration.image.alt}
                    className="w-full object-contain"
                  />
                </div>
              )}

              {/* Content */}
              <div
                className={`flex flex-1 items-center ${
                  section.contentAlign === 'left'
                    ? 'justify-start text-left'
                    : section.contentAlign === 'right'
                      ? 'justify-end text-right'
                      : 'justify-center text-center'
                } p-6`}
              >
                <div className="max-w-2xl">
                  <h1
                    className="mb-2 text-xl font-bold sm:mb-4 sm:text-2xl md:text-3xl"
                    style={{ color: section.heading.color }}
                  >
                    {section.heading.text}
                  </h1>
                  <h2
                    className="mb-4 text-sm font-medium sm:mb-6 sm:text-base md:mb-8 md:text-lg"
                    style={{ color: section.subheading.color }}
                  >
                    {section.subheading.text}
                  </h2>
                  <div
                    className={`flex flex-col gap-3 sm:flex-row sm:gap-4 ${
                      section.contentAlign === 'left'
                        ? 'justify-start'
                        : section.contentAlign === 'right'
                          ? 'justify-end'
                          : 'justify-center'
                    } items-center`}
                  >
                    {section.buttons.map((button, index) => (
                      <a
                        key={index}
                        href={button.link}
                        className="w-full rounded-lg px-6 py-2.5 text-sm font-extrabold shadow-sm transition-transform hover:scale-105 sm:w-auto"
                        style={{
                          backgroundColor: button.background,
                          color: button.color,
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
            className="mx-2 w-full py-16 sm:mx-4 lg:mx-16"
          >
            <div
              className={`nice-shadow flex flex-col items-center gap-8 rounded-xl bg-white p-6 md:flex-row md:gap-12 md:p-8 lg:p-12 ${
                section.flow === 'right' ? 'md:flex-row-reverse' : ''
              }`}
            >
              <div className="w-full max-w-2xl flex-1">
                <h2 className="mb-4 text-2xl font-bold tracking-tight text-gray-900 md:text-3xl">
                  {section.title}
                </h2>
                <div className="prose prose-lg prose-gray max-w-none">
                  <p className="text-base leading-relaxed whitespace-pre-line text-gray-600 md:text-lg">
                    {section.text}
                  </p>
                </div>
                <div className="mt-8 flex flex-wrap gap-4">
                  {section.buttons.map((button, index) => (
                    <a
                      key={index}
                      href={button.link}
                      className="rounded-xl px-6 py-3 font-medium shadow-xs transition-all duration-200 hover:scale-105"
                      style={{
                        backgroundColor: button.background,
                        color: button.color,
                      }}
                    >
                      {button.text}
                    </a>
                  ))}
                </div>
              </div>
              <div className="w-full flex-1 md:w-auto">
                <div className="relative mx-auto w-full max-w-[500px] px-4 md:px-8">
                  <div className="relative aspect-4/3 w-full">
                    <img
                      src={section.image.url}
                      alt={section.image.alt}
                      className="h-full w-full rounded-lg object-contain"
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
            className="mx-2 w-full py-16 sm:mx-4 lg:mx-16"
          >
            {section.title && (
              <h2 className="mb-16 text-left text-2xl font-bold text-gray-900 md:text-3xl">
                {section.title}
              </h2>
            )}
            <div className="flex w-full justify-center">
              <div className="flex max-w-7xl flex-wrap justify-center gap-16">
                {section.logos.map((logo, index) => (
                  <div
                    key={index}
                    className="flex h-[120px] w-[220px] items-center justify-center"
                  >
                    <img
                      src={logo.url}
                      alt={logo.alt}
                      className="max-h-24 max-w-[200px] object-contain transition-opacity hover:opacity-80"
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
            className="mx-2 w-full py-16 sm:mx-4 lg:mx-16"
          >
            <h2 className="mb-10 text-left text-2xl font-bold text-gray-900 md:text-3xl">
              {section.title}
            </h2>
            <div className="flex flex-wrap justify-center gap-x-20 gap-y-8">
              {section.people.map((person, index) => (
                <div
                  key={index}
                  className="flex w-[140px] flex-col items-center"
                >
                  <div className="mb-4 h-24 w-24">
                    <img
                      src={person.image_url}
                      alt={person.name}
                      className="nice-shadow h-full w-full rounded-full border-4 border-white object-cover"
                    />
                  </div>
                  <h3 className="text-center text-lg font-semibold text-gray-900">
                    {person.name}
                  </h3>
                  <p className="mt-1 text-center text-sm text-gray-600">
                    {person.description}
                  </p>
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
              className="mx-2 w-full py-16 sm:mx-4 lg:mx-16"
            >
              <h2 className="mb-6 text-left text-2xl font-bold text-gray-900 md:text-3xl">
                {section.title}
              </h2>
              <div className="py-6 text-center text-gray-500">
                Loading courses...
              </div>
            </div>
          )
        }

        const featuredCourses = allCourses.filter((course: any) =>
          section.courses.includes(course.course_uuid)
        )

        return (
          <div
            key={`featured-courses-${section.title}`}
            className="mx-2 w-full py-16 sm:mx-4 lg:mx-16"
          >
            <h2 className="mb-6 text-left text-2xl font-bold text-gray-900 md:text-3xl">
              {section.title}
            </h2>
            <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {featuredCourses.map((course: any) => (
                <div
                  key={course.course_uuid}
                  className="flex w-full justify-center"
                >
                  <CourseThumbnailLanding course={course} orgslug={orgslug} />
                </div>
              ))}
              {featuredCourses.length === 0 && (
                <div className="col-span-full py-6 text-center text-gray-500">
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
    <div className="mx-auto flex h-full w-full max-w-(--breakpoint-2xl) flex-col items-center justify-between px-4 sm:px-6 lg:px-16">
      {landing.sections.map((section) => renderSection(section))}
    </div>
  )
}

export default LandingCustom
