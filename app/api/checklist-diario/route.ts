import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { chaveValida, hojeBR, somarDias } from "@/lib/checklist-diario/regras";
import { historicoDiario } from "@/lib/checklist-diario/servidor";

/**
 * GET /api/checklist-diario?de=AAAA-MM-DD&ate=AAAA-MM-DD — histórico do checklist obrigatório no app (Veículos ›
 * Checklist › Diário): quem fez, quando, qual veículo, a situação, as fotos (pelo checklist), os "não vai usar" e os
 * dias sem registro. Padrão: os últimos 7 dias. Abrir o histórico dá ciência dos "não vai usar" (saem do sino).
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("veiculos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { searchParams } = new URL(req.url);
  const hoje = hojeBR();
  const ate = chaveValida(searchParams.get("ate")) ? searchParams.get("ate")! : hoje;
  const de = chaveValida(searchParams.get("de")) ? searchParams.get("de")! : somarDias(ate, -6);
  if (de > ate) return NextResponse.json({ erro: "Período inválido." }, { status: 400 });
  if (somarDias(de, 366) < ate) return NextResponse.json({ erro: "Período de até um ano." }, { status: 400 });
  const r = await historicoDiario(guard.session.user!.empresaId, de, ate, { marcarVistos: true });
  return NextResponse.json({ de, ate, hoje: r.hoje, ativo: r.config.ativo, linhas: r.linhas });
}
