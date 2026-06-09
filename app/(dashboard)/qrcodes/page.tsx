import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { QrcodesClient } from "./qrcodes-client";

export const metadata: Metadata = { title: "QR Codes" };

export default async function QrcodesPage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [qrcodes, equipamentosLivres] = await Promise.all([
    prisma.qrcode.findMany({
      where: { empresaId },
      include: {
        equipamento: { select: { id: true, marca: true, modelo: true, localizacao: true, unidade: { select: { nome: true } } } },
      },
      orderBy: { criadoEm: "desc" },
    }),
    prisma.equipamento.findMany({
      where: { empresaId, ativo: true, qrcode: null },
      select: { id: true, marca: true, modelo: true, localizacao: true, unidade: { select: { nome: true } } },
      orderBy: [{ marca: "asc" }, { modelo: "asc" }],
    }),
  ]);

  const lista = qrcodes.map((q) => ({
    id: q.id,
    codigo: q.codigo,
    ativo: q.ativo,
    criadoEm: q.criadoEm.toISOString(),
    equipamento: q.equipamento
      ? {
          id: q.equipamento.id,
          nome: `${q.equipamento.marca} ${q.equipamento.modelo}`,
          local: q.equipamento.unidade?.nome ?? q.equipamento.localizacao ?? null,
        }
      : null,
  }));

  const equipamentos = equipamentosLivres.map((e) => ({
    id: e.id,
    nome: `${e.marca} ${e.modelo}${e.unidade?.nome ? ` — ${e.unidade.nome}` : ""}`,
  }));

  return <QrcodesClient lista={lista} equipamentosLivres={equipamentos} />;
}
