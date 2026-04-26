# SONARA Scaling Preparation (Next Phase)

**Current capacity:** 0–50k active users  
**Target capacity:** 50k–500k active users

This document outlines the architecture changes needed for the next scaling phase.
**Do NOT implement yet** — prepare the ground only.

---

## 1. Queue System (Background Jobs)

### Current State
- Batch processing runs via API endpoint or cron
- Streams are processed synchronously in batches of 500

### Next Phase Architecture
```
Client → API → Redis Queue → Worker → DB
                         ↓
                    Dead Letter Queue
```

**Components:**
- **Producer:** API routes push events to Redis sorted sets (already partially in place via `queueService.ts`)
- **Worker:** Separate process (or Vercel Cron) that consumes from queue
- **Dead Letter Queue:** Failed events stored for retry/manual review

**Preparation Steps:**
- [ ] Ensure all events go through `enqueueEvent()` (already exists)
- [ ] Add event priority levels (stream=high, analytics=low)
- [ ] Create worker script that processes from queue instead of direct DB

**Files to modify:**
- `src/lib/redis/queueService.ts` — add priority, DLQ
- New: `scripts/queue-worker.ts` — standalone worker process

---

## 2. Event Streaming Architecture

### Current State
- Direct DB inserts for streams
- Batch aggregation via RPC

### Next Phase Architecture
```
Stream Event → Event Log → Multiple Consumers
                              ├── Revenue Consumer
                              ├── Stats Consumer
                              ├── Analytics Consumer
                              └── Fraud Consumer
```

**Technology Options:**
- **Supabase Realtime** (Postgres LISTEN/NOTIFY) — simplest, works now
- **Kafka/Redpanda** — for 500k+ users
- **Redis Streams** — middle ground, already have Redis

**Preparation Steps:**
- [ ] Ensure all mutations go through service layer (already done)
- [ ] Add event metadata to all inserts (source, correlation_id)
- [ ] Create event schema that consumers can parse

**Files to modify:**
- `src/types/events.ts` — add correlation_id, event_version
- Service layer — emit events after successful writes

---

## 3. Read Replicas for DB

### Current State
- Single Supabase instance (read + write)

### Next Phase Architecture
```
Writes → Primary DB
Reads  → Read Replica (Supabase Pooler)
```

**Supabase Setup:**
- Enable Supabase Pooler (connection pooling via PgBouncer)
- Use `SUPABASE_DB_URL` (direct) for writes
- Use `NEXT_PUBLIC_SUPABASE_URL` (pooler) for reads

**Preparation Steps:**
- [ ] Separate read/write clients in code
- [ ] Create `lib/supabase/read-client.ts` and `lib/supabase/write-client.ts`
- [ ] Ensure analytics queries use read client only

**Files to create:**
- `src/lib/supabase/read-client.ts` — pooler connection for reads
- `src/lib/supabase/write-client.ts` — direct connection for writes

---

## 4. Caching Strategy at Scale

### Current State
- In-memory cache + Redis cache layer
- Multi-layer cache with TTL

### Next Phase Additions
- **Edge caching** via Vercel Edge Functions
- **Stale-while-revalidate** for feed data
- **Cache warming** for top songs/artists on deploy

**Preparation Steps:**
- [ ] Add cache headers to all API responses (already partially done)
- [ ] Create cache warming script for cold starts
- [ ] Add cache invalidation on write (already done via service layer)

---

## 5. Database Sharding (500k+ Users)

### When Needed
- Single Postgres instance can handle ~100k concurrent connections
- Sharding needed only when approaching 500k+ DAU

### Strategy
- **Shard by artist_id** for song/artist data
- **Shard by user_id** for user-specific data
- **Keep revenue_events unsharded** (audit trail must be complete)

**Preparation Steps:**
- [ ] Ensure all queries include the shard key (artist_id or user_id)
- [ ] No cross-shard JOINs in hot paths
- [ ] Revenue ledger stays on single node

---

## 6. Monitoring at Scale

### Current State
- `revenueHealthMonitor.ts` — basic metrics
- `observability.ts` — API latency tracking

### Next Phase Additions
- **Prometheus metrics** export endpoint
- **Grafana dashboard** templates
- **PagerDuty/Opsgenie** integration for critical alerts
- **SLO tracking:** 99.9% revenue integrity, <300ms API p99

**Preparation Steps:**
- [ ] Create `/api/metrics` endpoint (Prometheus format)
- [ ] Define SLOs and SLIs in code
- [ ] Add alert routing (critical → PagerDuty, warning → Slack)

---

## Implementation Priority

| Phase | Users | Changes | Timeline |
|-------|-------|---------|----------|
| Current | 0–50k | What we have now | ✅ Done |
| Phase 2 | 50k–100k | Queue system, Read replicas | 2–4 weeks |
| Phase 3 | 100k–500k | Event streaming, Edge caching | 4–8 weeks |
| Phase 4 | 500k+ | Sharding, Prometheus | 8–16 weeks |

---

## Key Principle

**Core tables must never be blocked by analytics queries.**

This is already enforced by:
- `analytics` schema separation (migration 007)
- Incremental stats only (no live COUNT)
- Batch processing (not inline)
