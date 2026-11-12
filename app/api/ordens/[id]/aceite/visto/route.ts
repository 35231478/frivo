import { NextRequest } from "next/server";
import { marcarAceiteVisto } from "@/lib/os/aceite-server";
import { guardaDoAceite, responderAceite } from "@/lib/os/aceite-rotas";

/**
 * "Visto": alguém do escritório abriu a OS depois de o cliente confirmar (com ou sem ressalva) — o
 * aviso sai do sino de todos. Exige "OS › Editar" (quem pode tratar a ressalva). Idempotente: chamar
 * de novo não muda nada (`marcou: false`).
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoAceite(id, "editar");
  if (!ator) return resposta;
  return responderAceite(async () => ({ ok: true, marcou: await marcarAceiteVisto(id, ator.empresaId) }));
}
