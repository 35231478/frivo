// @vitest-environment happy-dom
/**
 * Tema 6 — datas e horas sempre no padrão brasileiro, em qualquer navegador.
 * As datas (dd/mm/aaaa) e as datas-com-hora já estavam convertidas (InputData / InputDataHora).
 * Restavam três campos de HORA nativos (type="time", que num navegador em inglês mostra AM/PM):
 * jornada do colaborador (entrada e saída) e "Hora de agendamento" do calendário → InputHora.
 * O último teste é a trava: nenhum campo nativo de data/hora volta a aparecer nas telas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { permissoesTotais } from "@/lib/permissoes";
import { InputHora, completarHora } from "@/components/ui/input-hora";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navegar = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navegar.push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => "/colaboradores", useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));

let root: Root; let caixa: HTMLDivElement;
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.body.querySelectorAll(s)] as T[];
const esperar = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const digitar = async (el: Element | null, v: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
};
const sair = async (el: Element | null) => { await act(async () => { el!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); };
async function montar(el: any) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}

describe("completar a hora ao sair do campo", () => {
  it("'9' → 09:00, '14' → 14:00, '930' → 09:30, '1830' → 18:30, '0' → 00:00", () => {
    expect(["9", "14", "930", "1830", "0", "23:59"].map(completarHora)).toEqual(["09:00", "14:00", "09:30", "18:30", "00:00", "23:59"]);
  });
  it("o que não é hora não vira hora: '25', '2460', '990', vazio, letras", () => {
    expect(["25", "2460", "990", "", "abc", "24"].map(completarHora)).toEqual([null, null, null, null, null, null]);
  });
});

describe("campo de hora (InputHora)", () => {
  const entregues: string[] = [];
  let definir: (v: string) => void;
  function Tela({ inicial }: { inicial: string }) {
    const [v, setV] = useState(inicial); definir = setV;
    return createElement(InputHora, { value: v, onChange: (h: string) => { entregues.push(h); setV(h); }, "aria-label": "Horário de entrada" });
  }
  const campo = () => $<HTMLInputElement>("[data-input-hora]")!;
  beforeEach(() => { entregues.length = 0; });

  it("é um campo de TEXTO com teclado numérico e dica hh:mm — não o relógio do navegador (AM/PM em inglês)", async () => {
    await montar(createElement(Tela, { inicial: "08:00" }));
    expect(campo().type).toBe("text");
    expect(campo().getAttribute("inputmode")).toBe("numeric");
    expect(campo().placeholder).toBe("hh:mm");
    expect(campo().value).toBe("08:00"); // 24 horas, como foi gravado
    expect(campo().getAttribute("aria-label")).toBe("Horário de entrada");
  });

  it("digitando só os números os dois-pontos entram sozinhos; a hora completa é entregue como HH:mm", async () => {
    await montar(createElement(Tela, { inicial: "" }));
    await digitar(campo(), "1"); await digitar(campo(), "17"); await digitar(campo(), "173");
    expect(campo().value).toBe("17:3");
    expect(entregues).toEqual([]); // ainda incompleta, e já estava vazio
    await digitar(campo(), "1730");
    expect(campo().value).toBe("17:30");
    expect(entregues).toEqual(["17:30"]);
  });

  it("hora da tarde fica 18:45 (nunca 6:45 PM); letras e sobras são ignoradas", async () => {
    await montar(createElement(Tela, { inicial: "" }));
    await digitar(campo(), "18h45 pm");
    expect(campo().value).toBe("18:45");
    expect(entregues).toEqual(["18:45"]);
  });

  it("ao sair do campo com a hora pela metade, completa: '9' vira 09:00", async () => {
    await montar(createElement(Tela, { inicial: "" }));
    await digitar(campo(), "9"); await sair(campo());
    expect(campo().value).toBe("09:00");
    expect(entregues).toEqual(["09:00"]);
  });

  it("hora que não existe ('25:00') fica em vermelho e NÃO é entregue — nem deixa valendo a hora anterior", async () => {
    await montar(createElement(Tela, { inicial: "08:00" }));
    await digitar(campo(), "2500");
    expect(campo().getAttribute("aria-invalid")).toBe("true");
    expect(entregues).toEqual([""]); // a 08:00 antiga não fica valendo calada
    expect(campo().value).toBe("25:00"); // e o que a pessoa digitou continua na tela para corrigir
    await digitar(campo(), "0730");
    expect(campo().getAttribute("aria-invalid")).toBeNull();
    expect(entregues).toEqual(["", "07:30"]);
  });

  it("apagar limpa (entrega vazio); corrigir uma hora já preenchida não perde o que está sendo digitado", async () => {
    await montar(createElement(Tela, { inicial: "08:00" }));
    await digitar(campo(), "08:0");
    expect(campo().value).toBe("08:0"); // não some nem volta para 08:00 no meio da digitação
    await digitar(campo(), "");
    expect(campo().value).toBe("");
    expect(entregues).toEqual([""]);
  });

  it("valor vindo de fora (abrir outro cadastro, limpar o formulário) aparece no campo", async () => {
    await montar(createElement(Tela, { inicial: "08:00" }));
    await act(async () => { definir("13:15"); });
    expect(campo().value).toBe("13:15");
    await act(async () => { definir(""); });
    expect(campo().value).toBe("");
    expect(entregues).toEqual([]);
  });
});

describe("jornada do colaborador", () => {
  const COLAB = {
    id: "t1", nome: "Carlos Souza", cpf: "529.982.247-25", telefone: "(11) 99999-0000", tipo: "TECNICO_CAMPO", statusColaborador: "ATIVO",
    jornadaEntrada: "08:00", jornadaSaida: "17:48", jornadaDias: ["SEG", "TER"], especialidades: [], competencias: [], documentos: [],
  };
  let enviados: any[];
  beforeEach(() => {
    enviados = []; navegar.push.mockClear();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT" || init?.method === "POST") { enviados.push({ url, corpo: JSON.parse(String(init.body)) }); return new Response("{}", { status: 200 }); }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }));
  });
  async function abrir() {
    const { ColaboradorForm } = await import("@/components/forms/colaborador-form");
    await montar(createElement(ColaboradorForm, { initialData: COLAB } as any));
    return { entrada: $<HTMLInputElement>('[aria-label="Horário de entrada"]')!, saida: $<HTMLInputElement>('[aria-label="Horário de saída"]')! };
  }
  const salvar = async () => {
    await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await esperar(60);
  };

  it("entrada e saída aparecem em hh:mm de 24 horas, em campos de texto (não o relógio nativo)", async () => {
    const { entrada, saida } = await abrir();
    expect([entrada.type, saida.type]).toEqual(["text", "text"]);
    expect([entrada.value, saida.value]).toEqual(["08:00", "17:48"]);
    expect($$('input[type="time"]')).toEqual([]);
  });

  it("salvar sem mexer mantém a jornada; a hora alterada vai para o servidor como HH:mm", async () => {
    const { saida } = await abrir();
    await salvar();
    expect(enviados[0].url).toBe("/api/tecnicos/t1");
    expect([enviados[0].corpo.jornadaEntrada, enviados[0].corpo.jornadaSaida]).toEqual(["08:00", "17:48"]);
    await digitar(saida, "1830");
    await salvar();
    expect([enviados[1].corpo.jornadaEntrada, enviados[1].corpo.jornadaSaida]).toEqual(["08:00", "18:30"]);
  });

  it("jornada apagada vai vazia (o campo é opcional)", async () => {
    const { entrada } = await abrir();
    await digitar(entrada, "");
    await salvar();
    expect(enviados[0].corpo.jornadaEntrada).toBe("");
    expect(enviados[0].corpo.jornadaSaida).toBe("17:48");
  });
});

describe("trava: nenhum campo nativo de data/hora nas telas", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  function arquivos(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? arquivos(p) : /\.tsx?$/.test(e.name) ? [p] : [];
    });
  }
  const NATIVO = /type\s*[=:]\s*\{?\s*["'`](date|datetime-local|month|week|time)["'`]/;
  // O único permitido: o calendário escondido dentro do InputData (abre o seletor do aparelho; o texto visível é dd/mm/aaaa)
  const PERMITIDO = new Set(["components/ui/input-data.tsx"]);

  it("app/ e components/ usam InputData, InputDataHora e InputHora — sem type=date/datetime-local/month/week/time", () => {
    const achados: string[] = [];
    for (const arq of [...arquivos(path.join(RAIZ, "app")), ...arquivos(path.join(RAIZ, "components"))]) {
      const rel = path.relative(RAIZ, arq);
      if (PERMITIDO.has(rel)) continue;
      fs.readFileSync(arq, "utf8").split("\n").forEach((linha, i) => {
        const t = linha.trim();
        if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return; // comentário
        if (NATIVO.test(linha)) achados.push(`${rel}:${i + 1}`);
      });
    }
    expect(achados).toEqual([]);
  });

  it("a trava enxerga o que deve: reconhece as formas de escrever o campo nativo", () => {
    for (const exemplo of ['<input type="date" />', "<Input type='time' />", '<input type={"datetime-local"} />', 'tipo: { type: "month" }']) expect(NATIVO.test(exemplo)).toBe(true);
    for (const ok of ['<input type="text" inputMode="numeric" />', 'type="datetime"', 'const tipo = "date"']) expect(NATIVO.test(ok)).toBe(false);
  });
});
