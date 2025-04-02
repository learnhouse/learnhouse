'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { createContext, use, useEffect, useReducer } from 'react'
import useSWR from 'swr'

export const CourseContext = createContext(null)
export const CourseDispatchContext = createContext(null)

export function CourseProvider({ children, courseuuid }: any) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: courseStructureData, error } = useSWR(
    `${getAPIUrl()}courses/${courseuuid}/meta`,
    (url) => swrFetcher(url, access_token)
  )

  const initialState = {
    courseStructure: {
      course_uuid: courseuuid,
    },
    courseOrder: {},
    isSaved: true,
    isLoading: true,
  }

  const [state, dispatch] = useReducer(courseReducer, initialState) as any

  useEffect(() => {
    if (courseStructureData) {
      dispatch({ type: 'setCourseStructure', payload: courseStructureData })
      dispatch({ type: 'setIsLoaded' })
    }
  }, [courseStructureData])

  if (error) return <div>Failed to load course structure</div>
  if (!courseStructureData) return ''

  if (courseStructureData) {
    return (
      <CourseContext value={state}>
        <CourseDispatchContext value={dispatch}>
          {children}
        </CourseDispatchContext>
      </CourseContext>
    )
  }
}

export function useCourse() {
  return use(CourseContext)
}

export function useCourseDispatch() {
  return use(CourseDispatchContext)
}

function courseReducer(state: any, action: any) {
  switch (action.type) {
    case 'setCourseStructure':
      return { ...state, courseStructure: action.payload }
    case 'setCourseOrder':
      return { ...state, courseOrder: action.payload }
    case 'setIsSaved':
      return { ...state, isSaved: true }
    case 'setIsNotSaved':
      return { ...state, isSaved: false }
    case 'setIsLoaded':
      return { ...state, isLoading: false }
    default:
      throw new Error(`Unhandled action type: ${action.type}`)
  }
}
