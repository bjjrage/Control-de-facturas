import { z } from "zod";
export const directItemSchema = z.object({
  product: z.string().trim().min(1),
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1),
  unit_price: z.number().finite().positive(),
  tax_rate: z.number().finite().min(0).max(100),
  producto_id: z.string().uuid().nullable().optional(),
  expected_delivery_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export interface DirectPreview {
  id: string;
  hash: string;
  snapshot: {
    provider_name: string;
    provider_id: string;
    project_id: string | null;
    currency: string;
    vat_included: boolean;
    payment_terms: string;
    observations: string | null;
    freight: number;
    total: number;
    items: Array<z.infer<typeof directItemSchema> & { total_price: number }>;
  };
}
