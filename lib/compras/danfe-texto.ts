/**
 * A DANFE em texto — puro e sem dependências (vai também para o navegador, na gaveta da nota). A leitura
 * do XML fica em lib/compras/danfe (servidor).
 */

import type { DadosDanfe } from "@/lib/compras/danfe";

/** O que chega pela API: as datas viram texto ISO no JSON */
export type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
export type DanfeJson = Json<DadosDanfe>;

export interface EnderecoDanfe {
  logradouro: string; numero: string; complemento: string; bairro: string; municipio: string; uf: string; cep: string; fone: string;
}

/** O endereço numa linha ("Rua A, 10 · Centro · São Paulo/SP · CEP 01000-000") */
export function enderecoEmLinha(e: EnderecoDanfe | null): string {
  if (!e) return "";
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ") + (e.complemento ? ` (${e.complemento})` : "");
  const cidade = [e.municipio, e.uf].filter(Boolean).join("/");
  const cep = e.cep.length === 8 ? `CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}` : "";
  return [rua, e.bairro, cidade, cep].filter(Boolean).join(" · ");
}

/** Nome do arquivo para baixar (o padrão do mercado: a chave) */
export const nomeArquivoNota = (chave: string, ext: "pdf" | "xml") =>
  ext === "xml" ? `${chave || "nota"}-nfe.xml` : `DANFE-${chave || "nota"}.pdf`;
