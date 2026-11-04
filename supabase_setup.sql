-- Run this once in your Supabase project:
-- Left sidebar > SQL Editor > New query > paste this > Run.

create table if not exists dashboard (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);

-- This dashboard is for personal use behind a password, so we allow the
-- app's key to read/write this one table directly.
alter table dashboard disable row level security;

-- ============================================================
--  Cloudbeds reservation-level data (separate from the Hostfully model above).
--  One row per reservation, INCLUDING cancelled / no-show rows.
--  Populated by the in-app "Upload Cloudbeds reservations" button and by
--  `npm run ingest:cloudbeds`. Re-uploading an overlapping export UPSERTS
--  on (property, guest_name, check_in, reservation_date) instead of duplicating.
-- ============================================================
create table if not exists cloudbeds_reservations (
  id                          bigint generated always as identity primary key,
  property                    text not null,
  guest_name                  text not null,
  room_number                 text,
  accommodation_total         numeric,
  amount_paid                 numeric,
  check_in                    date not null,
  check_out                   date,
  nights                      integer,
  room_type                   text,          -- canonical type (or "Multiple rooms")
  rooms_count                 integer,
  multi_room                  boolean,
  promo_code                  text,          -- parenthetical(s) stripped out of Room Type
  raw_room_type               text,          -- original Room Type string, kept verbatim
  reservation_date            date,
  channel                     text,          -- Direct / Airbnb / Expedia / Booking.com / Vrbo / ...
  collect_type                text,          -- Channel Collect / Hotel Collect / null
  raw_source                  text,
  status                      text,          -- Checked Out / Confirmed / In-House / Cancelled / No Show
  is_cancelled                boolean,
  is_no_show                  boolean,
  cancellation_date           date,
  nightly_rate                numeric,       -- accommodation_total / nights
  is_rate_outlier             boolean,       -- > $1500 or < $25 or negative: excluded from ADR, kept in revenue
  is_extended_stay            boolean,       -- Extended Stay 30+ Nights source
  is_friends_family           boolean,       -- Friends & Family promo (e.g. SOMAFAM)
  adr_eligible                boolean,       -- counts toward ADR (false for outlier / extended-stay / F&F)
  lead_time_days              integer,       -- check_in - reservation_date
  cancel_days_before_arrival  integer,       -- check_in - cancellation_date (cancelled rows only)
  updated_at                  timestamptz default now(),
  constraint cloudbeds_reservations_natural_key
    unique (property, guest_name, check_in, reservation_date)
);

-- Common filter columns.
create index if not exists idx_cloudbeds_checkin   on cloudbeds_reservations (check_in);
create index if not exists idx_cloudbeds_property  on cloudbeds_reservations (property);
create index if not exists idx_cloudbeds_status    on cloudbeds_reservations (status);

alter table cloudbeds_reservations disable row level security;
