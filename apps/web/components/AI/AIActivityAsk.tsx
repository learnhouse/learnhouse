import { useSession } from '@components/Contexts/SessionContext'
import { sendActivityAIChatMessage, startActivityAIChatSession } from '@services/ai/ai';
import Avvvatars from 'avvvatars-react';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, Keyboard, MessageCircle, Sparkle, Sparkles, X } from 'lucide-react'
import Image from 'next/image';
import { send } from 'process';
import learnhouseAI_icon from "public/learnhouse_ai_simple.png";
import learnhouseAI_logo_black from "public/learnhouse_ai_black_logo.png";
import React, { useEffect, useRef } from 'react'


type AIActivityAskProps = {
    activity: any;
}


function AIActivityAsk(props: AIActivityAskProps) {
    const [isAIModalOpen, setIsAIModalOpen] = React.useState(false);



    return (
        <div className=''>
            <ActivityChatMessageBox isAIModalOpen={isAIModalOpen} setIsAIModalOpen={setIsAIModalOpen} activity={props.activity} />
            <div
                onClick={() => setIsAIModalOpen(true)}
                style={{
                    background: 'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)',
                }}
                className="rounded-full px-5 drop-shadow-md flex  items-center space-x-1 p-2.5 text-sm text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out hover:scale-105">
                {" "}
                <i>
                    <Image width={20} src={learnhouseAI_icon} alt="" />
                </i>{" "}
                <i className="not-italic text-xs font-bold">Ask AI</i>
            </div>
        </div>
    )
}

type Message = {
    sender: string;
    message: any;
    type: 'ai' | 'user';
}

type ActivityChatMessageBoxProps = {
    activity: any;
    isAIModalOpen?: boolean;
    setIsAIModalOpen?: any;
}

function ActivityChatMessageBox(props: ActivityChatMessageBoxProps) {
    const session = useSession() as any;
    const [messages, setMessages] = React.useState([]) as [Message[], any];
    const [aichat_uuid, setAichat_uuid] = React.useState('');
    const [isWaitingForResponse, setIsWaitingForResponse] = React.useState(false);
    const [chatInputValue, setChatInputValue] = React.useState('') as [string, any];

    // TODO : come up with a better way to handle this
    const inputClass = isWaitingForResponse
        ? 'ring-1 ring-inset ring-white/10 bg-transparent w-full rounded-lg outline-none px-4 py-2 text-white text-sm placeholder:text-white/30 opacity-30 '
        : 'ring-1 ring-inset ring-white/10 bg-transparent w-full rounded-lg outline-none px-4 py-2 text-white text-sm placeholder:text-white/30';

    useEffect(() => {
        if (props.isAIModalOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
    }, [props.isAIModalOpen]);

    function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Enter') {
            // Perform the sending action here
            sendMessage(event.currentTarget.value);
        }
    }

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setChatInputValue(event.target.value);
    }

    const sendMessage = async (message: string) => {
        if (aichat_uuid) {
            setMessages((messages: any) => [...messages, { sender: session.user.user_uuid, message: message, type: 'user' }]);
            setIsWaitingForResponse(true);
            const response = await sendActivityAIChatMessage(message, aichat_uuid, props.activity.activity_uuid)
            setIsWaitingForResponse(false);
            setChatInputValue('');
            setMessages((messages: any) => [...messages, { sender: 'ai', message: response.message, type: 'ai' }]);
        } else {
            setMessages((messages: any) => [...messages, { sender: session.user.user_uuid, message: message, type: 'user' }]);
            setIsWaitingForResponse(true);
            const response = await startActivityAIChatSession(message, props.activity.activity_uuid)
            setAichat_uuid(response.aichat_uuid);
            setIsWaitingForResponse(false);
            setChatInputValue('');
            setMessages((messages: any) => [...messages, { sender: 'ai', message: response.message, type: 'ai' }]);
        }
    }

    function closeModal() {
        props.setIsAIModalOpen(false);
    }

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }

    }, [messages, session]);


    return (
        <AnimatePresence>
            {props.isAIModalOpen && (
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
                        <div className={`flex space-x-2 items-center -ml-[100px] ${isWaitingForResponse ? 'animate-pulse' : ''}`}>
                            <Image className={`${isWaitingForResponse ? 'animate-bounce' : ''}`} width={24} src={learnhouseAI_icon} alt="" />
                            <span className='text-sm font-semibold text-white/70'>Learnhouse AI</span>
                        </div>
                        <div className='bg-white/5 text-white/40 py-0.5 px-3 flex space-x-1 rounded-full items-center'>
                            <FlaskConical size={14} />
                            <span className='text-xs font-semibold '>Experimental</span>
                        </div>

                    </div>
                    <div className={`w-100 h-0.5 bg-white/5 rounded-full mx-auto mb-3 ${isWaitingForResponse ? 'animate-pulse' : ''}`}></div>
                    {messages.length > 0 ? (
                        <div className='flex-col h-[237px] w-full  space-y-4 overflow-scroll scrollbar-w-2 scrollbar scrollbar-thumb-white/20 scrollbar-thumb-rounded-full scrollbar-track-rounded-full'>
                            {messages.map((message: Message, index: number) => {
                                return (
                                    <AIMessage key={index} message={message} animated={message.sender == 'ai' ? true : false} />
                                )
                            })}
                            <div ref={messagesEndRef} />
                        </div>
                    ) : (
                        <AIMessagePlaceHolder sendMessage={sendMessage} activity_uuid={props.activity.activity_uuid} />
                    )}
                    <div className='flex space-x-2 items-center'>
                        <div className=''>
                            <Avvvatars radius={3} border borderColor='white' borderSize={3} size={35} value={session.user.user_uuid} style="shape" />
                        </div>
                        <div className='w-full'>
                            <input onKeyDown={handleKeyDown} onChange={handleChange} disabled={isWaitingForResponse} value={chatInputValue} placeholder='Ask AI About this Lecture' type="text" className={inputClass} name="" id="" />

                        </div>
                        <div className=''>
                            <MessageCircle size={20} className='text-white/50 hover:cursor-pointer' onClick={() => sendMessage(chatInputValue)} />
                        </div>
                    </div>
                </div>
            </motion.div>
            )}
        </AnimatePresence>
    )
}

type AIMessageProps = {
    message: Message;
    animated: boolean;
}

function AIMessage(props: AIMessageProps) {
    const session = useSession() as any;

    const words = props.message.message.split(' ');

    return (
        <div className='flex space-x-2 w-full'>
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
    return (
        <div className='flex-col h-[237px] w-full'>
            <div className='flex flex-col text-center justify-center pt-12'>
                <Image width={100} className='mx-auto' src={learnhouseAI_logo_black} alt="" />
                <p className='pt-3 text-2xl font-semibold text-white/60'>Hello {session.user.username}, How can we help today ?</p>
                <div className='questions flex space-x-3 mx-auto pt-12 flex-wrap   justify-center'>
                    <span onClick={() => props.sendMessage('Explain this Course in Simple examples.')} className='py-1.5 px-6 text-xs font-semibold text-white/30 rounded-full shadow-2xl bg-black/20 mb-3 outline outline-gray-400/5 cursor-pointer'>Explain in simple examples</span>
                    <span onClick={() => props.sendMessage('Generate flashcards about this course and this lecture.')} className='py-1.5 px-6 text-xs font-semibold text-white/30 rounded-full shadow-2xl bg-black/20 mb-3 outline outline-gray-400/5 cursor-pointer'>Generate flashcards</span>
                    <span onClick={() => props.sendMessage('Break down this Course in concepts.')} className='py-1.5 px-6 text-xs font-semibold text-white/30 rounded-full shadow-2xl bg-black/20 mb-3 outline outline-gray-400/5 cursor-pointer'>Break down in concepts</span>
                </div>
            </div>
        </div>
    )
}


export default AIActivityAsk