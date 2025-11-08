// TODO: implement real inner pressure over IDHR/binning
export interface InnerInput { bins: number[]; weights?: number[]; }
export function vInnerAgg({ bins, weights }: InnerInput): number {
  const w = weights ?? bins.map(()=>1);
  return bins.reduce((a,x,i)=> a + x*(w[i]??1), 0);
}
