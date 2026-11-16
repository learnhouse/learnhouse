'use client'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, ChoiceCard, FieldLabel, INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import FolderAppearance from '@components/Dashboard/Library/FolderAppearance'
import { DEFAULT_FOLDER_COLOR } from '@components/Dashboard/Library/LibraryToolbar'
import { createFolder, updateFolder, updateFolderThumbnail } from '@services/folders/folders'
import { getFolderThumbnailMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { FolderSimplePlus, Globe, Lock, PencilSimple } from '@phosphor-icons/react'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

const NAME_MAX = 100
const DESCRIPTION_MAX = 1000

type Props = {
  open: boolean
  onOpenChange: (_open: boolean) => void
  onChanged?: () => void
} & ({ mode: 'create'; parentFolderUuid?: string } | { mode: 'edit'; folder: any })

// Create and edit share one form: name, description, visibility, look.
export default function FolderDialog(props: Props) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { track } = useLHAnalytics('dashboard')
  const folder = props.mode === 'edit' ? props.folder : null

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [isPublic, setIsPublic] = React.useState(true)
  const [color, setColor] = React.useState(DEFAULT_FOLDER_COLOR)
  const [file, setFile] = React.useState<File | null>(null)
  const [error, setError] = React.useState<string | undefined>()
  const [saving, setSaving] = React.useState(false)

  // Reset the form each time the dialog opens, from the folder when editing.
  // Done during render (React's "adjust state on prop change") so the first
  // open frame already shows the right values.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null)
  const openKey = props.open ? folder?.folder_uuid || 'new' : null
  if (openKey !== openedFor) {
    setOpenedFor(openKey)
    if (openKey) {
      setName(folder?.name || '')
      setDescription(folder?.description || '')
      setIsPublic(folder?.public ?? true)
      setColor(folder?.color || DEFAULT_FOLDER_COLOR)
      setFile(null)
      setError(undefined)
    }
  }

  const existingThumb = folder?.thumbnail_image
    ? getFolderThumbnailMediaDirectory(org?.org_uuid, folder.folder_uuid, folder.thumbnail_image)
    : null

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError(t('library.folder_name_required'))
    if (trimmed.length > NAME_MAX || description.length > DESCRIPTION_MAX) return
    setSaving(true)
    try {
      let folderUuid: string | undefined = folder?.folder_uuid
      if (props.mode === 'create') {
        const created = await createFolder(
          {
            org_id: org.id,
            name: trimmed,
            description,
            public: isPublic,
            color,
            ...(props.parentFolderUuid ? { parent_folder_uuid: props.parentFolderUuid } : {}),
          },
          access_token
        )
        folderUuid = created?.folder_uuid
        track(AnalyticsEvent.FolderCreated, { is_public: isPublic, is_subfolder: !!props.parentFolderUuid })
      } else {
        await updateFolder(folder.folder_uuid, { name: trimmed, description, public: isPublic, color }, access_token)
      }
      if (file && folderUuid) {
        try {
          await updateFolderThumbnail(folderUuid, file, access_token)
        } catch (err: any) {
          toast.error(err?.message || t('library.thumbnail_error'))
        }
      }
      toast.success(props.mode === 'create' ? t('library.folder_created_success') : t('library.folder_updated_success'))
      props.onOpenChange(false)
      props.onChanged?.()
    } catch (err: any) {
      toast.error(
        err?.message || (props.mode === 'create' ? t('library.folder_created_error') : t('library.folder_updated_error'))
      )
    } finally {
      setSaving(false)
    }
  }

  const formId = props.mode === 'create' ? 'library-create-folder' : `library-edit-folder-${folder?.folder_uuid}`
  const isSubfolder = props.mode === 'create' && !!props.parentFolderUuid

  return (
    <Modal
      isDialogOpen={props.open}
      onOpenChange={props.onOpenChange}
      preventClose={saving}
      size="md"
      icon={props.mode === 'create' ? <FolderSimplePlus size={16} /> : <PencilSimple size={16} />}
      dialogTitle={props.mode === 'create' ? t('library.create_folder') : t('library.edit_folder')}
      dialogDescription={
        props.mode === 'create'
          ? isSubfolder
            ? t('library.dash.create_subfolder_description')
            : t('library.dash.create_folder_description')
          : t('library.dash.edit_folder_description')
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={saving}>
            {props.mode === 'create' ? t('library.create_folder') : t('library.save')}
          </Button>
        </>
      }
      dialogContent={
        <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
          <div>
            <FieldLabel error={error} hint={`${name.length}/${NAME_MAX}`}>
              {t('library.folder_name')}
            </FieldLabel>
            <input
              autoFocus
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError(undefined)
              }}
              placeholder={t('library.enter_folder_name')}
              className={INPUT}
            />
          </div>

          <div>
            <FieldLabel hint={t('library.dash.optional')}>{t('library.description')}</FieldLabel>
            <textarea
              rows={3}
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('library.dash.description_placeholder')}
              className={TEXTAREA}
            />
          </div>

          <div>
            <FieldLabel>{t('library.visibility')}</FieldLabel>
            <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('library.visibility')}>
              <ChoiceCard
                selected={isPublic}
                onClick={() => setIsPublic(true)}
                icon={<Globe size={16} />}
                title={t('library.public')}
                description={t('library.dash.public_hint')}
              />
              <ChoiceCard
                selected={!isPublic}
                onClick={() => setIsPublic(false)}
                icon={<Lock size={16} />}
                title={t('library.private')}
                description={t('library.dash.private_hint')}
              />
            </div>
          </div>

          <FolderAppearance
            color={color}
            onColorChange={setColor}
            file={file}
            onFileChange={setFile}
            existingThumbUrl={existingThumb}
          />
        </form>
      }
    />
  )
}
