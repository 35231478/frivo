import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { respostaAnexo } from "@/lib/anexos-server";
import { anexoDaOcorrencia } from "@/lib/pmoc-ocorrencias-server";

/** A foto ou o PDF da ocorrência (?inline=1 abre no navegador). Exige "PMOC › Visualizar". */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; ocorrenciaId: string }> }) {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id, ocorrenciaId } = await params;
  const anexo = await anexoDaOcorrencia(id, ocorrenciaId, guard.session.user!.empresaId);
  if (!anexo) return NextResponse.json({ erro: "Esta ocorrência não tem anexo." }, { status: 404 });
  return respostaAnexo(anexo, req.nextUrl.searchParams.get("inline") === "1");
}
