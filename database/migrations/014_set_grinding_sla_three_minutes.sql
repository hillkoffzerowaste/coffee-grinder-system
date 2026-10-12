update coffee.ui_config_versions
set config=jsonb_set(config,'{operations,slaSeconds}',to_jsonb(180),false)
where status='PUBLISHED';
