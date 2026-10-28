// @vitest-environment happy-dom
/**
 * NFS-e PR1 — tela "Dados fiscais" num DOM de verdade (API simulada):
 *  - situação: status, ambiente (homologação por padrão, com o aviso), emitente, certificado
 *    (validade / vencendo / vencido), último teste, pendências;
 *  - buscar o município pelo endereço preenche código/nome/UF; MEI esconde o regime especial;
 *  - produção desabilitada quando o servidor não liberou; senha só com o arquivo escolhido;
 *  - salvar manda multipart com os campos, o .pfx e a senha; a senha some da tela depois;
 *    erro e pendências aparecem; "Testar conexão" só com emitente, e mostra o resultado.
 *  - upload do certificado: `accept` filtra .pfx/.p12, ajuda visível, clique/teclado abrem o seletor,
 *    arrastar e soltar (destaque, só .pfx/.p12, trocar/tirar) e o arquivo solto é o que vai no envio.
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
/** Arrastar e soltar: o React lê `dataTransfer` do evento nativo */
async function arrastarSoltar(el: Element | null, arquivos: File[], tipo: "dragover" | "dragleave" | "drop" = "drop") {
  const ev = new Event(tipo, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { files: arquivos, types: ["Files"] } });
  await act(async () => { el!.dispatchEvent(ev); });
  return ev;
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

  it("upload do certificado: seletor filtra .pfx/.p12, ajuda visível, clique e teclado abrem o seletor", async () => {
    await montar(BASE);
    const input = $<HTMLInputElement>("[data-arquivo-certificado]")!;
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".pfx,.p12,application/x-pkcs12");
    expect(txt(caixa)).toContain("O certificado digital A1 é um arquivo que termina em .pfx ou .p12");
    const area = $("[data-area-certificado]")!;
    expect([area.getAttribute("role"), area.getAttribute("tabindex")]).toEqual(["button", "0"]);
    expect(txt(area)).toBe("Arraste o certificado aqui ou clique para escolher");
    let aberturas = 0;
    input.click = () => { aberturas++; };
    await clicar(area);
    await act(async () => { area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await act(async () => { area.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); });
    await act(async () => { area.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); });
    expect(aberturas).toBe(3);
  });

  it("arrastar e soltar: destaca a área, aceita .pfx/.p12 (libera a senha), recusa outro arquivo; trocar e tirar", async () => {
    respostas["POST /api/fiscal/emitente"] = { status: 200, corpo: { sincronizado: true, mensagem: "ok", emitente: ATIVO } };
    await montar(BASE);
    const area = $("[data-area-certificado]")!;
    const senha = () => $<HTMLInputElement>('[name="senhaCertificado"]')!;
    const p12 = new File([new Uint8Array([1])], "Empresa.P12", { type: "application/x-pkcs12" });
    // o navegador não pode abrir o arquivo na aba: dragover e drop são "consumidos" pela área
    const erros: unknown[] = [];
    const pegaErro = (ev: ErrorEvent) => { erros.push(ev.error ?? ev.message); ev.preventDefault(); };
    window.addEventListener("error", pegaErro);
    expect((await arrastarSoltar(area, [p12], "dragover")).defaultPrevented).toBe(true);
    expect(area.getAttribute("data-arrastando")).toBe("true");
    expect(txt(area)).toBe("Solte o certificado aqui");
    await arrastarSoltar(area, [], "dragleave");
    expect(area.hasAttribute("data-arrastando")).toBe(false);
    // arquivo errado solto: erro claro, nada escolhido, senha continua travada
    await arrastarSoltar(area, [p12], "dragover");
    await arrastarSoltar(area, [new File(["x"], "certificado.cer")]);
    expect(area.hasAttribute("data-arrastando")).toBe(false);
    expect(txt($('[data-mensagem="erro"]'))).toBe("Envie o certificado A1 no formato .pfx ou .p12.");
    expect($("[data-arquivo-escolhido]")).toBeNull();
    expect(senha().disabled).toBe(true);
    // o certificado certo: nome na área, erro some, senha liberada
    expect((await arrastarSoltar(area, [p12, new File(["y"], "outro.pfx")])).defaultPrevented).toBe(true);
    expect(txt($("[data-arquivo-escolhido]"))).toBe("Empresa.P12");
    expect($("[data-mensagem]")).toBeNull();
    expect(senha().disabled).toBe(false);
    // o seletor com "todos os arquivos" também passa pela conferência, sem perder o que já estava escolhido
    await anexar($("[data-arquivo-certificado]"), new File(["z"], "foto.png"));
    expect(txt($('[data-mensagem="erro"]'))).toBe("Envie o certificado A1 no formato .pfx ou .p12.");
    expect(txt($("[data-arquivo-escolhido]"))).toBe("Empresa.P12");
    // soltar sem arquivo (ex.: texto arrastado) não muda nada nem quebra a tela
    await arrastarSoltar(area, []);
    expect(txt($("[data-arquivo-escolhido]"))).toBe("Empresa.P12");
    window.removeEventListener("error", pegaErro);
    expect(erros).toEqual([]);
    // tirar: volta ao vazio e apaga a senha digitada; não abre o seletor
    await digitar(senha(), "s3nh@");
    let aberturas = 0;
    $<HTMLInputElement>("[data-arquivo-certificado]")!.click = () => { aberturas++; };
    await clicar($("[data-tirar-certificado]"));
    expect(aberturas).toBe(0);
    expect($("[data-arquivo-escolhido]")).toBeNull();
    expect([senha().value, senha().disabled]).toEqual(["", true]);
    // solto de novo e salvo: o arquivo solto é o que vai no envio
    const pfx = new File([new Uint8Array([9, 9])], "clima.pfx");
    await arrastarSoltar(area, [pfx]);
    await digitar(senha(), "s3nh@");
    await clicar($("[data-salvar-fiscal]"));
    const corpo = chamadas.find((c) => c.metodo === "POST")!.corpo!;
    expect([(corpo.get("certificado") as File).name, corpo.get("senha")]).toEqual(["clima.pfx", "s3nh@"]);
    expect($("[data-arquivo-escolhido]")).toBeNull();
  });

  it("senha some da tela depois de qualquer envio: recusado no servidor (arquivo fica para tentar de novo) e sem conexão", async () => {
    respostas["POST /api/fiscal/emitente"] = { status: 400, corpo: { erro: "Senha do certificado incorreta." } };
    await montar(BASE);
    const senha = () => $<HTMLInputElement>('[name="senhaCertificado"]')!;
    await anexar($("[data-arquivo-certificado]"), new File([new Uint8Array([1])], "clima.pfx"));
    await digitar(senha(), "errada");
    await clicar($("[data-salvar-fiscal]"));
    expect(txt($('[data-mensagem="erro"]'))).toBe("Senha do certificado incorreta.");
    expect([senha().value, senha().disabled, txt($("[data-arquivo-escolhido]"))]).toEqual(["", false, "clima.pfx"]);
    // sem conexão: a senha também não fica
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await digitar(senha(), "outra");
    await clicar($("[data-salvar-fiscal]"));
    expect(txt($('[data-mensagem="erro"]'))).toBe("Sem conexão. Tente de novo.");
    expect(senha().value).toBe("");
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
