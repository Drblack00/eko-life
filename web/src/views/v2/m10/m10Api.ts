/**
 * M10 REST client — small Bearer-auth fetch helpers for the economy
 * endpoints (mounted by the coordinator from m10 REST_SPEC).
 * Mutations still go through the WS (`sock.sendAct`); these are reads.
 */
import type { ActName } from "../../../game/types";

/**
 * M10 intent names are not yet in the shared ActName union (game/types.ts
 * is coordinator-owned). Cast locally so the client compiles standalone.
 */
export const m10Act = (name: string): ActName => name as ActName;

export interface ShopRow {
  id: number;
  name: string;
  type: string;
  typeName: string;
  icon: string;
  location_id: string;
  locationName: string;
  owner: string;
  rating: number;
  rating_count: number;
  items: number;
  from_price: number | null;
}

export interface ShopItemRow {
  id: number;
  name: string;
  price: number;
  stock: number;
}

export interface MyShop {
  id: number;
  name: string;
  type: string;
  typeName: string;
  icon: string;
  location_id: string;
  locationName: string;
  rating: number;
  rating_count: number;
}

export interface LapoLoan {
  principal: number;
  balance: number;
  weekly_due: number;
  weeks_left: number;
  start_day: number;
  debits_done: number;
}

export interface LapoTerms {
  min: number;
  max: number;
  weeks: number;
  flatRate: number;
}

export interface TaxInfo {
  weekEarnings: number;
  bill: number;
  rawBill: number;
  taxMult: number;
  holiday: boolean;
  free: number;
  flatRate: number;
  bracket: { label: string; rate: number };
}

async function authed<T>(token: string, path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export const m10Api = {
  shops: (token: string, location = "") =>
    authed<{ shops: ShopRow[] }>(
      token,
      `/api/v2/m10/shops${location ? `?location=${encodeURIComponent(location)}` : ""}`
    ),
  mine: (token: string) =>
    authed<{ shop: MyShop | null; items: ShopItemRow[]; todayEarnings: number }>(
      token,
      "/api/v2/m10/shop/mine"
    ),
  lapo: (token: string) =>
    authed<{ loan: LapoLoan | null; terms: LapoTerms }>(token, "/api/v2/m10/lapo"),
  tax: (token: string) => authed<TaxInfo>(token, "/api/v2/m10/tax"),
};
