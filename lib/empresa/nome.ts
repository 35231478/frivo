/**
 * O nome da empresa que a tela mostra — lido do CADASTRO a cada carga, não do login.
 *
 * O login guarda `empresaNome` no token na hora de entrar (e só o nome fantasia: empresa sem nome
 * fantasia aparecia como "Empresa", e o orçamento saía "Segue o orçamento Nº 12 de :"). Trocar o nome
 * em Configurações › Empresa só aparecia depois de sair e entrar. Aqui o nome vem do banco, sem mexer
 * no login: nome fantasia, ou a razão social quando não há nome fantasia.
 */
import { prisma } from "@/lib/prisma";

export function nomeExibidoDaEmpresa(e: { nome: string; nomeFantasia?: string | null } | null | undefined): string {
  if (!e) return "";
  return e.nomeFantasia?.trim() || e.nome.trim();
}

export async function nomeDaEmpresa(empresaId: string): Promise<string> {
  const e = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, nomeFantasia: true } });
  return nomeExibidoDaEmpresa(e);
}
