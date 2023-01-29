const LEARNHOUSE_API_URL = "http://localhost:1338/api/";
const LEARNHOUSE_BACKEND_URL = "http://localhost:1338/";

export const getAPIUrl = () => LEARNHOUSE_API_URL;

export const getBackendUrl = () => LEARNHOUSE_BACKEND_URL;

export const getUriWithOrg = ( orgslug: string, path: string) => {
  return `http://localhost:3000/org/${orgslug}${path}`;
};

export const getOrgFromUri = (uri: any) => {
  let org = uri.match(/\/org\/([\w]+)/)[1];
  return org;
};
