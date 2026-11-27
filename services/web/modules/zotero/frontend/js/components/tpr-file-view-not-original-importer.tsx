import type { LinkedFile, LinkedFileData } from '@/features/file-view/types/binary-file'

type TPRFileViewNotOriginalImporterProps = {
  file: LinkedFile<keyof LinkedFileData>
}

// Keep the exported hook until its host registration can be removed together.
export function TPRFileViewNotOriginalImporter(_props: TPRFileViewNotOriginalImporterProps) {

  return null
}
