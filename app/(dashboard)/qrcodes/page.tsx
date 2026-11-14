import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { QrcodesClient } from "./qrcodes-client";
import { espiarProximo } from "@/lib/numeracao-server";
import { localEquipamentoQr, nomeEquipamentoQr, rotuloParaVincular } from "@/lib/qrcode-rotulos";

export const metadata: Metadata = { title: "QR Codes" };

export default async function QrcodesPage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [qrcodes, equipamentosLivres, proximoCodigo] = await Promise.all([
    prisma.qrcode.findMany({
      where: { empresaId },
      include: {
        equipamento: { select: { id: true, nome: true, marca: true, modelo: true, localizacao: true, unidade: { select: { nome: true } } } },
      },
      orderBy: { criadoEm: "desc" },
    }),
    prisma.equipamento.findMany({
      where: { empresaId, ativo: true, qrcode: null },
      select: { id: true, nome: true, marca: true, modelo: true, localizacao: true, unidade: { select: { nome: true, cliente: { select: { nome: true, nomeFantasia: true } } } } },
      orderBy: [{ marca: "asc" }, { modelo: "asc" }],
    }),
    espiarProximo(empresaId, "qrcode"), // o contador de Configurações › Numeração (só espia, não consome)
  ]);

  const lista = qrcodes.map((q) => ({
    id: q.id,
    codigo: q.codigo,
    ativo: q.ativo,
    criadoEm: q.criadoEm.toISOString(),
    equipamento: q.equipamento
      ? {
          id: q.equipamento.id,
          nome: nomeEquipamentoQr(q.equipamento),
          local: localEquipamentoQr(q.equipamento),
        }
      : null,
  }));

  const equipamentos = equipamentosLivres.map((e) => ({
    id: e.id,
    nome: rotuloParaVincular(e),
  }));

  return <QrcodesClient lista={lista} equipamentosLivres={equipamentos} proximoCodigo={proximoCodigo} />;
}
