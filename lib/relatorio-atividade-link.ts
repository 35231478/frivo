/**
 * Link público do relatório de ATIVIDADE: /relatorio/atividade/<id>?t=<token>.
 *
 * O token é o segredo (32 bytes aleatórios em base64url = 43 caracteres); o id sozinho não abre
 * nada. Sem token, com token errado ou com id inexistente a página responde a MESMA 404, então
 * não dá para descobrir (nem enumerar) quais relatórios existem trocando o id.
 *
 * Só no servidor (usa node:crypto). As telas recebem o link já montado.
 */
import { randomBytes } from "node:crypto";

export const BYTES_TOKEN_RELATORIO = 32;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Token novo ("Gerar novo link"). As atividades novas já nascem com um, gerado pelo banco. */
export function novoTokenRelatorio(): string {
  return randomBytes(BYTES_TOKEN_RELATORIO).toString("base64url");
}

/** Só um token no formato certo chega a ser procurado no banco (o resto já é 404). */
export function tokenRelatorioNoFormato(token: unknown): token is string {
  return typeof token === "string" && FORMATO_TOKEN.test(token);
}

export function linkRelatorioAtividade(atividade: { id: string; tokenRelatorio: string }): string {
  return `/relatorio/atividade/${encodeURIComponent(atividade.id)}?t=${atividade.tokenRelatorio}`;
}
