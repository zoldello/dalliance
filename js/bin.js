/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

//
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2011
//
// Updated by Philip Adenekan to ES6, in 2018
// bin.js general binary data support
//

// TODO: Move all classes to their own file

import sha1 from './sha1';

const b64Sha1 = sha1.b64Sha1;

if (typeof(require) !== 'undefined') {
	var utils = require('./utils');
	var shallowCopy = utils.shallowCopy;

	var Promise = require('es6-promise').Promise;
}

export class BlobFetchable {
	constructor(blob) {
		this.blob = blob;
	}

	slice(start, length) {
		let blob;

		if (this.blob.slice) {
			blob = length ?
				this.blob.slice(start, start + length) :
				this.blob.slice(start);
		} else {
			blob = length ?
				this.blob.webkitSlice(start, start + length) :
				this.blob.webkitSlice(start);
		}

		return new BlobFetchable(blob)
	}

	salted() {
		return this;
	}

	fetch(callback) {
		if (typeof(FileReader) !== 'undefined') {
			const reader = new FileReader();

			reader.onloadend = () => {
				callback(bstringToBuffer(reader.result));
			};

			reader.readAsBinaryString(this.blob);
		} else {
			const reader = new FileReaderSync();
			try {
				const res = reader.readAsArrayBuffer(this.blob);
				return callback(res);
			} catch (e) {
				callback(null, e);

				return false;
			}
		}

		return true;
	}
}

export class URLFetchable {
	constructor(url, start, end, opts) {
		if (!opts) {
			if (typeof start === 'object') {
				opts = start;
				start = undefined;
			} else {
				opts = {};
			}
		}

		this.url = url;
		this.start = start || 0;
		this.end = end
		this.opts = opts;
		this.seed = 0;

		// TODO: Remove browser sniffing code
		this.isSafari = typeof(navigator) !== 'undefined' &&
			navigator.userAgent.indexOf('Safari') >= 0 &&
			navigator.userAgent.indexOf('Chrome') < 0;
	}

	slice(s, l) {
		if (s < 0) {
			throw Error(`Bad slice:  ${s}`);
		}

		let ns = this.start;
		let ne = this.end;

		if (ns && s) {
			ns = ns + s;
		} else {
			ns = s || ns;
		}

		if (l && ns) {
			ne = ns + l - 1;
		} else {
			ne = ne || l - 1;
		}

		return new URLFetchable(this.url, ns, ne, this.opts);
	}

	fetchAsText(callback) {
		let thisB = this;

		this.getURL().then(url => {
			try {
				const req = new XMLHttpRequest();

				if ((this.isSafari || thisB.opts.salt) && url.indexOf('?') < 0) {
					url = url + '?salt=' + b64Sha1('' + Date.now() + ',' + (++this.seed));
				}
				req.open('GET', url, true);

				if (thisB.end) {
					if (thisB.end - thisB.start > 100000000) {
						throw Error('Monster fetch!');
					}

					req.setRequestHeader('Range', `bytes= ${thisB.start}  - ${thisB.end}`);
					length = thisB.end - thisB.start + 1;
				}

				req.onreadystatechange = () => {
					if (req.readyState !== 4) {
						return null;
					}
					const responseText = req.status == 200 || req.status == 206 ?
						req.responseText :
						null;

					return callback(responseText);
				};

				if (thisB.opts.credentials) {
					req.withCredentials = true;
				}

				req.send();
			} catch (e) {
				return callback(null);
			}
		}).
		catch(err => {
			console.error(err);

			return callback(null, err);
		});
	}

	salted() {
		let o = shallowCopy(this.opts);
		o.salt = true;

		return new URLFetchable(this.url, this.start, this.end, o);
	}

	getURL() {
		if (this.opts.resolver) {
			return this.opts.resolver(this.url).then(function(urlOrObj) {
				return typeof urlOrObj === 'string' ?
					urlOrObj :
					urlOrObj.url;
			});
		} else {
			return Promise.resolve(this.url);
		}
	}

	fetch(callback, opts) {
			const thisB = this;

			opts = opts || {};	// TODO: Fix. Never modify a parameter
			const attempt = opts.attempt || 1;
			const truncatedLength = opts.truncatedLength;

			if (attempt > 3) {
				return callback(null);
			}

			this.getURL().then(url => {
				try {
					let  timeout;

					if (opts.timeout && !thisB.opts.credentials) {
						timeout = setTimeout(
							function() {
								console.log('timing out ' + url);
								req.abort();
								return callback(null, 'Timeout');
							},
							opts.timeout
						);
					}

					const req = new XMLHttpRequest();
					let length;

					if ((this.isSafari || thisB.opts.salt) && url.indexOf('?') < 0) {
						url = url + '?salt=' + b64Sha1('' + Date.now() + ',' + (++this.seed));
					}

					req.open('GET', url, true);
					req.overrideMimeType('text/plain; charset=x-user-defined');

					if (thisB.end) {
						if (thisB.end - thisB.start > 100000000) {
							throw Error('Monster fetch!');
						}

						req.setRequestHeader('Range', 'bytes=' + thisB.start + '-' + thisB.end);
						length = thisB.end - thisB.start + 1;
					}

					req.responseType = 'arraybuffer';
					req.onreadystatechange = () => {
						if (req.readyState == 4) {
							if (timeout) {
								clearTimeout(timeout);
							}

							if (req.status == 200 || req.status == 206) {
								if (req.response) {
									var bl = req.response.byteLength;
									if (length && length != bl && (!truncatedLength || bl != truncatedLength)) {
										return thisB.fetch(callback, {
											attempt: attempt + 1,
											truncatedLength: bl
										});
									} else {
										return callback(req.response);
									}
								} else if (req.mozResponseArrayBuffer) {
									return callback(req.mozResponseArrayBuffer);
								} else {
									var r = req.responseText;
									if (length && length != r.length && (!truncatedLength || r.length != truncatedLength)) {
										return thisB.fetch(callback, {
											attempt: attempt + 1,
											truncatedLength: r.length
										});
									} else {
										return callback(bstringToBuffer(req.responseText));
									}
								}
							} else {
								return thisB.fetch(callback, {
									attempt: attempt + 1
								});
							}
						}
					};
					if (thisB.opts.credentials) {
						req.withCredentials = true;
					}
					req.send();
				} catch (e) {
					return callback(null);
				}
			}).
			catch(function(err) {
				console.log(err);
				return callback(null, err);
			});
	}

}


export const bstringToBuffer  = result => {
	if (!result) {
		return null;
	}

	let ba = new Uint8Array(result.length);

	for (var i = 0; i < ba.length; ++i) {
		ba[i] = result.charCodeAt(i);
	}

	return ba.buffer;
}

//TODO: Can these be static method in a class?

// Read from Uint8Array
const convertBuffer = new ArrayBuffer(8);
let ba = new Uint8Array(convertBuffer);
let fa = new Float32Array(convertBuffer);

export const readFloat = (buf, offset) => {
	ba[0] = buf[offset];
	ba[1] = buf[offset + 1];
	ba[2] = buf[offset + 2];
	ba[3] = buf[offset + 3];

	return fa[0];
}

export const readInt64 = (ba, offset) => {
	return (ba[offset + 7] << 24) | (ba[offset + 6] << 16) | (ba[offset + 5] << 8) | (ba[offset + 4]);
}

export const M1 = 256,
	M2 = M1 * 256,
	M3 = M2 * 256,
	M4 = M3 * 256,
	M5 = M4 * 256;

export const readInt64LE = (ba, offset) => {
	return (ba[offset]) + (ba[offset + 1] * M1) + (ba[offset + 2] * M2) + (ba[offset + 3] * M3) + (ba[offset + 4] * M4) + (ba[offset + 5] * M5);
}

export const readInt64BE = (ba, offset) => {
	return (ba[offset + 7]) + (ba[offset + 6] * M1) + (ba[offset + 5] * M2) + (ba[offset + 4] * M3) + (ba[offset + 3] * M4) + (ba[offset + 2] * M5);
}

export const readInt = (ba, offset) => {
	return (ba[offset + 3] << 24) | (ba[offset + 2] << 16) | (ba[offset + 1] << 8) | (ba[offset]);
}

export const readShort = (ba, offset) => {
	return (ba[offset + 1] << 8) | (ba[offset]);
}

export const readByte = (ba, offset) => {
	return ba[offset];
}

export const readIntBE = (ba, offset) => {
	return (ba[offset] << 24) | (ba[offset + 1] << 16) | (ba[offset + 2] << 8) | (ba[offset + 3]);
}
