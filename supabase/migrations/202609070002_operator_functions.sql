-- Append-only operator safety helpers for the dedicated review project.

create or replace function public.admin_unbind_review_invite(p_invite_id uuid, p_expected_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.review_invites
     where id = p_invite_id and claimed_by_user_id = p_expected_user_id
     for update
  ) then
    raise exception using errcode = 'P0001', message = 'Invitation binding did not match';
  end if;
  update public.review_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = p_expected_user_id;
  update public.review_extension_tokens set revoked_at = coalesce(revoked_at, now()) where user_id = p_expected_user_id;
  update public.review_invites
     set claimed_by_user_id = null, claimed_at = null, use_count = 0
   where id = p_invite_id;
end;
$$;

revoke all on function public.admin_unbind_review_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_unbind_review_invite(uuid, uuid) to service_role;
