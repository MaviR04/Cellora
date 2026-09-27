// Administrator dashboards: users & access (UC4), GDPR erasure (UC15), retention and rollups
// (UC5, UC6), indexes (UC6), system health (UC7) and the audit trail.
import { Fragment, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLES, type AdminSettings, type AdminUser, type AuditEntry, type CollectionIndexes, type ErasureResult, type HealthReport, type Role } from "@da2/shared";
import { api, patch, post, qs } from "../../lib/api";
import { useMe } from "../../hooks/useAuth";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  SourceNote,
  Stat,
  Table,
  TextLink,
  fmtAgo,
  fmtBytes,
  fmtDateTime,
  fmtDuration,
  fmtNum,
  fmtPct,
  inputClass,
} from "../../components/staff/ui";

// ---- UC4 + UC15: users & access ------------------------------------------------------------------

export function UsersPage() {
  const { user: me } = useMe();
  const qc = useQueryClient();
  const [filter, setFilter] = useState({ q: "", role: "", includeSimulated: "false", page: 1 });
  const [search, setSearch] = useState("");
  const [erasing, setErasing] = useState<AdminUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ["admin", "users", filter],
    queryFn: () => api<{ users: AdminUser[]; total: number; page: number; pageSize: number }>(`/admin/users${qs(filter)}`),
    placeholderData: keepPreviousData,
  });

  const done = (msg: string) => {
    setMessage(msg);
    qc.invalidateQueries({ queryKey: ["admin"] });
  };
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: Role; status?: "active" | "disabled" } }) => patch<{ sessionsRevoked: number }>(`/admin/users/${id}`, body),
    onSuccess: (r) => done(`Saved. ${r.sessionsRevoked} session(s) revoked so the change applies immediately.`),
    onError: (e) => setMessage(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => post<{ revoked: number }>(`/admin/users/${id}/revoke-sessions`),
    onSuccess: (r) => done(`${r.revoked} session(s) revoked. The user is logged out everywhere.`),
  });

  const d = users.data;
  const pages = d ? Math.ceil(d.total / d.pageSize) : 1;
  return (
    <>
      <PageHeader title="Users & access" subtitle="Roles, account status and live sessions (Redis). Every change is audited." />
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ ...filter, q: search, page: 1 });
          }}
        >
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Email starts with…" className={inputClass} />
        </form>
        <select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value, page: 1 })} className={inputClass}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={filter.includeSimulated === "true"} onChange={(e) => setFilter({ ...filter, includeSimulated: String(e.target.checked), page: 1 })} />
          Include 150 simulated customers
        </label>
      </div>
      {message && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
          <button onClick={() => setMessage(null)} className="font-semibold">
            ×
          </button>
        </div>
      )}
      <Card>
        {!d ? (
          <Loading />
        ) : (
          <>
            <Table head={["User", "Role", "Status", "Sessions", "Last login", ""]}>
              {d.users.map((u) => {
                const self = u._id === me?.id;
                const erased = u.status === "erased";
                return (
                  <tr key={u._id} className={erased ? "opacity-50" : ""}>
                    <td>
                      <div className="font-semibold">
                        {u.name} {self && <Badge tone="accent">you</Badge>}
                      </div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={self || erased || update.isPending}
                        onChange={(e) => confirm(`Change ${u.name}'s role to ${e.target.value}? Their sessions will be revoked.`) && update.mutate({ id: u._id, body: { role: e.target.value as Role } })}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm disabled:opacity-60"
                      >
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Badge tone={u.status === "active" ? "green" : "red"}>{u.status}</Badge>
                    </td>
                    <td className="tabular-nums">{u.activeSessions}</td>
                    <td className="whitespace-nowrap text-slate-500">{u.lastLoginAt ? fmtAgo(u.lastLoginAt) : "never"}</td>
                    <td>
                      {!self && !erased && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button disabled={!u.activeSessions || revoke.isPending} onClick={() => revoke.mutate(u._id)}>
                            Revoke sessions
                          </Button>
                          <Button onClick={() => update.mutate({ id: u._id, body: { status: u.status === "active" ? "disabled" : "active" } })}>
                            {u.status === "active" ? "Disable" : "Enable"}
                          </Button>
                          {u.role === "customer" && (
                            <Button tone="danger" onClick={() => setErasing(u)}>
                              Erase data
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>{fmtNum(d.total)} users</span>
              <div className="flex items-center gap-2">
                <Button disabled={filter.page <= 1} onClick={() => setFilter({ ...filter, page: filter.page - 1 })}>
                  ←
                </Button>
                <span>
                  Page {filter.page} of {pages}
                </span>
                <Button disabled={filter.page >= pages} onClick={() => setFilter({ ...filter, page: filter.page + 1 })}>
                  →
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
      {erasing && <EraseDialog user={erasing} onClose={() => setErasing(null)} onDone={(r) => done(`Erased: ${r.events} events, ${r.sessionSummaries} session summaries, ${r.sessionNotes} notes deleted; ${r.ordersPseudonymised} orders pseudonymised; ${r.sessionsRevoked} sessions revoked (${r.durationMs} ms).`)} />}
    </>
  );
}

/** UC15: right to erasure. The admin must type the customer's email to confirm. */
function EraseDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (r: ErasureResult) => void }) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const erase = useMutation({
    mutationFn: () => post<ErasureResult>(`/admin/customers/${user._id}/erase`, { confirmEmail }),
    onSuccess: (r) => {
      onDone(r);
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-extrabold text-rose-700">Erase {user.name}'s personal data?</h2>
        <p className="mt-2 text-sm text-slate-600">This can't be undone. It will:</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
          <li>delete all their telemetry events (logged-in and on linked browsers) and session summaries</li>
          <li>delete support notes about their sessions</li>
          <li>keep their orders for accounting, but strip name, email, phone and street address</li>
          <li>log them out everywhere and delete their cart</li>
          <li>replace their account with an “Erased customer” placeholder</li>
        </ul>
        <label className="mt-4 block text-sm font-semibold">
          Type <span className="font-mono">{user.email}</span> to confirm
          <input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className={`${inputClass} mt-1 w-full`} autoFocus />
        </label>
        {erase.isError && (
          <div className="mt-3">
            <ErrorNote error={erase.error} />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="danger" disabled={confirmEmail.trim().toLowerCase() !== user.email || erase.isPending} onClick={() => erase.mutate()}>
            {erase.isPending ? "Erasing…" : "Erase permanently"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- UC5 + UC6: retention, rollups, indexes ------------------------------------------------------

export function DataPage() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api<AdminSettings>("/admin/settings"),
    // While a rebuild is pending, poll until the worker has picked it up
    refetchInterval: (q) => (q.state.data?.rebuildPending ? 3000 : false),
  });
  const indexes = useQuery({ queryKey: ["admin", "indexes"], queryFn: () => api<{ collections: CollectionIndexes[] }>("/admin/indexes") });
  const [form, setForm] = useState<{ eventRetentionDays?: number; rollupIntervalMin?: number }>({});
  const save = useMutation({
    mutationFn: () => patch<AdminSettings>("/admin/settings", form),
    onSuccess: (s) => {
      qc.setQueryData(["admin", "settings"], s);
      setForm({});
    },
  });
  const rebuild = useMutation({ mutationFn: () => post("/admin/rollups/rebuild"), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "settings"] }) });
  const s = settings.data;

  return (
    <>
      <PageHeader title="Data & indexes" subtitle="Retention (UC5), pre-aggregated views and indexes (UC6)." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Retention & schedule" subtitle="settings {_id: 'global'}">
          {!s ? (
            <Loading />
          ) : (
            <form
              className="flex flex-col gap-4 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="font-semibold">Keep raw events for</span>
                  <span className="block text-xs text-slate-500">Runs collMod on the time-series collection; MongoDB drops expired buckets itself</span>
                </span>
                <span className="flex items-center gap-2">
                  <input type="number" min={1} max={730} value={form.eventRetentionDays ?? s.eventRetentionDays} onChange={(e) => setForm({ ...form, eventRetentionDays: Number(e.target.value) })} className={`${inputClass} w-24`} />
                  days
                </span>
              </label>
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="font-semibold">Refresh rollups every</span>
                  <span className="block text-xs text-slate-500">The worker's incremental $merge interval</span>
                </span>
                <span className="flex items-center gap-2">
                  <input type="number" min={1} max={60} value={form.rollupIntervalMin ?? s.rollupIntervalMin} onChange={(e) => setForm({ ...form, rollupIntervalMin: Number(e.target.value) })} className={`${inputClass} w-24`} />
                  min
                </span>
              </label>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <span>
                  MongoDB now: <code>events.expireAfterSeconds = {fmtNum(s.eventsExpireAfterSeconds ?? 0)}</code> ({((s.eventsExpireAfterSeconds ?? 0) / 86_400).toFixed(0)} days)
                </span>
                {s.updatedByName && <span>last changed by {s.updatedByName}</span>}
              </div>
              {save.isError && <ErrorNote error={save.error} />}
              <div className="text-right">
                <Button tone="primary" disabled={!Object.keys(form).length || save.isPending}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </Card>
        <Card title="Rollups" subtitle="session_summaries, metrics_hourly, funnel_daily (materialised views)">
          {!s ? (
            <Loading />
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              {s.rollups?.lastRunAt ? (
                <>
                  <div>
                    Last run <span className="font-semibold">{fmtAgo(s.rollups.lastRunAt)}</span> ({s.rollups.mode})
                  </div>
                  <Table head={["View", "Duration"]} dense>
                    {Object.entries(s.rollups.durationMs ?? {}).map(([k, ms]) => (
                      <tr key={k}>
                        <td className="font-mono text-xs">{k}</td>
                        <td className="tabular-nums">{ms} ms</td>
                      </tr>
                    ))}
                  </Table>
                </>
              ) : (
                <Empty>No run recorded yet</Empty>
              )}
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500">A full rebuild recomputes every view from all raw events (e.g. after changing the pipeline). The worker picks it up within 15 s.</span>
                <Button tone="primary" disabled={s.rebuildPending || rebuild.isPending} onClick={() => rebuild.mutate()}>
                  {s.rebuildPending ? "Rebuild queued…" : "Rebuild all"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Indexes" subtitle="Definitions, size on disk and use count since the server started ($indexStats, primary node). Zero uses = a candidate for removal.">
        {!indexes.data ? (
          <Loading />
        ) : (
          <div className="flex flex-col gap-6">
            {indexes.data.collections.map((c) => (
              <div key={c.name}>
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <span className="font-mono font-bold">{c.name}</span>
                  {c.type === "timeseries" && <Badge tone="blue">time-series</Badge>}
                  <span className="text-xs text-slate-500">
                    {fmtNum(c.count)} docs · {fmtBytes(c.sizeBytes)} data · {fmtBytes(c.storageBytes)} on disk
                  </span>
                </div>
                <Table head={["Index", "Key", "Size", "Uses", ""]} dense>
                  {c.indexes.map((ix) => (
                    <tr key={ix.name}>
                      <td className="font-mono text-xs">{ix.name}</td>
                      <td className="font-mono text-xs text-slate-500">{JSON.stringify(ix.key)}</td>
                      <td className="tabular-nums">{fmtBytes(ix.sizeBytes)}</td>
                      <td className="tabular-nums">{ix.ops === 0 && ix.name !== "_id_" ? <Badge tone="amber">0</Badge> : fmtNum(ix.ops)}</td>
                      <td className="flex gap-1">
                        {ix.unique && <Badge tone="accent">unique</Badge>}
                        {ix.partial && <Badge>partial</Badge>}
                        {ix.ttlSeconds !== undefined && <Badge tone="blue">TTL</Badge>}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ---- UC7: system health ------------------------------------------------------------------------

export function HealthPage() {
  const q = useQuery({ queryKey: ["admin", "health"], queryFn: () => api<HealthReport>("/admin/health"), refetchInterval: 10_000 });
  if (q.isError) return <ErrorNote error={q.error} />;
  const h = q.data;
  if (!h) return <Loading h="h-96" />;
  const primary = h.mongo.members.find((m) => m.state === "PRIMARY");
  const group = h.stream.groups[0];
  const maxLag = Math.max(...h.mongo.members.map((m) => m.lagSec));

  return (
    <>
      <PageHeader title="System health" subtitle="MongoDB replica set, Redis and the telemetry pipeline. Refreshes every 10 seconds." actions={<SourceNote source="replSetGetStatus · serverStatus · INFO · XINFO" at={h.checkedAt} />} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Primary" value={<span className="text-base">{primary?.name ?? "none!"}</span>} tone={primary ? "good" : "bad"} hint={`replica set ${h.mongo.setName}`} />
        <Stat label="Max replication lag" value={`${maxLag.toFixed(0)} s`} tone={maxLag > 10 ? "warn" : "good"} />
        <Stat label="Stream backlog" value={fmtNum((group?.lag ?? 0) + (group?.pending ?? 0))} hint={`${group?.pending ?? 0} pending · ${group?.lag ?? "?"} unread`} tone={(group?.lag ?? 0) > 1000 ? "warn" : "good"} />
        <Stat label="Dead letters" value={fmtNum(h.stream.deadLetters)} tone={h.stream.deadLetters ? "bad" : "good"} hint="unparseable stream entries" />
      </div>

      <Card title="Replica set members">
        <Table head={["Member", "State", "Health", "Lag behind primary", "Ping", "Up"]}>
          {h.mongo.members.map((m) => (
            <tr key={m.name}>
              <td className="font-mono text-xs">
                {m.name} {m.self && <Badge>API connected here</Badge>}
              </td>
              <td>
                <Badge tone={m.state === "PRIMARY" ? "green" : m.state === "SECONDARY" ? "blue" : "red"}>{m.state}</Badge>
              </td>
              <td>{m.health === 1 ? "OK" : <Badge tone="red">down</Badge>}</td>
              <td className="tabular-nums">{m.state === "PRIMARY" ? "—" : `${m.lagSec.toFixed(0)} s`}</td>
              <td className="tabular-nums">{m.pingMs === null ? "—" : `${m.pingMs} ms`}</td>
              <td>{fmtDuration(m.uptimeSec)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="MongoDB server" subtitle={`v${h.mongo.server.version} · up ${fmtDuration(h.mongo.server.uptimeSec)}`}>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Connections</dt>
            <dd className="tabular-nums">{fmtNum(h.mongo.server.connections.current)}</dd>
            <dt className="text-slate-500">Resident memory</dt>
            <dd className="tabular-nums">{fmtNum(h.mongo.server.residentMB)} MB</dd>
            {Object.entries(h.mongo.server.opcounters).map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-slate-500">{k}</dt>
                <dd className="tabular-nums">{fmtNum(v)}</dd>
              </Fragment>
            ))}
            <dt className="text-slate-500">Transactions</dt>
            <dd className="tabular-nums">
              {fmtNum(h.mongo.server.transactions.committed)} committed · {fmtNum(h.mongo.server.transactions.aborted)} aborted
            </dd>
          </dl>
        </Card>
        <Card title="Database da2" subtitle="WiredTiger compresses data on disk">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Collections</dt>
            <dd>{h.mongo.db.collections}</dd>
            <dt className="text-slate-500">Documents*</dt>
            <dd className="tabular-nums">{fmtNum(h.mongo.db.objects)}</dd>
            <dt className="text-slate-500">Data size</dt>
            <dd>{fmtBytes(h.mongo.db.dataBytes)}</dd>
            <dt className="text-slate-500">On disk</dt>
            <dd>
              {fmtBytes(h.mongo.db.storageBytes)} <span className="text-xs text-slate-400">({fmtPct(h.mongo.db.storageBytes / Math.max(1, h.mongo.db.dataBytes), 0)})</span>
            </dd>
            <dt className="text-slate-500">Indexes</dt>
            <dd>{fmtBytes(h.mongo.db.indexBytes)}</dd>
          </dl>
          <p className="mt-3 text-xs text-slate-400">* time-series events count as buckets here</p>
        </Card>
        <Card title="Redis" subtitle={`v${h.redis.version} · up ${fmtDuration(h.redis.uptimeSec)}`}>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Memory</dt>
            <dd>
              {h.redis.usedMemory} <span className="text-xs text-slate-400">(peak {h.redis.peakMemory})</span>
            </dd>
            <dt className="text-slate-500">Keys</dt>
            <dd className="tabular-nums">{fmtNum(h.redis.keys)}</dd>
            <dt className="text-slate-500">Clients</dt>
            <dd>{h.redis.clients}</dd>
            <dt className="text-slate-500">Ops / sec</dt>
            <dd className="tabular-nums">{fmtNum(h.redis.opsPerSec)}</dd>
            <dt className="text-slate-500">Persistence</dt>
            <dd>{h.redis.aof ? <Badge tone="green">AOF on</Badge> : <Badge tone="red">AOF off</Badge>}</dd>
            <dt className="text-slate-500">Hit rate</dt>
            <dd>{h.redis.hitRate === null ? "—" : fmtPct(h.redis.hitRate)}</dd>
          </dl>
        </Card>
      </div>

      <Card title={`Telemetry stream ${h.stream.name}`} subtitle="Redis Stream between the API and the ingest worker">
        <Table head={["Consumer group", "Consumers", "Pending (delivered, not ACKed)", "Lag (not yet read)", "Last delivered id", "Stream length"]}>
          {h.stream.groups.map((g) => (
            <tr key={g.name}>
              <td className="font-mono text-xs">{g.name}</td>
              <td>{g.consumers}</td>
              <td className="tabular-nums">{fmtNum(g.pending)}</td>
              <td className="tabular-nums">{g.lag === null ? "?" : fmtNum(g.lag)}</td>
              <td className="font-mono text-xs">{g.lastDeliveredId}</td>
              <td className="tabular-nums">{fmtNum(h.stream.length)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

// ---- Audit trail ---------------------------------------------------------------------------------

const ACTIONS = ["sessions_revoked", "role_changed", "status_changed", "retention_changed", "rollup_interval_changed", "rollups_rebuild_requested", "customer_erased"];

export function AuditPage() {
  const [action, setAction] = useState("");
  const q = useQuery({ queryKey: ["admin", "audit", action], queryFn: () => api<{ entries: AuditEntry[] }>(`/admin/audit${qs({ action })}`) });
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every privileged staff action (audit_log, newest 100). A regular collection, not capped: audit records must never be dropped."
        actions={
          <select value={action} onChange={(e) => setAction(e.target.value)} className={inputClass}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        }
      />
      <Card>
        {!q.data ? (
          <Loading />
        ) : q.data.entries.length ? (
          <Table head={["When", "Who", "Action", "Target", "Details"]} dense>
            {q.data.entries.map((e) => (
              <tr key={e._id}>
                <td className="whitespace-nowrap">{fmtDateTime(e.at)}</td>
                <td>
                  {e.actorName ?? e.actorId.slice(-6)} <span className="text-xs text-slate-400">{e.actorRole}</span>
                </td>
                <td>
                  <Badge tone={e.action === "customer_erased" ? "red" : "slate"}>{e.action}</Badge>
                </td>
                <td className="font-mono text-xs">
                  {e.target.type === "user" ? <TextLink to={`/staff/support/customers/${e.target.id}`}>user {e.target.id.slice(-6)}</TextLink> : `${e.target.type} ${e.target.id}`}
                </td>
                <td className="font-mono text-xs text-slate-500">{e.details ? JSON.stringify(e.details) : ""}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No entries</Empty>
        )}
      </Card>
    </>
  );
}
