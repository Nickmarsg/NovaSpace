-- Update the existing public schedule without changing closing times or weekdays.
-- The active rows retain their current days and close_time values.
update public.business_hours
set open_time = time '11:00'
where active = true
  and open_time = time '10:00';
