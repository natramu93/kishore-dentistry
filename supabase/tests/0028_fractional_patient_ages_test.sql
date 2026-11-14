-- Synthetic patients only. All fixtures and edits are rolled back.
begin;
do $test$
declare
  v_admin uuid := 'ab280000-0000-4000-8000-000000000001';
  v_ops uuid := 'ab280000-0000-4000-8000-000000000002';
  v_front uuid := 'ab280000-0000-4000-8000-000000000003';
  v_doctor uuid := 'ab280000-0000-4000-8000-000000000004';
  v_branch uuid;
  v_other_branch uuid;
  v_lead crm.leads%rowtype;
  v_age numeric;
  v_rejected boolean;
  v_signature text := 'crm.create_lead(uuid,text,text,text,uuid,uuid,numeric,date,text,uuid,text,text)';
begin
  if (select atttypid from pg_attribute where attrelid='crm.leads'::regclass and attname='age') <> 'numeric'::regtype then
    raise exception 'patient age is not decimal-capable';
  end if;
  if (select count(*) from pg_proc where pronamespace='crm'::regnamespace and proname='create_lead') <> 1
     or to_regprocedure(v_signature) is null then
    raise exception 'lead creation RPC is missing or ambiguous';
  end if;
  if has_function_privilege('anon',v_signature,'execute') or has_function_privilege('authenticated',v_signature,'execute')
     or not has_function_privilege('service_role',v_signature,'execute')
     or (select prosecdef from pg_proc where oid=to_regprocedure(v_signature))
     or not (select relrowsecurity from pg_class where oid='crm.leads'::regclass) then
    raise exception 'patient age migration weakened access controls';
  end if;

  insert into auth.users(id,email,raw_user_meta_data) values
    (v_admin,'age-admin@example.test','{"full_name":"Age Admin"}'),
    (v_ops,'age-ops@example.test','{"full_name":"Age Operations"}'),
    (v_front,'age-front@example.test','{"full_name":"Age Front Desk"}'),
    (v_doctor,'age-doctor@example.test','{"full_name":"Age Doctor"}');
  update crm.profiles set role='admin',is_active=true where id=v_admin;
  update crm.profiles set role='operations',is_active=true where id=v_ops;
  update crm.profiles set role='front_office',is_active=true where id=v_front;
  update crm.profiles set role='doctor',is_active=true where id=v_doctor;
  insert into crm.branches(name,code) values('Fractional Age Center','AGE28') returning id into v_branch;
  insert into crm.branches(name,code) values('Other Age Center','AGE28B') returning id into v_other_branch;
  insert into crm.user_branches(user_id,branch_id) values(v_ops,v_branch),(v_front,v_branch),(v_doctor,v_branch);
  execute 'set local role service_role';

  foreach v_age in array array[0,0.2,2.5,4.3,4.99,5,5.1,25.5,37,119.99,120]::numeric[] loop
    select * into v_lead from crm.create_lead(v_branch,'  CHILD   PATIENT ','9000000028',null,null,null,v_age,null,null,v_ops,'Master',null);
    if v_lead.age is distinct from v_age or v_lead.assignee_id<>v_ops or v_lead.title<>'Master'
       or v_lead.gender<>'male' or v_lead.name<>'Child Patient' then
      raise exception 'age %, identity or operations assignment changed on intake',v_age;
    end if;
  end loop;
  update crm.leads set age=0.2 where id=v_lead.id returning * into v_lead;
  if v_lead.age<>0.2 then raise exception 'decimal age rounded during edit'; end if;
  update crm.leads set age=4.3 where id=v_lead.id returning * into v_lead;
  if v_lead.age<>4.3 then raise exception 'decimal age lost during edit'; end if;
  update crm.leads set age=25.5, name=' baby ', title='Baby', gender=null where id=v_lead.id returning * into v_lead;
  if v_lead.age<>25.5 or v_lead.name<>'Baby' or v_lead.title<>'Baby' or v_lead.gender is not null then
    raise exception 'adult decimal age or Baby name was not preserved during edit';
  end if;
  update crm.leads set age=null where id=v_lead.id returning * into v_lead;
  if v_lead.age is not null then raise exception 'age could not be cleared'; end if;
  select * into v_lead from crm.create_lead(v_branch,'Unknown Age','9000000028',null,null,null,null,null,null,v_front);
  if v_lead.age is not null or v_lead.assignee_id<>v_front then raise exception 'optional age or legacy ten-argument intake failed'; end if;

  select * into v_lead from crm.create_lead(v_branch,'Baby','9000000028',null,null,null,0.2,null,null,v_front,'Baby',null);
  if v_lead.name<>'Baby' or v_lead.age<>0.2 or v_lead.title<>'Baby' or v_lead.gender is not null then
    raise exception 'Baby is not accepted as a standalone name';
  end if;

  foreach v_age in array array[-0.2,120.1,121,'NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric] loop
    v_rejected := false;
    begin
      perform crm.create_lead(v_branch,'Invalid Age','9000000028',null,null,null,v_age,null,null,v_ops);
    exception when invalid_parameter_value then v_rejected := true;
    end;
    if not v_rejected then raise exception 'invalid age % accepted by RPC',v_age; end if;
    v_rejected := false;
    begin
      update crm.leads set age=v_age where id=v_lead.id;
    exception when check_violation then v_rejected := true;
    end;
    if not v_rejected then raise exception 'invalid age % accepted by direct edit',v_age; end if;
  end loop;

  v_rejected := false;
  begin
    perform crm.create_lead(v_other_branch,'Wrong Branch','9000000028',null,null,null,2.5,null,null,v_ops);
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'cross-branch intake allowed'; end if;
  v_rejected := false;
  begin
    perform crm.create_lead(v_branch,'Doctor Intake','9000000028',null,null,null,2.5,null,null,v_doctor);
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'doctor intake permissions changed'; end if;
end
$test$;
select 'ok - decimal ages across the full range, Baby name, intake, edits and access controls';
rollback;
