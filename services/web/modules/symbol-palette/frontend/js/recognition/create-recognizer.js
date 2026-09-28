import RecognitionClient from './recognition-client'
import modelUrl from './assets/model.ort'
import wasmUrl from './assets/ort-wasm-simd-threaded.wasm'
import mjsUrl from './assets/ort-wasm-simd-threaded.mjs'

export default function createRecognizer() {
  const worker = new Worker(
    new URL('./symbol-recognition.worker.js', import.meta.url),
    { name: 'symbol-recognition' }
  )
  const client = new RecognitionClient(worker)
  return {
    init: () =>
      client.request({
        type: 'init',
        modelUrl: new URL(modelUrl, window.location.href).href,
        wasmPaths: {
          wasm: new URL(wasmUrl, window.location.href).href,
          mjs: new URL(mjsUrl, window.location.href).href,
        },
      }),
    recognize: strokes => client.request({ type: 'recognize', strokes }),
    destroy: () => client.destroy(),
  }
}
