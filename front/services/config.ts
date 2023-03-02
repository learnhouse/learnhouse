const LEARNHOUSE_API_URL = "http://localhost:1338/api/";
const LEARNHOUSE_BACKEND_URL = "http://localhost:1338/";

export const getAPIUrl = () => LEARNHOUSE_API_URL;

export const getBackendUrl = () => LEARNHOUSE_BACKEND_URL;

export const getUriWithOrg = (orgslug: string, path: string) => {
  return `http://${orgslug}.localhost:3000${path}`;
};

export const getOrgFromUri = () => {
  const hostname = window.location.hostname;
  // get the orgslug from the hostname
  const orgslug = hostname.split(".")[0];
  return orgslug;
  
};
