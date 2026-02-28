'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  Globe,
  Lock,
  Users,
  FloppyDisk,
  X,
  Plus,
  TextT,
  ShieldCheck,
  Image,
  UploadSimple,
  CircleNotch,
} from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import {
  updatePlayground,
  updatePlaygroundThumbnail,
  addUserGroupToPlayground,
  removeUserGroupFromPlayground,
  Playground,
  PlaygroundAccessType,
} from '@services/playgrounds/playgrounds'
import { getPlaygroundThumbnailMediaDirectory } from '@services/media/media'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import UnsplashImagePicker from '@components/Dashboard/Pages/Course/EditCourseGeneral/UnsplashImagePicker'
import toast from 'react-hot-toast'
import Link from 'next/link'

type Tab = 'general' | 'access' | 'thumbnail'

interface PlaygroundOptionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  playground: Playground
  orgslug: string
  onUpdated: (updated: Playground) => void
}

export default function PlaygroundOptionsModal({
  open,
  onOpenChange,
  playground,
  orgslug,
  onUpdated,
}: PlaygroundOptionsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general')

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <TextT size={14} weight="bold" /> },
    { id: 'access', label: 'Access', icon: <ShieldCheck size={14} weight="bold" /> },
    { id: 'thumbnail', label: 'Thumbnail', icon: <Image size={14} weight="bold" /> },
  ]

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      minWidth="lg"
      minHeight="lg"
      noPadding
      dialogContent={
        <div className="flex h-full min-h-[680px]">
          {/* Sidebar */}
          <div className="w-44 flex-shrink-0 border-r border-gray-100 bg-gray-50/60 flex flex-col py-4 px-3 gap-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-2">
              Playground
            </p>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left ${
                  activeTab === tab.id
                    ? 'bg-white nice-shadow text-gray-900'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-white/60'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'general' && (
              <GeneralTab playground={playground} onUpdated={onUpdated} />
            )}
            {activeTab === 'access' && (
              <AccessTab
                playground={playground}
                orgslug={orgslug}
                orgId={playground.org_id}
                onUpdated={onUpdated}
              />
            )}
            {activeTab === 'thumbnail' && (
              <ThumbnailTab playground={playground} onUpdated={onUpdated} />
            )}
          </div>
        </div>
      }
    />
  )
}

/* ── General Tab ── */
function GeneralTab({
  playground,
  onUpdated,
}: {
  playground: Playground
  onUpdated: (p: Playground) => void
}) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [name, setName] = useState(playground.name)
  const [description, setDescription] = useState(playground.description || '')
  const [isSaving, setIsSaving] = useState(false)

  // Sync when playground prop changes
  useEffect(() => {
    setName(playground.name)
    setDescription(playground.description || '')
  }, [playground.name, playground.description])

  const hasChanges =
    name !== playground.name || description !== (playground.description || '')

  const handleSave = async () => {
    if (!name.trim()) return
    setIsSaving(true)
    try {
      const updated = await updatePlayground(
        playground.playground_uuid,
        { name: name.trim(), description: description.trim() || undefined },
        access_token
      )
      onUpdated(updated)
      toast.success('Playground updated')
    } catch {
      toast.error('Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-0.5">General settings</h2>
        <p className="text-xs text-gray-400">Update the name and description of your playground.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            placeholder="Playground name"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
            placeholder="Describe what this playground does…"
          />
        </div>
      </div>

      {hasChanges && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-black nice-shadow transition-all disabled:opacity-50"
          >
            <FloppyDisk size={14} weight="bold" />
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Access Tab ── */
function AccessTab({
  playground,
  orgslug,
  orgId,
  onUpdated,
}: {
  playground: Playground
  orgslug: string
  orgId: number
  onUpdated: (p: Playground) => void
}) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [accessType, setAccessType] = useState<PlaygroundAccessType>(playground.access_type)
  const [isSaving, setIsSaving] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)

  // Correct endpoint: GET /playgrounds/{uuid}/usergroups
  const ugKey =
    accessType === 'restricted'
      ? `${getAPIUrl()}playgrounds/${playground.playground_uuid}/usergroups`
      : null
  const { data: usergroups } = useSWR(ugKey, (url) => swrFetcher(url, access_token))

  const handleSetAccess = async (type: PlaygroundAccessType) => {
    if (type === accessType || isSaving) return
    setIsSaving(true)
    const previous = accessType
    setAccessType(type)
    try {
      const updated = await updatePlayground(
        playground.playground_uuid,
        { access_type: type },
        access_token
      )
      onUpdated(updated)
      toast.success('Access updated')
    } catch {
      setAccessType(previous)
      toast.error('Failed to update access')
    } finally {
      setIsSaving(false)
    }
  }

  // Uses dedicated playground endpoint: DELETE /playgrounds/{uuid}/usergroups/{ug_uuid}
  const removeUserGroup = async (usergroupUuid: string) => {
    try {
      await removeUserGroupFromPlayground(playground.playground_uuid, usergroupUuid, access_token)
      toast.success('User group removed')
      if (ugKey) mutate(ugKey)
    } catch {
      toast.error('Failed to remove user group')
    }
  }

  const ACCESS_OPTIONS: {
    type: PlaygroundAccessType
    icon: React.ReactNode
    label: string
    description: string
  }[] = [
    {
      type: 'public',
      icon: <Globe size={22} weight="duotone" className="text-green-500" />,
      label: 'Public',
      description: 'Anyone on the internet can view this playground.',
    },
    {
      type: 'authenticated',
      icon: <Users size={22} weight="duotone" className="text-sky-500" />,
      label: 'Members only',
      description: 'Only signed-in members of your organization can view.',
    },
    {
      type: 'restricted',
      icon: <Lock size={22} weight="duotone" className="text-amber-500" />,
      label: 'Restricted',
      description: 'Only specific user groups you select can view.',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-0.5">Access control</h2>
        <p className="text-xs text-gray-400">Choose who can view this playground.</p>
      </div>

      {/* Access type cards */}
      <div className={`space-y-2 ${isSaving ? 'opacity-60 pointer-events-none' : ''}`}>
        {ACCESS_OPTIONS.map((opt) => {
          const active = accessType === opt.type
          return (
            <button
              key={opt.type}
              onClick={() => handleSetAccess(opt.type)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                active
                  ? 'border-sky-500 bg-sky-50/50'
                  : 'border-gray-100 bg-gray-50/60 hover:border-gray-200 hover:bg-white'
              }`}
            >
              <div className="flex-shrink-0">{opt.icon}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold ${active ? 'text-sky-700' : 'text-gray-700'}`}>
                  {opt.label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{opt.description}</p>
              </div>
              {active && (
                <div className="flex-shrink-0 w-4 h-4 rounded-full bg-sky-500 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* User groups — only for restricted */}
      {accessType === 'restricted' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-gray-800">User groups</p>
              <p className="text-xs text-gray-400">Groups that can access this playground</p>
            </div>
            <Modal
              isDialogOpen={linkModalOpen}
              onOpenChange={setLinkModalOpen}
              minWidth="no-min"
              minHeight="no-min"
              dialogTitle="Link user group"
              dialogDescription="Select a user group to grant access to this playground."
              dialogContent={
                <LinkUserGroupForm
                  playgroundUuid={playground.playground_uuid}
                  orgId={orgId}
                  orgslug={orgslug}
                  accessToken={access_token}
                  ugKey={ugKey}
                  onDone={() => setLinkModalOpen(false)}
                />
              }
              dialogTrigger={
                <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-900 text-white text-xs font-black nice-shadow transition-all">
                  <Plus size={12} weight="bold" />
                  Add group
                </button>
              }
            />
          </div>

          <div className="rounded-xl border border-gray-100 overflow-hidden">
            {!usergroups || usergroups.length === 0 ? (
              <div className="py-8 text-center">
                <Lock size={20} className="text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-400">No user groups linked yet</p>
                <Link
                  href={getUriWithOrg(orgslug, '/dash/users/settings/usergroups')}
                  target="_blank"
                  className="text-xs text-sky-600 hover:underline mt-1 inline-block"
                >
                  Manage user groups →
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Group</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {usergroups.map((ug: any) => (
                    <tr key={ug.usergroup_uuid} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 font-medium text-gray-800">{ug.name}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => removeUserGroup(ug.usergroup_uuid)}
                          className="flex items-center gap-1 ml-auto h-7 px-2.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition-all"
                        >
                          <X size={11} weight="bold" />
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Thumbnail Tab ── */
const MAX_FILE_SIZE = 8_000_000
const VALID_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const

function ThumbnailTab({
  playground,
  onUpdated,
}: {
  playground: Playground
  onUpdated: (p: Playground) => void
}) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [showUnsplash, setShowUnsplash] = useState(false)

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    }
  }, [localPreview])

  const thumbnailUrl =
    localPreview ||
    (playground.thumbnail_image && playground.org_uuid
      ? getPlaygroundThumbnailMediaDirectory(
          playground.org_uuid,
          playground.playground_uuid,
          playground.thumbnail_image
        )
      : null)

  const doUpload = async (file: File) => {
    setIsUploading(true)
    try {
      const updated = await updatePlaygroundThumbnail(playground.playground_uuid, file, access_token)
      onUpdated(updated)
      setLocalPreview(null)
      toast.success('Thumbnail updated')
    } catch {
      toast.error('Failed to upload thumbnail')
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!VALID_IMAGE_MIME_TYPES.includes(file.type as any)) {
      toast.error('Please upload a PNG or JPG image')
      e.target.value = ''
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File too large (max 8MB)`)
      e.target.value = ''
      return
    }
    setLocalPreview(URL.createObjectURL(file))
    await doUpload(file)
  }

  const handleUnsplashSelect = async (imageUrl: string) => {
    try {
      const url = new URL(imageUrl)
      if (!['https:', 'http:'].includes(url.protocol)) {
        toast.error('Invalid image URL')
        return
      }
      setIsUploading(true)
      const res = await fetch(imageUrl)
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) {
        toast.error('URL did not return a valid image')
        setIsUploading(false)
        return
      }
      const file = new File([blob], `unsplash_${Date.now()}.jpg`, { type: blob.type })
      setLocalPreview(URL.createObjectURL(file))
      await doUpload(file)
    } catch {
      toast.error('Failed to process Unsplash image')
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-0.5">Thumbnail</h2>
        <p className="text-xs text-gray-400">Upload an image or pick one from Unsplash.</p>
      </div>

      {/* Preview */}
      <div className="rounded-xl overflow-hidden border border-gray-100 aspect-video bg-gray-50 flex items-center justify-center">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt="Thumbnail preview"
            className={`w-full h-full object-cover ${isUploading ? 'opacity-60' : ''}`}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-300">
            <Image size={36} weight="duotone" />
            <span className="text-xs">No thumbnail</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png"
        className="hidden"
        onChange={handleFileChange}
      />

      {isUploading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CircleNotch size={14} weight="bold" className="animate-spin text-sky-500" />
          Uploading…
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-all nice-shadow"
          >
            <UploadSimple size={14} weight="bold" />
            Upload image
          </button>
          <button
            onClick={() => setShowUnsplash(true)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-all nice-shadow"
          >
            <Image size={14} weight="bold" />
            Unsplash
          </button>
        </div>
      )}
      <p className="text-xs text-gray-400">PNG or JPG · Max 8MB</p>

      {showUnsplash && (
        <UnsplashImagePicker
          onSelect={handleUnsplashSelect}
          onClose={() => setShowUnsplash(false)}
        />
      )}
    </div>
  )
}

/* ── Link user group form ── */
function LinkUserGroupForm({
  playgroundUuid,
  orgId,
  orgslug,
  accessToken,
  ugKey,
  onDone,
}: {
  playgroundUuid: string
  orgId: number
  orgslug: string
  accessToken: string
  ugKey: string | null
  onDone: () => void
}) {
  const { data: allGroups } = useSWR(
    `${getAPIUrl()}usergroups/org/${orgId}?org_id=${orgId}`,
    (url) => swrFetcher(url, accessToken)
  )
  // Store usergroup_uuid (string) — needed by the playground endpoint
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    if (allGroups?.length > 0) setSelected(allGroups[0].usergroup_uuid)
  }, [allGroups])

  const handleLink = async () => {
    if (!selected) return
    try {
      // Correct endpoint: POST /playgrounds/{uuid}/usergroups/{ug_uuid}
      await addUserGroupToPlayground(playgroundUuid, selected, accessToken)
      toast.success('User group linked')
      if (ugKey) mutate(ugKey)
      onDone()
    } catch {
      toast.error('Failed to link user group')
    }
  }

  if (!allGroups) {
    return <div className="py-4 text-center text-sm text-gray-400">Loading…</div>
  }

  if (allGroups.length === 0) {
    return (
      <div className="py-6 text-center space-y-2">
        <p className="text-sm text-gray-500">No user groups available.</p>
        <Link
          href={getUriWithOrg(orgslug, '/dash/users/settings/usergroups')}
          target="_blank"
          className="text-sm text-sky-600 hover:underline"
        >
          Create a user group →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        {allGroups.map((g: any) => (
          <option key={g.usergroup_uuid} value={g.usergroup_uuid}>{g.name}</option>
        ))}
      </select>
      <div className="flex justify-end">
        <button
          onClick={handleLink}
          disabled={!selected}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-black nice-shadow transition-all disabled:opacity-50"
        >
          <Plus size={14} weight="bold" />
          Link group
        </button>
      </div>
    </div>
  )
}
