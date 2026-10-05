create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  owner_email text not null,
  owner_secret_code text not null default 'LEE-RIM LEE-GON',
  time_zone text not null default 'Asia/Kolkata',
  slot_minutes integer not null default 30 check (slot_minutes between 15 and 180),
  opening_time time not null default '09:00',
  closing_time time not null default '17:00',
  opening_days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  notice_hours integer not null default 2 check (notice_hours >= 0)
);

insert into public.app_settings (id, owner_email, owner_secret_code, time_zone)
values (true, 'faizz9165326@gmail.com', 'LEE-RIM LEE-GON', 'Asia/Kolkata')
on conflict (id) do nothing;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete cascade,
  customer_email text not null,
  customer_name text not null check (length(trim(customer_name)) between 1 and 100),
  customer_phone text not null check (length(trim(customer_phone)) between 1 and 40),
  starts_at timestamptz not null,
  timezone text not null default 'UTC',
  duration_minutes integer not null check (duration_minutes between 15 and 180),
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists appointments_one_active_slot
  on public.appointments (starts_at)
  where status in ('pending', 'confirmed');

create index if not exists appointments_customer_start
  on public.appointments (customer_id, starts_at desc);

alter table public.app_settings enable row level security;
alter table public.appointments enable row level security;

revoke all on public.app_settings from anon, authenticated;
revoke all on public.appointments from anon;
grant insert on public.appointments to anon, authenticated;
grant select, update on public.appointments to authenticated;

drop policy if exists "Allow app settings read for owner checks" on public.app_settings;
drop policy if exists "Anyone can request an appointment" on public.appointments;

create policy "Anyone can request an appointment"
on public.appointments for insert to anon, authenticated
with check (
  status = 'pending'
  and length(trim(customer_email)) > 0
  and length(trim(customer_name)) > 0
  and length(trim(customer_phone)) > 0
  and starts_at is not null
  and (customer_id is null or customer_id = auth.uid())
);

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.app_settings settings
    where settings.id = true
      and lower(settings.owner_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create or replace function public.get_available_slots(requested_date date)
returns table (slot_start timestamptz, slot_label text, duration_minutes integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    slots.local_start at time zone settings.time_zone as slot_start,
    to_char(slots.local_start, 'FMHH12:MI AM') as slot_label,
    settings.slot_minutes as duration_minutes
  from public.app_settings settings
  cross join lateral generate_series(
    requested_date + settings.opening_time,
    requested_date + settings.closing_time - make_interval(mins => settings.slot_minutes),
    make_interval(mins => settings.slot_minutes)
  ) as slots(local_start)
  where settings.id = true
    and extract(isodow from requested_date)::smallint = any(settings.opening_days)
    and requested_date >= (now() at time zone settings.time_zone)::date
    and requested_date <= (now() at time zone settings.time_zone)::date + 90
    and slots.local_start at time zone settings.time_zone >= now() + make_interval(hours => settings.notice_hours)
    and not exists (
      select 1
      from public.appointments booked
      where booked.starts_at = slots.local_start at time zone settings.time_zone
        and booked.status in ('pending', 'confirmed')
    )
  order by slots.local_start;
$$;

revoke all on function public.get_available_slots(date) from public;
grant execute on function public.get_available_slots(date) to anon, authenticated;

create or replace function public.set_appointment_timezone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  configured_settings public.app_settings%rowtype;
begin
  select * into configured_settings from public.app_settings where id = true;
  if not found then
    raise exception 'Appointment settings are missing';
  end if;

  if not exists (
    select 1
    from public.get_available_slots((new.starts_at at time zone configured_settings.time_zone)::date) slot
    where slot.slot_start = new.starts_at
  ) then
    raise exception 'This appointment time is not available';
  end if;

  new.timezone := configured_settings.time_zone;
  new.duration_minutes := configured_settings.slot_minutes;
  return new;
end;
$$;

drop trigger if exists appointments_validate_slot on public.appointments;
create trigger appointments_validate_slot
  before insert on public.appointments
  for each row execute function public.set_appointment_timezone();

drop policy if exists "Customers and owner can read appointments" on public.appointments;
create policy "Customers and owner can read appointments"
  on public.appointments for select to authenticated
  using (customer_id = auth.uid() or public.is_owner());

drop policy if exists "Customers can book for themselves" on public.appointments;
create policy "Customers can book for themselves"
  on public.appointments for insert to authenticated
  with check (
    customer_id = auth.uid()
    and lower(customer_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and status = 'pending'
  );

drop policy if exists "Only owner can update appointments" on public.appointments;
create policy "Only owner can update appointments"
  on public.appointments for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create or replace function public.owner_list_appointments(p_secret_code text)
returns table (
  id uuid,
  starts_at timestamptz,
  timezone text,
  duration_minutes integer,
  customer_name text,
  customer_email text,
  customer_phone text,
  note text,
  status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.app_settings settings
    where settings.id = true
      and settings.owner_secret_code = p_secret_code
  ) then
    raise exception 'Invalid owner secret code';
  end if;

  return query
  select booked.id, booked.starts_at, booked.timezone, booked.duration_minutes,
    booked.customer_name, booked.customer_email, booked.customer_phone,
    booked.note, booked.status
  from public.appointments booked
  order by booked.starts_at;
end;
$$;

revoke all on function public.owner_list_appointments(text) from public, anon, authenticated;
grant execute on function public.owner_list_appointments(text) to anon, authenticated;

create or replace function public.owner_update_appointment_status(
  p_secret_code text,
  p_appointment_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_count integer;
begin
  if p_status is null or p_status not in ('confirmed', 'cancelled') then
    raise exception 'Invalid appointment status';
  end if;

  if not exists (
    select 1 from public.app_settings settings
    where settings.id = true
      and settings.owner_secret_code = p_secret_code
  ) then
    raise exception 'Invalid owner secret code';
  end if;

  update public.appointments
  set status = p_status
  where id = p_appointment_id and status = 'pending';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.owner_update_appointment_status(text, uuid, text) from public, anon, authenticated;
grant execute on function public.owner_update_appointment_status(text, uuid, text) to anon, authenticated;