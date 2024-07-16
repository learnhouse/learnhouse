'use client'
import React, { createContext, useContext, useEffect, useReducer } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAssignmentTask } from '@services/courses/assignments'
import { useAssignments } from './AssignmentContext';
import { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';

interface State {
    selectedAssignmentTaskUUID: string | null;
    assignmentTask: Record<string, any>;
    reloadTrigger: number;
}

interface Action {
    type: string;
    payload?: any;
}

const initialState: State = {
    selectedAssignmentTaskUUID: null,
    assignmentTask: {},
    reloadTrigger: 0,
};

export const AssignmentsTaskContext = createContext<State | undefined>(undefined);
export const AssignmentsTaskDispatchContext = createContext<React.Dispatch<Action> | undefined>(undefined);

export function AssignmentsTaskProvider({ children }: { children: React.ReactNode }) {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignment = useAssignments() as any

    const [state, dispatch] = useReducer(assignmentstaskReducer, initialState);

    async function fetchAssignmentTask(assignmentTaskUUID: string) {
        const res = await getAssignmentTask(assignmentTaskUUID, access_token);


        if (res.success) {
            dispatch({ type: 'setAssignmentTask', payload: res.data });
        }
    }

    useEffect(() => {

        if (state.selectedAssignmentTaskUUID) {
            fetchAssignmentTask(state.selectedAssignmentTaskUUID);
            mutate(`${getAPIUrl()}assignments/${assignment.assignment_object?.assignment_uuid}/tasks`);
        }
    }, [state.selectedAssignmentTaskUUID, state.reloadTrigger, assignment]);

    return (
        <AssignmentsTaskContext.Provider value={state}>
            <AssignmentsTaskDispatchContext.Provider value={dispatch}>
                {children}
            </AssignmentsTaskDispatchContext.Provider>
        </AssignmentsTaskContext.Provider>
    );
}

export function useAssignmentsTask() {
    const context = useContext(AssignmentsTaskContext);
    if (context === undefined) {
        throw new Error('useAssignmentsTask must be used within an AssignmentsTaskProvider');
    }
    return context;
}

export function useAssignmentsTaskDispatch() {
    const context = useContext(AssignmentsTaskDispatchContext);
    if (context === undefined) {
        throw new Error('useAssignmentsTaskDispatch must be used within an AssignmentsTaskProvider');
    }
    return context;
}

function assignmentstaskReducer(state: State, action: Action): State {
    switch (action.type) {
        case 'setSelectedAssignmentTaskUUID':
            console.log('st', action.payload)
            return { ...state, selectedAssignmentTaskUUID: action.payload };
        case 'setAssignmentTask':
            return { ...state, assignmentTask: action.payload };
        case 'reload':
            return { ...state, reloadTrigger: state.reloadTrigger + 1 };
        case 'SET_MULTIPLE_STATES':
            return {
                ...state,
                ...action.payload,
            };
        default:
            return state;
    }
}
