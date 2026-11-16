import { NextRequest } from "next/server";
import { salvarRascunho } from "@/lib/admissao/admissao-server";
import { corpo, responderPublico } from "@/lib/admissao/admissao-rotas";

/**
 * Salva o rascunho: o colaborador fecha e volta sem perder nada. O JSON é reconstruído campo a
 * campo no servidor (nada que chegue pelo link entra cru no banco).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await corpo(req);
  return responderPublico(req, () => salvarRascunho(token, b.form, typeof b.etapa === "string" ? b.etapa : null));
}
