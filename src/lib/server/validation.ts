import { z } from "zod";
import { AppError } from "./errors";

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError("Unsupported content type", {
      code: "UNSUPPORTED_CONTENT_TYPE",
      status: 415,
      expose: true,
    });
  }

  const body = await request.json().catch(() => {
    throw new AppError("Invalid JSON body", {
      code: "INVALID_JSON",
      status: 400,
      expose: true,
    });
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("Invalid request body", {
      code: "VALIDATION_ERROR",
      status: 400,
      expose: true,
    });
  }

  return parsed.data;
}
