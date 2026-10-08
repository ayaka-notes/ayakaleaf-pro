import * as ort from 'onnxruntime-web/wasm'
import labels from './assets/labels.json'
import preprocessing from './assets/preprocessing.json'
import modelConfig from './model-config.json'
import { rasterizeStrokes, rankCandidates } from './preprocess'

let session
let queue = Promise.resolve()

async function handleMessage(message) {
  const { id, type } = message
  try {
    if (type === 'init') {
      ort.env.wasm.wasmPaths = message.wasmPaths
      // A dedicated worker already keeps inference off the editor thread;
      // single-threaded WASM also works without cross-origin isolation.
      ort.env.wasm.numThreads = 1
      session = await ort.InferenceSession.create(message.modelUrl, {
        executionProviders: ['wasm'],
      })
      self.postMessage({ id, type: 'ready' })
    } else if (type === 'recognize') {
      const input = new ort.Tensor(
        'float32',
        rasterizeStrokes(message.strokes, preprocessing),
        [1, 1, preprocessing.imageSize, preprocessing.imageSize]
      )
      let outputs
      try {
        outputs = await session.run({ [modelConfig.inputName]: input })
        const logits = outputs[modelConfig.outputName]
        self.postMessage({
          id,
          type: 'result',
          candidates: rankCandidates(
            logits.data,
            labels,
            modelConfig.candidateCount
          ),
        })
      } finally {
        input.dispose()
        if (outputs) Object.values(outputs).forEach(output => output.dispose())
      }
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error.message })
  }
}

self.addEventListener('message', event => {
  // ONNX sessions must not overlap when several strokes end during inference.
  queue = queue.then(() => handleMessage(event.data))
})
