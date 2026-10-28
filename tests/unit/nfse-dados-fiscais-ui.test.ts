// @vitest-environment happy-dom
/**
 * NFS-e PR1 — tela "Dados fiscais" num DOM de verdade (API simulada):
 *  - situação: status, ambiente (homologação por padrão, com o aviso), emitente, certificado
 *    (validade / vencendo / vencido), último teste, pendências;
 *  - buscar o município pelo endereço preenche código/nome/UF; MEI esconde o regime especial;
 *  - produção desabilitada quando o servidor não liberou; senha só com o arquivo escolhido;
 *  - salvar manda multipart com os campos, o .pfx e a senha; a senha some da tela depois;
 *    erro e pendências aparecem; "Testar conexão" só com emitente, e mostra o resultado.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EmitenteTela } from "@/lib/nfse/emitente-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/financeiro/fiscal" }));
const avisos = vi.hoisted(() => ({ toasts: [] as string[] }));
vi.mock("@/components/ui/avisos", () => ({ toast: (m: string) => { avisos.toasts.push(m); }, confirmar: async () => true }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: FormData | null }[] = [];

beforeAll(async () => { await import("@/components/fiscal/dados-fiscais-client"); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; avisos.toasts = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body instanceof FormData ? init.body : null });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function escolher(el: Element | null, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function anexar(el: Element | null, arquivo: File) {
  await act(async () => {
    Object.defineProperty(el, "files", { value: [arquivo], configurable: true });
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const BASE: EmitenteTela = {
  dados: { regimeTributario: null, regimeEspecial: null, incentivoFiscal: false, incentivadorCultural: false, ambiente: "HOMOLOGACAO", codigoMunicipio: null, municipioNome: null, municipioUf: null, inscricaoMunicipal: "" },
  empresa: { cnpj: "12345678000190", nome: "Clima Total", endereco: "Rua das Flores, 100, Centro", cidade: "São Paulo", estado: "SP", cep: "01001-000" },
  status: "NAO_CONFIGURADO", statusLabel: "Não configurado", emitente: null, certificado: null, ultimoErro: null, ultimoTeste: null,
  pendencias: ["Inscrição municipal", "Certificado digital A1 (.pfx) e a senha"],
  ambientesDisponiveis: { HOMOLOGACAO: true, PRODUCAO: false },
};
const ATIVO: EmitenteTela = {
  ...BASE,
  dados: { ...BASE.dados, regimeTributario: "SIMPLES_NACIONAL", codigoMunicipio: "3550308", municipioNome: "São Paulo", municipioUf: "SP", inscricaoMunicipal: "12345678" },
  status: "ATIVO", statusLabel: "Emitente ativo no PlugNotas",
  emitente: { cnpj: "12345678000190", ambiente: "HOMOLOGACAO", sincronizadoEm: "2026-10-28T13:00:00.000Z" },
  certificado: { titular: "CLIMA TOTAL LTDA", cnpj: "12345678000190", validoAte: "2027-05-10T12:00:00.000Z", enviadoEm: "2026-10-28T13:00:00.000Z", dias: 194, vencido: false, vencendo: false },
  pendencias: [],
};

async function montar(inicial: EmitenteTela) {
  const { DadosFiscaisClient } = await import("@/components/fiscal/dados-fiscais-client");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(DadosFiscaisClient, { inicial })); });
  await esperar();
}

describe("situação do emitente", () => {
  it("não configurado: status, homologação com o aviso, pendências, Testar desabilitado, certificado não enviado", async () => {
    await montar(BASE);
    expect(txt($("[data-status-emitente]"))).toBe("Não configurado");
    expect($("[data-status-emitente]")!.getAttribute("data-tom")).toBe("previsto");
    expect(txt($("[data-ambiente]"))).toBe("Homologação (testes)");
    expect($("[data-aviso-homologacao]")).toBeTruthy();
    expect([...caixa.querySelectorAll("[data-pendencias] li")].map(txt)).toEqual(["Inscrição municipal", "Certificado digital A1 (.pfx) e a senha"]);
    expect($<HTMLButtonElement>("[data-testar-conexao]")!.disabled).toBe(true);
    expect(txt($("[data-certificado]"))).toBe("Não enviado");
    expect(txt($("[data-emitente]"))).toBe("Ainda não cadastrado");
    expect(txt($("[data-endereco-empresa]"))).toContain("Rua das Flores, 100, Centro · São Paulo/SP · 01001-000");
  });

  it("ativo: emitente, certificado válido; vencendo e vencido mudam o texto; último teste e erro", async () => {
    await montar({ ...ATIVO, ultimoTeste: { em: "2026-10-28T14:00:00.000Z", ok: true, mensagem: "Conexão OK" } });
    expect($("[data-status-emitente]")!.getAttribute("data-tom")).toBe("ok");
    expect(txt($("[data-emitente]"))).toBe("12.345.678/0001-90 · Homologação (testes)");
    expect(txt($("[data-certificado]"))).toBe("CLIMA TOTAL LTDA · 12.345.678/0001-90Válido até 10/05/2027"); // validade numa linha própria (block)
    expect(txt($("[data-ultimo-teste]"))).toContain("Conexão OK");
    expect($("[data-ultimo-teste]")!.getAttribute("data-ultimo-teste")).toBe("ok");
    expect($("[data-pendencias]")).toBeNull();
    expect($<HTMLButtonElement>("[data-testar-conexao]")!.disabled).toBe(false);
    act(() => root.unmount()); caixa.remove();
    await montar({ ...ATIVO, certificado: { ...ATIVO.certificado!, dias: 12, vencendo: true } });
    expect(txt($("[data-certificado]"))).toContain("Válido até 10/05/2027 — faltam 12 dias");
    act(() => root.unmount()); caixa.remove();
    await montar({ ...ATIVO, status: "ERRO", statusLabel: "Erro no PlugNotas", ultimoErro: "Senha não confere", certificado: { ...ATIVO.certificado!, dias: -3, vencido: true } });
    expect(txt($("[data-certificado]"))).toContain("Vencido em 10/05/2027");
    expect(txt($("[data-ultimo-erro]"))).toBe("Senha não confere");
    expect($("[data-status-emitente]")!.getAttribute("data-tom")).toBe("atrasado");
  });

  it("produção: aviso de homologação some e o tom muda", async () => {
    await montar({ ...ATIVO, dados: { ...ATIVO.dados, ambiente: "PRODUCAO" }, ambientesDisponiveis: { HOMOLOGACAO: true, PRODUCAO: true } });
    expect($("[data-aviso-homologacao]")).toBeNull();
    expect(txt($("[data-ambiente]"))).toBe("Produção");
    expect($<HTMLInputElement>('[data-ambiente-opcao="PRODUCAO"]')!.disabled).toBe(false);
  });
});

describe("formulário", () => {
  it("buscar o município preenche código, nome e UF; erro aparece", async () => {
    respostas["GET /api/fiscal/municipio"] = { status: 200, corpo: { codigo: "3550308", nome: "São Paulo", uf: "SP", fonte: "cep" } };
    await montar(BASE);
    await clicar($("[data-buscar-municipio]"));
    expect([$<HTMLInputElement>('[name="codigoMunicipio"]')!.value, $<HTMLInputElement>('[name="municipioNome"]')!.value, $<HTMLInputElement>('[name="municipioUf"]')!.value])
      .toEqual(["3550308", "São Paulo", "SP"]);
    respostas["GET /api/fiscal/municipio"] = { status: 404, corpo: { erro: "Não achei o código IBGE" } };
    await clicar($("[data-buscar-municipio]"));
    expect(txt($('[data-mensagem="erro"]'))).toBe("Não achei o código IBGE");
  });

  it("MEI esconde o regime especial; produção bloqueada quando o servidor não liberou; IBGE e UF só aceitam o formato", async () => {
    await montar(BASE);
    expect($('[name="regimeEspecial"]')).toBeTruthy();
    expect([...caixa.querySelectorAll('[name="regimeEspecial"] option')].map((o) => (o as HTMLOptionElement).value)).not.toContain("MEI");
    await escolher($('[name="regimeTributario"]'), "MEI");
    expect($('[name="regimeEspecial"]')).toBeNull();
    expect($<HTMLInputElement>('[data-ambiente-opcao="PRODUCAO"]')!.disabled).toBe(true);
    await digitar($('[name="codigoMunicipio"]'), "35a50-30899");
    expect($<HTMLInputElement>('[name="codigoMunicipio"]')!.value).toBe("3550308");
    await digitar($('[name="municipioUf"]'), "s1pz");
    expect($<HTMLInputElement>('[name="municipioUf"]')!.value).toBe("SP");
  });

  it("senha só com arquivo; sem senha não envia; salvar manda multipart com tudo e limpa a senha", async () => {
    respostas["POST /api/fiscal/emitente"] = { status: 200, corpo: { sincronizado: true, mensagem: "Emitente cadastrado no PlugNotas (homologação (testes)).", emitente: ATIVO } };
    await montar(BASE);
    expect($<HTMLInputElement>('[name="senhaCertificado"]')!.disabled).toBe(true);
    await digitar($('[name="inscricaoMunicipal"]'), "12345678");
    await escolher($('[name="regimeTributario"]'), "LUCRO_PRESUMIDO");
    await escolher($('[name="regimeEspecial"]'), "SOCIEDADE_PROFISSIONAIS");
    await clicar(caixa.querySelectorAll('button[role="switch"]')[0]);
    await digitar($('[name="codigoMunicipio"]'), "3550308");
    await digitar($('[name="municipioUf"]'), "SP");
    const pfx = new File([new Uint8Array([1, 2, 3])], "clima.pfx", { type: "application/x-pkcs12" });
    await anexar($("[data-arquivo-certificado]"), pfx);
    expect($<HTMLInputElement>('[name="senhaCertificado"]')!.disabled).toBe(false);
    await clicar($("[data-salvar-fiscal]"));
    expect(txt($('[data-mensagem="erro"]'))).toBe("Informe a senha do certificado.");
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(0);
    await digitar($('[name="senhaCertificado"]'), "s3nh@");
    await clicar($("[data-salvar-fiscal]"));
    const corpo = chamadas.find((c) => c.metodo === "POST")!.corpo!;
    expect(Object.fromEntries([...corpo.entries()].filter(([, v]) => typeof v === "string"))).toEqual({
      inscricaoMunicipal: "12345678", regimeTributario: "LUCRO_PRESUMIDO", regimeEspecial: "SOCIEDADE_PROFISSIONAIS", incentivoFiscal: "true", incentivadorCultural: "false",
      ambiente: "HOMOLOGACAO", codigoMunicipio: "3550308", municipioNome: "", municipioUf: "SP", senha: "s3nh@",
    });
    expect((corpo.get("certificado") as File).name).toBe("clima.pfx");
    expect($<HTMLInputElement>('[name="senhaCertificado"]')!.value).toBe("");
    expect($<HTMLInputElement>('[name="senhaCertificado"]')!.disabled).toBe(true);
    expect(avisos.toasts).toEqual(["Emitente cadastrado no PlugNotas (homologação (testes))."]);
    expect(txt($('[data-mensagem="ok"]'))).toBe("Emitente cadastrado no PlugNotas (homologação (testes)).");
    expect(txt($("[data-status-emitente]"))).toBe("Emitente ativo no PlugNotas");
  });

  it("MEI não manda regime especial; sem arquivo não manda certificado nem senha; pendências e erro do PlugNotas aparecem", async () => {
    respostas["POST /api/fiscal/emitente"] = { status: 200, corpo: { sincronizado: false, pendencias: ["Inscrição municipal"], mensagem: "Dados salvos. Ainda falta preencher o que está na lista para cadastrar no PlugNotas.", emitente: { ...BASE, pendencias: ["Inscrição municipal"] } } };
    await montar({ ...BASE, dados: { ...BASE.dados, regimeEspecial: "COOPERATIVA" } });
    await escolher($('[name="regimeTributario"]'), "MEI");
    await clicar($("[data-salvar-fiscal]"));
    const corpo = chamadas.find((c) => c.metodo === "POST")!.corpo!;
    expect([corpo.get("regimeEspecial"), corpo.has("certificado"), corpo.has("senha")]).toEqual(["", false, false]);
    expect(txt($('[data-mensagem="aviso"]'))).toBe("Dados salvos. Ainda falta preencher o que está na lista para cadastrar no PlugNotas.");
    expect([...caixa.querySelectorAll("[data-pendencias] li")].map(txt)).toEqual(["Inscrição municipal"]);
    respostas["POST /api/fiscal/emitente"] = { status: 502, corpo: { sincronizado: false, erro: "O PlugNotas recusou o certificado: a senha não confere.", mensagem: "O PlugNotas recusou o certificado: a senha não confere.", emitente: { ...BASE, status: "ERRO", statusLabel: "Erro no PlugNotas" } } };
    await clicar($("[data-salvar-fiscal]"));
    expect(txt($('[data-mensagem="erro"]'))).toBe("O PlugNotas recusou o certificado: a senha não confere.");
    expect(txt($("[data-status-emitente]"))).toBe("Erro no PlugNotas");
    respostas["POST /api/fiscal/emitente"] = { status: 400, corpo: { erro: "Senha do certificado incorreta." } };
    await clicar($("[data-salvar-fiscal]"));
    expect(txt($('[data-mensagem="erro"]'))).toBe("Senha do certificado incorreta.");
  });

  it("Testar conexão: mostra o resultado (ok e erro) e atualiza a situação", async () => {
    respostas["POST /api/fiscal/emitente/testar"] = { status: 200, corpo: { ok: true, mensagem: "Conexão OK: emitente ativo", emitente: { ...ATIVO, ultimoTeste: { em: "2026-10-28T15:00:00.000Z", ok: true, mensagem: "Conexão OK: emitente ativo" } } } };
    await montar(ATIVO);
    await clicar($("[data-testar-conexao]"));
    expect(chamadas.map((c) => `${c.metodo} ${c.url}`)).toEqual(["POST /api/fiscal/emitente/testar"]);
    expect(txt($('[data-mensagem="ok"]'))).toBe("Conexão OK: emitente ativo");
    expect(txt($("[data-ultimo-teste]"))).toContain("Conexão OK: emitente ativo");
    respostas["POST /api/fiscal/emitente/testar"] = { status: 502, corpo: { ok: false, mensagem: "O certificado venceu", emitente: { ...ATIVO, status: "ERRO", statusLabel: "Erro no PlugNotas" } } };
    await clicar($("[data-testar-conexao]"));
    expect(txt($('[data-mensagem="erro"]'))).toBe("O certificado venceu");
    expect(txt($("[data-status-emitente]"))).toBe("Erro no PlugNotas");
  });
});
