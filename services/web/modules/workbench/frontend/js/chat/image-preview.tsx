/**
 * Shows an image larger, with its name, while the pointer rests on or the
 * keyboard focuses the element it wraps.
 */
import { useId, type ReactElement } from 'react'
import { OverlayTrigger } from 'react-bootstrap'
import OLPopover from '@/shared/components/ol/ol-popover'
import { muted } from './themed'

const SIZE = 240

export default function ImagePreview({
  src,
  name,
  children,
}: {
  src: string
  name: string
  children: ReactElement
}) {
  const id = useId()
  return (
    <OverlayTrigger
      placement="top"
      trigger={['hover', 'focus']}
      // A short delay keeps it from flashing while the pointer passes by
      delay={{ show: 200, hide: 0 }}
      overlay={
        <OLPopover id={`image-preview-${id}`}>
          <figure className="mb-0 d-flex flex-column gap-1">
            <img
              src={src}
              alt={name}
              className="rounded"
              style={{ maxWidth: SIZE, maxHeight: SIZE, objectFit: 'contain' }}
            />
            <figcaption
              className="text-truncate"
              style={{ ...muted, maxWidth: SIZE, fontSize: 'var(--font-size-01)' }}
            >
              {name}
            </figcaption>
          </figure>
        </OLPopover>
      }
    >
      {children}
    </OverlayTrigger>
  )
}
