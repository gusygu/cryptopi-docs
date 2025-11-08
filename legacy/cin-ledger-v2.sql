create or replace function strategy_aux.cin_register_acquisition(
  p_session_id bigint,
  p_move_id    bigint,
  p_asset_id   text,
  p_units      numeric,
  p_price_usdt numeric
) returns bigint as $$
declare v_lot_id bigint;
begin
  insert into strategy_aux.cin_lot(session_id, asset_id, origin_move_id, p_in_usdt, units_total, units_free)
  values (p_session_id, p_asset_id, p_move_id, p_price_usdt, p_units, p_units)
  returning lot_id into v_lot_id;
  return v_lot_id;
end;
$$ language plpgsql;
-- FIFO LOT CONSUMPTION HELPER

create or replace function strategy_aux.cin_consume_fifo_lots(
  p_session_id bigint,
  p_asset_id   text,
  p_units_need numeric  -- units to consume
) returns table(lot_id bigint, units_used numeric, p_in_usdt numeric) as $$
declare
  v_remain numeric := p_units_need;
begin
  for lot_id, units_used, p_in_usdt in
    select l.lot_id,
           least(l.units_free, v_remain) as units_used,
           l.p_in_usdt
    from strategy_aux.cin_lot l
    where l.session_id = p_session_id
      and l.asset_id = p_asset_id
      and l.units_free > 0
    order by l.lot_id asc
  loop
    exit when v_remain <= 0;
    update strategy_aux.cin_lot set units_free = units_free - units_used
     where lot_id = lot_id;
    v_remain := v_remain - units_used;
    return next;
  end loop;

  if v_remain > 1e-18 then
    raise exception 'Not enough units in lots to consume: need %, short %', p_units_need, v_remain;
  end if;
end;
$$ language plpgsql;

-- EXECUTE MOVE V2

create or replace function strategy_aux.cin_exec_move_v2(
  p_session_id        bigint,
  p_ts                timestamptz,
  p_from_asset        text,
  p_to_asset          text,
  p_executed_usdt     numeric,
  p_fee_usdt          numeric,
  p_slippage_usdt     numeric,
  p_ref_usdt_target   numeric,
  p_planned_usdt      numeric,
  p_available_usdt    numeric,
  p_price_from_usdt   numeric,    -- P_from at ts (for bucket composition / residual audit)
  p_price_to_usdt     numeric,    -- P_to at ts  (to compute units received)
  p_price_bridge_usdt numeric     -- P_bridge at ts if consuming bridge lots (usually = p_price_from_usdt)
) returns bigint as $$
declare
  v_move_id bigint;
  v_p_from numeric; v_r_from numeric;
  v_take_p numeric; v_take_r numeric;
  v_residual_after numeric;

  -- lots & trace
  v_units_needed numeric;
  v_weighted_pin numeric := 0;
  v_total_units  numeric := 0;
  v_trace_usdt   numeric := 0;
  v_profit_consumed numeric := 0;
  v_principal_hit   numeric := 0;

  rec record;
  v_dev_ref numeric;
  v_to_units numeric;
begin
  -- 0) plan deviation
  v_dev_ref := p_executed_usdt - least(coalesce(p_ref_usdt_target, p_executed_usdt), coalesce(p_available_usdt, p_executed_usdt));

  -- 1) source bucket composition (principal first, then profit)
  select principal_usdt, profit_usdt into v_p_from, v_r_from
  from strategy_aux.cin_balance
  where session_id = p_session_id and asset_id = p_from_asset
  for update;

  if not found then
    raise exception 'cin_balance row missing for session % asset %', p_session_id, p_from_asset;
  end if;

  v_take_p := least(p_executed_usdt, v_p_from);
  v_take_r := p_executed_usdt - v_take_p;

  -- 2) fees: reduce profit first, then principal
  -- (Fees are charged on source; change if your venue handles differently)
  update strategy_aux.cin_balance
  set principal_usdt = principal_usdt - v_take_p - greatest(p_fee_usdt - greatest(v_r_from - v_take_r,0), 0),
      profit_usdt    = profit_usdt    - v_take_r - least(p_fee_usdt, greatest(v_r_from - v_take_r,0))
  where session_id = p_session_id and asset_id = p_from_asset;

  -- 3) destination buckets receive composition
  insert into strategy_aux.cin_balance(session_id, asset_id, opening_principal, opening_profit, principal_usdt, profit_usdt)
  values (p_session_id, p_to_asset, 0, 0, 0, 0)
  on conflict (session_id, asset_id) do nothing;

  update strategy_aux.cin_balance
  set principal_usdt = principal_usdt + v_take_p,
      profit_usdt    = profit_usdt    + v_take_r
  where session_id = p_session_id and asset_id = p_to_asset;

  -- 4) residual audit
  select principal_usdt + profit_usdt
    into v_residual_after
  from strategy_aux.cin_balance
  where session_id = p_session_id and asset_id = p_from_asset;

  -- 5) compute units received on destination (optional: net of slippage/fees if modeled as units)
  v_to_units := case when p_price_to_usdt is null or p_price_to_usdt = 0 then null
                     else p_executed_usdt / p_price_to_usdt end;

  -- 6) if FROM asset is a bridge with lots, consume FIFO lots and compute trace
  if p_price_bridge_usdt is not null then
    v_units_needed := p_executed_usdt / p_price_bridge_usdt;

    for rec in
      select * from strategy_aux.cin_consume_fifo_lots(p_session_id, p_from_asset, v_units_needed)
    loop
      insert into strategy_aux.cin_move_lotlink(move_id, lot_id, units_used, p_in_usdt)
      values (null, rec.lot_id, rec.units_used, rec.p_in_usdt); -- temporarily null move_id; we'll patch after insert
      v_total_units := v_total_units + rec.units_used;
      v_weighted_pin := v_weighted_pin + rec.units_used * rec.p_in_usdt;
    end loop;

    if v_total_units > 0 then
      v_weighted_pin := v_weighted_pin / v_total_units;
      v_trace_usdt   := p_executed_usdt - (v_total_units * v_weighted_pin);
      -- attribute trace to profit-consumed (>0) or realized loss/principal-hit (<0)
      if v_trace_usdt > 0 then
        -- take from remaining profit bucket if available (cap at available)
        -- Here we *do not* modify buckets again; we only record attribution.
        v_profit_consumed := v_trace_usdt;
      else
        v_principal_hit := -v_trace_usdt;  -- a shortfall to hit X USDT
      end if;
    end if;
  end if;

  -- 7) write move row
  insert into strategy_aux.cin_move (
    session_id, ts, from_asset, to_asset, executed_usdt, fee_usdt, slippage_usdt,
    ref_usdt_target, planned_usdt, dev_ref_usdt,
    comp_principal_usdt, comp_profit_usdt,
    p_bridge_in_usdt, p_bridge_out_usdt, lot_units_used, trace_usdt,
    profit_consumed_usdt, principal_hit_usdt,
    to_units_received, residual_from_after
  ) values (
    p_session_id, p_ts, p_from_asset, p_to_asset, p_executed_usdt, p_fee_usdt, p_slippage_usdt,
    p_ref_usdt_target, p_planned_usdt, v_dev_ref,
    v_take_p, v_take_r,
    case when v_total_units>0 then v_weighted_pin else null end,
    p_price_bridge_usdt,
    v_total_units, coalesce(v_trace_usdt,0),
    coalesce(v_profit_consumed,0), coalesce(v_principal_hit,0),
    v_to_units, v_residual_after
  )
  returning move_id into v_move_id;

  -- 8) patch lotlink rows with move_id
  update strategy_aux.cin_move_lotlink set move_id = v_move_id where move_id is null;

  -- 9) create acquisition lot for destination (optional but recommended)
  if v_to_units is not null and v_to_units > 0 and p_price_to_usdt is not null then
    perform strategy_aux.cin_register_acquisition(p_session_id, v_move_id, p_to_asset, v_to_units, p_price_to_usdt);
  end if;

  return v_move_id;
end;
$$ language plpgsql;


-- CLOSE SESSION

create or replace function strategy_aux.cin_close_session_v2(p_session_id bigint)
returns void as $$
begin
  -- finalize closing buckets from latest mark per asset
  update strategy_aux.cin_balance b
  set closing_principal = b.principal_usdt,
      closing_profit    = m.bulk_usdt - b.principal_usdt
  from (
    select distinct on (asset_id) asset_id, bulk_usdt
    from strategy_aux.cin_mark
    where session_id = p_session_id
    order by asset_id, ts desc
  ) m
  where b.session_id = p_session_id and b.asset_id = m.asset_id;

  insert into strategy_aux.cin_imprint_luggage(
    session_id,
    imprint_principal_churn_usdt,
    imprint_profit_churn_usdt,
    imprint_generated_profit_usdt,
    imprint_trace_sum_usdt,
    imprint_devref_sum_usdt,
    luggage_total_principal_usdt,
    luggage_total_profit_usdt
  )
  select
    p_session_id,
    coalesce((select sum(comp_principal_usdt) from strategy_aux.cin_move where session_id=p_session_id),0),
    coalesce((select sum(comp_profit_usdt)    from strategy_aux.cin_move where session_id=p_session_id),0),
    -- Σ closing_profit - Σ opening_profit - Σ (fees+slippage)
    (select coalesce(sum(closing_profit),0) from strategy_aux.cin_balance where session_id=p_session_id)
    - (select coalesce(sum(opening_profit),0) from strategy_aux.cin_balance where session_id=p_session_id)
    - coalesce((select sum(fee_usdt + slippage_usdt) from strategy_aux.cin_move where session_id=p_session_id),0),
    coalesce((select sum(trace_usdt) from strategy_aux.cin_move where session_id=p_session_id),0),
    coalesce((select sum(dev_ref_usdt) from strategy_aux.cin_move where session_id=p_session_id),0),
    coalesce((select sum(closing_principal) from strategy_aux.cin_balance where session_id=p_session_id),0),
    coalesce((select sum(closing_profit)    from strategy_aux.cin_balance where session_id=p_session_id),0)
  on conflict (session_id) do update
  set imprint_principal_churn_usdt = excluded.imprint_principal_churn_usdt,
      imprint_profit_churn_usdt    = excluded.imprint_profit_churn_usdt,
      imprint_generated_profit_usdt= excluded.imprint_generated_profit_usdt,
      imprint_trace_sum_usdt       = excluded.imprint_trace_sum_usdt,
      imprint_devref_sum_usdt      = excluded.imprint_devref_sum_usdt,
      luggage_total_principal_usdt = excluded.luggage_total_principal_usdt,
      luggage_total_profit_usdt    = excluded.luggage_total_profit_usdt;

  update strategy_aux.cin_session
  set ended_at = coalesce(ended_at, now()), closed = true
  where session_id = p_session_id;
end;
$$ language plpgsql;


-- VIEWS

-- Per-move attribution summary
create or replace view strategy_aux.v_cin_move_attrib as
select
  m.session_id, m.move_id, m.ts, m.from_asset, m.to_asset,
  m.executed_usdt, m.fee_usdt, m.slippage_usdt,
  m.dev_ref_usdt, m.trace_usdt, m.profit_consumed_usdt, m.principal_hit_usdt,
  m.comp_principal_usdt, m.comp_profit_usdt,
  m.p_bridge_in_usdt, m.p_bridge_out_usdt, m.lot_units_used, m.to_units_received
from strategy_aux.cin_move m
order by m.session_id, m.move_id;

-- Residual lot inventory (what remains available to bridge)
create or replace view strategy_aux.v_cin_lot_inventory as
select session_id, asset_id,
       sum(units_free) as units_free_total,
       count(*) as lots_open
from strategy_aux.cin_lot
group by session_id, asset_id
order by session_id, asset_id;

-- Session P&L rollup
create or replace view strategy_aux.v_cin_session_rollup as
select
  il.session_id,
  il.imprint_principal_churn_usdt,
  il.imprint_profit_churn_usdt,
  il.imprint_generated_profit_usdt,
  il.imprint_trace_sum_usdt,
  il.imprint_devref_sum_usdt,
  il.luggage_total_principal_usdt,
  il.luggage_total_profit_usdt
from strategy_aux.cin_imprint_luggage il;

