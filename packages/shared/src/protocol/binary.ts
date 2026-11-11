const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Growable little-endian binary writer for network messages. */
export class BinaryWriter {
  private buffer: ArrayBuffer
  private view: DataView
  private offset = 0

  constructor(initialSize = 64) {
    this.buffer = new ArrayBuffer(initialSize)
    this.view = new DataView(this.buffer)
  }

  private ensure(bytes: number): void {
    const needed = this.offset + bytes
    if (needed <= this.buffer.byteLength) return
    let size = this.buffer.byteLength * 2
    while (size < needed) size *= 2
    const next = new ArrayBuffer(size)
    new Uint8Array(next).set(new Uint8Array(this.buffer, 0, this.offset))
    this.buffer = next
    this.view = new DataView(next)
  }

  u8(value: number): this {
    this.ensure(1)
    this.view.setUint8(this.offset, value)
    this.offset += 1
    return this
  }

  u16(value: number): this {
    this.ensure(2)
    this.view.setUint16(this.offset, value, true)
    this.offset += 2
    return this
  }

  i16(value: number): this {
    this.ensure(2)
    this.view.setInt16(this.offset, value, true)
    this.offset += 2
    return this
  }

  u32(value: number): this {
    this.ensure(4)
    this.view.setUint32(this.offset, value, true)
    this.offset += 4
    return this
  }

  f32(value: number): this {
    this.ensure(4)
    this.view.setFloat32(this.offset, value, true)
    this.offset += 4
    return this
  }

  f64(value: number): this {
    this.ensure(8)
    this.view.setFloat64(this.offset, value, true)
    this.offset += 8
    return this
  }

  /** UTF-8 string prefixed with a u8 byte length (max 255 bytes, truncated). */
  str8(value: string): this {
    const bytes = textEncoder.encode(value).subarray(0, 255)
    this.u8(bytes.length)
    this.ensure(bytes.length)
    new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes)
    this.offset += bytes.length
    return this
  }

  /** UTF-8 string prefixed with a u16 byte length (max 65535 bytes, truncated). */
  str16(value: string): this {
    const bytes = textEncoder.encode(value).subarray(0, 0xffff)
    this.u16(bytes.length)
    this.ensure(bytes.length)
    new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes)
    this.offset += bytes.length
    return this
  }

  /** Returns a copy of the written bytes. */
  finish(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.buffer.slice(0, this.offset))
  }
}

/** Little-endian binary reader. Throws RangeError when reading past the end. */
export class BinaryReader {
  private readonly view: DataView
  private offset = 0

  constructor(data: ArrayBuffer | Uint8Array) {
    this.view =
      data instanceof Uint8Array
        ? new DataView(data.buffer, data.byteOffset, data.byteLength)
        : new DataView(data)
  }

  get remaining(): number {
    return this.view.byteLength - this.offset
  }

  u8(): number {
    const v = this.view.getUint8(this.offset)
    this.offset += 1
    return v
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, true)
    this.offset += 2
    return v
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return v
  }

  f64(): number {
    const v = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return v
  }

  str16(): string {
    const length = this.u16()
    if (length > this.remaining) throw new RangeError('str16 length exceeds buffer')
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length)
    this.offset += length
    return textDecoder.decode(bytes)
  }

  str8(): string {
    const length = this.u8()
    if (length > this.remaining) throw new RangeError('str8 length exceeds buffer')
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length)
    this.offset += length
    return textDecoder.decode(bytes)
  }
}
