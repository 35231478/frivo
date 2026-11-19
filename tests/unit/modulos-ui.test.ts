// @vitest-environment happy-dom
/**
 * Loja de Módulos — PR 1, as telas num DOM de verdade:
 *  - o MENU: com o módulo ligado, os itens de Frota e de Compras estão lá; desligado, SOMEM —
 *    mesmo para quem tem todas as permissões, porque a empresa é que não tem o módulo;
 *  - desligar um não leva o outro, e nada do núcleo (OS, clientes, calendário) se mexe;
 *  - a tela "Sem permissão" fala de módulo desligado quando foi a rota que barrou, com o caminho
 *    da solução — e continua a de sempre quando foi a permissão;
 *  - o controle em Configurações › Módulos: o estado, a auditoria, o pedido que vai ao servidor,
 *    a confirmação antes de desligar (com o aviso da dependência) e o "só leitura" de quem não
 *    administra a empresa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModulosProvider } from "@/components/providers/modulos-provider";
import { ModulosClient, type ModuloLinha } from "@/components/config/modulos-client";
import { Sidebar } from "@/components/layout/sidebar";
import { permissoesTotais, montarPermissoes, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
/** A confirmação da casa: o teste decide a resposta e guarda o que foi perguntado. */
const perguntas: any[] = [];
const resposta = { sim: true };
const avisos: string[] = [];
vi.mock("@/components/ui/avisos", () => ({
  confirmar: async (o: any) => { perguntas.push(o); return resposta.sim; },
  toast: (m: string) => { avisos.push(m); },
}));

let caixa: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  raiz = createRoot(caixa);
  perguntas.length = 0;
  avisos.length = 0;
  resposta.sim = true;
  refresh.mockClear();
});
afterEach(() => {
  act(() => raiz.unmount());
  caixa.remove();
  vi.unstubAllGlobals();
});

const render = (no: any) => act(() => { raiz.render(no); });
const texto = () => caixa.textContent ?? "";
const hrefs = () => [...caixa.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!);

/* ═════════════════ o menu ═════════════════ */

describe("O menu some junto com o módulo", () => {
  const sessao = (permissoes: Permissoes = permissoesTotais(), role = "ADMIN") =>
    ({ user: { id: "u1", name: "Gabi", email: "g@x.com", empresaId: "e1", role, permissoes, perfilNome: "Gestor", empresaNome: "Clima Total" } }) as any;

  const botoes = () => [...caixa.querySelectorAll("button")] as HTMLButtonElement[];
  const porRotulo = (rotulo: string) => botoes().find((b) => b.textContent?.trim() === rotulo);
  /** Os grupos do menu são um acordeão (um aberto por vez): abre um a um e junta tudo. */
  const grupos = () => botoes().filter((b) => b.hasAttribute("aria-expanded") && !b.hasAttribute("aria-haspopup"));

  /** TODOS os endereços alcançáveis no menu: nas duas vistas (Operacional e Financeiro), com cada grupo aberto. */
  const todosOsItens = (desligados: string[], permissoes?: Permissoes, role = "ADMIN") => {
    render(createElement(ModulosProvider as any, { desligados },
      createElement(Sidebar as any, { session: sessao(permissoes, role), variant: "desktop" })));
    const achados = new Set<string>();
    for (const vista of ["Operacional", "Financeiro"]) {
      const bv = porRotulo(vista);
      if (bv) act(() => { bv.click(); });
      hrefs().forEach((h) => achados.add(h));
      for (let i = 0; i < grupos().length; i++) {
        const g = grupos()[i];
        act(() => { g.click(); });
        hrefs().forEach((h) => achados.add(h));
      }
    }
    return [...achados];
  };
  const tem = (itens: string[], prefixo: string) => itens.some((h) => h === prefixo || h.startsWith(prefixo + "/"));

  it("tudo ligado (o estado de hoje): Frota e Compras no menu, como sempre", () => {
    const itens = todosOsItens([]);
    expect(tem(itens, "/veiculos")).toBe(true);
    expect(tem(itens, "/compras")).toBe(true);
    expect(itens).toContain("/configuracoes/checklists-veiculo");
  });

  it("Frota desligada: os itens dela somem (inclusive o checklist, que mora em /configuracoes)", () => {
    const itens = todosOsItens(["veiculos"]);
    expect(tem(itens, "/veiculos")).toBe(false);
    expect(itens).not.toContain("/configuracoes/checklists-veiculo");
    // e o resto fica: Compras, o núcleo e o próprio Configurações
    expect(tem(itens, "/compras")).toBe(true);
    expect(tem(itens, "/ordens")).toBe(true);
    expect(itens).toContain("/configuracoes");
  });

  it("Compras desligado: \"Pedidos de compra\" sai das DUAS vistas onde aparecia; o Estoque fica", () => {
    const itens = todosOsItens(["compras"]);
    expect(tem(itens, "/compras")).toBe(false);
    expect(tem(itens, "/estoque")).toBe(true);
    expect(tem(itens, "/financeiro")).toBe(true);
    expect(tem(itens, "/veiculos")).toBe(true);
  });

  it("os dois desligados: nenhum dos dois no menu, e o núcleo intacto", () => {
    const itens = todosOsItens(["veiculos", "compras"]);
    expect(tem(itens, "/veiculos")).toBe(false);
    expect(tem(itens, "/compras")).toBe(false);
    for (const nucleo of ["/ordens", "/clientes", "/calendario", "/dashboard"]) {
      expect(tem(itens, nucleo), nucleo).toBe(true);
    }
  });

  it("nem o administrador master vê o item de um módulo que a EMPRESA desligou", () => {
    expect(tem(todosOsItens(["veiculos"], permissoesTotais()), "/veiculos")).toBe(false);
  });

  it("para quem já não via por permissão, nada muda — o gate não abre nem fecha portas do RBAC", () => {
    const so = montarPermissoes({ ordens: ["visualizar"], clientes: ["visualizar"] });
    const antes = todosOsItens([], so, "OPERADOR");
    const depois = todosOsItens(["veiculos", "compras"], so, "OPERADOR");
    expect(tem(antes, "/veiculos")).toBe(false);
    expect(depois.sort()).toEqual(antes.sort());
    expect(tem(depois, "/ordens")).toBe(true);
  });
});

/* ═════════════════ Configurações › Módulos ═════════════════ */

describe("Configurações › Módulos — o controle mínimo do piloto", () => {
  const LINHAS: ModuloLinha[] = [
    { id: "veiculos", nome: "Frota", descricao: "Veículos da empresa, com checklist de saída e retorno.", icone: "Truck", dependeDe: [], ativo: true, alteradoEm: null, alteradoPor: null },
    { id: "compras", nome: "Compras", descricao: "Pedidos de compra ao fornecedor e a entrada do material comprado.", icone: "ShoppingCart", dependeDe: ["estoque"], ativo: false, alteradoEm: "2026-11-10T12:00:00.000Z", alteradoPor: "Gabi Gestora" },
  ];
  const pedidos: { url: string; corpo: any }[] = [];
  const responder = (porMetodo: Record<string, any>) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      const corpo = init?.body ? JSON.parse(init.body) : null;
      pedidos.push({ url, corpo });
      const d = porMetodo[init?.method ?? "GET"] ?? {};
      return { ok: d.ok !== false, json: async () => d.json ?? {} } as any;
    }));
  };
  beforeEach(() => { pedidos.length = 0; });

  const tela = (podeEditar = true) => render(createElement(ModulosClient, { inicial: LINHAS, podeEditar }));
  const cartao = (id: string) => caixa.querySelector(`[data-modulo="${id}"]`)!;
  const botao = (id: string) => cartao(id).querySelector("button") as HTMLButtonElement | null;

  it("mostra os dois do piloto com o estado certo e a auditoria de quem mexeu", () => {
    tela();
    expect(cartao("veiculos").getAttribute("data-ativo")).toBe("sim");
    expect(cartao("compras").getAttribute("data-ativo")).toBe("nao");
    expect(texto()).toContain("Frota");
    expect(texto()).toContain("Gabi Gestora"); // a auditoria do que foi desligado
    expect(texto()).toContain("10/11/2026");
  });

  it("desligar pergunta antes, com o aviso da dependência, e só então chama o servidor", async () => {
    responder({
      POST: { json: { arrastados: ["compras"], aviso: "Compras depende deste módulo e será desligado junto. Nada é apagado: religando, tudo volta como estava." } },
      PUT: { json: { modulos: LINHAS.map((m) => (m.id === "veiculos" ? { ...m, ativo: false } : m)), arrastados: [], aviso: "" } },
    });
    tela();
    await act(async () => { botao("veiculos")!.click(); });

    // 1º a prévia (POST), depois a pergunta, e só então a mudança (PUT)
    expect(pedidos.map((p) => p.corpo)).toEqual([{ modulo: "veiculos", ativo: false }, { modulo: "veiculos", ativo: false }]);
    expect(perguntas).toHaveLength(1);
    expect(perguntas[0].titulo).toBe("Desligar Frota?");
    expect(perguntas[0].mensagem).toContain("Compras depende deste módulo");
    expect(perguntas[0].mensagem).toContain("Nada é apagado");
    expect(cartao("veiculos").getAttribute("data-ativo")).toBe("nao");
    expect(avisos.join(" ")).toContain("Frota desligado");
    expect(refresh).toHaveBeenCalled(); // o menu é do servidor: precisa recarregar para sumir na hora
  });

  it("quem desiste na confirmação não muda nada: nenhum PUT, nenhum estado trocado", async () => {
    resposta.sim = false;
    responder({ POST: { json: { arrastados: [], aviso: "" } } });
    tela();
    await act(async () => { botao("veiculos")!.click(); });
    expect(pedidos.map((p) => p.corpo)).toEqual([{ modulo: "veiculos", ativo: false }]); // só a prévia
    expect(cartao("veiculos").getAttribute("data-ativo")).toBe("sim");
    expect(avisos).toEqual([]);
  });

  it("LIGAR não pergunta nada — e o servidor que recusa (dependência) aparece como aviso de erro", async () => {
    responder({ PUT: { ok: false, json: { erro: "Para ligar Compras, ligue antes: Estoque." } } });
    tela();
    await act(async () => { botao("compras")!.click(); });
    expect(perguntas).toEqual([]);
    expect(pedidos.map((p) => p.corpo)).toEqual([{ modulo: "compras", ativo: true }]);
    expect(avisos.join(" ")).toContain("ligue antes: Estoque");
    expect(cartao("compras").getAttribute("data-ativo")).toBe("nao"); // não mentiu na tela
  });

  it("quem não administra a empresa só lê: nenhum botão de ligar/desligar", () => {
    tela(false);
    expect(botao("veiculos")).toBeNull();
    expect(botao("compras")).toBeNull();
    expect(texto()).toContain("Frota"); // mas continua vendo o que a empresa usa
  });
});

/* ═════════════════ a tela de barreira ═════════════════ */

describe("A tela que explica a porta fechada", () => {
  it("fala de módulo desligado (não de permissão) e aponta o caminho — e a de permissão continua a de sempre", async () => {
    const { default: SemPermissao } = await import("@/app/(dashboard)/sem-permissao/page");

    const comModulo: any = await (SemPermissao as any)({ searchParams: Promise.resolve({ modulo: "veiculos" }) });
    render(comModulo);
    expect(texto()).toContain("Frota");
    expect(texto()).toContain("desligado");
    expect(texto()).not.toContain("Sem permissão");
    expect(hrefs()).toContain("/configuracoes?aba=conta&secao=modulos");

    act(() => raiz.unmount());
    caixa.remove();
    caixa = document.createElement("div");
    document.body.appendChild(caixa);
    raiz = createRoot(caixa);

    const semNada: any = await (SemPermissao as any)({ searchParams: Promise.resolve({}) });
    render(semNada);
    expect(texto()).toContain("Sem permissão");
    expect(texto()).not.toContain("desligado");
  });
});
