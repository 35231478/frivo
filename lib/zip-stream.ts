/**
 * ZIP em streaming — para arquivos grandes demais para montar na memória (o backup da empresa).
 *
 * O `lib/zip.ts` monta o zip inteiro de uma vez, que é o certo para um pacote de documentos. Aqui cada
 * arquivo chega em PEDAÇOS (um gerador assíncrono) e sai comprimido (DEFLATE) à medida que chega: a memória
 * fica do tamanho de um pedaço, não do backup inteiro, e o download começa antes de o último arquivo existir.
 *
 * Como o tamanho e o CRC só são conhecidos no fim de cada arquivo, cada um leva o "descritor de dados" (bit 3
 * do sinalizador) logo depois do conteúdo — é o jeito padrão do formato para isso; `unzip`, o Windows, o macOS
 * e as bibliotecas leem. O diretório central, no fim, repete tudo com os valores certos.
 *
 * Fora do escopo, como no lib/zip.ts: zip64 (mais de 65.535 arquivos ou de 4 GB) — passar disso é erro.
 */

import { createDeflateRaw } from "node:zlib";
import { once } from "node:events";
import { crc32, dataDos, ErroZip, nomeSeguroZip } from "@/lib/zip";

export interface ArquivoStream {
  /** Caminho dentro do zip (limpo como no lib/zip.ts) */
  nome: string;
  /** O conteúdo, em pedaços (cada pedaço já em bytes) */
  partes: () => AsyncIterable<Uint8Array>;
}

/** O que o zip gerou, por arquivo (para o registro da exportação e para os testes). */
export interface ResumoZip { arquivos: { nome: string; bytes: number }[] }

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_DESCRITOR = 0x08074b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
const VERSAO = 20;
/** Bit 3 (tamanho e CRC no descritor, depois do conteúdo) + bit 11 (nome em UTF-8) */
const SINAL = 0x0008 | 0x0800;
const DEFLATE = 8;
const LIMITE_32 = 0xffffffff;
const ARQUIVOS_MAX_STREAM = 0xffff;

/** Comprime os pedaços à medida que chegam, contando o CRC e os tamanhos (antes e depois). */
async function* comprimir(entrada: AsyncIterable<Uint8Array>, conta: { crc: number; bruto: number; comprimido: number }) {
  const d = createDeflateRaw({ level: 6 });
  let falha: unknown = null;
  const alimentar = (async () => {
    try {
      for await (const pedaco of entrada) {
        conta.crc = crc32(pedaco, conta.crc);
        conta.bruto += pedaco.length;
        if (!d.write(pedaco)) await once(d, "drain");
      }
      d.end();
    } catch (e) {
      falha = e;
      d.destroy(e as Error);
    }
  })();
  try {
    for await (const saida of d as AsyncIterable<Buffer>) {
      conta.comprimido += saida.length;
      yield new Uint8Array(saida);
    }
  } catch (e) {
    throw falha ?? e;
  }
  await alimentar;
  if (falha) throw falha;
}

/**
 * Gera o zip pedaço a pedaço. `aoTerminar` recebe o resumo (nome e tamanho de cada arquivo) quando o diretório
 * central foi escrito — ou seja, quando o zip está completo.
 */
export async function* zipEmStream(arquivos: readonly ArquivoStream[], o: { agora?: Date; aoTerminar?: (r: ResumoZip) => void | Promise<void> } = {}): AsyncGenerator<Uint8Array> {
  if (arquivos.length > ARQUIVOS_MAX_STREAM) throw new ErroZip("O pacote tem arquivos demais.");
  const { hora, dia } = dataDos(o.agora ?? new Date());
  const centrais: Buffer[] = [];
  const resumo: ResumoZip = { arquivos: [] };
  let deslocamento = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(nomeSeguroZip(arquivo.nome), "utf8");
    const inicio = deslocamento;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(ASSINATURA_LOCAL, 0);
    local.writeUInt16LE(VERSAO, 4);
    local.writeUInt16LE(SINAL, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    // CRC e tamanhos ficam zerados aqui: vão no descritor, depois do conteúdo (bit 3)
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    yield new Uint8Array(local);
    yield new Uint8Array(nome);
    deslocamento += local.length + nome.length;

    const conta = { crc: 0, bruto: 0, comprimido: 0 };
    for await (const pedaco of comprimir(arquivo.partes(), conta)) {
      deslocamento += pedaco.length;
      yield pedaco;
    }
    if (conta.bruto > LIMITE_32 || conta.comprimido > LIMITE_32 || deslocamento > LIMITE_32) {
      throw new ErroZip("Um arquivo do pacote passou de 4 GB.");
    }

    const descritor = Buffer.alloc(16);
    descritor.writeUInt32LE(ASSINATURA_DESCRITOR, 0);
    descritor.writeUInt32LE(conta.crc, 4);
    descritor.writeUInt32LE(conta.comprimido, 8);
    descritor.writeUInt32LE(conta.bruto, 12);
    yield new Uint8Array(descritor);
    deslocamento += descritor.length;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ASSINATURA_CENTRAL, 0);
    central.writeUInt16LE(VERSAO, 4);
    central.writeUInt16LE(VERSAO, 6);
    central.writeUInt16LE(SINAL, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(conta.crc, 16);
    central.writeUInt32LE(conta.comprimido, 20);
    central.writeUInt32LE(conta.bruto, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(inicio, 42);
    centrais.push(central, nome);
    resumo.arquivos.push({ nome: nome.toString("utf8"), bytes: conta.bruto });
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(ASSINATURA_FIM, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  yield new Uint8Array(diretorio);
  yield new Uint8Array(fim);
  await o.aoTerminar?.(resumo);
}
