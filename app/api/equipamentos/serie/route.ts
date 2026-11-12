import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { descricaoEquipamento } from "@/lib/equipamento-descricao";

/**
 * GET /api/equipamentos/serie?numero=XYZ[&ignorar=<id>]
 * Equipamentos da empresa que já usam esse nº de série (sem diferenciar maiúsculas
 * e espaços nas pontas). Serve só para AVISAR de etiqueta duplicada no cadastro —
 * não bloqueia nada (há fabricantes que repetem série entre evaporadora/condensadora).
 */
export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["equipamentos", "criar"], ["equipamentos", "editar"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const { searchParams } = new URL(req.url);
  const numero = (searchParams.get("numero") ?? "").trim();
  const ignorar = searchParams.get("ignorar") ?? undefined;
  if (numero.length < 3) return NextResponse.json({ duplicados: [] });

  // btrim/lower no banco: pega também séries antigas salvas com espaço nas pontas
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM equipamentos
    WHERE empresa_id = ${empresaId} AND lower(btrim(numero_serie)) = lower(${numero})
      AND id <> ${ignorar ?? ""}
    LIMIT 5`;
  if (!ids.length) return NextResponse.json({ duplicados: [] });

  const achados = await prisma.equipamento.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    select: {
      id: true, tipo: true, capacidade: true, marca: true, modelo: true, ativo: true, localizacao: true,
      tipoEquipamento: { select: { nome: true } },
      unidade: { select: { nome: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
    },
    orderBy: { criadoEm: "asc" },
  });

  return NextResponse.json({
    duplicados: achados.map((e) => ({
      id: e.id,
      descricao: descricaoEquipamento(e),
      fabricanteModelo: [e.marca, e.modelo].filter(Boolean).join(" "),
      local: [e.unidade?.cliente?.nomeFantasia ?? e.unidade?.cliente?.nome, e.unidade?.nome, e.localizacao].filter(Boolean).join(" › "),
      ativo: e.ativo,
    })),
  });
}
