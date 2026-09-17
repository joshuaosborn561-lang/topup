-- D39 follow-up: bounce_rate stays on the outcome row and is not a verdict.
-- Project: azpapwtnrbzywlnxxecz (campaignintelligence).
-- Avoid is only 2000+ sends with zero interested.

create or replace function topup.compute_receipt_outcome(p_receipt_id uuid)
returns table (
  receipt_id uuid,
  sends int,
  interested int,
  bounces int,
  bounce_rate numeric,
  interested_per_2000 numeric,
  variant_repeat boolean,
  verdict text,
  josh_confirmed boolean
)
language plpgsql
stable
as $$
declare
  r record;
  v_sends int := 0;
  v_interested int := 0;
  v_bounces int := 0;
  v_rate numeric := 0;
  v_bounce numeric := 0;
  v_variant boolean := false;
  v_verdict text := 'unknown';
begin
  select * into r from topup.pull_receipts where topup.pull_receipts.receipt_id = p_receipt_id;
  if not found then
    return;
  end if;

  if cardinality(coalesce(r.campaign_ids, '{}')) > 0
     and to_regclass('public.sends') is not null
     and to_regclass('public.campaigns') is not null then
    select
      count(*) filter (where s.sent)::int,
      count(*) filter (where s.sent and s.lead_category_id in (1, 2, 131482))::int,
      count(*) filter (where coalesce(s.bounced, false))::int
    into v_sends, v_interested, v_bounces
    from public.campaigns c
    join public.sends s on s.campaign_id = c.id
    where c.smartlead_campaign_id = any(r.campaign_ids);

    if to_regclass('public.sequence_steps') is not null then
      select exists (
        select 1
        from (
          select
            count(*) filter (where s.sent) as vsends,
            count(*) filter (where s.sent and s.lead_category_id in (1, 2, 131482)) as vinterested
          from public.campaigns c
          join public.sends s on s.campaign_id = c.id
          left join public.sequence_steps ss on ss.id = s.sequence_step_id
          where c.smartlead_campaign_id = any(r.campaign_ids)
          group by coalesce(ss.variant_label, 'step ' || coalesce(s.step_number, ss.step_number)::text)
        ) v
        where v.vsends >= 1000 and (v.vinterested::numeric / v.vsends) * 2000 >= 1
      ) into v_variant;
    end if;
  end if;

  v_rate := case when v_sends = 0 then 0 else (v_interested::numeric / v_sends) * 2000 end;
  v_bounce := case when v_sends = 0 then 0 else v_bounces::numeric / v_sends end;

  -- bounce_rate is display-only. Josh: ignore bounce rate for verdict.
  if v_sends >= 2000 and v_interested = 0 then
    v_verdict := 'avoid';
  elsif (v_sends >= 2000 and v_rate >= 1) or coalesce(v_variant, false) then
    v_verdict := 'repeat';
  else
    v_verdict := 'unknown';
  end if;

  receipt_id := p_receipt_id;
  sends := v_sends;
  interested := v_interested;
  bounces := v_bounces;
  bounce_rate := round(v_bounce, 4);
  interested_per_2000 := round(v_rate, 2);
  variant_repeat := coalesce(v_variant, false);
  verdict := v_verdict;
  josh_confirmed := coalesce(r.josh_confirmed, false);
  return next;
end
$$;

comment on view topup.v_receipt_outcome is
  'D39: sends / interested / bounce / verdict per receipt. Lane rows use all leads in the named campaigns. bounce_rate is display only. Avoid is sends >= 2000 with 0 interested.';
