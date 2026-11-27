/**
 * Mandar o relatório da visita ao cliente pelo WhatsApp, em 1 toque, ao concluir (puro: tela e testes).
 *  - o link é o público, com o token da atividade (abre sem login; sem o token, 404);
 *  - o número é o do aviso ao cliente (só com "Exibir contatos do cliente"); sem número, o WhatsApp abre para
 *    escolher o contato;
 *  - só manda depois que a conclusão subiu: o cliente nunca abre um relatório incompleto.
 */
import type { RelatorioRetrato } from "@/lib/tecnico/offline/tipos";

/** A mensagem pronta (sem o nome do cliente: o app não depende de "Exibir dados do cliente") */
export function mensagemRelatorio(r: Pick<RelatorioRetrato, "empresa" | "osNumero">, url: string): string {
  return `Olá! Segue o relatório da visita técnica da ${r.empresa} (${r.osNumero}): ${url}`;
}

/** Link do WhatsApp: com o número do cliente (DDI 55 quando falta) ou, sem número válido, para escolher o contato */
export function linkWhatsappRelatorio(numero: string | null | undefined, mensagem: string): string {
  const digitos = (numero ?? "").replace(/\D/g, "");
  const texto = `?text=${encodeURIComponent(mensagem)}`;
  if (digitos.length < 10) return `https://wa.me/${texto}`;
  return `https://wa.me/${digitos.length >= 12 ? digitos : `55${digitos}`}${texto}`;
}

/** O mesmo relatório em PDF: /relatorio/atividade/<id>/pdf?t=<token> */
export function linkPdfRelatorio(link: string): string {
  const [caminho, busca = ""] = link.split("?");
  return `${caminho.replace(/\/$/, "")}/pdf${busca ? `?${busca}` : ""}`;
}

export type SituacaoEnvio = "nao-concluida" | "aguardando" | "pronto";
/** Pode mandar? Só concluída e com tudo desta OS já enviado ao servidor. */
export function situacaoEnvio(p: { concluida: boolean; noAparelho: number; temRelatorio: boolean }): SituacaoEnvio | null {
  if (!p.temRelatorio) return null;
  if (!p.concluida) return "nao-concluida";
  return p.noAparelho > 0 ? "aguardando" : "pronto";
}
