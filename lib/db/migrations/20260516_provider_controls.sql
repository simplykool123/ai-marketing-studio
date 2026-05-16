alter table if exists user_settings
  add column if not exists provider_controls jsonb;
