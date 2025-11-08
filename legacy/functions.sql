-- =====================================================================
-- cin-aux • functions.sql  (v2)
-- Reference ledger functions: lots, execution, close/rollup
-- Safe to re-run (CREATE OR REPLACE)
-- =====================================================================

-- If your schema already exists, this is a no-op:
create schema if not exists strategy_aux;

-- ---------------------------------------------------------------------
-- 1) Register acquisition → creates a lot on destination asset
-- ---------------------------------------------------------------------
create or replace function strategy_aux.cin_register_acquisition(
  p_session_id bigint,
  p_move_id    bigint,
  p_asset_id   text,
  p_units      numeric,
  p_price_usdt numeric
) returns bigint as $$
declare
  v_lot_id bigint;
begin
  insert into strategy_aux.cin_lot(
    session_id, asset_id, origin_move_id, p_in_usdt, units_total, units_free
  ) values (
    p_session_id, p_asset_id, p_move_id, p_price_usdt, p_units, p_units
  )
  returning lot_id into v_lot_id;

  return v_lot_id;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 2) FIFO lot consumption helper
--    - Decrements units_free on lots (FIFO)
--    - Returns (lot_id, units_used, p_in_usdt) rows
-- ---------------------------------------------------------------------
create or replace function strategy_aux.cin_consume_fifo_lots(
  p_session_id bigint,
  p_asset_id   text,
  p_units_need numeric
) returns table(lot_id bigint, units_used numeric, p_in_usdt numeric) as $$
declare
  v_remain numeric := p_units_need;
  v_use    numeric;
  v_row    record;
begin
  for v_row in
    select lot_id, units_free, p_in_usdt
    from strategy_aux.cin_lot
    where session_id = p_session_id
      and asset_id   = p_asset_id
      and units_free > 0
    order by lot_id asc
  loop
    exit when v_remain <= 0;

    v_use := least(v_row.units_free, v_remain);

    create or replace function strategy_aux.cin_consume_fifo_lots(
  p_session_id bigint,
  p_asset_id   text,
  p_units_need numeric
) returns table(lot_id bigint, units_used numeric, p_in_usdt numeric) as $$
declare
  v_remain numeric := p_units_need;
  v_use    numeric;
  v_row    record;
begin
  for v_row in
    select l.lot_id, l.units_free, l.p_in_usdt
    from strategy_aux.cin_lot as l
    where l.session_id = p_session_id
      and l.asset_id   = p_asset_id
      and l.units_free > 0
    order by l.created_at, l.lot_id
  loop
    exit when v_remain <= 0;

    v_use := least(v_row.units_free, v_remain);

    update strategy_aux.cin_lot as l
       set units_free = l.units_free - v_use
     where l.lot_id = v_row.lot_id;

    lot_id     := v_row.lot_id;
    units_used := v_use;
    p_in_usdt  := v_row.p_in_usdt;
    v_remain   := v_remain - v_use;

    return next;
  end loop;

  if v_remain > 0 then
    raise exception
      'Not enough units in lots to consume: need %, short %', p_units_need, v_remain;
  end if;

  return;
end;
$$ language plpgsql;


    v_remain := v_remain - v_use;

    lot_id     := v_row.lot_id;
    units_used := v_use;
    p_in_usdt  := v_row.p_in_usdt;
    return next;
  end loop;

  if v_remain > 1e-18 then
    raise exception 'Not enough units in lots to consume for %: need %, shortage %',
      p_asset_id, p_units_need, v_remain;
  end if;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 3) Execute move (v2)
--    - Updates source/destination buckets (principal/profit)
--    - Computes dev_ref, lots consumption, bridge trace, attribution
--    - Creates destination acquisition lot
--    - Writes cin_move + cin_move_lotlink rows
-- ---------------------------------------------------------------------
create or replace function strategy_aux.cin_exec_move_v2(
  p_session_id        bigint,
  p_ts                timestamptz,
  p_from_asset        text,
  p_to_asset          text,
  p_executed_usdt     numeric,
  p_fee_usdt          numeric,
  p_slippage_usdt     numeric,
  p_ref_usdt_target   numeric,    -- nullable
  p_planned_usdt      numeric,    -- nullable
  p_available_usdt    numeric,    -- nullable
  p_price_from_usdt   numeric,    -- USDT per FROM unit at ts (nullable if not needed)
  p_price_to_usdt     numeric,    -- USDT per TO unit at ts   (nullable if not needed)
  p_price_bridge_usdt numeric     -- USDT per BRIDGE unit (usually = p_price_from_usdt; nullable to skip lot logic)
) returns bigint as $$
declare
  v_move_id bigint;

  -- source bucket snapshot
  v_p_from numeric;
  v_r_from numeric;

  -- composition for the move
  v_take_p numeric;
  v_take_r numeric;

  -- residual bulk after move (audit)
  v_residual_after numeric;

  -- plan deviation
  v_dev_ref numeric;

  -- destination units received
  v_to_units numeric;

  -- lot consumption bookkeeping
  v_units_needed numeric;
  v_weighted_pin numeric := 0;  -- weighted average entry price across consumed lots
  v_total_units  numeric := 0;
  v_trace_usdt   numeric := 0;
  v_profit_consumed numeric := 0;
  v_principal_hit   numeric := 0;

  -- arrays to store lot links (so we can insert after we have move_id)
  v_lot_ids   bigint[]  := '{}';
  v_lot_units numeric[] := '{}';
  v_lot_pins  numeric[] := '{}';

  rec record;
  i int;
begin
  -- 0) plan deviation (expected vs real)
  v_dev_ref := p_executed_usdt
               - least(coalesce(p_ref_usdt_target, p_executed_usdt),
                       coalesce(p_available_usdt,  p_executed_usdt));

  -- 1) read & lock source buckets
  select principal_usdt, profit_usdt
    into v_p_from, v_r_from
  from strategy_aux.cin_balance
  where session_id = p_session_id
    and asset_id   = p_from_asset
  for update;

  if not found then
    raise exception 'cin_balance missing for session % asset %', p_session_id, p_from_asset;
  end if;

  -- 2) composition: principal first, then profit
  v_take_p := least(p_executed_usdt, v_p_from);
  v_take_r := p_executed_usdt - v_take_p;

  -- 3) apply fees on source (profit first, then principal)
  update strategy_aux.cin_balance
     set principal_usdt = principal_usdt - v_take_p - greatest(p_fee_usdt - greatest(v_r_from - v_take_r, 0), 0),
         profit_usdt    = profit_usdt    - v_take_r - least(p_fee_usdt, greatest(v_r_from - v_take_r, 0))
   where session_id = p_session_id
     and asset_id   = p_from_asset;

  -- 4) ensure destination row exists; credit composition
  insert into strategy_aux.cin_balance(session_id, asset_id, opening_principal, opening_profit, principal_usdt, profit_usdt)
  values (p_session_id, p_to_asset, 0, 0, 0, 0)
  on conflict (session_id, asset_id) do nothing;

  update strategy_aux.cin_balance
     set principal_usdt = principal_usdt + v_take_p,
         profit_usdt    = profit_usdt    + v_take_r
   where session_id = p_session_id
     and asset_id   = p_to_asset;

  -- 5) residual after move (audit)
  select principal_usdt + profit_usdt
    into v_residual_after
  from strategy_aux.cin_balance
  where session_id = p_session_id
    and asset_id   = p_from_asset;

  -- 6) destination units (optional)
  if p_price_to_usdt is not null and p_price_to_usdt <> 0 then
    v_to_units := p_executed_usdt / p_price_to_usdt;
  end if;

  -- 7) Bridge-lot consumption & trace
  if p_price_bridge_usdt is not null and p_price_bridge_usdt <> 0 then
    v_units_needed := p_executed_usdt / p_price_bridge_usdt;

    for rec in
      select * from strategy_aux.cin_consume_fifo_lots(p_session_id, p_from_asset, v_units_needed)
    loop
      -- collect arrays for later link insertion
      v_lot_ids   := array_append(v_lot_ids,   rec.lot_id);
      v_lot_units := array_append(v_lot_units, rec.units_used);
      v_lot_pins  := array_append(v_lot_pins,  rec.p_in_usdt);

      -- weighted entry price
      v_total_units  := v_total_units + rec.units_used;
      v_weighted_pin := v_weighted_pin + rec.units_used * rec.p_in_usdt;
    end loop;

    if v_total_units > 0 then
      v_weighted_pin := v_weighted_pin / v_total_units;
      -- trace_usdt = X - (q * p_in) = executed_usdt - (units_needed * pin_weighted)
      v_trace_usdt := p_executed_usdt - (v_total_units * v_weighted_pin);

      if v_trace_usdt > 0 then
        v_profit_consumed := v_trace_usdt;  -- appreciation "pays" part of X
      elsif v_trace_usdt < 0 then
        v_principal_hit := -v_trace_usdt;   -- depreciation forces extra value
      end if;
    end if;
  end if;

  -- 8) write move row
  insert into strategy_aux.cin_move (
    session_id, ts, from_asset, to_asset,
    executed_usdt, fee_usdt, slippage_usdt,
    ref_usdt_target, planned_usdt, dev_ref_usdt,
    comp_principal_usdt, comp_profit_usdt,
    p_bridge_in_usdt, p_bridge_out_usdt, lot_units_used, trace_usdt,
    profit_consumed_usdt, principal_hit_usdt,
    to_units_received, residual_from_after
  ) values (
    p_session_id, p_ts, p_from_asset, p_to_asset,
    p_executed_usdt, p_fee_usdt, p_slippage_usdt,
    p_ref_usdt_target, p_planned_usdt, v_dev_ref,
    v_take_p, v_take_r,
    case when v_total_units>0 then v_weighted_pin else null end,
    p_price_bridge_usdt, v_total_units, coalesce(v_trace_usdt,0),
    coalesce(v_profit_consumed,0), coalesce(v_principal_hit,0),
    v_to_units, v_residual_after
  ) returning move_id into v_move_id;

  -- 9) insert lot links (if any)
  if array_length(v_lot_ids,1) is not null then
    for i in array_lower(v_lot_ids,1)..array_upper(v_lot_ids,1) loop
      insert into strategy_aux.cin_move_lotlink(move_id, lot_id, units_used, p_in_usdt)
      values (v_move_id, v_lot_ids[i], v_lot_units[i], v_lot_pins[i]);
    end loop;
  end if;

  -- 10) create destination acquisition lot (optional but recommended)
  if v_to_units is not null and v_to_units > 0 and p_price_to_usdt is not null then
    perform strategy_aux.cin_register_acquisition(
      p_session_id, v_move_id, p_to_asset, v_to_units, p_price_to_usdt
    );
  end if;

  return v_move_id;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 4) Close session (v2): mark → imprint/luggage rollup → seal session
-- ---------------------------------------------------------------------
create or replace function strategy_aux.cin_close_session_v2(
  p_session_id bigint
) returns void as $$
begin
  -- set closing buckets using latest mark per asset
  update strategy_aux.cin_balance b
     set closing_principal = b.principal_usdt,
         closing_profit    = m.bulk_usdt - b.principal_usdt
  from (
    select distinct on (asset_id) asset_id, bulk_usdt
    from strategy_aux.cin_mark
    where session_id = p_session_id
    order by asset_id, ts desc
  ) m
  where b.session_id = p_session_id
    and b.asset_id   = m.asset_id;

  -- rollup
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
    coalesce((select sum(comp_principal_usdt) from strategy_aux.cin_move where session_id = p_session_id),0),
    coalesce((select sum(comp_profit_usdt)    from strategy_aux.cin_move where session_id = p_session_id),0),
    -- Σ closing_profit - Σ opening_profit - Σ (fees+slippage)
    (select coalesce(sum(closing_profit),0) from strategy_aux.cin_balance where session_id = p_session_id)
      - (select coalesce(sum(opening_profit),0) from strategy_aux.cin_balance where session_id = p_session_id)
      - coalesce((select sum(fee_usdt + slippage_usdt) from strategy_aux.cin_move where session_id = p_session_id),0),
    coalesce((select sum(trace_usdt)    from strategy_aux.cin_move where session_id = p_session_id),0),
    coalesce((select sum(dev_ref_usdt)  from strategy_aux.cin_move where session_id = p_session_id),0),
    coalesce((select sum(closing_principal) from strategy_aux.cin_balance where session_id = p_session_id),0),
    coalesce((select sum(closing_profit)    from strategy_aux.cin_balance where session_id = p_session_id),0)
  on conflict (session_id) do update
  set imprint_principal_churn_usdt = excluded.imprint_principal_churn_usdt,
      imprint_profit_churn_usdt    = excluded.imprint_profit_churn_usdt,
      imprint_generated_profit_usdt= excluded.imprint_generated_profit_usdt,
      imprint_trace_sum_usdt       = excluded.imprint_trace_sum_usdt,
      imprint_devref_sum_usdt      = excluded.imprint_devref_sum_usdt,
      luggage_total_principal_usdt = excluded.luggage_total_principal_usdt,
      luggage_total_profit_usdt    = excluded.luggage_total_profit_usdt;

  -- seal session
  update strategy_aux.cin_session
     set ended_at = coalesce(ended_at, now()),
         closed   = true
   where session_id = p_session_id;
end;
$$ language plpgsql;

-- =====================================================================
-- (optional) Smoke test snippets (commented)
-- =====================================================================
-- -- Create a session & seed balances (example)
-- -- insert into strategy_aux.cin_session(window_label) values ('1h') returning session_id;
-- -- insert into strategy_aux.cin_balance(session_id, asset_id, opening_principal, opening_profit, principal_usdt, profit_usdt)
-- -- values (1,'BTCUSDT',1000,0,1000,0), (1,'ETHUSDT',0,0,0,0), (1,'BNBUSDT',0,0,0,0);
--
-- -- Move BTC→ETH, 700 USDT at prices:
-- -- select strategy_aux.cin_exec_move_v2(1, now(), 'BTCUSDT','ETHUSDT',
-- --   700, 2, 0, null, null, 1000, 68000, 3200, 68000);
--
-- -- Then ETH→BNB, 600 USDT at new prices (bridge trace kicks in):
-- -- select strategy_aux.cin_exec_move_v2(1, now(), 'ETHUSDT','BNBUSDT',
-- --   600, 1, 0, null, null, 800, 3400, 240, 3400);
--
-- -- Mark close and roll
-- -- insert into strategy_aux.cin_mark(session_id, asset_id, ts, bulk_usdt)
-- -- values (1,'BTCUSDT', now(), 298),
-- --        (1,'ETHUSDT', now(), 160),
-- --        (1,'BNBUSDT', now(), 590);
-- -- select strategy_aux.cin_close_session_v2(1);
--
-- -- Inspect
-- -- select * from strategy_aux.v_cin_move_attrib;
-- -- select * from strategy_aux.v_cin_session_rollup;

IF p_price_bridge_usdt IS NOT NULL AND p_price_bridge_usdt <> 0 THEN
  v_units_needed := p_executed_usdt / p_price_bridge_usdt;

  IF EXISTS (
    SELECT 1
    FROM strategy_aux.cin_lot
    WHERE session_id = p_session_id
      AND asset_id   = p_from_asset
      AND units_free > 0
  ) THEN
    FOR rec IN
      SELECT *
      FROM strategy_aux.cin_consume_fifo_lots(p_session_id, p_from_asset, v_units_needed)
    LOOP
      -- trace & weighted p_in logic (unchanged)
      -- ...
    END LOOP;
  ELSE
    -- no lots to consume on this asset yet; skip cleanly
    v_units_needed := 0;
  END IF;
END IF;

create or replace function strategy_aux.cin_consume_fifo_lots(
  p_session_id bigint,
  p_asset_id   text,
  p_units_need numeric
) returns table(lot_id bigint, units_used numeric, p_in_usdt numeric) as $$
declare
  v_remain numeric := p_units_need;
  v_use    numeric;
  v_row    record;
begin
  for v_row in
    select l.lot_id, l.units_free, l.p_in_usdt
    from strategy_aux.cin_lot as l
    where l.session_id = p_session_id
      and l.asset_id   = p_asset_id
      and l.units_free > 0
    order by l.created_at, l.lot_id
  loop
    exit when v_remain <= 0;
    v_use := least(v_row.units_free, v_remain);

    update strategy_aux.cin_lot as l
       set units_free = l.units_free - v_use
     where l.lot_id = v_row.lot_id;

    lot_id     := v_row.lot_id;
    units_used := v_use;
    p_in_usdt  := v_row.p_in_usdt;
    v_remain   := v_remain - v_use;

    return next;
  end loop;

  if v_remain > 0 then
    raise exception
      'Not enough units in lots to consume: need %, short %',
      p_units_need, v_remain;
  end if;

  return;
end;
$$ language plpgsql;

create or replace function strategy_aux.cin_consume_fifo_lots(
  p_session_id bigint,
  p_asset_id   text,
  p_units_need numeric
) returns table(lot_id bigint, units_used numeric, p_in_usdt numeric) as $$
declare
  v_remain numeric := p_units_need;
  v_use    numeric;
  v_row    record;
begin
  for v_row in
    select l.lot_id, l.units_free, l.p_in_usdt
    from strategy_aux.cin_lot as l
    where l.session_id = p_session_id
      and l.asset_id   = p_asset_id
      and l.units_free > 0
    order by l.created_at, l.lot_id
  loop
    exit when v_remain <= 0;

    v_use := least(v_row.units_free, v_remain);

    update strategy_aux.cin_lot as l
       set units_free = l.units_free - v_use
     where l.lot_id = v_row.lot_id;

    lot_id     := v_row.lot_id;
    units_used := v_use;
    p_in_usdt  := v_row.p_in_usdt;
    v_remain   := v_remain - v_use;

    return next;
  end loop;

  if v_remain > 0 then
    raise exception
      'Not enough units in lots to consume: need %, short %',
      p_units_need, v_remain;
  end if;

  return;
end;
$$ language plpgsql;
