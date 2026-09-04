-- Scan confirmations are atomic commands. The migration runner owns the transaction.
-- A globally unique request id is bound to its actor, operation and exact JSON payload.
create table coffee.batch_requests (
  request_id uuid primary key,
  actor_id uuid not null references coffee.profiles(id),
  kind text not null check (kind in ('START','CREATE','COMPLETE')),
  fingerprint jsonb not null,
  response jsonb not null,
  order_id uuid not null references coffee.orders(id),
  batch_id uuid unique,
  created_at timestamptz not null default now(),
  unique(batch_id,order_id),
  check ((kind in ('START','CREATE') and batch_id is not null) or
         (kind='COMPLETE' and batch_id is null))
);
alter table coffee.batch_requests enable row level security;
revoke all on coffee.batch_requests from public,coffee_guest,coffee_app;

alter table coffee.bags add column grinding_batch_id uuid;
-- Enforce single-order batches even if a future writer makes a mistake.
alter table coffee.bags add constraint bags_grinding_batch_order_fk
  foreign key(grinding_batch_id,order_id) references coffee.batch_requests(batch_id,order_id);
create index bags_grinding_batch_idx on coffee.bags(grinding_batch_id,queue_seq)
  where grinding_batch_id is not null;
create index bags_scan_eligible_idx on coffee.bags(order_id,product_barcode_snapshot,grind_id,queue_seq)
  where status in ('QUEUED','CLAIMED') and grinding_batch_id is null;

create function coffee.start_scan_batch(
  p_request_id uuid,p_order_id uuid,p_product_barcode text,p_grind_id uuid,
  p_quantity integer,p_grinder_user_id uuid
) returns jsonb language plpgsql security definer set search_path = coffee,pg_catalog,pg_temp as $$
declare
  actor coffee.profiles; receipt coffee.batch_requests; grinder coffee.grinder_users;
  b coffee.bags; ids uuid[] := '{}'; batch uuid := gen_random_uuid();
  payload jsonb; result jsonb;
begin
  select * into actor from coffee.profiles where id=coffee.user_id() and active
    and role in ('packer','admin') and station in ('packing','both') for share;
  if actor.id is null then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null then raise exception 'Invalid request id'; end if;
  payload := jsonb_build_object('order_id',p_order_id,'product_barcode',p_product_barcode,
    'grind_id',p_grind_id,'quantity',p_quantity,'grinder_user_id',p_grinder_user_id);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into receipt from coffee.batch_requests where request_id=p_request_id;
  if found then
    if receipt.actor_id<>actor.id or receipt.kind<>'START' or receipt.fingerprint is distinct from payload then
      raise exception 'Idempotency payload mismatch';
    end if;
    return receipt.response;
  end if;
  if p_quantity is null or p_quantity not between 1 and 500 then raise exception 'Invalid quantity'; end if;
  if p_product_barcode is null or p_product_barcode !~ '^[0-9]{4,32}$' then raise exception 'Invalid product barcode'; end if;
  -- Same order-first lock as transition_bag; selected-order FIFO supersedes global FIFO here only.
  perform 1 from coffee.orders where id=p_order_id and status='OPEN' for update;
  if not found then raise exception 'Order not found or not open'; end if;
  perform 1 from coffee.grind_size_codes where id=p_grind_id and active for share;
  if not found then raise exception 'Grind inactive or invalid'; end if;
  select * into grinder from coffee.grinder_users where id=p_grinder_user_id and active for share;
  if grinder.id is null then raise exception 'Select active grinder'; end if;
  for b in select * from coffee.bags
    where order_id=p_order_id and product_barcode_snapshot=p_product_barcode and grind_id=p_grind_id
      and grinding_batch_id is null
      and (status='QUEUED' or (status='CLAIMED' and (claimed_by=actor.id or actor.role='admin')))
    order by queue_seq,id limit p_quantity for update
  loop
    ids := array_append(ids,b.id);
  end loop;
  if cardinality(ids)<>p_quantity then raise exception 'Insufficient matching eligible bags'; end if;
  result := jsonb_build_object('bag_ids',to_jsonb(ids),'order_id',p_order_id,'quantity',p_quantity,'batch_id',batch);
  insert into coffee.batch_requests(request_id,actor_id,kind,fingerprint,response,order_id,batch_id)
    values(p_request_id,actor.id,'START',payload,result,p_order_id,batch);
  for b in select * from coffee.bags where id=any(ids) order by queue_seq,id loop
    update coffee.bags set status='GRINDING',grinding_batch_id=batch,claimed_by=actor.id,lease_until=null,
      grinder_user_id=grinder.id,grinder_name_snapshot=grinder.name,started_at=now(),version=version+1 where id=b.id;
    insert into coffee.job_events(bag_id,from_status,to_status,actor_id) values(b.id,b.status,'GRINDING',actor.id);
    insert into coffee.outbox_events(event_type,aggregate_id,payload)
      values('BAG_CHANGED',b.id,jsonb_build_object('status','GRINDING','batch_id',batch));
  end loop;
  insert into coffee.audit_log(actor_id,action,entity,entity_id,details)
    values(actor.id,'START_SCAN_BATCH','orders',p_order_id::text,result);
  return result;
end $$;

create function coffee.create_grinding_order(p_request_id uuid,p_lines jsonb,p_grinder_user_id uuid)
returns jsonb language plpgsql security definer set search_path = coffee,pg_catalog,pg_temp as $$
declare
  actor coffee.profiles; receipt coffee.batch_requests; grinder coffee.grinder_users;
  b coffee.bags; batch uuid := gen_random_uuid(); parent uuid;
  payload jsonb; result jsonb; line jsonb; started integer := 0;
begin
  select * into actor from coffee.profiles where id=coffee.user_id() and active
    and role in ('packer','admin') and station in ('packing','both') for share;
  if actor.id is null then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null then raise exception 'Invalid request id'; end if;
  payload := jsonb_build_object('lines',p_lines,'grinder_user_id',p_grinder_user_id);
  -- Reuse create_order's lock namespace so an old pending create cannot race adoption.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into receipt from coffee.batch_requests where request_id=p_request_id;
  if found then
    if receipt.actor_id<>actor.id or receipt.kind<>'CREATE' or receipt.fingerprint is distinct from payload then
      raise exception 'Idempotency payload mismatch';
    end if;
    return receipt.response;
  end if;
  if exists(select 1 from coffee.orders where client_request_id=p_request_id) then
    raise exception 'Request already used by an existing order';
  end if;
  select * into grinder from coffee.grinder_users where id=p_grinder_user_id and active for share;
  if grinder.id is null then raise exception 'Select active grinder'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Invalid lines'; end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Invalid lines'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(line->'quantity') is distinct from 'number' or
      (line->>'quantity')::numeric not between 1 and 99 or
      trunc((line->>'quantity')::numeric)<>(line->>'quantity')::numeric then raise exception 'Invalid quantity'; end if;
  end loop;
  -- Hold catalog rows stable while create_order performs its authoritative validation.
  perform 1 from coffee.products where id in
    (select (value->>'productId')::uuid from jsonb_array_elements(p_lines)) order by id for share;
  perform 1 from coffee.product_barcodes where barcode in
    (select value->>'productBarcode' from jsonb_array_elements(p_lines)) order by id for share;
  perform 1 from coffee.grind_size_codes where id in
    (select (value->>'grindId')::uuid from jsonb_array_elements(p_lines)) order by id for share;
  result := coffee.create_order(p_request_id,'PACKING_MANUAL',p_lines);
  parent := (result->>'id')::uuid;
  perform 1 from coffee.orders where id=parent for update;
  result := result || jsonb_build_object('batch_id',batch);
  insert into coffee.batch_requests(request_id,actor_id,kind,fingerprint,response,order_id,batch_id)
    values(p_request_id,actor.id,'CREATE',payload,result,parent,batch);
  -- Every line (including different grinds) belongs to this one manual batch.
  for b in select * from coffee.bags where order_id=parent order by queue_seq,id for update loop
    if b.status<>'QUEUED' or b.grinding_batch_id is not null then raise exception 'New order is not queued'; end if;
    update coffee.bags set status='GRINDING',grinding_batch_id=batch,claimed_by=actor.id,lease_until=null,
      grinder_user_id=grinder.id,grinder_name_snapshot=grinder.name,started_at=now(),version=version+1 where id=b.id;
    insert into coffee.job_events(bag_id,from_status,to_status,actor_id) values(b.id,b.status,'GRINDING',actor.id);
    insert into coffee.outbox_events(event_type,aggregate_id,payload)
      values('BAG_CHANGED',b.id,jsonb_build_object('status','GRINDING','batch_id',batch));
    started := started+1;
  end loop;
  if started<>(result->>'total_bags')::integer or started=0 then raise exception 'Order bag count mismatch'; end if;
  insert into coffee.audit_log(actor_id,action,entity,entity_id,details)
    values(actor.id,'CREATE_GRINDING_ORDER','orders',parent::text,jsonb_build_object('batch_id',batch,'quantity',started));
  return result;
end $$;

create function coffee.complete_scan_batch(p_request_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = coffee,pg_catalog,pg_temp as $$
declare
  actor coffee.profiles; receipt coffee.batch_requests; batch coffee.batch_requests;
  b coffee.bags; ids uuid[] := '{}'; payload jsonb; result jsonb;
begin
  select * into actor from coffee.profiles where id=coffee.user_id() and active
    and role in ('packer','admin') and station in ('packing','both') for share;
  if actor.id is null then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null then raise exception 'Invalid request id'; end if;
  payload := jsonb_build_object('batch_id',p_batch_id);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into receipt from coffee.batch_requests where request_id=p_request_id;
  if found then
    if receipt.actor_id<>actor.id or receipt.kind<>'COMPLETE' or receipt.fingerprint is distinct from payload then
      raise exception 'Idempotency payload mismatch';
    end if;
    return receipt.response;
  end if;
  select * into batch from coffee.batch_requests where batch_id=p_batch_id;
  if not found then raise exception 'Batch not found'; end if;
  -- No admin override: this command completes only the actor's own batch.
  if batch.actor_id<>actor.id then raise exception 'Batch owned by another operator'; end if;
  perform 1 from coffee.orders where id=batch.order_id for update;
  for b in select * from coffee.bags where grinding_batch_id=p_batch_id order by queue_seq,id for update loop
    if b.order_id<>batch.order_id then raise exception 'Mixed order batch'; end if;
    if b.status in ('COMPLETED','CANCELLED') then continue; end if;
    if b.status<>'GRINDING' then raise exception 'Batch contains a non-grinding bag'; end if;
    if b.claimed_by is distinct from actor.id then raise exception 'Job owned by another operator'; end if;
    ids := array_append(ids,b.id);
  end loop;
  foreach b.id in array ids loop
    perform coffee.transition_bag(b.id,'GRINDING','COMPLETED');
  end loop;
  result := jsonb_build_object('bag_ids',to_jsonb(ids),'order_id',batch.order_id,'quantity',cardinality(ids),'batch_id',p_batch_id);
  insert into coffee.batch_requests(request_id,actor_id,kind,fingerprint,response,order_id)
    values(p_request_id,actor.id,'COMPLETE',payload,result,batch.order_id);
  insert into coffee.audit_log(actor_id,action,entity,entity_id,details)
    values(actor.id,'COMPLETE_SCAN_BATCH','orders',batch.order_id::text,result);
  return result;
end $$;

revoke all on function coffee.start_scan_batch(uuid,uuid,text,uuid,integer,uuid) from public,coffee_guest,coffee_app;
revoke all on function coffee.create_grinding_order(uuid,jsonb,uuid) from public,coffee_guest,coffee_app;
revoke all on function coffee.complete_scan_batch(uuid,uuid) from public,coffee_guest,coffee_app;
grant execute on function coffee.start_scan_batch(uuid,uuid,text,uuid,integer,uuid) to coffee_app;
grant execute on function coffee.create_grinding_order(uuid,jsonb,uuid) to coffee_app;
grant execute on function coffee.complete_scan_batch(uuid,uuid) to coffee_app;
