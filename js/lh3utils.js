/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

//
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2011
//
// Updated by Philip Adenekan to ES6, in 2018
//
// lh3utils.js: common support for lh3's file formats
//

if (typeof(require) !== 'undefined') {
    var jszlib = require('jszlib');
    var jszlib_inflate_buffer = jszlib.inflateBuffer;
    var arrayCopy = jszlib.arrayCopy;
}


export class Vob {
    constructor(block, offset) {
        this.block = block;
        this.offset = offset;
    }

    toString () {
        return  `${this.block} :  ${this.offset}`;
    }
}


export const readVob = (ba, offset, allowZero) => {
    const block = ((ba[offset+6] & 0xff) * 0x100000000) + ((ba[offset+5] & 0xff) *
        0x1000000) +
        ((ba[offset+4] & 0xff) * 0x10000) +
        ((ba[offset+3] & 0xff) * 0x100) +
        ((ba[offset+2] & 0xff));

    const bint = (ba[offset+1] << 8) | (ba[offset]);

    return (block === 0 && bint === 0 && !allowZero) ?
        null :  // Should only happen in the linear index?
        new Vob(block, bint);
}

export const unbgzf = (data, lim) => {
    lim = Math.min(lim || 1, data.byteLength - 50); // TODO: Fix. Never modify arguments

    let oBlockList = [];
    let ptr = [0];
    let totalSize = 0;

    while (ptr[0] < lim) {
        let ba = new Uint8Array(data, ptr[0], 12); // FIXME is this enough for all credible BGZF block headers?
        let xlen = (ba[11] << 8) | (ba[10]);
        let unc = jszlib_inflate_buffer(data, 12 + xlen + ptr[0], Math.min(65536, data.byteLength - 12 - xlen - ptr[0]), ptr);

        ptr[0] += 8;
        totalSize += unc.byteLength;
        oBlockList.push(unc);
    }

    if (oBlockList.length == 1) {
        return oBlockList[0];
    } else {
        let out = new Uint8Array(totalSize);
        let cursor = 0;

        for (let i = 0; i < oBlockList.length; ++i) {
            let b = new Uint8Array(oBlockList[i]);
            arrayCopy(b, 0, out, cursor, b.length);
            cursor += b.length;
        }
        return out.buffer;
    }
}

export class Chunk {
    constructor(minv, maxv) {
        this.minv = minv;
        this.maxv = maxv;
    }
}

//
// Binning (transliterated from SAM1.3 spec)
//

/* calculate bin given an alignment covering [beg,end) (zero-based, half-close-half-open) */
export const reg2bin = (beg, end) => {
    const endDecreased = end - 1;

    if (beg>>14 == endDecreased>>14) {
        return ((1<<15)-1)/7 + (beg>>14);
    } else if (beg>>17 == endDecreased>>17) {
        return ((1<<12)-1)/7 + (beg>>17);
    } else if (beg>>20 == endDecreased>>20) {
        return ((1<<9)-1)/7 + (beg>>20);
    } else if (beg>>23 == endDecreased>>23) {
        return ((1<<6)-1)/7 + (beg>>23);
    } else if (beg>>26 == endDecreased>>26) {
        return ((1<<3)-1)/7 + (beg>>26);
    } else {
        return 0;
    }
}

/* calculate the list of bins that may overlap with region [beg,end) (zero-based) */
export const reg2bins = (beg, end) => {
    const endDecreased = end - 1;
    let k;
    let list = [];

    list.push(0);
    for (k = 1 + (beg>>26); k <= 1 + (endDecreased>>26); ++k) {
         list.push(k);
     }

    for (k = 9 + (beg>>23); k <= 9 + (endDecreased>>23); ++k) {
        list.push(k);
    }

    for (k = 73 + (beg>>20); k <= 73 + (endDecreased>>20); ++k) {
        list.push(k);
    }

    for (k = 585 + (beg>>17); k <= 585 + (endDecreased>>17); ++k) {
        list.push(k);
    }

    for (k = 4681 + (beg>>14); k <= 4681 + (endDecreased>>14); ++k) {
        list.push(k);
    }

    return list;
}
