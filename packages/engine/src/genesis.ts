import type { Db, Tx } from './db';
import { withTx, maybe, one, many } from './db';
import { seedCatalog } from './catalog';
import { post, SYS, acct } from './ledger';
import { ECON } from './config';
import { refillPeople } from './people';
import { buyEquipment, slugify, setListing } from './companies';
import { hire } from './hr';
import { addInventory } from './production';
import { resetEpochCache, realNow, tickOf } from './clock';
import { gameMinuteAt } from '@startup/shared';
import type { NpcProfile } from './npc';

type NpcSeed = {
  name: string;
  industry: string;
  location: string;
  capital: number;
  equipment: [string, number][];
  staff: { n: number; dept: string; shift: string }[];
  profile: NpcProfile;
  opening?: [string, number][]; // opening stock produced before the world started (zero cost)
  listings: [string, number, boolean][];
  description: string;
};

export const NPC_SEEDS: NpcSeed[] = [
  {
    name: 'Nông Trại Đồng Xanh',
    industry: 'nong_trai',
    location: 'binh_duong',
    capital: 2_500_000_000,
    equipment: [['may_xay', 2], ['may_ep_mia', 1], ['chuong_bo', 2]],
    staff: [{ n: 9, dept: 'san_xuat', shift: 'day' }],
    profile: { role: 'supplier', targetStaff: 12, stockDays: 3 },
    opening: [['bot_mi', 900], ['duong', 400], ['sua_tuoi', 500]],
    listings: [['bot_mi', 18_000, true], ['duong', 22_000, true], ['sua_tuoi', 28_000, true]],
    description: 'Nhà cung cấp bột mì, đường và sữa tươi lâu năm của miền Nam.',
  },
  {
    name: 'HTX Cà Phê Cao Nguyên',
    industry: 'nong_trai',
    location: 'ninh_kieu',
    capital: 1_800_000_000,
    equipment: [['may_rang', 2], ['chuong_bo', 1]],
    staff: [{ n: 7, dept: 'san_xuat', shift: 'day' }],
    profile: { role: 'supplier', targetStaff: 9, stockDays: 3 },
    opening: [['ca_phe_nhan', 160], ['sua_tuoi', 200]],
    listings: [['ca_phe_nhan', 95_000, true], ['sua_tuoi', 29_000, true]],
    description: 'Hợp tác xã cà phê và bò sữa, giao hàng toàn quốc.',
  },
  {
    name: 'Lâm Sản Trường Sơn',
    industry: 'go_det',
    location: 'hai_chau',
    capital: 3_000_000_000,
    equipment: [['may_xe_go', 2], ['may_det', 2]],
    staff: [{ n: 10, dept: 'san_xuat', shift: 'day' }],
    profile: { role: 'supplier', targetStaff: 12, stockDays: 3 },
    opening: [['go', 80], ['vai', 600]],
    listings: [['go', 350_000, true], ['vai', 45_000, true]],
    description: 'Gỗ rừng trồng có chứng chỉ và vải cotton cho ngành nội thất, may mặc.',
  },
  {
    name: 'Lò Bánh Phố Cổ',
    industry: 'tiem_banh',
    location: 'hoan_kiem',
    capital: 600_000_000,
    equipment: [['lo_nuong', 2]],
    staff: [{ n: 3, dept: 'san_xuat', shift: 'day' }, { n: 1, dept: 'san_xuat', shift: 'rotating' }, { n: 1, dept: 'ban_hang', shift: 'day' }, { n: 1, dept: 'ban_hang', shift: 'part' }, { n: 1, dept: 'ban_hang', shift: 'rotating' }],
    profile: { role: 'retail', targetStaff: 8, stockDays: 1 },
    listings: [['banh_mi', 26_000, false]],
    description: 'Tiệm bánh mì truyền thống giữa phố cổ Hà Nội.',
  },
  {
    name: 'Cà Phê Góc Phố',
    industry: 'quan_ca_phe',
    location: 'q1_hcm',
    capital: 700_000_000,
    equipment: [['may_pha', 2]],
    staff: [{ n: 2, dept: 'san_xuat', shift: 'day' }, { n: 1, dept: 'san_xuat', shift: 'rotating' }, { n: 2, dept: 'ban_hang', shift: 'day' }, { n: 1, dept: 'ban_hang', shift: 'part' }, { n: 1, dept: 'ban_hang', shift: 'rotating' }],
    profile: { role: 'retail', targetStaff: 8, stockDays: 1 },
    listings: [['ca_phe_sua', 36_000, false]],
    description: 'Chuỗi cà phê vỉa hè quen thuộc của dân văn phòng Quận 1.',
  },
  {
    name: 'Nội Thất Mộc An',
    industry: 'noi_that',
    location: 'thu_duc',
    capital: 1_500_000_000,
    equipment: [['may_cnc', 1]],
    staff: [{ n: 4, dept: 'san_xuat', shift: 'day' }, { n: 1, dept: 'ban_hang', shift: 'day' }],
    profile: { role: 'retail', targetStaff: 6, stockDays: 2 },
    listings: [['ban_go', 2_700_000, false]],
    description: 'Xưởng mộc gia đình chuyên bàn gỗ tự nhiên.',
  },
  {
    name: 'May Mặc Sài Thành',
    industry: 'may_mac',
    location: 'thu_duc',
    capital: 1_000_000_000,
    equipment: [['may_may', 2]],
    staff: [{ n: 4, dept: 'san_xuat', shift: 'day' }, { n: 1, dept: 'ban_hang', shift: 'day' }, { n: 1, dept: 'ban_hang', shift: 'rotating' }],
    profile: { role: 'retail', targetStaff: 7, stockDays: 2 },
    listings: [['ao_thun', 195_000, false]],
    description: 'Xưởng may áo thun cotton cho giới trẻ.',
  },
];

/** Create the world once: clock epoch, catalogue, bank capital, labour pool and NPC economy. */
export async function initWorld(db: Db, opts: { epochMs?: number; npcs?: boolean } = {}) {
  const existing = await maybe(db, 'SELECT 1 FROM world_config WHERE id=1');
  await withTx(db, async (tx) => {
    await seedCatalog(tx);
    if (existing) return;
    // Start the world at 07:00 on Thứ Hai, day 1.
    const epoch = opts.epochMs ?? realNow() - (7 * 60 * 60_000) / 30;
    await tx.query('INSERT INTO world_config (id, epoch) VALUES (1, $1)', [new Date(epoch)]);
    resetEpochCache();
    const minute = gameMinuteAt(realNow(), epoch);
    await post(tx, {
      key: 'genesis:bank',
      kind: 'genesis',
      memo: 'Vốn điều lệ Ngân hàng Thương mại Startup',
      minute,
      lines: [
        { ...SYS.bank('cash'), amount: ECON.bankCapital },
        { ...SYS.bank('capital'), amount: -ECON.bankCapital },
        { ...SYS.centralBank('policy_expense'), amount: ECON.bankCapital },
        { ...SYS.centralBank('currency_issued'), amount: -ECON.bankCapital },
      ],
    });
    await refillPeople(tx, 'genesis');
    if (opts.npcs !== false) for (const s of NPC_SEEDS) await createNpc(tx, s, minute);
    // Mark the previous tick processed so the worker starts from "now", not from tick 0.
    await tx.query('INSERT INTO world_ticks (tick, game_minute) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tickOf(minute) - 1, (tickOf(minute) - 1) * 30]);
  });
}

async function createNpc(tx: Tx, s: NpcSeed, minute: number) {
  const c = await one<{ id: string }>(
    tx,
    `INSERT INTO companies (is_npc, name, slug, industry_code, location_code, status, license_ready_at, founded_minute, description, npc_profile, reputation, logo_hue)
     VALUES (true,$1,$2,$3,$4,'active',$5,$5,$6,$7,$8,$9) RETURNING id`,
    [s.name, slugify(s.name), s.industry, s.location, minute, s.description, s.profile, 55, Math.floor(Math.random() * 360)],
  );
  await post(tx, {
    key: `genesis:npc:${c.id}`,
    kind: 'genesis',
    memo: `Vốn đầu tư nội địa vào ${s.name}`,
    minute,
    lines: [
      { ...acct('company', c.id, 'cash'), amount: s.capital },
      { ...acct('company', c.id, 'share_capital'), amount: -s.capital },
      { ...SYS.centralBank('policy_expense'), amount: s.capital },
      { ...SYS.centralBank('currency_issued'), amount: -s.capital },
    ],
  });
  for (const [type, n] of s.equipment) await buyEquipment(tx, null, c.id, type, n, minute, `genesis:eq:${c.id}:${type}`);
  for (const group of s.staff) {
    const people = await many<{ id: string; wage_expectation: number }>(tx, `SELECT id, wage_expectation FROM people WHERE status='seeking' ORDER BY random() LIMIT $1`, [group.n]);
    for (const p of people) await hire(tx, null, c.id, p.id, p.wage_expectation, group.shift, group.dept, minute);
  }
  for (const [good, qty] of s.opening ?? []) await addInventory(tx, c.id, good, qty, 0);
  for (const [good, price, b2b] of s.listings) await setListing(tx, c.id, good, price, true, b2b);
}
