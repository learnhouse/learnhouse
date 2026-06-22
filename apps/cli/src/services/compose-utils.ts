// Utilities for reading and mutating docker-compose.yml content.
// Extracted so tests import the real regex rather than inlining a copy.

const GHCR_IMAGE_RE = /image:\s*ghcr\.io\/learnhouse\/app:\S+/

export function replaceComposeImageTag(compose: string, newImage: string): string {
  return compose.replace(GHCR_IMAGE_RE, `image: ${newImage}`)
}
