/*
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS 180-1
 * Version 2.2 Copyright Paul Johnston 2000 - 2009.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 */

/*
 * Configurable variables. You may need to tweak these to be compatible with
 * the server-side, but the defaults work in most cases.
 */

 // Updated by Philip Adenekan to ES6, in 2018


var hexcase = 0;  /* hex output format. 0 - lowercase; 1 - uppercase        */
var b64pad  = ""; /* base-64 pad character. "=" for strict RFC compliance   */

/*
 * These are the functions you'll usually want to call
 * They take string arguments and return either hex or base-64 encoded strings
 */
const hexSha1 = s => rstr2hex(rstrSha1(str2rstrUtf8(s)));
const b64Sha1 = s => rstr2b64(rstrSha1(str2rstrUtf8(s)));
const rstrSha1 = s => binb2rstr(binbSha1(rstr2binb(s), s.length * 8));

/*
 * Convert a raw string to a hex string
 */
 const rstr2hex = input => {
  const hexTab = hexcase ? "0123456789ABCDEF" : "0123456789abcdef";
  let output = "";
  let x;

  for (var i = 0; i < input.length; i++) {
    x = input.charCodeAt(i);
    output += hexTab.charAt((x >>> 4) & 0x0F)
           +  hexTab.charAt(x        & 0x0F);
  }

  return output;
}

/*
 * Convert a raw string to a base-64 string
 */
const rstr2b64 = input => {
    if (!input || !input.length) {
        return null;
    }

  const tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const len = input.length;

  let output = "";

  for (var i = 0; i < len; i += 3) {
    let triplet = (input.charCodeAt(i) << 16)
                | (i + 1 < len ? input.charCodeAt(i+1) << 8 : 0)
                | (i + 2 < len ? input.charCodeAt(i+2)      : 0);

    for (var j = 0; j < 4; j++) {
      if (i * 8 + j * 6 > input.length * 8) output += b64pad;
      else output += tab.charAt((triplet >>> 6*(3-j)) & 0x3F);
    }
  }

  return output;
}

/*
 * Encode a string as utf-8.
 * For efficiency, this assumes the input is valid utf-16.
 */
 const str2rstrUtf8 = input => {
  let output = "";
  let i = -1;
  let x, y;

  while (++i < input.length)
  {
    x = input.charCodeAt(i);
    y = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;

    if (0xD800 <= x && x <= 0xDBFF && 0xDC00 <= y && y <= 0xDFFF)
    {
      x = 0x10000 + ((x & 0x03FF) << 10) + (y & 0x03FF);
      i++;
    }

    /* Encode output as utf-8 */
    if (x <= 0x7F)
      output += String.fromCharCode(x);
    else if (x <= 0x7FF)
      output += String.fromCharCode(0xC0 | ((x >>> 6) & 0x1F),
                                    0x80 | (x         & 0x3F));
    else if (x <= 0xFFFF)
      output += String.fromCharCode(0xE0 | ((x >>> 12) & 0x0F),
                                    0x80 | ((x >>> 6) & 0x3F),
                                    0x80 | (x         & 0x3F));
    else if (x <= 0x1FFFFF)
      output += String.fromCharCode(0xF0 | ((x >>> 18) & 0x07),
                                    0x80 | ((x >>> 12) & 0x3F),
                                    0x80 | ((x >>> 6) & 0x3F),
                                    0x80 | (x         & 0x3F));
  }

  return output;
}




/*
 * Convert a raw string to an array of big-endian words
 * Characters >255 have their high-byte silently ignored.
 */
const rstr2binb = input => {
  let output = Array(input.length >> 2);

  for (let i = 0; i < output.length; i++) {
    output[i] = 0;
}

  for (var i = 0; i < input.length * 8; i += 8) {
    output[i>>5] |= (input.charCodeAt(i / 8) & 0xFF) << (24 - i % 32);
}

  return output;
}

/*
 * Convert an array of big-endian words to a string
 */
const binb2rstr = input => {
  let output = "";

  for (var i = 0; i < input.length * 32; i += 8) {
    output += String.fromCharCode((input[i>>5] >>> (24 - i % 32)) & 0xFF);
}

  return output;
}

/*
 * Calculate the SHA-1 of an array of big-endian words, and a bit length
 */
const binbSha1 = (x, len) => {
  x[len >> 5] |= 0x80 << (24 - len % 32);
  x[((len + 64 >> 9) << 4) + 15] = len;

  let w = Array(80);
  let a =  1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d =  271733878;
  let e = -1009589776;

  for (let i = 0; i < x.length; i += 16)
  {
    let olda = a;
    let oldb = b;
    let oldc = c;
    let oldd = d;
    let olde = e;

    for (let j = 0; j < 80; j++)
    {
      if (j < 16) {
          w[j] = x[i + j];
      } else {
          w[j] = bitRol(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
      }

      let t = safeAdd(safeAdd(bitRol(a, 5), sha1Ft(j, b, c, d)),
                       safeAdd(safeAdd(e, w[j]), sha1Kt(j)));
      e = d;
      d = c;
      c = bitRol(b, 30);
      b = a;
      a = t;
    }

    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
    e = safeAdd(e, olde);
  }
  return Array(a, b, c, d, e);

}

/*
 * Perform the appropriate triplet combination function for the current
 * iteration
 */
const sha1Ft = (t, b, c, d) => {
  if (t < 20) {
      return (b & c) | ((~b) & d);
  }

  if (t < 40) {
      return b ^ c ^ d;
  }

  if (t < 60) {
      return (b & c) | (b & d) | (c & d);
  }

  return b ^ c ^ d;
}

/*
 * Determine the appropriate additive constant for the current iteration
 */
const sha1Kt = t => {
    // TODO: Fix nested ternary expression
  return (t < 20) ?  1518500249 : (t < 40) ?  1859775393 :
         (t < 60) ? -1894007588 : -899497514;
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
const safeAdd = (x, y) => {
  const lsw = (x & 0xFFFF) + (y & 0xFFFF);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);

  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
const bitRol = (num, cnt) => {
  return (num << cnt) | (num >>> (32 - cnt));
}

export default {
    hexSha1: hexSha1,
    b64Sha1: b64Sha1
}
