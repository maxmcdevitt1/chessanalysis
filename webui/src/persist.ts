export const getNumber = (k: string, fallback: number) => {
  try {
    const v = window.localStorage.getItem(k);
    if (v == null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
};

export const setNumber = (k: string, v: number) => {
  try {
    window.localStorage.setItem(k, String(v));
  } catch {}
};
