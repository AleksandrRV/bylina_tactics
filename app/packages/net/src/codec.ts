import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import QRCode from "qrcode";
import jsQR from "jsqr";

/**
 * Кодирование описания сессии в короткую строку (roadmap 0.15.0:
 * «обмен описанием сессии … короткой строкой»).
 */
export function encodeSessionCode(signal: unknown): string {
  return compressToEncodedURIComponent(JSON.stringify(signal));
}

export function decodeSessionCode(code: string): unknown {
  const raw = decompressFromEncodedURIComponent(code.trim());
  if (!raw) throw new Error("Invalid session code");
  return JSON.parse(raw) as unknown;
}

/** Изображение быстрого считывания (QR) для описания сессии. */
export function createQrDataUrl(code: string): Promise<string> {
  return QRCode.toDataURL(code, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#10150e", light: "#f3ecdc" },
  });
}

/**
 * Чтение QR-изображения (загруженный файл либо кадр камеры): возвращает
 * код сессии. Используется ведомым при подключении по изображению.
 */
export function decodeQrImage(imageData: { data: Uint8ClampedArray; width: number; height: number }): string | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height);
  return result?.data ?? null;
}
