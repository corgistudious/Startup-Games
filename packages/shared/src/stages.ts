export const STAGES = [
  { stage: 1, name: 'Cá nhân' },
  { stage: 2, name: 'Doanh nghiệp nhỏ' },
  { stage: 3, name: 'Doanh nghiệp vừa' },
  { stage: 4, name: 'Doanh nghiệp lớn' },
  { stage: 5, name: 'Tập đoàn' },
] as const;
export const stageName = (s: number) => STAGES.find((x) => x.stage === s)?.name ?? 'Cá nhân';

export const DEPARTMENTS = {
  san_xuat: 'Sản xuất',
  ban_hang: 'Bán hàng',
  kho_van: 'Kho vận',
  marketing: 'Marketing',
  tai_chinh: 'Tài chính',
  dieu_hanh: 'Điều hành',
} as const;
export const SHIFTS = { day: 'Ca ngày 8–17h', night: 'Ca đêm 22–6h', part: 'Bán thời gian 17–21h', rotating: 'Ca xoay 6–14h (7/7)' } as const;
export const CHANNELS = { to_roi: 'Tờ rơi', mang_xa_hoi: 'Mạng xã hội', bao_chi: 'Báo chí', truyen_hinh: 'Truyền hình' } as const;
