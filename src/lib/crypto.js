/*
 * Credential hashing helpers.
 *
 * WebCrypto (PBKDF2-SHA256) is used whenever the app runs in a secure context
 * (https, localhost). A pure-JavaScript PBKDF2-HMAC-SHA256 fallback keeps the
 * local login working when the production build is served over plain HTTP on
 * a LAN address. Passwords are never stored in plain text.
 */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((array) => {
    output.set(array, offset);
    offset += array.length;
  });
  return output;
}

export function sha256(bytes) {
  const length = bytes.length;
  const bitLength = length * 8;
  const paddedLength = ((length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }

    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotr(words[index - 15], 7) ^
        rotr(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotr(words[index - 2], 17) ^
        rotr(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + K[index] + words[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  hash.forEach((value, index) => outputView.setUint32(index * 4, value));
  return output;
}

function hmacSha256(key, message) {
  let normalizedKey = key;
  if (normalizedKey.length > 64) normalizedKey = sha256(normalizedKey);

  const block = new Uint8Array(64);
  block.set(normalizedKey);

  const innerPad = new Uint8Array(64);
  const outerPad = new Uint8Array(64);

  for (let index = 0; index < 64; index += 1) {
    innerPad[index] = block[index] ^ 0x36;
    outerPad[index] = block[index] ^ 0x5c;
  }

  return sha256(concatBytes(outerPad, sha256(concatBytes(innerPad, message))));
}

function pbkdf2Fallback(passwordBytes, saltBytes, iterations, keyLength = 32) {
  const blockCount = Math.ceil(keyLength / 32);
  const blocks = [];

  for (let blockIndex = 1; blockIndex <= blockCount; blockIndex += 1) {
    const blockSalt = new Uint8Array(saltBytes.length + 4);
    blockSalt.set(saltBytes);
    blockSalt[saltBytes.length] = (blockIndex >>> 24) & 0xff;
    blockSalt[saltBytes.length + 1] = (blockIndex >>> 16) & 0xff;
    blockSalt[saltBytes.length + 2] = (blockIndex >>> 8) & 0xff;
    blockSalt[saltBytes.length + 3] = blockIndex & 0xff;

    let u = hmacSha256(passwordBytes, blockSalt);
    const result = new Uint8Array(u);
    const rounds = Math.max(1, iterations);

    for (let round = 1; round < rounds; round += 1) {
      u = hmacSha256(passwordBytes, u);
      for (let index = 0; index < result.length; index += 1) {
        result[index] ^= u[index];
      }
    }

    blocks.push(result);
  }

  return concatBytes(...blocks).slice(0, keyLength);
}

export function randomBytes(length = 16) {
  const bytes = new Uint8Array(length);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }

  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function getSubtle() {
  try {
    if (globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues) {
      return globalThis.crypto.subtle;
    }
  } catch {
    return null;
  }
  return null;
}

export const WEBCRYPTO_ITERATIONS = 210000;
export const FALLBACK_ITERATIONS = 60000;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const subtle = getSubtle();
  const iterations = subtle ? WEBCRYPTO_ITERATIONS : FALLBACK_ITERATIONS;

  if (subtle) {
    const keyMaterial = await subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    );

    return {
      algorithm: "PBKDF2-SHA256",
      iterations,
      salt: bytesToBase64(salt),
      hash: bytesToBase64(new Uint8Array(bits)),
    };
  }

  const derived = pbkdf2Fallback(
    new TextEncoder().encode(password),
    salt,
    iterations,
    32
  );

  return {
    algorithm: "PBKDF2-SHA256-JS",
    iterations,
    salt: bytesToBase64(salt),
    hash: bytesToBase64(derived),
  };
}

export async function verifyPassword(password, credential) {
  if (!credential?.hash || !credential?.salt) return false;

  const salt = base64ToBytes(credential.salt);
  const iterations = Number(credential.iterations) || WEBCRYPTO_ITERATIONS;
  const expected = credential.hash;
  const subtle = getSubtle();

  if (credential.algorithm === "PBKDF2-SHA256" && subtle) {
    try {
      const keyMaterial = await subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
      );
      const bits = await subtle.deriveBits(
        {
          name: "PBKDF2",
          salt,
          iterations,
          hash: "SHA-256",
        },
        keyMaterial,
        256
      );
      return bytesToBase64(new Uint8Array(bits)) === expected;
    } catch {
      // Fall through to the JavaScript implementation.
    }
  }

  const derived = pbkdf2Fallback(
    new TextEncoder().encode(password),
    salt,
    iterations,
    32
  );

  return bytesToBase64(derived) === expected;
}

/** Exposed for diagnostics/testing only. */
export const __internal = { sha256, hmacSha256, pbkdf2Fallback };
