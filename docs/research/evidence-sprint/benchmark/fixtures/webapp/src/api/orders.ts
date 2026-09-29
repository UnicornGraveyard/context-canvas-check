import { z } from "zod";

const createOrder = z.object({ sku: z.string(), quantity: z.number().int().positive() });

export async function POST(request: Request) {
  const parsed = createOrder.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID", message: "Invalid order" } }, { status: 400 });
  }
  return Response.json({ ok: true });
}
