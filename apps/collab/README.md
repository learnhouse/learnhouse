# @learnhouse/collab

Real-time collaboration server for LearnHouse boards, built on
[Hocuspocus](https://tiptap.dev/docs/hocuspocus) (Yjs). It is a **long-lived
WebSocket process**: it binds a port (`COLLAB_PORT`, default `4000`), holds
persistent connections, keeps in-memory state (rate limiting, debounced DB
flushes), and shuts down gracefully on `SIGTERM`/`SIGINT`.

## Hosting

Run it as the **container** it's built to be (see `Dockerfile`) on a platform
that supports persistent WebSocket servers — k8s, Fly.io, Railway, Render, etc.

```sh
docker build -t learnhouse-collab .
docker run -p 4000:4000 --env-file .env learnhouse-collab
```

### Not deployed on Vercel

`vercel.json` sets `git.deploymentEnabled: false` on purpose. Vercel's
serverless/Fluid Compute model is request-scoped and cannot host a raw
WebSocket server that binds a port and keeps connections open, so automatic
Vercel deployments for this app are disabled rather than left to fail. Deploy
collab via its container instead.
