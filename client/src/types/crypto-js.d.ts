declare module "crypto-js" {
  export const AES: {
    encrypt(message: string, key: string): { toString(): string };
    decrypt(cipherText: string, key: string): { toString(encoder: unknown): string };
  };

  export const enc: {
    Utf8: unknown;
  };

  const CryptoJS: {
    AES: typeof AES;
    enc: typeof enc;
  };

  export default CryptoJS;
}
