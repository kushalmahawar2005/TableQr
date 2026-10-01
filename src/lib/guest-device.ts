// A random id stored on the guest's phone. It lets the same phone rejoin its table session
// without logging in. It is never trusted alone: the server matches it to a participant row.
export const DEVICE_COOKIE = "tq_device";
