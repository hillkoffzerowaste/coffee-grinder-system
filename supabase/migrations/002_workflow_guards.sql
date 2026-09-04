-- Preserve existing data and RPC grants; apply after 001_initial.sql.
-- RLS does not protect TRUNCATE. Limit clients to SELECT and the explicit RPCs.
do $$ declare t text; begin
  foreach t in array array['profiles','products','product_barcodes','grind_size_codes','grinder_users','orders','order_items','bags','job_events','print_jobs','outbox_events','audit_log','app_settings'] loop
    execute format('revoke all privileges on table public.%I from anon,authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
  end loop;
end $$;
revoke all privileges on sequence public.order_number_seq,public.queue_number_seq from anon,authenticated;

create or replace function public.create_order(p_client_request_id uuid, p_source text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor profiles; existing orders; new_order orders; p products; g grind_size_codes;
  line jsonb; item_id uuid; bag_row bags; q integer; total integer := 0; bag_index integer := 0; n integer;
begin
  select * into actor from profiles where id=auth.uid() and active;
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
    if existing.created_by<>actor.id or existing.request_payload<>p_lines or existing.source<>p_source then raise exception 'Idempotency payload mismatch'; end if;
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

create or replace function public.transition_bag(p_bag_id uuid,p_expected_status text,p_next_status text,p_grinder_user_id uuid default null,p_grind_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor profiles; b bags; grinder grinder_users; allowed boolean; parent_id uuid;
begin
  select * into actor from profiles where id=auth.uid() and active and role in ('packer','admin') and station in ('packing','both');
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
