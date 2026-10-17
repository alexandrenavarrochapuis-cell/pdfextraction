// Browser-side preparation of a file before upload. Vercel refuses request
// bodies over 4.5 MB, and a phone camera photo is often bigger, so photos are
// re-encoded as JPEG at a size that still reads clearly (passport pages,
// boarding pass barcodes). Smaller files and PDFs go up unchanged.

/** Largest file the upload routes accept, with room under Vercel's 4.5 MB limit. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const SHRINK_ABOVE_BYTES = 3 * 1024 * 1024;
const MAX_SIDE = 2400;

export async function prepareUpload(file: File): Promise<File> {
  const photo = /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type);
  // HEIC is re-encoded at any size: most browsers other than Safari cannot show it.
  if (!photo || (file.size <= SHRINK_ABOVE_BYTES && !/hei[cf]$/.test(file.type))) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  } catch {
    // The browser could not decode it; send the original and let the size check speak.
    return file;
  }
}

export function tooLargeMessage(file: File): string | null {
  return file.size > MAX_UPLOAD_BYTES ? `${file.name} is larger than 4 MB. Use a smaller file or a photo.` : null;
}
