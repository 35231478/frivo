import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { TIPOS_IMAGEM } from "@/lib/anexos";
import { validarDataUrl } from "@/lib/anexos-server";
import { contextoExecucao, itemDoEquipamento, marcarAtendido } from "@/lib/execucao/contexto";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string }> };

/** Fotos por equipamento numa atividade (rota do Next não pode exportar outras constantes) */
const MAX_FOTOS_EQUIPAMENTO = 40;
const TAMANHO_MAX_FOTO = 5 * 1024 * 1024;

const schema = z.object({ dataUrl: z.string().min(30), itemId: z.string().min(1).nullable().optional() }).strict();

/** Uma foto DESTE equipamento (geral ou de um item do checklist). Nunca é copiada para outro equipamento. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, atividadeId, equipamentoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Foto inválida." }, { status: 400 });

  const vinculo = ctx.vinculo!;
  const itemId = parsed.data.itemId ?? null;
  if (itemId && !(await itemDoEquipamento(ctx.empresaId, atividadeId, vinculo.equipamento, itemId)))
    return NextResponse.json({ erro: "Este item não é do checklist deste equipamento." }, { status: 400 });

  const v = validarDataUrl(parsed.data.dataUrl, "foto.jpg", { tipos: TIPOS_IMAGEM, tamanhoMax: TAMANHO_MAX_FOTO, mensagemTipo: "Envie uma foto (JPG, PNG, WEBP ou HEIC)." });
  if (!v.ok) return NextResponse.json({ erro: v.erro }, { status: 400 });
  const ja = await prisma.fotoAtendimento.count({ where: { atividadeId, equipamentoId } });
  if (ja >= MAX_FOTOS_EQUIPAMENTO) return NextResponse.json({ erro: `Limite de ${MAX_FOTOS_EQUIPAMENTO} fotos por equipamento nesta atividade.` }, { status: 400 });

  const foto = await prisma.fotoAtendimento.create({
    data: { empresaId: ctx.empresaId, atividadeId, equipamentoId, itemId, url: v.arquivo.conteudo, criadoPorId: ctx.usuarioId },
    select: { id: true, itemId: true, criadoEm: true },
  });
  await marcarAtendido(vinculo);
  return NextResponse.json({ ...foto, feito: true }, { status: 201 });
}
