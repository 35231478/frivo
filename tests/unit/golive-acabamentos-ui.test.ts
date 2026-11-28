// @vitest-environment happy-dom
/**
 * ACABAMENTOS DO GO-LIVE (leva 3) — as telas:
 *  a) a pílula do orçamento vencido diz "Vencido";
 *  b) a satisfação na lista e na ficha vem do aceite; as estrelas digitadas à mão sumiram;
 *  c) o sino mostra "Avaliações baixas do cliente" com o link para a OS;
 *  d) o "Renovar" do PMOC só aparece para quem cria PMOC;
 *  e) "Licitações" não aparece mais no cadastro de perfis;
 *  f) a trilha do topo mostra o nome do registro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ pathname: "/dashboard", sp: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname, useSearchParams: () => nav.sp,
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<typeof import("@/components/ui/avisos")>()), toast: () => {} }));

let root: Root | null = null; let caixa: HTMLDivElement;
let respostas: Record<string, unknown> = {};
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(el); }); await esperar();
}
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/[\s ]+/g, " ").trim();
const $ = (sel: string) => caixa.querySelector(sel) as HTMLElement | null;
beforeEach(() => {
  nav.pathname = "/dashboard"; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(respostas[url] ?? (String(url).startsWith("/api/cadastros") ? [] : {})), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; vi.unstubAllGlobals(); });

const comPermissoes = async (permissoes: Permissoes, filho: any, role = "OPERADOR") => {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  return createElement(PermissoesProvider, { role, permissoes, children: filho } as any);
};

/* ───────── a) ───────── */

describe("a) orçamento vencido", () => {
  it("a pílula diz Vencido (na lista e na tela)", async () => {
    const { PilulaEtapa } = await import("@/components/orcamento/ciclo-orcamento");
    for (const compacta of [true, false]) {
      const html = renderToStaticMarkup(createElement(PilulaEtapa, { etapa: "EXPIRADO", desde: "2026-11-20T00:00:00Z", compacta }));
      expect(html).toContain(">Vencido<");
      expect(html).not.toMatch(/Expirad/);
    }
  });
});

/* ───────── b) ───────── */

describe("b) satisfação do aceite", () => {
  it("célula: estrela, média e quantidade; sem nota, \"—\"", async () => {
    const { SatisfacaoCelula } = await import("@/components/clientes/satisfacao-cliente");
    await montar(createElement("div", null,
      createElement(SatisfacaoCelula, { resumo: { media: 4.8, avaliacoes: 4 } }),
      createElement(SatisfacaoCelula, { resumo: { media: null, avaliacoes: 0 } })));
    const [com, sem] = [...caixa.querySelectorAll("[data-satisfacao]")];
    expect([...com.querySelectorAll("span")].map(txt)).toEqual(["4,8", "(4)"]);
    expect(com.getAttribute("title")).toBe("Média 4,8 de 5 em 4 avaliações no aceite das OS");
    expect(txt(sem)).toBe("—");
  });

  const CLIENTE: any = {
    id: "cl1", nome: "Clínica Vida Plena", tipoPessoa: "JURIDICA", cpfCnpj: "11222333000181", ativo: true, statusFinanceiro: "ADIMPLENTE",
    satisfacao: 5, unidades: [], anexos: [], contatosCliente: [], interacoes: [], _count: { contratos: 0 },
  };
  // Leva H (mudança intencional): a seção "Satisfação" da aba Relacionamento virou um sinal no cabeçalho da ficha
  // ("★ 3,7 (3)", com a origem no title) — e só aparece quando há avaliação ("só o que importa")
  for (const consulta of [true, false]) {
    it(`ficha (${consulta ? "consulta" : "edição"}): a média do aceite, sem as estrelas digitadas à mão`, async () => {
      const { ClienteForm } = await import("@/components/forms/cliente-form");
      await montar(await comPermissoes(permissoesTotais(), createElement(ClienteForm, { initialData: CLIENTE, consulta, satisfacaoAceite: { media: 3.7, avaliacoes: 3 } } as any)));
      const s = $('[data-sinal="satisfacao"]');
      if (consulta) {
        expect(txt(s)).toBe("★ 3,7 (3)");
        expect(s!.parentElement!.getAttribute("title")).toBe("Média 3,7 de 5 em 3 avaliações no aceite das OS");
      } else {
        expect(s).toBeNull(); // na edição, o cabeçalho é só cancelar/salvar
      }
      // o campo manual (5 estrelas gravadas) não aparece nem é editável
      expect(caixa.querySelector('button[aria-label*="estrela" i], button[aria-label*="star" i]')).toBeNull();
      expect(txt(caixa)).not.toContain("Nível de satisfação");
    });
  }

  it("ficha sem avaliação: nenhum sinal de satisfação", async () => {
    const { ClienteForm } = await import("@/components/forms/cliente-form");
    await montar(await comPermissoes(permissoesTotais(), createElement(ClienteForm, { initialData: CLIENTE, consulta: true, satisfacaoAceite: { media: null, avaliacoes: 0 } } as any)));
    expect($('[data-sinal="satisfacao"]')).toBeNull();
  });
});

/* ───────── c) e f) header: sino e trilha ───────── */

const SESSAO = (permissoes: Permissoes) => ({ user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", empresaNome: "Clima Total", role: "OPERADOR", permissoes }, expires: "2099-01-01T00:00:00Z" });
async function header(permissoes: Permissoes, extra: any = null) {
  const { Header } = await import("@/components/layout/header");
  await montar(await comPermissoes(permissoes, createElement("div", null, createElement(Header, { session: SESSAO(permissoes), avatarUrl: null } as any), extra)));
}

describe("c) sino: nota baixa do aceite", () => {
  it("aparece para quem vê OS, com o número e o link para a OS", async () => {
    respostas["/api/alertas"] = { avaliacoesBaixas: 2, avaliacaoBaixaOsId: "osRuim", aceitesConfirmados: 1, aceiteConfirmadoOsId: "osBoa", total: 3 };
    await header(montarPermissoes({ ordens: ["visualizar"] }));
    await act(async () => { (caixa.querySelector('button[title="Alertas"]') as HTMLButtonElement).click(); }); await esperar();
    const link = [...caixa.querySelectorAll("a")].find((a) => txt(a).includes("Avaliações baixas do cliente"))!;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/ordens/osRuim");
    expect(txt(link)).toContain("2");
  });

  it("zero, ou sem ver OS: não aparece", async () => {
    respostas["/api/alertas"] = { avaliacoesBaixas: 2, avaliacaoBaixaOsId: "osRuim", total: 2 };
    await header(montarPermissoes({ financeiro: ["visualizar"] }));
    await act(async () => { (caixa.querySelector('button[title="Alertas"]') as HTMLButtonElement).click(); }); await esperar();
    expect(txt(caixa)).not.toContain("Avaliações baixas");
  });
});

/** Os itens da trilha, na ordem: o link da empresa, os links do caminho e o item atual */
const itensDaTrilha = () => [...caixa.querySelectorAll("header nav > a, header nav > span > a, header nav > span > span.font-semibold")].map(txt);

describe("f) trilha do topo: o nome do registro", () => {
  const ID = "cmx0clienteaaaaaaaaaaaaa1";
  it("a página informa o nome e a trilha troca \"Detalhes\" por ele", async () => {
    nav.pathname = `/clientes/${ID}/editar`;
    const { NomeNaTrilha } = await import("@/components/layout/nome-na-trilha");
    await header(permissoesTotais(), createElement(NomeNaTrilha, { id: ID, nome: "Clínica Vida Plena" }));
    expect(itensDaTrilha()).toEqual(["Clima Total", "Clientes", "Clínica Vida Plena", "Editar"]);
    expect([...caixa.querySelectorAll("header nav a")].map((a) => a.getAttribute("href"))).toContain(`/clientes/${ID}`);
  });

  it("o nome que chega DEPOIS (outra parte da página) redesenha a trilha sozinho", async () => {
    const ID2 = "cmx0chegadepoisaaaaaaaaa2";
    nav.pathname = `/ordens/${ID2}`;
    await header(permissoesTotais());
    expect(itensDaTrilha()).toEqual(["Clima Total", "Ordens de serviço", "Detalhes"]);
    // a página monta o nome numa árvore separada: só a assinatura do header pode atualizá-lo
    const { NomeNaTrilha } = await import("@/components/layout/nome-na-trilha");
    const outra = document.createElement("div"); document.body.appendChild(outra);
    const raiz2 = createRoot(outra);
    await act(async () => { raiz2.render(createElement(NomeNaTrilha, { id: ID2, nome: "OS-2024-0001" })); }); await esperar();
    expect(itensDaTrilha()).toEqual(["Clima Total", "Ordens de serviço", "OS-2024-0001"]);
    await act(async () => raiz2.unmount()); outra.remove();
  });

  it("sem nome informado: \"Detalhes\"", async () => {
    nav.pathname = "/orcamentos/cmx0semnomeaaaaaaaaaaaaa9";
    await header(permissoesTotais());
    expect(itensDaTrilha()).toEqual(["Clima Total", "Orçamentos", "Detalhes"]);
  });
});

/* ───────── d) ───────── */

describe("d) PMOC: Renovar só para quem cria PMOC", () => {
  it("editar sem criar: sem o botão; criar: com o botão", async () => {
    const { PmocRenovar } = await import("@/components/pmoc/pmoc-renovar");
    await montar(await comPermissoes(montarPermissoes({ pmoc: ["visualizar", "editar"] }), createElement(PmocRenovar, { pmocId: "p1" })));
    expect($("[data-renovar]")).toBeNull();
    await act(async () => root?.unmount()); caixa.remove();
    await montar(await comPermissoes(montarPermissoes({ pmoc: ["visualizar", "criar"] }), createElement(PmocRenovar, { pmocId: "p1" })));
    expect(txt($("[data-renovar]"))).toBe("Renovar");
  });
});

/* ───────── e) ───────── */

describe("e) cadastro de perfis sem Licitações", () => {
  it("o editor não oferece o módulo — nem ao abrir um perfil antigo que tinha a chave", async () => {
    const { EditorPerfil } = await import("@/components/cadastros/editores/editor-perfil");
    const antigo = { id: "p1", nome: "Financeiro", tipo: "FINANCEIRO", cor: "#A16207", descricao: "", permissoes: { ...montarPermissoes({ financeiro: ["visualizar"] }), licitacoes: { visualizar: true, gerenciar: true } } };
    await montar(createElement(EditorPerfil, { item: antigo, aberto: true, onFechar: () => {}, onSalvo: () => {} } as any));
    expect(document.body.textContent).not.toContain("Licitações");
    expect(document.body.textContent).toContain("Financeiro");
  });
});
