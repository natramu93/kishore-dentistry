-- Staff choose appointment times, including nights and days without clinic hours.
-- This removes only the legacy hours check. Branch/doctor integrity, permissions,
-- audit history and the existing appointment records remain unchanged.
drop trigger if exists validate_appointment_availability on crm.appointments;
drop function if exists crm.validate_appointment_availability();

-- Keep branch_business_hours as descriptive data for any existing consumers.
-- It must not be used as a hard constraint on staff appointment entry.
