/**
 * Displays message attachments, with hover previews for images.
 */
import { useId } from 'react'
import { OverlayTrigger, Popover } from 'react-bootstrap'
import MaterialIcon from '@/shared/components/material-icon'

export const FilePart = ({
  part,
}: {
  part: { filename?: string; mediaType?: string; url?: string }
}) => {
  const filename = part.filename || ''
  const isImage = part.mediaType?.startsWith('image/') && part.url
  const popoverId = useId()
  const chip = (
    <div className="d-inline-flex align-items-center gap-1 border rounded px-2 py-1 small me-1 mb-1 workbench-attachment">
      <div
        className="position-relative d-inline-flex align-items-center"
        style={{ width: 20, height: 20 }}
      >
        {isImage ? (
          <img
            alt={filename || 'attachment'}
            src={part.url}
            width={20}
            height={20}
            style={{
              objectFit: 'cover',
              borderRadius: 4,
              border: '1px solid var(--bs-border-color)',
            }}
          />
        ) : (
          <MaterialIcon type="attach_file" />
        )}
      </div>
      <span className="text-truncate ms-1" style={{ maxWidth: 140 }}>
        {filename || (isImage ? 'Image' : 'Attachment')}
      </span>
    </div>
  )
  if (isImage) {
    const overlay = (
      <Popover id={popoverId}>
        <Popover.Body>
          <img
            alt={filename || 'attachment preview'}
            src={part.url}
            style={{
              maxWidth: '100%',
              maxHeight: 300,
              objectFit: 'contain',
              border: '1px solid var(--bs-border-color)',
              borderRadius: 4,
            }}
          />
        </Popover.Body>
      </Popover>
    )
    return (
      <OverlayTrigger trigger={['hover', 'focus']} placement="auto-start" overlay={overlay}>
        {chip}
      </OverlayTrigger>
    )
  }
  return chip
}
