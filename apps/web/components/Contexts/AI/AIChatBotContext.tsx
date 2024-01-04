import { AIMessage } from '@components/AI/AIActivityAsk';
import React, { createContext, useContext, useReducer } from 'react'



export const AIChatBotContext = createContext(null) as any;
export const AIChatBotDispatchContext = createContext(null) as any;

export type AIChatBotStateTypes = {

    messages: AIMessage[],
    isModalOpen: boolean,
    aichat_uuid: string,
    isWaitingForResponse: boolean,
    chatInputValue: string
}

function AIChatBotProvider({ children }: { children: React.ReactNode }) {
    const [aiChatBotState, dispatchAIChatBot] = useReducer(aiChatBotReducer,
        {
            messages: [] as AIMessage[],
            isModalOpen: false,
            aichat_uuid: null,
            isWaitingForResponse: false,
            chatInputValue: ''
        }
    );
    return (
        <AIChatBotContext.Provider value={aiChatBotState}>
            <AIChatBotDispatchContext.Provider value={dispatchAIChatBot}>
                {children}
            </AIChatBotDispatchContext.Provider>
        </AIChatBotContext.Provider>
    )
}

export default AIChatBotProvider

export function useAIChatBot() {
    return useContext(AIChatBotContext);
}

export function useAIChatBotDispatch() {
    return useContext(AIChatBotDispatchContext);
}

function aiChatBotReducer(state: any, action: any) {
    switch (action.type) {
        case 'setMessages':
            return { ...state, messages: action.payload };
        case 'addMessage':
            return { ...state, messages: [...state.messages, action.payload] };
        case 'setIsModalOpen':
            return { ...state, isModalOpen: true };
        case 'setIsModalClose':
            return { ...state, isModalOpen: false };
        case 'setAichat_uuid':
            return { ...state, aichat_uuid: action.payload };
        case 'setIsWaitingForResponse':
            return { ...state, isWaitingForResponse: true };
        case 'setIsNoLongerWaitingForResponse':
            return { ...state, isWaitingForResponse: false };
        case 'setChatInputValue':
            return { ...state, chatInputValue: action.payload };

        default:
            throw new Error(`Unhandled action type: ${action.type}`)
    }
}