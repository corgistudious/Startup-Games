import type { Tx } from './db';

export const GOODS = [
  { code: 'bot_mi', name: 'Bột mì', unit: 'kg', category: 'raw', ref_price: 18_000, elasticity: 1.2, demand_weight: 0, spoil: 0.002 },
  { code: 'duong', name: 'Đường', unit: 'kg', category: 'raw', ref_price: 22_000, elasticity: 1.2, demand_weight: 0, spoil: 0 },
  { code: 'sua_tuoi', name: 'Sữa tươi', unit: 'lít', category: 'raw', ref_price: 28_000, elasticity: 1.2, demand_weight: 0, spoil: 0.12 },
  { code: 'ca_phe_nhan', name: 'Cà phê nhân', unit: 'kg', category: 'raw', ref_price: 95_000, elasticity: 1.2, demand_weight: 0, spoil: 0 },
  { code: 'go', name: 'Gỗ tấm', unit: 'tấm', category: 'raw', ref_price: 350_000, elasticity: 1.2, demand_weight: 0, spoil: 0 },
  { code: 'vai', name: 'Vải cotton', unit: 'mét', category: 'raw', ref_price: 45_000, elasticity: 1.2, demand_weight: 0, spoil: 0 },
  { code: 'banh_mi', name: 'Bánh mì', unit: 'ổ', category: 'consumer', ref_price: 25_000, elasticity: 1.8, demand_weight: 0.28, spoil: 0.45 },
  { code: 'ca_phe_sua', name: 'Cà phê sữa', unit: 'ly', category: 'consumer', ref_price: 35_000, elasticity: 1.7, demand_weight: 0.3, spoil: 0.6 },
  { code: 'ban_go', name: 'Bàn gỗ', unit: 'chiếc', category: 'consumer', ref_price: 2_600_000, elasticity: 1.4, demand_weight: 0.2, spoil: 0 },
  { code: 'ao_thun', name: 'Áo thun', unit: 'chiếc', category: 'consumer', ref_price: 190_000, elasticity: 1.5, demand_weight: 0.22, spoil: 0 },
] as const;

export const INDUSTRIES = [
  { code: 'nong_trai', name: 'Nông trại & Chế biến', description: 'Sản xuất bột mì, đường, sữa tươi, cà phê nhân. Bán buôn cho doanh nghiệp khác.', kind: 'producer', tax_rate: 0.1, register_fee: 15_000_000, min_capital: 150_000_000, license_hours: 12, open_hour: 0, close_hour: 0, days_mask: 127, icon: 'wheat' },
  { code: 'go_det', name: 'Gỗ & Dệt may nguyên liệu', description: 'Sản xuất gỗ tấm và vải cotton cho xưởng nội thất và may mặc.', kind: 'producer', tax_rate: 0.12, register_fee: 20_000_000, min_capital: 200_000_000, license_hours: 18, open_hour: 0, close_hour: 0, days_mask: 127, icon: 'trees' },
  { code: 'tiem_banh', name: 'Tiệm bánh', description: 'Nướng bánh mì từ bột mì và đường, bán lẻ cho người dân.', kind: 'manufacturer_retail', tax_rate: 0.15, register_fee: 8_000_000, min_capital: 80_000_000, license_hours: 8, open_hour: 6, close_hour: 20, days_mask: 127, icon: 'croissant' },
  { code: 'quan_ca_phe', name: 'Quán cà phê', description: 'Pha cà phê sữa, mở cửa sáng đến tối, cạnh tranh mạnh về giá và thương hiệu.', kind: 'manufacturer_retail', tax_rate: 0.15, register_fee: 10_000_000, min_capital: 100_000_000, license_hours: 8, open_hour: 7, close_hour: 22, days_mask: 127, icon: 'coffee' },
  { code: 'noi_that', name: 'Xưởng nội thất', description: 'Đóng bàn gỗ, biên lợi nhuận cao nhưng cần tay nghề và vốn lưu động lớn.', kind: 'manufacturer_retail', tax_rate: 0.18, register_fee: 25_000_000, min_capital: 300_000_000, license_hours: 24, open_hour: 8, close_hour: 20, days_mask: 63, icon: 'armchair' },
  { code: 'may_mac', name: 'Xưởng may mặc', description: 'May áo thun từ vải cotton, bán lẻ quanh năm.', kind: 'manufacturer_retail', tax_rate: 0.18, register_fee: 18_000_000, min_capital: 200_000_000, license_hours: 16, open_hour: 8, close_hour: 21, days_mask: 127, icon: 'shirt' },
] as const;

export const EQUIPMENT = [
  { code: 'may_xay', name: 'Máy xay bột', price: 120_000_000, batches_per_hour: 0.5, maintenance_day: 350_000, wear_per_day: 0.6 },
  { code: 'may_ep_mia', name: 'Dây chuyền ép mía', price: 140_000_000, batches_per_hour: 0.5, maintenance_day: 400_000, wear_per_day: 0.6 },
  { code: 'chuong_bo', name: 'Trang trại bò sữa', price: 180_000_000, batches_per_hour: 0.6, maintenance_day: 600_000, wear_per_day: 0.4 },
  { code: 'may_rang', name: 'Máy rang cà phê', price: 160_000_000, batches_per_hour: 0.4, maintenance_day: 450_000, wear_per_day: 0.6 },
  { code: 'may_xe_go', name: 'Xưởng xẻ gỗ', price: 220_000_000, batches_per_hour: 0.25, maintenance_day: 700_000, wear_per_day: 0.7 },
  { code: 'may_det', name: 'Máy dệt', price: 190_000_000, batches_per_hour: 0.4, maintenance_day: 550_000, wear_per_day: 0.6 },
  { code: 'lo_nuong', name: 'Lò nướng công nghiệp', price: 45_000_000, batches_per_hour: 1.2, maintenance_day: 120_000, wear_per_day: 0.8 },
  { code: 'may_pha', name: 'Máy pha espresso', price: 38_000_000, batches_per_hour: 1.5, maintenance_day: 100_000, wear_per_day: 0.9 },
  { code: 'may_cnc', name: 'Máy CNC gỗ', price: 260_000_000, batches_per_hour: 0.2, maintenance_day: 800_000, wear_per_day: 0.5 },
  { code: 'may_may', name: 'Chuyền máy may', price: 95_000_000, batches_per_hour: 0.6, maintenance_day: 250_000, wear_per_day: 0.7 },
] as const;

export const RECIPES = [
  { code: 'r_bot_mi', industry: 'nong_trai', name: 'Xay bột mì', output: 'bot_mi', qty: 120, labor: 4, equipment: 'may_xay', inputs: [] },
  { code: 'r_duong', industry: 'nong_trai', name: 'Ép mía làm đường', output: 'duong', qty: 90, labor: 4, equipment: 'may_ep_mia', inputs: [] },
  { code: 'r_sua', industry: 'nong_trai', name: 'Vắt và tiệt trùng sữa', output: 'sua_tuoi', qty: 70, labor: 3, equipment: 'chuong_bo', inputs: [] },
  { code: 'r_ca_phe_nhan', industry: 'nong_trai', name: 'Sơ chế cà phê nhân', output: 'ca_phe_nhan', qty: 25, labor: 5, equipment: 'may_rang', inputs: [] },
  { code: 'r_go', industry: 'go_det', name: 'Xẻ gỗ tấm', output: 'go', qty: 12, labor: 8, equipment: 'may_xe_go', inputs: [] },
  { code: 'r_vai', industry: 'go_det', name: 'Dệt vải cotton', output: 'vai', qty: 70, labor: 5, equipment: 'may_det', inputs: [] },
  { code: 'r_banh_mi', industry: 'tiem_banh', name: 'Nướng mẻ bánh mì', output: 'banh_mi', qty: 40, labor: 3, equipment: 'lo_nuong', inputs: [{ good: 'bot_mi', qty: 6 }, { good: 'duong', qty: 1 }] },
  { code: 'r_ca_phe_sua', industry: 'quan_ca_phe', name: 'Pha mẻ cà phê sữa', output: 'ca_phe_sua', qty: 30, labor: 2, equipment: 'may_pha', inputs: [{ good: 'ca_phe_nhan', qty: 1 }, { good: 'sua_tuoi', qty: 4 }, { good: 'duong', qty: 1 }] },
  { code: 'r_ban_go', industry: 'noi_that', name: 'Đóng bàn gỗ', output: 'ban_go', qty: 2, labor: 14, equipment: 'may_cnc', inputs: [{ good: 'go', qty: 3 }] },
  { code: 'r_ao_thun', industry: 'may_mac', name: 'May lô áo thun', output: 'ao_thun', qty: 20, labor: 9, equipment: 'may_may', inputs: [{ good: 'vai', qty: 24 }] },
] as const;

export const LOCATIONS = [
  { code: 'q1_hcm', name: 'Quận 1, TP.HCM', region: 'Nam Bộ', rent_day: 4_500_000, traffic: 1.45, km: 15 },
  { code: 'hoan_kiem', name: 'Hoàn Kiếm, Hà Nội', region: 'Bắc Bộ', rent_day: 4_000_000, traffic: 1.35, km: 40 },
  { code: 'hai_chau', name: 'Hải Châu, Đà Nẵng', region: 'Trung Bộ', rent_day: 2_200_000, traffic: 1.1, km: 60 },
  { code: 'ninh_kieu', name: 'Ninh Kiều, Cần Thơ', region: 'Tây Nam Bộ', rent_day: 1_500_000, traffic: 0.95, km: 80 },
  { code: 'thu_duc', name: 'TP. Thủ Đức', region: 'Nam Bộ', rent_day: 2_000_000, traffic: 1.0, km: 25 },
  { code: 'binh_duong', name: 'KCN Bình Dương', region: 'Nam Bộ', rent_day: 1_200_000, traffic: 0.55, km: 20 },
] as const;

export async function seedCatalog(tx: Tx) {
  for (const g of GOODS) {
    await tx.query(
      `INSERT INTO goods (code,name,unit,category,ref_price,elasticity,demand_weight,spoil_per_day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, unit=EXCLUDED.unit, ref_price=EXCLUDED.ref_price, elasticity=EXCLUDED.elasticity, demand_weight=EXCLUDED.demand_weight, spoil_per_day=EXCLUDED.spoil_per_day`,
      [g.code, g.name, g.unit, g.category, g.ref_price, g.elasticity, g.demand_weight, g.spoil],
    );
  }
  for (const i of INDUSTRIES) {
    await tx.query(
      `INSERT INTO industries (code,name,description,kind,tax_rate,register_fee,min_capital,license_hours,open_hour,close_hour,days_mask,icon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, tax_rate=EXCLUDED.tax_rate, register_fee=EXCLUDED.register_fee,
         min_capital=EXCLUDED.min_capital, license_hours=EXCLUDED.license_hours, open_hour=EXCLUDED.open_hour, close_hour=EXCLUDED.close_hour, days_mask=EXCLUDED.days_mask, icon=EXCLUDED.icon`,
      [i.code, i.name, i.description, i.kind, i.tax_rate, i.register_fee, i.min_capital, i.license_hours, i.open_hour, i.close_hour, i.days_mask, i.icon],
    );
  }
  for (const e of EQUIPMENT) {
    await tx.query(
      `INSERT INTO equipment_types (code,name,price,batches_per_hour,maintenance_day,wear_per_day) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, price=EXCLUDED.price, batches_per_hour=EXCLUDED.batches_per_hour, maintenance_day=EXCLUDED.maintenance_day, wear_per_day=EXCLUDED.wear_per_day`,
      [e.code, e.name, e.price, e.batches_per_hour, e.maintenance_day, e.wear_per_day],
    );
  }
  for (const r of RECIPES) {
    await tx.query(
      `INSERT INTO recipes (code,industry_code,name,output_good,output_qty,labor_hours,equipment,inputs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, output_qty=EXCLUDED.output_qty, labor_hours=EXCLUDED.labor_hours, equipment=EXCLUDED.equipment, inputs=EXCLUDED.inputs`,
      [r.code, r.industry, r.name, r.output, r.qty, r.labor, r.equipment, JSON.stringify(r.inputs)],
    );
  }
  for (const l of LOCATIONS) {
    await tx.query(
      `INSERT INTO locations (code,name,region,rent_day,traffic,logistics_km) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, rent_day=EXCLUDED.rent_day, traffic=EXCLUDED.traffic, logistics_km=EXCLUDED.logistics_km`,
      [l.code, l.name, l.region, l.rent_day, l.traffic, l.km],
    );
  }
}
