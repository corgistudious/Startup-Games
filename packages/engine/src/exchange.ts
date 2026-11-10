import type { Tx, Queryable } from './db';
import { maybe, one, many } from './db';
import { fail } from './errors';
import { post, acct, balance, type OwnerType, type Line } from './ledger';
import { ECON } from './config';
import { netAssets, type CompanyRow } from './companies';
import { notify } from './notify';
import { audit } from './audit';

export type Owner = { type: 'user' | 'company'; id: string };
type Order = {
  id: string;
  seq: number;
  symbol: string;
  owner_type: 'user' | 'company';
  owner_id: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: number | null;
  qty: number;
  filled: number;
  locked_cash: number;
  status: string;
  is_ipo: boolean;
};
type Instrument = { symbol: string; company_id: string; status: string; last_price: number | null; ipo_price: number };

const A = (o: Owner, code: string) => acct(o.type as OwnerType, o.id, code);

/** Lot size: orders must be in multiples of 10 shares. Tick size: 100 ₫. */
export const LOT = 10;
export const TICK = 100;

export async function ipoEligibility(q: Queryable, c: CompanyRow, minute: number) {
  const reasons: string[] = [];
  const owner = c.owner_user_id ? await one<{ stage: number }>(q, 'SELECT stage FROM users WHERE id=$1', [c.owner_user_id]) : { stage: 5 };
  if (owner.stage < ECON.ipo.minStage) reasons.push('Chủ sở hữu cần đạt giai đoạn Doanh nghiệp vừa.');
  if (minute - c.founded_minute < ECON.ipo.minAgeDays * 1440) reasons.push(`Doanh nghiệp cần hoạt động ít nhất ${ECON.ipo.minAgeDays} ngày game.`);
  const emp = await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM people WHERE company_id=$1', [c.id]);
  if (emp.n < ECON.ipo.minEmployees) reasons.push(`Cần tối thiểu ${ECON.ipo.minEmployees} nhân sự.`);
  const profitable = await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM (SELECT net_profit FROM monthly_reports WHERE company_id=$1 ORDER BY month DESC LIMIT $2) x WHERE net_profit > 0', [c.id, ECON.ipo.requireProfitMonths]);
  if (profitable.n < ECON.ipo.requireProfitMonths) reasons.push('Báo cáo tài chính tháng gần nhất phải có lãi (đã kiểm toán khi chốt tháng).');
  const na = await netAssets(q, c.id);
  if (na.equity <= 0) reasons.push('Vốn chủ sở hữu phải dương.');
  if (c.status !== 'active') reasons.push('Doanh nghiệp phải đang hoạt động bình thường.');
  if (await maybe(q, 'SELECT 1 FROM instruments WHERE company_id=$1', [c.id])) reasons.push('Doanh nghiệp đã niêm yết.');
  return { eligible: reasons.length === 0, reasons, equity: na.equity };
}

/**
 * IPO: the company registers its total shares. The founder keeps (total − offer) shares;
 * the offered shares are sold by the company itself through a normal sell order on the book,
 * so they only change hands when real buyers match. Proceeds become share capital.
 */
export async function ipo(tx: Tx, actorId: string, c: CompanyRow, input: { symbol: string; totalShares: number; offerShares: number; offerPrice: number }, minute: number) {
  const el = await ipoEligibility(tx, c, minute);
  if (!el.eligible) fail('ipo_ineligible', el.reasons.join(' '));
  if (input.offerShares > input.totalShares * 0.49 || input.offerShares < input.totalShares * 0.1) fail('bad_offer', 'Tỷ lệ chào bán phải từ 10% đến 49% tổng số cổ phần.');
  if (input.offerShares % LOT || input.totalShares % LOT) fail('lot', `Số cổ phần phải là bội số của ${LOT}.`);
  if (input.offerPrice % TICK) fail('tick', `Giá phải là bội số của ${TICK} ₫.`);
  // Valuation sanity check: offer price cannot exceed 20× book value per share.
  if (input.offerPrice * input.totalShares > Math.max(el.equity, 1) * 20) fail('overvalued', 'Giá chào bán vượt quá 20 lần giá trị sổ sách. Hãy giảm giá IPO.');
  if (await maybe(tx, 'SELECT 1 FROM instruments WHERE symbol=$1', [input.symbol])) fail('symbol_taken', 'Mã chứng khoán đã tồn tại.', 409);

  await tx.query('INSERT INTO instruments (symbol, company_id, ipo_price, last_price, listed_minute) VALUES ($1,$2,$3,$3,$4)', [input.symbol, c.id, input.offerPrice, minute]);
  await tx.query('UPDATE companies SET shares_total=$2 WHERE id=$1', [c.id, input.totalShares]);
  const founderShares = input.totalShares - input.offerShares;
  const founderCost = -(await balance(tx, acct('company', c.id, 'share_capital')));
  await tx.query('INSERT INTO holdings (symbol, holder_type, holder_id, qty, cost) VALUES ($1,$2,$3,$4,$5)', [input.symbol, 'user', c.owner_user_id, founderShares, founderCost]);
  await tx.query('INSERT INTO holdings (symbol, holder_type, holder_id, qty, locked) VALUES ($1,$2,$3,$4,$4)', [input.symbol, 'company', c.id, input.offerShares]);
  await tx.query(`INSERT INTO orders (symbol, owner_type, owner_id, side, type, price, qty, is_ipo) VALUES ($1,'company',$2,'sell','limit',$3,$4,true)`, [input.symbol, c.id, input.offerPrice, input.offerShares]);
  await tx.query('INSERT INTO disclosures (symbol, title, body, game_minute) VALUES ($1,$2,$3,$4)', [
    input.symbol,
    `Niêm yết ${input.symbol}`,
    `${c.name} chào bán ${input.offerShares.toLocaleString('vi-VN')} cổ phần giá ${input.offerPrice.toLocaleString('vi-VN')} ₫. Tổng số cổ phần: ${input.totalShares.toLocaleString('vi-VN')}.`,
    minute,
  ]);
  await audit(tx, actorId, 'exchange.ipo', 'instrument', input.symbol, input);
}

async function lockInstrument(tx: Tx, symbol: string) {
  const ins = await maybe<Instrument>(tx, 'SELECT * FROM instruments WHERE symbol=$1 FOR UPDATE', [symbol]);
  if (!ins) return fail('no_symbol', 'Mã chứng khoán không tồn tại.', 404);
  return ins;
}

async function holding(tx: Tx, symbol: string, o: Owner) {
  await tx.query('INSERT INTO holdings (symbol, holder_type, holder_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [symbol, o.type, o.id]);
  return one<{ qty: number; locked: number; cost: number }>(tx, 'SELECT qty, locked, cost FROM holdings WHERE symbol=$1 AND holder_type=$2 AND holder_id=$3 FOR UPDATE', [symbol, o.type, o.id]);
}

/**
 * Place an order. The instrument row is locked, so matching for one symbol is serial.
 *  - limit buy: cash for qty × limit price is moved to cash_locked first;
 *  - sell: shares are locked first;
 *  - market orders only take existing liquidity (immediate-or-cancel) and never rest.
 * Matching: best price first, then earliest order (seq). Trades execute at the resting price.
 */
export async function placeOrder(tx: Tx, owner: Owner, input: { symbol: string; side: 'buy' | 'sell'; type: 'limit' | 'market'; qty: number; price?: number }, minute: number) {
  const ins = await lockInstrument(tx, input.symbol);
  if (ins.status !== 'listed') fail('halted', 'Mã đang tạm ngừng giao dịch.');
  if (input.qty % LOT) fail('lot', `Khối lượng phải là bội số của ${LOT}.`);
  if (input.type === 'limit') {
    if (!input.price) fail('price_required', 'Lệnh giới hạn cần có giá.');
    if (input.price! % TICK) fail('tick', `Giá phải là bội số của ${TICK} ₫.`);
    const ref = ins.last_price ?? ins.ipo_price;
    if (input.price! > ref * 1.3 || input.price! < ref * 0.7) fail('price_band', `Giá phải trong biên độ ±30% quanh giá tham chiếu ${ref.toLocaleString('vi-VN')} ₫.`);
  }
  if (owner.type === 'company' && owner.id === ins.company_id) fail('self_trade', 'Doanh nghiệp không tự giao dịch cổ phiếu của mình ngoài đợt IPO.');

  let lockedCash = 0;
  if (input.side === 'buy' && input.type === 'limit') {
    lockedCash = input.qty * input.price!;
  } else if (input.side === 'buy') {
    // Market buy: lock exactly the cost of the liquidity currently available.
    const asks = await many<{ price: number; qty: number; filled: number }>(tx, `SELECT price, qty, filled FROM orders WHERE symbol=$1 AND side='sell' AND status='open' AND NOT (owner_type=$2 AND owner_id=$3) ORDER BY price, seq`, [input.symbol, owner.type, owner.id]);
    let need = input.qty;
    for (const a of asks) {
      if (need <= 0) break;
      const f = Math.min(need, a.qty - a.filled);
      lockedCash += f * a.price;
      need -= f;
    }
    if (lockedCash === 0) fail('no_liquidity', 'Không có lệnh bán đối ứng. Hãy đặt lệnh giới hạn để chờ khớp.');
  } else {
    const h = await holding(tx, input.symbol, owner);
    if (h.qty - h.locked < input.qty) fail('insufficient_shares', 'Không đủ cổ phiếu khả dụng.');
    await tx.query('UPDATE holdings SET locked = locked + $4 WHERE symbol=$1 AND holder_type=$2 AND holder_id=$3', [input.symbol, owner.type, owner.id, input.qty]);
  }
  const order = await one<Order>(
    tx,
    `INSERT INTO orders (symbol, owner_type, owner_id, side, type, price, qty, locked_cash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [input.symbol, owner.type, owner.id, input.side, input.type, input.type === 'limit' ? input.price : null, input.qty, lockedCash],
  );
  if (lockedCash > 0) {
    await post(tx, {
      key: `order:lock:${order.id}`,
      kind: 'order_lock',
      memo: `Phong tỏa tiền lệnh mua ${input.qty} ${input.symbol}`,
      minute,
      ref: { type: 'order', id: order.id },
      lines: [
        { ...A(owner, 'cash'), amount: -lockedCash },
        { ...A(owner, 'cash_locked'), amount: lockedCash },
      ],
    });
  }
  const trades = await match(tx, ins, order, minute);
  const fresh = await one<Order>(tx, 'SELECT * FROM orders WHERE id=$1', [order.id]);
  if (fresh.type === 'market' && fresh.status === 'open') await cancelOrderInternal(tx, fresh, minute, 'IOC');
  return { orderId: order.id, trades };
}

async function match(tx: Tx, ins: Instrument, incoming: Order, minute: number) {
  const opp = incoming.side === 'buy' ? 'sell' : 'buy';
  const priceOrder = incoming.side === 'buy' ? 'price ASC' : 'price DESC';
  const book = await many<Order>(
    tx,
    `SELECT * FROM orders WHERE symbol=$1 AND side=$2 AND status='open' AND id <> $3 ORDER BY ${priceOrder}, seq FOR UPDATE`,
    [ins.symbol, opp, incoming.id],
  );
  let remaining = incoming.qty - incoming.filled;
  let trades = 0;
  let lastPrice = ins.last_price;
  for (const rest of book) {
    if (remaining <= 0) break;
    if (incoming.type === 'limit') {
      if (incoming.side === 'buy' && rest.price! > incoming.price!) break;
      if (incoming.side === 'sell' && rest.price! < incoming.price!) break;
    }
    // Self-match prevention: skip own resting orders.
    if (rest.owner_type === incoming.owner_type && rest.owner_id === incoming.owner_id) continue;
    const price = rest.price!;
    const buy = incoming.side === 'buy' ? incoming : rest;
    const sell = incoming.side === 'sell' ? incoming : rest;
    let qty = Math.min(remaining, rest.qty - rest.filled);
    if (buy.type === 'market') {
      // Fill only what the locked cash covers.
      qty = Math.min(qty, Math.floor(buy.locked_cash / price / LOT) * LOT);
      if (qty <= 0) break;
    }
    if (qty <= 0) continue;
    await settle(tx, ins, buy, sell, qty, price, minute);
    buy.locked_cash -= qty * price;
    buy.filled += qty;
    sell.filled += qty;
    remaining -= qty;
    trades++;
    lastPrice = price;
    for (const o of [buy, sell]) {
      const done = o.filled >= o.qty;
      await tx.query(`UPDATE orders SET filled=$2, locked_cash=$3, status=$4 WHERE id=$1`, [o.id, o.filled, o.locked_cash, done ? 'filled' : 'open']);
      if (done && o.side === 'buy' && o.locked_cash > 0) await releaseCash(tx, o, minute, 'refund');
    }
  }
  if (trades > 0) await tx.query('UPDATE instruments SET last_price=$2 WHERE symbol=$1', [ins.symbol, lastPrice]);
  return trades;
}

async function settle(tx: Tx, ins: Instrument, buy: Order, sell: Order, qty: number, price: number, minute: number) {
  const value = qty * price;
  const buyer: Owner = { type: buy.owner_type, id: buy.owner_id };
  const seller: Owner = { type: sell.owner_type, id: sell.owner_id };
  const sh = await holding(tx, ins.symbol, seller);
  const costOut = sh.qty === qty ? sh.cost : Math.round((sh.cost * qty) / sh.qty);
  await tx.query('UPDATE holdings SET qty = qty - $4, locked = locked - $4, cost = cost - $5 WHERE symbol=$1 AND holder_type=$2 AND holder_id=$3', [ins.symbol, seller.type, seller.id, qty, costOut]);
  await holding(tx, ins.symbol, buyer);
  await tx.query('UPDATE holdings SET qty = qty + $4, cost = cost + $5 WHERE symbol=$1 AND holder_type=$2 AND holder_id=$3', [ins.symbol, buyer.type, buyer.id, qty, value]);
  const t = await one<{ id: number }>(tx, 'INSERT INTO trades (symbol, buy_order_id, sell_order_id, price, qty, game_minute) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [ins.symbol, buy.id, sell.id, price, qty, minute]);

  const lines: Line[] = [
    { ...A(buyer, 'cash_locked'), amount: -value },
    { ...A(buyer, 'investments'), amount: value },
  ];
  if (sell.is_ipo) {
    // New shares issued by the company: proceeds are share capital.
    lines.push({ ...A(seller, 'cash'), amount: value }, { ...A(seller, 'share_capital'), amount: -value });
  } else {
    lines.push({ ...A(seller, 'cash'), amount: value }, { ...A(seller, 'investments'), amount: -costOut }, { ...A(seller, 'trading_gain'), amount: -(value - costOut) });
  }
  await post(tx, { key: `trade:${t.id}`, kind: 'stock_trade', memo: `Khớp ${qty} ${ins.symbol} @ ${price.toLocaleString('vi-VN')} ₫`, minute, ref: { type: 'trade', id: String(t.id) }, lines });
  for (const [o, side] of [[buyer, 'mua'], [seller, 'bán']] as const) {
    if (o.type === 'user') await notify(tx, o.id, 'exchange', `Khớp lệnh ${side} ${ins.symbol}`, `${qty.toLocaleString('vi-VN')} cổ phiếu @ ${price.toLocaleString('vi-VN')} ₫`, { symbol: ins.symbol });
  }
}

async function releaseCash(tx: Tx, o: Order, minute: number, reason: string) {
  if (o.locked_cash <= 0) return;
  const owner: Owner = { type: o.owner_type, id: o.owner_id };
  await post(tx, {
    key: `order:release:${o.id}:${reason}`,
    kind: 'order_release',
    memo: `Giải phóng tiền phong tỏa lệnh ${o.symbol}`,
    minute,
    ref: { type: 'order', id: o.id },
    lines: [
      { ...A(owner, 'cash_locked'), amount: -o.locked_cash },
      { ...A(owner, 'cash'), amount: o.locked_cash },
    ],
  });
  await tx.query('UPDATE orders SET locked_cash = 0 WHERE id=$1', [o.id]);
}

async function cancelOrderInternal(tx: Tx, o: Order, minute: number, reason: string) {
  const left = o.qty - o.filled;
  if (o.side === 'buy') await releaseCash(tx, o, minute, reason);
  else if (left > 0) await tx.query('UPDATE holdings SET locked = locked - $4 WHERE symbol=$1 AND holder_type=$2 AND holder_id=$3', [o.symbol, o.owner_type, o.owner_id, left]);
  await tx.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [o.id]);
}

export async function cancelOrder(tx: Tx, owner: Owner, orderId: string, minute: number) {
  const pre = await maybe<{ symbol: string }>(tx, 'SELECT symbol FROM orders WHERE id=$1', [orderId]);
  if (!pre) return fail('not_found', 'Không tìm thấy lệnh.', 404);
  await lockInstrument(tx, pre.symbol);
  const o = await maybe<Order>(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
  if (!o || o.owner_type !== owner.type || o.owner_id !== owner.id) return fail('not_found', 'Không tìm thấy lệnh.', 404);
  if (o.status !== 'open') fail('not_open', 'Lệnh đã khớp hết hoặc đã hủy.');
  await cancelOrderInternal(tx, o, minute, 'cancel');
}

/** Cash dividend paid pro-rata to outside holders; treasury shares (unsold IPO) receive nothing. */
export async function payDividend(tx: Tx, actorId: string, c: CompanyRow, perShare: number, minute: number, key: string) {
  const ins = await maybe<Instrument>(tx, 'SELECT * FROM instruments WHERE company_id=$1', [c.id]);
  if (!ins) return fail('not_listed', 'Doanh nghiệp chưa niêm yết.');
  const holders = await many<{ holder_type: 'user' | 'company'; holder_id: string; qty: number }>(tx, `SELECT holder_type, holder_id, qty FROM holdings WHERE symbol=$1 AND qty > 0 AND NOT (holder_type='company' AND holder_id=$2)`, [ins.symbol, c.id]);
  const total = holders.reduce((s, h) => s + h.qty * perShare, 0);
  const lines: Line[] = [
    { ...acct('company', c.id, 'dividends_paid'), amount: total },
    { ...acct('company', c.id, 'cash'), amount: -total },
  ];
  for (const h of holders) {
    const amt = h.qty * perShare;
    lines.push({ ...acct(h.holder_type, h.holder_id, 'cash'), amount: amt }, { ...acct(h.holder_type, h.holder_id, 'dividend_income'), amount: -amt });
  }
  const res = await post(tx, { key, kind: 'dividend', memo: `Cổ tức ${perShare.toLocaleString('vi-VN')} ₫/cổ phiếu ${ins.symbol}`, minute, actorId, ref: { type: 'instrument', id: ins.symbol }, lines });
  if (!res.created) fail('duplicate', 'Đã chi trả cổ tức này.', 409);
  await tx.query('INSERT INTO dividends (symbol, per_share, total, game_minute) VALUES ($1,$2,$3,$4)', [ins.symbol, perShare, total, minute]);
  await tx.query('INSERT INTO disclosures (symbol, title, body, game_minute) VALUES ($1,$2,$3,$4)', [ins.symbol, 'Chi trả cổ tức', `${perShare.toLocaleString('vi-VN')} ₫/cổ phiếu, tổng ${total.toLocaleString('vi-VN')} ₫.`, minute]);
  for (const h of holders) if (h.holder_type === 'user') await notify(tx, h.holder_id, 'exchange', `Nhận cổ tức ${ins.symbol}`, `${(h.qty * perShare).toLocaleString('vi-VN')} ₫`, { symbol: ins.symbol });
  return total;
}

export async function orderBook(q: Queryable, symbol: string) {
  const levels = async (side: 'buy' | 'sell') =>
    many<{ price: number; qty: number; orders: number }>(
      q,
      `SELECT price, SUM(qty - filled)::bigint AS qty, count(*)::int AS orders FROM orders WHERE symbol=$1 AND side=$2 AND status='open' AND type='limit'
       GROUP BY price ORDER BY price ${side === 'buy' ? 'DESC' : 'ASC'} LIMIT 10`,
      [symbol, side],
    );
  return { bids: await levels('buy'), asks: await levels('sell') };
}
