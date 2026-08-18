import { createTransferPackage, decodeQrTransfer, encodeQrTransfer, openTransferPackage, TRANSFER_LIFETIME_MS } from './transferPackage';

describe('encrypted transfer packages', () => {
  const originalCrypto = global.crypto;
  const originalTextEncoder = global.TextEncoder;
  const originalTextDecoder = global.TextDecoder;

  beforeAll(() => {
    const { TextDecoder, TextEncoder } = require('util');
    global.TextEncoder = global.TextEncoder || TextEncoder;
    global.TextDecoder = global.TextDecoder || TextDecoder;
    if (!global.crypto?.subtle) {
      const { webcrypto } = require('crypto');
      Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto });
    }
  });

  afterAll(() => {
    Object.defineProperty(global, 'crypto', { configurable: true, value: originalCrypto });
    global.TextEncoder = originalTextEncoder;
    global.TextDecoder = originalTextDecoder;
  });

  it('encrypts and decrypts a backup without putting the key in the package', async () => {
    const backup = '{"profiles":[{"name":"Alex"}]}';
    const transfer = await createTransferPackage(backup, 1000);

    expect(transfer.contents).not.toContain('Alex');
    expect(transfer.contents).not.toContain(transfer.key);
    await expect(openTransferPackage(transfer.contents, transfer.key, 2000)).resolves.toBe(backup);
  });

  it('rejects an incorrect key and an expired package', async () => {
    const transfer = await createTransferPackage('{}', 1000);

    await expect(openTransferPackage(transfer.contents, 'not-the-key', 2000)).rejects.toThrow('incorrect');
    await expect(openTransferPackage(
      transfer.contents,
      transfer.key,
      1000 + TRANSFER_LIFETIME_MS + 1,
    )).rejects.toThrow('expired');
  });

  it('packs the encrypted package and key into a QR payload', async () => {
    const transfer = await createTransferPackage('{"repeated":"aaaaaaaaaaaaaaaaaaaaaaaa"}', 1000, { compress: true });
    const decoded = decodeQrTransfer(encodeQrTransfer(transfer));
    expect(decoded.key).toBe(transfer.key);
    expect(JSON.parse(decoded.contents)).toEqual(JSON.parse(transfer.contents));
    await expect(openTransferPackage(transfer.contents, transfer.key, 2000))
      .resolves.toBe('{"repeated":"aaaaaaaaaaaaaaaaaaaaaaaa"}');
  });
});
