import { afterEach, beforeEach, chai, vi } from 'vitest'
import sinon from 'sinon'
import chaiAsPromised from 'chai-as-promised'
import sinonChai from 'sinon-chai'

// Chai configuration
chai.should()
chai.use(chaiAsPromised)

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

// Global stubs
const sandbox = sinon.createSandbox()
const stubs = {
  logger: {
    debug: sandbox.stub(),
    log: sandbox.stub(),
    info: sandbox.stub(),
    warn: sandbox.stub(),
    err: sandbox.stub(),
    error: sandbox.stub(),
  },
}

// Mocha hooks
beforeEach(ctx => {
  ctx.logger = stubs.logger
  vi.doMock('@overleaf/logger', () => ({ default: ctx.logger }))
})

afterEach(() => {
  sandbox.reset()
  vi.restoreAllMocks()
  vi.resetModules()
})
