import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { espiarProximo } from "@/lib/numeracao-server";

/**
 * Sugere o próximo número de contrato (CT-AAAA-NNN) pelo contador da empresa (Configurações ›
 * Numeração de documentos) — só ESPIA, não consome: o número é confirmado quando o contrato é salvo
 * (o campo é digitável; o único (numero, empresa) barra repetição).
 */
export async function GET(_: NextRequest) {
  const guard = await exigirPermissao("contratos", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  return NextResponse.json({ numero: await espiarProximo(session.user!.empresaId, "contrato") });
}
