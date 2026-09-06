create table coffee.ui_config_versions (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  config jsonb not null,
  created_by uuid not null references coffee.profiles(id),
  published_by uuid references coffee.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(config)='object')
);
create unique index ui_config_one_published on coffee.ui_config_versions(status) where status='PUBLISHED';
create table coffee.order_amendments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references coffee.orders(id),
  actor_id uuid not null references coffee.profiles(id),
  action text not null check (action in ('AMEND','CANCEL')),
  reason text not null check (length(trim(reason)) between 1 and 500),
  before_snapshot jsonb not null,
  after_snapshot jsonb,
  created_at timestamptz not null default now()
);
create index order_amendments_order_idx on coffee.order_amendments(order_id,created_at desc);
alter table coffee.orders add column version integer not null default 1;
create index orders_creator_bangkok_idx on coffee.orders(created_by,created_at desc);
create index bags_grinder_started_idx on coffee.bags(grinder_user_id,started_at desc) where started_at is not null;
alter table coffee.ui_config_versions enable row level security;
alter table coffee.order_amendments enable row level security;
create policy ui_config_published_read on coffee.ui_config_versions for select to coffee_app using (status='PUBLISHED' and coffee.is_active_user());
create policy order_amendments_admin_read on coffee.order_amendments for select to coffee_app using (coffee.is_admin());
revoke all on coffee.ui_config_versions,coffee.order_amendments from public,coffee_guest,coffee_app;
grant select on coffee.ui_config_versions,coffee.order_amendments to coffee_app;

insert into coffee.ui_config_versions(status,config,created_by,published_by,published_at)
select 'PUBLISHED',
 '{"theme":{"accent":"#064f4d","contrast":"#f3f7f7","density":"comfortable","buttonSize":"normal"},"menus":[{"id":"counter","label":"หน้าร้าน","visible":true,"order":0},{"id":"packing","label":"ห้องแพ็ค","visible":true,"order":1},{"id":"admin","label":"Admin Console","visible":true,"order":2}],"layouts":{"counter":{"main":"left","detail":"right"},"packing":{"main":"left","detail":"right"}},"sounds":{"queue":"alert","overdue":"alert","sla":"pulse","volume":1},"operations":{"slaGrams":500,"slaSeconds":120,"overdueSeconds":60}}'::jsonb,
 id,id,now()
from coffee.profiles where active and role='admin' order by created_at,id limit 1;

create or replace function coffee.admin_cancel_order(p_order_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=coffee as $$
declare actor coffee.profiles; b coffee.bags; before_state jsonb; o coffee.orders;
begin
  select * into actor from coffee.profiles where id=coffee.user_id() and active and role='admin';
  if actor.id is null then raise exception 'FORBIDDEN'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'Cancellation reason is required'; end if;
  select * into o from coffee.orders where id=p_order_id for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.status<>'OPEN' then raise exception 'Only open orders can be cancelled'; end if;
  select jsonb_build_object('order',to_jsonb(o),'bags',coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb)) into before_state from coffee.bags b where b.order_id=o.id;
  for b in select * from coffee.bags where order_id=o.id and status not in ('COMPLETED','CANCELLED') for update loop
    update coffee.bags set status='CANCELLED',version=version+1,claimed_by=null,lease_until=null where id=b.id;
    insert into coffee.job_events(bag_id,from_status,to_status,actor_id) values(b.id,b.status,'CANCELLED',actor.id);
    update coffee.print_jobs set status=case when status='PRINTING' then 'VERIFY_REQUIRED' else 'CANCELLED' end,lease_until=null where bag_id=b.id and status in ('PENDING','FAILED','PRINTING');
    insert into coffee.outbox_events(event_type,aggregate_id,payload) values('BAG_CHANGED',b.id,jsonb_build_object('status','CANCELLED','reason',trim(p_reason)));
  end loop;
  update coffee.orders set status='CANCELLED',version=version+1 where id=o.id returning * into o;
  insert into coffee.order_amendments(order_id,actor_id,action,reason,before_snapshot,after_snapshot) values(o.id,actor.id,'CANCEL',trim(p_reason),before_state,to_jsonb(o));
  insert into coffee.audit_log(actor_id,action,entity,entity_id,details) values(actor.id,'CANCEL','orders',o.id::text,jsonb_build_object('reason',trim(p_reason)));
  return to_jsonb(o)-'request_payload';
end $$;
revoke all on function coffee.admin_cancel_order(uuid,text) from public,coffee_guest;
grant execute on function coffee.admin_cancel_order(uuid,text) to coffee_app;
