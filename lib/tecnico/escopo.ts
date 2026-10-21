/**
 * Escopo do técnico no SERVIDOR: quem é o técnico ligado ao usuário (mesmo e-mail, sem diferença de
 * maiúsculas, na empresa — a mesma convenção da inativação de colaborador) e quais atividades são
 * DELE (responsável ou na composição da atividade). No modo técnico, toda leitura e gravação da
 * execução fica restrita a essas atividades; quem tem permissão maior segue vendo a empresa toda.
 */
import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { emModoTecnico } from "@/lib/tecnico/modo";

/** O técnico ATIVO com o e-mail do usuário (o mais antigo, se houver repetido). */
export async function tecnicoDoUsuario(empresaId: string, email: string | null | undefined) {
  const e = (email ?? "").trim();
  if (!e) return null;
  return prisma.tecnico.findFirst({
    where: { empresaId, ativo: true, email: { equals: e, mode: "insensitive" } },
    orderBy: { criadoEm: "asc" },
    select: { id: true, nome: true },
  });
}

/** Atividades atribuídas ao técnico: responsável (tecnico_id) ou na composição (atividade_tecnicos). */
export const atividadesDoTecnico = (tecnicoId: string): Prisma.AtividadeOsWhereInput => ({
  OR: [{ tecnicoId }, { tecnicosEquipe: { some: { tecnicoId } } }],
});

export interface EscopoTecnico {
  /** Restrito às atividades do técnico (modo técnico) */
  restrito: boolean;
  tecnicoId: string | null;
}

/** Escopo da sessão: no modo técnico, só as atividades do técnico ligado ao usuário. */
export function escopoDaSessao(session: Session): EscopoTecnico {
  const u = session.user;
  const restrito = emModoTecnico({ role: u.role, permissoes: u.permissoes, tecnicoId: u.tecnicoId });
  return { restrito, tecnicoId: u.tecnicoId ?? null };
}

/** Filtro de atividade para o escopo (vazio = sem restrição). */
export function filtroEscopo(escopo: EscopoTecnico): Prisma.AtividadeOsWhereInput {
  return escopo.restrito && escopo.tecnicoId ? atividadesDoTecnico(escopo.tecnicoId) : {};
}

export const MSG_FORA_DO_ESCOPO = "Esta atividade não está atribuída a você. Fale com o escritório.";
