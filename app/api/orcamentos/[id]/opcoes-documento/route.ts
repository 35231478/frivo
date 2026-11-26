import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import {
  motivoOpcoesTravadas, opcoesDoDocumento, opcoesDocumentoEditaveis, STATUS_OPCOES_TRAVADAS,
} from "@/lib/orcamentos/documento-opcoes";

type Params = { params: Promise<{ id: string }> };

const corpo = z.object({ mostrarMateriais: z.boolean(), mostrarValoresMateriais: z.boolean() }).strict();

/**
 * PUT /api/orcamentos/[id]/opcoes-documento — Orçamento, leva D: "Mostrar materiais ao cliente" e "Mostrar valores
 * dos produtos/materiais" DESTE orçamento (link do cliente, impressão e PDF). Quem edita orçamento (Orçamentos ›
 * editar), só da empresa da sessão (outra empresa = 404). Valores só com materiais ligado. Aprovado, convertido ou
 * cancelado: 409 (o documento fica como foi aprovado). Só o preço de venda — o custo nunca vai ao documento.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Opções inválidas" }, { status: 400 });

  const o = await prisma.orcamento.findFirst({ where: { id, empresaId }, select: { status: true } });
  if (!o) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (!opcoesDocumentoEditaveis(o.status)) return NextResponse.json({ erro: motivoOpcoesTravadas(o.status) }, { status: 409 });

  const opcoes = opcoesDoDocumento(parsed.data);
  // O status entra no WHERE: aprovado entre a leitura e a gravação também não muda
  const r = await prisma.orcamento.updateMany({
    where: { id, empresaId, status: { notIn: [...STATUS_OPCOES_TRAVADAS] as never[] } },
    data: opcoes,
  });
  if (!r.count) return NextResponse.json({ erro: "O orçamento mudou de situação. Recarregue a página." }, { status: 409 });
  return NextResponse.json({ ok: true, ...opcoes });
}
