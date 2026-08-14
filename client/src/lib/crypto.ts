const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'zeniel-default-secret-key-2024';

function encodeUtf8(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeUtf8(value: string): string {
  return decodeURIComponent(escape(atob(value)));
}

export const encrypt = (text: string): string => {
  if (!text) return '';

  try {
    return encodeUtf8(`${ENCRYPTION_KEY}:${text}`);
  } catch (error) {
    console.error('Encryption Error:', error);
    return text;
  }
};

export const decrypt = (cipherText: string): string => {
  if (!cipherText) return '';

  try {
    const decoded = decodeUtf8(cipherText);
    return decoded.startsWith(`${ENCRYPTION_KEY}:`)
      ? decoded.slice(ENCRYPTION_KEY.length + 1)
      : decoded;
  } catch (error) {
    console.error('Decryption Error:', error);
    return cipherText;
  }
};
