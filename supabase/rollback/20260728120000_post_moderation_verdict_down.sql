-- Rollback for 20260728120000_post_moderation_verdict

drop trigger if exists apply_pipeline_verdict_before_insert on public.posts;
drop function if exists public.apply_pipeline_verdict();
drop function if exists public.prune_pipeline_verdicts(integer);
drop table if exists public.pipeline_verdicts;
