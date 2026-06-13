const PASSWORD_ALGORITHM = "PBKDF2-SHA-256";
const PASSWORD_HASH_ITERATIONS = 150_000;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;

function getCrypto() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error("Criptografia indisponivel neste navegador.");
  return cryptoApi;
}

function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function timingSafeEqual(a, b) {
  const left = base64ToBytes(a);
  const right = base64ToBytes(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

async function derivePasswordHash(password, salt, iterations) {
  const cryptoApi = getCrypto();
  const key = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await cryptoApi.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    PASSWORD_HASH_BYTES * 8
  );
  return bytesToBase64(new Uint8Array(bits));
}

export async function createPasswordCredential(password) {
  const cryptoApi = getCrypto();
  const salt = new Uint8Array(PASSWORD_SALT_BYTES);
  cryptoApi.getRandomValues(salt);
  const passwordIterations = PASSWORD_HASH_ITERATIONS;
  return {
    passwordAlgorithm: PASSWORD_ALGORITHM,
    passwordHash: await derivePasswordHash(password, salt, passwordIterations),
    passwordIterations,
    passwordSalt: bytesToBase64(salt)
  };
}

export async function attachPasswordCredential(user, password) {
  const { password: _legacyPassword, ...safeUser } = user;
  return { ...safeUser, ...(await createPasswordCredential(password)) };
}

export async function verifyPassword(user, password) {
  if (user?.passwordHash && user?.passwordSalt) {
    const iterations = Number(user.passwordIterations) || PASSWORD_HASH_ITERATIONS;
    const salt = base64ToBytes(user.passwordSalt);
    const expectedHash = await derivePasswordHash(password, salt, iterations);
    return timingSafeEqual(expectedHash, user.passwordHash);
  }
  return Boolean(user?.password && user.password === password);
}

export function hasLegacyPassword(user) {
  return Boolean(user?.password);
}
