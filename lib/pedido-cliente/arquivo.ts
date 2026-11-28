/**
 * O arquivo e o valor do pedido do cliente, iguais no escritório (gaveta) e no portal — um jeito só.
 *  - Limite de 3 MB: o arquivo viaja em base64 dentro do JSON (~4/3 do tamanho) e a hospedagem recusa pedidos acima
 *    de 4,5 MB; acima de 3 MB a recusa chegaria como um 413 sem explicação. O servidor confere o mesmo limite.
 *  - O valor aceita o jeito brasileiro ("1.500" é mil e quinhentos; "1.500,50"; "1500,5"), não lê "1.500" como 1,5.
 */
import { numero } from "@/lib/importacao/motor";

export const TAMANHO_MAX_PEDIDO = 3 * 1024 * 1024;
export const MSG_ARQUIVO_PEDIDO_GRANDE = "Arquivo acima de 3 MB. Envie um PDF menor ou uma foto com menos resolução.";
export const MSG_ARQUIVO_ILEGIVEL = "Não foi possível ler o arquivo. Escolha de novo.";

/** O valor digitado: null = em branco; NaN = inválido; senão o número (BR ou EN) */
export function lerValorPedido(v: string): number | null {
  const n = numero(v.trim());
  return n === undefined ? null : n;
}

/** O arquivo como data URL (para ir no JSON) */
export const lerArquivoComoDataUrl = (f: File) => new Promise<string>((ok, falha) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => falha(r.error);
  r.readAsDataURL(f);
});

/** A mensagem de uma resposta recusada: o 413 da hospedagem (sem JSON) vira o aviso do tamanho */
export const erroDoEnvio = (status: number | undefined, corpo: { erro?: string } | null | undefined, padrao: string) =>
  status === 413 ? MSG_ARQUIVO_PEDIDO_GRANDE : corpo?.erro ?? padrao;
