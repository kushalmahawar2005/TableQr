// Menu photos are stored twice when uploaded: the full photo (up to 1600 px, for the dish sheet) and
// a small copy next to it (480 px, "-sm.webp") for lists, cards and tiles, which is all a phone
// needs at 88-160 px. Photos uploaded before the small copy existed have none, so screens fall back
// to the full photo when the small one fails to load.

/** The small copy of a stored menu photo, or the same URL when it is not one of ours */
export function menuThumb(url: string | null | undefined): string | null {
  if (!url) return null;
  // Restaurant uploads (menus/) and the shared dish library (library/) both have a small copy
  return /\/(menus|library)\/[^?#]+\.webp$/.test(url) && !url.endsWith("-sm.webp") ? url.replace(/\.webp$/, "-sm.webp") : url;
}
