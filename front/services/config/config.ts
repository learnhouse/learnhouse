const LEARNHOUSE_API_URL = "http://localhost:1338/api/";
const LEARNHOUSE_BACKEND_URL = "http://localhost:1338/";

export const getAPIUrl = () => LEARNHOUSE_API_URL;

export const getBackendUrl = () => LEARNHOUSE_BACKEND_URL;

export const getSelfHostedOption = () => false;

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
    const hostname = window.location.hostname;
    // get the orgslug from the hostname
    const orgslug = hostname.split(".")[0];
    return orgslug;
  }
};

export const getDefaultOrg = () => {
  const selfHosted = getSelfHostedOption();
  if (selfHosted) {
    return "test";
  }
};
