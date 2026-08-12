import { z } from "zod";

export const destinationSchema = z.object({
  provider: z.enum(["gcs", "s3"]),
  bucket: z.string().min(1),
  prefix: z.string().optional(),
  region: z.string().optional(),
});

export const mappingSchema = z.object({
  driveFolderId: z.string().min(1),
  destination: destinationSchema,
});

export const configSchema = z.object({
  mappings: z.array(mappingSchema).min(1),
  concurrency: z.number().int().positive().optional(),
});

export type Destination = z.infer<typeof destinationSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export type AppConfig = z.infer<typeof configSchema>;
