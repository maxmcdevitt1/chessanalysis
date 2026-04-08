export type PlyEval = { cp?: number; mate?: number; pov: 'w'|'b' };
export function mergeEvalsDistinct(list: (PlyEval|undefined)[]): (PlyEval|undefined)[] {
  let prevKey = '';
  return list.map((e)=>{
    if (!e) return e;
    const key = e.mate !== undefined ? `m${e.pov}${e.mate}` : `c${e.pov}${e.cp}`;
    if (key === prevKey) return undefined;
    prevKey = key;
    return e;
  });
}
