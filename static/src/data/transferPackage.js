export const TRANSFER_FORMAT = 'mcilroy-method-encrypted-transfer';
export const TRANSFER_VERSION = 1;
export const TRANSFER_LIFETIME_MS = 30 * 60 * 1000;

// Compression is only used while creating or opening a transfer. Loading pako on demand
// keeps this optional feature out of the startup bundle for the calculator and tracker.
const loadCompression = () => import('pako');

const bytesToBase64 = bytes => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64ToBytes = value => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const transferHeader = transfer => JSON.stringify({
  format: transfer.format,
  version: transfer.version,
  createdAt: transfer.createdAt,
  expiresAt: transfer.expiresAt,
  compression: transfer.compression,
});

export const createTransferPackage = async (backup, currentTime = Date.now(), options = {}) => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Encrypted transfers are not supported by this browser.');
  }
  const keyBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const transfer = {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    createdAt: new Date(currentTime).toISOString(),
    expiresAt: new Date(currentTime + TRANSFER_LIFETIME_MS).toISOString(),
    algorithm: 'AES-GCM',
    iv: bytesToBase64(iv),
    ...(options.compress ? { compression: 'deflate' } : {}),
  };
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const plaintext = options.compress
    ? (await loadCompression()).deflate(backup)
    : new TextEncoder().encode(backup);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(transferHeader(transfer)),
  }, key, plaintext);
  return {
    key: bytesToBase64(keyBytes),
    contents: JSON.stringify({ ...transfer, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }, null, 2),
    expiresAt: transfer.expiresAt,
  };
};

export const openTransferPackage = async (contents, suppliedKey, currentTime = Date.now()) => {
  let transfer;
  try {
    transfer = JSON.parse(contents);
  } catch (error) {
    throw new Error('This is not an encrypted McIlroy Method transfer package.');
  }
  if (transfer?.format !== TRANSFER_FORMAT || transfer.version !== TRANSFER_VERSION ||
      transfer.algorithm !== 'AES-GCM' || typeof transfer.iv !== 'string' ||
      typeof transfer.ciphertext !== 'string' || !Date.parse(transfer.expiresAt)) {
    throw new Error('This is not an encrypted McIlroy Method transfer package.');
  }
  if (currentTime > Date.parse(transfer.expiresAt)) {
    throw new Error('This transfer package has expired. Ask the sender to create a new one.');
  }
  try {
    const keyBytes = base64ToBytes(suppliedKey.trim());
    if (keyBytes.length !== 16) throw new Error('invalid key');
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: base64ToBytes(transfer.iv),
      additionalData: new TextEncoder().encode(transferHeader(transfer)),
    }, key, base64ToBytes(transfer.ciphertext));
    const plaintextBytes = new Uint8Array(plaintext);
    return transfer.compression === 'deflate'
      ? new TextDecoder().decode((await loadCompression()).inflate(plaintextBytes))
      : new TextDecoder().decode(plaintextBytes);
  } catch (error) {
    throw new Error('The transfer key is incorrect or the package has been changed.');
  }
};
