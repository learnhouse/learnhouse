'use client';
import { updateProfile } from '@services/settings/profile'
import { getUser } from '@services/users/users'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Formik, Form } from 'formik'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  ArrowBigUpDash,
  Check,
  FileWarning,
  Info,
  UploadCloud,
  AlertTriangle,
  Briefcase,
  GraduationCap,
  MapPin,
  Building2,
  Globe,
  Laptop2,
  Award,
  BookOpen,
  Link,
  Users,
  Calendar,
  Lightbulb
} from 'lucide-react'
import UserAvatar from '@components/Objects/UserAvatar'
import { updateUserAvatar } from '@services/users/users'
import { constructAcceptValue } from '@/lib/constants'
import * as Yup from 'yup'
import { Input } from "@components/ui/input"
import { Textarea } from "@components/ui/textarea"
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select"
import { toast } from 'react-hot-toast'
import { signOut } from 'next-auth/react'
import { getUriWithoutOrg } from '@services/config/config';
import { useDebounce } from '@/hooks/useDebounce';

import { useTranslation } from 'react-i18next';

const SUPPORTED_FILES = constructAcceptValue(['jpg', 'png', 'webp', 'gif'])

const AVAILABLE_ICONS = [
  { name: 'briefcase', labelKey: 'user.settings.general.icons.briefcase', component: Briefcase },
  { name: 'graduation-cap', labelKey: 'user.settings.general.icons.education', component: GraduationCap },
  { name: 'map-pin', labelKey: 'user.settings.general.icons.location', component: MapPin },
  { name: 'building-2', labelKey: 'user.settings.general.icons.organization', component: Building2 },
  { name: 'speciality', labelKey: 'user.settings.general.icons.speciality', component: Lightbulb },
  { name: 'globe', labelKey: 'user.settings.general.icons.website', component: Globe },
  { name: 'laptop-2', labelKey: 'user.settings.general.icons.tech', component: Laptop2 },
  { name: 'award', labelKey: 'user.settings.general.icons.achievement', component: Award },
  { name: 'book-open', labelKey: 'user.settings.general.icons.book', component: BookOpen },
  { name: 'link', labelKey: 'user.settings.general.icons.link', component: Link },
  { name: 'users', labelKey: 'user.settings.general.icons.community', component: Users },
  { name: 'calendar', labelKey: 'user.settings.general.icons.calendar', component: Calendar },
] as const;

const IconComponent = ({ iconName }: { iconName: string }) => {
  const iconConfig = AVAILABLE_ICONS.find(i => i.name === iconName);
  if (!iconConfig) return null;
  const IconElement = iconConfig.component;
  return <IconElement className="w-4 h-4" />;
};

interface DetailItem {
  id: string;
  label: string;
  icon: string;
  text: string;
}

interface FormValues {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  bio: string;
  details: {
    [key: string]: DetailItem;
  };
}

const DETAIL_TEMPLATES = {
  general: [
    { id: 'title', label: 'Title', icon: 'briefcase', text: '' },
    { id: 'affiliation', label: 'Affiliation', icon: 'building-2', text: '' },
    { id: 'location', label: 'Location', icon: 'map-pin', text: '' },
    { id: 'website', label: 'Website', icon: 'globe', text: '' },
    { id: 'linkedin', label: 'LinkedIn', icon: 'link', text: '' }
  ],
  academic: [
    { id: 'institution', label: 'Institution', icon: 'building-2', text: '' },
    { id: 'department', label: 'Department', icon: 'graduation-cap', text: '' },
    { id: 'research', label: 'Research Area', icon: 'book-open', text: '' },
    { id: 'academic-title', label: 'Academic Title', icon: 'award', text: '' }
  ],
  professional: [
    { id: 'company', label: 'Company', icon: 'building-2', text: '' },
    { id: 'industry', label: 'Industry', icon: 'briefcase', text: '' },
    { id: 'expertise', label: 'Expertise', icon: 'laptop-2', text: '' },
    { id: 'community', label: 'Community', icon: 'users', text: '' }
  ]
} as const;

const validationSchema = Yup.object().shape({
  email: Yup.string().email('Invalid email').required('Email is required'),
  username: Yup.string().required('Username is required'),
  first_name: Yup.string().required('First name is required'),
  last_name: Yup.string().required('Last name is required'),
  bio: Yup.string().max(400, 'Bio must be 400 characters or less'),
  details: Yup.object().shape({})
});

// Memoized detail card component for better performance
const DetailCard = React.memo(({ 
  id,
  detail, 
  onUpdate, 
  onRemove,
  onLabelChange 
}: { 
  id: string;
  detail: DetailItem;
  onUpdate: (id: string, field: keyof DetailItem, value: string) => void;
  onRemove: (id: string) => void;
  onLabelChange: (id: string, newLabel: string) => void;
}) => {
  const { t } = useTranslation();
  // Add local state for label input
  const [localLabel, setLocalLabel] = useState(detail.label);
  
  // Debounce the label change handler
  const debouncedLabelChange = useDebounce((newLabel: string) => {
    if (newLabel !== detail.label) {
      onLabelChange(id, newLabel);
    }
  }, 500);

  // Memoize handlers to prevent unnecessary re-renders
  const handleLabelChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value;
    setLocalLabel(newLabel);
    debouncedLabelChange(newLabel);
  }, [debouncedLabelChange]);

  const handleIconChange = useCallback((value: string) => {
    onUpdate(id, 'icon', value);
  }, [id, onUpdate]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate(id, 'text', e.target.value);
  }, [id, onUpdate]);

  const handleRemove = useCallback(() => {
    onRemove(id);
  }, [id, onRemove]);

  // Update local label when prop changes
  useEffect(() => {
    setLocalLabel(detail.label);
  }, [detail.label]);

  return (
    <div className="space-y-2 p-4 border rounded-lg bg-white shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <Input
          value={localLabel}
          onChange={handleLabelChange}
          placeholder={t('user.settings.general.detail_label_placeholder')}
          className="max-w-[200px]"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-red-500 hover:text-red-700"
          onClick={handleRemove}
        >
          {t('user.settings.general.remove')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('user.settings.general.icon')}</Label>
          <Select
            value={detail.icon}
            onValueChange={handleIconChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('user.settings.general.select_icon')}>
                {detail.icon && (
                  <div className="flex items-center gap-2">
                    <IconComponent iconName={detail.icon} />
                    <span>
                      {t(AVAILABLE_ICONS.find(i => i.name === detail.icon)?.labelKey || '')}
                    </span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_ICONS.map((icon) => (
                <SelectItem key={icon.name} value={icon.name}>
                  <div className="flex items-center gap-2">
                    <icon.component className="w-4 h-4" />
                    <span>{t(icon.labelKey)}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('user.settings.general.text')}</Label>
          <Input
            value={detail.text}
            onChange={handleTextChange}
            placeholder={t('user.settings.general.text_placeholder')}
          />
        </div>
      </div>
    </div>
  );
});

DetailCard.displayName = 'DetailCard';

// Form component to handle the details section
const UserEditForm = ({
  values,
  setFieldValue,
  handleChange,
  errors,
  touched,
  isSubmitting,
  profilePicture
}: {
  values: FormValues;
  setFieldValue: (field: string, value: any) => void;
  handleChange: (e: React.ChangeEvent<any>) => void;
  errors: any;
  touched: any;
  isSubmitting: boolean;
  profilePicture: {
    error: string | undefined;
    success: string;
    isLoading: boolean;
    localAvatar: File | null;
    handleFileChange: (event: any) => Promise<void>;
  };
}) => {
  const { t } = useTranslation();

  // Memoize template handlers
  const templateHandlers = useMemo(() => 
    Object.entries(DETAIL_TEMPLATES).reduce((acc, [key, template]) => ({
      ...acc,
      [key]: () => {
        const currentIds = new Set(Object.keys(values.details));
        const newDetails = { ...values.details };
        
        template.forEach((item) => {
          if (!currentIds.has(item.id)) {
            newDetails[item.id] = { 
              ...item, 
              label: t(`user.settings.general.labels.${item.id.replace('-', '_')}`, { defaultValue: item.label }) 
            };
          }
        });
        
        setFieldValue('details', newDetails);
      }
    }), {} as Record<string, () => void>)
  , [values.details, setFieldValue, t]);

  // Memoize detail handlers
  const detailHandlers = useMemo(() => ({
    handleDetailUpdate: (id: string, field: keyof DetailItem, value: string) => {
      const newDetails = { ...values.details };
      newDetails[id] = { ...newDetails[id], [field]: value };
      setFieldValue('details', newDetails);
    },
    handleDetailRemove: (id: string) => {
      const newDetails = { ...values.details };
      delete newDetails[id];
      setFieldValue('details', newDetails);
    }
  }), [values.details, setFieldValue]);

  return (
    <Form>
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {t('user.settings.general.title')}
          </h1>
          <h2 className="text-gray-500 text-md">
            {t('user.settings.general.subtitle')}
          </h2>
        </div>

        <div className="flex flex-col lg:flex-row mt-0 mx-5 my-5 gap-8">
          {/* Profile Information Section */}
          <div className="flex-1 min-w-0 space-y-4">
            <div>
              <Label htmlFor="email">{t('user.settings.general.email')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={values.email}
                onChange={handleChange}
                placeholder={t('user.settings.general.email_placeholder')}
              />
              {touched.email && errors.email && (
                <p className="text-red-500 text-sm mt-1">{errors.email}</p>
              )}
              {values.email !== values.email && (
                <div className="flex items-center space-x-2 mt-2 text-amber-600 bg-amber-50 p-2 rounded-md">
                  <AlertTriangle size={16} />
                  <span className="text-sm">{t('user.settings.general.logout_warning')}</span>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="username">{t('user.settings.general.username')}</Label>
              <Input
                id="username"
                name="username"
                value={values.username}
                onChange={handleChange}
                placeholder={t('user.settings.general.username_placeholder')}
              />
              {touched.username && errors.username && (
                <p className="text-red-500 text-sm mt-1">{errors.username}</p>
              )}
            </div>

            <div>
              <Label htmlFor="first_name">{t('user.settings.general.first_name')}</Label>
              <Input
                id="first_name"
                name="first_name"
                value={values.first_name}
                onChange={handleChange}
                placeholder={t('user.settings.general.first_name_placeholder')}
              />
              {touched.first_name && errors.first_name && (
                <p className="text-red-500 text-sm mt-1">{errors.first_name}</p>
              )}
            </div>

            <div>
              <Label htmlFor="last_name">{t('user.settings.general.last_name')}</Label>
              <Input
                id="last_name"
                name="last_name"
                value={values.last_name}
                onChange={handleChange}
                placeholder={t('user.settings.general.last_name_placeholder')}
              />
              {touched.last_name && errors.last_name && (
                <p className="text-red-500 text-sm mt-1">{errors.last_name}</p>
              )}
            </div>

            <div>
              <Label htmlFor="bio">
                {t('user.settings.general.bio')}
                <span className="text-gray-500 text-sm ml-2">
                  ({t('user.settings.general.characters_left', { count: 400 - (values.bio?.length || 0) })})
                </span>
              </Label>
              <Textarea
                id="bio"
                name="bio"
                value={values.bio}
                onChange={handleChange}
                placeholder={t('user.settings.general.bio_placeholder')}
                className="min-h-[150px]"
                maxLength={400}
              />
              {touched.bio && errors.bio && (
                <p className="text-red-500 text-sm mt-1">{errors.bio}</p>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <Label>{t('user.settings.general.additional_details')}</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => {
                        setFieldValue('details', {});
                      }}
                    >
                      {t('user.settings.general.clear_all')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const newDetails = { ...values.details };
                        const id = `detail-${Date.now()}`;
                        newDetails[id] = { 
                          id,
                          label: 'New Detail',
                          icon: '',
                          text: '' 
                        };
                        setFieldValue('details', newDetails);
                      }}
                    >
                      {t('user.settings.general.add_detail')}
                    </Button>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {Object.entries(DETAIL_TEMPLATES).map(([key, template]) => (
                    <Button
                      key={key}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={() => {
                        const currentIds = new Set(Object.keys(values.details));
                        const newDetails = { ...values.details };
                        
                        template.forEach((item) => {
                          if (!currentIds.has(item.id)) {
                            newDetails[item.id] = { 
                              ...item,
                              label: t(`user.settings.general.labels.${item.id.replace('-', '_')}`, { defaultValue: item.label })
                            };
                          }
                        });
                        
                        setFieldValue('details', newDetails);
                      }}
                    >
                      {key === 'general' && <Briefcase className="w-4 h-4" />}
                      {key === 'academic' && <GraduationCap className="w-4 h-4" />}
                      {key === 'professional' && <Building2 className="w-4 h-4" />}
                      {t(`user.settings.general.add_${key}`)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {Object.entries(values.details).map(([id, detail]) => (
                  <DetailCard
                    key={id}
                    id={id}
                    detail={detail}
                    onUpdate={(id, field, value) => {
                      const newDetails = { ...values.details };
                      newDetails[id] = { ...newDetails[id], [field]: value };
                      setFieldValue('details', newDetails);
                    }}
                    onRemove={(id) => {
                      const newDetails = { ...values.details };
                      delete newDetails[id];
                      setFieldValue('details', newDetails);
                    }}
                    onLabelChange={(id, newLabel) => {
                      const newDetails = { ...values.details };
                      newDetails[id] = { ...newDetails[id], label: newLabel };
                      setFieldValue('details', newDetails);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Profile Picture Section */}
          <div className="lg:w-80 w-full">
            <div className="bg-gray-50/50 p-6 rounded-lg nice-shadow h-full">
              <div className="flex flex-col items-center space-y-6">
                <Label className="font-bold">{t('user.settings.general.profile_picture')}</Label>
                {profilePicture.error && (
                  <div className="flex items-center bg-red-200 rounded-md text-red-950 px-4 py-2 text-sm">
                    <FileWarning size={16} className="mr-2" />
                    <span className="font-semibold first-letter:uppercase">{profilePicture.error}</span>
                  </div>
                )}
                {profilePicture.success && (
                  <div className="flex items-center bg-green-200 rounded-md text-green-950 px-4 py-2 text-sm">
                    <Check size={16} className="mr-2" />
                    <span className="font-semibold first-letter:uppercase">{profilePicture.success}</span>
                  </div>
                )}
                {profilePicture.localAvatar ? (
                  <UserAvatar
                    border="border-8"
                    width={120}
                    avatar_url={URL.createObjectURL(profilePicture.localAvatar)}
                  />
                ) : (
                  <UserAvatar border="border-8" width={120} />
                )}
                {profilePicture.isLoading ? (
                  <div className="font-bold animate-pulse antialiased bg-green-200 text-gray text-sm rounded-md px-4 py-2 flex items-center">
                    <ArrowBigUpDash size={16} className="mr-2" />
                    <span>{t('user.settings.general.uploading')}</span>
                  </div>
                ) : (
                  <>
                    <input
                      type="file"
                      id="fileInput"
                      accept={SUPPORTED_FILES}
                      className="hidden"
                      onChange={profilePicture.handleFileChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => document.getElementById('fileInput')?.click()}
                      className="w-full"
                    >
                      <UploadCloud size={16} className="mr-2" />
                      {t('user.settings.general.change_avatar')}
                    </Button>
                  </>
                )}
                <div className="flex items-center text-xs text-gray-500">
                  <span className="flex items-center">
                    <Info size={13} className="mr-2" />
                    <p>{t('user.settings.general.recommended_size')}</p>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-row-reverse mt-0 mx-5 mb-5">
          <Button 
            type="submit" 
            disabled={isSubmitting}
            className="bg-black text-white hover:bg-black/90"
          >
            {isSubmitting ? t('user.settings.general.saving') : t('user.settings.general.save_changes')}
          </Button>
        </div>
      </div>
    </Form>
  );
};

function UserEditGeneral() {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [localAvatar, setLocalAvatar] = React.useState(null) as any
  const [isLoading, setIsLoading] = React.useState(false) as any
  const [error, setError] = React.useState() as any
  const [success, setSuccess] = React.useState('') as any
  const [userData, setUserData] = useState<any>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const fetchUserData = async () => {
      if (session?.data?.user?.id) {
        try {
          const data = await getUser(session.data.user.id, access_token);
          setUserData(data);
        } catch (error) {
          console.error('Error fetching user data:', error);
          setError('Failed to load user data');
        }
      }
    };

    fetchUserData();
  }, [session?.data?.user?.id]);

  const handleFileChange = async (event: any) => {
    const file = event.target.files[0]
    setLocalAvatar(file)
    setIsLoading(true)
    const res = await updateUserAvatar(session.data.user_uuid, file, access_token)
    // wait for 1 second to show loading animation
    await new Promise((r) => setTimeout(r, 1500))
    if (res.success === false) {
      setError(res.HTTPmessage)
    } else {
      setIsLoading(false)
      setError('')
      setSuccess(t('user.settings.general.avatar_updated'))
    }
  }

  const handleEmailChange = async (newEmail: string) => {
    toast.success(t('user.settings.general.profile_updated'), { duration: 4000 })
    
    // Show message about logging in with new email
    toast((t_toast: any) => (
      <div className="flex items-center gap-2">
        <span>{t('user.settings.general.relogin_message', { email: newEmail })}</span>
      </div>
    ), { 
      duration: 4000,
      icon: '📧'
    })

    // Wait for 4 seconds before signing out
    await new Promise(resolve => setTimeout(resolve, 4000))
    signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
  }

  if (!userData) {
    return (
      <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <Formik<FormValues>
        enableReinitialize
        initialValues={{
          username: userData.username,
          first_name: userData.first_name,
          last_name: userData.last_name,
          email: userData.email,
          bio: userData.bio || '',
          details: userData.details || {},
        }}
        validationSchema={validationSchema}
        onSubmit={(values, { setSubmitting }) => {
          const isEmailChanged = values.email !== userData.email
          const loadingToast = toast.loading(t('user.settings.general.saving'))
          
          setTimeout(() => {
            setSubmitting(false)
            updateProfile(values, userData.id, access_token)
              .then(() => {
                toast.dismiss(loadingToast)
                if (isEmailChanged) {
                  handleEmailChange(values.email)
                } else {
                  toast.success(t('user.settings.general.profile_updated'))
                }
                // Refresh user data after successful update
                getUser(userData.id, access_token).then(setUserData);
              })
              .catch(() => {
                toast.error('Failed to update profile', { id: loadingToast })
              })
          }, 400)
        }}
      >
        {(formikProps) => (
          <UserEditForm
            {...formikProps}
            profilePicture={{
              error,
              success,
              isLoading,
              localAvatar,
              handleFileChange
            }}
          />
        )}
      </Formik>
    </div>
  );
}

export default UserEditGeneral
