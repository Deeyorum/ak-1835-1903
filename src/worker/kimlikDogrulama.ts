/**
 * G4A — API anahtarı üretimi ve karması.
 *
 * SPEC: "API anahtarı (yalnız karması saklanır)". Gerçek anahtar yalnız
 * üretildiği anda bota BİR KEZ döner; D1'e yalnız SHA-256 karması (hex)
 * yazılır. Web Crypto API kullanılır (Workers'ta ve Node 20+'ta ortak
 * global `crypto` nesnesi) — ek bağımlılık YOK.
 */

const ANAHTAR_ONEKI = "akb_"; // "AK bot" — bot API anahtarlarını insan gözüyle ayırt etmek için

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Kriptografik olarak güvenli, 256 bitlik rastgele bot API anahtarı üretir. */
export function uretApiAnahtari(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ANAHTAR_ONEKI + toHex(bytes);
}

/** API anahtarının SHA-256 karmasını (hex) döner — D1'e yalnız bu yazılır. */
export async function anahtarKarmasi(apiAnahtari: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(apiAnahtari));
  return toHex(new Uint8Array(digest));
}

/** `Authorization: Bearer <anahtar>` başlığından ham anahtarı çıkarır. */
export function yetkiBasligindanAnahtarCikar(authHeader: string | null): string | undefined {
  if (authHeader === null) return undefined;
  const esleme = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  return esleme?.[1];
}
