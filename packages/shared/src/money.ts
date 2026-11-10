/** All money is integer Vietnamese đồng (bigint-safe up to 9e15 in JS numbers). */
export function formatVnd(amount: number | string | bigint, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const n = Number(amount);
  const sign = opts.sign && n > 0 ? '+' : n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (opts.compact) {
    if (a >= 1e12) return `${sign}${trim(a / 1e12)} nghìn tỷ`;
    if (a >= 1e9) return `${sign}${trim(a / 1e9)} tỷ`;
    if (a >= 1e6) return `${sign}${trim(a / 1e6)} tr`;
  }
  return `${sign}${a.toLocaleString('vi-VN')} ₫`;
}
function trim(x: number) {
  return x.toLocaleString('vi-VN', { maximumFractionDigits: x < 10 ? 2 : 1 });
}
