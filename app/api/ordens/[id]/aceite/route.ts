import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ipDaRequisicao } from "@/lib/orcamentos/ciclo";
import { aceiteLocalSchema, caminhoPublicoAceite, estadoDoAceite } from "@/lib/os/aceite";
import { aceiteDaOs, registrarAceiteLocal } from "@/lib/os/aceite-server";
import { guardaDoAceite, responderAceite } from "@/lib/os/aceite-rotas";

type Params = { params: Promise<{ id: string }> };

/** O aceite do cliente desta OS: o estado, quem confirmou e como, e o link de confirmação. Exige "OS › Visualizar". */
export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoAceite(id, "visualizar");
  if (!ator) return resposta;
  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId: ator.empresaId }, select: { status: true } });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  const aceite = await aceiteDaOs(id, ator.empresaId, { comAssinatura: true });
  return NextResponse.json(
    { estado: estadoDoAceite(os.status, aceite), statusOs: os.status, aceite, caminhoPublico: aceite ? caminhoPublicoAceite(aceite.token) : null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Aceite NO LOCAL: o responsável do cliente assina na tela de quem está com ele (nome + assinatura).
 * Exige "OS › Editar" e a OS concluída. O app do técnico usa a fila offline (operação "aceite").
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoAceite(id, "editar");
  if (!ator) return resposta;
  const parsed = aceiteLocalSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  return responderAceite(async () => {
    const r = await registrarAceiteLocal(
      { empresaId: ator.empresaId, usuarioId: ator.usuarioId, osId: id, exigirOsConcluida: true, vistoPeloEscritorio: !ator.restrito }, parsed.data,
      { ip: ipDaRequisicao(req.headers), userAgent: req.headers.get("user-agent") },
    );
    return { estado: "CONFIRMADO", jaEstava: r.jaEstava, aceite: await aceiteDaOs(id, ator.empresaId, { comAssinatura: true }) };
  });
}
