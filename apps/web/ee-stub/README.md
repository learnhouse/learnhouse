# ee-stub

Open-source stand-ins for the Enterprise Edition web modules.

OSS code imports EE modules through the `@ee/*` alias. At build time
`next.config.js` points that alias at `apps/web/ee` when it is present and at
this folder otherwise, so community builds compile without EE.

Every module imported from `@ee/*` outside of `ee/` must have a file here with
the same path and the same exports. Stubs render nothing or fall back to the
single-org behavior.
