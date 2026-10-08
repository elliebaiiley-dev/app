# PetAdmin — Product Requirements

## Vision
A professional, friendly mobile+web SaaS for independent pet businesses (dog groomers, walkers, pet sitters, boarders) built on Expo (React Native Web). Core journey: CUSTOMER → PET → BOOKING → PAYMENT → REBOOKING.

## Users
Solo and small pet-business owners who need to run their day in under 30 seconds of app glance.

## Core features (MVP)
1. **Email + password auth** (JWT, bcrypt). Register/login/me.
2. **Onboarding wizard** — business name, type, owner, phone, services. Seeds demo data on first run.
3. **Dashboard** — today's appointments, today's revenue, outstanding payments, pets due for rebooking, upcoming week, quick Add Booking FAB.
4. **Calendar** — day & week views, time-sorted appointment cards, status-colored left bar.
5. **Customers** — searchable list, detail with contact info, pets, and unified history timeline (bookings + payments).
6. **Pets (hero feature)** — grid list + rich profile with hero image (gradient scrim), stats, owner card, medical/allergy/vaccination/behaviour cards, appointment history, rebooking CTA that generates a share message. Photos stored in Emergent Managed Object Storage.
7. **Bookings** — create flow (pick customer → pet → service → date → time → notes), detail with status chips (confirmed/completed/cancelled/no-show) and payment recording.
8. **Services** — CRUD with name/price/duration.
9. **Payments** — recorded against bookings; outstanding balances surfaced on dashboard.
10. **Rebooking** — generates personalised SMS/text message from pet + customer + business name.
11. **Paywall** — 14-day free trial, £12.99/month, UI-only (no real billing).

## Non-goals
No payroll, accounting, inventory, enterprise multi-user, real subscription billing (UI-only).

## Design
- Palette: sage green `#526A5A` on bone-white `#FDFBF7`, filled into `src/theme.ts` from `design_guidelines.json`.
- Typography: 2xl titles 24–34, rounded 20pt cards, pill-shaped CTAs, 44pt+ touch targets.
- Icons: lucide-react-native.
- Hero pet profile uses `expo-linear-gradient` scrim over `expo-image`.

## Architecture
- **Backend** FastAPI + Motor + MongoDB. Routes under `/api`. JWT (HS256, 30 days, secret enforced ≥32 chars at boot). Collections: users, businesses, memberships, invites, customers, pets, services, bookings, payments, stripe_events, checkout_sessions. UUIDs as `id`, `_id` excluded from responses. Pet photos uploaded via `/api/upload` to Emergent Object Storage, served via `/api/files/{path}` with `?token=` query auth for web.
- **Frontend** Expo Router (`app/` directory), react-query for data, keyboard-controller for forms, safe-area insets everywhere.

## Security posture (post-audit, Oct 2026)
- Stripe webhook requires a signed event; `/api/stripe/webhook` returns `503` when `STRIPE_WEBHOOK_SECRET` is unset — forged events cannot flip subscription state.
- JWT_SECRET is required at startup (no default fallback); `.env` is git-ignored across root, backend, and frontend.
- CSV export neutralises `=`, `+`, `-`, `@`, `\t`, `\r` leading characters to prevent spreadsheet formula injection.
- CORS uses an allowlist from `CORS_ALLOWED_ORIGINS`; wildcard only in dev.
- Security headers on every response: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` on HTTPS requests.
- In-memory rate limiting on `/auth/register`, `/auth/login`, `/invites/accept` (30/min per IP).
- Neutral error messages on duplicate registration and Stripe failures to prevent enumeration / internal leak.
- Password minimum length raised to 8 chars.

## Business model
14-day trial → £12.99/month subscription (UI only). Feature list on paywall screen.
