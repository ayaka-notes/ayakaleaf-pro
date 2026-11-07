// @ts-check
'use strict'

const _ = require('lodash')
const assert = require('check-types').assert

const OError = require('@overleaf/o-error')
const Blob = require('../blob')
const FileData = require('./')
const EagerStringFileData = require('./string_file_data')
const EditOperation = require('../operation/edit_operation')
const EditOperationBuilder = require('../operation/edit_operation_builder')
const TextOperation = require('../operation/text_operation')

/**
 *  @import { BlobStore, ReadonlyBlobStore, RangesBlob, RawHashFileData, RawLazyStringFileData } from '../types'
 */

class LazyStringFileData extends FileData {
  /**
   * @param {string} hash
   * @param {string | undefined} rangesHash
   * @param {number} stringLength
   * @param {Array.<EditOperation>} [operations]
   * @see FileData
   */
  constructor(hash, rangesHash, stringLength, operations) {
    super()
    assert.match(hash, Blob.HEX_HASH_RX)
    if (rangesHash) {
      assert.match(rangesHash, Blob.HEX_HASH_RX)
    }
    assert.greaterOrEqual(stringLength, 0)
    assert.maybe.array.of.instance(operations, EditOperation)

    this.hash = hash
    this.rangesHash = rangesHash
    this.stringLength = stringLength
    this.operations = operations || []
  }

  /**
   * @param {RawLazyStringFileData} raw
   * @returns {LazyStringFileData}
   */
  static fromRaw(raw) {
    return new LazyStringFileData(
      raw.hash,
      raw.rangesHash,
      raw.stringLength,
      raw.operations && _.map(raw.operations, EditOperationBuilder.fromJSON)
    )
  }

  /**
   * @inheritdoc
   * @returns {RawLazyStringFileData}
   */
  toRaw() {
    /** @type RawLazyStringFileData */
    const raw = {
      hash: this.hash,
      stringLength: this.stringLength,
    }
    if (this.rangesHash) {
      raw.rangesHash = this.rangesHash
    }
    if (this.operations.length) {
      raw.operations = _.map(this.operations, function (operation) {
        return operation.toJSON()
      })
    }
    return raw
  }

  /**
   * @returns {Record<string, number>}
   */
  toStats() {
    return {
      hashes: 1 + (this.rangesHash ? 1 : 0),
      stringLength: this.stringLength,
      nOperations: this.operations.length,
      operationsSize:
        this.operations.length > 0
          ? this.operations.reduce(
              // Note: Buffer does not exist in frontend. Use string length instead.
              (sum, op) => sum + JSON.stringify(op.toJSON()).length,
              0
            )
          : 0,
    }
  }

  /** @inheritdoc */
  getHash() {
    if (this.operations.length) return null
    return this.hash
  }

  /** @inheritdoc */
  getRangesHash() {
    if (this.operations.length) return null
    return this.rangesHash
  }

  /** @inheritdoc */
  isEditable() {
    return true
  }

  /**
   * For project quota checking, we approximate the byte length by the UTF-8
   * length for hollow files. This isn't strictly speaking correct; it is an
   * underestimate of byte length.
   *
   * @return {number}
   */
  getByteLength() {
    return this.stringLength
  }

  /** @inheritdoc */
  getStringLength() {
    return this.stringLength
  }

  /**
   * Get the cached text operations that are to be applied to this file to get
   * from the content with its last known hash to its latest content.
   *
   * @return {Array.<EditOperation>}
   */
  getOperations() {
    return this.operations
  }

  /**
   * @inheritdoc
   * @param {ReadonlyBlobStore} blobStore
   * @returns {Promise<EagerStringFileData>}
   */
  async toEager(blobStore) {
    const [content, ranges] = await Promise.all([
      blobStore.getString(this.hash),
      this.rangesHash
        ? /** @type {Promise<RangesBlob>} */ (
            blobStore.getObject(this.rangesHash)
          )
        : Promise.resolve(undefined),
    ])
    const file = new EagerStringFileData(
      content,
      ranges?.comments,
      ranges?.trackedChanges
    )
    try {
      applyOperations(this.operations, file)
    } catch (err) {
      const firstOp = this.operations[0]
      const firstOpBaseLength =
        firstOp instanceof TextOperation ? firstOp.baseLength : undefined
      throw OError.tag(err, 'failed to apply operations in toEager', {
        blobHash: this.hash,
        blobContentLength: content.length,
        metadataStringLength: this.stringLength,
        totalOperations: this.operations.length,
        firstOpBaseLength,
        contentMatchesMetadata: content.length === this.stringLength,
        contentMatchesFirstOp:
          typeof firstOpBaseLength === 'number'
            ? content.length === firstOpBaseLength
            : undefined,
      })
    }
    return file
  }

  /** @inheritdoc */
  async toLazy() {
    return this
  }

  /** @inheritdoc */
  async toHollow() {
    // TODO(das7pad): inline 2nd path of FileData.createLazyFromBlobs?
    // @ts-ignore
    return FileData.createHollow(null, this.stringLength)
  }

  /** @inheritdoc
   * @param {EditOperation} operation
   */
  edit(operation) {
    try {
      this.stringLength = operation.applyToLength(this.stringLength)
    } catch (err) {
      const baseLength =
        operation instanceof TextOperation ? operation.baseLength : undefined
      throw OError.tag(err, 'failed to apply operation length in edit', {
        blobHash: this.hash,
        metadataStringLength: this.stringLength,
        operationBaseLength: baseLength,
        totalExistingOperations: this.operations.length,
      })
    }
    this.operations.push(operation)
  }

  /** @inheritdoc
   * @param {BlobStore} blobStore
   * @return {Promise<RawHashFileData>}
   */
  async store(blobStore) {
    if (this.operations.length === 0) {
      /** @type RawHashFileData */
      const raw = { hash: this.hash }
      if (this.rangesHash) {
        raw.rangesHash = this.rangesHash
      }
      return raw
    }
    const eager = await this.toEager(blobStore)
    const raw = await eager.store(blobStore)
    this.hash = raw.hash
    this.rangesHash = raw.rangesHash
    this.operations.length = 0
    return raw
  }
}

/**
 *
 * @param {EditOperation[]} operations
 * @param {EagerStringFileData} file
 * @returns {void}
 */
function applyOperations(operations, file) {
  for (let i = 0; i < operations.length; i++) {
    try {
      operations[i].apply(file)
    } catch (err) {
      throw OError.tag(err, 'operation failed during applyOperations', {
        operationIndex: i,
        totalOperations: operations.length,
        currentContentLength: file.getStringLength(),
      })
    }
  }
}

module.exports = LazyStringFileData
