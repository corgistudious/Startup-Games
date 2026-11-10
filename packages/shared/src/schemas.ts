import { z } from 'zod';

const money = z.number().int().positive().max(1e14);
const qty = z.number().int().positive().max(1_000_000);

export const registerSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_.]+$/, 'Chỉ dùng chữ, số, dấu chấm và gạch dưới'),
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(2).max(40),
});
export const loginSchema = z.object({ username: z.string().trim().min(1).max(24), password: z.string().min(1).max(200) });
export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  bio: z.string().trim().max(300).optional(),
});

export const createCompanySchema = z.object({
  name: z.string().trim().min(3).max(60),
  industry: z.string().min(1).max(40),
  location: z.string().min(1).max(40),
  capital: money,
  description: z.string().trim().max(500).optional(),
});
export const capitalSchema = z.object({ amount: money });
export const hireSchema = z.object({ personId: z.string().uuid(), wage: money, shift: z.enum(['day', 'night', 'part', 'rotating']), department: z.enum(['san_xuat', 'ban_hang', 'kho_van', 'marketing', 'tai_chinh', 'dieu_hanh']) });
export const equipmentBuySchema = z.object({ type: z.string().min(1).max(40), count: z.number().int().min(1).max(20) });
export const productionSchema = z.object({ recipe: z.string().min(1).max(40), batches: z.number().int().min(1).max(500) });
export const listingSchema = z.object({ good: z.string().min(1).max(40), price: money, active: z.boolean(), b2b: z.boolean().default(false) });
export const purchaseSchema = z.object({ sellerCompanyId: z.string().uuid(), good: z.string().min(1).max(40), qty, maxUnitPrice: money });
export const campaignSchema = z.object({ channel: z.enum(['to_roi', 'mang_xa_hoi', 'bao_chi', 'truyen_hinh']), budget: money, days: z.number().int().min(1).max(28) });
export const loanSchema = z.object({ amount: money, termDays: z.number().int().min(7).max(84) });
export const repaySchema = z.object({ amount: money });
export const transferSchema = z.object({ toUsername: z.string().trim().min(3).max(24), amount: money, memo: z.string().trim().max(120).optional() });

export const ipoSchema = z.object({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z]{3,5}$/), totalShares: z.number().int().min(100_000).max(1_000_000_000), offerShares: z.number().int().positive(), offerPrice: money });
export const orderSchema = z.object({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z]{3,5}$/), side: z.enum(['buy', 'sell']), type: z.enum(['limit', 'market']), qty, price: money.optional() });
export const dividendSchema = z.object({ perShare: money });

export const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().min(20).max(1500) });
export const reviewReplySchema = z.object({ body: z.string().trim().min(2).max(800) });
export const reportSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export const quizAnswerSchema = z.object({ answers: z.array(z.number().int().min(0).max(3)).length(5) });
export const ticketSchema = z.object({ subject: z.string().trim().min(4).max(120), body: z.string().trim().min(10).max(3000) });
export const ticketReplySchema = z.object({ body: z.string().trim().min(1).max(3000) });

export const reasonSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export const adminRoleSchema = z.object({ role: z.enum(['player', 'admin']), reason: z.string().trim().min(5).max(300) });
export const broadcastSchema = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000) });
