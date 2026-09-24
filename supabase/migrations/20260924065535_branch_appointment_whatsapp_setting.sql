begin;

alter table crm.branches
  add column appointment_whatsapp_enabled boolean not null default true;

comment on column crm.branches.appointment_whatsapp_enabled is
  'Whether appointment booking and rescheduling should open a prepared WhatsApp message for this center.';

commit;
