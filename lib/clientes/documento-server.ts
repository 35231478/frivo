/**
 * O CPF/CNPJ do cadastro do cliente (POST /api/clientes e PUT /api/clientes/[id]):
 *  - novo ou trocado, precisa ser válido de verdade (dígitos verificadores, lib/documento);
 *  - o mesmo documento escrito de outro jeito ("11.222.333/0001-81" da importação, "11222333000181" da tela) é o
 *    MESMO cliente: a busca do repetido compara só os dígitos, dentro da empresa. O que está gravado não muda.
 */
import { prisma } from "@/lib/prisma";
import { cnpjValido, cpfValido, digitos } from "@/lib/documento";

/** A mensagem do documento inválido para o tipo de pessoa; null = válido */
export function erroDocumentoCliente(tipoPessoa: string | null | undefined, doc: string): string | null {
  if (tipoPessoa === "FISICA") return cpfValido(doc) ? null : "CPF inválido: confira os 11 dígitos.";
  return cnpjValido(doc) ? null : "CNPJ inválido: confira os 14 dígitos.";
}

/** O mesmo documento? (só os dígitos) */
export const mesmoDocumento = (a: string | null | undefined, b: string | null | undefined) => digitos(a ?? "") === digitos(b ?? "");

/** Outro cliente da empresa com o mesmo documento, gravado com ou sem pontuação (`excetoId`: o próprio, na edição) */
export async function clienteComMesmoDocumento(empresaId: string, doc: string, excetoId?: string) {
  const d = digitos(doc);
  if (!d) return null;
  // Os dois últimos dígitos ficam juntos em qualquer formato ("…-81" ou "…81"): estreita a busca; o resto compara aqui
  const candidatos = await prisma.cliente.findMany({
    where: { empresaId, cpfCnpj: { contains: d.slice(-2) }, ...(excetoId ? { id: { not: excetoId } } : {}) },
    select: { id: true, cpfCnpj: true },
  });
  return candidatos.find((c) => digitos(c.cpfCnpj) === d) ?? null;
}
