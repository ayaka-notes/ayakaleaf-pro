import Path from 'node:path'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import logger from '@overleaf/logger'
import CommandRunner from './CommandRunner.js'
import SynctexAdapter from './SynctexAdapter.js'

// TypstRunner — the Typst compile engine for clsi-typst (sibling of the TeX
// clsi's LatexRunner).
//
// Node parity notes (ported from the OlliTeX Go `clsitypst/typstrunner`):
//
//  - Module-level ProcessTable keyed by `${projectId}` (the pid / container
//    name returned by CommandRunner.run).
//  - buildTypstCompileCommand:
//      sh -c 'echo "tinymist $(tinymist --version ...)" > "$3";
//             tinymist compile --synctex "$1" "$2" >> "$3" 2>&1; exit 0'
//    The trailing `exit 0` is deliberate: the compiler reports its
//    diagnostics (`error:` lines) into output.log and still exits 0, so clsi
//    must not treat an errored compile as a hard failure. The success gate is
//    "output.pdf exists and is non-empty" (checked in CompileManager via
//    OutputFileFinder), and the number of `^error:` lines is counted into
//    stats['typst-errors'] for the status field.
//
//  - Engine: tinymist (fingolfin/tinymist, `synctex` branch — Max Horn's
//    unmerged `--synctex` feature).
//    `--synctex` writes `output.synctex.gz` (standard SyncTeX 1.0) next to
//    the PDF; on completion we adapt it to the `output.sourcemap.json`
//    sidecar the consumer (TypstSourcemap.js) expects (SynctexAdapter).
//    The adaptation is best-effort: a failure only loses the mapping (the
//    API degrades to 404 "sourcemap not available"), never the compile.
//  - runTypst: runs the command through the (generic) Runner, records
//    ProcessTable[id], on completion deletes it, counts `^error:` lines into
//    stats['typst-errors'], sets stats['typst-compile-runs']=1, then
//    callback(error, output).
//  - isRunning/killTypst: ProcessTable lookups; missing => warn + cb(null).

const ProcessTable = {} // table of currently running jobs (pids or docker container names)

function isRunning(projectId) {
  return ProcessTable[projectId] != null
}

function killTypst(projectId, callback) {
  const id = `${projectId}`
  logger.debug({ id }, 'killing running typst compile')
  if (!isRunning(projectId)) {
    logger.warn({ id }, 'no such project to kill')
    return callback(null)
  }
  return CommandRunner.kill(ProcessTable[id], callback)
}

function buildTypstCompileCommand(mainFile) {
  return [
    'sh',
    '-c',
    'echo "tinymist $(tinymist --version 2>/dev/null || echo unknown)" > "$3"; ' +
      'tinymist compile --synctex "$1" "$2" >> "$3" 2>&1; exit 0',
    '--',
    Path.join('$COMPILE_DIR', mainFile),
    'output.pdf',
    'output.log',
  ]
}

// adaptSourcemap converts the compiler's `output.synctex.gz` into
// `output.sourcemap.json` (best-effort; a missing .gz or any error is
// logged, never thrown to the caller).
function adaptSourcemap(directory) {
  return SynctexAdapter.synctexToSidecar(directory).catch(err => {
    if (err && err.code !== 'ENOENT') {
      logger.warn(
        { err, directory },
        'synctex → sourcemap sidecar adaptation failed'
      )
    }
  })
}

function runTypst(projectId, options, callback) {
  const { directory, mainFile, image, environment, compileGroup, stats, timings } = options
  const timeout = options.timeout || 60000 // milliseconds

  logger.debug(
    {
      directory,
      timeout,
      mainFile,
      environment,
      compileGroup,
    },
    'starting typst compile'
  )

  const command = buildTypstCompileCommand(mainFile)

  const id = `${projectId}` // record running project under this id

  ProcessTable[id] = CommandRunner.run(
    projectId,
    command,
    directory,
    image,
    timeout,
    environment,
    compileGroup,
    null,
    function (error, output) {
      delete ProcessTable[id]
      if (error) {
        return callback(error)
      }
      const finish = (cbErr, cbOutput) => {
        // Adapt the source-mapping sidecar before the caller inspects the
        // compile dir (best-effort — never fails the compile).
        adaptSourcemap(directory).finally(() => callback(cbErr, cbOutput))
      }
      // Informational stats (clsi_compile_metrics parity): the number of
      // `error:` diagnostic lines. The compile command writes everything to
      // output.log (stdout is empty), so count there.
      fs.readFile(Path.join(directory, 'output.log'), 'utf8')
        .then(log => {
          const errLines = log
            .split('\n')
            .filter(l => /^error: /.test(l)).length
          stats['typst-errors'] = errLines
          stats['typst-compile-runs'] = 1
          finish(null, output)
        })
        .catch(err => {
          if (err.code !== 'ENOENT') {
            return finish(err)
          }
          stats['typst-errors'] = 0
          stats['typst-compile-runs'] = 1
          finish(null, output)
        })
    }
  )
  // CommandRunner.run's return value is the pid / container id; the
  // synchronous-failure case is already delivered via the callback.
}

export default {
  isRunning,
  runTypst,
  killTypst,
  buildTypstCompileCommand,
  promises: {
    runTypst: promisify(runTypst),
    killTypst: promisify(killTypst),
  },
}
