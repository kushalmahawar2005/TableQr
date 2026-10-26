// Phone photos are often 3-12 MB, more than an upload can carry (the server takes about 1 MB of
// photo). The browser shrinks them first to a 2000 px JPEG; the server then makes the final
// ~100 KB WebP. If the browser cannot read the file, it is sent as it is.

const MAX_SIDE = 2000;
const TARGET_BYTES = 900 * 1024;

/** The photo as a small Blob (or the file itself when it is already small or cannot be read) */
async function shrinkBlob(file: File, preserveTransparency = false): Promise<{ blob: Blob; type: string }> {
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
      const outputType = preserveTransparency ? "image/webp" : "image/jpeg";
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
  return { blob, type };
}

const renamed = (name: string, type: string) => name.replace(/\.[^.]+$/, "") + (type === "image/jpeg" ? ".jpg" : type === "image/webp" ? ".webp" : "");

export async function shrinkPhoto(file: File, options: { preserveTransparency?: boolean } = {}): Promise<{ name: string; type: string; base64: string }> {
  const { blob, type } = await shrinkBlob(file, options.preserveTransparency);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: renamed(file.name, type), type, base64: btoa(binary) };
}

/** The same shrinking, as a File to put in a FormData (forms that post files to a server action) */
export async function shrinkPhotoFile(file: File): Promise<File> {
  const { blob, type } = await shrinkBlob(file);
  return blob === file ? file : new File([blob], renamed(file.name, type), { type });
}
