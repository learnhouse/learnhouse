'use client';

import React from 'react'
import UserAvatar from '@components/Objects/UserAvatar'
import { 
  Briefcase, 
  Building2, 
  MapPin, 
  Globe, 
  Link as LinkIcon, 
  GraduationCap,
  Award,
  BookOpen,
  Laptop2,
  Users,
  Calendar,
  Lightbulb
} from 'lucide-react'
import { getUserAvatarMediaDirectory } from '@services/media/media'

interface UserProfileClientProps {
  userData: any;
  profile: any;
}

const ICON_MAP = {
  'briefcase': Briefcase,
  'graduation-cap': GraduationCap,
  'map-pin': MapPin,
  'building-2': Building2,
  'speciality': Lightbulb,
  'globe': Globe,
  'laptop-2': Laptop2,
  'award': Award,
  'book-open': BookOpen,
  'link': LinkIcon,
  'users': Users,
  'calendar': Calendar,
} as const

function UserProfileClient({ userData, profile }: UserProfileClientProps) {
  const IconComponent = ({ iconName }: { iconName: string }) => {
    const IconElement = ICON_MAP[iconName as keyof typeof ICON_MAP]
    if (!IconElement) return null
    return <IconElement className="w-4 h-4 text-gray-600" />
  }

  return (
    <div className="container mx-auto py-8">
      {/* Banner */}
      <div className="h-48 w-full bg-gray-100 rounded-t-xl mb-0 relative overflow-hidden">
        {/* Optional banner content */}
      </div>
      
      {/* Profile Content */}
      <div className="bg-white rounded-b-xl nice-shadow p-8 relative">
        {/* Avatar Positioned on the banner */}
        <div className="absolute -top-24 left-8">
          <div className="rounded-xl overflow-hidden shadow-lg border-4 border-white">
            <UserAvatar
              width={150}
              avatar_url={userData.avatar_image ? getUserAvatarMediaDirectory(userData.user_uuid, userData.avatar_image) : ''}
              predefined_avatar={userData.avatar_image ? undefined : 'empty'}
              userId={userData.id}
              showProfilePopup
              rounded="rounded-xl"
            />
          </div>
        </div>

        {/* Affiliation Logos */}
        <div className="absolute -top-12 right-8 flex items-center gap-4">
          {profile.sections?.map((section: any) => (
            section.type === 'affiliation' && section.affiliations?.map((affiliation: any, index: number) => (
              affiliation.logoUrl && (
                <div key={index} className="bg-white rounded-lg p-2 shadow-lg border-2 border-white">
                  <img 
                    src={affiliation.logoUrl} 
                    alt={affiliation.name}
                    className="w-16 h-16 object-contain"
                    title={affiliation.name}
                  />
                </div>
              )
            ))
          ))}
        </div>

        {/* Profile Content with right padding to avoid overlap */}
        <div className="mt-20 md:mt-14">
          <div className="flex flex-col md:flex-row gap-12">
            {/* Left column with details - aligned with avatar */}
            <div className="w-full md:w-1/6 pl-2">
              {/* Name */}
              <h1 className="text-[32px] font-bold mb-8">
                {userData.first_name} {userData.last_name}
              </h1>

              {/* Details */}
              <div className="flex flex-col space-y-3">
                {userData.details && Object.values(userData.details).map((detail: any) => (
                  <div key={detail.id} className="flex items-center gap-4">
                    <div className="flex-shrink-0">
                      <IconComponent iconName={detail.icon} />
                    </div>
                    <span className="text-gray-700 text-[15px] font-medium">{detail.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right column with about and related content */}
            <div className="w-full md:w-4/6">
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-4">About</h2>
                {userData.bio ? (
                  <p className="text-gray-700">{userData.bio}</p>
                ) : (
                  <p className="text-gray-500 italic">No biography provided</p>
                )}
              </div>
              
              {/* Profile sections from profile builder */}
              {profile.sections && profile.sections.length > 0 && (
                <div>
                  {profile.sections.map((section: any, index: number) => (
                    <div key={index} className="mb-8">
                      <h2 className="text-xl font-semibold mb-4">{section.title}</h2>
                      
                      {section.type === 'text' && (
                        <div className="prose max-w-none">{section.content}</div>
                      )}
                      
                      {section.type === 'links' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {section.links.map((link: any, linkIndex: number) => (
                            <a
                              key={linkIndex}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center space-x-2 text-blue-600 hover:text-blue-800"
                            >
                              <LinkIcon className="w-4 h-4" />
                              <span>{link.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      
                      {section.type === 'skills' && (
                        <div className="flex flex-wrap gap-2">
                          {section.skills.map((skill: any, skillIndex: number) => (
                            <span
                              key={skillIndex}
                              className="px-3 py-1 bg-gray-100 rounded-full text-sm"
                            >
                              {skill.name}
                              {skill.level && ` • ${skill.level}`}
                            </span>
                          ))}
                        </div>
                      )}
                      
                      {section.type === 'experience' && (
                        <div className="space-y-4">
                          {section.experiences.map((exp: any, expIndex: number) => (
                            <div key={expIndex} className="border-l-2 border-gray-200 pl-4">
                              <h3 className="font-medium">{exp.title}</h3>
                              <p className="text-gray-600">{exp.organization}</p>
                              <p className="text-sm text-gray-500">
                                {exp.startDate} - {exp.current ? 'Present' : exp.endDate}
                              </p>
                              {exp.description && (
                                <p className="mt-2 text-gray-700">{exp.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {section.type === 'education' && (
                        <div className="space-y-4">
                          {section.education.map((edu: any, eduIndex: number) => (
                            <div key={eduIndex} className="border-l-2 border-gray-200 pl-4">
                              <h3 className="font-medium">{edu.institution}</h3>
                              <p className="text-gray-600">{edu.degree} in {edu.field}</p>
                              <p className="text-sm text-gray-500">
                                {edu.startDate} - {edu.current ? 'Present' : edu.endDate}
                              </p>
                              {edu.description && (
                                <p className="mt-2 text-gray-700">{edu.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {section.type === 'affiliation' && (
                        <div className="space-y-4">
                          {section.affiliations.map((affiliation: any, affIndex: number) => (
                            <div key={affIndex} className="border-l-2 border-gray-200 pl-4">
                              <div className="flex items-start gap-4">
                                {affiliation.logoUrl && (
                                  <img 
                                    src={affiliation.logoUrl} 
                                    alt={affiliation.name}
                                    className="w-12 h-12 object-contain"
                                  />
                                )}
                                <div>
                                  <h3 className="font-medium">{affiliation.name}</h3>
                                  {affiliation.description && (
                                    <p className="mt-2 text-gray-700">{affiliation.description}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UserProfileClient 