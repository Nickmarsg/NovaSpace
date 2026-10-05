-- NOVA SPACE booking and future CRM sync foundation.
-- This migration intentionally keeps the public BookingWidget RPC response shape.

-- Current public schedule: 10:00-20:00, Wednesday closed.
-- Birthday availability is service-specific and is handled by the RPCs below.
update public.business_hours
set active = false;

insert into public.business_hours (weekday, open_time, close_time, active)
select
  weekday,
  time '10:00',
  time '20:00',
  weekday <> 3
from generate_series(0, 6) as weekday
on conflict (weekday, open_time, close_time) do update set
  active = excluded.active;

-- PS5 is one independent session resource for one or two guests. It must not
-- consume VR room/station capacity. Birthday remains exclusive across the club.
update public.resources
set capacity = case slug
  when 'vr-room' then 6
  when 'vr-stations' then 6
  when 'nova-host' then 6
  when 'ps5-console' then 1
  else capacity
end
where slug in ('vr-room', 'vr-stations', 'nova-host', 'ps5-console');

delete from public.service_resources service_resources
using public.services services, public.resources resources
where service_resources.service_id = services.id
  and service_resources.resource_id = resources.id
  and services.slug in ('ps5-60-1', 'ps5-60-2', 'ps5-120-1', 'ps5-120-2')
  and resources.slug <> 'ps5-console';

insert into public.service_resources (service_id, resource_id, capacity_usage)
select services.id, resources.id, 'booking'
from public.services services
join public.resources resources on resources.slug = 'ps5-console'
where services.slug in ('ps5-60-1', 'ps5-60-2', 'ps5-120-1', 'ps5-120-2')
on conflict (service_id, resource_id) do update set
  capacity_usage = excluded.capacity_usage;

update public.service_resources service_resources
set capacity_usage = 'party_size'
from public.services services, public.resources resources
where service_resources.service_id = services.id
  and service_resources.resource_id = resources.id
  and services.slug in ('vr-30', 'vr-60', 'vr-90')
  and resources.slug in ('vr-room', 'vr-stations', 'nova-host');

insert into public.service_resources (service_id, resource_id, capacity_usage)
select services.id, resources.id, 'exclusive'
from public.services services
join public.resources resources
  on resources.slug in ('vr-room', 'vr-stations', 'ps5-console', 'nova-host')
where services.slug = 'birthday-3h'
on conflict (service_id, resource_id) do update set
  capacity_usage = excluded.capacity_usage;

update public.services
set buffer_before_minutes = 0,
    buffer_after_minutes = 0
where slug in (
  'vr-30',
  'vr-60',
  'vr-90',
  'ps5-60-1',
  'ps5-60-2',
  'ps5-120-1',
  'ps5-120-2'
);

update public.services
set duration_minutes = 180,
    buffer_before_minutes = 0,
    buffer_after_minutes = 0,
    min_people = 4,
    max_people = 10
where slug = 'birthday-3h';

-- Minimal fields needed by a later CRM connector and marketing attribution.
alter table public.bookings
  add column if not exists crm_id text,
  add column if not exists source text not null default 'site',
  add column if not exists sync_status text not null default 'pending',
  add column if not exists synced_at timestamptz,
  add column if not exists sync_error text,
  add column if not exists client_request_id text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists gclid text,
  add column if not exists landing_page text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_source_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_source_check
      check (source in ('site', 'crm', 'manager'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_sync_status_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_sync_status_check
      check (sync_status in ('pending', 'synced', 'error'));
  end if;
end;
$$;

create unique index if not exists bookings_crm_id_unique_idx
  on public.bookings (crm_id)
  where crm_id is not null;

create unique index if not exists bookings_client_request_id_unique_idx
  on public.bookings (client_request_id)
  where client_request_id is not null;

-- Keep the existing four-column frontend contract. For birthday, place counts
-- are intentionally null because the slot is exclusive rather than seat-based.
create or replace function public.get_available_slots(
  p_service_slug text,
  p_date date,
  p_party_size integer default null,
  p_step_minutes integer default 30
)
returns table(
  slot_start timestamptz,
  slot_end timestamptz,
  available_places integer,
  total_places integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_service public.services%rowtype;
  v_hours public.business_hours%rowtype;
  v_slot_local timestamp;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_buffered_start timestamptz;
  v_buffered_end timestamptz;
  v_requested_party_size integer;
  v_available_places integer;
  v_total_places integer;
  v_has_capacity boolean;
  v_birthday_time time;
begin
  select *
    into v_service
  from public.services
  where slug = p_service_slug
    and active = true;

  if not found then
    raise exception 'Unknown or inactive service: %', p_service_slug using errcode = 'P0001';
  end if;

  v_requested_party_size := coalesce(p_party_size, v_service.min_people);

  if v_requested_party_size < v_service.min_people or v_requested_party_size > v_service.max_people then
    return;
  end if;

  if p_date < (now() at time zone 'Europe/Kyiv')::date then
    return;
  end if;

  if v_service.slug = 'birthday-3h' then
    foreach v_birthday_time in array array[time '11:00', time '14:30', time '18:00']
    loop
      v_slot_local := p_date::timestamp + v_birthday_time;
      v_slot_start := v_slot_local at time zone 'Europe/Kyiv';
      v_slot_end := v_slot_start + interval '180 minutes';
      v_buffered_start := v_slot_start;
      v_buffered_end := v_slot_end;

      if v_slot_start < now() then
        continue;
      end if;

      if exists (
        select 1
        from public.blocked_times blocked_times
        where (blocked_times.resource_id is null or blocked_times.resource_id in (
          select service_resources.resource_id
          from public.service_resources service_resources
          join public.resources resources on resources.id = service_resources.resource_id
          where service_resources.service_id = v_service.id
            and resources.active = true
        ))
          and tstzrange(blocked_times.starts_at, blocked_times.ends_at, '[)')
            && tstzrange(v_buffered_start, v_buffered_end, '[)')
      ) then
        continue;
      end if;

      select coalesce(
        bool_and(
          resources.capacity - coalesce(used_resource.used_units, 0) >= public.booking_resource_units(
            service_resources.capacity_usage,
            resources.capacity,
            v_requested_party_size
          )
        ),
        false
      )
      into v_has_capacity
      from public.service_resources service_resources
      join public.resources resources on resources.id = service_resources.resource_id
      left join lateral (
        select coalesce(sum(public.booking_resource_units(
          existing_service_resources.capacity_usage,
          existing_resources.capacity,
          bookings.party_size
        )), 0)::integer as used_units
        from public.booking_resources booking_resources
        join public.bookings bookings on bookings.id = booking_resources.booking_id
        join public.services existing_service on existing_service.id = bookings.service_id
        join public.service_resources existing_service_resources
          on existing_service_resources.service_id = bookings.service_id
         and existing_service_resources.resource_id = booking_resources.resource_id
        join public.resources existing_resources on existing_resources.id = booking_resources.resource_id
        where booking_resources.resource_id = resources.id
          and bookings.status in ('pending', 'confirmed')
          and tstzrange(
            bookings.start_at - make_interval(mins => existing_service.buffer_before_minutes),
            bookings.end_at + make_interval(mins => existing_service.buffer_after_minutes),
            '[)'
          ) && tstzrange(v_buffered_start, v_buffered_end, '[)')
      ) used_resource on true
      where service_resources.service_id = v_service.id
        and resources.active = true;

      if v_has_capacity then
        slot_start := v_slot_start;
        slot_end := v_slot_end;
        available_places := null;
        total_places := null;
        return next;
      end if;
    end loop;

    return;
  end if;

  -- p_step_minutes remains in the signature for API compatibility. Public
  -- ordinary bookings always use NOVA's fixed 30-minute grid.
  for v_hours in
    select *
    from public.business_hours
    where weekday = extract(dow from p_date)::integer
      and active = true
    order by open_time
  loop
    for v_slot_local in
      select generate_series(
        p_date::timestamp + v_hours.open_time,
        p_date::timestamp + v_hours.close_time - make_interval(mins => v_service.duration_minutes),
        interval '30 minutes'
      )
    loop
      v_slot_start := v_slot_local at time zone 'Europe/Kyiv';
      v_slot_end := v_slot_start + make_interval(mins => v_service.duration_minutes);
      v_buffered_start := v_slot_start - make_interval(mins => v_service.buffer_before_minutes);
      v_buffered_end := v_slot_end + make_interval(mins => v_service.buffer_after_minutes);

      if v_slot_start < now() then
        continue;
      end if;

      if exists (
        select 1
        from public.blocked_times blocked_times
        where (blocked_times.resource_id is null or blocked_times.resource_id in (
          select service_resources.resource_id
          from public.service_resources service_resources
          join public.resources resources on resources.id = service_resources.resource_id
          where service_resources.service_id = v_service.id
            and resources.active = true
        ))
          and tstzrange(blocked_times.starts_at, blocked_times.ends_at, '[)')
            && tstzrange(v_buffered_start, v_buffered_end, '[)')
      ) then
        continue;
      end if;

      select
        coalesce(
          min(resources.capacity) filter (where service_resources.capacity_usage = 'party_size'),
          min(resources.capacity),
          0
        ),
        coalesce(
          min(resources.capacity - coalesce(used_resource.used_units, 0))
            filter (where service_resources.capacity_usage = 'party_size'),
          min(resources.capacity - coalesce(used_resource.used_units, 0)),
          0
        ),
        coalesce(
          bool_and(
            resources.capacity - coalesce(used_resource.used_units, 0) >= public.booking_resource_units(
              service_resources.capacity_usage,
              resources.capacity,
              v_requested_party_size
            )
          ),
          false
        )
      into v_total_places, v_available_places, v_has_capacity
      from public.service_resources service_resources
      join public.resources resources on resources.id = service_resources.resource_id
      left join lateral (
        select coalesce(sum(public.booking_resource_units(
          existing_service_resources.capacity_usage,
          existing_resources.capacity,
          bookings.party_size
        )), 0)::integer as used_units
        from public.booking_resources booking_resources
        join public.bookings bookings on bookings.id = booking_resources.booking_id
        join public.services existing_service on existing_service.id = bookings.service_id
        join public.service_resources existing_service_resources
          on existing_service_resources.service_id = bookings.service_id
         and existing_service_resources.resource_id = booking_resources.resource_id
        join public.resources existing_resources on existing_resources.id = booking_resources.resource_id
        where booking_resources.resource_id = resources.id
          and bookings.status in ('pending', 'confirmed')
          and tstzrange(
            bookings.start_at - make_interval(mins => existing_service.buffer_before_minutes),
            bookings.end_at + make_interval(mins => existing_service.buffer_after_minutes),
            '[)'
          ) && tstzrange(v_buffered_start, v_buffered_end, '[)')
      ) used_resource on true
      where service_resources.service_id = v_service.id
        and resources.active = true;

      if v_has_capacity then
        slot_start := v_slot_start;
        slot_end := v_slot_end;

        if v_service.slug like 'ps5-%' then
          available_places := 2;
          total_places := 2;
        else
          available_places := greatest(v_available_places, 0);
          total_places := greatest(v_total_places, 0);
        end if;

        return next;
      end if;
    end loop;
  end loop;
end;
$$;

-- Replace the seven-argument function with a backwards-compatible function
-- that has an optional idempotency key as its last argument.
drop function if exists public.create_pending_booking(text, timestamptz, text, text, integer, text, text);

create or replace function public.create_pending_booking(
  p_service_slug text,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_party_size integer,
  p_customer_email text default null,
  p_comment text default null,
  p_client_request_id text default null
)
returns public.bookings
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_service public.services%rowtype;
  v_booking public.bookings%rowtype;
  v_resource_id uuid;
  v_end_at timestamptz;
  v_buffered_start timestamptz;
  v_buffered_end timestamptz;
  v_start_local timestamp;
  v_end_local timestamp;
  v_request_id text;
  v_has_capacity boolean;
begin
  select *
    into v_service
  from public.services
  where slug = p_service_slug
    and active = true;

  if not found then
    raise exception 'Unknown or inactive service: %', p_service_slug using errcode = 'P0001';
  end if;

  if p_party_size < v_service.min_people or p_party_size > v_service.max_people then
    raise exception 'Party size is outside service limits' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) < 2 then
    raise exception 'Customer name is required' using errcode = 'P0001';
  end if;

  if length(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9+]', '', 'g')) < 7 then
    raise exception 'Customer phone is required' using errcode = 'P0001';
  end if;

  v_request_id := nullif(trim(coalesce(p_client_request_id, '')), '');

  if v_request_id is not null then
    perform pg_advisory_xact_lock(hashtext('site-request:' || v_request_id));

    select *
      into v_booking
    from public.bookings
    where client_request_id = v_request_id;

    if found then
      return v_booking;
    end if;
  end if;

  v_end_at := p_start_at + make_interval(mins => v_service.duration_minutes);
  v_buffered_start := p_start_at - make_interval(mins => v_service.buffer_before_minutes);
  v_buffered_end := v_end_at + make_interval(mins => v_service.buffer_after_minutes);
  v_start_local := p_start_at at time zone 'Europe/Kyiv';
  v_end_local := v_end_at at time zone 'Europe/Kyiv';

  if p_start_at < now() then
    raise exception 'Cannot create a booking in the past' using errcode = 'P0001';
  end if;

  if v_service.slug = 'birthday-3h' then
    if date_trunc('minute', v_start_local) <> v_start_local
       or v_start_local::time not in (time '11:00', time '14:30', time '18:00') then
      raise exception 'Birthday bookings use public start times 11:00, 14:30, or 18:00' using errcode = 'P0001';
    end if;
  else
    if extract(dow from v_start_local)::integer = 3 then
      raise exception 'Ordinary online bookings are unavailable on Wednesday' using errcode = 'P0001';
    end if;

    if date_trunc('minute', v_start_local) <> v_start_local
       or extract(minute from v_start_local)::integer % 30 <> 0 then
      raise exception 'Online bookings must start on the 30-minute grid' using errcode = 'P0001';
    end if;

    if v_start_local::date <> v_end_local::date
       or not exists (
         select 1
         from public.business_hours business_hours
         where business_hours.weekday = extract(dow from v_start_local)::integer
           and business_hours.active = true
           and v_start_local::time >= business_hours.open_time
           and v_end_local::time <= business_hours.close_time
       ) then
      raise exception 'Booking is outside public business hours' using errcode = 'P0001';
    end if;
  end if;

  for v_resource_id in
    select service_resources.resource_id
    from public.service_resources service_resources
    join public.resources resources on resources.id = service_resources.resource_id
    where service_resources.service_id = v_service.id
      and resources.active = true
    order by service_resources.resource_id
  loop
    perform pg_advisory_xact_lock(hashtext(v_resource_id::text));
  end loop;

  if not exists (
    select 1
    from public.service_resources service_resources
    join public.resources resources on resources.id = service_resources.resource_id
    where service_resources.service_id = v_service.id
      and resources.active = true
  ) then
    raise exception 'Service has no active resources' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.blocked_times blocked_times
    where (blocked_times.resource_id is null or blocked_times.resource_id in (
      select service_resources.resource_id
      from public.service_resources service_resources
      join public.resources resources on resources.id = service_resources.resource_id
      where service_resources.service_id = v_service.id
        and resources.active = true
    ))
      and tstzrange(blocked_times.starts_at, blocked_times.ends_at, '[)')
        && tstzrange(v_buffered_start, v_buffered_end, '[)')
  ) then
    raise exception 'Selected slot is blocked by manager' using errcode = 'P0001';
  end if;

  select coalesce(
    bool_and(
      resources.capacity - coalesce(used_resource.used_units, 0) >= public.booking_resource_units(
        service_resources.capacity_usage,
        resources.capacity,
        p_party_size
      )
    ),
    false
  )
  into v_has_capacity
  from public.service_resources service_resources
  join public.resources resources on resources.id = service_resources.resource_id
  left join lateral (
    select coalesce(sum(public.booking_resource_units(
      existing_service_resources.capacity_usage,
      existing_resources.capacity,
      bookings.party_size
    )), 0)::integer as used_units
    from public.booking_resources booking_resources
    join public.bookings bookings on bookings.id = booking_resources.booking_id
    join public.services existing_service on existing_service.id = bookings.service_id
    join public.service_resources existing_service_resources
      on existing_service_resources.service_id = bookings.service_id
     and existing_service_resources.resource_id = booking_resources.resource_id
    join public.resources existing_resources on existing_resources.id = booking_resources.resource_id
    where booking_resources.resource_id = resources.id
      and bookings.status in ('pending', 'confirmed')
      and tstzrange(
        bookings.start_at - make_interval(mins => existing_service.buffer_before_minutes),
        bookings.end_at + make_interval(mins => existing_service.buffer_after_minutes),
        '[)'
      ) && tstzrange(v_buffered_start, v_buffered_end, '[)')
  ) used_resource on true
  where service_resources.service_id = v_service.id
    and resources.active = true;

  if not v_has_capacity then
    raise exception 'Selected slot is no longer available' using errcode = 'P0001';
  end if;

  insert into public.bookings (
    service_id,
    customer_name,
    customer_phone,
    customer_email,
    party_size,
    start_at,
    end_at,
    status,
    comment,
    source,
    sync_status,
    client_request_id
  ) values (
    v_service.id,
    trim(p_customer_name),
    trim(p_customer_phone),
    nullif(trim(coalesce(p_customer_email, '')), ''),
    p_party_size,
    p_start_at,
    v_end_at,
    'pending',
    nullif(trim(coalesce(p_comment, '')), ''),
    'site',
    'pending',
    v_request_id
  )
  returning * into v_booking;

  insert into public.booking_resources (booking_id, resource_id)
  select v_booking.id, service_resources.resource_id
  from public.service_resources service_resources
  join public.resources resources on resources.id = service_resources.resource_id
  where service_resources.service_id = v_service.id
    and resources.active = true;

  return v_booking;
end;
$$;

-- Server-only CRM upsert. Exact start/end values are accepted intentionally;
-- the public 30-minute grid and public business hours do not apply here.
create or replace function public.upsert_crm_booking(
  p_crm_id text,
  p_service_slug text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_party_size integer,
  p_status text default 'confirmed',
  p_customer_email text default null,
  p_comment text default null,
  p_manager_note text default null,
  p_source_updated_at timestamptz default null
)
returns public.bookings
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_service public.services%rowtype;
  v_booking public.bookings%rowtype;
  v_existing_booking_id uuid;
  v_resource_id uuid;
  v_crm_id text;
  v_buffered_start timestamptz;
  v_buffered_end timestamptz;
  v_has_capacity boolean;
begin
  v_crm_id := nullif(trim(coalesce(p_crm_id, '')), '');

  if v_crm_id is null then
    raise exception 'CRM id is required' using errcode = 'P0001';
  end if;

  if p_start_at >= p_end_at then
    raise exception 'Booking start must be before end' using errcode = 'P0001';
  end if;

  if p_status not in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show') then
    raise exception 'Unsupported booking status: %', p_status using errcode = 'P0001';
  end if;

  select *
    into v_service
  from public.services
  where slug = p_service_slug;

  if not found then
    raise exception 'Unknown service: %', p_service_slug using errcode = 'P0001';
  end if;

  if p_party_size < v_service.min_people or p_party_size > v_service.max_people then
    raise exception 'Party size is outside service limits' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) < 2 then
    raise exception 'Customer name is required' using errcode = 'P0001';
  end if;

  if length(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9+]', '', 'g')) < 7 then
    raise exception 'Customer phone is required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('crm-booking:' || v_crm_id));

  select *
    into v_booking
  from public.bookings
  where crm_id = v_crm_id
  for update;

  if found then
    v_existing_booking_id := v_booking.id;

    if p_source_updated_at is not null
       and v_booking.source_updated_at is not null
       and p_source_updated_at < v_booking.source_updated_at then
      return v_booking;
    end if;
  end if;

  for v_resource_id in
    select resource_id
    from (
      select service_resources.resource_id
      from public.service_resources service_resources
      join public.resources resources on resources.id = service_resources.resource_id
      where service_resources.service_id = v_service.id
        and resources.active = true

      union

      select booking_resources.resource_id
      from public.booking_resources booking_resources
      where booking_resources.booking_id = v_existing_booking_id
    ) locked_resources
    order by resource_id
  loop
    perform pg_advisory_xact_lock(hashtext(v_resource_id::text));
  end loop;

  if not exists (
    select 1
    from public.service_resources service_resources
    join public.resources resources on resources.id = service_resources.resource_id
    where service_resources.service_id = v_service.id
      and resources.active = true
  ) then
    raise exception 'Service has no active resources' using errcode = 'P0001';
  end if;

  v_buffered_start := p_start_at - make_interval(mins => v_service.buffer_before_minutes);
  v_buffered_end := p_end_at + make_interval(mins => v_service.buffer_after_minutes);

  if p_status in ('pending', 'confirmed') then
    if exists (
      select 1
      from public.blocked_times blocked_times
      where (blocked_times.resource_id is null or blocked_times.resource_id in (
        select service_resources.resource_id
        from public.service_resources service_resources
        join public.resources resources on resources.id = service_resources.resource_id
        where service_resources.service_id = v_service.id
          and resources.active = true
      ))
        and tstzrange(blocked_times.starts_at, blocked_times.ends_at, '[)')
          && tstzrange(v_buffered_start, v_buffered_end, '[)')
    ) then
      raise exception 'CRM booking conflicts with a manager block' using errcode = 'P0001';
    end if;

    select coalesce(
      bool_and(
        resources.capacity - coalesce(used_resource.used_units, 0) >= public.booking_resource_units(
          service_resources.capacity_usage,
          resources.capacity,
          p_party_size
        )
      ),
      false
    )
    into v_has_capacity
    from public.service_resources service_resources
    join public.resources resources on resources.id = service_resources.resource_id
    left join lateral (
      select coalesce(sum(public.booking_resource_units(
        existing_service_resources.capacity_usage,
        existing_resources.capacity,
        bookings.party_size
      )), 0)::integer as used_units
      from public.booking_resources booking_resources
      join public.bookings bookings on bookings.id = booking_resources.booking_id
      join public.services existing_service on existing_service.id = bookings.service_id
      join public.service_resources existing_service_resources
        on existing_service_resources.service_id = bookings.service_id
       and existing_service_resources.resource_id = booking_resources.resource_id
      join public.resources existing_resources on existing_resources.id = booking_resources.resource_id
      where booking_resources.resource_id = resources.id
        and bookings.status in ('pending', 'confirmed')
        and (v_existing_booking_id is null or bookings.id <> v_existing_booking_id)
        and tstzrange(
          bookings.start_at - make_interval(mins => existing_service.buffer_before_minutes),
          bookings.end_at + make_interval(mins => existing_service.buffer_after_minutes),
          '[)'
        ) && tstzrange(v_buffered_start, v_buffered_end, '[)')
    ) used_resource on true
    where service_resources.service_id = v_service.id
      and resources.active = true;

    if not v_has_capacity then
      raise exception 'CRM booking conflicts with existing resource capacity' using errcode = 'P0001';
    end if;
  end if;

  if v_existing_booking_id is null then
    insert into public.bookings (
      service_id,
      customer_name,
      customer_phone,
      customer_email,
      party_size,
      start_at,
      end_at,
      status,
      comment,
      manager_note,
      crm_id,
      source,
      sync_status,
      synced_at,
      sync_error,
      source_updated_at
    ) values (
      v_service.id,
      trim(p_customer_name),
      trim(p_customer_phone),
      nullif(trim(coalesce(p_customer_email, '')), ''),
      p_party_size,
      p_start_at,
      p_end_at,
      p_status,
      nullif(trim(coalesce(p_comment, '')), ''),
      nullif(trim(coalesce(p_manager_note, '')), ''),
      v_crm_id,
      'crm',
      'synced',
      now(),
      null,
      p_source_updated_at
    )
    returning * into v_booking;
  else
    update public.bookings
    set service_id = v_service.id,
        customer_name = trim(p_customer_name),
        customer_phone = trim(p_customer_phone),
        customer_email = nullif(trim(coalesce(p_customer_email, '')), ''),
        party_size = p_party_size,
        start_at = p_start_at,
        end_at = p_end_at,
        status = p_status,
        comment = nullif(trim(coalesce(p_comment, '')), ''),
        manager_note = nullif(trim(coalesce(p_manager_note, '')), ''),
        source = 'crm',
        sync_status = 'synced',
        synced_at = now(),
        sync_error = null,
        source_updated_at = coalesce(p_source_updated_at, source_updated_at)
    where id = v_existing_booking_id
    returning * into v_booking;
  end if;

  delete from public.booking_resources
  where booking_id = v_booking.id;

  insert into public.booking_resources (booking_id, resource_id)
  select v_booking.id, service_resources.resource_id
  from public.service_resources service_resources
  join public.resources resources on resources.id = service_resources.resource_id
  where service_resources.service_id = v_service.id
    and resources.active = true;

  return v_booking;
end;
$$;

-- Demo-only catalog entries stay stored but are no longer publicly active.
update public.vr_games
set active = false
where slug in (
  'solo-flow',
  'coop-mission',
  'online-arena',
  'story-date',
  'horror-night',
  'family-quest'
);

-- Explicit RPC permissions. PostgreSQL grants function execution to PUBLIC by
-- default, so sensitive functions must be revoked even when RLS is enabled.
revoke execute on function public.get_available_slots(text, date, integer, integer)
  from public;
grant execute on function public.get_available_slots(text, date, integer, integer)
  to anon, authenticated, service_role;

revoke execute on function public.create_pending_booking(text, timestamptz, text, text, integer, text, text, text)
  from public;
grant execute on function public.create_pending_booking(text, timestamptz, text, text, integer, text, text, text)
  to anon, authenticated, service_role;

revoke execute on function public.upsert_crm_booking(text, text, timestamptz, timestamptz, text, text, integer, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.upsert_crm_booking(text, text, timestamptz, timestamptz, text, text, integer, text, text, text, text, timestamptz)
  to service_role;

revoke execute on function public.list_booking_board(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.list_booking_board(timestamptz, timestamptz)
  to authenticated, service_role;

revoke execute on function public.update_booking_status(uuid, text, text)
  from public, anon;
grant execute on function public.update_booking_status(uuid, text, text)
  to authenticated, service_role;

revoke execute on function public.add_blocked_time(timestamptz, timestamptz, text, text)
  from public, anon;
grant execute on function public.add_blocked_time(timestamptz, timestamptz, text, text)
  to authenticated, service_role;

revoke execute on function public.required_resource_ids(uuid)
  from public, anon, authenticated;
grant execute on function public.required_resource_ids(uuid)
  to service_role;

revoke execute on function public.booking_resource_units(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.booking_resource_units(text, integer, integer)
  to service_role;
