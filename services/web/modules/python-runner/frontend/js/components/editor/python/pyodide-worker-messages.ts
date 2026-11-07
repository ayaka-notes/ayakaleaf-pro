export type OutputStream = 'stdout' | 'stderr' | 'info'

export type ProjectFileData = {
  relativePath: string
  content: string
}

export type OutputFileData = {
  relativePath: string
  content: Uint8Array
}

// Main thread -> Worker messages

export type InitRequest = {
  type: 'init'
  baseAssetPath: string
}

export type RunCodeRequest = {
  type: 'run-code'
  fileId: string
  executionId: string
  code: string
  files: ProjectFileData[]
}

export type PyodideWorkerRequest = InitRequest | RunCodeRequest

// Worker -> Main thread lifecycle and streaming events

export type ListeningEvent = { type: 'listening' }
export type LoadedEvent = { type: 'loaded' }
export type LoadingFailedEvent = { type: 'loading-failed'; error: string }

export type OutputLineEvent = {
  type: 'output-line'
  stream: OutputStream
  line: string
  fileId: string
  executionId: string
}

export type PyodideWorkerEvent =
  | ListeningEvent
  | LoadedEvent
  | LoadingFailedEvent
  | OutputLineEvent

// Worker -> Main thread ID responses

export type ExecutionErrorType =
  | 'SyntaxError'
  | 'ModuleNotFoundError'
  | 'OutputLimitExceeded'
  | 'UploadFileError'
  | 'generic'

export type ExecutionResult = 'success' | 'error'

export type RunCodeResult = {
  type: 'run-code-result'
  fileId: string
  executionId: string
  success: boolean
  outputs: string[]
  outputFiles: OutputFileData[]
  imports: string[]
  errorType?: ExecutionErrorType
}

export type PyodideWorkerResponse = PyodideWorkerEvent | RunCodeResult
