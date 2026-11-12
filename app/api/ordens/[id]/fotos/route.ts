import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { osDaEmpresa } from "@/lib/os-server";
import { carregarGaleria } from "@/lib/os/galeria-server";

type Params = { params: Promise<{ id: string }> };

/** "Fotos & Anexos do serviço": fotos de todas as origens (por equipamento) e os documentos da OS. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  if (!(await osDaEmpresa(id, empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json(await carregarGaleria(empresaId, id), { headers: { "Cache-Control": "private, no-store" } });
}
