// Economy health simulation: run the NPC world for N game days and print key indicators.
// Usage: npx tsx test/sim.ts 14
import { freshWorld, advance } from './helpers';
import { many, one } from '../src/db';
import { auditLedger, balance, SYS } from '../src/ledger';

const days = Number(process.argv[2] ?? 14);
const db = await freshWorld();
for (let d = 1; d <= days; d++) {
  await advance(db, 1440);
  const npc = await many<{ name: string; cash: number; staff: number }>(
    db,
    `SELECT c.name, (SELECT balance FROM accounts a WHERE a.owner_type='company' AND a.owner_id=c.id::text AND a.code='cash') AS cash,
            (SELECT count(*)::int FROM people p WHERE p.company_id=c.id) AS staff FROM companies c ORDER BY c.name`,
  );
  const sales = await one<{ r: number }>(db, `SELECT COALESCE(SUM(revenue),0)::bigint AS r FROM sales_daily WHERE day = $1`, [d - 1 + 0]);
  const hh = await balance(db, SYS.households('cash'));
  console.log(`day ${d}: households ${Math.round(hh / 1e6)}tr, sales ${Math.round(sales.r / 1e6)}tr | ` + npc.map((n) => `${n.name.split(' ').slice(-2).join(' ')} ${Math.round(n.cash / 1e6)}tr/${n.staff}`).join(', '));
}
const reports = await many<{ name: string; revenue: number; net_profit: number }>(db, `SELECT c.name, r.revenue, r.net_profit FROM monthly_reports r JOIN companies c ON c.id=r.company_id ORDER BY r.month, c.name`);
for (const r of reports) console.log(`report ${r.name}: revenue ${Math.round(r.revenue / 1e6)}tr, net ${Math.round(r.net_profit / 1e6)}tr`);
console.log('audit', await auditLedger(db));
await db.end();
