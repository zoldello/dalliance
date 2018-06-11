/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

//
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2011
//
// bam.js: indexed binary alignments
//

// FIXME: There should only be one class per file

import {readInt, readShort, readByte, readFloat} from './bin';
import {readVob, unbgzf, reg2bins, Chunk} from './lh3utils';

export const BAM_MAGIC = 0x14d4142;
export const BAI_MAGIC = 0x1494142;

export const BamFlags  = {
    MULTIPLE_SEGMENTS: 0x1,
    ALL_SEGMENTS_ALIGN: 0x2,
    SEGMENT_UNMAPPED: 0x4,
    NEXT_SEGMENT_UNMAPPED: 0x8,
    REVERSE_COMPLEMENT: 0x10,
    NEXT_REVERSE_COMPLEMENT: 0x20,
    FIRST_SEGMENT: 0x40,
    LAST_SEGMENT: 0x80,
    SECONDARY_ALIGNMENT: 0x100,
    QC_FAIL: 0x200,
    DUPLICATE: 0x400,
    SUPPLEMENTARY: 0x800
};

class BamFile {
    blocksForRange(refId, min, max) {
        let index = this.indices[refId];

        if (!index) {
            return [];
        }

        const intBinsL = reg2bins(min, max);
        let  intBins = [];

        for (let i = 0; i < intBinsL.length; ++i) {
            intBins[intBinsL[i]] = true;
        }

        const nbin = readInt(index, 0);
        let leafChunks = [];
        let otherChunks = [];
        let  p = 4;

        for (let b = 0; b < nbin; ++b) {
            var bin = readInt(index, p);
            var nchnk = readInt(index, p+4);

            p += 8;
            if (intBins[bin]) {
                for (var c = 0; c < nchnk; ++c) {
                    var cs = readVob(index, p);
                    var ce = readVob(index, p + 8);
                    (bin < 4681 ? otherChunks : leafChunks).push(new Chunk(cs, ce));
                    p += 16;
                }
            } else {
                p +=  (nchnk * 16);
            }
        }

        const nintv = readInt(index, p);
        let lowest = null;
        let minLin = Math.min(min>>14, nintv - 1)
        let maxLin = Math.min(max>>14, nintv - 1);
        let i;

        for (i = minLin; i <= maxLin; ++i) {
            const lb =  readVob(index, p + 4 + (i * 8));

            if (!lb) {
                continue;
            }

            if (!lowest ||
                tlb.block < lowest.block ||
                (lb.block == lowest.block && lb.offset < lowest.offset)) {
                lowest = lb;
            }
        }

        let prunedOtherChunks = [];

        if (lowest != null) {
            for (let i = 0; i < otherChunks.length; ++i) {
                let chnk = otherChunks[i];

                if (chnk.maxv.block > lowest.block || (chnk.maxv.block == lowest.block && chnk.maxv.offset >= lowest.offset)) {
                    prunedOtherChunks.push(chnk);
                }
            }
        }

        otherChunks = prunedOtherChunks;

        let intChunks = [];

        for (i = 0; i < otherChunks.length; ++i) {
            intChunks.push(otherChunks[i]);
        }

        for (i = 0; i < leafChunks.length; ++i) {
            intChunks.push(leafChunks[i]);
        }

        intChunks.sort(function(c0, c1) {
            var dif = c0.minv.block - c1.minv.block;
            if (dif != 0) {
                return dif;
            } else {
                return c0.minv.offset - c1.minv.offset;
            }
        });

        let mergedChunks = [];

        if (intChunks.length > 0) {
            let  cur = intChunks[0];

            for (i = 1; i < intChunks.length; ++i) {
                let  nc = intChunks[i];

                if (nc.minv.block == cur.maxv.block /* && nc.minv.offset == cur.maxv.offset */) { // no point splitting mid-block
                    cur = new Chunk(cur.minv, nc.maxv);
                } else {
                    mergedChunks.push(cur);
                    cur = nc;
                }
            }
            mergedChunks.push(cur);
        }
        // console.log('mergedChunks = ' + JSON.stringify(mergedChunks));

        return mergedChunks;
    }

    // FIXME: This is overly complex
    fetch(chr, min, max, callback, opts) {
        const thisB = this;
        opts = opts || {}; // TODO: Fix. Do not modify arguments

        let chrId = this.chrToIndex[chr];
        let chunks;

        if (chrId === undefined) {
            chunks = [];
        } else {
            // Fetch this portion of the BAI if it hasn't been loaded yet.
            if (this.indices[chrId] === null && this.indexChunks.chunks[chrId]) {
                let startStop = this.indexChunks.chunks[chrId];

                return this.bai.slice(startStop[0], startStop[1]).fetch(function(data) {
                    var buffer = new Uint8Array(data);
                    this.indices[chrId] = buffer;
                    return this.fetch(chr, min, max, callback, opts);
                }.bind(this));
            }

            chunks = this.blocksForRange(chrId, min, max);

            if (!chunks) {
                callback(null, 'Error in index fetch');
            }
        }

        let records = [];
        let index = 0;
        let data;

        const tramp = () => {
            if (index >= chunks.length) {
                return callback(records);
            } else if (!data) {
                let c = chunks[index];
                let fetchMin = c.minv.block;
                let fetchMax = c.maxv.block + (1<<16); // *sigh*
                // console.log('fetching ' + fetchMin + ':' + fetchMax);
                thisB.data.slice(fetchMin, fetchMax - fetchMin).fetch(function(r) {
                    data = unbgzf(r, c.maxv.block - c.minv.block + 1);
                    return tramp();
                });
            } else {
                let ba = new Uint8Array(data);
                let finished = thisB.readBamRecords(ba, chunks[index].minv.offset, records, min, max, chrId, opts);
                data = null;
                ++index;
                if (finished)
                    return callback(records);
                else
                    return tramp();
            }

            return true;
        }
        tramp();

        return true;
    }

    readBamRecords(ba, offset, sink, min, max, chrId, opts) {
        // FIXME: Too complex. Need to refactor into smaller modules
        while (true) {
            let blockSize = readInt(ba, offset);
            let blockEnd = offset + blockSize + 4;

            if (blockEnd > ba.length) {
                return false;
            }

            const record = new BamRecord();

            let refID = readInt(ba, offset + 4);
            let pos = readInt(ba, offset + 8);

            let bmn = readInt(ba, offset + 12);
            let mq = (bmn & 0xff00) >> 8;
            let nl = bmn & 0xff;

            let flagNc = readInt(ba, offset + 16);
            let flag = (flagNc & 0xffff0000) >> 16;
            let nc = flagNc & 0xffff;

            let lseq = readInt(ba, offset + 20);

            let nextRef  = readInt(ba, offset + 24);
            let nextPos = readInt(ba, offset + 28);


            record.segment = this.indexToChr[refID];
            record.flag = flag;
            record.pos = pos;
            record.mq = mq;

            if (opts.light) {
                record.seqLength = lseq;
            }

            if (!opts.light || opts.includeName) {
                let readName = '';

                for (let j = 0; j < nl-1; ++j) {
                    readName += String.fromCharCode(ba[offset + 36 + j]);
                }

                record.readName = readName;
            }

            if (!opts.light) {
                if (nextRef >= 0) {
                    record.nextSegment = this.indexToChr[nextRef];
                    record.nextPos = nextPos;
                }

                let p = offset + 36 + nl;

                let cigar = '';

                for (let c = 0; c < nc; ++c) {
                    var cigop = readInt(ba, p);
                    cigar = cigar + (cigop>>4) + CIGAR_DECODER[cigop & 0xf];
                    p += 4;
                }

                record.cigar = cigar;

                let seq = '';
                let seqBytes = (lseq + 1) >> 1;

                for (let j = 0; j < seqBytes; ++j) {
                    let sb = ba[p + j];
                    seq += SEQRET_DECODER[(sb & 0xf0) >> 4];

                    if (seq.length < lseq)
                        seq += SEQRET_DECODER[(sb & 0x0f)];
                }

                p += seqBytes;
                record.seq = seq;

                let qseq = '';

                for (let j = 0; j < lseq; ++j) {
                    qseq += String.fromCharCode(ba[p + j] + 33);
                }

                p += lseq;
                record.quals = qseq;

                while (p < blockEnd) {
                    let tag = String.fromCharCode(ba[p], ba[p + 1]);
                    let type = String.fromCharCode(ba[p + 2]);
                    let value;

                    if (type == 'A') {
                        value = String.fromCharCode(ba[p + 3]);
                        p += 4;
                    } else if (type == 'i' || type == 'I') {
                        value = readInt(ba, p + 3);
                        p += 7;
                    } else if (type == 'c' || type == 'C') {
                        value = ba[p + 3];
                        p += 4;
                    } else if (type == 's' || type == 'S') {
                        value = readShort(ba, p + 3);
                        p += 5;
                    } else if (type == 'f') {
                        value = readFloat(ba, p + 3);
                        p += 7;
                    } else if (type == 'Z' || type == 'H') {
                        p += 3;
                        value = '';
                        for (;;) {
                            let cc = ba[p++];
                            if (cc == 0) {
                                break;
                            } else {
                                value += String.fromCharCode(cc);
                            }
                        }
                    } else if (type == 'B') {
                        let atype = String.fromCharCode(ba[p + 3]);
                        let alen = readInt(ba, p + 4);
                        let elen;
                        let reader;
                        if (atype == 'i' || atype == 'I' || atype == 'f') {
                            elen = 4;
                            if (atype == 'f')
                                reader = readFloat;
                            else
                                reader = readInt;
                        } else if (atype == 's' || atype == 'S') {
                            elen = 2;
                            reader = readShort;
                        } else if (atype == 'c' || atype == 'C') {
                            elen = 1;
                            reader = readByte;
                        } else {
                            throw 'Unknown array type ' + atype;
                        }

                        p += 8;
                        value = [];
                        for (let i = 0; i < alen; ++i) {
                            value.push(reader(ba, p));
                            p += elen;
                        }
                    } else {
                        throw 'Unknown type '+ type;
                    }
                    record[tag] = value;
                }
            }

            if (!min || record.pos <= max && record.pos + lseq >= min) {
                if (chrId === undefined || refID == chrId) {
                    sink.push(record);
                }
            }
            if (record.pos > max) {
                return true;
            }
            offset = blockEnd;
        }

        // Exits via top of loop.
    };
}


// Calculate the length (in bytes) of the BAI ref starting at offset.
// Returns {nbin, length, minBlockIndex}
function _getBaiRefLength(uncba, offset) {
    let p = offset;
    let nbin = readInt(uncba, p); p += 4;
    for (let b = 0; b < nbin; ++b) {
        let bin = readInt(uncba, p);
        let nchnk = readInt(uncba, p+4);
        p += 8 + (nchnk * 16);
    }
    let nintv = readInt(uncba, p); p += 4;

    let minBlockIndex = 1000000000;
    let q = p;
    for (let i = 0; i < nintv; ++i) {
        let v = readVob(uncba, q); q += 8;
        if (v) {
            let bi = v.block;
            if (v.offset > 0)
                bi += 65536;

            if (bi < minBlockIndex)
                minBlockIndex = bi;
            break;
        }
    }
    p += (nintv * 8);

    return {
        minBlockIndex: minBlockIndex,
        nbin: nbin,
        length: p - offset
    };
}


export const makeBam = (data, bai, indexChunks, callback, attempted) => {
    // Do an initial probe on the BAM file to catch any mixed-content errors.
    data.slice(0, 10).fetch(function(header) {
        if (header) {
            return makeBam2(data, bai, indexChunks, callback, attempted);
        } else {
            return callback(null, "Couldn't access BAM.");
        }
    }, {timeout: 5000});
}

const makeBam2 = (data, bai, indexChunks, callback, attempted) => {
    const bam = new BamFile();

    bam.data = data;
    bam.bai = bai;
    bam.indexChunks = indexChunks;

    let minBlockIndex = bam.indexChunks ? bam.indexChunks.minBlockIndex : 1000000000;

    // Fills out bam.chrToIndex and bam.indexToChr based on the first few bytes of the BAM.
    const parseBamHeader = r => {
        if (!r) {
            return callback(null, "Couldn't access BAM");
        }

        const unc = unbgzf(r, r.byteLength);
        const uncba = new Uint8Array(unc);
        const magic = readInt(uncba, 0);

        if (magic != BAM_MAGIC) {
            return callback(null, "Not a BAM file, magic=0x" + magic.toString(16));
        }

        let headLen = readInt(uncba, 4);
        let header = '';
        let i;
        let j;

        for (i = 0; i < headLen; ++i) {
            header += String.fromCharCode(uncba[i + 8]);
        }

        let nRef = readInt(uncba, headLen + 8);
        let p = headLen + 12;

        bam.chrToIndex = {};
        bam.indexToChr = [];

        for (i = 0; i < nRef; ++i) {
            let lName = readInt(uncba, p);
            let name = '';

            for (j = 0; j < lName-1; ++j) {
                name += String.fromCharCode(uncba[p + 4 + j]);
            }

            bam.chrToIndex[name] = i;

            if (name.indexOf('chr') == 0) {
                bam.chrToIndex[name.substring(3)] = i;
            } else {
                bam.chrToIndex['chr' + name] = i;
            }
            bam.indexToChr.push(name);

            p = p + 8 + lName;
        }

        if (bam.indices) {
            return callback(bam);
        }
    }

    const parseBai = header => {
        if (!header) {
            return "Couldn't access BAI";
        }

        let uncba = new Uint8Array(header);
        let baiMagic = readInt(uncba, 0);

        if (baiMagic != BAI_MAGIC) {
            return callback(null, 'Not a BAI file, magic=0x' + baiMagic.toString(16));
        }

        let nref = readInt(uncba, 4);

        bam.indices = [];

        let p = 8;

        for (let ref = 0; ref < nref; ++ref) {
            let blockStart = p;
            let o = _getBaiRefLength(uncba, blockStart);
            p += o.length;

            minBlockIndex = Math.min(o.minBlockIndex, minBlockIndex);

            let nbin = o.nbin;

            if (nbin > 0) {
                bam.indices[ref] = new Uint8Array(header, blockStart, p - blockStart);
            }
        }

        return true;
    }

    if (!bam.indexChunks) {
        bam.bai.fetch(function(header) {   // Do we really need to fetch the whole thing? :-(
            let result = parseBai(header);
            if (result !== true) {
                if (bam.bai.url && typeof(attempted) === "undefined") {
                    // Already attempted x.bam.bai not there so now trying x.bai
                    bam.bai.url = bam.data.url.replace(new RegExp('.bam$'), '.bai');

                     // True lets us know we are making a second attempt
                    makeBam2(data, bam.bai, indexChunks, callback, true);
                }
                else {
                    // We've attempted x.bam.bai & x.bai and nothing worked
                    callback(null, result);
                }
            } else {
              bam.data.slice(0, minBlockIndex).fetch(parseBamHeader);
            }
        });   // Timeout on first request to catch Chrome mixed-content error.
    } else {
        let chunks = bam.indexChunks.chunks;
        bam.indices = []
        for (let i = 0; i < chunks.length; i++) {
           bam.indices[i] = null;  // To be filled out lazily as needed
        }
        bam.data.slice(0, minBlockIndex).fetch(parseBamHeader);
    }
}

const SEQRET_DECODER = ['=', 'A', 'C', 'x', 'G', 'x', 'x', 'x', 'T', 'x', 'x', 'x', 'x', 'x', 'x', 'N'];
const CIGAR_DECODER = ['M', 'I', 'D', 'N', 'S', 'H', 'P', '=', 'X', '?', '?', '?', '?', '?', '?', '?'];

class BamRecord {
}
