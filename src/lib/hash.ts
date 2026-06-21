export function hashBuffer(buffer: ArrayBuffer): string {
  return sha1(buffer).toUpperCase();
}

export function encodeText(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

export function decodeText(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(buffer);
}

function sha1(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  words[bytes.length >> 2] = (words[bytes.length >> 2] || 0) | (0x80 << (24 - (bytes.length % 4) * 8));
  words[(((bytes.length + 8) >> 6) << 4) + 15] = bytes.length * 8;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let i = 0; i < words.length; i += 16) {
    const w = new Array<number>(80);
    for (let j = 0; j < 16; j++) {
      w[j] = words[i + j] || 0;
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotateLeft(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j++) {
      const [f, k] = roundParams(j, b, c, d);
      const temp = (rotateLeft(a, 5) + f + e + k + w[j]) | 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return [h0, h1, h2, h3, h4].map(hex32).join("");
}

function roundParams(round: number, b: number, c: number, d: number): [number, number] {
  if (round < 20) {
    return [((b & c) | (~b & d)), 0x5a827999];
  }
  if (round < 40) {
    return [b ^ c ^ d, 0x6ed9eba1];
  }
  if (round < 60) {
    return [((b & c) | (b & d) | (c & d)), 0x8f1bbcdc];
  }
  return [b ^ c ^ d, 0xca62c1d6];
}

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
