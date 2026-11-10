import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Good = { code: string; name: string; unit: string; category: 'raw' | 'consumer'; ref_price: number; spoil_per_day: number };
export type Industry = { code: string; name: string; description: string; kind: string; tax_rate: number; register_fee: number; min_capital: number; license_hours: number; open_hour: number; close_hour: number; icon: string };
export type Recipe = { code: string; industry_code: string; name: string; output_good: string; output_qty: number; labor_hours: number; equipment: string; inputs: { good: string; qty: number }[] };
export type EquipmentType = { code: string; name: string; price: number; batches_per_hour: number; maintenance_day: number };
export type Location = { code: string; name: string; region: string; rent_day: number; traffic: number; logistics_km: number };
export type Catalog = { goods: Good[]; industries: Industry[]; recipes: Recipe[]; equipment: EquipmentType[]; locations: Location[] };

export function useCatalog() {
  const q = useQuery({ queryKey: ['catalog'], queryFn: () => api<Catalog>('/catalog'), staleTime: Infinity });
  const c = q.data;
  return {
    ...q,
    good: (code: string) => c?.goods.find((g) => g.code === code),
    industry: (code: string) => c?.industries.find((i) => i.code === code),
    equipmentType: (code: string) => c?.equipment.find((e) => e.code === code),
  };
}
