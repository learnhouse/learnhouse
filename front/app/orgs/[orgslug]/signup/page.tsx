"use client";
import React from "react";
import { signup } from "../../../../services/auth/auth";
import { useRouter } from "next/navigation";

const SignUp = (params: any) => {
  const org_slug = params.params.orgslug;
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [username, setUsername] = React.useState("");

  const handleSubmit = (e: any) => {
    e.preventDefault();
    console.log({ email, password, username, org_slug });
    alert(JSON.stringify({ email, password, username, org_slug }));
    try {
      signup({ email, password, username, org_slug });
      router.push("/");
    }
    catch (err) {
      console.log(err);
    }
  };

  const handleEmailChange = (e: any) => {
    setEmail(e.target.value);
  };

  const handlePasswordChange = (e: any) => {
    setPassword(e.target.value);
  };

  const handleUsernameChange = (e: any) => {
    setUsername(e.target.value);
  };

  return (
    <div>
      <div title="Sign up">
        <div className="font-bold text-lg">Sign up </div>

        <div className="flex justify-center items-center h-screen">
          <div className="w-full max-w-md">
            <form onSubmit={handleSubmit}>
              <div className="mb-4 space-y-3">
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={email}
                  onChange={handleEmailChange}
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  placeholder="Email"
                />

                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Username
                </label>

                <input
                  type="text"
                  name="username"
                  value={username}
                  onChange={handleUsernameChange}
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  placeholder="Username"
                />

                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Password
                </label>

                <input
                  type="password"
                  name="password"
                  value={password}
                  onChange={handlePasswordChange}
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  placeholder="Password"
                />

                <button
                  type="submit"
                  className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                  Sign up
                </button>

                <a
                  href="/login"
                  className="inline-block align-baseline font-bold text-sm text-blue-500 hover:text-blue-800 ml-3"
                >
                  Already have an account? Login
                </a>

                <a
                  href="/"
                  className="inline-block align-baseline font-bold text-sm text-blue-500 hover:text-blue-800 ml-3"
                >
                  Home
                </a>


              </div>
            </form>

          </div>
        </div>
      </div>
    </div>
  );
};
export default SignUp;
