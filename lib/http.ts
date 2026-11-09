// Every error response is { "error": "<message>" } (docs/spec.md).

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Turns thrown HttpErrors into JSON responses; anything else becomes a logged 500. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return jsonError(err.status, err.message);
  }
  console.error(err);
  return jsonError(500, "Internal server error");
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}
