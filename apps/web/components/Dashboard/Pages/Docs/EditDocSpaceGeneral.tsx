'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useDocSpace, useDocSpaceDispatch } from '@components/Contexts/DocSpaceContext'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { useFormik } from 'formik'
import { setDefaultDocSpace } from '@services/docs/docspaces'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Star } from 'lucide-react'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'

interface EditDocSpaceGeneralProps {
  spaceuuid: string
}

const EditDocSpaceGeneral = ({ spaceuuid }: EditDocSpaceGeneralProps) => {
  const { docSpaceStructure, isLoading, isSaving } = useDocSpace()
  const dispatch = useDocSpaceDispatch()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [isSettingDefault, setIsSettingDefault] = useState(false)

  const previousChangesRef = useRef<any>(null)

  const formik = useFormik({
    initialValues: {
      name: docSpaceStructure?.name || '',
      description: docSpaceStructure?.description || '',
    },
    enableReinitialize: true,
    validate: (values) => {
      const errors: any = {}
      if (!values.name?.trim()) {
        errors.name = 'Name is required'
      } else if (values.name.length > 100) {
        errors.name = 'Name must be under 100 characters'
      }
      if (values.description && values.description.length > 1000) {
        errors.description = 'Description must be under 1000 characters'
      }
      return errors
    },
    onSubmit: async () => {},
  })

  // Sync form changes — compare against formik.initialValues
  // so that reinitialization from server data is never treated as a user edit
  useEffect(() => {
    if (isLoading || isSaving) return

    const changes: any = {}
    Object.keys(formik.values).forEach((key) => {
      if ((formik.values as any)[key] !== (formik.initialValues as any)[key]) {
        changes[key] = (formik.values as any)[key]
      }
    })

    const hasChanges = Object.keys(changes).length > 0

    if (hasChanges) {
      const changesStr = JSON.stringify(changes)
      const prevStr = JSON.stringify(previousChangesRef.current)
      if (changesStr !== prevStr) {
        previousChangesRef.current = changes
        dispatch({ type: 'MERGE_CHANGES', payload: changes })
      }
    } else {
      previousChangesRef.current = null
    }
  }, [formik.values, formik.initialValues, isLoading, isSaving, dispatch])

  if (isLoading || !docSpaceStructure) {
    return (
      <div className="h-full flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  return (
    <div className="h-full">
      <div className="h-6" />
      <div className="px-10 pb-10">
        <div className="bg-white rounded-xl shadow-xs">
          <FormLayout onSubmit={formik.handleSubmit} className="p-6">
            <div className="space-y-6">
              <FormField name="name">
                <FormLabelAndMessage label="Name" message={formik.errors.name as string | undefined} />
                <Form.Control asChild>
                  <Input
                    style={{ backgroundColor: 'white' }}
                    onChange={formik.handleChange}
                    value={formik.values.name}
                    type="text"
                    required
                    disabled={isSaving}
                  />
                </Form.Control>
              </FormField>

              <FormField name="description">
                <FormLabelAndMessage label="Description" message={formik.errors.description as string | undefined} />
                <Form.Control asChild>
                  <Textarea
                    style={{ backgroundColor: 'white', height: '200px', minHeight: '200px' }}
                    onChange={formik.handleChange}
                    value={formik.values.description}
                    disabled={isSaving}
                  />
                </Form.Control>
              </FormField>

              {/* Default DocSpace */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Star size={18} className={docSpaceStructure.is_default ? 'text-amber-500 fill-amber-500' : 'text-gray-400'} />
                    <div>
                      <div className="text-sm font-semibold text-gray-800">Default DocSpace</div>
                      <div className="text-xs text-gray-400">
                        {docSpaceStructure.is_default
                          ? 'This is the default documentation space. Users will see it when visiting /docs.'
                          : 'Set this as the default documentation space. It will be shown when users visit /docs.'}
                      </div>
                    </div>
                  </div>
                  {docSpaceStructure.is_default ? (
                    <span className="px-3 py-1.5 text-xs font-bold bg-amber-100 text-amber-700 rounded-lg">
                      Default
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isSettingDefault}
                      onClick={async () => {
                        setIsSettingDefault(true)
                        try {
                          await setDefaultDocSpace(spaceuuid, access_token)
                          toast.success('Set as default DocSpace')
                          mutate(`${getAPIUrl()}docs/${spaceuuid}/meta`)
                        } catch {
                          toast.error('Failed to set as default')
                        } finally {
                          setIsSettingDefault(false)
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-bold bg-black text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      {isSettingDefault ? 'Setting...' : 'Set as Default'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </FormLayout>
        </div>
      </div>
    </div>
  )
}

export default EditDocSpaceGeneral
