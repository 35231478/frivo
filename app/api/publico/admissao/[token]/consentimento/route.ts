import { NextRequest } from "next/server";
import { consentir } from "@/lib/admissao/admissao-server";
import { ipDaRequisicao, responderPublico } from "@/lib/admissao/admissao-rotas";

/**
 * Consentimento LGPD: sem ele o formulário não abre. Grava data/hora, IP e navegador — a mesma
 * prova do aceite da OS.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return responderPublico(req, () => consentir(token, {
    ip: ipDaRequisicao(req.headers), userAgent: req.headers.get("user-agent"),
  }));
}
