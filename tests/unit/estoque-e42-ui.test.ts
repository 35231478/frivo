// @vitest-environment happy-dom
/**
 * Estoque E4.2 — as telas num DOM de verdade, API simulada:
 *  - "Material da OS" (aba Materiais & Compras): "Informar consumo" abre os campos com o separado como padrão; menos vira
 *    sobra pendente de devolução, mais avisa e pede confirmação; o POST leva a quantidade consumida; a lista acompanha
 *    (consumido X, pend. devolução, por quem · quando); "Desfazer" manda o DELETE; OS finalizada não desfaz; sem a
 *    permissão não informa; a pílula "trava a conclusão" só com a amarra ligada;
 *  - Configurações: a opção "Exigir prestação de contas de material…" com a ⓘ (texto curto, sem parágrafo solto).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";
import { resumoSeparacao } from "@/lib/estoque/separacao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-auto-geocode", () => ({ useAutoGeocode: () => {} }));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o?: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const M = (id: string, produtoId: string, descricao: string, unidade: string, quantidade: number, quantidadeSeparada: number, extra: Record<string, unknown> = {}): any => ({
  id, produtoId, descricao, unidade, quantidade, quantidadeSeparada, quantidadeConsumida: 0, estadoSeparacao: quantidadeSeparada > 0 ? "SEPARADO" : null,
  item: "Instalação split", kitNome: null, separadoEm: quantidadeSeparada > 0 ? "2026-11-07T12:00:00.000Z" : null, separadoPor: quantidadeSeparada > 0 ? "Zé do Almoxarifado" : null, consumidoEm: null, consumidoPor: null, ...extra,
});
const INICIAIS = [M("mTubo", "tubo", "Tubo de cobre 1/4", "m", 5, 5), M("mCap", "cap", "Capacitor 35uF", "un", 1, 1), M("mFiltro", "filtro", "Filtro secador", "un", 2, 0)];
let atuais: any[] = INICIAIS;

beforeEach(() => {
  chamadas.length = 0; atuais = INICIAIS; avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/api/ordens/os1/consumo" && metodo === "POST") {
      const alvo = new Map<string, number>(corpo.materiais.map((m: any) => [m.id, m.quantidade]));
      const materiais = atuais.map((m) => alvo.has(m.id) ? { ...m, quantidadeConsumida: alvo.get(m.id), estadoSeparacao: "CONSUMIDO", consumidoEm: "2026-11-07T15:00:00.000Z", consumidoPor: "Carlos Técnico" } : m);
      atuais = materiais;
      const avisosServidor = materiais.filter((m) => alvo.has(m.id) && alvo.get(m.id)! > m.quantidadeSeparada).map((m) => `${m.descricao}: Atenção: o saldo ficou negativo.`);
      return json({ separacao: { materiais, resumo: resumoSeparacao(materiais) }, avisos: avisosServidor, movimentos: alvo.size, status: "CONCLUIDA" });
    }
    if (url === "/api/ordens/os1/consumo" && metodo === "DELETE") {
      const materiais = atuais.map((m) => m.id === corpo.id ? { ...m, quantidadeConsumida: 0, estadoSeparacao: m.quantidadeSeparada > 0 ? "SEPARADO" : null, consumidoPor: null, consumidoEm: null } : m);
      atuais = materiais;
      return json({ separacao: { materiais, resumo: resumoSeparacao(materiais) }, avisos: [], movimentos: 2, status: "EM_ANDAMENTO" });
    }
    if (url === "/api/configuracoes" && metodo === "PUT") return json(corpo);
    return json({ erro: `não mapeado: ${url}` }, 404);
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(el: ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
const linha = (id: string) => $(`[data-material-estado="${id}"]`)!;
const campo = (id: string) => linha(id).querySelector<HTMLInputElement>("[data-consumir]");
const posts = () => chamadas.filter((c) => c.metodo === "POST").map((c) => c.corpo);
const remontar = async (el: ReactElement) => { await act(async () => { root.unmount(); }); caixa.remove(); await montar(el); };

describe("E4.2 — consumo na OS (aba Materiais & Compras)", () => {
  it("'Informar consumo': padrão = o separado; menos vira sobra, mais pede confirmação; POST com o consumido; a lista acompanha (consumido, pend. devolução, por quem); 'Desfazer' manda o DELETE", async () => {
    const { OsSeparacao } = await import("@/components/os/os-separacao");
    const onMudou = vi.fn();
    await montar(createElement(OsSeparacao, { osId: "os1", materiais: INICIAIS, resumo: resumoSeparacao(INICIAIS), podeSeparar: true, podeConsumir: true, exigirPrestacao: false, onMudou }));
    expect(txt($("[data-consumo-pendente-pill]"))).toBe("2 consumos a informar");
    expect($("[data-os-separacao]")!.getAttribute("data-consumo-pendente")).toBe("2");
    await clicar($('[data-acao="informar-consumo"]'));
    expect(campo("mTubo")!.value).toBe("5");
    expect(campo("mCap")!.value).toBe("1");
    expect(campo("mFiltro")!.value).toBe("0"); // não separado: só entra se alguém digitar
    expect($('[data-acao="ir-separar"]')).toBeNull(); // enquanto informa, só os botões do consumo
    await digitar(campo("mTubo"), "3");
    await digitar(campo("mCap"), "2");
    expect(txt(linha("mCap").querySelector("[data-baixa-a-mais]"))).toBe("+1 a mais");
    expect(linha("mTubo").querySelector("[data-baixa-a-mais]")).toBeNull();
    await clicar($('[data-acao="confirmar-consumo"]'));
    expect(avisos.confirmar).toHaveBeenCalledTimes(1);
    expect(avisos.confirmar.mock.calls[0][0]).toMatchObject({ titulo: "Consumo acima do separado", confirmarTexto: "Baixar mesmo assim" });
    // O filtro (0 e não separado) fica de fora
    expect(posts()).toEqual([{ materiais: [{ id: "mTubo", quantidade: 3 }, { id: "mCap", quantidade: 2 }] }]);
    expect(onMudou).toHaveBeenCalled();
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/Consumo de 2 materiais informado\. Capacitor 35uF: Atenção/), "info");
    // A lista: consumido, sobra pendente de devolução, por quem; campos sumiram
    expect($("[data-consumir]")).toBeNull();
    expect(linha("mTubo").getAttribute("data-situacao-material")).toBe("consumido");
    expect(txt(linha("mTubo").querySelector("[data-consumido]"))).toBe("Consumido 3 m");
    expect(txt(linha("mTubo").querySelector("[data-sobra]"))).toBe("Pend. devolução 2 m");
    expect(linha("mTubo").getAttribute("data-pendente-devolucao")).toBe("2");
    expect(txt(linha("mTubo").querySelector("[data-consumido-por]"))).toMatch(/^por Carlos Técnico · /);
    expect(linha("mCap").querySelector("[data-sobra]")).toBeNull();
    expect(txt($("[data-pendentes-devolucao]"))).toBe("1 sobra a devolver");
    expect($("[data-consumo-pendente-pill]")).toBeNull();
    expect(txt($("[data-flag-prestacao]"))).toBe("Prestação de contas pendente"); // a sobra ainda não voltou
    // Desfazer o tubo: confirma e manda o DELETE
    await clicar(linha("mTubo").querySelector('[data-acao="desfazer-consumo"]'));
    expect(avisos.confirmar.mock.calls.at(-1)![0]).toMatchObject({ titulo: "Desfazer consumo", perigo: true });
    expect(chamadas.at(-1)).toMatchObject({ metodo: "DELETE", url: "/api/ordens/os1/consumo", corpo: { id: "mTubo" } });
    expect(linha("mTubo").getAttribute("data-situacao-material")).toBe("separado");
    expect(txt($("[data-consumo-pendente-pill]"))).toBe("1 consumo a informar");
  });

  it("erro na tela sem POST (valor em branco); cancelar fecha; OS finalizada não desfaz; sem permissão não informa; amarra ligada: 'trava a conclusão'", async () => {
    const { OsSeparacao } = await import("@/components/os/os-separacao");
    await montar(createElement(OsSeparacao, { osId: "os1", materiais: INICIAIS, resumo: resumoSeparacao(INICIAIS), podeSeparar: false, podeConsumir: true, exigirPrestacao: true }));
    expect(txt($("[data-consumo-pendente-pill]"))).toBe("2 consumos a informar · trava a conclusão");
    await clicar($('[data-acao="informar-consumo"]'));
    await digitar(campo("mTubo"), "");
    await clicar($('[data-acao="confirmar-consumo"]'));
    expect(posts()).toEqual([]);
    expect(txt($("[role='alert']"))).toBe("Tubo de cobre 1/4: informe quanto foi consumido (0 se nada).");
    await clicar($('[data-acao="cancelar-consumo"]'));
    expect($("[data-consumir]")).toBeNull();
    expect($("[role='alert']")).toBeNull();
    // Consumido numa OS finalizada: sem "Desfazer"
    const consumidos = INICIAIS.map((m) => ({ ...m, quantidadeConsumida: m.quantidadeSeparada, estadoSeparacao: m.quantidadeSeparada > 0 ? "CONSUMIDO" : null, consumidoPor: "Carlos", consumidoEm: "2026-11-07T15:00:00.000Z" }));
    await remontar(createElement(OsSeparacao, { osId: "os1", materiais: consumidos, resumo: resumoSeparacao(consumidos), podeSeparar: false, podeConsumir: true, finalizada: true }));
    expect($('[data-acao="desfazer-consumo"]')).toBeNull();
    expect($('[data-acao="informar-consumo"]')).toBeTruthy(); // o filtro (não separado) ainda aceita consumo
    expect($("[data-flag-prestacao]")).toBeNull(); // tudo consumido sem sobra
    // Sem permissão de executar/concluir: nem informa nem desfaz
    await remontar(createElement(OsSeparacao, { osId: "os1", materiais: INICIAIS, resumo: resumoSeparacao(INICIAIS), podeSeparar: true, podeConsumir: false }));
    expect($('[data-acao="informar-consumo"]')).toBeNull();
    expect($('[data-acao="ir-separar"]')).toBeTruthy();
    // OS cancelada: não informa
    await remontar(createElement(OsSeparacao, { osId: "os1", materiais: INICIAIS, resumo: resumoSeparacao(INICIAIS), podeSeparar: false, podeConsumir: true, cancelada: true }));
    expect($('[data-acao="informar-consumo"]')).toBeNull();
  });
});

describe("E4.2 — a amarra em Configurações", () => {
  const EMPRESA: any = {
    id: "e1", nome: "Clima Total Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "a@b.com", logo: null,
    telefone: null, celular: null, site: null, endereco: "Av. Paulista", numero: "1000", complemento: null, bairro: null, cidade: "São Paulo",
    estado: "SP", cep: null, latitude: null, longitude: null, bancoNome: null, bancoAgencia: null, bancoConta: null, bancoTipoConta: null,
    bancoTitular: null, pixChave: null, inscricaoEstadual: null, inscricaoMunicipal: null, cnaePrincipal: "4322302", responsavelTecnicoId: null,
  };
  it("a opção 'Exigir prestação de contas de material para finalizar a OS' nasce desligada, tem ⓘ curta e vai no PUT ao ligar", async () => {
    const { ConfiguracoesClient } = await import("@/components/forms/configuracoes-client");
    await montar(createElement(ConfiguracoesClient, { empresa: EMPRESA, config: { issAliquota: 2, osExigirPrestacaoMaterial: false } as any, parte: "preferencias" }));
    const rotulo = [...document.querySelectorAll("label")].find((l) => txt(l).startsWith("Exigir prestação de contas de material para finalizar a OS"));
    expect(rotulo).toBeTruthy();
    const dica = document.querySelector('[data-dica][aria-label="Ajuda: Exigir prestação de contas de material para finalizar a OS"]');
    expect(dica).toBeTruthy();
    const balao = document.getElementById(dica!.getAttribute("aria-describedby")!);
    expect(txt(balao)).toBe("Ligado: a OS só conclui depois que o consumo de todo material separado foi informado (aba Materiais & Compras). Desligado: a OS mostra o que falta, mas não trava.");
    const sw = rotulo!.querySelector<HTMLInputElement>("input[type='checkbox'], button[role='switch']");
    expect(sw).toBeTruthy();
    expect(sw!.getAttribute("aria-checked") ?? String((sw as HTMLInputElement).checked)).toBe("false");
    await clicar(sw);
    expect(sw!.getAttribute("aria-checked") ?? String((sw as HTMLInputElement).checked)).toBe("true");
    const salvar = [...document.querySelectorAll("button")].find((b) => /Salvar/.test(txt(b)) && b.closest("form, section, div")?.textContent?.includes("Ordens de serviço"));
    if (salvar) {
      await clicar(salvar);
      const put = chamadas.find((c) => c.url === "/api/configuracoes" && c.metodo === "PUT");
      expect(put?.corpo).toMatchObject({ osExigirPrestacaoMaterial: true });
    }
  });
});
