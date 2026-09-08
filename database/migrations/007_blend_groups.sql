-- Multi-SKU order groups. A group is a packing/production label, not a recipe.
alter table coffee.order_items add column if not exists blend_group_id text;
alter table coffee.order_items add column if not exists blend_group_no integer;
alter table coffee.order_items add column if not exists process_mode text;
alter table coffee.bags add column if not exists blend_group_id text;
alter table coffee.bags add column if not exists blend_group_no integer;
alter table coffee.bags add column if not exists process_mode text;

update coffee.order_items set blend_group_id=client_line_id where blend_group_id is null;
with numbered as (
  select id,row_number() over (partition by order_id order by id)::int as group_no
  from coffee.order_items
)
update coffee.order_items item set blend_group_no=numbered.group_no from numbered where item.id=numbered.id and item.blend_group_no is null;
update coffee.order_items set process_mode='GROUND' where process_mode is null;
update coffee.bags bag set blend_group_id=item.blend_group_id,blend_group_no=item.blend_group_no,process_mode=item.process_mode
from coffee.order_items item where item.id=bag.order_item_id;
update coffee.bags set blend_group_id=coalesce(blend_group_id,'legacy'),blend_group_no=coalesce(blend_group_no,1),process_mode=coalesce(process_mode,'GROUND');

alter table coffee.order_items alter column blend_group_id set not null;
alter table coffee.order_items alter column blend_group_no set not null;
alter table coffee.order_items alter column process_mode set default 'GROUND';
alter table coffee.order_items alter column process_mode set not null;
-- FK ของ grind_id ยอมรับ NULL อยู่แล้ว จึงคง FK ไว้ ปลดแค่ not null ให้ถุงเมล็ด
alter table coffee.order_items alter column grind_id drop not null;
alter table coffee.order_items add constraint order_items_process_mode_check check (process_mode in ('GROUND','WHOLE_BEAN'));
alter table coffee.bags alter column blend_group_id set not null;
alter table coffee.bags alter column blend_group_no set not null;
alter table coffee.bags alter column process_mode set default 'GROUND';
alter table coffee.bags alter column process_mode set not null;
alter table coffee.bags alter column grind_id drop not null;
alter table coffee.bags alter column grind_value_snapshot drop not null;
alter table coffee.bags add constraint bags_process_mode_check check (process_mode in ('GROUND','WHOLE_BEAN'));
create index if not exists order_items_blend_group_idx on coffee.order_items(order_id,blend_group_no);
create index if not exists bags_blend_group_idx on coffee.bags(order_id,blend_group_no,queue_seq);

create or replace function coffee.create_order(p_client_request_id uuid, p_source text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = coffee as $$
declare
  actor profiles; existing orders; new_order orders; p products; g grind_size_codes; item_id uuid; bag_row bags;
  line jsonb; group_key text; group_mode text; group_grind uuid; group_no integer; q integer; total integer := 0; bag_index integer := 0; n integer;
begin
  select * into actor from profiles where id=coffee.user_id() and active;
  if actor.id is null then raise exception 'UNAUTHORIZED'; end if;
  if p_source is null or p_source not in ('COUNTER','PACKING_MANUAL') then raise exception 'Invalid source'; end if;
  if actor.role='counter' and p_source<>'COUNTER' then raise exception 'FORBIDDEN'; end if;
  if actor.role='packer' and p_source<>'PACKING_MANUAL' then raise exception 'FORBIDDEN'; end if;
  if (p_source='COUNTER' and actor.station not in ('counter','both')) or (p_source='PACKING_MANUAL' and actor.station not in ('packing','both')) then raise exception 'FORBIDDEN'; end if;
  if p_client_request_id is null then raise exception 'Invalid request id'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,0));
  select * into existing from orders where client_request_id=p_client_request_id;
  if found then
    if existing.created_by<>actor.id or existing.request_payload is distinct from p_lines or existing.source<>p_source then raise exception 'Idempotency payload mismatch'; end if;
    return to_jsonb(existing)-'request_payload';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Invalid lines'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    q := (line->>'quantity')::integer;
    if q is null or q not between 1 and 99 then raise exception 'Invalid quantity'; end if;
    total := total+q;
    group_key := coalesce(nullif(line->>'blendGroupId',''),line->>'clientLineId');
    group_mode := coalesce(nullif(line->>'mode',''),'GROUND');
    if group_mode not in ('GROUND','WHOLE_BEAN') then raise exception 'Invalid process mode'; end if;
    if group_mode='GROUND' and (line->>'grindId') is null then raise exception 'Ground line requires a grind'; end if;
    if group_mode='WHOLE_BEAN' and ((line->>'grindId') is not null or (line->>'grindBarcode') is not null) then raise exception 'Whole-bean line cannot include a grind'; end if;
    if exists(select 1 from jsonb_array_elements(p_lines) other where coalesce(nullif(other->>'blendGroupId',''),other->>'clientLineId')=group_key and coalesce(nullif(other->>'mode',''),'GROUND')<>group_mode) then raise exception 'Blend group process mode mismatch'; end if;
    if group_mode='GROUND' and exists(select 1 from jsonb_array_elements(p_lines) other where coalesce(nullif(other->>'blendGroupId',''),other->>'clientLineId')=group_key and (other->>'grindId') is distinct from (line->>'grindId')) then raise exception 'Blend group grind mismatch'; end if;
  end loop;
  if total>500 then raise exception 'Maximum 500 bags per order'; end if;
  insert into orders(client_request_id,request_payload,source,total_bags,created_by) values(p_client_request_id,p_lines,p_source,total,actor.id) returning * into new_order;
  for line in select value from jsonb_array_elements(p_lines) loop
    group_key := coalesce(nullif(line->>'blendGroupId',''),line->>'clientLineId');
    group_mode := coalesce(nullif(line->>'mode',''),'GROUND');
    select oi.blend_group_no into group_no from order_items oi where oi.order_id=new_order.id and oi.blend_group_id=group_key limit 1;
    if group_no is null then select coalesce(max(oi.blend_group_no),0)+1 into group_no from order_items oi where oi.order_id=new_order.id; end if;
    select pr.* into p from products pr join product_barcodes pb on pb.product_id=pr.id where pr.id=(line->>'productId')::uuid and pr.active and pr.size_grams>=200 and pb.barcode=line->>'productBarcode' and pb.active;
    if p.id is null then raise exception 'Product inactive or barcode mismatch'; end if;
    g := null;
    if group_mode='GROUND' then
      select * into g from grind_size_codes where id=(line->>'grindId')::uuid and active and (
        (line->>'grindBarcode' is not null and barcode=line->>'grindBarcode') or
        (line ? 'grindBarcode' and jsonb_typeof(line->'grindBarcode')='null' and grind_value in ('5','6','7','8','9','10','11','12','13','14','15','16','17'))
      );
      if g.id is null then raise exception 'Grind inactive or barcode mismatch'; end if;
    end if;
    q := (line->>'quantity')::integer;
    insert into order_items(order_id,product_id,grind_id,quantity,client_line_id,blend_group_id,blend_group_no,process_mode) values(new_order.id,p.id,g.id,q,line->>'clientLineId',group_key,group_no,group_mode) returning id into item_id;
    for n in 1..q loop
      bag_index := bag_index+1;
      insert into bags(order_id,order_item_id,product_id,grind_id,bag_no,blend_group_id,blend_group_no,process_mode,product_name_snapshot,sku_snapshot,size_grams_snapshot,product_barcode_snapshot,grind_value_snapshot)
        values(new_order.id,item_id,p.id,g.id,bag_index,group_key,group_no,group_mode,p.name,p.sku,p.size_grams,line->>'productBarcode',g.grind_value) returning * into bag_row;
      insert into job_events(bag_id,to_status,actor_id) values(bag_row.id,'QUEUED',actor.id);
      insert into print_jobs(bag_id,payload) values(bag_row.id,to_jsonb(bag_row)||jsonb_build_object('order_no',new_order.order_no));
    end loop;
  end loop;
  insert into outbox_events(event_type,aggregate_id,payload) values('ORDER_CREATED',new_order.id,jsonb_build_object('order_id',new_order.id));
  insert into audit_log(actor_id,action,entity,entity_id) values(actor.id,'CREATE','orders',new_order.id::text);
  return to_jsonb(new_order)-'request_payload';
end $$;

create function coffee.start_scan_batch(
  p_request_id uuid,p_order_id uuid,p_product_barcode text,p_grind_id uuid,
  p_quantity integer,p_grinder_user_id uuid,p_blend_group_no integer
) returns jsonb language plpgsql security definer set search_path = coffee,pg_catalog,pg_temp as $$
declare
  actor coffee.profiles; receipt coffee.batch_requests; grinder coffee.grinder_users;
  b coffee.bags; ids uuid[] := '{}'; batch uuid := gen_random_uuid(); payload jsonb; result jsonb;
begin
  select * into actor from coffee.profiles where id=coffee.user_id() and active and role in ('packer','admin') and station in ('packing','both') for share;
  if actor.id is null then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null then raise exception 'Invalid request id'; end if;
  payload := jsonb_build_object('order_id',p_order_id,'product_barcode',p_product_barcode,'grind_id',p_grind_id,'quantity',p_quantity,'grinder_user_id',p_grinder_user_id,'blend_group_no',p_blend_group_no);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into receipt from coffee.batch_requests where request_id=p_request_id;
  if found then
    if receipt.actor_id<>actor.id or receipt.kind<>'START' or receipt.fingerprint is distinct from payload then raise exception 'Idempotency payload mismatch'; end if;
    return receipt.response;
  end if;
  if p_quantity is null or p_quantity not between 1 and 500 then raise exception 'Invalid quantity'; end if;
  if p_product_barcode is null or p_product_barcode !~ '^[0-9]{4,32}$' then raise exception 'Invalid product barcode'; end if;
  perform 1 from coffee.orders where id=p_order_id and status='OPEN' for update;
  if not found then raise exception 'Order not found or not open'; end if;
  if p_grind_id is not null then
    perform 1 from coffee.grind_size_codes where id=p_grind_id and active for share;
    if not found then raise exception 'Grind inactive or invalid'; end if;
  elsif not exists(select 1 from coffee.bags where order_id=p_order_id and product_barcode_snapshot=p_product_barcode and process_mode='WHOLE_BEAN' and (p_blend_group_no is null or blend_group_no=p_blend_group_no)) then
    raise exception 'Grind inactive or invalid';
  end if;
  select * into grinder from coffee.grinder_users where id=p_grinder_user_id and active for share;
  if grinder.id is null then raise exception 'Select active grinder'; end if;
  for b in select * from coffee.bags where order_id=p_order_id and product_barcode_snapshot=p_product_barcode and (grind_id=p_grind_id or (p_grind_id is null and process_mode='WHOLE_BEAN'))
    and (p_blend_group_no is null or blend_group_no=p_blend_group_no) and grinding_batch_id is null
    and (status='QUEUED' or (status='CLAIMED' and (claimed_by=actor.id or actor.role='admin')))
    order by queue_seq,id limit p_quantity for update loop
    ids := array_append(ids,b.id);
  end loop;
  if cardinality(ids)<>p_quantity then raise exception 'Insufficient matching eligible bags'; end if;
  result := jsonb_build_object('bag_ids',to_jsonb(ids),'order_id',p_order_id,'quantity',p_quantity,'batch_id',batch);
  if p_blend_group_no is not null then result := result || jsonb_build_object('blend_group_no',p_blend_group_no); end if;
  insert into coffee.batch_requests(request_id,actor_id,kind,fingerprint,response,order_id,batch_id) values(p_request_id,actor.id,'START',payload,result,p_order_id,batch);
  for b in select * from coffee.bags where id=any(ids) order by queue_seq,id loop
    update coffee.bags set status='GRINDING',grinding_batch_id=batch,claimed_by=actor.id,lease_until=null,grinder_user_id=grinder.id,grinder_name_snapshot=grinder.name,started_at=now(),version=version+1 where id=b.id;
    insert into coffee.job_events(bag_id,from_status,to_status,actor_id) values(b.id,b.status,'GRINDING',actor.id);
    insert into coffee.outbox_events(event_type,aggregate_id,payload) values('BAG_CHANGED',b.id,jsonb_build_object('status','GRINDING','batch_id',batch));
  end loop;
  insert into coffee.audit_log(actor_id,action,entity,entity_id,details) values(actor.id,'START_SCAN_BATCH','orders',p_order_id::text,result);
  return result;
end $$;
revoke all on function coffee.start_scan_batch(uuid,uuid,text,uuid,integer,uuid,integer) from public,coffee_guest,coffee_app;
grant execute on function coffee.start_scan_batch(uuid,uuid,text,uuid,integer,uuid,integer) to coffee_app;
