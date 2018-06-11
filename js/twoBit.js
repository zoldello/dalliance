/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

//
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// twoBit.js: packed-binary reference sequences
//

"use strict";

import {readInt, readIntBE, readInt64BE, readInt64LE} from './bin';
import {Range, union, intersection} from './spans';

const TWOBIT_MAGIC = 0x1a412743;
const TWOBIT_MAGIC_BE = 0x4327411a;
const HEADER_BLOCK_SIZE = 12500;

function TwoBitFile() {
}

function makeTwoBit(fetchable, cnt) {
    var tb = new TwoBitFile();
    tb.data = fetchable;
    var headerBlockSize = HEADER_BLOCK_SIZE;
    var headerBlocksFetched=0;

    tb.data.slice(0, headerBlockSize).fetch(function(r) {
        if (!r) {
            return cnt(null, "Couldn't access data");
        }
        var ba = new Uint8Array(r);
        var magic = readInt(ba, 0);
        if (magic == TWOBIT_MAGIC) {
            tb.readInt = readInt;
            tb.readInt64 = readInt64LE;
        } else if (magic == TWOBIT_MAGIC_BE) {
            tb.readInt = readIntBE;
            tb.readInt64 = readInt64BE;
        } else {
            return cnt(null, "Not a .2bit file, magic=0x" + magic.toString(16));
        }

        tb.version = tb.readInt(ba, 4);
        if (tb.version < 0 || tb.version > 1) {
            return cnt(null, 'Unsupported version ' + tb.version);
        }

        tb.seqCount = tb.readInt(ba, 8);
        tb.seqDict = {};

        var p = 16, i=0;
        var o = 0;  // Offset of the current block if we need to fetch multiple header blocks.

        var parseSeqInfo = function() {
            while (i < tb.seqCount) {
                var ns = ba[p];
                if (p + ns + 2 + (tb.version == 0 ? 4 : 8) >= ba.length) {
                    headerBlocksFetched += headerBlockSize;
                    headerBlockSize = Math.max(HEADER_BLOCK_SIZE,Math.floor(headerBlocksFetched*tb.seqCount/i));
                    return tb.data.slice(o + p, headerBlockSize).fetch(function (r) {
                        o += p;
                        p = 0;
                        ba = new Uint8Array(r);
                        parseSeqInfo();
                    });
                } else {
                    ++p;
                    var name = '';
                    for (var j = 1; j <= ns; ++j) {
                        name += String.fromCharCode(ba[p++]);
                    }
                    if (tb.version == 0) {
                        var offset = tb.readInt(ba, p);
                        p += 4;
                    } else {
                        var offset = tb.readInt64(ba, p);
                        p += 8;
                    }
                    tb.seqDict[name] = new TwoBitSeq(tb, offset);
                    ++i;
                }
            }
            return cnt(tb);
        }

        parseSeqInfo();

    });
}

TwoBitFile.prototype.getSeq = function(chr) {
    var seq = this.seqDict[chr];
    if (!seq) {
        seq = this.seqDict['chr' + chr];
    }
    return seq;
}

TwoBitFile.prototype.fetch = function(chr, min, max, cnt) {
    var seq = this.getSeq(chr);
    if (!seq) {
        return cnt(null, "Couldn't find " + chr);
    } else if (max <= min) {
        return cnt('');
    } else {
        seq.fetch(min, max, cnt);
    }
}

function TwoBitSeq(tbf, offset) {
    this.tbf = tbf;
    this.offset = offset;
}

TwoBitSeq.prototype.init = function(cnt) {
    if (this.seqOffset) {
        return cnt();
    }

    var thisB = this;
    thisB.tbf.data.slice(thisB.offset, 8).fetch(function(r1) {
        if (!r1) {
            return cnt('Fetch failed');
        }
        var ba = new Uint8Array(r1);
        thisB._length = thisB.tbf.readInt(ba, 0);
        thisB.nBlockCnt = thisB.tbf.readInt(ba, 4);
        thisB.tbf.data.slice(thisB.offset + 8, thisB.nBlockCnt*8 + 4).fetch(function(r2) {
            if (!r2) {
                return cnt('Fetch failed');
            }
            var ba = new Uint8Array(r2);
            var nbs = null;
            for (var b = 0; b < thisB.nBlockCnt; ++b) {
                var nbMin = thisB.tbf.readInt(ba, b * 4);
                var nbLen = thisB.tbf.readInt(ba, (b + thisB.nBlockCnt) * 4);
                var nb = new Range(nbMin, nbMin + nbLen - 1);
                if (!nbs) {
                    nbs = nb;
                } else {
                    nbs = union(nbs, nb);
                }
            }
            thisB.nBlocks = nbs;
            thisB.mBlockCnt = thisB.tbf.readInt(ba, thisB.nBlockCnt*8);
            thisB.seqLength = ((thisB._length + 3)/4)|0;
            thisB.seqOffset = thisB.offset + 16 + ((thisB.nBlockCnt + thisB.mBlockCnt) * 8);
            return cnt();
        });
    });
}

var TWOBIT_TABLE = ['T', 'C', 'A', 'G'];

TwoBitSeq.prototype.fetch = function(min, max, cnt) {
    --min; --max;       // Switch to zero-based.
    var thisB = this;
    this.init(function(error) {
        if (error) {
            return cnt(null, error);
        }

        var fetchMin = min >> 2;
        var fetchMax = max + 3 >> 2;
        if (fetchMin < 0 || fetchMax > thisB.seqLength) {
            return cnt('Coordinates out of bounds: ' + min + ':' + max);
        }

        thisB.tbf.data.slice(thisB.seqOffset + fetchMin, fetchMax - fetchMin).salted().fetch(function(r) {
            if (r == null) {
                return cnt('SeqFetch failed');
            }
            var seqData = new Uint8Array(r);

            var nSpans = [];
            if (thisB.nBlocks) {
                var intr = intersection(new Range(min, max), thisB.nBlocks);
                if (intr) {
                    nSpans = intr.ranges();
                }
            }

            var seqstr = '';
            var ptr = min;
            function fillSeq(fsm) {
                while (ptr <= fsm) {
                    var bb = (ptr >> 2) - fetchMin;
                    var ni = ptr & 0x3;
                    var bv = seqData[bb];
                    var n;
                    if (ni == 0) {
                        n = (bv >> 6) & 0x3;
                    } else if (ni == 1) {
                        n = (bv >> 4) & 0x3;
                    } else if (ni == 2) {
                        n = (bv >> 2) & 0x3;
                    } else {
                        n = (bv) & 0x3;
                    }
                    seqstr += TWOBIT_TABLE[n];
                    ++ptr;
                }
            }

            for (var b = 0; b < nSpans.length; ++b) {
                var nb = nSpans[b];
                if (ptr > nb.min()) {
                    throw 'N mismatch...';
                }
                if (ptr < nb.min()) {
                    fillSeq(nb.min() - 1);
                }
                while (ptr <= nb.max()) {
                    seqstr += 'N';
                    ++ptr;
                }
            }
            if (ptr <= max) {
                fillSeq(max);
            }
            return cnt(seqstr);
        });
    });
}

TwoBitSeq.prototype.length = function(cnt) {
    var thisB = this;
    this.init(function(error) {
        if (error) {
            return cnt(null, error);
        } else {
            return cnt(thisB._length);
        }
    });
}

if (typeof(module) !== 'undefined') {
    module.exports = {
        makeTwoBit: makeTwoBit
    };
}
