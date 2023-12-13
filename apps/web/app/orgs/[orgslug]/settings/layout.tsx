"use client";
import React, { createContext, useState } from 'react'
import { styled } from '@stitches/react';
import Link from 'next/link';
import LearnHouseWhiteLogo from '@public/learnhouse_text_white.png';
import AuthProvider, { AuthContext } from '@components/Security/AuthProviderDepreceated';
import Avvvatars from 'avvvatars-react';
import Image from 'next/image';
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement';
import { getOrganizationContextInfo } from '@services/organizations/orgs';
import useSWR, { mutate } from "swr";
import { getAPIUrl } from '@services/config/config';
import { swrFetcher } from '@services/utils/ts/requests';

function SettingsLayout({ children, params }: { children: React.ReactNode, params: any }) {
    const auth: any = React.useContext(AuthContext);
    const orgslug = params.orgslug;

    const { data: org, error: error } = useSWR(`${getAPIUrl()}orgs/slug/${orgslug}`, swrFetcher);

    return (
        <>
            <AuthProvider>
                <Main>
                    <LeftWrapper>
                        <LeftTopArea>

                            <Link href={"/"}><Image alt="Learnhouse logo" width={128} src={LearnHouseWhiteLogo} /></Link>
                            {auth.isAuthenticated && (
                                <Avvvatars value={auth.userInfo.user_object.user_id} style="shape" />
                            )}
                        </LeftTopArea>
                        <LeftMenuWrapper>
                            <MenuTitle>Account</MenuTitle>
                            <ul>
                                <li><Link href="/settings/account/profile">Profile</Link></li>
                                <li><Link href="/settings/account/passwords">Passwords</Link></li>
                            </ul>
                            <AuthenticatedClientElement
                                ressourceType='organization'
                                action='update'
                                checkMethod='roles'  >
                                <MenuTitle>Organization</MenuTitle>
                                <ul>
                                    <li><Link href="/settings/organization/general">General</Link></li>
                                </ul>
                            </AuthenticatedClientElement>
                        </LeftMenuWrapper>
                    </LeftWrapper>
                    <RightWrapper>
                        {children}
                    </RightWrapper>
                </Main></AuthProvider>
        </>
    )
}

export default SettingsLayout


const Main = styled('div', {
    display: 'flex',
})

const LeftWrapper = styled('div', {
    width: '270px',
    background: "linear-gradient(348.55deg, #010101 -8.61%, #343434 105.52%);",
    height: '100vh',
    padding: '20px',
})

const LeftTopArea = styled('div', {
    display: 'flex',
    marginLeft: '20px',

    alignItems: 'center',

    img: {
        marginRight: '20px',
    },

    a: {
        display: 'flex',
        placeItems: 'center',
        placeContent: 'center',

    }

})

const LeftMenuWrapper = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    padding: '20px',

    ul: {
        listStyle: 'none',
        padding: 0,
        margin: 0,
        li: {
            marginBottom: '10px',
            a: {
                color: '#ffffff8c',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 'bold',
                '&:hover': {
                    textDecoration: 'underline',
                }
            }
        }
    }

})

const MenuTitle = styled('h3', {
    color: 'white',
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '20px',
})

const RightWrapper = styled('div', {
    flex: 1,
    padding: '20px',
    boxSizing: 'border-box',
    margin: '40px',
})