-- Dropdown-only grind values have no barcode. Existing five codes stay unchanged.
alter table coffee.grind_size_codes alter column barcode drop not null;
insert into coffee.grind_size_codes(grind_value,barcode,sort_order)
select n::text,null,n from generate_series(5,17) n
on conflict(grind_value) do nothing;

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
    select * into g from grind_size_codes where id=(line->>'grindId')::uuid and active and (
      (line->>'grindBarcode' is not null and barcode=line->>'grindBarcode') or
      (line ? 'grindBarcode' and jsonb_typeof(line->'grindBarcode')='null' and grind_value in ('5','6','7','8','9','10','11','12','13','14','15','16','17'))
    );
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
