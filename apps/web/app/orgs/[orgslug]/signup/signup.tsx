"use client";
import learnhouseIcon from "public/learnhouse_bigicon_1.png";
import Image from 'next/image';
import { getOrgLogoMediaDirectory } from '@services/media/media';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';
import { useSession } from "@components/Contexts/SessionContext";
import React, { useEffect } from "react";
import { MailWarning, Shield, UserPlus } from "lucide-react";
import { useOrg } from "@components/Contexts/OrgContext";
import UserAvatar from "@components/Objects/UserAvatar";
import OpenSignUpComponent from "./OpenSignup";
import InviteOnlySignUpComponent from "./InviteOnlySignUp";
import { useRouter, useSearchParams } from "next/navigation";
import { validateInviteCode } from "@services/organizations/invites";
import PageLoading from "@components/Objects/Loaders/PageLoading";
import Toast from "@components/StyledElements/Toast/Toast";
import toast from "react-hot-toast";

interface SignUpClientProps {
    org: any;
}

function SignUpClient(props: SignUpClientProps) {
    const session = useSession() as any;
    const [joinMethod, setJoinMethod] = React.useState('open');
    const [inviteCode, setInviteCode] = React.useState('');
    const searchParams = useSearchParams()
    const inviteCodeParam = searchParams.get('inviteCode')

    useEffect(() => {
        if (props.org.config) {
            setJoinMethod(props.org?.config?.config?.GeneralConfig.users.signup_mechanism);
            console.log(props.org?.config?.config?.GeneralConfig.users.signup_mechanism)
        }
        if (inviteCodeParam) {
            setInviteCode(inviteCodeParam);
        }
    }
        , [props.org, inviteCodeParam]);

    return (
        <div className='grid grid-flow-col justify-stretch h-screen'>
            <div className="right-login-part" style={{ background: "linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)" }} >
                <div className='login-topbar m-10'>
                    <Link prefetch href={getUriWithOrg(props.org.slug, "/")}>
                        <Image quality={100} width={30} height={30} src={learnhouseIcon} alt="" />
                    </Link>
                </div>
                <div className="ml-10 h-3/4 flex flex-row text-white">
                    <div className="m-auto flex space-x-4 items-center flex-wrap">
                        <div>You've been invited to join </div>
                        <div className="shadow-[0px_4px_16px_rgba(0,0,0,0.02)]" >
                            {props.org?.logo_image ? (
                                <img
                                    src={`${getOrgLogoMediaDirectory(props.org.org_uuid, props.org?.logo_image)}`}
                                    alt="Learnhouse"
                                    style={{ width: "auto", height: 70 }}
                                    className="rounded-xl shadow-xl inset-0 ring-1 ring-inset ring-black/10 bg-white"
                                />
                            ) : (
                                <Image quality={100} width={70} height={70} src={learnhouseIcon} alt="" />
                            )}
                        </div>
                        <div className="font-bold text-xl">{props.org?.name}</div>
                    </div>
                </div>
            </div>
            <div className="left-join-part bg-white flex flex-row">
                {joinMethod == 'open' && (
                    session.isAuthenticated ? <LoggedInJoinScreen inviteCode={inviteCode} /> : <OpenSignUpComponent />
                )}
                {joinMethod == 'inviteOnly' && (
                    inviteCode ? (
                        session.isAuthenticated ? <LoggedInJoinScreen /> : <InviteOnlySignUpComponent inviteCode={inviteCode} />
                    ) : <NoTokenScreen />
                )}
            </div>
        </div>
    )
}





const LoggedInJoinScreen = (props: any) => {
    const session = useSession() as any;
    const org = useOrg() as any;
    const [isLoading, setIsLoading] = React.useState(true);

    useEffect(() => {
        if (session && org) {
            setIsLoading(false);
        }

    }
        , [org, session]);


    return (
        <div className="flex flex-row  items-center mx-auto">
            <div className="flex space-y-7 flex-col justify-center items-center">
                <p className='pt-3 text-2xl font-semibold text-black/70 flex justify-center space-x-2 items-center'>
                    <span className='items-center'>Hi</span>
                    <span className='capitalize flex space-x-2 items-center'>
                        <UserAvatar rounded='rounded-xl' border='border-4' width={35} />
                        <span>{session.user.username},</span>
                    </span>
                    <span>join {org?.name} ?</span>
                </p>
                <button className="flex w-fit space-x-2 bg-black px-6 py-2 text-md rounded-lg font-semibold h-fit text-white items-center shadow-md">
                    <UserPlus size={18} />
                    <p>Join </p>
                </button>
            </div>
        </div>
    )

}

const NoTokenScreen = (props: any) => {
    const session = useSession() as any;
    const org = useOrg() as any;
    const router = useRouter();
    const [isLoading, setIsLoading] = React.useState(true);
    const [inviteCode, setInviteCode] = React.useState('');
    const [messsage, setMessage] = React.useState('bruh');

    const handleInviteCodeChange = (e: any) => {
        setInviteCode(e.target.value);
    }

    const validateCode = async () => {
        setIsLoading(true);
        let res = await validateInviteCode(org?.id, inviteCode);
        //wait for 1s 
        if (res.success) {
            toast.success("Invite code is valid, you'll be redirected to the signup page in a few seconds");
            setTimeout(() => {
                router.push(`/signup?inviteCode=${inviteCode}`);
            }, 2000);
        }
        else {
            toast.error("Invite code is invalid");
            setIsLoading(false);
        }

    }


    useEffect(() => {
        if (session && org) {
            setIsLoading(false);
        }

    }
        , [org, session]);

    return (
        <div className="flex flex-row  items-center mx-auto">
            <Toast />
            {isLoading ? <div className="flex space-y-7 flex-col w-[300px] justify-center items-center"><PageLoading /></div> : <div className="flex space-y-7 flex-col justify-center items-center">

                <p className="flex space-x-2 text-lg font-medium text-red-800 items-center">
                    <MailWarning size={18} />
                    <span>An invite code is required to join {org?.name}</span>
                </p>
                <input onChange={handleInviteCodeChange} className="bg-white outline-2 outline outline-gray-200 rounded-lg px-5 w-[300px] h-[50px]" placeholder="Please enter an invite code" type="text" />
                <button onClick={validateCode} className="flex w-fit space-x-2 bg-black px-6 py-2 text-md rounded-lg font-semibold h-fit text-white items-center shadow-md">
                    <Shield size={18} />
                    <p>Submit </p>
                </button>
            </div>}
        </div>
    )
}

export default SignUpClient