-- latest rows per matrix_type/base/quote
with latest as (
  select
    matrix_type,
    base, quote,
    value,
    ts_ms,
    row_number() over (partition by matrix_type, base, quote order by ts_ms desc) as rn
  from matrices.dyn_values
  where base in ('BTC','ETH','SOL','ADA','USDT')   -- adjust if needed
     or quote in ('BTC','ETH','SOL','ADA','USDT')
)
select *
from latest
where rn = 1
order by matrix_type, base, quote;