// Response shapes for the staff dashboards (Phase 8): Analyst, Support and Admin.
// Dates are ISO strings in JSON.
import type { Role } from "./roles";
import type { Cart, Order, OrderSummary } from "./api";

// ---- Analyst (UC1–UC3) --------------------------------------------------------------------------

export interface RecentEvent {
  ts: string;
  type: string;
  path?: string;
  device?: string;
  sessionId: string;
  loggedIn: boolean;
  /** Short human-readable detail, e.g. the search query or order number. */
  detail?: string;
}

export interface LiveActivity {
  /** Unique sessions in the last `activeWindowMin` minutes (PFCOUNT over the HyperLogLogs). */
  activeSessions: number;
  activeWindowMin: number;
  /** Last 30 minutes, oldest first, from the Redis per-minute counters. */
  perMinute: { minute: string; events: number; active: number }[];
  /** Events per type over the active window. */
  byType: Record<string, number>;
  recent: RecentEvent[];
  topPages: { path: string; views: number }[];
  topProducts: { productId: string; name: string; views: number }[];
  generatedAt: string;
  cached: boolean;
}

export interface TrendsResponse {
  from: string;
  to: string;
  types: string[];
  /** One row per Sri Lanka local hour, oldest first. */
  hours: { hour: string; counts: Record<string, number>; sessions: number }[];
  days: { day: string; counts: Record<string, number> }[];
  cached: boolean;
}

export interface TopResponse {
  from: string;
  to: string;
  products: { productId: string; name: string; kind: string; views: number; addToCart: number; cartRate: number }[];
  searches: { query: string; count: number; avgResults: number }[];
  zeroResultSearches: { query: string; count: number }[];
  cached: boolean;
}

export const EXPORT_REPORTS = ["funnel", "trends", "top"] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];

// ---- Support (UC12–UC14) ------------------------------------------------------------------------

export interface SessionSummary {
  _id: string;
  anonymousId: string;
  customerId: string | null;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  eventCount: number;
  landingPath?: string;
  device?: { type: string; os: string; browser: string };
  reached: { productView: boolean; addToCart: boolean; checkoutStarted: boolean; orderPlaced: boolean };
  hadCheckoutFailure: boolean;
  orderIds: string[];
  simulated: boolean;
}

export interface SupportCustomer {
  _id: string;
  name: string;
  /** Masked for the support role. */
  email: string;
  role: Role;
  status: "active" | "disabled" | "erased";
  createdAt: string;
  lastLoginAt?: string;
  anonymousIds: string[];
}

export interface SearchHit {
  kind: "customer" | "order" | "anonymous";
  label: string;
  sublabel: string;
  /** Where the UI should go: a customer, an order or a session. */
  customerId?: string;
  orderNumber?: string;
  sessionId?: string;
}

export interface SessionNote {
  _id: string;
  sessionId: string;
  customerId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  flagged: boolean;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt?: string;
  resolvedByName?: string;
}

export interface CustomerDetail {
  customer: SupportCustomer;
  sessions: SessionSummary[];
  orders: (OrderSummary & { payment?: Order["payment"] })[];
  /** Live cart from Redis, priced from MongoDB. */
  cart: Cart;
  notes: SessionNote[];
}

export interface TimelineEvent {
  ts: string;
  type: string;
  source: "client" | "server";
  path?: string;
  props: Record<string, unknown>;
}

export interface SessionDetail {
  sessionId: string;
  summary: SessionSummary | null;
  customer: { _id: string; name: string; email: string } | null;
  events: TimelineEvent[];
  orders: { orderNumber: string; total: number; status: string }[];
  notes: SessionNote[];
}

export interface FailedCheckout {
  sessionId: string;
  at: string;
  reason: "out_of_stock" | "payment_declined" | "validation";
  sku?: string;
  device?: string;
  customer: { _id: string; name: string } | null;
  /** The same session went on to place an order anyway. */
  recovered: boolean;
  noteCount: number;
}

// ---- Admin (UC4–UC7, UC15) ----------------------------------------------------------------------

export interface AdminUser {
  _id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "disabled" | "erased";
  createdAt: string;
  lastLoginAt?: string;
  /** Live Redis sessions (SCARD user_sessions:{id}). */
  activeSessions: number;
}

export interface AdminSettings {
  eventRetentionDays: number;
  rollupIntervalMin: number;
  /** What MongoDB actually has configured on `events` (from listCollections). */
  eventsExpireAfterSeconds: number | null;
  updatedAt?: string;
  updatedByName?: string;
  rollups: { lastRunAt?: string; mode?: string; durationMs?: Record<string, number> } | null;
  rebuildPending: boolean;
}

export interface IndexInfo {
  name: string;
  key: Record<string, unknown>;
  sizeBytes: number;
  /** Uses since the server started ($indexStats). */
  ops: number;
  since: string;
  unique?: boolean;
  partial?: boolean;
  ttlSeconds?: number;
}

export interface CollectionIndexes {
  name: string;
  type: "collection" | "timeseries";
  count: number;
  sizeBytes: number;
  storageBytes: number;
  indexes: IndexInfo[];
}

export interface HealthReport {
  mongo: {
    setName: string;
    /** lagSec is null for the primary's view of an unreachable member. */
    members: { name: string; state: string; health: number; uptimeSec: number; optimeDate: string; lagSec: number | null; pingMs: number | null; self: boolean }[];
    server: {
      version: string;
      uptimeSec: number;
      connections: { current: number; available: number };
      opcounters: Record<string, number>;
      residentMB: number;
      transactions: { committed: number; aborted: number };
    };
    db: { collections: number; objects: number; dataBytes: number; storageBytes: number; indexBytes: number };
  };
  redis: { version: string; uptimeSec: number; usedMemory: string; peakMemory: string; clients: number; opsPerSec: number; aof: boolean; keys: number; hitRate: number | null };
  stream: {
    name: string;
    length: number;
    groups: { name: string; consumers: number; pending: number; lag: number | null; lastDeliveredId: string }[];
    deadLetters: number;
  };
  checkedAt: string;
}

export interface AuditEntry {
  _id: string;
  at: string;
  actorId: string;
  actorRole: Role;
  actorName?: string;
  action: string;
  target: { type: string; id: string };
  details?: Record<string, unknown>;
}

export interface ErasureResult {
  userId: string;
  events: number;
  sessionSummaries: number;
  sessionNotes: number;
  ordersPseudonymised: number;
  redisKeys: number;
  sessionsRevoked: number;
  durationMs: number;
}
