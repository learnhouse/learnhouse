import { useSession } from '@components/Contexts/SessionContext'
import { sendActivityAIChatMessage, startActivityAIChatSession } from '@services/ai/ai';
import { AlertTriangle, BadgeInfo, NotebookTabs } from 'lucide-react';
import Avvvatars from 'avvvatars-react';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, Keyboard, MessageCircle, MessageSquareIcon, Sparkle, Sparkles, X } from 'lucide-react'
import Image from 'next/image';
import { send } from 'process';
import learnhouseAI_icon from "public/learnhouse_ai_simple.png";
import learnhouseAI_logo_black from "public/learnhouse_ai_black_logo.png";
import React, { use, useEffect, useRef } from 'react'
import { AIChatBotStateTypes, useAIChatBot, useAIChatBotDispatch } from '@components/Contexts/AI/AIChatBotContext';
import FeedbackModal from '@components/Objects/Modals/Feedback/Feedback';
import Modal from '@components/StyledElements/Modal/Modal';
import useGetAIFeatures from '../../../AI/Hooks/useGetAIFeatures';


type AIActivityAskProps = {
    activity: any;
}


function AIActivityAsk(props: AIActivityAskProps) {
    const is_ai_feature_enabled = useGetAIFeatures({ feature: 'activity_ask' });
    const [isButtonAvailable, setIsButtonAvailable] = React.useState(false);
    const dispatchAIChatBot = useAIChatBotDispatch() as any;

    useEffect(() => {
        if (is_ai_feature_enabled) {
            setIsButtonAvailable(true);
        }
    }
        , [is_ai_feature_enabled]);

    return (
        <>
            {isButtonAvailable && (
                <div >
                    <ActivityChatMessageBox activity={props.activity} />
                    <div
                        onClick={() => dispatchAIChatBot({ type: 'setIsModalOpen' })}
                        style={{
                            background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
                        }}
                        className="rounded-full px-5 drop-shadow-md flex  items-center space-x-1.5 p-2.5 text-sm text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out hover:scale-105">
                        {" "}
                        <i>
                            <Image className='outline outline-1 outline-neutral-200/20 rounded-md' width={20} src={learnhouseAI_icon} alt="" />
                        </i>{" "}
                        <i className="not-italic text-xs font-bold">Ask AI</i>
                    </div>
                </div>
            )}
        </>

    )
}

export type AIMessage = {
    sender: string;
    message: any;
    type: 'ai' | 'user';
}

type ActivityChatMessageBoxProps = {
    activity: any;
}

function ActivityChatMessageBox(props: ActivityChatMessageBoxProps) {
    const session = useSession() as any;
    const aiChatBotState = useAIChatBot() as AIChatBotStateTypes;
    const dispatchAIChatBot = useAIChatBotDispatch() as any;

    // TODO : come up with a better way to handle this
    const inputClass = aiChatBotState.isWaitingForResponse
        ? 'ring-1 ring-inset ring-white/10 bg-gray-950/40 w-full rounded-lg outline-none px-4 py-2 text-white text-sm placeholder:text-white/30 opacity-30 '
        : 'ring-1 ring-inset ring-white/10 bg-gray-950/40 w-full rounded-lg outline-none px-4 py-2 text-white text-sm placeholder:text-white/30';

    useEffect(() => {
        if (aiChatBotState.isModalOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
    }, [aiChatBotState.isModalOpen]);

    function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Enter') {
            // Perform the sending action here
            sendMessage(event.currentTarget.value);
        }
    }

    const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        await dispatchAIChatBot({ type: 'setChatInputValue', payload: event.currentTarget.value });

    }

    const sendMessage = async (message: string) => {
        if (aiChatBotState.aichat_uuid) {
            await dispatchAIChatBot({ type: 'addMessage', payload: { sender: 'user', message: message, type: 'user' } });
            await dispatchAIChatBot({ type: 'setIsWaitingForResponse' });
            const response = await sendActivityAIChatMessage(message, aiChatBotState.aichat_uuid, props.activity.activity_uuid)
            if (response.success == false) {
                await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' });
                await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' });
                await dispatchAIChatBot({ type: 'setError', payload: { isError: true, status: response.status, error_message: response.data.detail } });
                return;
            }
            await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' });
            await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' });
            await dispatchAIChatBot({ type: 'addMessage', payload: { sender: 'ai', message: response.data.message, type: 'ai' } });

        } else {
            await dispatchAIChatBot({ type: 'addMessage', payload: { sender: 'user', message: message, type: 'user' } });
            await dispatchAIChatBot({ type: 'setIsWaitingForResponse' });
            const response = await startActivityAIChatSession(message, props.activity.activity_uuid)
            if (response.success == false) {
                await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' });
                await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' });
                await dispatchAIChatBot({ type: 'setError', payload: { isError: true, status: response.status, error_message: response.data.detail } });
                return;
            }
            await dispatchAIChatBot({ type: 'setAichat_uuid', payload: response.data.aichat_uuid });
            await dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' });
            await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' });
            await dispatchAIChatBot({ type: 'addMessage', payload: { sender: 'ai', message: response.data.message, type: 'ai' } });
        }
    }

    function closeModal() {
        dispatchAIChatBot({ type: 'setIsModalClose' });
    }

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }

    }, [aiChatBotState.messages, session]);


    return (
        <AnimatePresence>
            {aiChatBotState.isModalOpen && (
                <>
                    <motion.div
                        initial={{ y: 20, opacity: 0.3, filter: 'blur(5px)' }}
                        animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                        exit={{ y: 50, opacity: 0, filter: 'blur(25px)' }}
                        transition={{ type: "spring", bounce: 0.35, duration: 1.7, mass: 0.2, velocity: 2 }}
                        className='fixed top-0 left-0 w-full h-full z-50 flex justify-center items-center '
                        style={{ pointerEvents: 'none' }}
                    >
                        <div
                            style={{
                                pointerEvents: 'auto',
                                background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)'
                            }}
                            className="bg-black z-50 rounded-2xl max-w-screen-2xl w-10/12 my-10 mx-auto h-[350px] fixed bottom-0 left-1/2 transform -translate-x-1/2 shadow-lg ring-1 ring-inset ring-white/10 text-white p-4 flex-col-reverse backdrop-blur-md">
                            <div className='flex flex-row-reverse pb-3 justify-between items-center'>
                                <div className='flex space-x-2 items-center'>

                                    <X size={20} className='text-white/50 hover:cursor-pointer bg-white/10 p-1 rounded-full items-center' onClick={closeModal} />

                                </div>
                                <div className={`flex space-x-2 items-center -ml-[100px] ${aiChatBotState.isWaitingForResponse ? 'animate-pulse' : ''}`}>
                                    <Image className={`outline outline-1 outline-neutral-200/20 rounded-lg ${aiChatBotState.isWaitingForResponse ? 'animate-pulse' : ''}`} width={24} src={learnhouseAI_icon} alt="" />
                                    <span className='text-sm font-semibold text-white/70'> AI</span>
                                </div>
                                <div className='bg-white/5 text-white/40 py-0.5 px-3 flex space-x-1 rounded-full items-center'>
                                    <FlaskConical size={14} />
                                    <span className='text-xs font-semibold '>Experimental</span>
                                </div>

                            </div>
                            <div className={`w-100 h-0.5 bg-white/5 rounded-full mx-auto mb-3 ${aiChatBotState.isWaitingForResponse ? 'animate-pulse' : ''}`}></div>
                            {aiChatBotState.messages.length > 0 && !aiChatBotState.error.isError ? (
                                <div className='flex-col h-[237px] w-full  space-y-4 overflow-scroll scrollbar-w-2 scrollbar scrollbar-thumb-white/20 scrollbar-thumb-rounded-full scrollbar-track-rounded-full'>
                                    {aiChatBotState.messages.map((message: AIMessage, index: number) => {
                                        return (
                                            <AIMessage key={index} message={message} animated={message.sender == 'ai' ? true : false} />
                                        )
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>
                            ) : (
                                <AIMessagePlaceHolder sendMessage={sendMessage} activity_uuid={props.activity.activity_uuid} />
                            )}
                            {aiChatBotState.error.isError && (
                                <div className='flex items-center h-[237px]'>
                                    <div className='flex flex-col mx-auto w-[600px] space-y-2 p-5 rounded-lg bg-red-500/20 outline outline-1 outline-red-500'>
                                        <AlertTriangle size={20} className='text-red-500' />
                                        <div className='flex flex-col'>
                                            <h3 className='font-semibold text-red-200'>Something wrong happened</h3>
                                            <span className='text-red-100 text-sm '>{aiChatBotState.error.error_message}</span>
                                        </div>
                                    </div>
                                </div>

                            )
                            }
                            <div className='flex space-x-2 items-center'>
                                <div className=''>
                                    <Avvvatars radius={3} border borderColor='white' borderSize={3} size={35} value={session.user.user_uuid} style="shape" />
                                </div>
                                <div className='w-full'>
                                    <input onKeyDown={handleKeyDown} onChange={handleChange} disabled={aiChatBotState.isWaitingForResponse} value={aiChatBotState.chatInputValue} placeholder='Ask AI About this Lecture' type="text" className={inputClass} name="" id="" />

                                </div>
                                <div className=''>
                                    <MessageCircle size={20} className='text-white/50 hover:cursor-pointer' onClick={() => sendMessage(aiChatBotState.chatInputValue)} />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}

type AIMessageProps = {
    message: AIMessage;
    animated: boolean;
}

function AIMessage(props: AIMessageProps) {
    const session = useSession() as any;

    const words = props.message.message.split(' ');

    return (
        <div className='flex space-x-2 w-full antialiased font-medium'>
            <div className=''>
                <Avvvatars radius={3} border borderColor='white' borderSize={3} size={35} value={props.message.type == 'ai' ? 'ai' : session.user.user_uuid} style="shape" />
            </div>
            <div className='w-full'>
                <p className='w-full rounded-lg outline-none px-2 py-1 text-white text-md placeholder:text-white/30' id="">
                    <AnimatePresence>
                        {words.map((word: string, i: number) => (
                            <motion.span
                                key={i}
                                initial={props.animated ? { opacity: 0, y: -10 } : { opacity: 1, y: 0 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={props.animated ? { opacity: 0, y: 10 } : { opacity: 1, y: 0 }}
                                transition={props.animated ? { delay: i * 0.1 } : {}}
                            >
                                {word + ' '}
                            </motion.span>
                        ))}
                    </AnimatePresence>
                </p>
            </div>
        </div>
    )
}

const AIMessagePlaceHolder = (props: { activity_uuid: string, sendMessage: any }) => {
    const session = useSession() as any;
    const [feedbackModal, setFeedbackModal] = React.useState(false);
    const aiChatBotState = useAIChatBot() as AIChatBotStateTypes;

    if (!aiChatBotState.error.isError) {
        return <div className='flex-col h-[237px] w-full'>
            <div className='flex flex-col text-center justify-center pt-12'>
                <motion.div
                    initial={{ y: 20, opacity: 0, filter: 'blur(5px)' }}
                    animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                    exit={{ y: 50, opacity: 0, }}
                    transition={{ type: "spring", bounce: 0.35, duration: 1.7, mass: 0.2, velocity: 2, delay: 0.17 }}

                >

                    <Image width={100} className='mx-auto' src={learnhouseAI_logo_black} alt="" />
                    <p className='pt-3 text-2xl font-semibold text-white/70 flex justify-center space-x-2 items-center'>
                        <span className='items-center'>Hello</span>
                        <span className='capitalize flex space-x-2 items-center'> <Avvvatars radius={3} border borderColor='white' borderSize={3} size={25} value={session.user.user_uuid} style="shape" />
                            <span>{session.user.username},</span>
                        </span>
                        <span>how can we help today ?</span>
                    </p>
                </motion.div>
                <motion.div
                    initial={{ y: 20, opacity: 0, filter: 'blur(5px)' }}
                    animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                    exit={{ y: 50, opacity: 0, }}
                    transition={{ type: "spring", bounce: 0.35, duration: 1.7, mass: 0.2, velocity: 2, delay: 0.27 }}

                    className='questions flex space-x-3 mx-auto pt-6 flex-wrap justify-center'
                >
                    <AIChatPredefinedQuestion sendMessage={props.sendMessage} label='about' />
                    <AIChatPredefinedQuestion sendMessage={props.sendMessage} label='flashcards' />
                    <AIChatPredefinedQuestion sendMessage={props.sendMessage} label='examples' />
                </motion.div>
            </div>
        </div>
    }
}

const AIChatPredefinedQuestion = (props: { sendMessage: any, label: string }) => {
    function getQuestion(label: string) {
        if (label === 'about') {
            return `What is this Activity about ?`
        } else if (label === 'flashcards') {
            return `Generate flashcards about this Activity`
        } else if (label === 'examples') {
            return `Explain this Activity in practical examples`
        }
    }

    return (
        <div onClick={() => props.sendMessage(getQuestion(props.label))} className='flex space-x-1.5 items-center bg-white/5 cursor-pointer px-4 py-1.5 rounded-xl outline outline-1 outline-neutral-100/10 text-xs font-semibold text-white/40 hover:text-white/60 hover:bg-white/10 hover:outline-neutral-200/40 delay-75 ease-linear transition-all'>
            {props.label === 'about' && <BadgeInfo size={15} />}
            {props.label === 'flashcards' && <NotebookTabs size={15} />}
            {props.label === 'examples' && <div className='text-white/50'>Ex</div>}
            <span>{getQuestion(props.label)}</span>
        </div>
    )
}


export default AIActivityAsk