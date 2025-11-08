// TODO: implement real vSwap over inner/tendency alignment
export interface SwapInput { innerSeries: number[]; tendency: number[]; }
export function vSwapScore({ innerSeries, tendency }: SwapInput): number {
  const n = Math.min(innerSeries.length, tendency.length);
  if (!n) return 0;
  let agree=0,dis=0;
  for (let i=0;i<n;i++) (Math.sign(innerSeries[i])===Math.sign(tendency[i]) ? agree++ : dis++);
  return (agree - dis) / n; // [-1,1]
}
