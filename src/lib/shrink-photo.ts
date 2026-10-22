// Phone photos are often 3-12 MB, more than an upload can carry (the server takes about 1 MB of
// photo). The browser shrinks them first to a 2000 px JPEG; the server then makes the final
// ~100 KB WebP. If the browser cannot read the file, it is sent as it is.

const MAX_SIDE = 2000;
const TARGET_BYTES = 900 * 1024;

export async function shrinkPhoto(file: File, options: { preserveTransparency?: boolean } = {}): Promise<{ name: string; type: string; base64: string }> {
  let blob: Blob = file;
  let type = file.type;
  if (file.size > TARGET_BYTES) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const outputType = options.preserveTransparency ? "image/webp" : "image/jpeg";
      for (const quality of [0.85, 0.75, 0.65]) {
        const out = await new Promise<Blob | null>((done) => canvas.toBlob(done, outputType, quality));
        if (!out) break;
        blob = out;
        type = outputType;
        if (out.size <= TARGET_BYTES) break;
      }
    } catch {
      /* not decodable here: send the original */
    }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const extension = type === "image/jpeg" ? ".jpg" : type === "image/webp" ? ".webp" : "";
  return { name: file.name.replace(/\.[^.]+$/, "") + extension, type, base64: btoa(binary) };
}
