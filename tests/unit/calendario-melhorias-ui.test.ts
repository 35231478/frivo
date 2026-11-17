// @vitest-environment happy-dom
/**
 * CALENDÁRIO — melhorias da tela (DOM real, sem servidor).
 *  - CONTRASTE: o cartão da OS leva a cor do status (fundo + contorno), com a bolinha e a sigla do
 *    técnico; atrasada vence o status. Os pares de cor passam WCAG AA (texto 4.5:1; contorno 3:1).
 *  - HOJE: o círculo do dia pulsa (classe própria) e o CSS desliga o pulso para quem pediu menos animação.
 *  - ATUALIZAR: o botão recarrega os eventos do período (router.refresh) e mostra que está buscando.
 *  - CABEÇALHO: título, mês e visão numa barra só; filtros numa faixa fina, recolhida no celular —
 *    sem perder nenhum dos 7 filtros; o botão "Gerar OS recorrentes do mês" não existe mais.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { permissoesTotais } from "@/lib/permissoes";
import { contraste } from "@/lib/ui/tokens";
import { CORES_GRUPO, ESTILO_GRUPO, TEXTO_CARTAO, bordaSobreCelula, grupoDoCard, type GrupoStatus } from "@/lib/calendario/cores";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (p: string) => fs.readFileSync(path.join(RAIZ, p), "utf8");

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), busca: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => "/calendario", useSearchParams: () => new URLSearchParams(nav.busca),
}));

let root: Root, caixa: HTMLDivElement;
const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as T | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el, "campo a preencher").toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(el: ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement("div", null, el) })); });
  await esperar();
}

beforeEach(() => { nav.busca = ""; nav.refresh.mockReset(); nav.replace.mockReset(); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); document.body.innerHTML = ""; });

const CELULAS = Array.from({ length: 7 }, (_, i) => ({ dateKey: `2026-11-${15 + i}`, dayNum: 15 + i, inMonth: true, isToday: i === 2, rowIndex: 0 }));
const OPCOES = {
  clientes: [{ value: "c1", label: "Hospital Santa Clara" }, { value: "c2", label: "Padaria Sol" }],
  tiposOs: [{ value: "tp1", label: "Preventiva" }],
  tecnicos: [{ value: "t1", label: "João Silva" }],
};
const card = (id: string, dia: string, extra: Record<string, unknown> = {}) => ({
  chave: `${id}:${dia}`, id, numero: `OS-${id}`, origem: "MANUAL", atividadeId: `a-${id}`, clienteId: "c1", tecnicoId: "t1", tipoOsId: "tp1",
  clienteCurto: "Hospital", clienteCompleto: "Hospital Santa Clara", unidade: "Matriz", tipoOs: "Preventiva", hora: "09:00",
  dataFmt: "17/11/2026", tecnicoNome: "João Silva", tecnicoAvatar: null, status: "AGENDADA", prioridade: "NORMAL", atrasada: false, ...extra,
});
const EVENTOS = {
  "2026-11-16": [card("ok", "2026-11-16", { status: "CONCLUIDA" })],
  "2026-11-17": [
    card("ag", "2026-11-17"),
    card("and", "2026-11-17", { status: "EM_ANDAMENTO", hora: "10:00" }),
    card("pec", "2026-11-17", { status: "AGUARDANDO_PECA", hora: "11:00", clienteId: "c2", clienteCurto: "Padaria" }),
  ],
  "2026-11-18": [card("atr", "2026-11-18", { status: "ABERTA", atrasada: true, origem: "RECORRENTE" })],
};
const GRUPOS: GrupoStatus[] = ["aberta", "andamento", "concluida", "atrasada", "neutra"];

/* ═════════ contraste dos cartões ═════════ */
describe("Calendário — o cartão da OS leva a cor do status e é legível (WCAG AA)", () => {
  it("cada status cai no seu grupo; atrasada vence o status; desconhecido fica neutro", () => {
    const g = (status: string, atrasada = false) => grupoDoCard({ status, atrasada });
    expect(["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA"].map((s) => g(s))).toEqual(["aberta", "aberta", "aberta"]);
    expect(["EM_ANDAMENTO", "PAUSADA", "AGUARDANDO_PECA"].map((s) => g(s))).toEqual(["andamento", "andamento", "andamento"]);
    expect([g("CONCLUIDA"), g("CANCELADA"), g("QUALQUER")]).toEqual(["concluida", "neutra", "neutra"]);
    expect([g("ABERTA", true), g("EM_ANDAMENTO", true)]).toEqual(["atrasada", "atrasada"]);
  });

  it("os pares de cor passam o mínimo: texto e hora sobre o fundo ≥ 4.5:1; contorno sobre o branco do dia ≥ 3:1", () => {
    for (const grupo of GRUPOS) {
      const c = CORES_GRUPO[grupo];
      expect(contraste(TEXTO_CARTAO.principal, c.fundo), `${grupo}: nome do cliente`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(c.hora, c.fundo), `${grupo}: hora`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(TEXTO_CARTAO.apoio, c.fundo), `${grupo}: ícones de apoio`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(bordaSobreCelula(grupo), TEXTO_CARTAO.celula), `${grupo}: contorno`).toBeGreaterThanOrEqual(3);
      // a bolinha (cor cheia do status) sobre o fundo do cartão
      expect(contraste(c.borda, c.fundo), `${grupo}: bolinha`).toBeGreaterThanOrEqual(3);
    }
    // cada grupo tem um fundo diferente (a cor diz o status de relance)
    expect(new Set(GRUPOS.map((g) => CORES_GRUPO[g].fundo)).size).toBe(GRUPOS.length);
    // as classes usam o MESMO matiz das cores conferidas (fundo claro + contorno a 80%)
    expect(ESTILO_GRUPO.aberta.cartao).toBe("bg-acento-claro border-acento/80 hover:border-acento");
    expect(ESTILO_GRUPO.andamento.cartao).toBe("bg-atencao-claro border-atencao/80 hover:border-atencao");
    expect(ESTILO_GRUPO.concluida.cartao).toBe("bg-ok-claro border-ok/80 hover:border-ok");
    expect(ESTILO_GRUPO.atrasada.cartao).toBe("bg-atrasado-claro border-atrasado/80 hover:border-atrasado");
  });

  it("na grade, o cartão inteiro tem o fundo e o contorno do status — e mantém a bolinha, a hora e a sigla do técnico", async () => {
    const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
    await montar(createElement(CalendarioGrid, { celulas: CELULAS, eventosPorDia: EVENTOS, opcoes: OPCOES } as any));
    const doDia = (dia: string) => $$(`[data-dia="${dia}"] [data-cartao-os]`);
    expect(doDia("2026-11-16").map((c) => c.dataset.cartaoOs)).toEqual(["concluida"]);
    expect(doDia("2026-11-17").map((c) => c.dataset.cartaoOs)).toEqual(["aberta", "andamento", "andamento"]);
    expect(doDia("2026-11-18").map((c) => c.dataset.cartaoOs)).toEqual(["atrasada"]);
    for (const c of $$("[data-dia] [data-cartao-os]")) {
      const estilo = ESTILO_GRUPO[c.dataset.cartaoOs as GrupoStatus];
      for (const classe of ["border", ...estilo.cartao.split(" ")]) expect(c.className.split(" "), c.dataset.cartaoOs).toContain(classe);
      expect(c.className).not.toMatch(/bg-white/); // não é mais o cartão branco sobre o dia branco
      // bolinha do status, hora na cor do status e sigla do técnico
      expect($("[data-ponto-status]", c)!.className).toContain(estilo.ponto);
      expect([...c.querySelectorAll("span")].some((s) => txt(s) === "09:00" || txt(s) === "10:00" || txt(s) === "11:00")).toBe(true);
      expect(txt(c)).toContain("JS");
    }
    const hora = [...doDia("2026-11-18")[0].querySelectorAll("span")].find((s) => txt(s) === "09:00")!;
    expect(hora.className).toContain("text-atrasado-texto");
  });

  it("no celular o dia mostra quantas OS tem e um ponto por status presente", async () => {
    const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
    await montar(createElement(CalendarioGrid, { celulas: CELULAS, eventosPorDia: EVENTOS, opcoes: OPCOES } as any));
    const dia = (k: string) => $(`[data-dia-mobile="${k}"]`)!;
    expect(txt(dia("2026-11-17"))).toBe("173");
    const pontos = (k: string) => $$("[data-pontos-dia] span", dia(k)).map((p) => p.className.match(/bg-[a-z]+/)![0]);
    expect(pontos("2026-11-17")).toEqual(["bg-atencao", "bg-acento"]);
    expect(pontos("2026-11-18")).toEqual(["bg-atrasado"]);
    expect($("[data-pontos-dia]", dia("2026-11-15"))).toBeNull();
  });
});

/* ═════════ hoje pulsando ═════════ */
describe("Calendário — o dia de hoje pulsa (e respeita quem pediu menos animação)", () => {
  it("só o círculo de hoje pulsa, no computador e no celular; os outros dias não", async () => {
    const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
    await montar(createElement(CalendarioGrid, { celulas: CELULAS, eventosPorDia: {}, opcoes: OPCOES } as any));
    const hoje = $$("[data-hoje]");
    expect(hoje.map((h) => txt(h))).toEqual(["17", "17"]); // a versão de celular e a de computador
    for (const h of hoje) {
      expect(h.className).toContain("anim-hoje-pulso");
      expect(h.className).toContain("bg-primary-500"); // o destaque (círculo) continua
      expect(h.getAttribute("aria-current")).toBe("date");
    }
    expect($$(".anim-hoje-pulso")).toHaveLength(2);
  });

  it("o CSS desliga o pulso em prefers-reduced-motion (o círculo fica)", () => {
    const css = fonte("app/globals.css");
    expect(css).toMatch(/@keyframes hojePulso/);
    expect(css).toMatch(/\.anim-hoje-pulso \{\s*animation: hojePulso [\d.]+s ease-out infinite;\s*\}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.anim-hoje-pulso \{ animation: none; \}\s*\}/);
  });
});

/* ═════════ atualizar ═════════ */
describe("Calendário — botão de atualizar", () => {
  it("recarrega os eventos do período (router.refresh) e tem nome para o leitor de tela", async () => {
    const { AtualizarCalendario } = await import("@/components/calendario/atualizar-calendario");
    await montar(createElement(AtualizarCalendario));
    const b = $<HTMLButtonElement>("[data-atualizar-calendario]")!;
    expect(b.getAttribute("aria-label")).toBe("Atualizar o calendário");
    expect(b.disabled).toBe(false);
    await clicar(b);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("enquanto busca: gira, avisa \"atualizando\" e não aceita outro clique (o giro some para quem pediu menos animação)", () => {
    const f = fonte("components/calendario/atualizar-calendario.tsx");
    expect(f).toMatch(/const \[buscando, iniciar\] = useTransition\(\);/);
    expect(f).toMatch(/onClick=\{\(\) => iniciar\(\(\) => router\.refresh\(\)\)\}/);
    expect(f).toMatch(/disabled=\{buscando\}/);
    expect(f).toMatch(/aria-busy=\{buscando\}/);
    expect(f).toMatch(/buscando && "animate-spin motion-reduce:animate-none/);
  });
});

/* ═════════ cabeçalho e filtros ═════════ */
describe("Calendário — cabeçalho compacto, sem perder filtro", () => {
  const abrir = async () => {
    const { CalendarioPainel } = await import("@/components/calendario/calendario-painel");
    await montar(createElement(CalendarioPainel, { celulas: CELULAS, eventosPorDia: EVENTOS, opcoes: OPCOES, totalMes: 5 } as any));
  };
  const campos = () => $("#filtros-calendario")!;

  it("os 5 filtros estão numa faixa só (sem rótulo em cima: o nome está no campo e no leitor de tela) e \"Mais filtros\" traz os outros 2", async () => {
    await abrir();
    const nomes = () => $$("#filtros-calendario [aria-label], [data-filtros-extras] [aria-label]").map((e) => e.getAttribute("aria-label"));
    expect(nomes()).toEqual(["Cliente", "Tipo de OS", "Número da OS", "Localização ou unidade", "Técnico"]);
    expect($$("[data-filtros-calendario] label")).toEqual([]);
    expect(txt($("[data-resumo-calendario]"))).toBe("5 ordens de serviço");
    expect($("[data-mais-filtros]")!.getAttribute("aria-expanded")).toBe("false");
    await clicar($("[data-mais-filtros]"));
    expect($("[data-mais-filtros]")!.getAttribute("aria-expanded")).toBe("true");
    expect(nomes()).toEqual(["Cliente", "Tipo de OS", "Número da OS", "Localização ou unidade", "Técnico", "Status", "Prioridade"]);
  });

  it("no celular a faixa começa recolhida e \"Filtros\" abre; no computador os campos estão sempre à vista", async () => {
    await abrir();
    const b = $("[data-abrir-filtros]")!;
    expect(b.className).toContain("md:hidden"); // o botão só existe no celular
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-controls")).toBe("filtros-calendario");
    // recolhida no celular (hidden) e sempre visível a partir do md (md:flex)
    expect(campos().className.split(" ")).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
    await clicar(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(campos().className.split(" ")).toContain("grid");
    expect(campos().className.split(" ")).not.toContain("hidden");
  });

  it("quem chega com filtro na URL já vê os campos abertos (e o filtro aplicado)", async () => {
    nav.busca = "numero=and";
    await abrir();
    expect($("[data-abrir-filtros]")!.getAttribute("aria-expanded")).toBe("true");
    expect(campos().className.split(" ")).not.toContain("hidden");
    expect(txt($("[data-resumo-calendario]"))).toBe("1 de 5 ordens de serviço");
    expect(txt($("[data-filtros-calendario]"))).toContain("1 filtro ativo");
  });

  it("filtrar continua funcionando: conta, esmaece o que não bate e \"Limpar filtros\" desfaz", async () => {
    await abrir();
    await digitar($('input[aria-label="Número da OS"]'), "ok");
    expect(txt($("[data-resumo-calendario]"))).toBe("1 de 5 ordens de serviço");
    const apagados = () => $$("[data-dia] .opacity-30").length;
    expect(apagados()).toBe(4);
    const limpar = [...document.querySelectorAll("button")].find((x) => txt(x) === "Limpar filtros");
    await clicar(limpar);
    expect(txt($("[data-resumo-calendario]"))).toBe("5 ordens de serviço");
    expect(apagados()).toBe(0);
  });

  it("a página: uma barra só com título, mês e visão; o botão de atualizar; e nada de \"Gerar OS recorrentes\"", () => {
    const f = fonte("app/(dashboard)/calendario/page.tsx");
    expect(f).toMatch(/<h1 className="page-title[^"]*"[^>]*>Calendário <Dica texto=\{AJUDA\}/);
    expect(f).toMatch(/<AtualizarCalendario \/>/);
    expect(f).not.toMatch(/GerarOsRecorrentes|Gerar OS recorrentes/);
    expect(f).not.toMatch(/space-y-6/); // o título não é mais uma linha separada acima do cartão
    // título, navegação do mês e visão dentro da MESMA barra
    const barra = f.slice(f.indexOf("data-barra-calendario"), f.indexOf("{/* Painel de filtros + grade */}"));
    for (const peca of ["Calendário <Dica", "Mês anterior", "Próximo mês", "Hoje", "<AtualizarCalendario />", ">Mês</Link>", ">Semana</Link>"]) expect(barra, peca).toContain(peca);
    // a semana vazia do fim do mês não ocupa uma linha
    expect(f).toMatch(/while \(celulas\.length > 7 && celulas\.slice\(-7\)\.every\(\(c\) => !c\.inMonth\)\) celulas\.length -= 7;/);
  });
});
