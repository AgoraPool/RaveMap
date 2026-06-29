import { z } from "zod";
import { AppError } from "./errors";

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError("Nepodporovaný typ obsahu", {
      code: "UNSUPPORTED_CONTENT_TYPE",
      status: 415,
      expose: true,
    });
  }

  const body = await request.json().catch(() => {
    throw new AppError("Neplatné JSON tělo požadavku", {
      code: "INVALID_JSON",
      status: 400,
      expose: true,
    });
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.length ? `${firstIssue.path.join(".")}: ` : "";
    const message = firstIssue ? `Neplatné tělo požadavku: ${path}${firstIssue.message}` : "Neplatné tělo požadavku";
    throw new AppError(message, {
      code: "VALIDATION_ERROR",
      status: 400,
      expose: true,
    });
  }

  return parsed.data;
}
