-- Retire packaging as an operational workflow step while retaining legacy history.
create or replace function coffee.transition_bag(p_bag_id uuid,p_expected_status text,p_next_status text,p_grinder_user_id uuid default null,p_grind_id uuid default null)
returns jsonb language plpgsql security definer set search_path = coffee as $$
declare actor coffee.profiles; b coffee.bags; grinder coffee.grinder_users; allowed boolean; parent_id uuid;
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
  allowed := (b.status,p_next_status) in (('QUEUED','CLAIMED'),('CLAIMED','GRINDING'),('GRINDING','COMPLETED'));
  if allowed is not true and not (actor.role='admin' and p_next_status in ('BLOCKED','CANCELLED') and b.status not in ('COMPLETED','CANCELLED')) then raise exception 'Invalid transition'; end if;
  if b.claimed_by is not null and b.claimed_by<>actor.id and actor.role<>'admin' then raise exception 'Job owned by another operator'; end if;
  if p_next_status='CLAIMED' and actor.role<>'admin' and exists(select 1 from bags where status='QUEUED' and queue_seq<b.queue_seq) then raise exception 'Please process the earliest queue first'; end if;
  if p_next_status='GRINDING' then
    if p_grind_id is null or p_grind_id<>b.grind_id then raise exception 'Grind mismatch'; end if;
    select * into grinder from grinder_users where id=p_grinder_user_id and active;
    if grinder.id is null then raise exception 'Select active grinder'; end if;
  end if;
  update bags set status=p_next_status, version=version+1,
    claimed_by=case when p_next_status='CLAIMED' then actor.id when p_next_status in ('COMPLETED','CANCELLED') then null else claimed_by end,
    lease_until=case when p_next_status='CLAIMED' then now()+interval '5 minutes' else null end,
    grinder_user_id=case when p_next_status='GRINDING' then grinder.id else grinder_user_id end,
    grinder_name_snapshot=case when p_next_status='GRINDING' then grinder.name else grinder_name_snapshot end,
    started_at=case when p_next_status='GRINDING' then now() else started_at end,
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

do $$
declare migration_actor coffee.profiles; legacy coffee.bags;
begin
  if not exists(select 1 from coffee.bags where status in ('GROUND','PACKING')) then return; end if;
  select * into migration_actor from coffee.profiles where active and role='admin' order by created_at,id limit 1;
  if migration_actor.id is null then raise exception 'Cannot retire packaging workflow without an active admin profile'; end if;
  for legacy in select * from coffee.bags where status in ('GROUND','PACKING') for update loop
    update coffee.bags set status='COMPLETED', version=version+1, claimed_by=null, lease_until=null,
      ground_at=coalesce(ground_at,now()), completed_at=coalesce(completed_at,ground_at,now()) where id=legacy.id;
    insert into coffee.job_events(bag_id,from_status,to_status,actor_id) values(legacy.id,legacy.status,'COMPLETED',migration_actor.id);
    insert into coffee.outbox_events(event_type,aggregate_id,payload) values('BAG_CHANGED',legacy.id,jsonb_build_object('status','COMPLETED','reason','PACKAGING_WORKFLOW_RETIRED'));
    insert into coffee.audit_log(actor_id,action,entity,entity_id,details) values(migration_actor.id,'RETIRE_PACKAGING_WORKFLOW','bags',legacy.id::text,jsonb_build_object('from_status',legacy.status,'to_status','COMPLETED'));
  end loop;
  update coffee.orders o set status=case when exists(select 1 from coffee.bags b where b.order_id=o.id and b.status='COMPLETED') then 'COMPLETED' else 'CANCELLED' end
    where o.status='OPEN' and not exists(select 1 from coffee.bags b where b.order_id=o.id and b.status not in ('COMPLETED','CANCELLED'));
end $$;
