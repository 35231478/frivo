/**
 * Quais equipamentos podem entrar numa OS: da empresa da sessão, ATIVOS e de uma unidade do CLIENTE
 * da OS (a lista na tela mostra os da unidade da OS; o servidor aceita qualquer unidade do cliente,
 * nunca de outro cliente).
 */
import { prisma } from "@/lib/prisma";

export async function equipamentosDoCliente(empresaId: string, clienteId: string, ids: string[]) {
  const unicos = [...new Set(ids)];
  const achados = await prisma.equipamento.findMany({
    where: { id: { in: unicos }, empresaId },
    select: { id: true, nome: true, marca: true, modelo: true, ativo: true, unidade: { select: { clienteId: true } } },
  });
  const validos = achados.filter((e) => e.ativo && e.unidade?.clienteId === clienteId).map((e) => e.id);
  const outroCliente = achados.filter((e) => e.unidade?.clienteId !== clienteId).length;
  const inativos = achados.filter((e) => !e.ativo && e.unidade?.clienteId === clienteId).length;
  const naoEncontrados = unicos.length - achados.length;
  let erro: string | null = null;
  if (outroCliente || naoEncontrados) erro = "Equipamento de outro cliente (ou inexistente): só entram na OS equipamentos do cliente dela.";
  else if (inativos) erro = "Equipamento inativo não entra em OS: reative o cadastro dele antes.";
  return { validos, erro };
}

export const nomeEquipamento = (e: { nome: string | null; marca: string; modelo: string }) =>
  `${e.nome ? `${e.nome} — ` : ""}${e.marca} ${e.modelo}`.trim();
