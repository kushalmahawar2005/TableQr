"use client";

import { createContext, useContext } from "react";
import type { OlderTickets } from "@/server/kitchen/display";
import type { KdsBoard } from "@/server/kitchen/kds";
import * as wall from "../actions";
import type { KdsResult } from "../actions";

type SearchHits = Awaited<ReturnType<typeof wall.searchAction>>;

/** What the kitchen board can ask the server. The wall screen and the console each supply their own. */
export type KdsActions = {
  board: (station: string | null) => Promise<KdsResult<KdsBoard>>;
  /** A page of open tickets older than the board's window */
  older: (station: string | null, offset: number, limit: number) => Promise<KdsResult<OlderTickets>>;
  token: () => Promise<string | null>;
  accept: (ticketId: string) => Promise<KdsResult<unknown>>;
  start: (ticketId: string) => Promise<KdsResult<unknown>>;
  bumpTicket: (ticketId: string) => Promise<KdsResult<unknown>>;
  bumpLine: (lineId: string) => Promise<KdsResult<unknown>>;
  recall: (ticketId: string) => Promise<KdsResult<unknown>>;
  stock: (itemId: string, outOfStock: boolean) => Promise<KdsResult<{ cartsAffected: number }>>;
  search: (q: string) => Promise<SearchHits>;
  /** Cancel one item with a reason; a manager or owner PIN unless the signed-in person is one */
  cancelLine: (lineId: string, reason: string, phone: string, pin: string) => Promise<KdsResult<unknown>>;
  cancelNeedsPin: boolean;
};

/** The wall screen: every call is checked against its device cookie */
export const wallActions: KdsActions = {
  board: wall.boardAction,
  older: wall.olderAction,
  token: wall.kdsTokenAction,
  accept: wall.acceptAction,
  start: wall.startAction,
  bumpTicket: wall.bumpTicketAction,
  bumpLine: wall.bumpLineAction,
  recall: wall.recallAction,
  stock: wall.stockAction,
  search: wall.searchAction,
  cancelLine: wall.cancelLineAction,
  cancelNeedsPin: true,
};

const KdsActionsContext = createContext<KdsActions>(wallActions);
export const KdsActionsProvider = KdsActionsContext.Provider;
export const useKdsActions = () => useContext(KdsActionsContext);
