// sezgisel tahmin: ~4 karakter = 1 token (her zaman "~" ile gösterilir)
export const CHARS_PER_TOKEN = 4;
export const IMAGE_TOKENS = 1_600;

export const estimateTokens = (chars: number): number =>
  chars <= 0 ? 0 : Math.ceil(chars / CHARS_PER_TOKEN);

export const estimateTextTokens = (text: string): number => estimateTokens(text.length);
