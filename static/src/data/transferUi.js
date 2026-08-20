export const download = (contents, name, type = 'application/json') => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const SHARED_TRANSFER_FORMAT = 'mcilroy-method-shared-transfer';

export const createSharedTransferContents = transfer => JSON.stringify({
  format: SHARED_TRANSFER_FORMAT,
  version: 1,
  key: transfer.key,
  package: JSON.parse(transfer.contents),
});

export const createTransferFile = transfer => new File(
  [createSharedTransferContents(transfer)], transfer.filename, { type: 'text/plain' },
);

export const canShareTransfer = transfer => Boolean(
  navigator.share && navigator.canShare && navigator.canShare({ files: [createTransferFile(transfer)] }),
);

export const shareTransfer = transfer => navigator.share({ files: [createTransferFile(transfer)] });

export const sharedTransferContents = contents => {
  try {
    const shared = JSON.parse(contents);
    if (shared.format !== SHARED_TRANSFER_FORMAT || shared.version !== 1 ||
        typeof shared.key !== 'string' || !shared.package) return null;
    return { key: shared.key, contents: JSON.stringify(shared.package) };
  } catch (error) {
    return null;
  }
};
