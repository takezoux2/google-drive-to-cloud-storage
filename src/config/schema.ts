import { z } from "zod";

export const destinationSchema = z
  .object({
    provider: z.enum(["gcs", "s3", "local"]),
    bucket: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    prefix: z.string().optional(),
    region: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === "local") {
      if (!data.path) {
        ctx.addIssue({
          code: "custom",
          message: 'path is required when provider is "local"',
          path: ["path"],
        });
      }
    } else if (!data.bucket) {
      ctx.addIssue({
        code: "custom",
        message: 'bucket is required when provider is "gcs" or "s3"',
        path: ["bucket"],
      });
    }
  });

export const mappingSchema = z.object({
  driveFolderId: z.string().min(1),
  destination: destinationSchema,
});

export const configSchema = z.object({
  mappings: z.array(mappingSchema).min(1),
});

export type Destination = z.infer<typeof destinationSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export type AppConfig = z.infer<typeof configSchema>;
