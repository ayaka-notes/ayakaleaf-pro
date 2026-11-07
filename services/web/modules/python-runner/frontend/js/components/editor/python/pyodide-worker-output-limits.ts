const BYTES_PER_MB = 1024 * 1024

export const MAX_OUTPUT_FILES = 50
export const MAX_OUTPUT_TOTAL_BYTES = 100 * BYTES_PER_MB
export const MAX_OUTPUT_FILE_BYTES = 50 * BYTES_PER_MB

export type OutputLimitViolation = {
  kind: 'count' | 'total-output-size' | 'single-file-size'
  message: string
}

export function checkOutputCount(count: number): OutputLimitViolation | null {
  if (count > MAX_OUTPUT_FILES) {
    return {
      kind: 'count',
      message: `Output limit exceeded: ${count} files generated (max ${MAX_OUTPUT_FILES})`,
    }
  }
  return null
}

export function checkOutputLimits(
  files: { path: string; size: number }[]
): OutputLimitViolation | null {
  const countViolation = checkOutputCount(files.length)
  if (countViolation) {
    return countViolation
  }

  let totalBytes = 0
  for (const file of files) {
    if (file.size > MAX_OUTPUT_FILE_BYTES) {
      const fileMB = Math.ceil(file.size / BYTES_PER_MB)
      const maxMB = MAX_OUTPUT_FILE_BYTES / BYTES_PER_MB
      return {
        kind: 'single-file-size',
        message: `Output limit exceeded: ${file.path} is ${fileMB}MB (max ${maxMB}MB per file)`,
      }
    }
    totalBytes += file.size
  }

  if (totalBytes > MAX_OUTPUT_TOTAL_BYTES) {
    const totalMB = Math.ceil(totalBytes / BYTES_PER_MB)
    const maxMB = MAX_OUTPUT_TOTAL_BYTES / BYTES_PER_MB
    return {
      kind: 'total-output-size',
      message: `Output limit exceeded: ${totalMB}MB total (max ${maxMB}MB)`,
    }
  }

  return null
}
