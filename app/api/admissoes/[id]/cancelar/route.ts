import { NextRequest } from "next/server";
import { cancelarAdmissao } from "@/lib/admissao/admissao-server";
import { corpo, guardaDoRh, responderAdmissao } from "@/lib/admissao/admissao-rotas";

/** Cancelar NÃO apaga: muda a situação e guarda a razão, quem cancelou e quando. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  const b = await corpo(req);
  return responderAdmissao(() => cancelarAdmissao(ator, id, typeof b.motivo === "string" ? b.motivo : ""));
}
