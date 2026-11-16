/**
 * A resposta HTTP de um arquivo gerado (PDF, zip). Nasceu no documento do PMOC e saiu de lá quando
 * a admissão passou a entregar ficha e pacote: o jeito de mandar um arquivo para o navegador é o
 * mesmo, e o nome com acento tem a mesma armadilha em todos.
 */

/**
 * O nome do arquivo só com letras sem acento, para o navegador que não lê o nome em UTF-8. Vai no
 * `filename=`; o nome bonito vai no `filename*=`, que os navegadores de hoje preferem.
 */
export const nomeAscii = (nome: string) =>
  nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2012-\u2015]/g, "-").replace(/[^\x20-\x7e]|["\\]/g, "_");

export interface ArquivoGerado {
  bytes: Uint8Array;
  nomeArquivo: string;
}

/**
 * Resposta com um arquivo gerado por nós. `inline` abre no navegador (só faz sentido em PDF);
 * sem ele, baixa.
 *
 * `nosniff` e `noindex` sempre: isto é documento de pessoa, não página.
 */
export function respostaArquivo(arquivo: ArquivoGerado, tipo: string, inline = false): Response {
  return new Response(Buffer.from(arquivo.bytes), {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(arquivo.bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nomeAscii(arquivo.nomeArquivo)}"; filename*=UTF-8''${encodeURIComponent(arquivo.nomeArquivo)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export const respostaPdfArquivo = (arquivo: ArquivoGerado, inline: boolean) =>
  respostaArquivo(arquivo, "application/pdf", inline);

export const respostaZip = (arquivo: ArquivoGerado) =>
  respostaArquivo(arquivo, "application/zip");
