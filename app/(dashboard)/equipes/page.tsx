import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { EquipesView } from "@/components/equipes/equipes-view";
import { janela, lerOrdem, lerPaginacao, ordemPrisma, paginaValida, um } from "@/lib/listagem";
import { ORDEM_COLABORADORES_EQUIPE, ORDEM_EQUIPES } from "@/lib/listas/ordenacao";

export const metadata: Metadata = { title: "Equipes" };

type Aba = "grupos" | "campo" | "administrativa";

/**
 * Equipes: três abas (grupos, equipe de campo, equipe administrativa), cada uma com busca ao vivo,
 * ordenação e paginação NO SERVIDOR (?aba=&q=&pagina=&por=&ordem=&dir=). Só a aba aberta é
 * carregada; as outras só contam (com a mesma busca).
 */
export default async function EquipesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const aba: Aba = sp.aba === "campo" || sp.aba === "administrativa" ? sp.aba : "grupos";
  const q = um(sp.q).trim();
  const inativas = sp.inativas === "1";
  const perfil = um(sp.perfil);
  const contem = { contains: q, mode: "insensitive" as const };

  // Equipe inativada (status INATIVA) fica fora da lista padrão
  const whereGrupos: Prisma.EquipeWhereInput = {
    empresaId, ...(inativas ? {} : { status: "ATIVA" }),
    ...(q ? { OR: [{ nome: contem }, { lider: { nome: contem } }, { membros: { some: { nome: contem } } }] } : {}),
  };
  const whereColab = (tipoEquipe: "CAMPO" | "ADMINISTRATIVO"): Prisma.TecnicoWhereInput => ({
    empresaId, ativo: true, tipoEquipe,
    ...(perfil ? { perfilAcesso: { nome: perfil } } : {}),
    ...(q ? { OR: [{ nome: contem }, { cargo: { nome: contem } }, { email: contem }] } : {}),
  });

  const [totalGrupos, totalCampo, totalAdm, perfis] = await Promise.all([
    prisma.equipe.count({ where: whereGrupos }),
    prisma.tecnico.count({ where: whereColab("CAMPO") }),
    prisma.tecnico.count({ where: whereColab("ADMINISTRATIVO") }),
    prisma.perfilAcesso.findMany({ where: { empresaId, colaboradores: { some: { ativo: true } } }, select: { nome: true, cor: true }, orderBy: { nome: "asc" } }),
  ]);
  const total = aba === "grupos" ? totalGrupos : aba === "campo" ? totalCampo : totalAdm;
  const { pagina: pedida, porPagina } = lerPaginacao(sp);
  const pagina = paginaValida(pedida, porPagina, total);

  const grupos = aba === "grupos" && total ? await prisma.equipe.findMany({
    where: whereGrupos,
    include: {
      lider: { select: { id: true, nome: true, avatar: true } },
      membros: { select: { id: true, nome: true, avatar: true } },
      veiculos: { select: { id: true, placa: true } },
    },
    orderBy: ordemPrisma(lerOrdem(sp, ORDEM_EQUIPES), ORDEM_EQUIPES, { nome: "asc" }) as Prisma.EquipeOrderByWithRelationInput[],
    ...janela(pagina, porPagina),
  }) : [];
  const colaboradores = aba !== "grupos" && total ? await prisma.tecnico.findMany({
    where: whereColab(aba === "campo" ? "CAMPO" : "ADMINISTRATIVO"),
    select: {
      id: true, nome: true, avatar: true, tipoEquipe: true,
      cargo: { select: { nome: true } },
      perfilAcesso: { select: { nome: true, cor: true } },
    },
    orderBy: ordemPrisma(lerOrdem(sp, ORDEM_COLABORADORES_EQUIPE), ORDEM_COLABORADORES_EQUIPE, { nome: "asc" }) as Prisma.TecnicoOrderByWithRelationInput[],
    ...janela(pagina, porPagina),
  }) : [];

  return (
    <EquipesView
      aba={aba} q={q} grupos={grupos as any} colaboradores={colaboradores as any} perfis={perfis}
      contagens={{ grupos: totalGrupos, campo: totalCampo, administrativa: totalAdm }}
      total={total} pagina={pagina} porPagina={porPagina}
    />
  );
}
