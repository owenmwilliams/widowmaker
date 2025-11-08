import { z } from "zod";

export const ConfidenceNumber = z.number().min(0).max(1);

export const Attribute = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    value: schema.nullable(),
    confidence: ConfidenceNumber.nullable(),
    source: z.string().nullable(),
  });

export const ItemSchema = z.object({
  schema_version: z.literal("1.0.0"),
  title: Attribute(z.string()),
  brand_or_producer: Attribute(z.string()),
  quantity: z.object({
    value: z.number().int().nullable(),
    confidence: ConfidenceNumber.nullable(),
    basis: z.enum(["instance_count", "label_text", "unsure"]).nullable(),
  }),
  size: z.object({
    value: z.number().nullable(),
    unit: z
      .enum(["mL", "L", "g", "kg", "oz", "lb", "cm", "mm", "in"])
      .nullable(),
    source: z.string().nullable(),
  }),
  dimensions: z.object({
    l: z.number().nullable(),
    w: z.number().nullable(),
    h: z.number().nullable(),
    unit: z.enum(["mm", "cm", "in"]).nullable(),
    source: z.string().nullable(),
  }),
  weight: z.object({
    value: z.number().nullable(),
    unit: z.enum(["g", "kg", "oz", "lb"]).nullable(),
    source: z.string().nullable(),
  }),
  color: z.object({
    name: z.string().nullable(),
    hex: z.string().regex(/^#?[0-9A-Fa-f]{6}$/).nullable(),
    lab: z.tuple([z.number(), z.number(), z.number()]).nullable(),
    source: z.string().nullable(),
  }),
  identifiers: z.object({
    isbn: z.string().nullable(),
    upc: z.string().nullable(),
    ean: z.string().nullable(),
    model: z.string().nullable(),
  }),
  attributes: z.record(z.string(), z.any()).optional(),
  low_confidence_fields: z.array(z.string()).default([]),
  sources: z
    .array(
      z.object({
        kind: z.string(),
        name: z.string().nullable(),
        value: z.string().nullable(),
        confidence: ConfidenceNumber.nullable(),
      })
    )
    .default([]),
});

export type Item = z.infer<typeof ItemSchema>;
