/**
 * NFS-e PR3 — cliente do PlugNotas na EMISSÃO (fetch falso): POST /nfse (uma nota num array),
 * consulta pelo id (com a rota alternativa) ou pelo nosso idIntegracao, PDF/XML em bytes, e o que é
 * "incerto" (pode ter chegado: rede, tempo, 5xx, aceito sem id) × recusa certa (4xx com os campos).
 * O token nunca sai na mensagem; toda chamada vai com x-api-key, https e sem seguir redirecionamento.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baixarNfse, consultarNfse, emitirNfse, ErroPlugNotas, MAX_ARQUIVO_NFSE, mensagemLimpa } from "@/lib/nfse/plugnotas";

const SANDBOX = "https://api.sandbox.plugnotas.com.br";
type Resp = { status: number; corpo?: unknown; tipo?: string; bruto?: BodyInit; headers?: Record<string, string> } | "rede" | "tempo";
let rotas: Record<string, Resp>;
let chamadas: { url: string; init: RequestInit }[];

beforeEach(() => {
  rotas = {}; chamadas = [];
  vi.stubEnv("PLUGNOTAS_API_TOKEN", "tok-SANDBOX-0001");
  vi.stubEnv("PLUGNOTAS_API_TOKEN_PRODUCAO", "tok-PROD-0002");
  vi.stubEnv("PLUGNOTAS_API_URL", "");
  vi.stubGlobal("fetch", vi.fn(async (u: string, init: RequestInit) => {
    chamadas.push({ url: String(u), init });
    const r = rotas[`${init.method} ${String(u).replace(SANDBOX, "")}`] ?? { status: 404, corpo: { error: { message: "Não encontrado" } } };
    if (r === "rede") throw new TypeError("fetch failed");
    if (r === "tempo") throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    return new Response(r.bruto ?? JSON.stringify(r.corpo ?? null), { status: r.status, headers: { "Content-Type": r.tipo ?? "application/json", ...r.headers } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const erroDe = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as ErroPlugNotas; } };
const nota = { idIntegracao: "n1", prestador: { cpfCnpj: "12345678000190" } };

describe("emitirNfse", () => {
  it("POST /nfse com UMA nota num array, x-api-key, JSON e sem seguir redirecionamento → id e protocolo", async () => {
    rotas["POST /nfse"] = { status: 200, corpo: { documents: [{ idIntegracao: "n1", prestador: "12345678000190", id: "pn1" }], message: "Nota(as) em processamento", protocol: "p-1" } };
    expect(await emitirNfse("HOMOLOGACAO", nota)).toEqual({ id: "pn1", protocolo: "p-1" });
    const [{ url, init }] = chamadas;
    expect(url).toBe(`${SANDBOX}/nfse`);
    expect(JSON.parse(String(init.body))).toEqual([nota]);
    expect(new Headers(init.headers).get("x-api-key")).toBe("tok-SANDBOX-0001");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.redirect).toBe("error");
  });

  it("recusa de validação (4xx): erro CERTO (não incerto), com os campos, sem o token", async () => {
    rotas["POST /nfse"] = { status: 400, corpo: { error: { message: "Falha na validação do JSON de NFSe (tok-SANDBOX-0001)", data: { fields: { "servico.0.codigo": "Obrigatório" } } } } };
    const e = await erroDe(emitirNfse("HOMOLOGACAO", nota));
    expect(e).toBeInstanceOf(ErroPlugNotas);
    expect([e!.status, e!.incerto, e!.message]).toEqual([422, false, "Falha na validação do JSON de NFSe (•••). Campos: servico.0.codigo (Obrigatório)."]);
  });

  it("incerto (pode ter chegado): 5xx, rede, tempo esgotado, aceito sem o id", async () => {
    rotas["POST /nfse"] = { status: 503, corpo: {} };
    expect((await erroDe(emitirNfse("HOMOLOGACAO", nota)))!.incerto).toBe(true);
    rotas["POST /nfse"] = "rede";
    expect(await erroDe(emitirNfse("HOMOLOGACAO", nota))).toMatchObject({ status: 504, incerto: true });
    rotas["POST /nfse"] = "tempo";
    expect(await erroDe(emitirNfse("HOMOLOGACAO", nota))).toMatchObject({ status: 504, message: "O PlugNotas não respondeu a tempo. Tente de novo." });
    rotas["POST /nfse"] = { status: 200, corpo: { message: "ok" } };
    expect(await erroDe(emitirNfse("HOMOLOGACAO", nota))).toMatchObject({ status: 502, incerto: true, message: "O PlugNotas recebeu o envio mas não devolveu o identificador da nota. Consulte o status antes de reenviar." });
  });

  it("produção sem o token próprio: não envia nada", async () => {
    vi.stubEnv("PLUGNOTAS_API_TOKEN_PRODUCAO", "");
    expect((await erroDe(emitirNfse("PRODUCAO", nota)))!.status).toBe(503);
    expect(chamadas).toEqual([]);
  });
});

describe("consultarNfse", () => {
  it("pelo id: /nfse/consultar/{id}; sem essa rota (404), tenta /nfse/{id}; nenhuma = null", async () => {
    rotas["GET /nfse/consultar/pn%2F1"] = { status: 200, corpo: [{ id: "pn/1", situacao: "PROCESSANDO" }] };
    expect(await consultarNfse("HOMOLOGACAO", { id: "pn/1", idIntegracao: "n1", cnpj: "1" })).toEqual([{ id: "pn/1", situacao: "PROCESSANDO" }]);
    rotas["GET /nfse/pn2"] = { status: 200, corpo: { situacao: "CONCLUIDO" } };
    expect(await consultarNfse("HOMOLOGACAO", { id: "pn2", idIntegracao: "n1", cnpj: "1" })).toEqual({ situacao: "CONCLUIDO" });
    expect(chamadas.slice(-2).map((c) => c.url.replace(SANDBOX, ""))).toEqual(["/nfse/consultar/pn2", "/nfse/pn2"]);
    expect(await consultarNfse("HOMOLOGACAO", { id: "pn3", idIntegracao: "n1", cnpj: "1" })).toBeNull();
  });

  it("sem o id: pelo nosso idIntegracao + CNPJ do prestador", async () => {
    rotas["GET /nfse/consultar/n1/12345678000190"] = { status: 200, corpo: [{ id: "pnX", idIntegracao: "n1" }] };
    expect(await consultarNfse("HOMOLOGACAO", { id: null, idIntegracao: "n1", cnpj: "12345678000190" })).toEqual([{ id: "pnX", idIntegracao: "n1" }]);
    expect(chamadas.map((c) => [c.init.method, new Headers(c.init.headers).get("x-api-key"), c.init.redirect])).toEqual([["GET", "tok-SANDBOX-0001", "error"]]);
    expect(await consultarNfse("HOMOLOGACAO", { idIntegracao: "n2", cnpj: "1" })).toBeNull();
  });

  it("erro que não é 404: lança (sem o token)", async () => {
    rotas["GET /nfse/consultar/pn1"] = { status: 401, corpo: { error: { message: "Unauthorized" } } };
    expect((await erroDe(consultarNfse("HOMOLOGACAO", { id: "pn1", idIntegracao: "n1", cnpj: "1" })))!.message).toMatch(/^O PlugNotas recusou o acesso/);
    rotas["GET /nfse/consultar/pn1"] = { status: 500, corpo: {} };
    expect((await erroDe(consultarNfse("HOMOLOGACAO", { id: "pn1", idIntegracao: "n1", cnpj: "1" })))!.incerto).toBe(true);
  });
});

describe("baixarNfse", () => {
  it("PDF e XML em bytes (GET /nfse/pdf|xml/{id}, Accept do tipo)", async () => {
    rotas["GET /nfse/pdf/pn1"] = { status: 200, bruto: "%PDF-1.4 x", tipo: "application/pdf" };
    rotas["GET /nfse/xml/pn1"] = { status: 200, bruto: "<x/>", tipo: "text/xml; charset=utf-8" };
    const pdf = await baixarNfse("HOMOLOGACAO", "pdf", "pn1");
    expect([Buffer.from(pdf.bytes).toString(), pdf.contentType]).toEqual(["%PDF-1.4 x", "application/pdf"]);
    const xml = await baixarNfse("HOMOLOGACAO", "xml", "pn1");
    expect([Buffer.from(xml.bytes).toString(), xml.contentType]).toEqual(["<x/>", "application/xml"]);
    expect(chamadas.map((c) => new Headers(c.init.headers).get("accept"))).toEqual(["application/pdf", "application/xml"]);
    rotas["GET /nfse/xml/pn2"] = { status: 200, bruto: "<x/>", tipo: "application/nfse+xml" };
    expect((await baixarNfse("HOMOLOGACAO", "xml", "pn2")).contentType).toBe("application/xml");
  });

  it("tipo errado (ex.: JSON com erro em vez do PDF) ou erro HTTP: recusa com a mensagem deles", async () => {
    rotas["GET /nfse/pdf/pn1"] = { status: 200, corpo: { error: { message: "Nota ainda em processamento" } } };
    expect(await erroDe(baixarNfse("HOMOLOGACAO", "pdf", "pn1"))).toMatchObject({ status: 502, message: "O PlugNotas está fora do ar ou com erro (502). Tente de novo mais tarde." });
    rotas["GET /nfse/pdf/pn1"] = { status: 400, corpo: { error: { message: "Nota rejeitada não tem PDF" } } };
    expect(await erroDe(baixarNfse("HOMOLOGACAO", "pdf", "pn1"))).toMatchObject({ status: 422, message: "Nota rejeitada não tem PDF" });
    rotas["GET /nfse/xml/pn1"] = { status: 200, bruto: "%PDF", tipo: "application/pdf" };
    expect(await erroDe(baixarNfse("HOMOLOGACAO", "xml", "pn1"))).toBeInstanceOf(ErroPlugNotas);
  });

  it("arquivo grande demais (pelo cabeçalho ou pelo conteúdo): recusa", async () => {
    expect(MAX_ARQUIVO_NFSE).toBe(10 * 1024 * 1024);
    rotas["GET /nfse/pdf/pn1"] = { status: 200, bruto: "%PDF", tipo: "application/pdf", headers: { "Content-Length": String(MAX_ARQUIVO_NFSE + 1) } };
    expect((await erroDe(baixarNfse("HOMOLOGACAO", "pdf", "pn1")))!.message).toBe("O arquivo da nota veio grande demais.");
    rotas["GET /nfse/pdf/pn2"] = { status: 200, bruto: new Uint8Array(MAX_ARQUIVO_NFSE + 1), tipo: "application/pdf" };
    expect((await erroDe(baixarNfse("HOMOLOGACAO", "pdf", "pn2")))!.message).toBe("O arquivo da nota veio grande demais.");
    rotas["GET /nfse/pdf/pn3"] = { status: 200, bruto: new Uint8Array(MAX_ARQUIVO_NFSE), tipo: "application/pdf" };
    expect((await baixarNfse("HOMOLOGACAO", "pdf", "pn3")).bytes.byteLength).toBe(MAX_ARQUIVO_NFSE);
  });
});

describe("mensagemLimpa", () => {
  it("tira os tokens dos dois ambientes do texto que veio do PlugNotas", () => {
    expect(mensagemLimpa("x tok-SANDBOX-0001 y tok-PROD-0002 z")).toBe("x ••• y ••• z");
    vi.stubEnv("PLUGNOTAS_API_TOKEN_PRODUCAO", "");
    expect(mensagemLimpa("tok-SANDBOX-0001")).toBe("•••");
  });
});
