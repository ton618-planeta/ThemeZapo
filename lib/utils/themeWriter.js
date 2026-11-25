// Adapted from RenTakamori.
export class ProtoWriter {
	constructor(parent = null) {
		this.parent = parent;
		this.chunks = [];
	}
	static create() {
		return new ProtoWriter();
	}
	_push(buffer) {
		this.chunks.push(Buffer.from(buffer));
		return this;
	}
	_varint(value) {
		let n = BigInt.asUintN(64, BigInt(value));
		const bytes = [];
		while (n > 127n) {
			bytes.push(Number(n & 127n) | 128);
			n >>= 7n;
		}
		bytes.push(Number(n));
		return Buffer.from(bytes);
	}
	uint32(value) {
		return this._push(this._varint(value >>> 0));
	}
	int32(value) {
		return this._push(this._varint(Math.trunc(value)));
	}
	int64(value) {
		return this._push(this._varint(typeof value === 'bigint' ? value : Math.trunc(value)));
	}
	bool(value) {
		return this.uint32(value ? 1 : 0);
	}
	fixed32(value) {
		const buffer = Buffer.alloc(4);
		buffer.writeUInt32LE(value >>> 0);
		return this._push(buffer);
	}
	float(value) {
		const buffer = Buffer.alloc(4);
		buffer.writeFloatLE(value);
		return this._push(buffer);
	}
	bytes(value) {
		const buffer = Buffer.from(value);
		return this._push(this._varint(buffer.length))._push(buffer);
	}
	string(value) {
		return this.bytes(Buffer.from(String(value), 'utf8'));
	}
	fork() {
		return new ProtoWriter(this);
	}
	ldelim() {
		if (!this.parent) throw new Error('Writer has no parent');
		return this.parent.bytes(this.finish());
	}
	finish() {
		return Buffer.concat(this.chunks);
	}
}
