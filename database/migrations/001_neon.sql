-- Neon PostgreSQL application schema. Run with the deployment database owner.
create schema coffee;
create role coffee_app nologin;
create role coffee_guest nologin;
grant coffee_app to current_user;
grant usage on schema coffee to coffee_app,coffee_guest;
create table coffee.accounts (id uuid primary key default gen_random_uuid(), password_hash text not null, created_at timestamptz not null default now());
create table coffee.sessions (token_hash text primary key, user_id uuid not null references coffee.accounts(id), created_at timestamptz not null default now(), revoked_at timestamptz);
create index sessions_user_idx on coffee.sessions(user_id);
create table coffee.login_attempts (key text primary key, attempts integer not null, reset_at timestamptz not null);
create function coffee.user_id() returns uuid language sql stable as $$ select nullif(current_setting('coffee.actor_id',true),'')::uuid $$;
create sequence coffee.order_number_seq;
create sequence coffee.queue_number_seq;

create table coffee.profiles (
  id uuid primary key references coffee.accounts(id),
  username text not null unique check (username ~ '^[a-z0-9._-]{2,60}$'),
  display_name text not null,
  role text not null check (role in ('counter','packer','admin')),
  station text not null check (station in ('counter','packing','both')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table coffee.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  size_grams integer not null check (size_grams >= 200),
  unit text not null default 'Pcs',
  product_type text not null default 'BEANS' check (product_type = 'BEANS'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table coffee.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references coffee.products(id),
  barcode text not null unique check (barcode ~ '^[0-9]{4,32}$'),
  barcode_type text not null default 'PRODUCT' check (barcode_type = 'PRODUCT'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table coffee.grind_size_codes (
  id uuid primary key default gen_random_uuid(),
  grind_value text not null unique,
  barcode text not null unique check (barcode ~ '^[0-9]{1,32}$'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table coffee.grinder_users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table coffee.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique default ('HK-' || lpad(nextval('coffee.order_number_seq')::text,8,'0')),
  client_request_id uuid not null unique,
  request_payload jsonb not null,
  source text not null check (source in ('COUNTER','PACKING_MANUAL')),
  status text not null default 'OPEN' check (status in ('OPEN','COMPLETED','CANCELLED')),
  total_bags integer not null check (total_bags > 0),
  created_by uuid not null references coffee.profiles(id),
  created_at timestamptz not null default now()
);
create table coffee.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references coffee.orders(id),
  product_id uuid not null references coffee.products(id),
  grind_id uuid not null references coffee.grind_size_codes(id),
  quantity integer not null check (quantity between 1 and 99),
  client_line_id text not null,
  unique(order_id,client_line_id)
);
create table coffee.bags (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references coffee.orders(id),
  order_item_id uuid not null references coffee.order_items(id),
  product_id uuid not null references coffee.products(id),
  grind_id uuid not null references coffee.grind_size_codes(id),
  bag_no integer not null,
  queue_seq bigint not null unique default nextval('coffee.queue_number_seq'),
  status text not null default 'QUEUED' check (status in ('QUEUED','CLAIMED','GRINDING','GROUND','PACKING','COMPLETED','BLOCKED','CANCELLED')),
  product_name_snapshot text not null,
  sku_snapshot text not null,
  size_grams_snapshot integer not null,
  product_barcode_snapshot text not null,
  grind_value_snapshot text not null,
  grinder_user_id uuid references coffee.grinder_users(id),
  grinder_name_snapshot text,
  claimed_by uuid references coffee.profiles(id),
  lease_until timestamptz,
  started_at timestamptz,
  ground_at timestamptz,
  completed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique(order_id,bag_no)
);
create index bags_status_queue_idx on coffee.bags(status,queue_seq);
create index bags_order_idx on coffee.bags(order_id);
create index bags_barcode_idx on coffee.bags(product_barcode_snapshot,status);
create table coffee.job_events (
  id uuid primary key default gen_random_uuid(),
  bag_id uuid not null references coffee.bags(id),
  from_status text,
  to_status text not null,
  actor_id uuid not null references coffee.profiles(id),
  created_at timestamptz not null default now()
);
create table coffee.print_jobs (
  id uuid primary key default gen_random_uuid(),
  bag_id uuid not null references coffee.bags(id),
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','PRINTING','PRINTED','FAILED','VERIFY_REQUIRED','CANCELLED')),
  attempts integer not null default 0,
  agent_id text,
  lease_until timestamptz,
  last_error text,
  printed_at timestamptz,
  created_at timestamptz not null default now()
);
create index print_pending_idx on coffee.print_jobs(status,created_at);
create table coffee.outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create table coffee.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references coffee.profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table coffee.app_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now()
);

create function coffee.is_active_user() returns boolean language sql stable security definer set search_path = coffee as $$
  select exists(select 1 from profiles where id=coffee.user_id() and active);
$$;
create function coffee.is_admin() returns boolean language sql stable security definer set search_path = coffee as $$
  select exists(select 1 from profiles where id=coffee.user_id() and active and role='admin');
$$;

alter table coffee.profiles enable row level security;
create policy profiles_read on coffee.profiles for select to coffee_app using (id=coffee.user_id() or coffee.is_admin());
do $$ declare t text; begin
  foreach t in array array['products','product_barcodes','grind_size_codes','grinder_users','orders','order_items','bags','job_events','print_jobs','outbox_events','app_settings'] loop
    execute format('alter table coffee.%I enable row level security',t);
    execute format('create policy read_authenticated on coffee.%I for select to coffee_app using (coffee.is_active_user())',t);
    execute format('revoke insert, update, delete on coffee.%I from coffee_app, coffee_guest',t);
  end loop;
end $$;
alter table coffee.audit_log enable row level security;
create policy audit_admin on coffee.audit_log for select to coffee_app using (coffee.is_admin());
revoke insert,update,delete on coffee.profiles, coffee.audit_log from coffee_app,coffee_guest;

do $$ declare t text; begin
  foreach t in array array['profiles','products','product_barcodes','grind_size_codes','grinder_users','orders','order_items','bags','job_events','print_jobs','outbox_events','audit_log','app_settings'] loop
    execute format('revoke all privileges on table coffee.%I from coffee_guest,coffee_app',t);
    execute format('grant select on table coffee.%I to coffee_app',t);
  end loop;
end $$;
revoke all privileges on sequence coffee.order_number_seq,coffee.queue_number_seq from coffee_guest,coffee_app;

-- NULL must not bypass comparison when retrying an existing request.
create or replace function coffee.create_order(p_client_request_id uuid, p_source text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = coffee as $$
declare
  actor profiles; existing orders; new_order orders; p products; g grind_size_codes;
  line jsonb; item_id uuid; bag_row bags; q integer; total integer := 0; bag_index integer := 0; n integer;
begin
  select * into actor from profiles where id=coffee.user_id() and active;
  if actor.id is null then raise exception 'UNAUTHORIZED'; end if;
  if p_source is null or p_source not in ('COUNTER','PACKING_MANUAL') then raise exception 'Invalid source'; end if;
  if actor.role='counter' and p_source<>'COUNTER' then raise exception 'FORBIDDEN'; end if;
  if actor.role='packer' and p_source<>'PACKING_MANUAL' then raise exception 'FORBIDDEN'; end if;
  if (p_source='COUNTER' and actor.station not in ('counter','both')) or
     (p_source='PACKING_MANUAL' and actor.station not in ('packing','both')) then raise exception 'FORBIDDEN'; end if;
  if p_client_request_id is null then raise exception 'Invalid request id'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,0));
  select * into existing from orders where client_request_id=p_client_request_id;
  if found then
    if existing.created_by<>actor.id or existing.request_payload is distinct from p_lines or existing.source<>p_source then raise exception 'Idempotency payload mismatch'; end if;
    return to_jsonb(existing)-'request_payload';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Invalid lines'; end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Invalid lines'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    q := (line->>'quantity')::integer;
    if q is null or q not between 1 and 99 then raise exception 'Invalid quantity'; end if;
    total := total+q;
  end loop;
  if total>500 then raise exception 'Maximum 500 bags per order'; end if;
  insert into orders(client_request_id,request_payload,source,total_bags,created_by)
    values(p_client_request_id,p_lines,p_source,total,actor.id) returning * into new_order;
  for line in select value from jsonb_array_elements(p_lines) loop
    select pr.* into p from products pr join product_barcodes pb on pb.product_id=pr.id
      where pr.id=(line->>'productId')::uuid and pr.active and pr.size_grams>=200 and pb.barcode=line->>'productBarcode' and pb.active;
    if p.id is null then raise exception 'Product inactive or barcode mismatch'; end if;
    select * into g from grind_size_codes where id=(line->>'grindId')::uuid and barcode=line->>'grindBarcode' and active;
    if g.id is null then raise exception 'Grind inactive or barcode mismatch'; end if;
    q := (line->>'quantity')::integer;
    insert into order_items(order_id,product_id,grind_id,quantity,client_line_id)
      values(new_order.id,p.id,g.id,q,line->>'clientLineId') returning id into item_id;
    for n in 1..q loop
      bag_index := bag_index+1;
      insert into bags(order_id,order_item_id,product_id,grind_id,bag_no,product_name_snapshot,sku_snapshot,size_grams_snapshot,product_barcode_snapshot,grind_value_snapshot)
        values(new_order.id,item_id,p.id,g.id,bag_index,p.name,p.sku,p.size_grams,line->>'productBarcode',g.grind_value) returning * into bag_row;
      insert into job_events(bag_id,to_status,actor_id) values(bag_row.id,'QUEUED',actor.id);
      insert into print_jobs(bag_id,payload) values(bag_row.id,to_jsonb(bag_row)||jsonb_build_object('order_no',new_order.order_no));
    end loop;
  end loop;
  insert into outbox_events(event_type,aggregate_id,payload) values('ORDER_CREATED',new_order.id,jsonb_build_object('order_id',new_order.id));
  insert into audit_log(actor_id,action,entity,entity_id) values(actor.id,'CREATE','orders',new_order.id::text);
  return to_jsonb(new_order)-'request_payload';
end $$;

create or replace function coffee.transition_bag(p_bag_id uuid,p_expected_status text,p_next_status text,p_grinder_user_id uuid default null,p_grind_id uuid default null)
returns jsonb language plpgsql security definer set search_path = coffee as $$
declare actor profiles; b bags; grinder grinder_users; allowed boolean; parent_id uuid;
begin
  select * into actor from profiles where id=coffee.user_id() and active and role in ('packer','admin') and station in ('packing','both');
  if actor.id is null then raise exception 'FORBIDDEN'; end if;
  -- Serialize sibling completions before checking aggregate order status.
  select order_id into parent_id from bags where id=p_bag_id;
  perform 1 from orders where id=parent_id for update;
  select * into b from bags where id=p_bag_id for update;
  if b.id is null then raise exception 'Job not found'; end if;
  if b.status is distinct from p_expected_status then raise exception 'Status changed; refresh and retry'; end if;
  if p_next_status is null then raise exception 'Invalid transition'; end if;
  allowed := (b.status,p_next_status) in (('QUEUED','CLAIMED'),('CLAIMED','GRINDING'),('GRINDING','GROUND'),('GROUND','PACKING'),('PACKING','COMPLETED'));
  if allowed is not true and not (actor.role='admin' and p_next_status in ('BLOCKED','CANCELLED') and b.status not in ('COMPLETED','CANCELLED')) then raise exception 'Invalid transition'; end if;
  if b.claimed_by is not null and b.claimed_by<>actor.id and actor.role<>'admin' then raise exception 'Job owned by another operator'; end if;
  if p_next_status='CLAIMED' and actor.role<>'admin' and exists(select 1 from bags where status='QUEUED' and queue_seq<b.queue_seq) then raise exception 'Please process the earliest queue first'; end if;
  if p_next_status='GRINDING' then
    if p_grind_id is null or p_grind_id<>b.grind_id then raise exception 'Grind mismatch'; end if;
    select * into grinder from grinder_users where id=p_grinder_user_id and active;
    if grinder.id is null then raise exception 'Select active grinder'; end if;
  end if;
  update bags set status=p_next_status, version=version+1,
    claimed_by=case when p_next_status in ('CLAIMED','PACKING') then actor.id when p_next_status in ('GROUND','COMPLETED','CANCELLED') then null else claimed_by end,
    lease_until=case when p_next_status='CLAIMED' then now()+interval '5 minutes' else null end,
    grinder_user_id=case when p_next_status='GRINDING' then grinder.id else grinder_user_id end,
    grinder_name_snapshot=case when p_next_status='GRINDING' then grinder.name else grinder_name_snapshot end,
    started_at=case when p_next_status='GRINDING' then now() else started_at end,
    ground_at=case when p_next_status='GROUND' then now() else ground_at end,
    completed_at=case when p_next_status='COMPLETED' then now() else completed_at end
    where id=b.id;
  insert into job_events(bag_id,from_status,to_status,actor_id) values(b.id,b.status,p_next_status,actor.id);
  if p_next_status='CANCELLED' then
    -- A printer may already have received an in-flight job; never assume it did not print.
    update print_jobs set status=case when status='PRINTING' then 'VERIFY_REQUIRED' else 'CANCELLED' end,
      lease_until=null
      where bag_id=b.id and status in ('PENDING','FAILED','PRINTING');
  end if;
  insert into outbox_events(event_type,aggregate_id,payload) values('BAG_CHANGED',b.id,jsonb_build_object('status',p_next_status));
  if not exists(select 1 from bags where order_id=b.order_id and status not in ('COMPLETED','CANCELLED')) then
    update orders set status=case when exists(select 1 from bags where order_id=b.order_id and status='COMPLETED') then 'COMPLETED' else 'CANCELLED' end where id=b.order_id;
  end if;
  select * into b from bags where id=b.id;
  return to_jsonb(b);
end $$;

revoke all on function coffee.create_order(uuid,text,jsonb) from public,coffee_guest;
grant execute on function coffee.create_order(uuid,text,jsonb) to coffee_app;
revoke all on function coffee.transition_bag(uuid,text,text,uuid,uuid) from public,coffee_guest;
grant execute on function coffee.transition_bag(uuid,text,text,uuid,uuid) to coffee_app;

insert into coffee.grind_size_codes(grind_value,barcode,sort_order) values
  ('6','990006',6),('8','990008',8),('10','990010',10),('12','990012',12),('15','990015',15);
insert into coffee.app_settings(key,value,description) values
  ('queue_sla_minutes','15','SLA ต่อถุง (นาที)'),
  ('station_name','"ห้องแพ็ค"','ชื่อสถานี');
