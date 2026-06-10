import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EquipesView } from "@/components/equipes/equipes-view";

export const metadata: Metadata = { title: "Equipes" };

export default async function EquipesPage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [grupos, colaboradores] = await Promise.all([
    prisma.equipe.findMany({
      where: { empresaId },
      include: {
        lider: { select: { id: true, nome: true, avatar: true } },
        membros: { select: { id: true, nome: true, avatar: true } },
        veiculos: { select: { id: true, placa: true } },
      },
      orderBy: { nome: "asc" },
    }),
    prisma.tecnico.findMany({
      where: { empresaId, ativo: true },
      select: {
        id: true, nome: true, avatar: true, tipoEquipe: true,
        cargo: { select: { nome: true } },
        perfilAcesso: { select: { nome: true, cor: true } },
      },
      orderBy: { nome: "asc" },
    }),
  ]);

  return <EquipesView grupos={grupos as any} colaboradores={colaboradores as any} />;
}
