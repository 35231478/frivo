import type { Metadata } from "next";
import { ProtegerSaida } from "@/components/ui/proteger-saida";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { Dica } from "@/components/ui/dica";
import { NovoEnvio } from "@/components/documentacao/novo-envio";

export const metadata: Metadata = { title: "Novo envio de documentação" };

const AJUDA = "Escolha o cliente: a tela sugere quem atende a ele. Marque os tipos de documento e veja a prévia antes de entregar. Documento vencido segura o envio até ser renovado ou até o colaborador sair do pacote.";

/**
 * NOVO ENVIO (Equipes › Documentação da equipe › Novo): monta o pacote de documentos dos
 * colaboradores para um cliente — ou para vários, em lote — e entrega por link, zip ou e-mail.
 *
 * Exige "Documentos › Enviar ao cliente". A tela só leva daqui as listas de apoio (equipes e
 * colaboradores ativos, pelo nome); o que entra no pacote é decidido e conferido no servidor.
 * Aceita `?clienteId=…&contratoId=…` (o atalho das fichas): abre com o cliente já escolhido.
 */
export default async function NovoEnvioPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const sp = (await searchParams) ?? {};
  const session = await auth();
  const user = session!.user!;
  if (!pode(user.permissoes, "documentos", "enviar", user.role)) redirect("/sem-permissao");
  const empresaId = user.empresaId;

  const [equipes, colaboradores] = await Promise.all([
    prisma.equipe.findMany({ where: { empresaId }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.tecnico.findMany({ where: { empresaId, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);

  // Vindo do atalho da ficha do cliente ou do contrato: o cliente já chega escolhido. O que vem na
  // URL é conferido contra a empresa — cliente de outra empresa (ou que não existe) é ignorado, e o
  // contrato só vale se for um contrato ATIVO daquele cliente (é deles que sai "quem atende").
  const cliente = sp.clienteId
    ? await prisma.cliente.findFirst({ where: { id: sp.clienteId, empresaId }, select: { id: true, nome: true, nomeFantasia: true } })
    : null;
  const contrato = cliente && sp.contratoId
    ? await prisma.contrato.findFirst({ where: { id: sp.contratoId, empresaId, clienteId: cliente.id, status: "ATIVO" }, select: { id: true } })
    : null;
  const inicial = cliente ? { clienteId: cliente.id, clienteNome: cliente.nomeFantasia || cliente.nome, contratoId: contrato?.id ?? null } : null;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/documentacao-equipe" className="p-2 text-ink-muted hover:text-ink hover:bg-surface-alt rounded-lg" aria-label="Voltar ao histórico">
          <ArrowLeft className="w-5 h-5" aria-hidden />
        </Link>
        <h1 className="page-title flex items-center gap-1.5">
          Novo envio
          <Dica rotulo="Novo envio" lado="direita" texto={AJUDA} />
        </h1>
      </div>
      <ProtegerSaida><NovoEnvio equipes={equipes} colaboradores={colaboradores} inicial={inicial} /></ProtegerSaida>
    </div>
  );
}
