// xAPI LRS proxy route. Resolves to the EE implementation when present, to a 404 stub otherwise.
export { GET, HEAD, OPTIONS, PUT, POST, DELETE } from '@ee/app/api/xapi/[...path]/route'
