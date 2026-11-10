import { prisma } from "@/lib/prisma";

/**
 * Resolução do destinatário de cobrança/fatura do cliente.
 *
 * Regra (seção "Cobrança e faturamento" do cadastro): os e-mails/WhatsApp de
 * cobrança informados têm prioridade; quando o cliente não informa nenhum, o
 * envio NÃO fica sem destino — cai no contato principal e, por fim, no e-mail /
 * celular do cadastro. Multiempresa: a busca é por clienteId (o cliente já é da
 * empresa da sessão), nada hardcoded.
 */

const limpar = (v: string | null | undefined): string => (v ?? "").trim();

/** E-mail do contato principal ativo do cliente; sem ele, o e-mail do cadastro. */
export async function emailContatoPrincipal(clienteId: string, emailCadastro?: string | null): Promise<string | null> {
  const contato = await prisma.contatoCliente.findFirst({
    where: { clienteId, ativo: true, principal: true, NOT: { email: null } },
    orderBy: { criadoEm: "asc" },
    select: { email: true },
  });
  return limpar(contato?.email) || limpar(emailCadastro) || null;
}

/** WhatsApp do contato principal ativo do cliente; sem ele, o celular do cadastro. */
export async function whatsappContatoPrincipal(clienteId: string, celularCadastro?: string | null): Promise<string | null> {
  const contato = await prisma.contatoCliente.findFirst({
    where: { clienteId, ativo: true, principal: true, NOT: { whatsapp: null } },
    orderBy: { criadoEm: "asc" },
    select: { whatsapp: true },
  });
  return limpar(contato?.whatsapp) || limpar(celularCadastro) || null;
}

type ClienteEmailCobranca = { id: string; emailsFaturamento?: string[] | null; email?: string | null };
type ClienteWhatsappCobranca = { id: string; whatsappFaturamento?: string | null; celular?: string | null };

/**
 * E-mail único para cobrança/fatura (mailto, destinatário da NFS-e, relatório):
 * e-mails de cobrança → contato principal → e-mail do cadastro.
 */
export async function emailCobranca(cliente: ClienteEmailCobranca): Promise<string | null> {
  const dedicado = (cliente.emailsFaturamento ?? []).map(limpar).find(Boolean);
  if (dedicado) return dedicado;
  return emailContatoPrincipal(cliente.id, cliente.email);
}

/**
 * WhatsApp único para cobrança/fatura (link wa.me):
 * WhatsApp de cobrança → WhatsApp do contato principal → celular do cadastro.
 */
export async function whatsappCobranca(cliente: ClienteWhatsappCobranca): Promise<string | null> {
  const dedicado = limpar(cliente.whatsappFaturamento);
  if (dedicado) return dedicado;
  return whatsappContatoPrincipal(cliente.id, cliente.celular);
}
