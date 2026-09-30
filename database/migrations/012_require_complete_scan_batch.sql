-- ห้องแพ็คต้องเริ่มงานครบทุกถุงที่ตรงกับออเดอร์/สินค้า/เบอร์บด/ชุด
-- ไม่อนุญาตให้เลือกจำนวนย่อย แม้จำนวนจะไม่เกินงานที่รออยู่
create or replace function coffee.start_scan_batch(
  p_request_id uuid,p_order_id uuid,p_product_barcode text,p_grind_id uuid,
  p_quantity integer,p_grinder_user_id uuid,p_blend_group_no integer
) returns jsonb language plpgsql security definer set search_path = coffee,pg_catalog,pg_temp as $$
declare
  actor coffee.profiles; receipt coffee.batch_requests; grinder coffee.grinder_users;
  b coffee.bags; ids uuid[] := '{}'; batch uuid := gen_random_uuid(); payload jsonb; result jsonb;
  matching_count integer;
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

  select count(*)::integer into matching_count
  from coffee.bags
  where order_id=p_order_id
    and product_barcode_snapshot=p_product_barcode
    and (grind_id=p_grind_id or (p_grind_id is null and process_mode='WHOLE_BEAN'))
    and (p_blend_group_no is null or blend_group_no=p_blend_group_no)
    and grinding_batch_id is null
    and (status='QUEUED' or (status='CLAIMED' and (claimed_by=actor.id or actor.role='admin')));
  if matching_count<>p_quantity then raise exception 'Insufficient matching eligible bags'; end if;

  for b in select * from coffee.bags where order_id=p_order_id and product_barcode_snapshot=p_product_barcode and (grind_id=p_grind_id or (p_grind_id is null and process_mode='WHOLE_BEAN'))
    and (p_blend_group_no is null or blend_group_no=p_blend_group_no) and grinding_batch_id is null
    and (status='QUEUED' or (status='CLAIMED' and (claimed_by=actor.id or actor.role='admin')))
    order by queue_seq,id for update loop
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
