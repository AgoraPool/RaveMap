import { AppError, isAppError } from "./errors";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: JSON_HEADERS,
  });
}

export function jsonRateLimited(code: string, message: string, retryAfterSeconds = 60): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
      },
    }),
    {
      status: 429,
      headers: {
        ...JSON_HEADERS,
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

export function jsonError(error: AppError | Error): Response {
  if (isAppError(error)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: error.code,
          message: error.expose ? error.message : "Požadavek selhal.",
        },
      }),
      {
        status: error.status,
        headers: JSON_HEADERS,
      },
    );
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Požadavek selhal.",
        ...(import.meta.env.DEV
          ? {
              debug: {
                name: error.name,
                message: error.message,
              },
            }
          : {}),
      },
    }),
    {
      status: 500,
      headers: JSON_HEADERS,
    },
  );
}

export async function withApiErrorHandling(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof Error) {
      return jsonError(error);
    }

    return jsonError(new AppError("Neznámá chyba serveru"));
  }
}
