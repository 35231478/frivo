import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { pmocSchema } from "@/lib/pmoc";
import { ErroPmoc, dadosArt, paraData, validarVinculos } from "@/lib/pmoc-server";

/** Cria um PMOC (sempre começa como Rascunho: publicar exige RT, ART e equipamentos). */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("pmoc", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const parsed = pmocSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const d = parsed.data;
  try {
    await validarVinculos(empresaId, d);
    const pmoc = await prisma.pmoc.create({
      data: {
        empresaId, criadoPorId: session.user!.id, status: "RASCUNHO",
        nome: d.nome, descricao: d.descricao || null, clienteId: d.clienteId, unidadeId: d.unidadeId,
        dataInicio: paraData(d.dataInicio), dataExpiracao: paraData(d.dataExpiracao),
        responsavelTecnicoId: d.responsavelTecnicoId, rtNome: d.rtNome, rtCrea: d.rtCrea, artNumero: d.artNumero,
        ...dadosArt(d),
      },
      select: { id: true },
    });
    return NextResponse.json(pmoc, { status: 201 });
  } catch (e) {
    if (e instanceof ErroPmoc) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
