'use client'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { createContext, useContext, useEffect, useReducer } from 'react'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export const CourseContext = createContext(null) as any
export const CourseDispatchContext = createContext(null) as any

export function CourseProvider({
  children,
  courseuuid,
}: {
  children: React.ReactNode
  courseuuid: string
}) {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const { data: courseStructureData } = useSWR(
    `${getAPIUrl()}courses/${courseuuid}/meta`,
    (url) => swrFetcher(url, access_token)
  )
  const [courseStructure, dispatchCourseStructure] = useReducer(courseReducer, {
    courseStructure: courseStructureData ? courseStructureData : {},
    courseOrder: {},
    isSaved: true,
  })

  // When courseStructureData is loaded, update the state
  useEffect(() => {
    if (courseStructureData) {
      dispatchCourseStructure({
        type: 'setCourseStructure',
        payload: courseStructureData,
      })
    }
  }, [courseStructureData,session])

  if (!courseStructureData) return <PageLoading></PageLoading>

  return (
    <CourseContext.Provider value={courseStructure}>
      <CourseDispatchContext.Provider value={dispatchCourseStructure}>
        {children}
      </CourseDispatchContext.Provider>
    </CourseContext.Provider>
  )
}

export function useCourse() {
  return useContext(CourseContext)
}

export function useCourseDispatch() {
  return useContext(CourseDispatchContext)
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
    default:
      throw new Error(`Unhandled action type: ${action.type}`)
  }
}
