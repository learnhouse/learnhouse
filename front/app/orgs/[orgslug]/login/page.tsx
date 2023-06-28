"use client";
import { useRouter } from 'next/navigation';
import React, { useState } from "react";
import { styled } from '@stitches/react';
import { loginAndGetToken } from "../../../../services/auth/auth";
import FormLayout, { ButtonBlack, Flex, FormField, FormLabel, FormMessage, Input } from '@components/StyledElements/Form/Form';
import * as Form from '@radix-ui/react-form';
import { BarLoader } from 'react-spinners';
import Toast from '@components/StyledElements/Toast/Toast';
import { toast } from 'react-hot-toast';

const Login = () => {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = (e: any) => {
    e.preventDefault();
    setIsSubmitting(true);
    toast.promise(
      loginAndGetToken(email, password),
      {
        loading: 'Logging in...',
        success: () => {
          router.push('/');
          return <b>Logged in successfully</b>;
        },
        error: <b>Wrong credentials</b>,
      }
    );

    setIsSubmitting(false);
  };

  const handleEmailChange = (e: any) => {
    setEmail(e.target.value);
  };

  const handlePasswordChange = (e: any) => {
    setPassword(e.target.value);
  };

  return (
    <div>
      <LoginPage>
        <Toast></Toast>
        <LoginBox>
          <FormLayout onSubmit={handleSubmit}>
            <FormField name="login-email">
              <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                <FormLabel>Email</FormLabel>
                <FormMessage style={{ color: "black" }} match="valueMissing">Please provide an email</FormMessage>
              </Flex>
              <Form.Control asChild>
                <Input onChange={handleEmailChange} type="text" />
              </Form.Control>
            </FormField>
            <FormField name="login-password">
              <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                <FormLabel>Password</FormLabel>
                <FormMessage style={{ color: "black" }} match="valueMissing">Please provide a password</FormMessage>
              </Flex>
              <Form.Control asChild>
                <Input type="password" onChange={handlePasswordChange} />
              </Form.Control>
            </FormField>

            <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
              <Form.Submit asChild>
                <ButtonBlack type="submit" css={{ marginTop: 10 }}>
                  {isSubmitting ? <BarLoader cssOverride={{ borderRadius: 60, }} width={60} color="#ffffff" /> : "Login"}
                </ButtonBlack>
              </Form.Submit>
            </Flex>
          </FormLayout>
        </LoginBox>
      </LoginPage>

    </div>
  );
};

const LoginPage = styled('div', {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100vh',
  width: '100vw',
  backgroundColor: '#f5f5f5',
});

const LoginBox = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  height: '40vh',
  width: '40vw',
  backgroundColor: '#ffffff',
  borderRadius: 10,

  '@media (max-width: 768px)': {
    width: '100vw',
    height: '100vh',
    borderRadius: 0,
  },
});

export default Login;
