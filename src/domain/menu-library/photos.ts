import files from "./photos.json";

// Library dish photos. photos.json maps a dish's photo slug to its object key in the photo
// bucket, written by scripts/upload-library-photos.ts; a dish without an entry has no photo yet.

/** "Paneer Butter Masala" → "paneer-butter-masala", the file name the photo team uses */
export const photoSlug = (nameEn: string) =>
  nameEn.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Object key of the dish's library photo, or null when none has been uploaded */
export const libraryPhotoKey = (nameEn: string): string | null => (files as Record<string, string>)[photoSlug(nameEn)] ?? null;

export const libraryPhotoCount = () => Object.keys(files).length;
