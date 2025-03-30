import React from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { Plus, Trash2, GripVertical, ImageIcon, Link as LinkIcon, Award, ArrowRight, Edit, TextIcon, Briefcase, GraduationCap, Upload, MapPin } from 'lucide-react'
import { Input } from "@components/ui/input"
import { Textarea } from "@components/ui/textarea"
import { Label } from "@components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select"
import { Button } from "@components/ui/button"
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateProfile } from '@services/settings/profile'
import { getUser } from '@services/users/users'
import { toast } from 'react-hot-toast'
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@components/ui/tabs"

// Define section types and their configurations
const SECTION_TYPES = {
  'image-gallery': {
    icon: ImageIcon,
    label: 'Image Gallery',
    description: 'Add a collection of images'
  },
  'text': {
    icon: TextIcon,
    label: 'Text',
    description: 'Add formatted text content'
  },
  'links': {
    icon: LinkIcon,
    label: 'Links',
    description: 'Add social or professional links'
  },
  'skills': {
    icon: Award,
    label: 'Skills',
    description: 'Showcase your skills and expertise'
  },
  'experience': {
    icon: Briefcase,
    label: 'Experience',
    description: 'Add work or project experience'
  },
  'education': {
    icon: GraduationCap,
    label: 'Education',
    description: 'Add educational background'
  },
  'affiliation': {
    icon: MapPin,
    label: 'Affiliation',
    description: 'Add organizational affiliations'
  }
} as const

// Type definitions
interface ProfileImage {
  url: string;
  caption?: string;
}

interface ProfileLink {
  title: string;
  url: string;
  icon?: string;
}

interface ProfileSkill {
  name: string;
  level?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category?: string;
}

interface ProfileExperience {
  title: string;
  organization: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  description: string;
}

interface ProfileEducation {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  description?: string;
}

interface ProfileAffiliation {
  name: string;
  description: string;
  logoUrl: string;
}

interface BaseSection {
  id: string;
  type: keyof typeof SECTION_TYPES;
  title: string;
}

interface ImageGallerySection extends BaseSection {
  type: 'image-gallery';
  images: ProfileImage[];
}

interface TextSection extends BaseSection {
  type: 'text';
  content: string;
}

interface LinksSection extends BaseSection {
  type: 'links';
  links: ProfileLink[];
}

interface SkillsSection extends BaseSection {
  type: 'skills';
  skills: ProfileSkill[];
}

interface ExperienceSection extends BaseSection {
  type: 'experience';
  experiences: ProfileExperience[];
}

interface EducationSection extends BaseSection {
  type: 'education';
  education: ProfileEducation[];
}

interface AffiliationSection extends BaseSection {
  type: 'affiliation';
  affiliations: ProfileAffiliation[];
}

type ProfileSection = 
  | ImageGallerySection 
  | TextSection 
  | LinksSection 
  | SkillsSection 
  | ExperienceSection 
  | EducationSection
  | AffiliationSection;

interface ProfileData {
  sections: ProfileSection[];
}

const UserProfileBuilder = () => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [profileData, setProfileData] = React.useState<ProfileData>({
    sections: []
  })
  const [selectedSection, setSelectedSection] = React.useState<number | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)

  // Initialize profile data from user data
  React.useEffect(() => {
    const fetchUserData = async () => {
      if (session?.data?.user?.id && access_token) {
        try {
          setIsLoading(true)
          const userData = await getUser(session.data.user.id, access_token)
          
          if (userData.profile) {
            try {
              const profileSections = typeof userData.profile === 'string'
                ? JSON.parse(userData.profile).sections
                : userData.profile.sections;

              setProfileData({
                sections: profileSections || []
              });
            } catch (error) {
              console.error('Error parsing profile data:', error);
              setProfileData({ sections: [] });
            }
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          toast.error('Failed to load profile data');
        } finally {
          setIsLoading(false)
        }
      }
    };

    fetchUserData();
  }, [session?.data?.user?.id, access_token])

  const createEmptySection = (type: keyof typeof SECTION_TYPES): ProfileSection => {
    const baseSection = {
      id: `section-${Date.now()}`,
      type,
      title: `New ${SECTION_TYPES[type].label} Section`
    }

    switch (type) {
      case 'image-gallery':
        return {
          ...baseSection,
          type: 'image-gallery',
          images: []
        }
      case 'text':
        return {
          ...baseSection,
          type: 'text',
          content: ''
        }
      case 'links':
        return {
          ...baseSection,
          type: 'links',
          links: []
        }
      case 'skills':
        return {
          ...baseSection,
          type: 'skills',
          skills: []
        }
      case 'experience':
        return {
          ...baseSection,
          type: 'experience',
          experiences: []
        }
      case 'education':
        return {
          ...baseSection,
          type: 'education',
          education: []
        }
      case 'affiliation':
        return {
          ...baseSection,
          type: 'affiliation',
          affiliations: []
        }
    }
  }

  const addSection = (type: keyof typeof SECTION_TYPES) => {
    const newSection = createEmptySection(type)
    setProfileData(prev => ({
      ...prev,
      sections: [...prev.sections, newSection]
    }))
    setSelectedSection(profileData.sections.length)
  }

  const updateSection = (index: number, updatedSection: ProfileSection) => {
    const newSections = [...profileData.sections]
    newSections[index] = updatedSection
    setProfileData(prev => ({
      ...prev,
      sections: newSections
    }))
  }

  const deleteSection = (index: number) => {
    setProfileData(prev => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index)
    }))
    setSelectedSection(null)
  }

  const onDragEnd = (result: any) => {
    if (!result.destination) return

    const items = Array.from(profileData.sections)
    const [reorderedItem] = items.splice(result.source.index, 1)
    items.splice(result.destination.index, 0, reorderedItem)

    setProfileData(prev => ({
      ...prev,
      sections: items
    }))
    setSelectedSection(result.destination.index)
  }

  const handleSave = async () => {
    setIsSaving(true)
    const loadingToast = toast.loading('Saving profile...')

    try {
      // Get fresh user data before update
      const userData = await getUser(session.data.user.id, access_token)
      
      // Update only the profile field
      userData.profile = profileData

      const res = await updateProfile(userData, userData.id, access_token)

      if (res.status === 200) {
        toast.success('Profile updated successfully', { id: loadingToast })
      } else {
        throw new Error('Failed to update profile')
      }
    } catch (error) {
      console.error('Error updating profile:', error)
      toast.error('Error updating profile', { id: loadingToast })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center">Profile Builder <div className="text-xs ml-2 bg-gray-200 text-gray-700 px-2 py-1 rounded-full">BETA</div></h2>
            <p className="text-gray-600">Customize your professional profile</p>
          </div>
          <Button 
            variant="default" 
            onClick={handleSave}
            disabled={isSaving}
            className="bg-black hover:bg-black/90"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-4 gap-6">
          {/* Sections Panel */}
          <div className="col-span-1 border-r pr-4">
            <h3 className="font-medium mb-4">Sections</h3>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="sections">
                {(provided) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="space-y-2"
                  >
                    {profileData.sections.map((section, index) => (
                      <Draggable
                        key={section.id}
                        draggableId={section.id}
                        index={index}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            onClick={() => setSelectedSection(index)}
                            className={`p-4 bg-white/80 backdrop-blur-xs rounded-lg cursor-pointer border ${
                              selectedSection === index 
                                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20 shadow-xs' 
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 hover:shadow-xs'
                            } ${snapshot.isDragging ? 'shadow-lg ring-2 ring-blue-500/20 rotate-2' : ''}`}
                          >
                            <div className="flex items-center justify-between group">
                              <div className="flex items-center space-x-3">
                                <div {...provided.dragHandleProps} 
                                  className={`p-1.5 rounded-md transition-colors duration-200 ${
                                    selectedSection === index 
                                      ? 'text-blue-500 bg-blue-100/50' 
                                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                  }`}>
                                  <GripVertical size={16} />
                                </div>
                                <div className={`p-1.5 rounded-md ${
                                  selectedSection === index 
                                    ? 'text-blue-600 bg-blue-100/50' 
                                    : 'text-gray-600 bg-gray-100/50'
                                }`}>
                                  {React.createElement(SECTION_TYPES[section.type].icon, {
                                    size: 16
                                  })}
                                </div>
                                <span className={`text-sm font-medium truncate ${
                                  selectedSection === index 
                                    ? 'text-blue-700' 
                                    : 'text-gray-700'
                                }`}>
                                  {section.title}
                                </span>
                              </div>
                              <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedSection(index)
                                  }}
                                  className={`p-1.5 rounded-md transition-colors duration-200 ${
                                    selectedSection === index
                                      ? 'text-blue-500 hover:bg-blue-100'
                                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                  }`}
                                >
                                  <Edit size={14} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    deleteSection(index)
                                  }}
                                  className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors duration-200"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            <div className="pt-4">
              <Select
                onValueChange={(value: keyof typeof SECTION_TYPES) => {
                  if (value) {
                    addSection(value)
                  }
                }}
              >
                <SelectTrigger className="w-full p-0 border-0 bg-black">
                  <div className="w-full">
                    <Button variant="default" className="w-full bg-black hover:bg-black/90 text-white">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Section
                    </Button>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SECTION_TYPES).map(([type, { icon: Icon, label, description }]) => (
                    <SelectItem key={type} value={type}>
                      <div className="flex items-center space-x-3 py-1">
                        <div className="p-1.5 bg-gray-50 rounded-md">
                          <Icon size={16} className="text-gray-600" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-sm text-gray-700">{label}</div>
                          <div className="text-xs text-gray-500">{description}</div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Editor Panel */}
          <div className="col-span-3">
            {selectedSection !== null ? (
              <SectionEditor
                section={profileData.sections[selectedSection]}
                onChange={(updatedSection) => updateSection(selectedSection, updatedSection as ProfileSection)}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                Select a section to edit or add a new one
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface SectionEditorProps {
  section: ProfileSection;
  onChange: (section: ProfileSection) => void;
}

const SectionEditor: React.FC<SectionEditorProps> = ({ section, onChange }) => {
  switch (section.type) {
    case 'image-gallery':
      return <ImageGalleryEditor section={section} onChange={onChange} />
    case 'text':
      return <TextEditor section={section} onChange={onChange} />
    case 'links':
      return <LinksEditor section={section} onChange={onChange} />
    case 'skills':
      return <SkillsEditor section={section} onChange={onChange} />
    case 'experience':
      return <ExperienceEditor section={section} onChange={onChange} />
    case 'education':
      return <EducationEditor section={section} onChange={onChange} />
    case 'affiliation':
      return <AffiliationEditor section={section} onChange={onChange} />
    default:
      return <div>Unknown section type</div>
  }
}

const ImageGalleryEditor: React.FC<{
  section: ImageGallerySection;
  onChange: (section: ImageGallerySection) => void;
}> = ({ section, onChange }) => {
  return (
    <div className="space-y-6 p-6 bg-white rounded-lg nice-shadow">
      <div className="flex items-center space-x-2">
        <ImageIcon className="w-5 h-5 text-gray-500" />
        <h3 className="font-medium text-lg">Image Gallery</h3>
      </div>
      
      <div className="space-y-4">
        {/* Title */}
        <div>
          <Label htmlFor="title">Section Title</Label>
          <Input
            id="title"
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Enter section title"
          />
        </div>

        {/* Images */}
        <div>
          <Label>Images</Label>
          <div className="space-y-3 mt-2">
            {section.images.map((image, index) => (
              <div key={index} className="grid grid-cols-[2fr_1fr_auto] gap-4 p-4 border rounded-lg">
                <div>
                  <Label>Image URL</Label>
                  <Input
                    value={image.url}
                    onChange={(e) => {
                      const newImages = [...section.images]
                      newImages[index] = { ...image, url: e.target.value }
                      onChange({ ...section, images: newImages })
                    }}
                    placeholder="Enter image URL"
                  />
                </div>
                <div>
                  <Label>Caption</Label>
                  <Input
                    value={image.caption || ''}
                    onChange={(e) => {
                      const newImages = [...section.images]
                      newImages[index] = { ...image, caption: e.target.value }
                      onChange({ ...section, images: newImages })
                    }}
                    placeholder="Image caption"
                  />
                </div>
                <div className="flex flex-col justify-between">
                  <Label>&nbsp;</Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const newImages = section.images.filter((_, i) => i !== index)
                      onChange({ ...section, images: newImages })
                    }}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {image.url && (
                  <div className="col-span-3">
                    <img
                      src={image.url}
                      alt={image.caption || ''}
                      className="mt-2 max-h-32 rounded-lg object-cover"
                    />
                  </div>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newImage: ProfileImage = {
                  url: '',
                  caption: ''
                }
                onChange({
                  ...section,
                  images: [...section.images, newImage]
                })
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Image
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const TextEditor: React.FC<{
  section: TextSection;
  onChange: (section: TextSection) => void;
}> = ({ section, onChange }) => {
  return (
    <div className="space-y-6 p-6 bg-white rounded-lg nice-shadow">
      <div className="flex items-center space-x-2">
        <TextIcon className="w-5 h-5 text-gray-500" />
        <h3 className="font-medium text-lg">Text Content</h3>
      </div>
      
      <div className="space-y-4">
        {/* Title */}
        <div>
          <Label htmlFor="title">Section Title</Label>
          <Input
            id="title"
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Enter section title"
          />
        </div>

        {/* Content */}
        <div>
          <Label htmlFor="content">Content</Label>
          <Textarea
            id="content"
            value={section.content}
            onChange={(e) => onChange({ ...section, content: e.target.value })}
            placeholder="Enter your content here..."
            className="min-h-[200px]"
          />
        </div>
      </div>
    </div>
  )
}

const LinksEditor: React.FC<{
  section: LinksSection;
  onChange: (section: LinksSection) => void;
}> = ({ section, onChange }) => {
  return (
    <div className="space-y-6 p-6 bg-white rounded-lg nice-shadow">
      <div className="flex items-center space-x-2">
        <LinkIcon className="w-5 h-5 text-gray-500" />
        <h3 className="font-medium text-lg">Links</h3>
      </div>
      
      <div className="space-y-4">
        {/* Title */}
        <div>
          <Label htmlFor="title">Section Title</Label>
          <Input
            id="title"
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Enter section title"
          />
        </div>

        {/* Links */}
        <div>
          <Label>Links</Label>
          <div className="space-y-3 mt-2">
            {section.links.map((link, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 p-4 border rounded-lg">
                <Input
                  value={link.title}
                  onChange={(e) => {
                    const newLinks = [...section.links]
                    newLinks[index] = { ...link, title: e.target.value }
                    onChange({ ...section, links: newLinks })
                  }}
                  placeholder="Link title"
                />
                <Input
                  value={link.url}
                  onChange={(e) => {
                    const newLinks = [...section.links]
                    newLinks[index] = { ...link, url: e.target.value }
                    onChange({ ...section, links: newLinks })
                  }}
                  placeholder="URL"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const newLinks = section.links.filter((_, i) => i !== index)
                    onChange({ ...section, links: newLinks })
                  }}
                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newLink: ProfileLink = {
                  title: '',
                  url: ''
                }
                onChange({
                  ...section,
                  links: [...section.links, newLink]
                })
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Link
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const SkillsEditor: React.FC<{
  section: SkillsSection;
  onChange: (section: SkillsSection) => void;
}> = ({ section, onChange }) => {
  return (
    <div className="space-y-6 p-6 bg-white rounded-lg nice-shadow">
      <div className="flex items-center space-x-2">
        <Award className="w-5 h-5 text-gray-500" />
        <h3 className="font-medium text-lg">Skills</h3>
      </div>
      
      <div className="space-y-4">
        {/* Title */}
        <div>
          <Label htmlFor="title">Section Title</Label>
          <Input
            id="title"
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Enter section title"
          />
        </div>

        {/* Skills */}
        <div>
          <Label>Skills</Label>
          <div className="space-y-3 mt-2">
            {section.skills.map((skill, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 p-4 border rounded-lg">
                <Input
                  value={skill.name}
                  onChange={(e) => {
                    const newSkills = [...section.skills]
                    newSkills[index] = { ...skill, name: e.target.value }
                    onChange({ ...section, skills: newSkills })
                  }}
                  placeholder="Skill name"
                />
                <Select
                  value={skill.level || 'intermediate'}
                  onValueChange={(value) => {
                    const newSkills = [...section.skills]
                    newSkills[index] = { ...skill, level: value as ProfileSkill['level'] }
                    onChange({ ...section, skills: newSkills })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                    <SelectItem value="expert">Expert</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={skill.category || ''}
                  onChange={(e) => {
                    const newSkills = [...section.skills]
                    newSkills[index] = { ...skill, category: e.target.value }
                    onChange({ ...section, skills: newSkills })
                  }}
                  placeholder="Category (optional)"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const newSkills = section.skills.filter((_, i) => i !== index)
                    onChange({ ...section, skills: newSkills })
                  }}
                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newSkill: ProfileSkill = {
                  name: '',
                  level: 'intermediate'
                }
                onChange({
                  ...section,
                  skills: [...section.skills, newSkill]
                })
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Skill
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const ExperienceEditor: React.FC<{
  section: ExperienceSection;
  onChange: (section: ExperienceSection) => void;
}> = ({ section, onChange }) => {
  return (
    <div className="space-y-6 p-6 bg-white rounded-lg nice-shadow">
      <div className="flex items-center space-x-2">
        <Briefcase className="w-5 h-5 text-gray-500" />
        <h3 className="font-medium text-lg">Experience</h3>
      </div>
      
      <div className="space-y-4">
        {/* Title */}
        <div>
          <Label htmlFor="title">Section Title</Label>
          <Input
            id="title"
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Enter section title"
          />
        </div>

        {/* Experiences */}
        <div>
          <Label>Experience Items</Label>
          <div className="space-y-4 mt-2">
            {section.experiences.map((experience, index) => (
              <div key={index} className="space-y-4 p-4 border rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Title</Label>
                    <Input
                      value={experience.title}
                      onChange={(e) => {
                        const newExperiences = [...section.experiences]
                        newExperiences[index] = { ...experience, title: e.target.value }
                        onChange({ ...section, experiences: newExperiences })
                      }}
                      placeholder="Position or role"
                    />
                  </div>
                  <div>
                    <Label>Organization</Label>
                    <Input
                      value={experience.organization}
                      onChange={(e) => {
                        const newExperiences = [...section.experiences]
                        newExperiences[index] = { ...experience, organization: e.target.value }
                        onChange({ ...section, experiences: newExperiences })
                      }}
                      placeholder="Company or organization"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_1fr_auto] gap-4">
                  <div>
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={experience.startDate}
                      onChange={(e) => {
                        const newExperiences = [...section.experiences]
                        newExperiences[index] = { ...experience, startDate: e.target.value }
                        onChange({ ...section, experiences: newExperiences })
                      }}
                    />
                  </div>
                  <div>
                    <Label>End Date</Label>
                    <Input
                      type="date"
                      value={experience.endDate || ''}
                      onChange={(e) => {
                        const newExperiences = [...section.experiences]
                        newExperiences[index] = { ...experience, endDate: e.target.value }
                        onChange({ ...section, experiences: newExperiences })
                      }}
                      disabled={experience.current}
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`current-${index}`}
                        checked={experience.current}
                        onChange={(e) => {
                          const newExperiences = [...section.experiences]
                          newExperiences[index] = { 
                            ...experience, 
                            current: e.target.checked,
                            endDate: e.target.checked ? undefined : experience.endDate 
                          }
                          onChange({ ...section, experiences: newExperiences })
                        }}
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor={`current-${index}`}>Current</Label>
                    </div>
                  </div>
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={experience.description}
                    onChange={(e) => {
                      const newExperiences = [...section.experiences]
                      newExperiences[index] = { ...experience, description: e.target.value }
                      onChange({ ...section, experiences: newExperiences })
                    }}
                    placeholder="Describe your role and achievements"
                    className="min-h-[100px]"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const newExperiences = section.experiences.filter((_, i) => i !== index)
                      onChange({ ...section, experiences: newExperiences })
                    }}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newExperience: ProfileExperience = {
                  title: '',
                  organization: '',
                  startDate: new Date().toISOString().split('T')[0],
                  current: false,
                  description: ''
                }
                onChange({
                  ...section,
                  experiences: [...section.experiences, newExperience]
                })
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Experience
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const EducationEditor: React.FC<{
  section: EducationSection;
  onChange: (section: EducationSection) => void;
}> = ({ section, onChange }) => {
  return (
    <div className="space-y-6 p-6 bg-white rounded-lg nice-shadow">
      <div className="flex items-center space-x-2">
        <GraduationCap className="w-5 h-5 text-gray-500" />
        <h3 className="font-medium text-lg">Education</h3>
      </div>
      
      <div className="space-y-4">
        {/* Title */}
        <div>
          <Label htmlFor="title">Section Title</Label>
          <Input
            id="title"
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Enter section title"
          />
        </div>

        {/* Education Items */}
        <div>
          <Label>Education Items</Label>
          <div className="space-y-4 mt-2">
            {section.education.map((edu, index) => (
              <div key={index} className="space-y-4 p-4 border rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Institution</Label>
                    <Input
                      value={edu.institution}
                      onChange={(e) => {
                        const newEducation = [...section.education]
                        newEducation[index] = { ...edu, institution: e.target.value }
                        onChange({ ...section, education: newEducation })
                      }}
                      placeholder="School or university"
                    />
                  </div>
                  <div>
                    <Label>Degree</Label>
                    <Input
                      value={edu.degree}
                      onChange={(e) => {
                        const newEducation = [...section.education]
                        newEducation[index] = { ...edu, degree: e.target.value }
                        onChange({ ...section, education: newEducation })
                      }}
                      placeholder="Degree type"
                    />
                  </div>
                </div>

                <div>
                  <Label>Field of Study</Label>
                  <Input
                    value={edu.field}
                    onChange={(e) => {
                      const newEducation = [...section.education]
                      newEducation[index] = { ...edu, field: e.target.value }
                      onChange({ ...section, education: newEducation })
                    }}
                    placeholder="Major or concentration"
                  />
                </div>

                <div className="grid grid-cols-[1fr_1fr_auto] gap-4">
                  <div>
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={edu.startDate}
                      onChange={(e) => {
                        const newEducation = [...section.education]
                        newEducation[index] = { ...edu, startDate: e.target.value }
                        onChange({ ...section, education: newEducation })
                      }}
                    />
                  </div>
                  <div>
                    <Label>End Date</Label>
                    <Input
                      type="date"
                      value={edu.endDate || ''}
                      onChange={(e) => {
                        const newEducation = [...section.education]
                        newEducation[index] = { ...edu, endDate: e.target.value }
                        onChange({ ...section, education: newEducation })
                      }}
                      disabled={edu.current}
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`current-edu-${index}`}
                        checked={edu.current}
                        onChange={(e) => {
                          const newEducation = [...section.education]
                          newEducation[index] = { 
                            ...edu, 
                            current: e.target.checked,
                            endDate: e.target.checked ? undefined : edu.endDate 
                          }
                          onChange({ ...section, education: newEducation })
                        }}
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor={`current-edu-${index}`}>Current</Label>
                    </div>
                  </div>
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={edu.description || ''}
                    onChange={(e) => {
                      const newEducation = [...section.education]
                      newEducation[index] = { ...edu, description: e.target.value }
                      onChange({ ...section, education: newEducation })
                    }}
                    placeholder="Additional details about your education"
                    className="min-h-[100px]"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const newEducation = section.education.filter((_, i) => i !== index)
                      onChange({ ...section, education: newEducation })
                    }}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newEducation: ProfileEducation = {
                  institution: '',
                  degree: '',
                  field: '',
                  startDate: new Date().toISOString().split('T')[0],
                  current: false,
                  description: ''
                }
                onChange({
                  ...section,
                  education: [...section.education, newEducation]
                })
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Education
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const AffiliationEditor: React.FC<{
  section: AffiliationSection;
  onChange: (section: AffiliationSection) => void;
}> = ({ section, onChange }) => {
  return (
    <div className="space-y-6 p-6 bg-white rounded-lg nice-shadow">
      <div className="flex items-center space-x-2">
        <MapPin className="w-5 h-5 text-gray-500" />
        <h3 className="font-medium text-lg">Affiliation</h3>
      </div>
      
      <div className="space-y-4">
        {/* Title */}
        <div>
          <Label htmlFor="title">Section Title</Label>
          <Input
            id="title"
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Enter section title"
          />
        </div>

        {/* Affiliations */}
        <div>
          <Label>Affiliations</Label>
          <div className="space-y-3 mt-2">
            {section.affiliations.map((affiliation, index) => (
              <div key={index} className="space-y-4 p-4 border rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={affiliation.name}
                      onChange={(e) => {
                        const newAffiliations = [...section.affiliations]
                        newAffiliations[index] = { ...affiliation, name: e.target.value }
                        onChange({ ...section, affiliations: newAffiliations })
                      }}
                      placeholder="Name of the organization"
                    />
                  </div>
                  <div>
                    <Label>Logo URL</Label>
                    <Input
                      value={affiliation.logoUrl}
                      onChange={(e) => {
                        const newAffiliations = [...section.affiliations]
                        newAffiliations[index] = { ...affiliation, logoUrl: e.target.value }
                        onChange({ ...section, affiliations: newAffiliations })
                      }}
                      placeholder="URL to the organization's logo"
                    />
                  </div>
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={affiliation.description}
                    onChange={(e) => {
                      const newAffiliations = [...section.affiliations]
                      newAffiliations[index] = { ...affiliation, description: e.target.value }
                      onChange({ ...section, affiliations: newAffiliations })
                    }}
                    placeholder="Description of the organization"
                    className="min-h-[100px]"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const newAffiliations = section.affiliations.filter((_, i) => i !== index)
                      onChange({ ...section, affiliations: newAffiliations })
                    }}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const newAffiliation: ProfileAffiliation = {
                  name: '',
                  description: '',
                  logoUrl: ''
                }
                onChange({
                  ...section,
                  affiliations: [...section.affiliations, newAffiliation]
                })
              }}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Affiliation
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UserProfileBuilder 