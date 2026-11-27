import { useEffect, useState } from 'react'
import { useProjectContext } from '../../../shared/context/project-context'
import { BinaryFile } from '@/features/file-view/types/binary-file'

/**
 * SVG preview for the file view.
 *
 * The project blob endpoint serves files with a generic
 * `application/octet-stream` content type (raster images rely on browser
 * sniffing and render fine that way), but browsers — Chrome in particular —
 * refuse to render SVG in an <img> without an explicit `image/svg+xml`
 * MIME. So we fetch the blob as text and hand the browser a same-origin
 * object URL created with the proper type. (An <img> embed keeps the SVG
 * in a safe rendering context: no script execution, no DOM access.)
 */
export default function FileViewSvg({
  file,
  onLoad,
  onError,
}: {
  file: BinaryFile
  onLoad: () => void
  onError: () => void
}) {
  const { projectId } = useProjectContext()
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const url = `/project/${projectId}/blob/${file.hash}`

  useEffect(() => {
    let alive = true
    let objectUrl = ''
    setSrc('')
    setFailed(false)
    window
      .fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`fetch_status_${r.status}`)
        return r.text()
      })
      .then(text => {
        if (!alive) return
        objectUrl = URL.createObjectURL(
          new Blob([text], { type: 'image/svg+xml' })
        )
        setSrc(objectUrl)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  useEffect(() => {
    if (failed) onError()
  }, [failed, onError])

  if (failed) return null

  return (
    <img
      src={src || undefined}
      onLoad={onLoad}
      onError={() => {
        if (!failed) {
          setFailed(true)
          onError()
        }
      }}
      alt={file.name}
    />
  )
}
