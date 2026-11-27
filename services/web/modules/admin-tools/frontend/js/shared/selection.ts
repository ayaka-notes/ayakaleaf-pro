import { useCallback, useState } from 'react'
import { getUserFacingMessage } from '@/infrastructure/fetch-json'

// The rows ticked for a bulk action, as core's project list: the header box
// ticks the rows of the page; a new page, filter or search starts afresh
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const setAll = useCallback((ids: string[], checked: boolean) => {
    setSelected(checked ? new Set(ids) : new Set())
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  return { selected, toggle, setAll, clear }
}

export type BulkFailure = { title: string; message: string }

// The rows that failed, for the confirm modal to list; the others are done
export class BulkError extends Error {
  failures: BulkFailure[]

  constructor(failures: BulkFailure[]) {
    super(failures.map(f => `${f.title}: ${f.message}`).join('\n'))
    this.failures = failures
  }
}

// Runs the action on each row in turn and goes on
// past a failure
export async function runEach<T>(
  items: T[],
  titleOf: (item: T) => string,
  run: (item: T) => Promise<unknown>
) {
  const failures: BulkFailure[] = []
  for (const item of items) {
    try {
      await run(item)
    } catch (error) {
      failures.push({
        title: titleOf(item),
        message: getUserFacingMessage(error as Error) ?? '',
      })
    }
  }
  if (failures.length > 0) throw new BulkError(failures)
}
