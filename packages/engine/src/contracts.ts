import type { Tx, Queryable } from './db';
import { maybe, one, many, attempt } from './db';
import { fail } from './errors';
import { post, SYS, balance } from './ledger';
import { C, type CompanyRow } from './companies';
import { shipGoods } from './logistics';
import { notifyCompanyOwner } from './notify';
import { audit } from './audit';

/**
 * Long-term supply contracts.
 *  proposed → (seller accepts, buyer's deposit goes to escrow) → active → completed
 *  Each interval a delivery ships at the contract price. The buyer inspects it within one
 *  game day of arrival (accept or dispute; silence = accepted). Disputes are decided by an admin.
 *  A seller with no stock pays a penalty per missed delivery; 3 misses = breach (deposit returned).
 *  A buyer who cannot pay twice = breach (deposit forfeited to the seller).
 *  Cancelling: by the buyer forfeits the deposit; by the seller returns it plus an equal penalty.
 */
export type Contract = {
  id: string;
  buyer_company_id: string;
  seller_company_id: string;
  good_code: string;
  qty_per_delivery: number;
  unit_price: number;
  deliveries_total: number;
  deliveries_done: number;
  interval_days: number;
  deposit: number;
  penalty_rate: number;
  status: string;
  seller_misses: number;
  buyer_misses: number;
  next_delivery_minute: number | null;
};

const lockCompanies = async (tx: Tx, ids: string[]) => {
  const out = new Map<string, CompanyRow>();
  for (const id of [...ids].sort()) out.set(id, await one<CompanyRow>(tx, 'SELECT * FROM companies WHERE id=$1 FOR UPDATE', [id]));
  return out;
};

export async function proposeContract(
  tx: Tx,
  actorId: string,
  buyerId: string,
  input: { sellerCompanyId: string; good: string; qtyPerDelivery: number; unitPrice: number; deliveries: number; intervalDays: number; depositRate: number; penaltyRate: number },
  minute: number,
) {
  if (buyerId === input.sellerCompanyId) fail('self_trade', 'Không thể ký hợp đồng với chính doanh nghiệp mình.');
  const seller = await maybe<CompanyRow & { npc_profile: unknown }>(tx, 'SELECT * FROM companies WHERE id=$1', [input.sellerCompanyId]);
  if (!seller || !['active', 'insolvent'].includes(seller.status)) return fail('seller_inactive', 'Nhà cung cấp không hoạt động.');
  const makes = await maybe(tx, 'SELECT 1 FROM recipes WHERE industry_code=$1 AND output_good=$2', [seller.industry_code, input.good]);
  if (!makes) fail('cannot_supply', 'Nhà cung cấp không sản xuất mặt hàng này.');
  const g = await one<{ ref_price: number; name: string }>(tx, 'SELECT ref_price, name FROM goods WHERE code=$1', [input.good]);
  // Prices far from the market are refused: contracts must not be a channel to move money.
  if (input.unitPrice < g.ref_price * 0.6 || input.unitPrice > g.ref_price * 1.6) fail('price_out_of_range', `Đơn giá hợp đồng phải trong khoảng 60%–160% giá tham chiếu (${g.ref_price.toLocaleString('vi-VN')} ₫).`);
  const total = input.unitPrice * input.qtyPerDelivery * input.deliveries;
  const deposit = Math.round(total * input.depositRate);
  const c = await one<{ id: string }>(
    tx,
    `INSERT INTO supply_contracts (buyer_company_id, seller_company_id, good_code, qty_per_delivery, unit_price, deliveries_total, interval_days, deposit, penalty_rate, created_minute)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [buyerId, seller.id, input.good, input.qtyPerDelivery, input.unitPrice, input.deliveries, input.intervalDays, deposit, input.penaltyRate, minute],
  );
  await audit(tx, actorId, 'contract.propose', 'contract', c.id, { ...input, deposit });
  if (seller.is_npc) {
    // NPC suppliers accept when the price covers their wholesale price and the volume fits their capacity.
    const listing = await maybe<{ price: number }>(tx, 'SELECT price FROM listings WHERE company_id=$1 AND good_code=$2 AND b2b', [seller.id, input.good]);
    const cap = await one<{ cap: number }>(
      tx,
      `SELECT COALESCE(SUM(t.batches_per_hour * 8 * r.output_qty),0)::float AS cap FROM equipment e JOIN equipment_types t ON t.code=e.type_code
         JOIN recipes r ON r.equipment=e.type_code AND r.output_good=$2 WHERE e.company_id=$1`,
      [seller.id, input.good],
    );
    const okPrice = input.unitPrice >= (listing?.price ?? g.ref_price) * 0.95;
    const okVolume = input.qtyPerDelivery <= cap.cap * input.intervalDays * 0.6;
    if (okPrice && okVolume) await acceptContract(tx, null, c.id, minute);
    else await rejectContract(tx, null, c.id, !okPrice ? 'Giá thấp hơn giá bán buôn hiện hành' : 'Vượt công suất cung ứng');
  } else {
    await notifyCompanyOwner(tx, seller.id, 'contract', 'Đề nghị hợp đồng cung ứng', `${input.deliveries} lần giao ${input.qtyPerDelivery} đơn vị ${g.name}, đơn giá ${input.unitPrice.toLocaleString('vi-VN')} ₫.`);
  }
  return c.id;
}

export async function acceptContract(tx: Tx, actorId: string | null, contractId: string, minute: number) {
  const k = await one<Contract>(tx, 'SELECT * FROM supply_contracts WHERE id=$1 FOR UPDATE', [contractId]);
  if (k.status !== 'proposed') fail('not_proposed', 'Hợp đồng không ở trạng thái chờ ký.');
  if (k.deposit > 0) {
    const cash = await balance(tx, C(k.buyer_company_id, 'cash'));
    if (cash < k.deposit) fail('buyer_no_deposit', 'Bên mua không đủ tiền đặt cọc.');
    await post(tx, {
      key: `contract:deposit:${k.id}`,
      kind: 'contract_deposit',
      memo: 'Đặt cọc hợp đồng cung ứng (giữ tại tài khoản ký quỹ)',
      minute,
      ref: { type: 'contract', id: k.id },
      lines: [
        { ...C(k.buyer_company_id, 'cash'), amount: -k.deposit },
        { ...C(k.buyer_company_id, 'contract_deposits'), amount: k.deposit },
        { ...SYS.escrow('cash'), amount: k.deposit },
        { ...SYS.escrow('escrow_held'), amount: -k.deposit },
      ],
    });
  }
  await tx.query(`UPDATE supply_contracts SET status='active', next_delivery_minute=$2 WHERE id=$1`, [k.id, minute + 1440]);
  await audit(tx, actorId, 'contract.accept', 'contract', k.id);
  await notifyCompanyOwner(tx, k.buyer_company_id, 'contract', 'Hợp đồng cung ứng có hiệu lực', 'Lần giao đầu tiên sau 1 ngày game.', `contract-active:${k.id}`);
}

export async function rejectContract(tx: Tx, actorId: string | null, contractId: string, reason: string) {
  const r = await tx.query(`UPDATE supply_contracts SET status='rejected', ended_reason=$2 WHERE id=$1 AND status='proposed' RETURNING buyer_company_id`, [contractId, reason]);
  if (!r.rowCount) fail('not_proposed', 'Hợp đồng không ở trạng thái chờ ký.');
  await audit(tx, actorId, 'contract.reject', 'contract', contractId, { reason });
  await notifyCompanyOwner(tx, r.rows[0].buyer_company_id, 'contract', 'Đề nghị hợp đồng bị từ chối', reason);
}

/** Release the escrowed deposit to the buyer (refund) or the seller (forfeit). */
async function settleDeposit(tx: Tx, k: Contract, to: 'buyer' | 'seller', minute: number, reason: string) {
  if (k.deposit <= 0) return;
  const recipient = to === 'buyer' ? k.buyer_company_id : k.seller_company_id;
  await post(tx, {
    key: `contract:deposit-release:${k.id}`,
    kind: 'contract_deposit_release',
    memo: `${to === 'buyer' ? 'Hoàn' : 'Chuyển'} tiền cọc hợp đồng: ${reason}`,
    minute,
    ref: { type: 'contract', id: k.id },
    lines: [
      { ...SYS.escrow('cash'), amount: -k.deposit },
      { ...SYS.escrow('escrow_held'), amount: k.deposit },
      { ...C(k.buyer_company_id, 'contract_deposits'), amount: -k.deposit },
      ...(to === 'buyer'
        ? [{ ...C(recipient, 'cash'), amount: k.deposit }]
        : [
            { ...C(k.buyer_company_id, 'fees'), amount: k.deposit },
            { ...C(recipient, 'cash'), amount: k.deposit },
            { ...C(recipient, 'other_income'), amount: -k.deposit },
          ]),
    ],
  });
}

/** Seller pays buyer up to the amount due; whatever it cannot pay is not created out of thin air. */
async function payBetween(tx: Tx, from: string, to: string, amount: number, minute: number, key: string, memo: string) {
  const pay = Math.min(amount, Math.max(0, await balance(tx, C(from, 'cash'))));
  if (pay <= 0) return 0;
  await post(tx, {
    key,
    kind: 'contract_penalty',
    memo,
    minute,
    lines: [
      { ...C(from, 'cash'), amount: -pay },
      { ...C(from, 'fees'), amount: pay },
      { ...C(to, 'cash'), amount: pay },
      { ...C(to, 'other_income'), amount: -pay },
    ],
  });
  return pay;
}

async function finish(tx: Tx, k: Contract, status: 'completed' | 'cancelled' | 'breached', reason: string, depositTo: 'buyer' | 'seller', minute: number) {
  await settleDeposit(tx, k, depositTo, minute, reason);
  await tx.query(`UPDATE supply_contracts SET status=$2, ended_reason=$3, next_delivery_minute=NULL WHERE id=$1`, [k.id, status, reason]);
  for (const id of [k.buyer_company_id, k.seller_company_id]) await notifyCompanyOwner(tx, id, 'contract', `Hợp đồng ${status === 'completed' ? 'hoàn thành' : status === 'breached' ? 'bị vi phạm' : 'đã hủy'}`, reason, `contract-end:${k.id}:${id}`);
}

/** Daily: deliver what is due, apply penalties, auto-accept inspected deliveries, complete contracts. */
export async function contractDaily(tx: Tx, contractId: string, day: number, minute: number) {
  const k = await maybe<Contract>(tx, 'SELECT * FROM supply_contracts WHERE id=$1 FOR UPDATE', [contractId]);
  if (!k || k.status !== 'active') return;

  // Silence during the inspection window means acceptance.
  await tx.query(`UPDATE contract_deliveries SET status='accepted' WHERE contract_id=$1 AND status='delivered' AND accept_deadline_minute <= $2`, [k.id, minute]);

  if (k.next_delivery_minute !== null && minute >= k.next_delivery_minute && k.deliveries_done < k.deliveries_total) {
    const seq = k.deliveries_done + 1;
    const cs = await lockCompanies(tx, [k.buyer_company_id, k.seller_company_id]);
    const buyer = cs.get(k.buyer_company_id)!;
    const seller = cs.get(k.seller_company_id)!;
    const value = k.unit_price * k.qty_per_delivery;
    const stock = await maybe<{ q: number }>(tx, 'SELECT qty - reserved AS q FROM inventory WHERE company_id=$1 AND good_code=$2', [seller.id, k.good_code]);
    const buyerCash = await balance(tx, C(buyer.id, 'cash'));
    if ((stock?.q ?? 0) < k.qty_per_delivery || !['active', 'insolvent'].includes(seller.status)) {
      const penalty = await payBetween(tx, seller.id, buyer.id, Math.round(value * k.penalty_rate), minute, `contract:penalty:${k.id}:${seq}`, `Phạt giao hàng trễ hợp đồng lần ${seq}`);
      await tx.query(`INSERT INTO contract_deliveries (contract_id, seq, status, value, penalty, created_minute) VALUES ($1,$2,'missed_seller',$3,$4,$5) ON CONFLICT DO NOTHING`, [k.id, seq, value, penalty, minute]);
      const misses = k.seller_misses + 1;
      await tx.query('UPDATE supply_contracts SET seller_misses=$2, deliveries_done=deliveries_done+1, next_delivery_minute=next_delivery_minute + $3 WHERE id=$1', [k.id, misses, k.interval_days * 1440]);
      await notifyCompanyOwner(tx, seller.id, 'contract', 'Không giao đủ hàng theo hợp đồng', `Bị phạt ${penalty.toLocaleString('vi-VN')} ₫ (lần ${misses}/3).`, `contract-miss:${k.id}:${seq}`);
      if (misses >= 3) return finish(tx, k, 'breached', 'Bên bán không giao hàng 3 lần', 'buyer', minute);
    } else if (buyerCash < value * 1.05) {
      await tx.query(`INSERT INTO contract_deliveries (contract_id, seq, status, value, created_minute) VALUES ($1,$2,'missed_buyer',$3,$4) ON CONFLICT DO NOTHING`, [k.id, seq, value, minute]);
      const misses = k.buyer_misses + 1;
      await tx.query('UPDATE supply_contracts SET buyer_misses=$2, deliveries_done=deliveries_done+1, next_delivery_minute=next_delivery_minute + $3 WHERE id=$1', [k.id, misses, k.interval_days * 1440]);
      await notifyCompanyOwner(tx, buyer.id, 'contract', 'Không đủ tiền nhận hàng theo hợp đồng', `Lần ${misses}/2. Lần thứ 2 sẽ mất tiền cọc.`, `contract-buyer-miss:${k.id}:${seq}`);
      if (misses >= 2) return finish(tx, k, 'breached', 'Bên mua không thanh toán 2 lần', 'seller', minute);
    } else {
      const res = await attempt(tx, () =>
        shipGoods(tx, { actorId: null, buyer, seller, good: k.good_code, qty: k.qty_per_delivery, unitPrice: k.unit_price, minute, key: `contract:ship:${k.id}:${seq}`, kind: 'contract_delivery', memoPrefix: `Giao theo hợp đồng lần ${seq}:` }),
      );
      if (!res.ok) throw res.error;
      await tx.query(`INSERT INTO contract_deliveries (contract_id, seq, shipment_id, status, value, created_minute) VALUES ($1,$2,$3,'shipped',$4,$5)`, [k.id, seq, res.value.shipmentId, value, minute]);
      await tx.query('UPDATE supply_contracts SET deliveries_done=deliveries_done+1, next_delivery_minute=next_delivery_minute + $2 WHERE id=$1', [k.id, k.interval_days * 1440]);
    }
  }

  const fresh = await one<Contract>(tx, 'SELECT * FROM supply_contracts WHERE id=$1', [k.id]);
  if (fresh.deliveries_done >= fresh.deliveries_total) {
    const open = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM contract_deliveries WHERE contract_id=$1 AND status IN ('shipped','delivered','disputed')`, [k.id]);
    if (open.n === 0) await finish(tx, fresh, 'completed', 'Đã giao và nghiệm thu đủ các lần giao', 'buyer', minute);
  }
  void day;
}

/** Called when any shipment arrives: start the buyer's inspection window. */
export async function onShipmentDelivered(tx: Tx, shipmentId: string, etaMinute: number) {
  await tx.query(`UPDATE contract_deliveries SET status='delivered', accept_deadline_minute=$2 WHERE shipment_id=$1 AND status='shipped'`, [shipmentId, etaMinute + 1440]);
}

export async function inspectDelivery(tx: Tx, buyerOwnerId: string, deliveryId: string, accept: boolean, reason: string | null) {
  const d = await maybe<{ id: string; status: string; contract_id: string; buyer_company_id: string; owner_user_id: string }>(
    tx,
    `SELECT d.id, d.status, d.contract_id, k.buyer_company_id, c.owner_user_id FROM contract_deliveries d JOIN supply_contracts k ON k.id=d.contract_id JOIN companies c ON c.id=k.buyer_company_id WHERE d.id=$1 FOR UPDATE OF d`,
    [deliveryId],
  );
  if (!d || d.owner_user_id !== buyerOwnerId) return fail('not_found', 'Không tìm thấy lần giao hàng.', 404);
  if (d.status !== 'delivered') fail('not_inspectable', 'Chỉ nghiệm thu được lô hàng đã về kho và còn trong thời hạn kiểm tra.');
  if (accept) await tx.query(`UPDATE contract_deliveries SET status='accepted' WHERE id=$1`, [d.id]);
  else {
    if (!reason || reason.trim().length < 10) fail('reason_required', 'Cần mô tả lý do khiếu nại (tối thiểu 10 ký tự).');
    await tx.query(`UPDATE contract_deliveries SET status='disputed', dispute_reason=$2 WHERE id=$1`, [d.id, reason]);
  }
}

/** Admin decision on a disputed delivery: refund part of the goods value from seller to buyer. */
export async function resolveDispute(tx: Tx, adminId: string, deliveryId: string, refundRate: number, resolution: string, minute: number) {
  const d = await maybe<{ id: string; status: string; value: number; contract_id: string; buyer_company_id: string; seller_company_id: string }>(
    tx,
    `SELECT d.*, k.buyer_company_id, k.seller_company_id FROM contract_deliveries d JOIN supply_contracts k ON k.id=d.contract_id WHERE d.id=$1 FOR UPDATE OF d`,
    [deliveryId],
  );
  if (!d || d.status !== 'disputed') return fail('not_disputed', 'Lần giao không ở trạng thái tranh chấp.');
  if (refundRate < 0 || refundRate > 1) fail('bad_rate', 'Tỷ lệ hoàn tiền từ 0 đến 100%.');
  const refund = await payBetween(tx, d.seller_company_id, d.buyer_company_id, Math.round(d.value * refundRate), minute, `contract:refund:${d.id}`, `Hoàn tiền theo phán quyết tranh chấp hợp đồng`);
  await tx.query(`UPDATE contract_deliveries SET status='resolved', resolution=$2, refund=$3 WHERE id=$1`, [d.id, resolution, refund]);
  await audit(tx, adminId, 'contract.resolve_dispute', 'contract_delivery', d.id, { refundRate, refund, resolution });
  for (const id of [d.buyer_company_id, d.seller_company_id]) await notifyCompanyOwner(tx, id, 'contract', 'Đã có phán quyết tranh chấp hợp đồng', `${resolution} Hoàn tiền: ${refund.toLocaleString('vi-VN')} ₫.`);
}

export async function cancelContract(tx: Tx, actorId: string, contractId: string, side: 'buyer' | 'seller', minute: number) {
  const k = await maybe<Contract>(tx, 'SELECT * FROM supply_contracts WHERE id=$1 FOR UPDATE', [contractId]);
  if (!k) return fail('not_found', 'Không tìm thấy hợp đồng.', 404);
  if (k.status === 'proposed') {
    await tx.query(`UPDATE supply_contracts SET status='cancelled', ended_reason='Rút đề nghị' WHERE id=$1`, [k.id]);
    return;
  }
  if (k.status !== 'active') fail('not_active', 'Hợp đồng không còn hiệu lực.');
  if (side === 'buyer') await finish(tx, k, 'cancelled', 'Bên mua đơn phương chấm dứt: mất tiền cọc', 'seller', minute);
  else {
    await payBetween(tx, k.seller_company_id, k.buyer_company_id, k.deposit, minute, `contract:cancel-penalty:${k.id}`, 'Phạt đơn phương chấm dứt hợp đồng (bằng tiền cọc)');
    await finish(tx, k, 'cancelled', 'Bên bán đơn phương chấm dứt: hoàn cọc và bồi thường', 'buyer', minute);
  }
  await audit(tx, actorId, 'contract.cancel', 'contract', k.id, { side });
}

export async function contractsOf(q: Queryable, companyId: string) {
  const contracts = await many(
    q,
    `SELECT k.*, g.name AS good_name, g.unit, b.name AS buyer_name, s.name AS seller_name FROM supply_contracts k JOIN goods g ON g.code=k.good_code
       JOIN companies b ON b.id=k.buyer_company_id JOIN companies s ON s.id=k.seller_company_id
      WHERE k.buyer_company_id=$1 OR k.seller_company_id=$1 ORDER BY k.created_at DESC LIMIT 50`,
    [companyId],
  );
  const deliveries = await many(q, `SELECT * FROM contract_deliveries WHERE contract_id = ANY($1) ORDER BY seq`, [contracts.map((c) => c.id)]);
  return { contracts, deliveries };
}
