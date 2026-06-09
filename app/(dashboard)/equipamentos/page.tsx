import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { EquipamentosListaClient } from "./equipamentos-lista-client";

export const metadata: Metadata = { title: "Equipamentos" };

export default async function EquipamentosPage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const equipamentos = await prisma.equipamento.findMany({
    where: { empresaId },
    include: {
      unidade: {
        select: { id: true, nome: true, cliente: { select: { id: true, nome: true, nomeFantasia: true } } },
      },
      qrcode: { select: { id: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 500,
  });

  const lista = equipamentos.map((eq) => ({
    id: eq.id,
    nome: eq.nome || `${eq.marca} ${eq.modelo}`,
    marca: eq.marca,
    modelo: eq.modelo,
    numeroSerie: eq.numeroSerie ?? null,
    tipo: eq.tipo,
    tipoLabel: LABELS_TIPO_EQUIPAMENTO[eq.tipo] ?? eq.tipo,
    foto: eq.fotos?.[0] ?? null,
    ambiente: eq.localizacao ?? null,
    fluido: eq.fluido ?? null,
    ativo: eq.ativo,
    temQr: !!eq.qrcode,
    dataInstalacao: eq.dataInstalacao ? eq.dataInstalacao.toISOString() : null,
    clienteId: eq.unidade.cliente.id,
    cliente: eq.unidade.cliente.nomeFantasia ?? eq.unidade.cliente.nome,
    unidadeId: eq.unidade.id,
    unidade: eq.unidade.nome,
  }));

  return <EquipamentosListaClient equipamentos={lista} />;
}
