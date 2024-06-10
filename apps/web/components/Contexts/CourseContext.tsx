'use client'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import React, { createContext, useContext, useEffect, useReducer } from 'react'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export const CourseContext = createContext(null)
export const CourseDispatchContext = createContext(null)

export function CourseProvider({ children, courseuuid }: any) {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  const { data: courseStructureData, error } = useSWR(`${getAPIUrl()}courses/${courseuuid}/meta`,
    url => swrFetcher(url, access_token)
  );

  const initialState = {
    courseStructure: {},
    courseOrder: {},
    isSaved: true,
    isLoading: true
  };

  const [state, dispatch] = useReducer(courseReducer, initialState) as any;

  useEffect(() => {
    if (courseStructureData) {
      dispatch({ type: 'setCourseStructure', payload: courseStructureData });
      dispatch({ type: 'setIsLoaded' });
    }
  }, [courseStructureData]);

  if (error) return <div>Failed to load course structure</div>;
  if (!courseStructureData) return <div>Loading...</div>;

  return (
    <CourseContext.Provider value={state}>
      <CourseDispatchContext.Provider value={dispatch}>
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
    case 'setIsLoaded':
      return { ...state, isLoading: false }
    default:
      throw new Error(`Unhandled action type: ${action.type}`)
  }
}
