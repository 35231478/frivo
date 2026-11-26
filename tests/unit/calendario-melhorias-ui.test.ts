// @vitest-environment happy-dom
/**
 * CALENDÁRIO — melhorias da tela (DOM real, sem servidor).
 *  - STATUS: a cor é acento, não fundo — cartão neutro com uma barra fina à esquerda na cor do status
 *    (4 cores, uma por status; nunca por técnico nem por tipo); hora em destaque, cliente legível, sigla
 *    do técnico discreta, ícones só quando valem e em tom neutro. Atrasada vence o status e pinta a hora.
 *    Os pares de cor passam WCAG AA (texto 4.5:1; barra 3:1).
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
import { CORES_CARTAO, CORES_GRUPO, ESTILO_CARTAO, ESTILO_GRUPO, LARGURA_BARRA, grupoDoCard, type GrupoStatus } from "@/lib/calendario/cores";

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
  // O filtro "Localização / unidade" virou seletor do cadastro (Unidade), não mais texto solto
  unidades: [{ value: "u1", label: "Matriz", clienteId: "c1" }, { value: "u2", label: "Loja Centro", clienteId: "c2" }],
};
const card = (id: string, dia: string, extra: Record<string, unknown> = {}) => ({
  chave: `${id}:${dia}`, id, numero: `OS-${id}`, origem: "MANUAL", atividadeId: `a-${id}`, clienteId: "c1", tecnicoId: "t1", tipoOsId: "tp1",
  clienteCurto: "Hospital", clienteCompleto: "Hospital Santa Clara", unidadeId: "u1", unidade: "Matriz", tipoOs: "Preventiva", hora: "09:00",
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
const GRUPOS: GrupoStatus[] = ["aberta", "deslocamento", "andamento", "concluida", "atrasada", "neutra"];

/* ═════════ o status no cartão: acento, não fundo ═════════ */
describe("Calendário — o cartão da OS é neutro e o status é uma barra à esquerda (5 cores, legível em AA)", () => {
  it("cada status cai no seu grupo; atrasada vence o status; desconhecido fica neutro", () => {
    const g = (status: string, atrasada = false) => grupoDoCard({ status, atrasada });
    // "Em deslocamento" (técnico a caminho hoje) vence o status da OS, mas não a atrasada
    expect([grupoDoCard({ status: "AGENDADA", deslocamento: true }), grupoDoCard({ status: "EM_ANDAMENTO", deslocamento: true }), grupoDoCard({ status: "ABERTA", atrasada: true, deslocamento: true })])
      .toEqual(["deslocamento", "deslocamento", "atrasada"]);
    expect(grupoDoCard({ status: "AGENDADA", deslocamento: false })).toBe("aberta");
    expect(["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA"].map((s) => g(s))).toEqual(["aberta", "aberta", "aberta"]);
    expect(["EM_ANDAMENTO", "PAUSADA", "AGUARDANDO_PECA"].map((s) => g(s))).toEqual(["andamento", "andamento", "andamento"]);
    expect([g("CONCLUIDA"), g("CANCELADA"), g("QUALQUER")]).toEqual(["concluida", "neutra", "neutra"]);
    expect([g("ABERTA", true), g("EM_ANDAMENTO", true)]).toEqual(["atrasada", "atrasada"]);
  });

  it("paleta enxuta: uma cor por status que aparece no calendário (5, com o deslocamento), todas dos tokens — e o fundo é o MESMO para todos", () => {
    // cancelada não entra no calendário; as 5 que aparecem têm cada uma a sua cor (deslocamento = tom próprio, índigo)
    const visiveis: GrupoStatus[] = ["aberta", "deslocamento", "andamento", "concluida", "atrasada"];
    expect(visiveis.map((g) => ESTILO_GRUPO[g].barra)).toEqual(["bg-acento", "bg-deslocamento", "bg-atencao", "bg-ok", "bg-atrasado"]);
    expect(ESTILO_GRUPO.deslocamento.rotulo).toBe("Em deslocamento");
    expect(new Set(GRUPOS.map((g) => CORES_GRUPO[g].barra)).size).toBe(GRUPOS.length);
    // o cartão não é pintado: fundo neutro único, sem contorno e sem sombra
    // Um passo de contraste (pedido do dono): o cartão era fundo quase branco e SEM contorno sobre
    // o branco do dia — se dissolvia na grade. Continua neutro: nenhuma cor nova, só corpo.
    expect(ESTILO_CARTAO).toBe("bg-surface-linha border border-surface-border hover:bg-surface-border");
    expect(ESTILO_CARTAO, "a cor continua só na barra do status").not.toMatch(/acento|atencao|ok|atrasado|previsto/);
    // A barra ganhou UM passo de presença (3px → 4px). O valor fica preso aqui de propósito: sem
    // isto, encolher a barra de volta não quebraria teste nenhum, porque o cartão e a legenda leem
    // a constante. Um passo, não dois: mais que 6px vira faixa colorida, que é o que não se quer.
    expect(LARGURA_BARRA).toBe("w-[4px]");
    const px = Number(/w-\[(\d+)px\]/.exec(LARGURA_BARRA)![1]);
    expect(px, "mais larga que a de antes").toBeGreaterThan(3);
    expect(px, "sem virar faixa colorida").toBeLessThanOrEqual(6);
    expect(JSON.stringify(ESTILO_GRUPO)).not.toMatch(/-claro|border-|shadow/);
    // só o atrasado pinta a hora (tem que continuar óbvio); os outros usam o texto normal
    expect(GRUPOS.filter((g) => ESTILO_GRUPO[g].hora !== "text-ink")).toEqual(["atrasada"]);
  });

  it("os pares de cor passam o mínimo: texto, hora e sigla sobre o fundo ≥ 4.5:1; a barra sobre o cartão e sobre o dia ≥ 3:1", () => {
    for (const fundo of [CORES_CARTAO.fundo, CORES_CARTAO.hover]) {
      expect(contraste(CORES_CARTAO.principal, fundo), "nome do cliente").toBeGreaterThanOrEqual(4.5);
      expect(contraste(CORES_CARTAO.apoio, fundo), "sigla do técnico e ícones").toBeGreaterThanOrEqual(4.5);
      for (const grupo of GRUPOS) {
        expect(contraste(CORES_GRUPO[grupo].hora, fundo), `${grupo}: hora`).toBeGreaterThanOrEqual(4.5);
        expect(contraste(CORES_GRUPO[grupo].barra, fundo), `${grupo}: barra sobre o cartão`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const grupo of GRUPOS) expect(contraste(CORES_GRUPO[grupo].barra, CORES_CARTAO.celula), `${grupo}: barra sobre o dia`).toBeGreaterThanOrEqual(3);
  });

  it("na grade: cartão neutro com a barra do status, hora em destaque, cliente, e a sigla do técnico discreta (sem cor por técnico)", async () => {
    const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
    await montar(createElement(CalendarioGrid, { celulas: CELULAS, eventosPorDia: EVENTOS, opcoes: OPCOES } as any));
    const doDia = (dia: string) => $$(`[data-dia="${dia}"] [data-cartao-os]`);
    expect(doDia("2026-11-16").map((c) => c.dataset.cartaoOs)).toEqual(["concluida"]);
    expect(doDia("2026-11-17").map((c) => c.dataset.cartaoOs)).toEqual(["aberta", "andamento", "andamento"]);
    expect(doDia("2026-11-18").map((c) => c.dataset.cartaoOs)).toEqual(["atrasada"]);
    for (const c of $$("[data-dia] [data-cartao-os]")) {
      const estilo = ESTILO_GRUPO[c.dataset.cartaoOs as GrupoStatus];
      // o cartão é NEUTRO: o mesmo fundo para todo status, sem sombra e sem fundo tingido. O fio
      // em volta entrou nesta leva (o cartão sumia no branco do dia) e é neutro — nada de cor nele.
      expect(c.className.split(" ")).toEqual(expect.arrayContaining(["bg-surface-linha", "border", "border-surface-border", "hover:bg-surface-border"]));
      expect(c.className).not.toMatch(/shadow|-claro|bg-white/);
      expect(c.className, "o fio não é colorido").not.toMatch(/border-(acento|atencao|ok|atrasado|previsto|primary)/);
      // a cor do status está SÓ na barra fina da esquerda (primeiro filho, altura toda)
      const barra = c.firstElementChild as HTMLElement;
      expect(barra.hasAttribute("data-barra-status")).toBe(true);
      expect(barra.className.split(" ")).toEqual(expect.arrayContaining([LARGURA_BARRA, "self-stretch", estilo.barra]));
      expect($$("[class*='bg-acento'], [class*='bg-atencao'], [class*='bg-ok'], [class*='bg-atrasado']", c)).toEqual([barra]);
      // o status também vai em texto para o leitor de tela
      expect(txt($(".sr-only", c))).toBe(`${estilo.rotulo}:`);
      // hierarquia: hora forte, cliente no texto normal, sigla pequena e cinza
      const hora = $("[data-hora-card]", c)!;
      expect(hora.className).toContain("font-semibold");
      expect(hora.className).toContain(estilo.hora);
      expect($("[data-cliente-card]", c)!.className).toContain("text-ink");
      const sigla = $("[data-sigla-tecnico]", c)!;
      expect(txt(sigla)).toBe("JS");
      expect(sigla.className.split(" ")).toEqual(expect.arrayContaining(["text-[9px]", "text-ink-muted"]));
      expect(sigla.className).not.toMatch(/bg-|rounded-full/); // não é mais o círculo colorido por técnico
      expect(sigla.getAttribute("title")).toBe("João Silva");
      // sem cadeado e sem bolinha: a barra já diz o status
      expect($("[data-ponto-status]", c)).toBeNull();
    }
    // o atrasado continua óbvio: barra vermelha E hora vermelha
    const atrasado = doDia("2026-11-18")[0];
    expect($("[data-barra-status]", atrasado)!.className).toContain("bg-atrasado");
    expect($("[data-hora-card]", atrasado)!.className).toContain("text-atrasado-texto");
    expect($("[data-hora-card]", doDia("2026-11-16")[0])!.className).not.toContain("atrasado");
  });

  it("ícones só quando valem e em tom neutro: recorrência na OS recorrente; alerta só na prioridade alta/urgente; equipe vira +N na sigla", async () => {
    const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
    await montar(createElement(CalendarioGrid, { celulas: CELULAS, opcoes: OPCOES, eventosPorDia: {
      "2026-11-16": [card("n", "2026-11-16")],
      "2026-11-17": [card("u", "2026-11-17", { prioridade: "URGENTE" }), card("a", "2026-11-17", { prioridade: "ALTA", hora: "10:00" })],
      "2026-11-18": [card("r", "2026-11-18", { origem: "RECORRENTE", status: "CONCLUIDA", membros: [{ nome: "Ana Dias", avatar: null }, { nome: "Bia Reis", avatar: null }] })],
      "2026-11-19": [card("s", "2026-11-19", { tecnicoNome: null, tecnicoId: null })],
    } } as any));
    const c = (dia: string, i = 0) => $$(`[data-dia="${dia}"] [data-cartao-os]`)[i];
    const icones = (el: Element) => [...el.querySelectorAll("svg")].map((s) => `${s.getAttribute("aria-label")}|${/text-ink-muted/.test(s.getAttribute("class") ?? "")}`);
    expect(icones(c("2026-11-16"))).toEqual([]); // OS comum: nenhum ícone
    expect(icones(c("2026-11-17", 0))).toEqual(["Prioridade urgente|true"]);
    expect(icones(c("2026-11-17", 1))).toEqual(["Prioridade alta|true"]);
    expect(icones(c("2026-11-18"))).toEqual(["OS recorrente|true"]); // concluída: sem cadeado
    for (const svg of $$("[data-dia] [data-cartao-os] svg")) expect(svg.getAttribute("class")).not.toMatch(/text-(atencao|atrasado|ok|acento|primary)/);
    expect(txt($("[data-sigla-tecnico]", c("2026-11-18")))).toBe("JS+2");
    expect($("[data-sigla-tecnico]", c("2026-11-18"))!.getAttribute("title")).toBe("João Silva, Ana Dias, Bia Reis");
    expect(txt($("[data-sigla-tecnico]", c("2026-11-19")))).toBe("—");
    expect($("[data-sigla-tecnico]", c("2026-11-19"))!.getAttribute("title")).toBe("Sem técnico definido");
  });

  it("'Em deslocamento': barra índigo e hora normal; vence o status da OS, perde para a atrasada; no celular o ponto vem logo depois do atrasado; o cartão grande ganha a pílula", async () => {
    const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
    await montar(createElement(CalendarioGrid, { celulas: CELULAS, opcoes: OPCOES, eventosPorDia: {
      "2026-11-17": [
        card("d", "2026-11-17", { status: "AGENDADA", deslocamento: true, hora: "14:00" }),
        card("e", "2026-11-17", { status: "EM_ANDAMENTO", deslocamento: true, hora: "08:30", clienteCurto: "Padaria" }),
        card("f", "2026-11-17", { status: "AGENDADA", deslocamento: false, hora: "10:00" }),
      ],
      "2026-11-18": [card("g", "2026-11-18", { status: "ABERTA", atrasada: true, deslocamento: true })],
    } } as any));
    const doDia = (k: string) => $$(`[data-dia="${k}"] [data-cartao-os]`);
    expect(doDia("2026-11-17").map((c) => c.getAttribute("data-cartao-os"))).toEqual(["deslocamento", "deslocamento", "aberta"]);
    const d = doDia("2026-11-17")[0];
    expect($("[data-barra-status]", d)!.className).toContain("bg-deslocamento");
    expect($("[data-hora-card]", d)!.className).toContain("text-ink");
    expect(txt($(".sr-only", d))).toBe("Em deslocamento:");
    expect(doDia("2026-11-18")[0].getAttribute("data-cartao-os")).toBe("atrasada"); // atrasada continua vencendo
    // celular: um ponto por grupo, deslocamento logo depois do atrasado
    const pontos = (k: string) => $$("[data-pontos-dia] span", $(`[data-dia-mobile="${k}"]`)!).map((p) => p.className.match(/bg-[a-z]+/)![0]);
    expect(pontos("2026-11-17")).toEqual(["bg-deslocamento", "bg-acento"]);
    expect(pontos("2026-11-18")).toEqual(["bg-atrasado"]);
    // o cartão grande (passar o mouse): a pílula "Em deslocamento" ao lado do status da OS; sem deslocamento, nada
    await act(async () => { d.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    await esperar();
    expect(txt($("[data-selo-deslocamento]"))).toBe("Em deslocamento");
    expect($("[data-selo-deslocamento]")!.className).toContain("pill-deslocamento");
    await act(async () => { d.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
    await esperar();
    await act(async () => { doDia("2026-11-17")[2].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    await esperar();
    expect($("[data-selo-deslocamento]")).toBeNull();
  });

  it("no celular o dia mostra quantas OS tem (em tom neutro) e um ponto por status presente", async () => {
    const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
    await montar(createElement(CalendarioGrid, { celulas: CELULAS, eventosPorDia: EVENTOS, opcoes: OPCOES } as any));
    const dia = (k: string) => $(`[data-dia-mobile="${k}"]`)!;
    expect(txt(dia("2026-11-17"))).toBe("173");
    for (const n of $$("[data-contagem-dia]")) expect(n.className).not.toMatch(/bg-(primary|atrasado|acento)/);
    const pontos = (k: string) => $$("[data-pontos-dia] span", dia(k)).map((p) => p.className.match(/bg-[a-z]+/)![0]);
    expect(pontos("2026-11-17")).toEqual(["bg-atencao", "bg-acento"]);
    expect(pontos("2026-11-18")).toEqual(["bg-atrasado"]);
    expect($("[data-pontos-dia]", dia("2026-11-15"))).toBeNull();
  });

  it("a legenda mostra as 5 barras de status (deslocamento entre agendada e em andamento) e os dois ícones, sem amostra pintada", () => {
    const f = fonte("app/(dashboard)/calendario/page.tsx");
    expect(f).toMatch(/const LEGENDA: GrupoStatus\[\] = \["aberta", "deslocamento", "andamento", "concluida", "atrasada"\];/);
    const legenda = f.slice(f.indexOf("data-legenda-calendario"), f.indexOf("</SolicitacoesGaveta>"));
    // a legenda lê a MESMA largura do cartão (uma constante só, em lib/calendario/cores.ts)
    expect(legenda).toContain('cn(LARGURA_BARRA, "h-3.5 rounded-full", ESTILO_GRUPO[g].barra)');
    expect(legenda).toContain("Prioridade alta ou urgente");
    expect(legenda).toContain("OS recorrente");
    expect(legenda).not.toMatch(/text-atencao|text-atrasado|\.cartao/);
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

  /* ── "Localização / unidade": seletor do cadastro, não texto solto (item 4 da leva) ── */

  it("a unidade vem do CADASTRO: o seletor oferece as unidades, não um campo de digitar", async () => {
    await abrir();
    const campo = $("[data-filtro-unidade] [data-busca-select]");
    expect(campo, "o campo virou seletor").toBeTruthy();
    expect($('input[aria-label="Localização ou unidade"]'), "não há mais campo de digitar").toBeFalsy();
    await clicar(campo);
    // sem cliente escolhido, oferece todas — com o nome do cliente junto (duas empresas têm "Matriz")
    expect($$("[data-unidade-opcao]").map((e) => txt(e))).toEqual(["Matriz — Hospital Santa Clara", "Loja Centro — Padaria Sol"]);
  });

  it("escolher uma unidade sem OS no mês esmaece a grade inteira (e conta como filtro ativo)", async () => {
    nav.busca = "unidadeId=u2"; // Loja Centro: nenhum cartão do mês é dela
    await abrir();
    expect(txt($("[data-resumo-calendario]"))).toBe("0 de 5 ordens de serviço");
    expect(txt($("[data-filtros-calendario]"))).toContain("1 filtro ativo");
  });

  it("escolher a unidade das OS do mês mantém todas à vista", async () => {
    nav.busca = "unidadeId=u1";
    await abrir();
    expect(txt($("[data-resumo-calendario]"))).toBe("5 de 5 ordens de serviço");
  });

  it("link antigo com o NOME digitado (`unidade=Matriz`) continua valendo: vira o id do cadastro", async () => {
    nav.busca = "unidade=Matriz";
    await abrir();
    expect(txt($("[data-resumo-calendario]"))).toBe("5 de 5 ordens de serviço");
    expect(txt($("[data-filtro-unidade]"))).toContain("Matriz");
  });

  it("com um cliente escolhido, o seletor oferece só as unidades DELE", async () => {
    nav.busca = "clienteId=c1";
    await abrir();
    await clicar($("[data-filtro-unidade] [data-busca-select]"));
    expect($$("[data-unidade-opcao]").map((e) => txt(e))).toEqual(["Matriz"]); // sem repetir o cliente
  });

  it("cliente SEM unidade cadastrada: o campo sai e explica, em vez de oferecer uma lista vazia", async () => {
    const { CalendarioPainel } = await import("@/components/calendario/calendario-painel");
    nav.busca = "clienteId=c3";
    await montar(createElement(CalendarioPainel, {
      celulas: CELULAS, eventosPorDia: EVENTOS, totalMes: 5,
      opcoes: { ...OPCOES, clientes: [...OPCOES.clientes, { value: "c3", label: "Mercado Bom Preço" }] },
    } as any));
    expect($("[data-filtro-unidade]")).toBeFalsy();
    expect(txt($("[data-unidade-sem-cadastro]"))).toBe("Mercado Bom Preço não tem unidade cadastrada.");
  });

  it("a página: uma barra só com título, mês e visão; o botão de atualizar; e nada de \"Gerar OS recorrentes\"", () => {
    const f = fonte("app/(dashboard)/calendario/page.tsx");
    expect(f).toMatch(/<h1 className="page-title[^"]*"[^>]*>Calendário <Dica texto=\{AJUDA\}/);
    expect(f).toMatch(/<AtualizarCalendario \/>/);
    expect(f).not.toMatch(/GerarOsRecorrentes|Gerar OS recorrentes/);
    expect(f).not.toMatch(/space-y-6/); // o título não é mais uma linha separada acima do cartão
    // título, navegação do mês e visão dentro da MESMA barra
    const barra = f.slice(f.indexOf("data-barra-calendario"), f.indexOf("{/* Painel de filtros + grade */}"));
    // As setas agora andam no período da VISÃO (semana a semana na Semana), então o rótulo delas
    // e o do cabeçalho são calculados, não fixos no mês.
    for (const peca of ["Calendário <Dica", "data-periodo-anterior", "data-periodo-seguinte", "{rotuloVoltar}", "{rotuloAvancar}", "{rotuloPeriodo}", "Hoje", "<AtualizarCalendario />", ">Mês</Link>", ">Semana</Link>"]) expect(barra, peca).toContain(peca);
    expect(f).toContain('passoDoPeriodo(view, { ano, mes, dia: diaRef }, -1)');
    expect(f).toContain('passoDoPeriodo(view, { ano, mes, dia: diaRef }, 1)');
    // a semana vazia do fim do mês não ocupa uma linha
    expect(f).toMatch(/while \(celulas\.length > 7 && celulas\.slice\(-7\)\.every\(\(c\) => !c\.inMonth\)\) celulas\.length -= 7;/);
  });
});
