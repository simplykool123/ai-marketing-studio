create table if not exists blog_site_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  site_name text not null,
  site_url text not null,
  endpoint_url text not null,
  secret_hash text not null,
  encrypted_secret text not null,
  status text not null default 'active',
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create index if not exists blog_site_connections_client_id_idx
  on blog_site_connections (client_id);
