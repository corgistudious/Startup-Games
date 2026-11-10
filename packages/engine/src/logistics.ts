import type { Tx } from './db';
import { maybe, one } from './db';
import { fail } from './errors';
import { post, SYS } from './ledger';
import { C, type CompanyRow } from './companies';
import { takeInventory, addInventory } from './production';
import { ECON } from './config';
import { seeded } from './rng';
import { notifyCompanyOwner } from './notify';
import { onShipmentDelivered } from './contracts';

export function quoteFreight(goodsTotal: number, km: number) {
  return Math.max(ECON.freightMin, Math.round(goodsTotal * 0.012 + km * ECON.freightPerUnitKm * 600));
}
export function transitMinutes(km: number) {
  return Math.round((ECON.handlingHours + km / ECON.truckKmPerHour) * 60);
}

/**
 * B2B purchase. The seller's listed price is authoritative (the client only sends a ceiling).
 * Goods leave the seller now and travel to the buyer; they arrive at the ETA, which can slip.
 */
export async function purchase(tx: Tx, actorId: string | null, buyerId: string, sellerId: string, good: string, qty: number, maxUnitPrice: number, minute: number, key: string) {
  if (buyerId === sellerId) fail('self_trade', 'Không thể tự mua hàng của chính doanh nghiệp.');
  const [first, second] = [buyerId, sellerId].sort();
  const companies = new Map<string, CompanyRow>();
  for (const id of [first!, second!]) {
    const c = await maybe<CompanyRow>(tx, 'SELECT * FROM companies WHERE id=$1 FOR UPDATE', [id]);
    if (!c) return fail('not_found', 'Không tìm thấy doanh nghiệp.', 404);
    companies.set(id, c);
  }
  const buyer = companies.get(buyerId)!;
  const seller = companies.get(sellerId)!;
  if (!['active', 'insolvent', 'licensing'].includes(buyer.status)) fail('not_active', 'Doanh nghiệp mua không còn hoạt động.');
  if (!['active', 'insolvent'].includes(seller.status)) fail('seller_inactive', 'Nhà cung cấp không hoạt động.');
  const listing = await maybe<{ price: number; active: boolean }>(tx, 'SELECT price, active FROM listings WHERE company_id=$1 AND good_code=$2 AND b2b=true', [sellerId, good]);
  if (!listing || !listing.active) return fail('not_listed', 'Nhà cung cấp không chào bán mặt hàng này.');
  if (listing.price > maxUnitPrice) fail('price_changed', `Giá đã thay đổi thành ${listing.price.toLocaleString('vi-VN')} ₫, cao hơn mức bạn chấp nhận.`);
  return shipGoods(tx, { actorId, buyer, seller, good, qty, unitPrice: listing.price, minute, key, kind: 'b2b_purchase' });
}

/**
 * Move goods from seller to buyer at an agreed unit price: seller is paid now, goods travel
 * and arrive at the ETA. Used by spot purchases and by long-term contract deliveries.
 * Caller must have locked both company rows.
 */
export async function shipGoods(
  tx: Tx,
  o: { actorId: string | null; buyer: CompanyRow; seller: CompanyRow; good: string; qty: number; unitPrice: number; minute: number; key: string; kind: string; memoPrefix?: string },
) {
  const { buyer, seller, good, qty, minute, key } = o;
  const buyerId = buyer.id;
  const sellerId = seller.id;
  const costBasis = await takeInventory(tx, sellerId, good, qty);
  const goodsTotal = o.unitPrice * qty;
  const locs = await one<{ km: number }>(tx, 'SELECT SUM(logistics_km)::int AS km FROM locations WHERE code = ANY($1)', [[buyer.location_code, seller.location_code]]);
  const km = buyer.location_code === seller.location_code ? 10 : locs.km;
  const freight = quoteFreight(goodsTotal, km);
  const quoted = minute + transitMinutes(km);
  const rnd = seeded(key)();
  const delay = rnd < 0.15 ? Math.round(transitMinutes(km) * (0.3 + rnd * 4)) : 0; // ~15% of shipments are late
  const g = await one<{ name: string; unit: string }>(tx, 'SELECT name, unit FROM goods WHERE code=$1', [good]);

  const res = await post(tx, {
    key,
    kind: o.kind,
    memo: `${o.memoPrefix ?? 'Mua'} ${qty} ${g.unit} ${g.name} từ ${seller.name}`,
    minute,
    actorId: o.actorId,
    ref: { type: 'company', id: buyerId },
    lines: [
      { ...C(buyerId, 'cash'), amount: -(goodsTotal + freight) },
      { ...C(buyerId, 'inventory_transit'), amount: goodsTotal + freight },
      { ...C(sellerId, 'cash'), amount: goodsTotal },
      { ...C(sellerId, 'sales_revenue'), amount: -goodsTotal },
      { ...C(sellerId, 'cogs'), amount: costBasis },
      { ...C(sellerId, 'inventory'), amount: -costBasis },
      { ...SYS.households('cash'), amount: freight },
      { ...SYS.households('income'), amount: -freight },
    ],
  });
  if (!res.created) fail('duplicate', 'Đơn hàng này đã được xử lý.', 409);
  const s = await one<{ id: string }>(
    tx,
    `INSERT INTO shipments (buyer_company_id, seller_company_id, good_code, qty, unit_price, goods_total, freight, cost_basis, ordered_minute, quoted_eta_minute, eta_minute)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [buyerId, sellerId, good, qty, o.unitPrice, goodsTotal, freight, costBasis, minute, quoted, quoted + delay],
  );
  await tx.query(
    `INSERT INTO sales_daily (company_id, day, good_code, qty, revenue, customers) VALUES ($1,$2,$3,$4,$5,1)
     ON CONFLICT (company_id, day, good_code) DO UPDATE SET qty = sales_daily.qty + EXCLUDED.qty, revenue = sales_daily.revenue + EXCLUDED.revenue, customers = sales_daily.customers + 1`,
    [sellerId, Math.floor(minute / 1440), good, qty, goodsTotal],
  );
  if (!seller.is_npc) await notifyCompanyOwner(tx, sellerId, 'sales', 'Có đơn hàng bán buôn', `${buyer.name} mua ${qty} ${g.unit} ${g.name} (${goodsTotal.toLocaleString('vi-VN')} ₫).`);
  return { shipmentId: s.id, goodsTotal, freight, etaMinute: quoted };
}

export async function deliverShipment(tx: Tx, shipmentId: string, minute: number) {
  const s = await maybe<{ id: string; buyer_company_id: string; good_code: string; qty: number; goods_total: number; freight: number; status: string; quoted_eta_minute: number; eta_minute: number }>(
    tx,
    'SELECT * FROM shipments WHERE id=$1 FOR UPDATE',
    [shipmentId],
  );
  if (!s || s.status !== 'in_transit') return;
  const value = s.goods_total + s.freight;
  await addInventory(tx, s.buyer_company_id, s.good_code, s.qty, value);
  await post(tx, {
    key: `deliver:${s.id}`,
    kind: 'shipment_delivered',
    memo: 'Nhận hàng vào kho',
    minute: s.eta_minute,
    ref: { type: 'shipment', id: s.id },
    lines: [
      { ...C(s.buyer_company_id, 'inventory'), amount: value },
      { ...C(s.buyer_company_id, 'inventory_transit'), amount: -value },
    ],
  });
  await tx.query(`UPDATE shipments SET status='delivered', delivered_minute=$2 WHERE id=$1`, [s.id, s.eta_minute]);
  await onShipmentDelivered(tx, s.id, s.eta_minute);
  const late = s.eta_minute > s.quoted_eta_minute;
  const g = await one<{ name: string; unit: string }>(tx, 'SELECT name, unit FROM goods WHERE code=$1', [s.good_code]);
  await notifyCompanyOwner(
    tx,
    s.buyer_company_id,
    'logistics',
    late ? 'Hàng về kho (bị trễ)' : 'Hàng đã về kho',
    `${s.qty} ${g.unit} ${g.name}${late ? `, trễ ${Math.round((s.eta_minute - s.quoted_eta_minute) / 60)} giờ so với dự kiến` : ''}.`,
    `ship:${s.id}`,
  );
  void minute;
}
