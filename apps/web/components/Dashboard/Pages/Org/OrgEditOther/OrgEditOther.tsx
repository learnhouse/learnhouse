'use client'
import React from 'react'
import { Form, Formik } from 'formik'
import * as Yup from 'yup'
import { updateOrganization } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import { Textarea } from "@components/ui/textarea"
import { Code2, Plus, Trash2, PencilLine, AlertTriangle } from "lucide-react"
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface Script {
  name: string
  content: string
}

interface OrganizationScripts {
  scripts: Script[]
}

const validationSchema = Yup.object().shape({
  name: Yup.string().required('Script name is required'),
  content: Yup.string().required('Script content is required')
})

const OrgEditOther: React.FC = () => {
  const router = useRouter()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const [selectedView, setSelectedView] = React.useState<'list' | 'edit'>('list')
  const [scripts, setScripts] = React.useState<Script[]>([])
  const [currentScript, setCurrentScript] = React.useState<Script | null>(null)

  // Initialize scripts from org
  React.useEffect(() => {
    if (org?.scripts?.scripts) {
      setScripts(Array.isArray(org.scripts.scripts) ? org.scripts.scripts : [])
    } else {
      setScripts([])
    }
  }, [org])

  const updateOrg = async (values: Script) => {
    const loadingToast = toast.loading('Updating organization...')
    try {
      let updatedScripts: Script[]
      
      if (currentScript) {
        // Edit existing script
        updatedScripts = scripts.map(script => 
          script.name === currentScript.name ? values : script
        )
      } else {
        // Add new script
        updatedScripts = [...scripts, values]
      }

      // Create a new organization object with scripts array wrapped in an object
      const updateData = {
        id: org.id,
        scripts: {
          scripts: updatedScripts
        }
      }
      
      await updateOrganization(org.id, updateData, access_token)
      await revalidateTags(['organizations'], org.slug)
      mutate(`${getAPIUrl()}orgs/slug/${org.slug}`)
      setScripts(updatedScripts)
      setSelectedView('list')
      setCurrentScript(null)
      toast.success('Script saved successfully', { id: loadingToast })
    } catch (err) {
      console.error('Error updating organization:', err)
      toast.error('Failed to save script', { id: loadingToast })
    }
  }

  const deleteScript = async (scriptToDelete: Script) => {
    const loadingToast = toast.loading('Deleting script...')
    try {
      const updatedScripts = scripts.filter(script => script.name !== scriptToDelete.name)
      
      // Create a new organization object with scripts array wrapped in an object
      const updateData = {
        id: org.id,
        scripts: {
          scripts: updatedScripts
        }
      }

      await updateOrganization(org.id, updateData, access_token)
      await revalidateTags(['organizations'], org.slug)
      mutate(`${getAPIUrl()}orgs/slug/${org.slug}`)
      setScripts(updatedScripts)
      toast.success('Script deleted successfully', { id: loadingToast })
    } catch (err) {
      console.error('Error deleting script:', err)
      toast.error('Failed to delete script', { id: loadingToast })
    }
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <div className="pt-0.5">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-xl text-gray-800 flex items-center space-x-2">
                <Code2 className="h-5 w-5" />
                <span>Scripts</span>
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger>
                      <AlertTriangle className="h-4 w-4 text-orange-500 hover:text-orange-600 transition-colors" />
                    </TooltipTrigger>
                    <TooltipContent 
                      className="max-w-[400px] bg-orange-50 border-orange-100 text-orange-900 [&>p]:text-orange-800 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1"
                      sideOffset={8}
                    >
                      <p className="p-2 leading-relaxed">For your organization's safety, please ensure you trust and understand any scripts before adding them. Scripts can interact with your organization's pages.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </h1>
              <h2 className="text-gray-500 text-md">
                Add custom JavaScript scripts to your organization
              </h2>
            </div>
            {selectedView === 'list' && (
              <Button
                onClick={() => {
                  setCurrentScript(null)
                  setSelectedView('edit')
                }}
                className="bg-black text-white hover:bg-black/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Script
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 pt-1">
        {selectedView === 'list' ? (
          <div className="space-y-4">
            {(!scripts || scripts.length === 0) ? (
              <div className="text-center py-8 px-4 text-gray-500 bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                <Code2 className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm font-medium">No scripts added yet</p>
                <p className="text-xs text-gray-400 mt-1">Add your first script to get started</p>
              </div>
            ) : (
              scripts.map((script, index) => (
                <div
                  key={index}
                  className="group p-4 rounded-lg bg-gray-50/50 hover:bg-gray-100/80 transition-colors duration-150 border border-gray-200"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-baseline space-x-2">
                        <h4 className="text-sm font-medium text-gray-800 truncate">{script.name}</h4>
                      </div>
                      <pre className="text-sm text-gray-600 font-mono bg-white/80 p-2 rounded border border-gray-200 overflow-x-auto">
                        {script.content.length > 100 
                          ? script.content.substring(0, 100) + '...' 
                          : script.content}
                      </pre>
                    </div>
                    <div className="ml-4 flex space-x-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-gray-400 hover:text-blue-500 hover:bg-blue-50"
                        onClick={() => {
                          setCurrentScript(script)
                          setSelectedView('edit')
                        }}
                      >
                        <PencilLine className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-gray-400 hover:text-red-500 hover:bg-red-50"
                        onClick={() => deleteScript(script)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <Formik
            initialValues={currentScript || { name: '', content: '' }}
            validationSchema={validationSchema}
            onSubmit={(values, { setSubmitting }) => {
              setSubmitting(false)
              updateOrg(values)
            }}
          >
            {({ values, handleChange, handleSubmit, errors, touched, isSubmitting }) => (
              <Form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="name">Script Name</Label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={values.name}
                      onChange={handleChange}
                      className="mt-1 w-full px-3 py-2 border rounded-md"
                      placeholder="Enter script name"
                    />
                    {touched.name && errors.name && (
                      <p className="text-red-500 text-sm mt-1">{errors.name}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="content">Script Content</Label>
                    <Textarea
                      id="content"
                      name="content"
                      value={values.content}
                      onChange={handleChange}
                      className="mt-1 font-mono"
                      placeholder="Enter JavaScript code"
                      rows={10}
                    />
                    {touched.content && errors.content && (
                      <p className="text-red-500 text-sm mt-1">{errors.content}</p>
                    )}
                  </div>
                  <div className="flex justify-end space-x-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSelectedView('list')
                        setCurrentScript(null)
                      }}
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit"
                      disabled={isSubmitting}
                      className="bg-black text-white hover:bg-black/90"
                    >
                      {isSubmitting ? 'Saving...' : 'Save Script'}
                    </Button>
                  </div>
                </div>
              </Form>
            )}
          </Formik>
        )}
      </div>
    </div>
  )
}

export default OrgEditOther 