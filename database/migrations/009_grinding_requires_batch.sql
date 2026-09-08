-- transition_bag ตั้งสถานะ GRINDING ได้โดยไม่เคยเซ็ต grinding_batch_id ถุงกำพร้าจึงเกิดได้
-- จริงผ่าน API แม้หน้าเว็บจะไม่เคยเรียกเส้นทางนั้น ตั้งแต่ 005 การเข้าสถานะ GRINDING
-- ต้องผ่าน start_scan_batch ซึ่งเซ็ต batch เสมอ จึงปิดเส้นทางเก่าและล็อกเป็นกติกาของตาราง

do $$
begin
  if exists(select 1 from coffee.bags where status='GRINDING' and grinding_batch_id is null) then
    raise exception 'Legacy GRINDING bags without a batch still exist; finish them before locking this invariant';
  end if;
end $$;

create or replace function coffee.transition_bag(p_bag_id uuid,p_expected_status text,p_next_status text,p_grinder_user_id uuid default null,p_grind_id uuid default null)
returns jsonb language plpgsql security definer set search_path = coffee as $$
declare actor coffee.profiles; b coffee.bags; allowed boolean; parent_id uuid;
begin
  select * into actor from profiles where id=coffee.user_id() and active and role in ('packer','admin') and station in ('packing','both');
  if actor.id is null then raise exception 'FORBIDDEN'; end if;
  select order_id into parent_id from bags where id=p_bag_id;
  perform 1 from orders where id=parent_id for update;
  select * into b from bags where id=p_bag_id for update;
  if b.id is null then raise exception 'Job not found'; end if;
  if b.status is distinct from p_expected_status then raise exception 'Status changed; refresh and retry'; end if;
  if p_next_status is null then raise exception 'Invalid transition'; end if;
  if b.status=p_next_status then raise exception 'Invalid transition'; end if;
  -- QUEUED->CLAIMED และ CLAIMED->GRINDING ถูกถอดออก งานเริ่มบดได้ทางเดียวคือ start_scan_batch
  allowed := (b.status,p_next_status) in (('GRINDING','COMPLETED'));
  if allowed is not true and not (actor.role='admin' and p_next_status in ('BLOCKED','CANCELLED') and b.status not in ('COMPLETED','CANCELLED')) then raise exception 'Invalid transition'; end if;
  if b.claimed_by is not null and b.claimed_by<>actor.id and actor.role<>'admin' then raise exception 'Job owned by another operator'; end if;
  update bags set status=p_next_status, version=version+1,
    claimed_by=case when p_next_status in ('COMPLETED','CANCELLED') then null else claimed_by end,
    lease_until=null,
    ground_at=case when p_next_status='COMPLETED' then coalesce(ground_at,now()) else ground_at end,
    completed_at=case when p_next_status='COMPLETED' then now() else completed_at end
    where id=b.id;
  insert into job_events(bag_id,from_status,to_status,actor_id) values(b.id,b.status,p_next_status,actor.id);
  if p_next_status='CANCELLED' then
    update print_jobs set status=case when status='PRINTING' then 'VERIFY_REQUIRED' else 'CANCELLED' end,
      lease_until=null where bag_id=b.id and status in ('PENDING','FAILED','PRINTING');
  end if;
  insert into outbox_events(event_type,aggregate_id,payload) values('BAG_CHANGED',b.id,jsonb_build_object('status',p_next_status));
  if not exists(select 1 from bags where order_id=b.order_id and status not in ('COMPLETED','CANCELLED')) then
    update orders set status=case when exists(select 1 from bags where order_id=b.order_id and status='COMPLETED') then 'COMPLETED' else 'CANCELLED' end where id=b.order_id;
  end if;
  select * into b from bags where id=b.id;
  return to_jsonb(b);
end $$;

alter table coffee.bags add constraint bags_grinding_needs_batch check (status <> 'GRINDING' or grinding_batch_id is not null);
