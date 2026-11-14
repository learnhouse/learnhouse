/** The subset of a Library Media row a blockLibrary caches so it paints before refetching. */
export function librarySnapshotOf(resource: any) {
  if (!resource) return null
  return {
    name: resource.name ?? '',
    media_type: resource.media_type ?? null,
    file_format: resource.file_format ?? null,
    file_mime: resource.file_mime ?? null,
    file_size: resource.file_size ?? null,
    url: resource.url ?? null,
    thumbnail_image: resource.thumbnail_image ?? null,
  }
}

/** Attrs for a blockLibrary node that points at a Library media file. */
export function libraryMediaNodeAttrs(selected: { resource_uuid: string; resource?: any; name?: string }) {
  return {
    resourceUuid: selected.resource_uuid,
    resourceType: 'media',
    snapshot: librarySnapshotOf(selected.resource) ?? { name: selected.name ?? '' },
    display: 'inline',
  }
}
