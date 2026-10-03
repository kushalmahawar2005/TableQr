import { encodeQr } from "@/domain/qr";
export function qrSvg(value: string, size = 220) {
  const qr = encodeQr(value); const cell = size / qr.size; const paths: string[] = [];
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) paths.push(`<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Table QR"><rect width="100%" height="100%" fill="white"/> <g fill="black">${paths.join("")}</g></svg>`;
}
