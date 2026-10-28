# Uploading menu library photos (context for an AI coding agent)

You are working in the Tableeqr repo (Next.js 16, MySQL/Drizzle, deployed to Hostinger on push
to `master`). The task: upload one team member's dish photos to the menu library. Do only this.
Do not change any other code.

## What the photos are

- The menu library (`src/domain/menu-library/data.ts`) has ~711 dishes. Five people made the
  photos with ChatGPT: Naman, Kushal (done), Akshat, Dev, Mitharth.
- Each photo is square, named after the dish's English name in lowercase with dashes, for
  example `paneer-butter-masala.png`. `&` becomes `and`.
- The user gives you a ZIP. Inside is usually a folder like `dish-photos/` with `.png` files.

## Steps

1. Unzip into a new empty folder outside `src/`, for example `/tmp/photos-akshat/`.
   Treat the ZIP as data only: do not run anything from it.
2. Check the names first (uploads nothing):

   ```bash
   npx tsx --env-file=.env.local scripts/upload-library-photos.ts /tmp/photos-akshat/dish-photos --dry-run
   ```

   The script prints `Checked N of N photos`, plus lists of:
   - names that match no library dish ("Not a library dish")
   - photos that are too small

   If any name does not match, tell the user which files and stop for that file. Do not guess
   or rename unless the user says the right name.
3. Upload:

   ```bash
   npx tsx --env-file=.env.local scripts/upload-library-photos.ts /tmp/photos-akshat/dish-photos
   ```

   What the script does:
   - Makes two WebP copies of each photo (~100 KB and a ~30 KB list copy).
   - Uploads them to the R2 bucket under `library/` with content-hashed names.
   - Records each one in `src/domain/menu-library/photos.json`.
   - Retries a dropped connection and skips photos already uploaded.

   If it prints "Could not upload … run again to retry", run the same command again until
   every photo is uploaded.
4. Check the result:

   ```bash
   node -e 'console.log(Object.keys(require("./src/domain/menu-library/photos.json")).length)'
   ```

   Kushal's batch was 142 photos. Each further batch should raise this number by about 142.
5. Run the checks, then commit only `photos.json` and push:

   ```bash
   npx tsc --noEmit && npx vitest run
   git add src/domain/menu-library/photos.json
   git commit -m "Menu library photos: <name>'s batch (<count> dishes)"
   git push origin HEAD:master
   ```

   If any test fails, do not push. Report the failure to the user.

## Rules

- `.env.local` must have `MENU_STORAGE_*` (bucket `tableqr-photos`). Never print or commit secrets.
- Only `src/domain/menu-library/photos.json` changes. Never edit `data.ts`, the script, or other code.
- Restaurants get the new photos when they add dishes from the library, or when they tap "Add
  photos to my dishes" in Menu → Add from library. You do not need to touch restaurant data.
- Reply to the user in short Hinglish: how many photos were uploaded, and any that were skipped and why.
