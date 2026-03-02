'use client'

import React, { useState, useMemo } from 'react'
import { Plus, FileText, Trash2, Star, Globe, Lock, Search, X } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
import { createDocSpace, deleteDocSpace, setDefaultDocSpace } from '@services/docs/docspaces'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import FeatureDisabledView from '@components/Dashboard/Shared/FeatureDisabled/FeatureDisabledView'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import { PlanLevel } from '@services/plans/plans'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { usePlan } from '@components/Hooks/usePlan'

interface DocSpaceListClientProps {
  org_id: number
  orgslug: string
}

function CreateDocSpaceForm({ onCreated, orgId, accessToken }: {
  onCreated: () => void
  orgId: number
  accessToken: string
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await createDocSpace(orgId, {
        name,
        description,
        public: false,
        published: false,
      }, accessToken)
      toast.success('DocSpace created')
      setName('')
      setDescription('')
      onCreated()
    } catch (err) {
      toast.error('Failed to create DocSpace')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div>
        <label className="text-sm font-medium text-gray-700">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
          placeholder="e.g., API Documentation"
          required
        />
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1"
          placeholder="Brief description..."
          rows={3}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-gray-800 transition-colors"
        >
          Create
        </button>
      </div>
    </form>
  )
}

const DocSpaceListClient = ({ org_id, orgslug }: DocSpaceListClientProps) => {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const currentPlan = usePlan()

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const isDocsEnabled = org?.config?.config?.features?.docs?.enabled !== false

  const { data: docspaces } = useSWR(
    isDocsEnabled && access_token
      ? `${getAPIUrl()}docs/org_slug/${orgslug}/page/1/limit/100?include_unpublished=true`
      : null,
    (url: string) => swrFetcher(url, access_token),
    { revalidateOnFocus: true }
  )

  const allDocSpaces = docspaces || []

  const filteredDocSpaces = useMemo(() => {
    if (!searchQuery.trim()) return allDocSpaces
    const query = searchQuery.toLowerCase()
    return allDocSpaces.filter((ds: any) =>
      ds.name?.toLowerCase().includes(query) ||
      ds.description?.toLowerCase().includes(query)
    )
  }, [allDocSpaces, searchQuery])

  const revalidateList = () => {
    mutate(`${getAPIUrl()}docs/org_slug/${orgslug}/page/1/limit/100?include_unpublished=true`)
  }

  const handleDelete = async (docspace_uuid: string) => {
    try {
      await deleteDocSpace(docspace_uuid, access_token)
      toast.success('DocSpace deleted')
      revalidateList()
    } catch (err) {
      toast.error('Failed to delete DocSpace')
    }
  }

  const handleSetDefault = async (docspace_uuid: string) => {
    try {
      await setDefaultDocSpace(docspace_uuid, access_token)
      toast.success('Default DocSpace updated')
      revalidateList()
    } catch (err) {
      toast.error('Failed to set default')
    }
  }

  return (
    <PlanRestrictedFeature
      currentPlan={currentPlan}
      requiredPlan="pro"
      icon={FileText}
      titleKey="common.plans.feature_restricted.docs.title"
      descriptionKey="common.plans.feature_restricted.docs.description"
      fullScreen
    >
    <FeatureDisabledView featureName="docs" orgslug={orgslug} context="dashboard">
    <div className="h-full w-full bg-[#f8f8f8] pl-10 pr-10">
      <div className="mb-6 pt-6">
        <Breadcrumbs items={[
          { label: 'Documentation', href: '/dash/docs', icon: <FileText size={14} /> }
        ]} />
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-3xl font-bold mb-4 sm:mb-0">Documentation</h1>
          </div>
          <AuthenticatedClientElement
            checkMethod="roles"
            action="create"
            ressourceType="docspaces"
            orgId={org_id}
          >
            <Modal
              isDialogOpen={createModalOpen}
              onOpenChange={setCreateModalOpen}
              minHeight="no-min"
              dialogTitle="Create DocSpace"
              dialogDescription="Create a new documentation space for your organization."
              dialogContent={
                <CreateDocSpaceForm
                  orgId={org_id}
                  accessToken={access_token}
                  onCreated={() => {
                    setCreateModalOpen(false)
                    revalidateList()
                  }}
                />
              }
              dialogTrigger={
                <button className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear antialiased p-2 px-5 my-auto font text-xs font-bold text-white nice-shadow flex space-x-2 items-center">
                  <Plus className="w-4 h-4" />
                  <span>New DocSpace</span>
                </button>
              }
            />
          </AuthenticatedClientElement>
        </div>
      </div>

      {/* Search */}
      {allDocSpaces.length > 0 && (
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documentation..."
              className="w-full pl-10 pr-10 py-2.5 bg-white nice-shadow rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 border-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search Results Info */}
      {searchQuery && (
        <div className="mb-4 text-sm text-gray-500">
          {filteredDocSpaces.length} result{filteredDocSpaces.length !== 1 ? 's' : ''} for &quot;{searchQuery}&quot;
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredDocSpaces.map((ds: any) => (
          <div
            key={ds.docspace_uuid}
            className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]"
          >
            <Link
              href={`/dash/docs/${ds.docspace_uuid}/general`}
              className="block relative aspect-video overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50"
            >
              <div className="w-full h-full flex items-center justify-center">
                <FileText size={48} className="text-gray-200 transition-transform duration-500 group-hover:scale-110" />
              </div>
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                {ds.published ? (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-700 rounded-full">
                    Published
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-yellow-100 text-yellow-700 rounded-full">
                    Draft
                  </span>
                )}
              </div>
              <div className="absolute top-2 right-2 flex items-center gap-1">
                {ds.is_default && (
                  <span className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full shadow-md">
                    <Star size={14} className="text-amber-500 fill-amber-500" />
                  </span>
                )}
                {ds.public ? (
                  <span className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full shadow-md">
                    <Globe size={14} className="text-green-500" />
                  </span>
                ) : (
                  <span className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full shadow-md">
                    <Lock size={14} className="text-gray-400" />
                  </span>
                )}
              </div>
            </Link>

            <div className="p-3 flex flex-col space-y-1.5">
              <div className="flex items-start justify-between">
                <Link
                  href={`/dash/docs/${ds.docspace_uuid}/general`}
                  className="text-base font-bold text-gray-900 leading-tight hover:text-black transition-colors line-clamp-1"
                >
                  {ds.name}
                </Link>
              </div>

              {ds.description && (
                <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">
                  {ds.description}
                </p>
              )}

              <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {!ds.is_default && (
                    <button
                      onClick={() => handleSetDefault(ds.docspace_uuid)}
                      className="text-gray-400 hover:text-amber-500 transition-colors"
                      title="Set as default"
                    >
                      <Star size={14} />
                    </button>
                  )}
                  <ConfirmationModal
                    confirmationButtonText="Delete"
                    confirmationMessage="Are you sure you want to delete this DocSpace? This action cannot be undone."
                    dialogTitle="Delete DocSpace"
                    dialogTrigger={
                      <button className="text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    }
                    functionToExecute={() => handleDelete(ds.docspace_uuid)}
                    status="warning"
                  />
                </div>
                <Link
                  href={`/dash/docs/${ds.docspace_uuid}/general`}
                  className="text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
                >
                  Edit
                </Link>
              </div>
            </div>
          </div>
        ))}
        {filteredDocSpaces.length === 0 && searchQuery && (
          <div className="col-span-full flex justify-center items-center py-8">
            <div className="text-center">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-600 mb-2">
                No results found
              </h2>
              <p className="text-gray-400">
                Try a different search term
              </p>
            </div>
          </div>
        )}
        {allDocSpaces.length === 0 && !searchQuery && (
          <div className="col-span-full flex justify-center items-center py-8">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <FileText size={48} className="text-gray-300" />
              </div>
              <h2 className="text-2xl font-bold text-gray-600 mb-2">No DocSpaces yet</h2>
              <p className="text-lg text-gray-400">Create your first documentation space</p>
              <div className="mt-6">
                <AuthenticatedClientElement
                  action="create"
                  ressourceType="docspaces"
                  checkMethod="roles"
                  orgId={org_id}
                >
                  <button
                    onClick={() => setCreateModalOpen(true)}
                    className="rounded-lg bg-black hover:scale-105 transition-all duration-100 ease-linear p-2 px-5 text-xs font-bold text-white nice-shadow flex space-x-2 items-center mx-auto"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New DocSpace</span>
                  </button>
                </AuthenticatedClientElement>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </FeatureDisabledView>
    </PlanRestrictedFeature>
  )
}

export default DocSpaceListClient
