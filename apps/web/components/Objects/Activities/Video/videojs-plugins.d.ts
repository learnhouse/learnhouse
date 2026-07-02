// Ambient declarations for Video.js plugins that ship without TypeScript types.
// They register themselves on the Video.js Player (side-effect imports); we call
// them via `(player as any).<plugin>(...)`.
declare module 'videojs-contrib-quality-levels'
declare module 'videojs-hls-quality-selector'
declare module 'videojs-sprite-thumbnails'
