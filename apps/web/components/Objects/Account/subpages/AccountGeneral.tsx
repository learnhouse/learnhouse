'use client';
import { updateProfile } from '@services/settings/profile'
import { getUser } from '@services/users/users'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Formik, Form, type FormikProps } from 'formik'
import Link from 'next/link'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { ArrowRight, CheckCircle, UploadSimple, Warning, WarningCircle } from '@phosphor-icons/react'
import UserAvatar from '@components/Objects/UserAvatar'
import AIImageButton from '@components/Objects/AI/AIImageButton'
import { updateUserAvatar } from '@services/users/users'
import { constructAcceptValue } from '@/lib/constants'
import * as Yup from 'yup'
import { toast } from 'react-hot-toast'
import { signOut } from '@components/Contexts/AuthContext'
import { getUriWithoutOrg } from '@services/config/config';
import { useTranslation } from 'react-i18next';
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics';
import { getErrorMessage } from '@services/utils/ts/errorMessage';
import { Button, EmptyState, SectionCard, Skeleton, StickySaveBar, buttonClass } from '@/design'
import { AccountInput, AccountLabel, AccountNotice, AccountTextarea } from '@components/Objects/Account/AccountSection'

const SUPPORTED_FILES = constructAcceptValue(['jpg', 'png', 'webp', 'gif'])
const BIO_MAX = 400

interface FormValues {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  bio: string;
  // Re-authentication for an email change; never stored.
  current_password: string;
  mfa_code: string;
}

const buildValidationSchema = (t: (_key: string) => string) => Yup.object().shape({
  email: Yup.string().email(t('user.settings.general.validation.invalid_email')).required(t('user.settings.general.validation.email_required')),
  username: Yup.string().required(t('user.settings.general.validation.username_required')),
  first_name: Yup.string().required(t('user.settings.general.validation.first_name_required')),
  last_name: Yup.string().required(t('user.settings.general.validation.last_name_required')),
  bio: Yup.string().max(BIO_MAX, t('user.settings.general.validation.bio_max_length')),
});

type AvatarState = {
  error: string | undefined;
  success: string;
  isLoading: boolean;
  localAvatar: File | null;
  handleFileChange: (_event: any) => Promise<void>;
  handleAISelect: (_imageUrl: string) => Promise<void>;
  handleAIImageFile: (_file: File) => Promise<void>;
}

function AvatarCard({ avatar }: { avatar: AvatarState }) {
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(
    () => (avatar.localAvatar ? URL.createObjectURL(avatar.localAvatar) : null),
    [avatar.localAvatar]
  );
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl]);

  return (
    <SectionCard title={t('user.settings.general.profile_picture')} description={t('user.settings.general.recommended_size')}>
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          {previewUrl ? (
            <UserAvatar border="border-4" rounded="rounded-full" width={72} avatar_url={previewUrl} />
          ) : (
            <UserAvatar border="border-4" rounded="rounded-full" width={72} />
          )}
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={SUPPORTED_FILES}
              className="hidden"
              onChange={avatar.handleFileChange}
            />
            <Button
              onClick={() => inputRef.current?.click()}
              loading={avatar.isLoading}
              icon={<UploadSimple size={14} weight="bold" />}
            >
              {avatar.isLoading ? t('user.settings.general.uploading') : t('user.settings.general.change_avatar')}
            </Button>
            {!avatar.isLoading && (
              <AIImageButton
                onSelect={avatar.handleAISelect}
                onSelectFile={avatar.handleAIImageFile}
                className={buttonClass('secondary', 'md')}
              />
            )}
          </div>
          {avatar.error ? (
            <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
              <WarningCircle size={14} weight="fill" className="shrink-0" />
              <span className="first-letter:uppercase">{avatar.error}</span>
            </p>
          ) : avatar.success ? (
            <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle size={14} weight="fill" className="shrink-0" />
              <span className="first-letter:uppercase">{avatar.success}</span>
            </p>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

const fieldError = (formik: FormikProps<FormValues>, name: keyof FormValues) =>
  formik.touched[name] && typeof formik.errors[name] === 'string' ? (formik.errors[name] as string) : undefined

// The form body: photo, about you, sign-in email. Details (title, location,
// links) moved into the public profile builder.
const UserEditForm = ({
  formik,
  initialEmail,
  reauthWithMfa,
  avatar,
}: {
  formik: FormikProps<FormValues>;
  initialEmail: string;
  reauthWithMfa: boolean;
  avatar: AvatarState;
}) => {
  const { t } = useTranslation();
  const { values, handleChange, handleBlur } = formik;
  const emailChanged = values.email !== initialEmail;
  return (
    <Form className="flex flex-col gap-5" noValidate>
      <AvatarCard avatar={avatar} />

      <SectionCard title={t('account.about_you', { defaultValue: 'About you' })}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="min-w-0">
            <AccountLabel htmlFor="first_name" error={fieldError(formik, 'first_name')}>
              {t('user.settings.general.first_name')}
            </AccountLabel>
            <AccountInput
              id="first_name"
              name="first_name"
              autoComplete="given-name"
              value={values.first_name}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder={t('user.settings.general.first_name_placeholder')}
            />
          </div>
          <div className="min-w-0">
            <AccountLabel htmlFor="last_name" error={fieldError(formik, 'last_name')}>
              {t('user.settings.general.last_name')}
            </AccountLabel>
            <AccountInput
              id="last_name"
              name="last_name"
              autoComplete="family-name"
              value={values.last_name}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder={t('user.settings.general.last_name_placeholder')}
            />
          </div>
          <div className="sm:col-span-2 min-w-0">
            <AccountLabel htmlFor="username" error={fieldError(formik, 'username')}>
              {t('user.settings.general.username')}
            </AccountLabel>
            <AccountInput
              id="username"
              name="username"
              autoComplete="username"
              value={values.username}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder={t('user.settings.general.username_placeholder')}
            />
          </div>
          <div className="sm:col-span-2 min-w-0">
            <AccountLabel
              htmlFor="bio"
              error={fieldError(formik, 'bio')}
              hint={t('user.settings.general.characters_left', { count: BIO_MAX - (values.bio?.length || 0) })}
            >
              {t('user.settings.general.bio')}
            </AccountLabel>
            <AccountTextarea
              id="bio"
              name="bio"
              value={values.bio}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder={t('user.settings.general.bio_placeholder')}
              rows={4}
              maxLength={BIO_MAX}
            />
          </div>
        </div>
        <Link
          href="?section=public"
          className="mt-4 flex items-center gap-2 rounded-xl bg-neutral-50 px-3 py-2.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
        >
          <span className="flex-1 min-w-0">
            {t('account.details_moved', { defaultValue: 'Your headline, details, links and sections are edited in Public profile.' })}
          </span>
          <ArrowRight size={14} className="shrink-0 rtl:rotate-180" />
        </Link>
      </SectionCard>

      <SectionCard title={t('user.settings.general.email')}>
        <div className="flex flex-col gap-4 max-w-md">
          <div>
            <AccountInput
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              aria-label={t('user.settings.general.email')}
              aria-invalid={!!fieldError(formik, 'email') || undefined}
              value={values.email}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder={t('user.settings.general.email_placeholder')}
            />
            {fieldError(formik, 'email') && (
              <p className="mt-1.5 text-xs font-medium text-rose-600">{fieldError(formik, 'email')}</p>
            )}
          </div>
          {emailChanged && (
            <>
              <AccountNotice tone="warning" icon={<Warning size={15} weight="fill" />}>
                {t('user.settings.general.logout_warning')}
              </AccountNotice>
              {reauthWithMfa ? (
                <div>
                  <AccountLabel htmlFor="mfa_code" hint={t('user.settings.general.mfa_code_hint')}>
                    {t('user.settings.general.mfa_code')}
                  </AccountLabel>
                  <AccountInput
                    id="mfa_code"
                    name="mfa_code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={values.mfa_code}
                    onChange={handleChange}
                  />
                </div>
              ) : (
                <div>
                  <AccountLabel htmlFor="current_password">{t('user.settings.general.current_password')}</AccountLabel>
                  <AccountInput
                    id="current_password"
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                    value={values.current_password}
                    onChange={handleChange}
                  />
                  <p className="text-xs text-neutral-500 mt-1.5">{t('user.settings.general.current_password_hint')}</p>
                </div>
              )}
            </>
          )}
        </div>
      </SectionCard>
    </Form>
  );
};

function AccountGeneral({ onDirtyChange }: { onDirtyChange?: (_dirty: boolean) => void } = {}) {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const [localAvatar, setLocalAvatar] = React.useState<File | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>()
  const [success, setSuccess] = React.useState('')
  const [userData, setUserData] = useState<any>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reauthWithMfa, setReauthWithMfa] = useState(false);
  const { t } = useTranslation();
  const { track } = useLHAnalytics('learner');

  const userId = session?.data?.user?.id
  const fetchUserData = useCallback(async () => {
    if (!userId) return
    try {
      const data = await getUser(userId, access_token);
      setUserData(data);
      setLoadFailed(false)
    } catch (error) {
      console.error('Error fetching user data:', error);
      setLoadFailed(true)
    }
  }, [userId, access_token]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  // The user read no longer returns the email (it is PII); the session has it.
  const initialEmail: string = userData?.email ?? session?.data?.user?.email ?? ''

  const uploadAvatar = async (file: File) => {
    const userId = session?.data?.user?.id
    if (!userId) {
      setError(t('user.settings.general.signin_again', { defaultValue: 'Please sign in again' }))
      return
    }
    setLocalAvatar(file)
    setIsLoading(true)
    setSuccess('')
    const res = await updateUserAvatar(userId, file, access_token)
    if (res.success === false) {
      setError(res.HTTPmessage)
      setIsLoading(false)
    } else {
      // Force refresh session to pick up the new avatar filename
      await session.update(true)
      setIsLoading(false)
      setError('')
      setSuccess(t('user.settings.general.avatar_updated'))
    }
  }

  const handleFileChange = async (event: any) => {
    const file = event.target.files?.[0]
    // Clear the input so picking the same file again still fires a change.
    if (event.target) event.target.value = ''
    if (!file) return
    await uploadAvatar(file)
  }

  const handleAISelect = async (imageUrl: string) => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const file = new File([blob], `ai_avatar_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })
      await uploadAvatar(file)
    } catch (_error) {
      setError(t('user.settings.general.ai_image_failed'))
      setIsLoading(false)
    }
  }

  const handleAIImageFile = async (file: File) => {
    try {
      await uploadAvatar(file)
    } catch {
      setError(t('user.settings.general.ai_image_failed'))
      setIsLoading(false)
    }
  }

  const handleEmailChange = async (newEmail: string) => {
    toast.success(t('user.settings.general.profile_updated'), { duration: 4000 })

    toast((_t_toast: any) => (
      <div className="flex items-center gap-2">
        <span>{t('user.settings.general.relogin_message', { email: newEmail })}</span>
      </div>
    ), {
      duration: 4000,
      icon: '📧'
    })

    await new Promise(resolve => setTimeout(resolve, 4000))
    signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
  }

  const initialValues = useMemo<FormValues | null>(() => userData ? ({
    username: userData.username ?? '',
    first_name: userData.first_name ?? '',
    last_name: userData.last_name ?? '',
    email: initialEmail,
    bio: userData.bio || '',
    current_password: '',
    mfa_code: '',
  }) : null, [userData, initialEmail]);

  const validationSchema = useMemo(() => buildValidationSchema(t), [t]);

  // Leaving the section with unsaved edits clears the tab's dirty dot.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  if (loadFailed) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <EmptyState
          icon={<WarningCircle size={22} />}
          title={t('user.settings.general.load_failed')}
          action={<Button onClick={fetchUserData}>{t('user.settings.security.mfa.retry', { defaultValue: 'Retry' })}</Button>}
        />
      </div>
    );
  }

  if (!initialValues) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        <div className="bg-white rounded-2xl nice-shadow p-5 flex items-center gap-4">
          <Skeleton className="w-[72px] h-[72px] !rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-56" />
          </div>
        </div>
        <div className="bg-white rounded-2xl nice-shadow p-5 space-y-4">
          <Skeleton className="h-4 w-24" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
          <Skeleton className="h-9" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  return (
    <Formik<FormValues>
      enableReinitialize
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={async (values, { setSubmitting }) => {
        const isEmailChanged = values.email !== initialEmail
        const loadingToast = toast.loading(t('user.settings.general.saving'))

        try {
          const { current_password, mfa_code, ...profile } = values
          const res = await updateProfile(
            isEmailChanged ? { ...profile, current_password, mfa_code } : profile,
            userData.id,
            access_token
          )
          if (!res.success) {
            const detail = res.data?.detail
            // Accounts without a password confirm with their two-factor code.
            if (detail?.code === 'INVALID_MFA_CODE') setReauthWithMfa(true)
            toast.error(getErrorMessage(detail, t('user.settings.general.update_failed')), { id: loadingToast })
            return
          }
          toast.dismiss(loadingToast)
          track(AnalyticsEvent.AccountProfileUpdated, {
            email_changed: isEmailChanged,
            has_bio: !!values.bio?.trim(),
          })
          if (isEmailChanged) {
            handleEmailChange(values.email)
          } else {
            toast.success(t('user.settings.general.profile_updated'))
            // Keep the header avatar menu and nav name in sync.
            session.update?.(true)
          }
          const refreshedUser = await getUser(userData.id, access_token)
          setUserData(refreshedUser)
        } catch {
          toast.error(t('user.settings.general.update_failed'), { id: loadingToast })
        } finally {
          setSubmitting(false)
        }
      }}
    >
      {(formik) => (
        <>
          <DirtyReporter dirty={formik.dirty} onDirtyChange={onDirtyChange} />
          <UserEditForm
            formik={formik}
            initialEmail={initialEmail}
            reauthWithMfa={reauthWithMfa}
            avatar={{
              error,
              success,
              isLoading,
              localAvatar,
              handleFileChange,
              handleAISelect,
              handleAIImageFile
            }}
          />
          <StickySaveBar
            visible={formik.dirty}
            saving={formik.isSubmitting}
            onDiscard={() => formik.resetForm()}
            onSave={async () => {
              const errors = await formik.validateForm()
              const first = Object.values(errors).find((e) => typeof e === 'string') as string | undefined
              if (first) {
                formik.setTouched({ email: true, username: true, first_name: true, last_name: true, bio: true }, false)
                toast.error(first)
                return
              }
              formik.submitForm()
            }}
          />
        </>
      )}
    </Formik>
  );
}

function DirtyReporter({ dirty, onDirtyChange }: { dirty: boolean; onDirtyChange?: (_dirty: boolean) => void }) {
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  return null
}

export default AccountGeneral
