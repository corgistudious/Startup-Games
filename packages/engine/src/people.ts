import type { Tx } from './db';
import { one } from './db';
import { seeded, pick } from './rng';
import { ECON } from './config';

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Trương', 'Mai', 'Lâm'];
const DEM = ['Văn', 'Thị', 'Minh', 'Ngọc', 'Hữu', 'Thanh', 'Quốc', 'Thu', 'Gia', 'Hoài', 'Đức', 'Bảo', 'Anh', 'Kim', 'Xuân', 'Phương'];
const TEN = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hải', 'Hạnh', 'Hiếu', 'Hùng', 'Hương', 'Khánh', 'Khoa', 'Lan', 'Linh', 'Long', 'Mai', 'Nam', 'Nga', 'Nhung', 'Phong', 'Phúc', 'Quân', 'Quỳnh', 'Sơn', 'Tâm', 'Thảo', 'Thắng', 'Trang', 'Trí', 'Trung', 'Tú', 'Tuấn', 'Uyên', 'Vy', 'Yến'];

/** Keep the labour market stocked with job seekers (graduates, people moving to the city). */
export async function refillPeople(tx: Tx, seed: string, target: number = ECON.peoplePoolSize) {
  const { n } = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM people WHERE status = 'seeking'`);
  const missing = Math.max(0, target - n);
  const r = seeded(seed);
  for (let i = 0; i < missing; i++) {
    const skill = Math.round(15 + r() ** 1.4 * 80);
    const age = 19 + Math.floor(r() * 40);
    const base = 220_000 + skill * 6_500;
    const wage = Math.round((base * (0.85 + r() * 0.35)) / 5000) * 5000;
    await tx.query(`INSERT INTO people (full_name, age, skill, wage_expectation) VALUES ($1,$2,$3,$4)`, [
      `${pick(r, HO)} ${pick(r, DEM)} ${pick(r, TEN)}`,
      age,
      skill,
      wage,
    ]);
  }
  return missing;
}

/** Effective labour hours one on-shift employee provides in a 30-minute tick. */
export function laborPerTick(skill: number, morale: number) {
  return 0.5 * (0.6 + skill / 250) * (0.55 + morale / 220);
}
