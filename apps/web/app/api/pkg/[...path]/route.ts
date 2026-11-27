// Package content route on the separate content origin. Resolves to the EE implementation when present, to a 404 stub otherwise.
export { GET, POST, OPTIONS } from '@ee/app/api/pkg/[...path]/route'
