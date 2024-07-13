'use client'
import React, { createContext, useContext, useEffect, useReducer } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAssignmentTask } from '@services/courses/assignments'

interface State {
    selectedAssignmentTaskUUID: string | null;
    assignmentTask: Record<string, any>;
}

interface Action {
    type: string;
    payload?: any;
}

const initialState: State = {
    selectedAssignmentTaskUUID: null,
    assignmentTask: {}
};

export const AssignmentsTaskContext = createContext<State | undefined>(undefined);
export const AssignmentsTaskDispatchContext = createContext<React.Dispatch<Action> | undefined>(undefined);

export function AssignmentsTaskProvider({ children }: { children: React.ReactNode }) {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;

    const [state, dispatch] = useReducer(assignmentstaskReducer, initialState);

    async function fetchAssignmentTask(assignmentTaskUUID: string) {
        const res = await getAssignmentTask(assignmentTaskUUID, access_token);
        if (res.success) {
            dispatch({ type: 'setAssignmentTask', payload: res });
        }
    }

    useEffect(() => {
        if (state.selectedAssignmentTaskUUID) {
            fetchAssignmentTask(state.selectedAssignmentTaskUUID);
        }
    }, [state.selectedAssignmentTaskUUID]);

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
            return { ...state, selectedAssignmentTaskUUID: action.payload };
        case 'setAssignmentTask':
            return { ...state, assignmentTask: action.payload };
        case 'reload':
            return { ...state };
        default:
            return state;
    }
}

