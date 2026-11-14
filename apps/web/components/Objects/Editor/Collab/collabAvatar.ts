import { getUserAvatarMediaDirectory } from '@services/media/media'

/** Avatar URL of a collaborator from the file name or URL the API gave. */
export function avatarUrl(user: { avatar: string | null; uuid: string | null }): string | null {
  if (!user.avatar) return null
  if (/^https?:\/\//.test(user.avatar)) return user.avatar
  return user.uuid ? getUserAvatarMediaDirectory(user.uuid, user.avatar) : null
}
