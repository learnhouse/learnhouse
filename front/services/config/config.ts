const LEARNHOUSE_API_URL = "http://localhost:1338/api/";
const LEARNHOUSE_BACKEND_URL = "http://localhost:1338/";

export const getAPIUrl = () => LEARNHOUSE_API_URL;
export const getBackendUrl = () => LEARNHOUSE_BACKEND_URL;
export const getSelfHostedOption = () => (process.env.NEXT_PUBLIC_LEARNHOUSE_SELF_HOSTED === "true" ? true : false);

export const getUriWithOrg = (orgslug: string, path: string) => {
  const selfHosted = getSelfHostedOption();

  if (selfHosted) {
    return `http://localhost:3000${path}`;
  }
  return `http://${orgslug}.localhost:3000${path}`;
};

export const getOrgFromUri = () => {
  const selfHosted = getSelfHostedOption();
  if (selfHosted) {
    getDefaultOrg();
  } else {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname;
      
      return hostname.replace(".localhost", "");
    }
  }
};

export const getDefaultOrg = () => {
  const selfHosted = getSelfHostedOption();
  if (selfHosted) {
    return process.env.NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG;
  }
};
