import React from 'react'
import { LandingSection } from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'

interface LandingCustomProps {
  landing: {
    sections: LandingSection[]
    enabled: boolean
  }
  orgslug: string
}

function LandingCustom({ landing, orgslug }: LandingCustomProps) {
  const renderSection = (section: LandingSection) => {
    switch (section.type) {
      case 'hero':
        return (
          <div 
            key={`hero-${section.title}`}
            className="min-h-[500px] flex items-center justify-center"
            style={{
              background: section.background.type === 'solid' 
                ? section.background.color 
                : section.background.type === 'gradient'
                ? `linear-gradient(${section.background.direction || '45deg'}, ${section.background.colors?.join(', ')})`
                : `url(${section.background.image}) center/cover`
            }}
          >
            <div className="text-center">
              <h1 
                className="text-5xl font-bold mb-4"
                style={{ color: section.heading.color }}
              >
                {section.heading.text}
              </h1>
              <h2
                className="text-2xl mb-8"
                style={{ color: section.subheading.color }}
              >
                {section.subheading.text}
              </h2>
              <div className="flex gap-4 justify-center">
                {section.buttons.map((button, index) => (
                  <a
                    key={index}
                    href={button.link}
                    className="px-6 py-3 rounded-lg font-medium"
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
            className="container mx-auto py-16 px-4"
          >
            <div className={`flex items-center gap-12 ${section.flow === 'right' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className="flex-1">
                <h2 className="text-3xl font-bold mb-4">{section.title}</h2>
                <p className="text-lg text-gray-600 mb-6">{section.text}</p>
                <div className="flex gap-4">
                  {section.buttons.map((button, index) => (
                    <a
                      key={index}
                      href={button.link}
                      className="px-6 py-3 rounded-lg font-medium"
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
              <div className="flex-1">
                <img
                  src={section.image.url}
                  alt={section.image.alt}
                  className="rounded-lg shadow-lg w-full"
                />
              </div>
            </div>
          </div>
        )
      case 'logos':
        return (
          <div 
            key={`logos-${section.type}`}
            className="container mx-auto py-16 px-4"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-8 items-center">
              {section.logos.map((logo, index) => (
                <img
                  key={index}
                  src={logo.url}
                  alt={logo.alt}
                  className="h-12 object-contain mx-auto"
                />
              ))}
            </div>
          </div>
        )
      case 'people':
        return (
          <div 
            key={`people-${section.title}`}
            className="container mx-auto py-16 px-4"
          >
            <h2 className="text-3xl font-bold text-center mb-12">{section.title}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {section.people.map((person, index) => (
                <div key={index} className="text-center">
                  <img
                    src={person.image_url}
                    alt={person.name}
                    className="w-32 h-32 rounded-full mx-auto mb-4 object-cover"
                  />
                  <h3 className="text-xl font-semibold mb-2">{person.name}</h3>
                  <p className="text-gray-600">{person.description}</p>
                </div>
              ))}
            </div>
          </div>
        )
      case 'featured-courses':
        return (
          <div 
            key={`featured-courses-${section.title}`}
            className="container mx-auto py-16 px-4"
          >
            <h2 className="text-3xl font-bold text-center mb-12">{section.title}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {section.courses.map((course, index) => (
                <div key={index} className="bg-white rounded-lg shadow-lg p-4">
                  {/* Course card content - you'll need to fetch course details */}
                  <p>Course ID: {course.course_uuid}</p>
                </div>
              ))}
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="w-full">
      {landing.sections.map((section) => renderSection(section))}
    </div>
  )
}

export default LandingCustom