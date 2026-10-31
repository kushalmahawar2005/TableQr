/** Keep optional page data from failing an otherwise usable server-rendered route. */
export async function readOptional<T>(read: Promise<T>, fallback: T, onError: (error: unknown) => void): Promise<T> {
  try {
    return await read;
  } catch (error) {
    onError(error);
    return fallback;
  }
}
