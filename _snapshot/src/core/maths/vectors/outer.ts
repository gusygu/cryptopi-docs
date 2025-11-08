// TODO: implement real outer divergence over orderbook structure
export interface OuterInput { bins: number[]; benchmark: number; }
export function vOuter({ bins, benchmark }: OuterInput): number {
  const mid = Math.floor(bins.length/2);
  const left = bins.slice(0, mid).reduce((a,b)=>a+b,0);
  const right = bins.slice(mid).reduce((a,b)=>a+b,0);
  return (right - left) - benchmark;
}
