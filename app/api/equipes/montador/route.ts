import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { validarPessoasEquipe } from "@/lib/equipe-veiculos";

const equipeSchema = z.object({
  /** Equipe existente; ausente = nova (criada aqui). */
  id: z.string().optional(),
  /** Identificador da tela (devolvido com o id criado). */
  chave: z.string().min(1).max(80),
  nome: z.string().trim().min(1, "Toda equipe precisa de um nome.").max(60),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0EA5E9"),
  liderId: z.string().nullable().optional(),
  membroIds: z.array(z.string()).max(200).default([]),
});
const corpoSchema = z.object({ equipes: z.array(equipeSchema).max(100) });

/**
 * Salva a composição montada no montador visual (arrasta e solta): nome, cor, líder e
 * membros de cada equipe — tudo numa transação. Usa a relação equipe↔colaborador que já
 * existe (um colaborador pode estar em mais de uma equipe). NÃO mexe em veículos: eles
 * continuam vinculados como estavam.
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues.find((i) => i.path.includes("nome"))?.message ?? "Dados inválidos.";
    return NextResponse.json({ erro: msg }, { status: 400 });
  }
  const { equipes } = parsed.data;

  // Equipes existentes: da empresa e ativas (inativa se reativa pela tela de equipes)
  const ids = equipes.map((e) => e.id).filter(Boolean) as string[];
  if (ids.length) {
    const n = await prisma.equipe.count({ where: { id: { in: ids }, empresaId, status: "ATIVA" } });
    if (n !== new Set(ids).size) return NextResponse.json({ erro: "Equipe inválida ou inativa. Recarregue a página." }, { status: 400 });
  }
  // Pessoas: da mesma empresa
  const todas = equipes.flatMap((e) => [...e.membroIds, ...(e.liderId ? [e.liderId] : [])]);
  if (!(await validarPessoasEquipe(empresaId, todas))) return NextResponse.json({ erro: "Colaborador inválido." }, { status: 400 });

  // Membros INATIVOS não aparecem no quadro: preserva-os (senão o "set" os tiraria da equipe sem aviso)
  const inativosPorEquipe = new Map<string, string[]>();
  const liderInativo = new Map<string, string>();
  if (ids.length) {
    const atuais = await prisma.equipe.findMany({
      where: { id: { in: ids } },
      select: { id: true, membros: { where: { ativo: false }, select: { id: true } }, lider: { select: { id: true, ativo: true } } },
    });
    for (const a of atuais) {
      inativosPorEquipe.set(a.id, a.membros.map((m) => m.id));
      if (a.lider && !a.lider.ativo) liderInativo.set(a.id, a.lider.id);
    }
  }

  const criadas: Record<string, string> = {};
  await prisma.$transaction(async (tx) => {
    for (const e of equipes) {
      // O líder também faz parte da equipe
      const membros = [...new Set([...e.membroIds, ...(e.liderId ? [e.liderId] : []), ...(e.id ? inativosPorEquipe.get(e.id) ?? [] : [])])];
      // Líder inativo (fora do quadro) continua líder até o quadro definir outro
      const data = { nome: e.nome, cor: e.cor, liderId: e.liderId || (e.id ? liderInativo.get(e.id) ?? null : null) };
      if (e.id) {
        await tx.equipe.update({ where: { id: e.id }, data: { ...data, membros: { set: membros.map((id) => ({ id })) } } });
      } else {
        const nova = await tx.equipe.create({ data: { ...data, empresaId, membros: { connect: membros.map((id) => ({ id })) } } });
        criadas[e.chave] = nova.id;
      }
    }
  });
  return NextResponse.json({ ok: true, criadas });
}
