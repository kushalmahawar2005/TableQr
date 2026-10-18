// Hotel rooms. A room is kept apart from the restaurant: it never shows on the floor, in bookings,
// the waiter app or the table limit. Food ordered from a room still runs through the same kitchen
// and bill, on a hidden counter named "Room 204" (like takeaway counters), so the kitchen ticket
// and the bill say the room.

/** tableClass of the hidden counter behind each room */
export const ROOM_CLASS = "room";

const PREFIX = "Room ";

/** Room numbers: letters, digits and dashes, up to 7, e.g. 204, G-12, A101 */
export function cleanRoomNumber(text: string): string | null {
  const t = String(text ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{1,7}$/.test(t) ? t : null;
}

/** The counter's code, which the kitchen ticket and bill show: "Room 204" */
export const roomCode = (number: string) => `${PREFIX}${number}`;

export const isRoomCode = (code: string) => code.startsWith(PREFIX);

/** "Room 204" stays as it is; any other code is a table: "Table T4" */
export const placeEn = (code: string) => (isRoomCode(code) ? code : `Table ${code}`);
export const placeHi = (code: string) => (isRoomCode(code) ? `रूम ${code.slice(PREFIX.length)}` : `टेबल ${code}`);

export const roomStatuses = ["vacant", "occupied", "cleaning", "blocked"] as const;
export type RoomStatus = (typeof roomStatuses)[number];

export const ROOM_STATUS_LABEL: Record<RoomStatus, { en: string; hi: string }> = {
  vacant: { en: "Ready", hi: "खाली" },
  occupied: { en: "Guest in", hi: "गेस्ट है" },
  cleaning: { en: "Cleaning", hi: "सफ़ाई" },
  blocked: { en: "Out of service", hi: "बंद" },
};

/** What a guest in a room can ask for with one tap */
export const roomRequestKinds = ["housekeeping", "towels", "water", "toiletries", "laundry", "maintenance", "wake_up", "other"] as const;
export type RoomRequestKind = (typeof roomRequestKinds)[number];

export const ROOM_REQUEST_LABEL: Record<RoomRequestKind, { en: string; hi: string }> = {
  housekeeping: { en: "Clean my room", hi: "कमरे की सफ़ाई" },
  towels: { en: "Fresh towels", hi: "नए तौलिए" },
  water: { en: "Drinking water", hi: "पीने का पानी" },
  toiletries: { en: "Soap & toiletries", hi: "साबुन वगैरह" },
  laundry: { en: "Laundry pickup", hi: "कपड़े धुलवाने हैं" },
  maintenance: { en: "Something is not working", hi: "कुछ ख़राब है" },
  wake_up: { en: "Wake-up call", hi: "सुबह जगाना" },
  other: { en: "Something else", hi: "कुछ और" },
};
