import React from 'react'
import { Editor } from '@tiptap/core';
import learnhouseAI_icon from "public/learnhouse_ai_simple.png";
import Image from 'next/image';
import { BookOpen, FormInput, Languages, MoreVertical } from 'lucide-react';
import { BubbleMenu } from '@tiptap/react';
import ToolTip from '@components/StyledElements/Tooltip/Tooltip';
import { AIChatBotStateTypes, useAIChatBot, useAIChatBotDispatch } from '@components/Contexts/AI/AIChatBotContext';
import { sendActivityAIChatMessage, startActivityAIChatSession } from '@services/ai/ai';



type AICanvaToolkitProps = {
    editor: Editor,
    activity: any
}

function AICanvaToolkit(props: AICanvaToolkitProps) {
    return (
        <BubbleMenu className="w-fit" tippyOptions={{ duration: 100 }} editor={props.editor}>
            <div style={{ background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgba(2, 1, 25, 0.98)' }}
                className='py-1 h-10 px-2 w-max text-white rounded-xl shadow-md cursor-pointer flex items-center space-x-2 antialiased'
            >
                <div className='flex w-full space-x-1 font-bold text-white/80'><Image width={24} src={learnhouseAI_icon} alt="" /> <div>AI</div> </div>
                <div>
                    <MoreVertical className='text-white/50' size={12} />
                </div>
                <div className='flex space-x-2'>
                    <AIActionButton editor={props.editor} activity={props.activity} label='Explain' />
                    <AIActionButton editor={props.editor} activity={props.activity} label='Summarize' />
                    <AIActionButton editor={props.editor} activity={props.activity} label='Translate' />
                    <AIActionButton editor={props.editor} activity={props.activity} label='Examples' />
                </div>
            </div>
        </BubbleMenu>
    )
}

function AIActionButton(props: { editor: Editor, label: string, activity: any }) {
    const dispatchAIChatBot = useAIChatBotDispatch() as any;
    const aiChatBotState = useAIChatBot() as AIChatBotStateTypes;
    const [aichat_uuid, setAichat_uuid] = React.useState('');

    async function handleAction(label: string) {
        const selection = getTipTapEditorSelectedText();
        const prompt = getPrompt(label, selection);
        dispatchAIChatBot({ type: 'setIsModalOpen' });
        await sendMessage(prompt);
        

    }

    const getTipTapEditorSelectedText = () => {
        const selection = props.editor.state.selection;
        const from = selection.from;
        const to = selection.to;
        const text = props.editor.state.doc.textBetween(from, to);
        return text;
    }

    const getPrompt = (label: string, selection: string) => {
        if (label === 'Explain') {
            return `Explain this part of the course "${selection}" keep this course context in mind.`
        } else if (label === 'Summarize') {
            return `Summarize this "${selection}" with the course context in mind.`
        } else if (label === 'Translate') {
            return `Translate "${selection}" to another language.`
        } else {
            return `Give examples to understand "${selection}" better, if possible give context in the course.`
        }
    }

    const sendMessage = async (message: string) => {
        if (aiChatBotState.aichat_uuid) {
            await dispatchAIChatBot({ type: 'addMessage', payload: { sender: 'user', message: message, type: 'user' } });
            await dispatchAIChatBot({ type: 'setIsWaitingForResponse' });
            const response = await sendActivityAIChatMessage(message, aiChatBotState.aichat_uuid, props.activity.activity_uuid)
            await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' });
            await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' });
            await dispatchAIChatBot({ type: 'addMessage', payload: { sender: 'ai', message: response.message, type: 'ai' } });

        } else {
            await dispatchAIChatBot({ type: 'addMessage', payload: { sender: 'user', message: message, type: 'user' } });
            await dispatchAIChatBot({ type: 'setIsWaitingForResponse' });
            const response = await startActivityAIChatSession(message, props.activity.activity_uuid)
            await dispatchAIChatBot({ type: 'setAichat_uuid', payload: response.aichat_uuid });
            await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' });
            await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' });
            await dispatchAIChatBot({ type: 'addMessage', payload: { sender: 'ai', message: response.message, type: 'ai' } });
        }
    }

    const tooltipLabel = props.label === 'Explain' ? 'Explain a word or a sentence with AI' : props.label === 'Summarize' ? 'Summarize a long paragraph or text with AI' : props.label === 'Translate' ? 'Translate to different languages with AI' : 'Give examples to understand better with AI'
    return (
        <div className='flex space-x-2' >
            <ToolTip sideOffset={10} slateBlack content={tooltipLabel}>
                <button onClick={() => handleAction(props.label)} className='flex space-x-1.5 items-center bg-white/10 px-2 py-0.5 rounded-md outline outline-1 outline-neutral-200/20 text-sm font-semibold text-white/70 hover:bg-white/20 hover:outline-neutral-200/40 delay-75 ease-linear transition-all'>
                    {props.label === 'Explain' && <BookOpen size={16} />}
                    {props.label === 'Summarize' && <FormInput size={16} />}
                    {props.label === 'Translate' && <Languages size={16} />}
                    {props.label === 'Examples' && <div className='text-white/50'>Ex</div>}
                    <div>{props.label}</div>
                </button>
            </ToolTip>
        </div>
    )
}

export default AICanvaToolkit