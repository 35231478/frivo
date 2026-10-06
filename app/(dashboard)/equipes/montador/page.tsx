import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { LABELS_FUNCAO } from "@/lib/colaborador-listagem";
import { MontadorEquipes, type ColabMontador, type EquipeMontador } from "@/components/equipes/montador-equipes";

export const metadata: Metadata = { title: "Montar equipes" };

export default async function MontadorEquipesPage() {
  const session = await auth();
  const { permissoes, role, empresaId } = session!.user!;
  if (!pode(permissoes, "equipes", "visualizar", role)) redirect("/");

  const [equipes, colaboradores] = await Promise.all([
    prisma.equipe.findMany({
      where: { empresaId, status: "ATIVA" },
      select: {
        id: true, nome: true, cor: true, liderId: true,
        membros: { select: { id: true } },
        veiculos: { where: { status: { not: "INATIVO" } }, select: { placa: true } },
      },
      orderBy: { nome: "asc" },
    }),
    prisma.tecnico.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, tipo: true, statusColaborador: true, atualizadoEm: true, cargo: { select: { nome: true } } },
      orderBy: { nome: "asc" },
    }),
  ]);
  // Foto sob demanda (sem trafegar o base64 de todo mundo)
  const comFoto = new Set(
    colaboradores.length
      ? (await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM tecnicos WHERE empresa_id = ${empresaId} AND ativo = true AND avatar IS NOT NULL AND avatar <> ''`).map((r) => r.id)
      : [],
  );

  const colabs: ColabMontador[] = colaboradores.map((c) => ({
    id: c.id, nome: c.nome,
    funcao: c.cargo?.nome ?? LABELS_FUNCAO[c.tipo] ?? c.tipo,
    ausente: c.statusColaborador === "FERIAS" || c.statusColaborador === "AFASTADO" ? (c.statusColaborador === "FERIAS" ? "Férias" : "Afastado") : null,
    foto: comFoto.has(c.id) ? `/api/tecnicos/${c.id}/avatar?v=${c.atualizadoEm.getTime()}` : null,
  }));
  const ativos = new Set(colabs.map((c) => c.id));
  const eqs: EquipeMontador[] = equipes.map((e) => ({
    chave: e.id, id: e.id, nome: e.nome, cor: e.cor,
    liderId: e.liderId && ativos.has(e.liderId) ? e.liderId : null,
    // O líder conta como membro; colaboradores inativos não aparecem no quadro (e continuam vinculados)
    membros: [...new Set([...(e.liderId ? [e.liderId] : []), ...e.membros.map((m) => m.id)])].filter((id) => ativos.has(id)),
    veiculos: e.veiculos.map((v) => v.placa),
  }));

  return (
    <MontadorEquipes
      equipesIniciais={eqs}
      colaboradores={colabs}
      podeGerenciar={pode(permissoes, "equipes", "gerenciar", role)}
    />
  );
}
