-- Replace expiring, single-use onboarding with the Worker-held shared invitation gate.
-- Legacy invitation rows remain only so already-created OAuth transactions can finish safely.

alter table public.review_oauth_transactions
  add column shared_invite boolean not null default false;

alter table public.review_oauth_transactions
  drop constraint if exists review_oauth_transactions_check;

alter table public.review_oauth_transactions
  add constraint review_oauth_transactions_binding_check check (
    (case when invite_id is null then 0 else 1 end) +
    (case when expected_user_id is null then 0 else 1 end) +
    (case when shared_invite then 1 else 0 end) = 1
  );

drop function public.consume_review_oauth_transaction(text);

create function public.consume_review_oauth_transaction(p_state_hash text)
returns table(id uuid, invite_id uuid, expected_user_id uuid, shared_invite boolean, encrypted_code_verifier text)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.review_oauth_transactions
     set consumed_at = now()
   where state_hash = p_state_hash
     and consumed_at is null
     and expires_at > now()
  returning id, invite_id, expected_user_id, shared_invite, encrypted_code_verifier;
$$;

drop function public.complete_review_oauth(uuid, uuid, text, text, text, text, text, timestamptz, text[]);

create function public.complete_review_oauth(
  p_invite_id uuid,
  p_expected_user_id uuid,
  p_shared_invite boolean,
  p_google_subject text,
  p_email text,
  p_display_name text,
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_access_token_expires_at timestamptz,
  p_granted_scopes text[]
)
returns table(user_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_invite public.review_invites%rowtype;
  v_subject text;
begin
  if
    (case when p_invite_id is null then 0 else 1 end) +
    (case when p_expected_user_id is null then 0 else 1 end) +
    (case when p_shared_invite then 1 else 0 end) <> 1
  then
    raise exception using errcode = 'P0001', message = 'Exactly one OAuth binding is required';
  end if;

  if p_expected_user_id is not null then
    select id, google_subject into v_user_id, v_subject
      from public.review_users where id = p_expected_user_id for update;
    if v_user_id is null or v_subject <> p_google_subject then
      raise exception using errcode = 'P0001', message = 'Reconnect must use the same Google account';
    end if;
  elsif p_shared_invite then
    select id into v_user_id
      from public.review_users where google_subject = p_google_subject for update;
    if v_user_id is null then
      insert into public.review_users (
        google_subject, email, display_name, encrypted_access_token, encrypted_refresh_token,
        access_token_expires_at, granted_scopes
      ) values (
        p_google_subject, p_email, p_display_name, p_encrypted_access_token, p_encrypted_refresh_token,
        p_access_token_expires_at, p_granted_scopes
      )
      on conflict (google_subject) do update set last_login_at = now()
      returning id into v_user_id;
    end if;
  else
    select * into v_invite from public.review_invites where id = p_invite_id for update;
    if v_invite.id is null or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'Invitation is invalid';
    end if;
    select id into v_user_id from public.review_users where google_subject = p_google_subject;
    if v_invite.claimed_by_user_id is not null then
      if v_user_id is null or v_invite.claimed_by_user_id <> v_user_id then
        raise exception using errcode = 'P0001', message = 'Invitation is bound to a different Google account';
      end if;
    else
      if v_invite.use_count >= v_invite.allowed_uses then
        raise exception using errcode = 'P0001', message = 'Invitation is no longer available';
      end if;
      if v_user_id is null then
        insert into public.review_users (
          google_subject, email, display_name, encrypted_access_token, encrypted_refresh_token,
          access_token_expires_at, granted_scopes
        ) values (
          p_google_subject, p_email, p_display_name, p_encrypted_access_token, p_encrypted_refresh_token,
          p_access_token_expires_at, p_granted_scopes
        ) returning id into v_user_id;
      end if;
      update public.review_invites
         set claimed_by_user_id = v_user_id, claimed_at = now(), use_count = use_count + 1
       where id = v_invite.id;
    end if;
  end if;

  update public.review_users
     set email = coalesce(p_email, email),
         display_name = coalesce(p_display_name, display_name),
         encrypted_access_token = p_encrypted_access_token,
         encrypted_refresh_token = coalesce(p_encrypted_refresh_token, encrypted_refresh_token),
         access_token_expires_at = p_access_token_expires_at,
         granted_scopes = p_granted_scopes,
         google_authorized_at = now(),
         last_login_at = now(),
         access_revoked_at = null
   where id = v_user_id;

  return query select v_user_id;
end;
$$;

revoke all on function public.consume_review_oauth_transaction(text) from public, anon, authenticated;
revoke all on function public.complete_review_oauth(uuid, uuid, boolean, text, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;

grant execute on function public.consume_review_oauth_transaction(text) to service_role;
grant execute on function public.complete_review_oauth(uuid, uuid, boolean, text, text, text, text, text, timestamptz, text[]) to service_role;

notify pgrst, 'reload schema';
