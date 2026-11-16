/**
 * O ZIP que a gente monta (lib/zip.ts, só com o `node:zlib` do Node) aberto por um `unzip` DE
 * VERDADE — não por outra função nossa, que concordaria com o nosso próprio engano.
 *
 * O que se prova:
 *  - o arquivo é um zip legítimo: `unzip -t` aprova e `unzip -o` devolve os bytes exatos;
 *  - texto comprime (método DEFLATE) e o que já vem comprimido entra como está, sem CRESCER;
 *  - acento no nome sobrevive (o bit de UTF-8), a pasta dentro do zip é respeitada e nome repetido
 *    vira "(2)" em vez de sobrescrever;
 *  - um nome perigoso ("../../etc/passwd", barra no começo, caractere de controle) nunca escreve
 *    fora da pasta onde o zip for aberto;
 *  - zip vazio é válido, arquivo vazio é preservado, e os tetos recusam em vez de estourar quieto;
 *  - o CRC-32 bate com o do `unzip` (é ele que detecta arquivo corrompido).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ARQUIVOS_MAX, ErroZip, crc32, montarZip, nomeSeguroZip, semRepetir } from "@/lib/zip";

/** Há `unzip` nesta máquina? Sem ele, os testes que dependem dele são pulados (e dizem isso). */
const TEM_UNZIP = (() => {
  try { execFileSync("unzip", ["-v"], { stdio: "pipe" }); return true; } catch { return false; }
})();

let dir = "";
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-teste-")); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

let n = 0;
/** Grava o zip num arquivo e devolve o caminho. */
function gravar(bytes: Uint8Array): string {
  const arquivo = path.join(dir, `pacote-${n++}.zip`);
  fs.writeFileSync(arquivo, Buffer.from(bytes));
  return arquivo;
}
/** O que o `unzip -l` lista, uma linha por arquivo. */
const listar = (zip: string) => execFileSync("unzip", ["-Z", "-1", zip], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
/** Extrai numa pasta nova e devolve o caminho dela. */
function extrair(zip: string): string {
  const destino = path.join(dir, `saida-${n++}`);
  fs.mkdirSync(destino);
  execFileSync("unzip", ["-qq", "-o", zip, "-d", destino], { stdio: "pipe" });
  return destino;
}

const texto = (s: string) => new TextEncoder().encode(s);
/** Algo que o DEFLATE não consegue encolher (bytes já comprimidos têm entropia alta). */
const JA_COMPRIMIDO = new Uint8Array(deflateRawSync(Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 2654435761) % 251))));

describe("zip: o arquivo é um zip de verdade", () => {
  it.skipIf(!TEM_UNZIP)("o `unzip -t` aprova e os bytes voltam exatamente como entraram", () => {
    const conteudo = texto("Contrato assinado por Marina Alves Pereira.\nLinha 2 com acento: ação, coração.");
    const zip = gravar(montarZip([
      { nome: "contrato.txt", bytes: conteudo },
      { nome: "foto.bin", bytes: JA_COMPRIMIDO },
    ]));

    expect(execFileSync("unzip", ["-t", zip], { encoding: "utf8" })).toContain("No errors detected");
    const saida = extrair(zip);
    expect(new Uint8Array(fs.readFileSync(path.join(saida, "contrato.txt")))).toEqual(conteudo);
    expect(new Uint8Array(fs.readFileSync(path.join(saida, "foto.bin")))).toEqual(JA_COMPRIMIDO);
  });

  it.skipIf(!TEM_UNZIP)("acento no nome sobrevive e a pasta de dentro é respeitada", () => {
    const zip = gravar(montarZip([
      { nome: "Documentos enviados/Certidão de nascimento.txt", bytes: texto("ok") },
      { nome: "Documentos enviados/RG (frente e verso).txt", bytes: texto("ok") },
    ]));
    expect(listar(zip).sort()).toEqual([
      "Documentos enviados/Certidão de nascimento.txt",
      "Documentos enviados/RG (frente e verso).txt",
    ]);
    const saida = extrair(zip);
    expect(fs.readFileSync(path.join(saida, "Documentos enviados/Certidão de nascimento.txt"), "utf8")).toBe("ok");
  });

  it.skipIf(!TEM_UNZIP)("nome repetido vira (2): nenhum arquivo é sobrescrito", () => {
    const zip = gravar(montarZip([
      { nome: "RG.txt", bytes: texto("frente") },
      { nome: "RG.txt", bytes: texto("verso") },
      { nome: "RG.txt", bytes: texto("terceiro") },
    ]));
    expect(listar(zip)).toEqual(["RG.txt", "RG (2).txt", "RG (3).txt"]);
    const saida = extrair(zip);
    expect(fs.readFileSync(path.join(saida, "RG.txt"), "utf8")).toBe("frente");
    expect(fs.readFileSync(path.join(saida, "RG (2).txt"), "utf8")).toBe("verso");
  });

  it.skipIf(!TEM_UNZIP)("nome perigoso não escreve fora da pasta onde o zip é aberto", () => {
    const zip = gravar(montarZip([
      { nome: "../../etc/passwd", bytes: texto("nao") },
      { nome: "/raiz/absoluto.txt", bytes: texto("nao") },
      { nome: "C:\\Windows\\system.ini", bytes: texto("nao") },
    ]));
    for (const nome of listar(zip)) {
      expect(nome.startsWith("/"), nome).toBe(false);
      expect(nome.split("/").includes(".."), nome).toBe(false);
      expect(/[<>:"\\|?*]/.test(nome), nome).toBe(false);
    }
    const saida = extrair(zip);
    // tudo caiu DENTRO da pasta de saída
    const dentro = execFileSync("find", [saida, "-type", "f"], { encoding: "utf8" }).trim().split("\n");
    expect(dentro.every((f) => f.startsWith(saida))).toBe(true);
    expect(dentro).toHaveLength(3);
  });

  it.skipIf(!TEM_UNZIP)("arquivo vazio e zip vazio continuam válidos", () => {
    // O zip sem nenhum arquivo são os 22 bytes do registro de fim — é o zip vazio canônico. O
    // `unzip -t` sai com código 1 e diz "zipfile is empty": é ele avisando que não há nada dentro,
    // não que o arquivo esteja quebrado. Quem chama é que decide recusar antes de chegar aqui.
    const vazio = montarZip([]);
    expect(vazio).toHaveLength(22);
    expect(Buffer.from(vazio.slice(0, 4))).toEqual(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let aviso = "";
    try { aviso = execFileSync("unzip", ["-t", gravar(vazio)], { encoding: "utf8" }); }
    catch (e) { aviso = String((e as { stdout?: string }).stdout ?? ""); }
    expect(aviso.toLowerCase()).toContain("zipfile is empty");

    const zip = gravar(montarZip([{ nome: "vazio.txt", bytes: new Uint8Array(0) }, { nome: "com-dado.txt", bytes: texto("x") }]));
    expect(execFileSync("unzip", ["-t", zip], { encoding: "utf8" })).toContain("No errors detected");
    const saida = extrair(zip);
    expect(fs.statSync(path.join(saida, "vazio.txt")).size).toBe(0);
  });

  it.skipIf(!TEM_UNZIP)("a data do arquivo vai para dentro do zip", () => {
    const zip = gravar(montarZip([{ nome: "antigo.txt", bytes: texto("x"), data: new Date("2024-03-10T14:30:00") }]));
    expect(execFileSync("unzip", ["-l", zip], { encoding: "utf8" })).toContain("2024-03-10 14:30");
  });
});

describe("zip: comprimir só quando vale", () => {
  it("texto repetitivo encolhe muito", () => {
    const grande = texto("documento de admissao ".repeat(400));
    const zip = montarZip([{ nome: "a.txt", bytes: grande }]);
    expect(zip.length).toBeLessThan(grande.length / 4);
  });

  it("o que já vem comprimido NÃO cresce (entra como está)", () => {
    const zip = montarZip([{ nome: "a.bin", bytes: JA_COMPRIMIDO }]);
    // o zip é o arquivo + os cabeçalhos (~150 bytes), nunca o arquivo inchado pelo DEFLATE
    expect(zip.length).toBeLessThan(JA_COMPRIMIDO.length + 200);
    expect(zip.length).toBeGreaterThanOrEqual(JA_COMPRIMIDO.length);
  });
});

describe("zip: os limites recusam em vez de estourar quieto", () => {
  it("arquivos demais é erro com mensagem", () => {
    const muitos = Array.from({ length: ARQUIVOS_MAX + 1 }, (_, i) => ({ nome: `${i}.txt`, bytes: texto("x") }));
    expect(() => montarZip(muitos)).toThrow(ErroZip);
    expect(() => montarZip(muitos)).toThrow(/não pode ter mais de/);
  });
});

describe("zip: as regras de nome, isoladas", () => {
  it("limpa o que é perigoso e nunca devolve vazio", () => {
    expect(nomeSeguroZip("../../etc/passwd")).toBe("etc/passwd");
    expect(nomeSeguroZip("/absoluto.txt")).toBe("absoluto.txt");
    expect(nomeSeguroZip("pasta\\sub\\a.txt")).toBe("pasta/sub/a.txt");
    expect(nomeSeguroZip('a<b>c:d"e|f?g*h.txt')).toBe("abcdefgh.txt");
    expect(nomeSeguroZip("   ")).toBe("arquivo");
    expect(nomeSeguroZip("")).toBe("arquivo");
    expect(nomeSeguroZip("..")).toBe("arquivo");
    expect(nomeSeguroZip("ação e coração.pdf"), "acento não é perigo").toBe("ação e coração.pdf");
  });

  it("o ponto final e o espaço no fim somem (o Windows não os aceita)", () => {
    expect(nomeSeguroZip("relatorio.")).toBe("relatorio");
    expect(nomeSeguroZip("relatorio.pdf ")).toBe("relatorio.pdf");
  });

  it("desambigua guardando a extensão", () => {
    expect(semRepetir(["a.pdf", "a.pdf", "b.pdf", "A.PDF"])).toEqual(["a.pdf", "a (2).pdf", "b.pdf", "A (3).PDF"]);
    expect(semRepetir(["sem-extensao", "sem-extensao"])).toEqual(["sem-extensao", "sem-extensao (2)"]);
  });
});

describe("zip: o CRC-32", () => {
  it("bate com os valores conhecidos do algoritmo", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(texto("123456789"))).toBe(0xcbf43926); // o vetor de referência do CRC-32
    expect(crc32(texto("a"))).toBe(0xe8b7be43);
  });
});
