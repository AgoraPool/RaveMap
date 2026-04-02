# RaveMap

RaveMap is a live product experiment for publishing underground events without exposing the exact location too early. It combines a public event feed with a gated unlock flow, so organizers can share the vibe, date, and rough meeting point publicly while keeping sensitive location details behind a code shared with attendees.

This repository is positioned as both:

- a portfolio project focused on product thinking, backend safety, and shipping an opinionated niche experience
- a real-world MVP exploring how privacy-aware event discovery could work in production

## What The Product Does

- Publishes event listings with title, summary, start time, and public location
- Protects secret event details behind an attendee unlock code
- Encrypts private payloads at rest before they ever hit the database
- Gives organizers a lightweight admin flow for creating and publishing events
- Applies brute-force protection to the unlock endpoint

## Why It Is Interesting

Most event platforms optimize for reach. RaveMap explores the opposite constraint: keeping events discoverable enough to build interest, but private enough to reduce unwanted exposure.

That makes it a strong product experiment because it sits at the intersection of:

- community tooling
- trust and access control
- security-minded backend design
- clear MVP tradeoffs

## Product Lens

The core idea is a two-layer event model:

1. Public layer: what anyone can browse
2. Private layer: what only attendees with the code can unlock

That split drives the whole system design. Public endpoints only return public metadata. Secret details are stored separately, encrypted, and revealed only after code verification succeeds.

## Current MVP Scope

- Landing page with event discovery, navigation, and FAQ sections
- Event detail pages at `/akce/[slug]`
- Unlock flow for private location data and secret notes
- Admin page at `/admin` for event creation
- Published/unpublished event control
- Security-focused backend route structure for public and admin traffic

## Engineering Highlights

- Astro SSR app deployed with Netlify
- PostgreSQL data layer with Drizzle ORM
- Zod validation on API boundaries
- `scrypt` hashing for unlock codes
- `AES-256-GCM` encryption for secret event payloads
- Rate-limiting keyed by event and hashed client IP
- Security headers configured at the platform edge

## Architecture Snapshot

### Public data flow

- homepage reads published events only
- event detail pages expose public content only
- secret content is never selected by public list/detail endpoints

### Private unlock flow

- attendee submits unlock code
- API validates request shape and slug
- server checks rate limits
- server verifies the stored `scrypt` hash
- encrypted payload is decrypted only on successful verification

### Admin flow

- organizer submits the admin form
- backend validates the shared admin secret
- event record, secret payload, and audit log are written in one transaction

## Security Decisions

- Secret event data is stored outside the public event record
- Unlock codes are never stored in plaintext
- Private payloads are encrypted before persistence
- Admin actions are protected by a shared secret in this MVP
- Database access is server-side only
- Abuse protection is built into the unlock path

The current auth model is intentionally simple for MVP speed. Multi-user organizer accounts, role separation, and richer audit controls would be the next step if the experiment expands.

## Repo Guide

```text
src/
  components/        UI sections and event list rendering
  pages/             Astro pages and API routes
  db/                schema and database client
  lib/server/        auth, crypto, validation, rate limiting, request helpers

docs/
  architecture.md
  api-reference.md
  backend-foundation.md
  database-hardening.md
  admin-usage.md

drizzle/
  SQL migrations
```

## Documentation

- Product/backend architecture: `docs/architecture.md`
- API contract details: `docs/api-reference.md`
- Security and database notes: `docs/database-hardening.md`
- Admin workflow notes: `docs/admin-usage.md`

## Runtime Notes

This project is already deployed. The repository is meant to present the product, the architecture, and the implementation decisions rather than walk through local deployment.

Sensitive runtime configuration is intentionally not committed. Production relies on private environment variables such as:

- `DATABASE_URL`
- `ADMIN_SECRET`
- `ENCRYPTION_KEY`

## Portfolio Framing

RaveMap is a useful example of how I approach product engineering:

- start from a real user constraint, not just a generic CRUD app
- shape the data model around trust boundaries
- keep the MVP small, but make the risky parts deliberate
- ship something opinionated enough to feel like a real product experiment
