import Router from "next/router";
import React from "react";
import { Header } from "../components//UI/Header";
import Layout from "../components//UI/Layout";
import { Title } from "../components//UI/Elements/Styles/Title";
import { loginAndGetToken } from "../services/auth/auth";

const Login = () => {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const handleSubmit = (e: any) => {
    e.preventDefault();
    console.log({ email, password });
    alert(JSON.stringify({ email, password }));
    try {
      loginAndGetToken(email, password);
      Router.push("/");
    }
    catch (e) {
      console.log(e);
    }
  };

  const handleEmailChange = (e: any) => {
    setEmail(e.target.value);
  };

  const handlePasswordChange = (e: any) => {
    setPassword(e.target.value);
  };

  return (
    <div>
      <Layout title="Login">
      <Header></Header>
        <Title>Login</Title>

        <form>
          <input onChange={handleEmailChange} type="text" placeholder="email" />
          <input onChange={handlePasswordChange} type="password" placeholder="password" />
          <button onClick={handleSubmit} type="submit">
            Login
          </button>
        </form>
      </Layout>
    </div>
  );
};

export default Login;
