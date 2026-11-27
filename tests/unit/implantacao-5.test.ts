// @vitest-environment happy-dom
/**
 * Implantação, leva 5 — lote + desfazer: as regras puras e a tela (DOM real).
 *  - situação do lote (ativo, desfeito, desfeito em parte, só atualizou) e o resumo das contagens;
 *  - ordem de apagar (filhos antes dos pais), ponto fixo (quem fica segura quem depende dele);
 *  - quem pode desfazer cada cadastro e o motivo de "sem permissão" (a permissão que falta de verdade);
 *  - tela: a lista de importações (quem, quando, arquivo, contagens, situação) e o diálogo — prévia com o que
 *    será apagado, o que fica (com o motivo), o que só foi atualizado, e o confirmar só quando há o que apagar.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, pode } from "@/lib/permissoes";
import {
  CADASTROS_DO_LOTE, motivoVinculo, nomeVinculo, ordemDeApagar, podeDesfazerCadastro, pontoFixo, resumoContagens,
  ROTULO_SITUACAO, semPermissao, situacaoDoLote,
} from "@/lib/importacao/lotes-regras";
import type { LoteLista, PreviaDesfazer } from "@/lib/importacao/lotes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => {}, replace: () => {} }), usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams() }));

const L = (o: Partial<LoteLista> = {}): LoteLista => ({
  id: "l1", entidade: "clientes", arquivo: "clientes-ficticios.xlsx", criadoEm: "2026-11-20T13:05:00.000Z", quem: "Ana (fictícia)",
  criados: 3, atualizados: 1, comErro: 0, avisos: 2, desfeitoEm: null, desfeitoPor: null, apagados: 0, pendentes: 3, ...o,
});

/* ═════════════ Regras puras ═════════════ */
describe("situação e contagens do lote", () => {
  it("ativo, desfeito, desfeito em parte e só atualizou", () => {
    expect(situacaoDoLote(L())).toBe("ativo");
    expect(situacaoDoLote(L({ desfeitoEm: "2026-11-21T10:00:00Z", pendentes: 0, apagados: 3 }))).toBe("desfeito");
    expect(situacaoDoLote(L({ desfeitoEm: "2026-11-21T10:00:00Z", pendentes: 1, apagados: 2 }))).toBe("parcial");
    // Não criou nada: só lista, mesmo que "desfeito" (estoque, reimportação)
    expect(situacaoDoLote(L({ criados: 0, pendentes: 0 }))).toBe("so-atualizou");
    expect(situacaoDoLote(L({ criados: 0, pendentes: 0, desfeitoEm: "2026-11-21T10:00:00Z" }))).toBe("so-atualizou");
    expect(ROTULO_SITUACAO).toEqual({ ativo: "", desfeito: "Desfeita", parcial: "Desfeita em parte", "so-atualizou": "Só atualizou" });
  });

  it("resumo: singular e plural, zero não aparece, tudo zero = nada gravado", () => {
    expect(resumoContagens({ criados: 3, atualizados: 1, comErro: 2, avisos: 4 })).toBe("3 criados · 1 atualizado · 2 com erro · 4 avisos");
    expect(resumoContagens({ criados: 1, atualizados: 2, comErro: 0, avisos: 1 })).toBe("1 criado · 2 atualizados · 1 aviso");
    expect(resumoContagens({ criados: 0, atualizados: 0, comErro: 5, avisos: 0 })).toBe("5 com erro");
    expect(resumoContagens({ criados: 0, atualizados: 0, comErro: 0, avisos: 0 })).toBe("nada gravado");
  });
});

describe("ordem de apagar e ponto fixo", () => {
  it("filhos antes dos pais; no mesmo nível, a ordem em que vieram; desconhecido por último", () => {
    const xs = [{ entidade: "clientes", n: 1 }, { entidade: "x", n: 2 }, { entidade: "unidades", n: 3 }, { entidade: "equipamentos", n: 4 }, { entidade: "contatos", n: 5 }, { entidade: "cargos", n: 6 }];
    expect(ordemDeApagar(xs).map((x) => x.n)).toEqual([4, 3, 5, 1, 6, 2]);
    expect(xs[0].n).toBe(1); // não mexe no original
  });

  it("quem fica segura quem depende dele (volta a volta) e para quando nada muda", async () => {
    // a unidade U tem OS → fica; então o cliente C (que tem U) fica; o cliente D sai
    const chamadas: string[][] = [];
    const r = await pontoFixo(["unidades:U", "clientes:C", "clientes:D"], async (rest) => {
      chamadas.push([...rest].sort());
      const m = new Map<string, string[]>([["unidades:U", ["ordens de serviço: 1"]], ["clientes:D", []]]);
      if (!rest.has("unidades:U")) m.set("clientes:C", ["unidades: 1"]);
      return m;
    });
    expect([...r.apagar]).toEqual(["clientes:D"]);
    expect(Object.fromEntries(r.ficam)).toEqual({ "unidades:U": ["ordens de serviço: 1"], "clientes:C": ["unidades: 1"] });
    expect(chamadas).toEqual([["clientes:C", "clientes:D", "unidades:U"], ["clientes:C", "clientes:D"], ["clientes:D"]]);
  });

  it("limite de voltas", async () => {
    let n = 0;
    const r = await pontoFixo(["a", "b", "c"], async (rest) => { n++; const [p] = [...rest]; return new Map([[p, ["x"]]]); }, 2);
    expect(n).toBe(2);
    expect([...r.apagar]).toEqual(["c"]);
  });

  it("motivo do vínculo: nome conhecido, campo desconhecido em palavras, 1-1 sem número", () => {
    expect(motivoVinculo("ordensServico", 2)).toBe("ordens de serviço: 2");
    expect(motivoVinculo("qrcode", null)).toBe("QR Code");
    expect(nomeVinculo("registrosDeAlgo")).toBe("registros de algo");
  });
});

describe("quem pode desfazer cada cadastro", () => {
  const sem = (o: Record<string, string[]>) => (m: string, a: any) => pode(montarPermissoes(o as any), m, a);
  it("excluir do próprio cadastro; unidades e contatos pedem Clientes › Excluir; tipos e cargos, Configurações › Gerenciar", () => {
    expect(podeDesfazerCadastro("clientes", sem({ clientes: ["excluir"] }))).toBe(true);
    expect(podeDesfazerCadastro("unidades", sem({ clientes: ["excluir"] }))).toBe(true);
    expect(podeDesfazerCadastro("contatos", sem({ clientes: ["editar"] }))).toBe(false);
    expect(podeDesfazerCadastro("colaboradores", sem({ equipes: ["excluir"] }))).toBe(true);
    expect(podeDesfazerCadastro("equipamentos", sem({ clientes: ["excluir"] }))).toBe(false);
    expect(podeDesfazerCadastro("cargos", sem({ configuracoes: ["gerenciar"] }))).toBe(true);
    expect(podeDesfazerCadastro("tiposEquipamento", sem({ configuracoes: ["visualizar"] }))).toBe(false);
    expect(podeDesfazerCadastro("desconhecido", () => true)).toBe(false);
    // Produtos, serviços e fornecedores não têm "excluir": a mesma permissão de inativar
    expect(CADASTROS_DO_LOTE.produtos.permissao!.length).toBeGreaterThan(0);
    expect(podeDesfazerCadastro("produtos", (m, a) => CADASTROS_DO_LOTE.produtos.permissao!.some(([mm, aa]) => mm === m && aa === a))).toBe(true);
    expect(podeDesfazerCadastro("produtos", sem({ clientes: ["excluir"] }))).toBe(false);
  });

  it("o motivo diz a permissão que falta de verdade", () => {
    expect(semPermissao("clientes")).toBe("você não tem permissão para excluir clientes");
    expect(semPermissao("unidades")).toBe("você não tem permissão para excluir clientes");
    expect(semPermissao("contatos")).toBe("você não tem permissão para excluir clientes");
    expect(semPermissao("colaboradores")).toBe("você não tem permissão para excluir colaboradores");
    expect(semPermissao("produtos")).toBe("você não tem permissão para inativar produtos");
    expect(semPermissao("cargos")).toBe("você não tem permissão para gerenciar as configurações");
    expect(semPermissao("outra")).toBe("você não tem permissão para excluir outra");
  });

  it("toda relação de uso dos cadastros do lote tem nome no motivo (relação nova no schema precisa de nome aqui)", async () => {
    const { relacoesDeUso } = await import("@/lib/importacao/lotes");
    const { NOMES_VINCULO } = await import("@/lib/importacao/lotes-regras");
    const sem = Object.values(CADASTROS_DO_LOTE).flatMap((c) => relacoesDeUso(c.model).relacoes.filter((r) => !NOMES_VINCULO[r.campo]).map((r) => `${c.model}.${r.campo}`));
    expect(sem).toEqual([]);
  });

  it("todo cadastro que uma planilha cria tem regra de desfazer (o estoque só atualiza produtos)", async () => {
    const { IMPORTACOES } = await import("@/lib/importacao/entidades");
    const { ENTIDADE_DO_ITEM } = await import("@/lib/importacao/servidor");
    for (const e of Object.keys(IMPORTACOES)) expect(CADASTROS_DO_LOTE[(ENTIDADE_DO_ITEM as Record<string, string>)[e] ?? e], e).toBeDefined();
  });
});

/* ═════════════ Tela ═════════════ */
let root: Root | null = null;
let caixa: HTMLDivElement;
let PProv: any, MProv: any, ImportacoesLotes: any, Avisos: any;
beforeAll(async () => {
  ({ PermissoesProvider: PProv } = await import("@/components/providers/permissoes-provider"));
  ({ ModulosProvider: MProv } = await import("@/components/providers/modulos-provider"));
  ({ ImportacoesLotes } = await import("@/components/implantacao/importacoes-lotes"));
  ({ Avisos } = await import("@/components/ui/avisos"));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; refresh.mockClear(); });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
const espera = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function render(lotes: LoteLista[]) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => {
    root!.render(createElement(MProv, { desligados: [] }, createElement(PProv, { permissoes: permissoesTotais(), role: "OPERADOR" },
      createElement("div", null, createElement(ImportacoesLotes, { lotes }), createElement(Avisos)))));
  });
}
const clicar = async (s: string) => { await act(async () => { ($(s) as HTMLButtonElement).click(); }); await espera(); };

const PREVIA: PreviaDesfazer = {
  lote: { id: "l1", entidade: "clientes", arquivo: "clientes-ficticios.xlsx", criadoEm: "2026-11-20T13:05:00.000Z", criados: 3, atualizados: 1, desfeitoEm: null },
  apagar: [
    { entidade: "unidades", id: "u1", rotulo: "Principal — Clínica Alfa (fictícia)", linha: null },
    { entidade: "clientes", id: "c1", rotulo: "Clínica Alfa (fictícia)", linha: 2 },
  ],
  ficam: [{ entidade: "clientes", id: "c2", rotulo: "Mercado Beta (fictício)", linha: 3, motivos: ["ordens de serviço: 2", "orçamentos: 1"] }],
  atualizados: [{ entidade: "clientes", id: "c3", rotulo: "Escola Gama (fictícia)", linha: 4 }],
  naoExistem: [],
};

describe("tela: importações na Implantação", () => {
  it("vazia: diz que não há importações", async () => {
    await render([]);
    expect($("[data-lotes]")!.dataset.lotes).toBe("0");
    expect($("[data-lotes-vazio]")!.textContent).toBe("Nenhuma importação ainda.");
  });

  it("cada lote: planilha, arquivo, quem, contagens e situação; o botão conforme a situação", async () => {
    await render([
      L(),
      L({ id: "l2", entidade: "equipamentos", arquivo: "eq.csv", quem: null, criados: 2, atualizados: 0, avisos: 0, desfeitoEm: "2026-11-21T10:00:00Z", desfeitoPor: "Bruno (fictício)", apagados: 1, pendentes: 1 }),
      L({ id: "l3", entidade: "estoque", arquivo: "saldo.csv", criados: 0, atualizados: 4, avisos: 0, pendentes: 0 }),
      L({ id: "l4", desfeitoEm: "2026-11-22T10:00:00Z", apagados: 3, pendentes: 0 }),
    ]);
    const linha = (id: string) => $(`[data-lote='${id}']`)!;
    expect(linha("l1").dataset.loteSituacao).toBe("ativo");
    expect(linha("l1").textContent).toContain("Clientes");
    expect(linha("l1").textContent).toContain("clientes-ficticios.xlsx");
    expect(linha("l1").textContent).toContain("Ana (fictícia)");
    expect(linha("l1").textContent).toContain("3 criados · 1 atualizado · 2 avisos");
    expect(linha("l1").textContent).toMatch(/Desfazer…/);
    expect(linha("l2").dataset.loteSituacao).toBe("parcial");
    expect(linha("l2").textContent).toContain("Desfeita em parte");
    expect(linha("l2").textContent).toContain("usuário removido");
    expect(linha("l2").textContent).toMatch(/desfeita .* por Bruno \(fictício\) \(1 apagado\)/);
    expect(linha("l2").textContent).toMatch(/Desfazer…/);
    expect(linha("l3").textContent).toContain("Só atualizou");
    expect(linha("l3").textContent).toContain("Ver detalhes");
    expect(linha("l4").textContent).toContain("Desfeita");
    expect(linha("l4").textContent).toContain("Ver detalhes");
    expect(linha("l1").textContent).not.toContain("Desfeita");
  });

  it("desfazer: prévia (apaga / fica com motivo / só atualizou) e confirma → toast e recarrega", async () => {
    const pedidos: { url: string; metodo: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      pedidos.push({ url: u, metodo: init?.method ?? "GET" });
      if (init?.method === "POST") return new Response(JSON.stringify({ ok: true, apagados: 2, ficam: PREVIA.ficam, atualizados: 1 }), { status: 200 });
      return new Response(JSON.stringify(PREVIA), { status: 200 });
    }));
    await render([L()]);
    await clicar("[data-lote='l1'] [data-acao='ver-lote']");
    expect(pedidos).toEqual([{ url: "/api/importacao/lotes/l1", metodo: "GET" }]);
    const dlg = $("[role='dialog']")!;
    expect(dlg.textContent).toContain("Importação de clientes");
    expect($("[data-grupo='apagar']")!.dataset.n).toBe("2");
    expect($("[data-grupo='apagar']")!.textContent).toContain("Será apagado (2)");
    expect($("[data-grupo='apagar']")!.textContent).toContain("1 unidade");
    expect($("[data-grupo='apagar'] [data-item-lote='Clínica Alfa (fictícia)']")!.textContent).toContain("linha 2");
    expect($("[data-grupo='apagar'] [data-item-lote='Principal — Clínica Alfa (fictícia)']")!.textContent).toContain("criado pela importação");
    expect($("[data-grupo='ficam'] [data-item-lote='Mercado Beta (fictício)']")!.textContent).toContain("ordens de serviço: 2; orçamentos: 1");
    expect($("[data-grupo='atualizados']")!.textContent).toMatch(/Só atualizado por esta importação \(não é desfeito\) \(1\)/);
    expect($("[data-grupo='nao-existem']")).toBeNull();
    expect($("[data-previa-nota]")).toBeNull();
    expect($("[data-acao='confirmar-desfazer']")!.textContent).toBe("Apagar 2 registros");
    await clicar("[data-acao='confirmar-desfazer']");
    expect(pedidos[1]).toEqual({ url: "/api/importacao/lotes/l1/desfazer", metodo: "POST" });
    expect(document.body.textContent).toContain("2 registros apagados · 1 ficaram");
    expect($("[role='dialog']")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("nada para apagar (estoque): a nota explica, só lista o atualizado e não há botão de apagar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...PREVIA, lote: { ...PREVIA.lote, entidade: "estoque" }, apagar: [], ficam: [], naoExistem: [{ entidade: "clientes", id: "x", rotulo: "Já foi (fictício)", linha: 5 }],
      nota: "Os lançamentos de estoque nunca são apagados.",
    }), { status: 200 })));
    await render([L({ entidade: "estoque", criados: 0, pendentes: 0 })]);
    await clicar("[data-acao='ver-lote']");
    expect($("[data-previa-nota]")!.textContent).toContain("nunca são apagados");
    expect($("[data-grupo='apagar']")!.textContent).toContain("Nada para apagar.");
    expect($("[data-grupo='ficam']")).toBeNull();
    expect($("[data-grupo='nao-existem']")!.textContent).toContain("Já foi (fictício)");
    expect($("[data-acao='confirmar-desfazer']")).toBeNull();
    expect($$("[role='dialog'] button").map((b) => b.textContent)).toContain("Fechar");
  });

  it("erro no desfazer (algo mudou no meio): mostra a mensagem, o diálogo fica e nada recarrega", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ erro: "O registro Clínica Alfa (fictícia) mudou durante o desfazer. Tente de novo." }), { status: 409 })
      : new Response(JSON.stringify(PREVIA), { status: 200 })));
    await render([L()]);
    await clicar("[data-acao='ver-lote']");
    await clicar("[data-acao='confirmar-desfazer']");
    expect($("[role='dialog'] [role='alert']")!.textContent).toBe("O registro Clínica Alfa (fictícia) mudou durante o desfazer. Tente de novo.");
    expect($("[role='dialog']")).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("erro ao carregar a prévia: mostra o erro e nenhum botão de apagar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ erro: "Importação não encontrada." }), { status: 404 })));
    await render([L()]);
    await clicar("[data-acao='ver-lote']");
    expect($("[role='dialog'] [role='alert']")!.textContent).toBe("Importação não encontrada.");
    expect($("[data-acao='confirmar-desfazer']")).toBeNull();
  });
});
