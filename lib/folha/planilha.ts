import { inflateRawSync } from "node:zlib";

/**
 * Leitura de planilhas (CSV e Excel .xlsx) e geração do modelo — só no servidor, sem dependência
 * externa: o .xlsx é um ZIP de XMLs; lemos o ZIP com o zlib do Node e o XML com expressões simples.
 * Só a PRIMEIRA aba é lida. Fórmulas valem pelo último valor salvo pelo Excel.
 */

export type Celula = string | number | null;
export type Tabela = Celula[][];

export class ErroPlanilha extends Error {}

export const MAX_BYTES_PLANILHA = 2 * 1024 * 1024;
const MAX_DESCOMPACTADO = 30 * 1024 * 1024;

// ───────────────────────── CSV ─────────────────────────

/** CSV com `;`, `,` ou TAB (detecta pelo cabeçalho), aspas, BOM e CRLF. */
export function lerCsv(texto: string): Tabela {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] ?? "";
  const cont = (c: string) => primeira.split(c).length - 1;
  const sep = [";", ",", "\t"].sort((a, b) => cont(b) - cont(a))[0];

  const linhas: Tabela = [];
  let linha: Celula[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += ch;
    } else if (ch === '"' && campo === "") aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += ch;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.map((l) => l.map((c) => (typeof c === "string" && c.trim() === "" ? null : c)));
}

// ───────────────────────── ZIP ─────────────────────────

function lerZip(buf: Buffer): Map<string, Buffer> {
  // Fim do diretório central (EOCD): procura a assinatura de trás para frente
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ErroPlanilha("Arquivo Excel inválido ou corrompido.");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const arquivos = new Map<string, Buffer>();
  let soma = 0;
  for (let k = 0; k < total; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ErroPlanilha("Arquivo Excel inválido ou corrompido.");
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamReal = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28), eLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nLen).toString("utf8");
    p += 46 + nLen + eLen + cLen;
    // Só os XMLs que importam (o resto — imagens, temas — é ignorado)
    if (!/^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(nome)) continue;
    soma += tamReal;
    if (soma > MAX_DESCOMPACTADO) throw new ErroPlanilha("Planilha grande demais.");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ErroPlanilha("Arquivo Excel inválido ou corrompido.");
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + tamComp);
    if (metodo === 0) arquivos.set(nome, Buffer.from(dados));
    else if (metodo === 8) arquivos.set(nome, inflateRawSync(dados, { maxOutputLength: MAX_DESCOMPACTADO }));
    else throw new ErroPlanilha("Formato de compactação do Excel não suportado. Salve de novo como .xlsx ou use CSV.");
  }
  return arquivos;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Buffer) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** ZIP sem compactação (suficiente para o modelo, que é pequeno). */
function gerarZip(arquivos: [string, string][]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const [nome, conteudo] of arquivos) {
    const n = Buffer.from(nome, "utf8"), d = Buffer.from(conteudo, "utf8"), crc = crc32(d);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22);
    h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locais.push(h, n, d);
    centrais.push(c, n);
    offset += h.length + n.length + d.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, dir, fim]);
}

// ───────────────────────── XLSX ─────────────────────────

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodificar(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]);
}
function textoDe(xml: string) {
  // Junta todos os <t> (texto com formatação vem em vários "runs")
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => decodificar(m[1] ?? "")).join("");
}
function colunaIndice(ref: string) {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function lerXlsx(buf: Buffer): Tabela {
  const z = lerZip(buf);
  const texto = (nome: string) => z.get(nome)?.toString("utf8");

  // Primeira aba (na ordem do workbook)
  let caminho = "xl/worksheets/sheet1.xml";
  const wb = texto("xl/workbook.xml"), rels = texto("xl/_rels/workbook.xml.rels");
  const rid = wb && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
    const alvo = rel && /Target="([^"]+)"/.exec(rel)?.[1];
    if (alvo) caminho = alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, "")}`;
  }
  const sheet = texto(caminho);
  if (!sheet) throw new ErroPlanilha("Não encontrei a primeira aba da planilha.");

  const compartilhadas = [...(texto("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));

  const tabela: Tabela = [];
  for (const r of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const numLinha = Number(/\br="(\d+)"/.exec(r[1])?.[1] ?? tabela.length + 1) - 1;
    const linha: Celula[] = [];
    let col = 0;
    for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], corpo = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (ref) col = colunaIndice(ref);
      const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let valor: Celula = null;
      if (tipo === "s") valor = v != null ? compartilhadas[Number(v)] ?? null : null;
      else if (tipo === "inlineStr") valor = textoDe(corpo);
      else if (tipo === "str" || tipo === "e") valor = v != null ? decodificar(v) : null;
      else if (tipo === "b") valor = v === "1" ? "sim" : "não";
      else if (v != null && v !== "") valor = Number.isFinite(Number(v)) ? Number(v) : decodificar(v);
      linha[col] = typeof valor === "string" && valor.trim() === "" ? null : valor;
      col++;
    }
    for (let i = 0; i < linha.length; i++) if (linha[i] === undefined) linha[i] = null;
    tabela[numLinha] = linha;
  }
  for (let i = 0; i < tabela.length; i++) if (!tabela[i]) tabela[i] = [];
  return tabela;
}

/** Lê CSV ou XLSX pelo conteúdo (o .xlsx começa com "PK"). Rejeita .xls antigo com mensagem clara. */
export function lerPlanilha(buf: Buffer, nome = ""): Tabela {
  if (buf.length === 0) throw new ErroPlanilha("O arquivo está vazio.");
  if (buf.length > MAX_BYTES_PLANILHA) throw new ErroPlanilha("Arquivo maior que 2 MB.");
  if (buf[0] === 0x50 && buf[1] === 0x4b) return lerXlsx(buf);
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new ErroPlanilha("Formato .xls (Excel 97-2003) não suportado. No Excel, use “Salvar como” → .xlsx ou CSV.");
  if (/\.(xlsx|xls|ods|pdf)$/i.test(nome)) throw new ErroPlanilha("Arquivo inválido: não parece um .xlsx. Baixe o modelo e preencha nele.");
  const texto = buf.toString("utf8");
  if (texto.includes("\u0000")) throw new ErroPlanilha("Arquivo inválido. Envie CSV ou Excel (.xlsx).");
  // Excel brasileiro às vezes salva CSV em Latin-1: caracteres inválidos em UTF-8 → tenta latin1
  return lerCsv(texto.includes("�") ? buf.toString("latin1") : texto);
}

// ───────────────────────── Modelo ─────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const letra = (i: number) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function aba(linhas: string[][], negritoPrimeira: boolean, larguras?: number[]) {
  const cols = larguras ? `<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const rows = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) =>
    `<c r="${letra(c)}${r + 1}" t="inlineStr"${negritoPrimeira && r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${negritoPrimeira ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ""}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/** Gera um .xlsx com as abas informadas (texto puro; a 1ª linha da 1ª aba em negrito e congelada). */
export function gerarXlsx(abas: { nome: string; linhas: string[][]; larguras?: number[] }[]): Buffer {
  const ns = "http://schemas.openxmlformats.org/";
  return gerarZip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>${abas.map((a, i) => `<sheet name="${esc(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}package/2006/relationships">${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${abas.length + 1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${ns}spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...abas.map((a, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, aba(a.linhas, i === 0, a.larguras)]),
  ]);
}

/** CSV para o Excel brasileiro: separador `;` e BOM (acentos certos ao abrir com dois cliques). */
export function gerarCsv(linhas: string[][]) {
  const campo = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + linhas.map((l) => l.map(campo).join(";")).join("\r\n") + "\r\n";
}
