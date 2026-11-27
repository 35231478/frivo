/**
 * ZIP — montado aqui, com o `node:zlib` que já vem no Node.
 *
 * Por que não uma biblioteca: o projeto não tem nenhuma de zip, e o formato que a gente precisa é
 * o simples — arquivos pequenos, sem pasta aninhada, sem senha, sem zip64. Isso cabe em cem linhas
 * de cabeçalho bem documentado e evita mais uma dependência para manter e auditar.
 *
 * O que sai daqui é um zip comum: `unzip`, o Explorador do Windows, o Finder e qualquer biblioteca
 * leem. Cada arquivo entra DEFLATE (o método 8, o de sempre); quando comprimir não compensa — um
 * JPEG, um PNG, um PDF já comprimido — o arquivo entra como está (método 0), que é o que todo
 * compactador faz.
 *
 * Fora do escopo de propósito: zip64 (mais de 65.535 arquivos ou mais de 4 GB), senha e pastas
 * vazias. O teto está em `ARQUIVOS_MAX`/`TAMANHO_MAX`, e passar dele é erro, não silêncio.
 */

import { deflateRawSync } from "node:zlib";

export interface ArquivoZip {
  /** Caminho dentro do zip. Barra normal separa pasta; ".." e barra no começo são recusados. */
  nome: string;
  bytes: Uint8Array;
  /** Data do arquivo dentro do zip (padrão: agora). */
  data?: Date;
}

export class ErroZip extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroZip";
  }
}

/** Tetos: o zip da admissão é feito de documentos de pessoa, não de um backup. */
export const ARQUIVOS_MAX = 500;
export const TAMANHO_MAX = 200 * 1024 * 1024;

/* ───────────────────────── CRC-32 ───────────────────────── */

/** A tabela do CRC-32 (polinômio 0xEDB88320), montada uma vez. */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 de `bytes`. Com `anterior`, continua um CRC já começado (arquivo lido em pedaços: lib/zip-stream). */
export function crc32(bytes: Uint8Array, anterior = 0): number {
  let c = (anterior ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ───────────────────────── nome do arquivo ───────────────────────── */

/** Caracteres que o Windows recusa num nome de arquivo, mais os de controle. */
const PROIBIDOS = /[<>:"\\|?*\u0000-\u001f\u007f]/g;

/**
 * Deixa o nome seguro para virar arquivo em qualquer sistema, preservando a pasta (a barra normal).
 * Nunca devolve vazio, nunca começa com barra e nunca contém "..": um zip não escreve fora da
 * pasta onde foi aberto.
 */
export function nomeSeguroZip(nome: string): string {
  const partes = String(nome ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.replace(PROIBIDOS, "").replace(/^\.+$/, "").trim().replace(/[. ]+$/, ""))
    .filter(Boolean);
  const caminho = partes.join("/");
  return caminho.slice(0, 180) || "arquivo";
}

/** Dois nomes iguais no mesmo zip viram "nome.pdf", "nome (2).pdf"… — nada é sobrescrito. */
export function semRepetir(nomes: readonly string[]): string[] {
  const vistos = new Map<string, number>();
  return nomes.map((bruto) => {
    const nome = nomeSeguroZip(bruto);
    const chave = nome.toLowerCase();
    const n = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, n);
    if (n === 1) return nome;
    const ponto = nome.lastIndexOf(".");
    const corte = ponto > 0 ? ponto : nome.length;
    return `${nome.slice(0, corte)} (${n})${nome.slice(corte)}`;
  });
}

/* ───────────────────────── data no formato do zip ───────────────────────── */

/**
 * A data do MS-DOS, que é o que o zip guarda: 7 bits de ano desde 1980, e o segundo com 2 de
 * resolução. Antes de 1980 não existe no formato — vira 01/01/1980.
 */
export function dataDos(d: Date): { hora: number; dia: number } {
  const ano = d.getFullYear();
  if (!Number.isFinite(ano) || ano < 1980) return { hora: 0, dia: (1 << 5) | 1 };
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((Math.min(ano, 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/* ───────────────────────── o zip ───────────────────────── */

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
/** Versão mínima para abrir: 2.0, que é a do DEFLATE. */
const VERSAO = 20;
/** Bit 11 do sinalizador: o nome está em UTF-8 (é o que deixa acento aparecer certo). */
const UTF8 = 0x0800;

const DEFLATE = 8;
const GUARDADO = 0;

/**
 * Monta o zip. Os nomes repetidos são desambiguados, os inseguros são limpos, e cada arquivo entra
 * comprimido só quando comprimir vale a pena.
 */
export function montarZip(arquivos: readonly ArquivoZip[], agora: Date = new Date()): Uint8Array {
  if (arquivos.length > ARQUIVOS_MAX) {
    throw new ErroZip(`O pacote não pode ter mais de ${ARQUIVOS_MAX} arquivos.`);
  }
  const nomes = semRepetir(arquivos.map((a) => a.nome));

  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  let total = 0;

  arquivos.forEach((arquivo, i) => {
    const bytes = Buffer.from(arquivo.bytes);
    total += bytes.length;
    if (total > TAMANHO_MAX) throw new ErroZip("O pacote ficou grande demais.");

    const nome = Buffer.from(nomes[i], "utf8");
    const { hora, dia } = dataDos(arquivo.data ?? agora);
    const crc = crc32(bytes);

    // Comprimir só quando sobra: um JPEG ou um PDF já comprimido costuma CRESCER no DEFLATE.
    const comprimido = bytes.length ? deflateRawSync(bytes, { level: 6 }) : Buffer.alloc(0);
    const vale = comprimido.length < bytes.length;
    const metodo = vale ? DEFLATE : GUARDADO;
    const conteudo = vale ? comprimido : bytes;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(ASSINATURA_LOCAL, 0);
    local.writeUInt16LE(VERSAO, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(conteudo.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28); // sem campo extra
    locais.push(local, nome, conteudo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ASSINATURA_CENTRAL, 0);
    central.writeUInt16LE(VERSAO, 4); // feito por
    central.writeUInt16LE(VERSAO, 6); // precisa de
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(conteudo.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comentário
    central.writeUInt16LE(0, 34); // disco
    central.writeUInt16LE(0, 36); // atributos internos
    // Atributos externos: arquivo comum com permissão 644, no campo alto. O `>>> 0` é obrigatório —
    // o `<<` do JavaScript trabalha em 32 bits COM SINAL, e sem ele este valor vira negativo.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);

    deslocamento += local.length + nome.length + conteudo.length;
  });

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(ASSINATURA_FIM, 0);
  fim.writeUInt16LE(0, 4); // este disco
  fim.writeUInt16LE(0, 6); // disco do diretório
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  fim.writeUInt16LE(0, 20); // sem comentário

  return new Uint8Array(Buffer.concat([...locais, diretorio, fim]));
}
