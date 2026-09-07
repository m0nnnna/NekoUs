/** browser-encrypt-attachment ships no types; this covers the two exports NekoUs uses. */
declare module 'browser-encrypt-attachment' {
  export type EncryptedAttachmentInfo = {
    key: { alg: string; ext: boolean; k: string; key_ops: string[]; kty: string };
    iv: string;
    hashes: { sha256: string };
    v: string;
  };

  export function encryptAttachment(
    plaintextBuffer: ArrayBuffer
  ): Promise<{ data: ArrayBuffer; info: EncryptedAttachmentInfo }>;

  export function decryptAttachment(
    ciphertextBuffer: ArrayBuffer,
    info: EncryptedAttachmentInfo
  ): Promise<Uint8Array>;
}
