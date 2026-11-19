import { afterEach, beforeEach, chai, vi } from 'vitest'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'

// Setup chai
chai.should()

// Workaround: vitest's built-in chai plugins register spy-related properties
// (e.g. callCount) as getter-only via addChainableMethod. sinon-chai then tries
// to overwrite them via addMethod (plain property assignment), which fails.
// Pre-delete the conflicting getter-only properties so the assignment succeeds.
const sinonChaiMethodProps = [
  'callCount',
  'calledBefore',
  'calledAfter',
  'calledImmediatelyBefore',
  'calledImmediatelyAfter',
  'calledOn',
  'calledWith',
  'calledOnceWith',
  'calledWithExactly',
  'calledOnceWithExactly',
  'calledWithMatch',
  'returned',
  'thrown',
]
for (const name of sinonChaiMethodProps) {
  if (Object.getOwnPropertyDescriptor(chai.Assertion.prototype, name)?.get) {
    delete chai.Assertion.prototype[name]
  }
}
chai.use(sinonChai)

chai.use(chaiAsPromised)

beforeEach(() => {
  vi.doMock('@overleaf/logger', () => ({
    default: {
      debug() {},
      log() {},
      info() {},
      warn() {},
      error() {},
      err() {},
    },
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})
