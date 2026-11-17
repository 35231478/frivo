/**
 * O MOTOR DE DOCUMENTOS nas rotas de verdade, sobre PostgreSQL de verdade.
 *
 * O que se prova:
 *  - permissão: 401 sem sessão, 403 sem "Documentos do colaborador › criar", e nem um byte sai;
 *  - empresa: colaborador e documento de outra empresa são 404 — nunca o arquivo;
 *  - o papel sai com os campos do CADASTRO preenchidos e o que o sistema não conhece VISÍVEL;
 *  - campo obrigatório do tipo em branco recusa com a mensagem, em vez de gerar papel pela metade;
 *  - a ficha de EPI leva a tabela de itens com o CA, e sem CA a rota recusa;
 *  - o papel só vira ANEXO na ficha quando está pronto: sem assinatura exigida, na hora; com
 *    assinatura, depois de assinar — e o PDF de antes sai marcado PRÉVIA;
 *  - a assinatura grava a prova (nome, hora, IP, navegador, foto) e não acontece duas vezes;
 *  - a validade do modelo vira data de vencimento no anexo (o aviso que já existe passa a valer);
 *  - ADVERTÊNCIA é blindada: sem "› disciplinar" não gera, não aparece no histórico e o PDF é 404;
 *  - cancelar não apaga: guarda quem, quando e por quê, e tira o anexo da ficha com rastro;
 *  - duas assinaturas ao mesmo tempo gravam UMA (a corrida é decidida pelo próprio UPDATE);
 *  - o que não é imagem não vira foto de assinatura;
 *  - guardar o anexo é idempotente, e regerar depois conta a validade da ASSINATURA, não do
 *    dia em que o arquivo foi refeito;
 *  - documento de outra empresa é 404 em todas as rotas que recebem o id.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { textoDoPdf } from "./pmoc-pdf-util";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_docmodelos_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 16/11/2026, 09:00 em Brasília */
const AGORA = new Date("2026-11-16T12:00:00.000Z");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = empresaId === "e1" ? "uA" : "uB") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@x.com", empresaId, empresaNome: "Empresa", role: "OPERADOR", permissoes, tecnicoId: null } };
};
/** Quem gera documento, mas não é do disciplinar. */
const comoGerador = () => como(montarPermissoes({ documentos: ["criar", "gerenciar"], equipes: ["visualizar", "gerenciar"] }));
const semPermissao = () => como(montarPermissoes({ equipes: ["visualizar", "gerenciar", "excluir"] }));
const deslogado = () => { sessao.atual = null; };

const ROTAS = {
  gerados: "api/tecnicos/[id]/documentos-gerados",
  previa: "api/tecnicos/[id]/documentos-gerados/previa",
  assinar: "api/documentos-gerados/[id]/assinar",
  cancelar: "api/documentos-gerados/[id]/cancelar",
  pdf: "api/documentos-gerados/[id]/pdf",
  cadastros: "api/cadastros/[entidade]",
} as const;

async function chamar(
  rota: keyof typeof ROTAS, metodo: string,
  op: { id?: string; entidade?: string; corpo?: unknown; query?: string } = {},
) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[rota]}/route`);
  const req = new NextRequest(`https://app.exemplo.com/x${op.query ? `?${op.query}` : ""}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "user-agent": "Mozilla/5.0 (iPhone)", "x-forwarded-for": "200.1.2.3" },
    body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo),
  });
  const res: Response = await mod[metodo](req, {
    params: Promise.resolve({ id: op.id ?? "", entidade: op.entidade ?? "" }),
  });
  const tipo = res.headers.get("Content-Type") ?? "";
  return {
    status: res.status,
    headers: res.headers,
    json: tipo.includes("json") ? await res.json().catch(() => null) : null,
    bytes: tipo.includes("json") ? null : new Uint8Array(await res.arrayBuffer()),
  };
}
const erro = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json?.erro ?? ""}`; };

const dataUrl = (bytes: Uint8Array, tipo: string) => `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
const FOTO = dataUrl(PNG, "image/png");

const TEXTO_EPI = [
  "{{empresa}}, CNPJ {{empresaCnpj}}, entrega a {{nome}}, CPF {{cpf}}, cargo {{cargo}},",
  "os equipamentos de proteção listados abaixo, em {{entregaEm}}.",
  "",
  "Declaro ter recebido os equipamentos e me comprometo a usá-los.",
  "",
  "{{cidade}}, {{data}}.",
].join("\n");

const TEXTO_ADVERTENCIA = "Fica {{nome}} advertido por {{motivo}}, ocorrido em {{ocorridoEm}}. Medida: {{medida}}.";

describe.skipIf(!URL_PG)("Motor de documentos (PostgreSQL real)", () => {
  let prisma: any;

  /** Cria um modelo pela rota de cadastros (o CRUD de verdade) e devolve o id. */
  async function criarModelo(corpo: Record<string, unknown>) {
    const r = await chamar("cadastros", "POST", { entidade: "modelos-documento", corpo });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json.id as string;
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total LTDA", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com", cidade: "Campinas", estado: "SP" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto Dias", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cargo.create({ data: { id: "g1", empresaId: "e1", nome: "Técnico de refrigeração", cbo: "9112-05" } });
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    await prisma.documentoEmitido.deleteMany({});
    await prisma.documentoModelo.deleteMany({});
    await prisma.colaboradorDocumento.deleteMany({});
    await prisma.tecnico.deleteMany({});
    await prisma.tecnico.createMany({ data: [
      {
        id: "t1", empresaId: "e1", nome: "Marina Alves Pereira", cpf: "52998224725", rg: "33.444.555-6", telefone: "(19) 98888-7777",
        cargoId: "g1", salario: 3200, dataAdmissao: new Date("2026-11-16T12:00:00.000Z"),
        endereco: "Rua das Flores", numero: "120", bairro: "Centro", cidade: "Campinas", estado: "SP", cep: "13010-000",
        jornadaEntrada: "08:00", jornadaSaida: "18:00", jornadaDias: ["SEG", "TER", "QUA", "QUI", "SEX"],
      },
      { id: "t2", empresaId: "e2", nome: "Pedro de Outra Empresa", cpf: "11144477735", telefone: "(19) 97777-6666" },
    ] });
    como();
  });

  /* ───────────────────────── permissão e empresa ───────────────────────── */

  it("sem sessão é 401 em todas as rotas, e nem um byte sai", async () => {
    deslogado();
    expect(await erro(chamar("gerados", "GET", { id: "t1" }))).toBe("401 Não autorizado");
    expect(await erro(chamar("gerados", "POST", { id: "t1", corpo: { modeloId: "x" } }))).toBe("401 Não autorizado");
    const pdf = await chamar("pdf", "GET", { id: "x" });
    expect(pdf.status).toBe(401);
    expect(pdf.bytes).toBeNull();
  });

  it("sem \"Documentos do colaborador › criar\" é 403 — mesmo para quem gerencia colaboradores", async () => {
    semPermissao();
    expect(await erro(chamar("gerados", "GET", { id: "t1" }))).toBe("403 Sem permissão para esta ação");
    expect(await erro(chamar("gerados", "POST", { id: "t1", corpo: { modeloId: "x" } }))).toBe("403 Sem permissão para esta ação");
  });

  it("colaborador de OUTRA empresa é 404 — nunca o papel", async () => {
    const modeloId = await criarModelo({ nome: "Termo", tipo: "TERMO", texto: "Recebi {{nome}} o equipamento." });
    expect(await erro(chamar("gerados", "POST", { id: "t2", corpo: { modeloId } }))).toBe("404 Colaborador não encontrado");
  });

  it("modelo de outra empresa não gera nada", async () => {
    const alheio = await prisma.documentoModelo.create({
      data: { empresaId: "e2", nome: "De fora", tipo: "OUTRO", texto: "Texto qualquer para o teste." },
    });
    expect(await erro(chamar("gerados", "POST", { id: "t1", corpo: { modeloId: alheio.id } }))).toBe("404 Modelo não encontrado");
  });

  /* ───────────────────────── o papel ───────────────────────── */

  it("o texto sai com os dados do cadastro, e o campo que o sistema não conhece fica VISÍVEL", async () => {
    const modeloId = await criarModelo({
      nome: "Comunicado", tipo: "OUTRO",
      texto: "{{empresa}} comunica a {{nome}}, cargo {{cargo}}, salário {{salario}}. Visto: {{supervisor}}",
    });
    const r = await chamar("previa", "POST", { id: "t1", corpo: { modeloId } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.texto).toContain("Clima Total comunica a Marina Alves Pereira");
    expect(r.json.texto).toContain("cargo Técnico de refrigeração");
    // o formatador da casa usa espaço fino (não-quebrável) depois do "R$" — comparar sem depender disso
    expect(r.json.texto.replace(/\s/g, " ")).toContain("R$ 3.200,00");
    // o que o sistema não conhece não é inventado nem apagado
    expect(r.json.texto).toContain("{{supervisor}}");
    expect(r.json.desconhecidos).toEqual(["supervisor"]);
  });

  it("a data que a tela manda (AAAA-MM-DD) sai no texto em dd/mm/aaaa", async () => {
    const modeloId = await criarModelo({
      nome: "Termo", tipo: "TERMO", texto: "Entregue em {{entregaEm}}, com devolução prevista para {{devolucaoEm}}.",
    });
    const r = await chamar("previa", "POST", {
      id: "t1", corpo: { modeloId, valores: { entregaEm: "2026-11-17", devolucaoEm: "2027-01-05" } },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.texto).toBe("Entregue em 17/11/2026, com devolução prevista para 05/01/2027.");
  });

  it("campo obrigatório do tipo em branco recusa, em vez de gerar papel pela metade", async () => {
    const modeloId = await criarModelo({ nome: "Advertência", tipo: "ADVERTENCIA", texto: TEXTO_ADVERTENCIA });
    expect(await erro(chamar("gerados", "POST", { id: "t1", corpo: { modeloId, valores: { motivo: "atraso" } } })))
      .toContain("Preencha:");
  });

  it("a ficha de EPI exige o CA de cada item", async () => {
    const modeloId = await criarModelo({ nome: "Ficha de EPI", tipo: "EPI", texto: TEXTO_EPI, temItens: true });
    const semCa = await chamar("gerados", "POST", {
      id: "t1",
      corpo: { modeloId, valores: { entregaEm: "16/11/2026" }, itens: [{ descricao: "Luva", quantidade: 2 }] },
    });
    expect(semCa.status).toBe(400);
    expect(semCa.json.erro).toContain("CA");
  });

  it("gerar a ficha de EPI: o papel fica aguardando assinatura e o PDF sai como PRÉVIA", async () => {
    const modeloId = await criarModelo({ nome: "Ficha de EPI", tipo: "EPI", texto: TEXTO_EPI, temItens: true, validadeDias: 180 });
    const r = await chamar("gerados", "POST", {
      id: "t1",
      corpo: {
        modeloId, valores: { entregaEm: "16/11/2026" },
        itens: [{ descricao: "Luva de vaqueta", ca: "12345", quantidade: 2 }, { descricao: "Botina", ca: "54321", quantidade: 1 }],
      },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.assinadoEm).toBeNull();
    expect(r.json.itens).toBe(2);
    // sem assinatura ainda, o arquivo NÃO está na ficha
    expect(r.json.documentoId).toBeNull();
    expect(await prisma.colaboradorDocumento.count()).toBe(0);

    const pdf = await chamar("pdf", "GET", { id: r.json.id });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toContain("application/pdf");
    const texto = await textoDoPdf(pdf.bytes!);
    expect(texto).toContain("PRÉVIA");
    expect(texto).toContain("Luva de vaqueta");
    expect(texto).toContain("12345");
    expect(texto).toContain("Itens entregues");
    // a coluna do CA tem cabeçalho próprio: é por ele que a fiscalização começa a ler
    expect(texto).toMatch(/\bCA\b/);
  });

  it("assinar grava a prova, guarda o papel na ficha e some a tarja de prévia", async () => {
    const modeloId = await criarModelo({ nome: "Ficha de EPI", tipo: "EPI", texto: TEXTO_EPI, temItens: true, validadeDias: 180 });
    const g = await chamar("gerados", "POST", {
      id: "t1",
      corpo: { modeloId, valores: { entregaEm: "16/11/2026" }, itens: [{ descricao: "Luva", ca: "12345", quantidade: 1 }] },
    });
    const a = await chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Marina Alves Pereira", selfie: FOTO } });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(a.json.assinadoPor).toBe("Marina Alves Pereira");
    expect(a.json.assinadoEm).toBe(AGORA.toISOString());
    expect(a.json.documentoId).toBeTruthy();

    const linha = await prisma.documentoEmitido.findUnique({ where: { id: g.json.id } });
    expect(linha.assinaturaIp).toBe("200.1.2.3");
    expect(linha.assinaturaUserAgent).toContain("iPhone");
    expect(linha.selfie).toContain("data:image/png");

    // o anexo entrou na ficha, na gaveta do tipo, com a validade do modelo
    const anexo = await prisma.colaboradorDocumento.findUnique({ where: { id: a.json.documentoId } });
    expect(anexo.categoria).toBe("ficha_epi");
    expect(anexo.origem).toBe("GERADO");
    expect(anexo.arquivoTipo).toBe("application/pdf");
    expect(anexo.dataVencimento.toISOString().slice(0, 10)).toBe("2027-05-15");

    const pdf = await chamar("pdf", "GET", { id: g.json.id });
    const texto = await textoDoPdf(pdf.bytes!);
    expect(texto).not.toContain("PRÉVIA");
    expect(texto).toContain("Prova da assinatura");
    expect(texto).toContain("200.1.2.3");
  });

  it("assinar duas vezes não reescreve a assinatura", async () => {
    const modeloId = await criarModelo({ nome: "Termo", tipo: "TERMO", texto: "Recebi, {{nome}}, o notebook em {{entregaEm}}." });
    const g = await chamar("gerados", "POST", { id: "t1", corpo: { modeloId, valores: { entregaEm: "16/11/2026" } } });
    await chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Marina Alves Pereira", selfie: FOTO } });
    expect(await erro(chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Outra Pessoa", selfie: FOTO } })))
      .toBe("409 Este documento já foi assinado.");
    const linha = await prisma.documentoEmitido.findUnique({ where: { id: g.json.id } });
    expect(linha.assinaturaNome).toBe("Marina Alves Pereira");
    expect(await prisma.colaboradorDocumento.count()).toBe(1);
  });

  it("assinatura sem foto ou sem nome é recusada", async () => {
    const modeloId = await criarModelo({ nome: "Termo", tipo: "TERMO", texto: "Recebi, {{nome}}, o notebook em {{entregaEm}}." });
    const g = await chamar("gerados", "POST", { id: "t1", corpo: { modeloId, valores: { entregaEm: "16/11/2026" } } });
    expect(await erro(chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Ma", selfie: FOTO } }))).toContain("nome completo");
    expect(await erro(chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Marina Alves", selfie: "" } }))).toContain("foto");
  });

  it("modelo que não pede assinatura já nasce guardado na ficha", async () => {
    const modeloId = await criarModelo({
      nome: "Aditivo de salário", tipo: "ADITIVO",
      texto: "Fica alterado o salário de {{nome}} a partir de {{vigenciaEm}}: {{alteracao}}.",
      exigeAssinatura: false,
    });
    const g = await chamar("gerados", "POST", {
      id: "t1", corpo: { modeloId, valores: { vigenciaEm: "01/12/2026", alteracao: "salário para R$ 3.500,00" } },
    });
    expect(g.status, JSON.stringify(g.json)).toBe(201);
    expect(g.json.documentoId).toBeTruthy();
    const anexo = await prisma.colaboradorDocumento.findUnique({ where: { id: g.json.documentoId } });
    expect(anexo.categoria).toBe("contrato");
    expect(anexo.dataVencimento).toBeNull();
    expect(await erro(chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Marina Alves", selfie: FOTO } })))
      .toBe("409 Este documento não pede assinatura.");
  });

  /* ───────────────────────── o disciplinar ───────────────────────── */

  it("sem \"› disciplinar\" a advertência não é gerada", async () => {
    const modeloId = await criarModelo({ nome: "Advertência", tipo: "ADVERTENCIA", texto: TEXTO_ADVERTENCIA });
    comoGerador();
    expect(await erro(chamar("gerados", "POST", {
      id: "t1", corpo: { modeloId, valores: { motivo: "atraso reiterado", ocorridoEm: "10/11/2026", medida: "Advertência escrita" } },
    }))).toBe("403 Sem permissão para esta ação");
  });

  it("a advertência some do histórico e o PDF é 404 para quem não tem a permissão", async () => {
    const epi = await criarModelo({ nome: "Ficha de EPI", tipo: "EPI", texto: TEXTO_EPI, temItens: true });
    const adv = await criarModelo({ nome: "Advertência", tipo: "ADVERTENCIA", texto: TEXTO_ADVERTENCIA });
    await chamar("gerados", "POST", { id: "t1", corpo: { modeloId: epi, valores: { entregaEm: "16/11/2026" }, itens: [{ descricao: "Luva", ca: "1", quantidade: 1 }] } });
    const a = await chamar("gerados", "POST", {
      id: "t1", corpo: { modeloId: adv, valores: { motivo: "atraso reiterado", ocorridoEm: "10/11/2026", medida: "Advertência escrita" } },
    });
    expect(a.status, JSON.stringify(a.json)).toBe(201);

    // com a permissão, vê os dois
    const completo = await chamar("gerados", "GET", { id: "t1" });
    expect(completo.json).toHaveLength(2);

    // sem ela, a advertência não existe — nem na lista, nem no PDF
    comoGerador();
    const parcial = await chamar("gerados", "GET", { id: "t1" });
    expect(parcial.json).toHaveLength(1);
    expect(parcial.json[0].tipo).toBe("EPI");
    const pdf = await chamar("pdf", "GET", { id: a.json.id });
    expect(pdf.status).toBe(404);
    expect(pdf.bytes).toBeNull();
  });

  /* ───────────────────────── cancelar ───────────────────────── */

  it("cancelar guarda a razão e tira o anexo da ficha — com rastro, sem apagar", async () => {
    const modeloId = await criarModelo({ nome: "Termo", tipo: "TERMO", texto: "Recebi, {{nome}}, o notebook em {{entregaEm}}." });
    const g = await chamar("gerados", "POST", { id: "t1", corpo: { modeloId, valores: { entregaEm: "16/11/2026" } } });
    const a = await chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Marina Alves Pereira", selfie: FOTO } });

    expect(await erro(chamar("cancelar", "POST", { id: g.json.id, corpo: { motivo: " " } }))).toContain("por que");
    const c = await chamar("cancelar", "POST", { id: g.json.id, corpo: { motivo: "Equipamento trocado no mesmo dia" } });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    expect(c.json.canceladoEm).toBe(AGORA.toISOString());
    expect(c.json.cancelamentoMotivo).toBe("Equipamento trocado no mesmo dia");

    // o histórico fica; o anexo sai da ficha com rastro
    expect(await prisma.documentoEmitido.count()).toBe(1);
    const anexo = await prisma.colaboradorDocumento.findUnique({ where: { id: a.json.documentoId } });
    expect(anexo.excluidoEm).not.toBeNull();
    expect(anexo.excluidoPorId).toBe("uA");
    expect(await erro(chamar("cancelar", "POST", { id: g.json.id, corpo: { motivo: "de novo" } })))
      .toBe("409 Este documento foi cancelado.");
  });

  /* ───────────────────────── a corrida, a foto e o anexo ───────────────────────── */

  it("duas assinaturas ao mesmo tempo gravam UMA — e um anexo só", async () => {
    const modeloId = await criarModelo({ nome: "Termo", tipo: "TERMO", texto: "Recebi, {{nome}}, o notebook em {{entregaEm}}." });
    const g = await chamar("gerados", "POST", { id: "t1", corpo: { modeloId, valores: { entregaEm: "16/11/2026" } } });

    // A JANELA de verdade: as duas chamadas têm de LER antes de qualquer uma ESCREVER. Em condições
    // normais uma chega depois da outra e a leitura já barra; aqui o portão segura as duas leituras
    // até ambas terem acontecido, que é a corrida que o filtro do próprio UPDATE existe para perder.
    const leitura = prisma.documentoEmitido.findFirst.bind(prisma.documentoEmitido);
    let leram = 0;
    let abrir: () => void = () => {};
    const portao = new Promise<void>((r) => { abrir = r; });
    // atribuição direta (e não spyOn): o cliente do Prisma é um proxy, e o mockRestore apaga o método
    prisma.documentoEmitido.findFirst = async (args: any) => {
      const linha = await leitura(args);
      if (++leram <= 2) {
        if (leram === 2) abrir();
        await portao;
      }
      return linha;
    };

    const { assinarDocumento } = await import("@/lib/documentos/documentos-server");
    let dois: PromiseSettledResult<unknown>[] = [];
    try {
      dois = await Promise.allSettled([
        assinarDocumento(g.json.id, "e1", { nome: "Marina Alves Pereira", selfie: FOTO }, { ip: "200.1.2.3" }),
        assinarDocumento(g.json.id, "e1", { nome: "Outra Pessoa Qualquer", selfie: FOTO }, { ip: "200.1.2.9" }),
      ]);
    } finally {
      prisma.documentoEmitido.findFirst = leitura;
    }
    expect(leram, "as duas leram antes de qualquer uma escrever").toBeGreaterThanOrEqual(2);
    expect(dois.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    // qual das duas chega primeiro é do acaso; o que não pode é as DUAS gravarem
    const linha = await prisma.documentoEmitido.findUnique({ where: { id: g.json.id } });
    expect(["Marina Alves Pereira", "Outra Pessoa Qualquer"]).toContain(linha.assinaturaNome);
    expect(linha.assinaturaIp).toBe(linha.assinaturaNome === "Marina Alves Pereira" ? "200.1.2.3" : "200.1.2.9");
    expect(await prisma.colaboradorDocumento.count({ where: { excluidoEm: null } })).toBe(1);
  });

  it("o que não é imagem não vira foto de assinatura", async () => {
    const modeloId = await criarModelo({ nome: "Termo", tipo: "TERMO", texto: "Recebi, {{nome}}, o notebook em {{entregaEm}}." });
    const g = await chamar("gerados", "POST", { id: "t1", corpo: { modeloId, valores: { entregaEm: "16/11/2026" } } });
    const pdfComoFoto = dataUrl(new Uint8Array([...new TextEncoder().encode("%PDF-1.4\n"), ...new Uint8Array(200).fill(0x20)]), "image/png");
    const r = await chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Marina Alves Pereira", selfie: pdfComoFoto } });
    expect(r.status).toBe(400);
    const linha = await prisma.documentoEmitido.findUnique({ where: { id: g.json.id } });
    expect(linha.assinaturaEm).toBeNull();
    expect(await prisma.colaboradorDocumento.count()).toBe(0);
  });

  it("guardar o anexo não duplica, e regerar conta a validade da ASSINATURA", async () => {
    const modeloId = await criarModelo({ nome: "Ficha de EPI", tipo: "EPI", texto: TEXTO_EPI, temItens: true, validadeDias: 180 });
    const g = await chamar("gerados", "POST", {
      id: "t1", corpo: { modeloId, valores: { entregaEm: "16/11/2026" }, itens: [{ descricao: "Luva", ca: "12345", quantidade: 1 }] },
    });
    const a = await chamar("assinar", "POST", { id: g.json.id, corpo: { nome: "Marina Alves Pereira", selfie: FOTO } });

    const { guardarNosAnexos } = await import("@/lib/documentos/documentos-server");
    const carregar = () => prisma.documentoEmitido.findFirst({
      where: { id: g.json.id },
      include: { modelo: true, colaborador: { include: { empresa: true } } },
    });

    // de novo no mesmo papel: devolve o anexo que já existe, não cria um segundo
    const mesmo = await guardarNosAnexos((await carregar()) as any, AGORA);
    expect(mesmo.id).toBe(a.json.documentoId);
    expect(await prisma.colaboradorDocumento.count()).toBe(1);

    // o anexo é excluído (como no cancelamento) e o papel é refeito UM MÊS depois:
    // a validade continua contada da assinatura, não do dia em que o arquivo foi refeito
    await prisma.colaboradorDocumento.updateMany({ where: { id: a.json.documentoId }, data: { excluidoEm: AGORA } });
    const DEPOIS = new Date("2026-12-16T12:00:00.000Z");
    const refeito = await guardarNosAnexos((await carregar()) as any, DEPOIS);
    expect(refeito.id).not.toBe(a.json.documentoId);
    const novo = await prisma.colaboradorDocumento.findUnique({ where: { id: refeito.id } });
    expect(novo.dataVencimento.toISOString().slice(0, 10)).toBe("2027-05-15");
  });

  it("documento de OUTRA empresa é 404 em todas as rotas que recebem o id", async () => {
    const alheio = await prisma.documentoEmitido.create({
      data: {
        empresaId: "e2", colaboradorId: "t2", tipo: "TERMO", titulo: "Termo de fora",
        texto: "Papel da outra empresa.", criadoEm: AGORA,
      },
    });
    const pdf = await chamar("pdf", "GET", { id: alheio.id });
    expect(pdf.status).toBe(404);
    expect(pdf.bytes).toBeNull();
    expect(await erro(chamar("assinar", "POST", { id: alheio.id, corpo: { nome: "Marina Alves", selfie: FOTO } }))).toBe("404 Documento não encontrado");
    expect(await erro(chamar("cancelar", "POST", { id: alheio.id, corpo: { motivo: "qualquer coisa" } }))).toBe("404 Documento não encontrado");
    // e o papel de lá continua intacto
    const depois = await prisma.documentoEmitido.findUnique({ where: { id: alheio.id } });
    expect(depois.assinaturaEm).toBeNull();
    expect(depois.canceladoEm).toBeNull();
  });

  /* ───────────────────────── o CRUD dos modelos ───────────────────────── */

  it("mexer nos modelos exige \"› gerenciar\"; quem só gera, lista", async () => {
    const modeloId = await criarModelo({ nome: "Termo", tipo: "TERMO", texto: "Recebi, {{nome}}, o equipamento." });
    como(montarPermissoes({ documentos: ["criar"] }));
    const lista = await chamar("cadastros", "GET", { entidade: "modelos-documento" });
    expect(lista.status).toBe(200);
    const r = await chamar("cadastros", "POST", { entidade: "modelos-documento", corpo: { nome: "Outro", tipo: "TERMO", texto: "Texto do termo aqui." } });
    expect(r.status).toBe(403);
    expect(modeloId).toBeTruthy();
  });

  it("o cadastro recusa tipo inventado e campo que não existe", async () => {
    const r1 = await chamar("cadastros", "POST", { entidade: "modelos-documento", corpo: { nome: "X", tipo: "INVENTADO", texto: "Texto do documento." } });
    expect(r1.status).toBe(400);
    const r2 = await chamar("cadastros", "POST", { entidade: "modelos-documento", corpo: { nome: "Y", tipo: "TERMO", texto: "Texto do documento.", empresaId: "e2" } });
    expect(r2.status).toBe(400);
  });
});
