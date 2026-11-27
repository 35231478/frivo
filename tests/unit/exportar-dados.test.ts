/**
 * "Exportar dados da empresa (backup portátil)" — as regras puras:
 *  - o CSV (BOM, `;`, CRLF, aspas só quando precisa) volta IGUAL pelo leitor da importação;
 *  - datas, números e rótulos no formato brasileiro;
 *  - o catálogo: 19 arquivos numerados, cada um numa parte, os da Implantação com a entidade da importação;
 *  - o LEIA-ME, o nome do .zip, quem pode exportar e a situação de cada exportação;
 *  - os lotes (cursor por id) e o CSV em pedaços;
 *  - o zip em streaming é um zip de verdade (o zipfile do Python confere o CRC), com nome em UTF-8, arquivo
 *    vazio e arquivo grande em muitos pedaços; o erro no meio não vira zip "concluído";
 *  - o menu só mostra o item ao administrador; a planilha de colaboradores nem consulta o que é sensível.
 */
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { lerCsv } from "@/lib/folha/planilha";
import {
  ARQUIVOS, arquivosDaParte, BOM, celulaCsv, COLUNAS, dia, dinheiro, ehParte, EXPORTACAO_ABANDONADA_MS, instante, leiaMe, linhaCsv, nomeDoZip,
  numero, PARTES, podeExportar, rotulo, simNao, situacaoExportacao,
} from "@/lib/exportacao/arquivos";
import { csvEmPedacos, emLotes, situacaoContratoImportacao } from "@/lib/exportacao/servidor";
import { zipEmStream, type ArquivoStream } from "@/lib/zip-stream";
import { ENTIDADES_IMPORTACAO } from "@/lib/importacao/entidades";
import { itemConfig, podeVerItemConfig, secoesVisiveis } from "@/lib/navegacao/configuracoes";
import { permissoesTotais } from "@/lib/permissoes";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const RAIZ = path.resolve(__dirname, "../..");
const texto = (bs: Uint8Array[]) => Buffer.concat(bs.map((b) => Buffer.from(b))).toString("utf8");
async function juntar(it: AsyncIterable<Uint8Array>) {
  const bs: Uint8Array[] = [];
  for await (const b of it) bs.push(b);
  return bs;
}
async function* lotesDe<T>(...ls: T[][]) { for (const l of ls) yield l; }

/** Abre o zip com o zipfile do Python (confere o CRC de cada arquivo) → { nome: bytes em base64 } */
function abrirZip(bytes: Uint8Array): Record<string, Buffer> {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-stream-"));
  try {
    const arq = path.join(dir, "x.zip");
    writeFileSync(arq, bytes);
    const json = execFileSync("python3", ["-I", "-c", [
      "import sys, json, zipfile, base64",
      "z = zipfile.ZipFile(sys.argv[1])",
      "assert z.testzip() is None",
      "print(json.dumps({i.filename: [base64.b64encode(z.read(i)).decode(), i.flag_bits, i.compress_type] for i in z.infolist()}))",
    ].join("\n"), arq], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const r: Record<string, [string, number, number]> = JSON.parse(json);
    return Object.fromEntries(Object.entries(r).map(([n, [b64, flag, metodo]]) => {
      expect(flag & 0x0808, n).toBe(0x0808); // descritor depois do conteúdo + nome em UTF-8
      expect(metodo, n).toBe(8); // DEFLATE
      return [n, Buffer.from(b64, "base64")];
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("o CSV", () => {
  it("célula: aspas só quando precisa; aspas internas dobradas", () => {
    expect(celulaCsv("simples")).toBe("simples");
    expect(celulaCsv(null)).toBe("");
    expect(celulaCsv(undefined)).toBe("");
    expect(celulaCsv(0)).toBe("0");
    expect(celulaCsv("a;b")).toBe('"a;b"');
    expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""');
    expect(celulaCsv("linha 1\nlinha 2")).toBe('"linha 1\nlinha 2"');
    expect(celulaCsv("com\rcr")).toBe('"com\rcr"');
    expect(celulaCsv(" espaço")).toBe('" espaço"');
    expect(celulaCsv("espaço ")).toBe('"espaço "');
    expect(linhaCsv(["a", 1, null, "b;c"])).toBe('a;1;;"b;c"\r\n');
  });

  it("volta IGUAL pelo leitor da importação (BOM, ;, CRLF, aspas, quebra de linha, acento)", () => {
    const linhas = [
      ["nome", "obs", "valor"],
      ["Ação & Cia; Ltda", 'Diz "olá"\nsegunda linha', "1250,50"],
      ["  com espaços  ", "", "0"],
      ["São João", "ç ã é ü", "-3,2"],
    ];
    const csv = BOM + linhas.map(linhaCsv).join("");
    expect(csv.startsWith("﻿")).toBe(true);
    const lido = lerCsv(csv).map((l) => l.map((c) => (c == null ? "" : String(c))));
    // O leitor da importação trata célula só de espaços como vazia e devolve o resto como está
    expect(lido).toEqual(linhas.map((l) => l.map((c) => (c.trim() === "" ? "" : c))));
  });

  it("valores no formato brasileiro", () => {
    expect(dia(new Date("2026-02-01T12:00:00Z"))).toBe("01/02/2026");
    expect(dia(null)).toBe("");
    expect(dia("lixo")).toBe("");
    expect(instante(new Date("2026-03-10T15:30:00Z"))).toMatch(/^10\/03\/2026 (às )?12:30$/);
    expect(instante(undefined)).toBe("");
    expect(numero(1250.5)).toBe("1250,5");
    expect(numero(7)).toBe("7");
    expect(numero(null)).toBe("");
    expect(numero("x")).toBe("");
    expect(dinheiro(1250.5)).toBe("1250,50");
    expect(dinheiro(0)).toBe("0,00");
    expect(dinheiro(null)).toBe("");
    expect(simNao(true)).toBe("Sim");
    expect(simNao(false)).toBe("Não");
    expect(simNao(null)).toBe("");
    expect(rotulo({ A: "Ativo" }, "A")).toBe("Ativo");
    expect(rotulo({ A: "Ativo" }, "Z")).toBe("Z");
    expect(rotulo({ A: "Ativo" }, null)).toBe("");
  });
});

describe("o catálogo do pacote", () => {
  it("19 arquivos numerados em ordem, nomes únicos, cada um numa parte", () => {
    expect(ARQUIVOS).toHaveLength(19);
    ARQUIVOS.forEach((a, i) => expect(a.nome).toMatch(new RegExp(`^${String(i + 1).padStart(2, "0")}-[a-z-]+\\.csv$`)));
    expect(new Set(ARQUIVOS.map((a) => a.id)).size).toBe(19);
    expect(PARTES).toEqual(["tudo", "cadastros", "operacao", "financeiro"]);
    expect(arquivosDaParte("tudo")).toEqual(ARQUIVOS);
    const soma = (["cadastros", "operacao", "financeiro"] as const).reduce((s, p) => s + arquivosDaParte(p).length, 0);
    expect(soma).toBe(19);
    expect(arquivosDaParte("financeiro").map((a) => a.id)).toEqual(["contas_receber", "contas_pagar"]);
    expect(arquivosDaParte("operacao").map((a) => a.id)).toEqual(["os", "os_itens", "os_atividades", "orcamentos", "orcamentos_itens"]);
    expect(ehParte("cadastros")).toBe(true);
    expect(ehParte("../x")).toBe(false);
    expect(ehParte(undefined)).toBe(false);
  });

  it("TODA planilha da Implantação está no pacote, com a entidade da importação", () => {
    const comImportacao = ARQUIVOS.filter((a) => a.importacao).map((a) => a.importacao);
    expect([...comImportacao].sort()).toEqual([...ENTIDADES_IMPORTACAO].sort());
    for (const a of ARQUIVOS.filter((x) => x.importacao)) expect(a.parte).toBe("cadastros");
  });

  it("os arquivos com colunas próprias terminam no id_sistema e não repetem coluna", () => {
    for (const [id, cols] of Object.entries(COLUNAS)) {
      expect(cols[cols.length - 1], id).toBe("id_sistema");
      expect(new Set(cols).size, id).toBe(cols.length);
      expect(ARQUIVOS.find((a) => a.id === id)?.importacao, id).toBeUndefined();
    }
  });

  it("contrato: a situação nas três opções que a importação aceita", () => {
    expect(situacaoContratoImportacao("ATIVO")).toBe("Ativo");
    expect(situacaoContratoImportacao("SUSPENSO")).toBe("Ativo");
    expect(situacaoContratoImportacao("AGUARDANDO_ASSINATURA")).toBe("Ativo");
    expect(situacaoContratoImportacao("EM_RENOVACAO")).toBe("Ativo");
    expect(situacaoContratoImportacao("ENCERRADO")).toBe("Encerrado");
    expect(situacaoContratoImportacao("VENCIDO")).toBe("Encerrado");
    expect(situacaoContratoImportacao("CANCELADO")).toBe("Cancelado");
  });
});

describe("LEIA-ME, nome do zip, permissão e situação", () => {
  const info = { empresa: "Refrigeração Teste (fictícia)", cnpj: "11.222.333/0001-81", geradoEm: new Date("2026-11-27T13:00:00Z"), geradoPor: "Ana" };

  it("LEIA-ME: empresa, data, quem, a parte e o que cada arquivo tem; o que fica de fora", () => {
    const l = leiaMe({ ...info, parte: "tudo" });
    expect(l).toContain("Empresa: Refrigeração Teste (fictícia) (CNPJ 11.222.333/0001-81)");
    expect(l).toMatch(/Gerado em: 27\/11\/2026 (às )?10:00 \(horário de Brasília\)/);
    expect(l).toContain("Gerado por: Ana");
    expect(l).toContain("Parte: Tudo");
    for (const a of ARQUIVOS) expect(l).toContain(`- ${a.nome}: ${a.descricao}`);
    expect(l).toContain("- 01-clientes.csv: Clientes (razão social, CNPJ/CPF, endereço principal, contatos de cobrança). [mesmas colunas da importação]");
    expect(l).not.toContain("13-os.csv: Ordens de serviço: cabeçalho (número, cliente, unidade, situação, datas, valores). [mesmas");
    expect(l).toMatch(/Fotos, anexos, PDFs/);
    expect(l).toMatch(/Senhas, salários, dados bancários/);
    expect(l).toContain("LGPD");
    expect(l).not.toMatch(/você/i);
    expect(l.split("\r\n").length).toBeGreaterThan(20);
    const f = leiaMe({ ...info, cnpj: null, parte: "financeiro" });
    expect(f).toContain("Empresa: Refrigeração Teste (fictícia)\r\n");
    expect(f).toContain("Parte: Financeiro");
    expect(f).toContain("18-contas-receber.csv");
    expect(f).not.toContain("01-clientes.csv");
  });

  it("nome do zip: só letras, números e hífen; a parte quando não é tudo; o dia de Brasília", () => {
    const q = new Date("2026-11-28T01:30:00Z"); // ainda dia 27 em Brasília
    expect(nomeDoZip("Refrigeração Ação & Cia.", "tudo", q)).toBe("frivo-dados-refrigeracao-acao-cia-2026-11-27.zip");
    expect(nomeDoZip("Termofrio", "cadastros", q)).toBe("frivo-dados-termofrio-cadastros-2026-11-27.zip");
    expect(nomeDoZip("***", "tudo", q)).toBe("frivo-dados-empresa-2026-11-27.zip");
    expect(nomeDoZip("x".repeat(80), "tudo", q)).toBe(`frivo-dados-${"x".repeat(40)}-2026-11-27.zip`);
  });

  it("só o administrador exporta", () => {
    expect(podeExportar("ADMIN")).toBe(true);
    expect(podeExportar("SUPER_ADMIN")).toBe(true);
    for (const r of ["OPERADOR", "TECNICO", "FINANCEIRO", "", null, undefined]) expect(podeExportar(r), String(r)).toBe(false);
  });

  it("situação: concluída, falhou (erro gravado ou parada há mais de 15 min), gerando", () => {
    const agora = new Date("2026-11-27T12:00:00Z");
    const antes = (ms: number) => new Date(agora.getTime() - ms);
    expect(situacaoExportacao({ criadoEm: antes(60_000), concluidaEm: agora }, agora)).toBe("concluida");
    expect(situacaoExportacao({ criadoEm: antes(60_000), erro: "caiu" }, agora)).toBe("falhou");
    expect(situacaoExportacao({ criadoEm: antes(60_000) }, agora)).toBe("andamento");
    expect(situacaoExportacao({ criadoEm: antes(EXPORTACAO_ABANDONADA_MS - 1000) }, agora)).toBe("andamento");
    expect(situacaoExportacao({ criadoEm: antes(EXPORTACAO_ABANDONADA_MS + 1000) }, agora)).toBe("falhou");
    expect(situacaoExportacao({ criadoEm: antes(EXPORTACAO_ABANDONADA_MS + 1000).toISOString(), concluidaEm: agora.toISOString() }, agora)).toBe("concluida");
  });

  it("o menu: o item só aparece ao administrador (o cookie não basta: a rota confere de novo)", () => {
    const item = itemConfig("exportar-dados")!;
    expect(item).toMatchObject({ aba: "conta", soAdmin: true, label: "Exportar dados" });
    const tudo = permissoesTotais();
    expect(podeVerItemConfig(item, tudo, "ADMIN")).toBe(true);
    expect(podeVerItemConfig(item, tudo, "SUPER_ADMIN")).toBe(true);
    expect(podeVerItemConfig(item, tudo, "OPERADOR")).toBe(false);
    expect(podeVerItemConfig(item, tudo, "TECNICO")).toBe(false);
    const ids = (role: string) => secoesVisiveis(tudo, role).flatMap((s) => s.subgrupos.flatMap((g) => g.itens.map((i) => i.id)));
    expect(ids("ADMIN")).toContain("exportar-dados");
    expect(ids("OPERADOR")).not.toContain("exportar-dados");
    // Os outros itens não mudaram de regra
    expect(ids("OPERADOR")).toContain("empresa");
  });
});

describe("lotes e CSV em pedaços", () => {
  it("emLotes: anda pelo cursor (id do último) até um lote incompleto ou vazio", async () => {
    const ids = Array.from({ length: 7 }, (_, i) => ({ id: `id${i}` }));
    const pedidos: (string | null)[] = [];
    const buscar = async (depoisDe: string | null, take: number) => {
      pedidos.push(depoisDe);
      const i = depoisDe ? ids.findIndex((x) => x.id === depoisDe) + 1 : 0;
      return ids.slice(i, i + take);
    };
    const lotes: string[][] = [];
    for await (const l of emLotes(buscar, 3)) lotes.push(l.map((x) => x.id));
    expect(lotes).toEqual([["id0", "id1", "id2"], ["id3", "id4", "id5"], ["id6"]]);
    expect(pedidos).toEqual([null, "id2", "id5"]);

    // Múltiplo exato do lote: uma consulta a mais, vazia, e para
    pedidos.length = 0;
    const seis = ids.slice(0, 6);
    const lotes2: number[] = [];
    for await (const l of emLotes(async (d, t) => { pedidos.push(d); const i = d ? seis.findIndex((x) => x.id === d) + 1 : 0; return seis.slice(i, i + t); }, 3)) lotes2.push(l.length);
    expect(lotes2).toEqual([3, 3]);
    expect(pedidos).toEqual([null, "id2", "id5"]);
  });

  it("csvEmPedacos: BOM + cabeçalho primeiro, um pedaço por lote, lote vazio não conta", async () => {
    const conta = { linhas: 0 };
    const bs = await juntar(csvEmPedacos(["a", "b"], lotesDe([["1", "x;y"]], [], [["2", null], ["3", 'z"']]), conta));
    expect(bs).toHaveLength(3);
    expect(texto(bs)).toBe(`${BOM}a;b\r\n1;"x;y"\r\n2;\r\n3;"z"""\r\n`);
    expect(conta.linhas).toBe(3);
    const vazio = await juntar(csvEmPedacos(["só", "cabeçalho"], lotesDe()));
    expect(texto(vazio)).toBe(`${BOM}só;cabeçalho\r\n`);
  });
});

describe("o zip em streaming", () => {
  it("é um zip de verdade: nome UTF-8, arquivo vazio, arquivo grande em muitos pedaços", async () => {
    const grande = randomBytes(300_000);
    const repetido = Buffer.from("linha;de;teste\r\n".repeat(20_000));
    const arquivos: ArquivoStream[] = [
      { nome: "LEIA-ME.txt", partes: async function* () { yield new TextEncoder().encode("Olá, çã"); } },
      { nome: "vazio.csv", partes: async function* () {} },
      { nome: "aleatório.bin", partes: async function* () { for (let i = 0; i < grande.length; i += 7_000) yield new Uint8Array(grande.subarray(i, i + 7_000)); } },
      { nome: "pasta/repetido.csv", partes: async function* () { for (let i = 0; i < repetido.length; i += 1_000) yield new Uint8Array(repetido.subarray(i, i + 1_000)); } },
    ];
    const resumos: unknown[] = [];
    const pedacos = await juntar(zipEmStream(arquivos, { agora: new Date("2026-11-27T12:00:00Z"), aoTerminar: (r) => { resumos.push(r); } }));
    expect(pedacos.length).toBeGreaterThan(10);
    const zip = abrirZip(new Uint8Array(Buffer.concat(pedacos.map((p) => Buffer.from(p)))));
    expect(Object.keys(zip)).toEqual(["LEIA-ME.txt", "vazio.csv", "aleatório.bin", "pasta/repetido.csv"]);
    expect(zip["LEIA-ME.txt"].toString("utf8")).toBe("Olá, çã");
    expect(zip["vazio.csv"].length).toBe(0);
    expect(zip["aleatório.bin"].equals(grande)).toBe(true);
    expect(zip["pasta/repetido.csv"].equals(repetido)).toBe(true);
    expect(resumos).toEqual([{ arquivos: [
      { nome: "LEIA-ME.txt", bytes: Buffer.byteLength("Olá, çã") }, { nome: "vazio.csv", bytes: 0 },
      { nome: "aleatório.bin", bytes: grande.length }, { nome: "pasta/repetido.csv", bytes: repetido.length },
    ] }]);
    // Comprimido de verdade (o repetitivo encolhe muito)
    expect(Buffer.concat(pedacos.map((p) => Buffer.from(p))).length).toBeLessThan(grande.length + repetido.length / 10);
  });

  it("o nome perigoso é limpo como no lib/zip (sem subir de pasta)", async () => {
    const zip = abrirZip(new Uint8Array(Buffer.concat((await juntar(zipEmStream([
      { nome: "../../etc/x.csv", partes: async function* () { yield new Uint8Array([65]); } },
    ]))).map((p) => Buffer.from(p)))));
    expect(Object.keys(zip)[0]).not.toMatch(/\.\.\//);
  });

  it("erro no meio de um arquivo: o zip para com erro e nunca chama o aoTerminar", async () => {
    const aoTerminar = vi.fn();
    const arquivos: ArquivoStream[] = [
      { nome: "a.csv", partes: async function* () { yield new Uint8Array([1, 2, 3]); } },
      { nome: "b.csv", partes: async function* () { yield new Uint8Array([4]); throw new Error("banco caiu"); } },
      { nome: "c.csv", partes: async function* () { yield new Uint8Array([5]); } },
    ];
    await expect(juntar(zipEmStream(arquivos, { aoTerminar }))).rejects.toThrow("banco caiu");
    expect(aoTerminar).not.toHaveBeenCalled();
  });

  it("mais de 65.535 arquivos é erro (zip64 fora do escopo)", async () => {
    const muitos = Array.from({ length: 65_536 }, (_, i) => ({ nome: `${i}.txt`, partes: async function* () {} }));
    await expect(juntar(zipEmStream(muitos))).rejects.toThrow(/arquivos demais/);
  });
});

describe("o que a planilha de colaboradores nem consulta", () => {
  it("o select de colaboradores na exportação não tem salário, senha, banco nem documento pessoal", () => {
    const fonte = readFileSync(path.join(RAIZ, "lib/importacao/servidor.ts"), "utf8");
    const bloco = fonte.slice(fonte.indexOf('case "colaboradores": return prisma.tecnico.findMany({'));
    const select = bloco.slice(bloco.indexOf("select:"), bloco.indexOf("});"));
    expect(select).toContain("cpf: true");
    for (const campo of ["salario", "senha", "banco", "agencia", "conta", "pix", "rg", "pis", "ctps", "nomeMae", "dataNascimento"])
      expect(select, campo).not.toMatch(new RegExp(`\\b${campo}\\w*:`, "i"));
  });
});
