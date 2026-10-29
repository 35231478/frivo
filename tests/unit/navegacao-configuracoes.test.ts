/**
 * Configurações numa página só: 3 abas com cartões; cada cartão abre a tela COMPLETA do item numa
 * gaveta (?aba=…&secao=…). O menu lateral tem só "Configurações" (sem submenu) e todas as rotas
 * antigas continuam levando ao lugar certo (redirecionam para a gaveta do item).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESETS, montarPermissoes, permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import {
  ITENS_CONFIGURACOES, SECOES_CONFIGURACOES, hrefAbaConfig, hrefSecaoConfig, itemConfig, secoesVisiveis,
} from "@/lib/navegacao/configuracoes";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next-auth/react", () => ({ signOut: () => {} }));
const rota = vi.hoisted(() => ({ atual: "/dashboard" }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => rota.atual, useSearchParams: () => new URLSearchParams(),
}));
const logar = (permissoes: Permissoes = permissoesTotais(), role = "OPERADOR") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role, permissoes } };
};
beforeEach(() => logar());

const raiz = path.join(__dirname, "../../app/(dashboard)");
const arquivoDaRota = (href: string) => path.join(raiz, href.split("#")[0], "page.tsx");
const cartoes = SECOES_CONFIGURACOES.flatMap((s) => s.subgrupos.flatMap((g) => g.itens));

/** Os itens que Configurações já tinha (nenhum pode sumir) */
const ANTES = [
  "/configuracoes/tipos-os", "/configuracoes/tipos-equipamento", "/configuracoes/formularios", "/configuracoes/servicos",
  "/configuracoes/produtos", "/configuracoes/tabelas-preco", "/configuracoes/termos", "/configuracoes/prazos",
  "/configuracoes/financeiro/categorias", "/configuracoes/perfis", "/configuracoes/usuarios",
  "/configuracoes/cargos", "/configuracoes/email", "/configuracoes/portal", "/configuracoes/qr-code",
  "/configuracoes/impressao-os", "/configuracoes/financeiro/centros-custo",
];

/** O redirect do Next lança um erro com o destino no digest */
async function destinoDoRedirect(href: string) {
  const mod = await import(/* @vite-ignore */ arquivoDaRota(href));
  try { await mod.default(); } catch (e: any) {
    const partes = String(e?.digest ?? "").split(";");
    if (partes[0] === "NEXT_REDIRECT") return partes[2];
    throw e;
  }
  return null;
}

describe("estrutura: 3 abas com cartões; cada item tem id, tela e a rota antiga", () => {
  it("abas Operacionais, Financeiras e Conta, com os subgrupos", () => {
    expect(SECOES_CONFIGURACOES.map((s) => s.curto)).toEqual(["Operacionais", "Financeiras", "Conta"]);
    const sub = (id: string) => SECOES_CONFIGURACOES.find((s) => s.id === id)!.subgrupos.map((g) => [g.titulo, g.itens.map((i) => i.label)]);
    expect(sub("operacionais")).toEqual([
      ["Ordens de serviço", ["Tipos de OS", "Formulários", "Termos de referência", "Modelos de prazo", "Impressão da OS"]],
      ["Comercial", ["Orçamentos e propostas"]],
      ["Catálogo", ["Tipos de equipamento", "Serviços", "Produtos", "Tabelas de preços"]],
    ]);
    expect(sub("financeiras")).toEqual([["Classificação", ["Categorias financeiras", "Centros de custo"]], ["Integrações", ["Banco Inter"]], ["Fiscal", ["Dados fiscais (NFS-e)"]]]);
    expect(sub("conta")).toEqual([
      ["Empresa", ["Dados da empresa", "Preferências"]],
      ["Acesso e pessoas", ["Usuários", "Perfis de acesso", "Cargos"]],
      ["Integrações", ["E-mail transacional", "Portal do cliente", "QR Code"]],
    ]);
  });

  it("nenhum item de antes sumiu; ids únicos; cada um tem a tela completa para a gaveta", async () => {
    const { temTelaConfig } = await import("@/components/config/telas");
    for (const h of ANTES) expect(cartoes.some((i) => i.href === h), h).toBe(true);
    const ids = ITENS_CONFIGURACOES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(temTelaConfig(id), id).toBe(true);
    expect(itemConfig("email-templates")).toMatchObject({ aba: "conta", label: "Templates de e-mail" }); // sem cartão: abre pelo link do E-mail
  }, 60_000);

  it("deeplinks: a aba e a gaveta do item ficam na URL", () => {
    expect(hrefAbaConfig("financeiras")).toBe("/configuracoes?aba=financeiras");
    expect(hrefSecaoConfig("tipos-os")).toBe("/configuracoes?aba=operacionais&secao=tipos-os");
    expect(hrefSecaoConfig("usuarios")).toBe("/configuracoes?aba=conta&secao=usuarios");
    expect(hrefSecaoConfig("nao-existe")).toBe("/configuracoes");
  });
});

describe("links antigos continuam levando ao lugar certo", () => {
  it("cada rota antiga de item abre a mesma tela na gaveta", async () => {
    const rotas = ITENS_CONFIGURACOES.filter((i) => i.href !== "/configuracoes");
    for (const i of rotas) {
      expect(existsSync(arquivoDaRota(i.href)), i.href).toBe(true);
      expect(await destinoDoRedirect(i.href), i.href).toBe(hrefSecaoConfig(i.id));
    }
  }, 60_000);

  it("rotas antigas das abas e o antigo 'Formulários por tipo'", async () => {
    expect(await destinoDoRedirect("/configuracoes/operacionais")).toBe("/configuracoes?aba=operacionais");
    expect(await destinoDoRedirect("/configuracoes/financeiras")).toBe("/configuracoes?aba=financeiras");
    expect(await destinoDoRedirect("/configuracoes/conta")).toBe("/configuracoes?aba=conta");
    expect(await destinoDoRedirect("/configuracoes/formularios-por-tipo")).toBe(hrefSecaoConfig("tipos-equipamento"));
  });

  it("nenhuma rota antiga ficou com tela própria (só redireciona — a tela mora em components/config/telas)", () => {
    for (const i of ITENS_CONFIGURACOES.filter((x) => x.href !== "/configuracoes")) {
      const src = readFileSync(arquivoDaRota(i.href), "utf8");
      expect(src, i.href).toContain(`redirect(hrefSecaoConfig("${i.id}"))`);
    }
  });
});

describe("página /configuracoes: aba, gaveta e permissão conferida no servidor", () => {
  const pagina = async (q: Record<string, string>) => {
    const { default: P } = await import("@/app/(dashboard)/configuracoes/page");
    return (await P({ searchParams: Promise.resolve(q) })) as any;
  };

  it("sem nada na URL: só os cartões (sem gaveta)", async () => {
    const el = await pagina({});
    expect(el.props).toMatchObject({ abaInicial: null, secaoAberta: null, secaoNegada: null });
    expect(el.props.children).toBeNull();
    expect(el.props.visiveis).toEqual(ITENS_CONFIGURACOES.map((i) => i.id));
  }, 60_000);

  it("?secao=… abre a tela daquele item na gaveta, na aba dele (refresh reabre)", async () => {
    const el = await pagina({ aba: "conta", secao: "tipos-os" });
    expect(el.props).toMatchObject({ abaInicial: "operacionais", secaoAberta: "tipos-os", secaoNegada: null });
    expect(isValidElement(el.props.children)).toBe(true);
    expect(el.props.children.props).toEqual({ id: "tipos-os" });
  });

  it("?aba=… só escolhe a aba; aba inválida cai na primeira", async () => {
    expect((await pagina({ aba: "financeiras" })).props.abaInicial).toBe("financeiras");
    expect((await pagina({ aba: "xyz" })).props.abaInicial).toBeNull();
  });

  it("item que o perfil não pode ver (ou que não existe) NÃO monta a tela e avisa", async () => {
    logar(montarPermissoes({ ordens: ["visualizar"] }));
    const el = await pagina({ secao: "usuarios" });
    expect(el.props).toMatchObject({ secaoAberta: null, secaoNegada: "usuarios", visiveis: [] });
    expect(el.props.children).toBeNull();
    logar();
    expect((await pagina({ secao: "inventado" })).props).toMatchObject({ secaoAberta: null, secaoNegada: "inventado" });
  });
});

describe("permissão (quem não pode não vê o item nem a aba)", () => {
  it("administrador vê as 3 abas completas", () => {
    expect(secoesVisiveis(permissoesTotais(), "ADMIN").map((s) => s.id)).toEqual(["operacionais", "financeiras", "conta"]);
  });
  it("sem 'Configurações › visualizar' (ex.: técnico) não vê nenhuma", () => {
    expect(secoesVisiveis(PRESETS.TECNICO, "TECNICO")).toEqual([]);
    expect(secoesVisiveis(montarPermissoes({ financeiro: ["visualizar"] }))).toEqual([]);
  });
  it("com 'Configurações › visualizar' vê as 3 (mesma regra das rotas de antes)", () => {
    expect(secoesVisiveis(montarPermissoes({ configuracoes: ["visualizar"] })).map((x) => x.id)).toEqual(["operacionais", "financeiras", "conta"]);
  });
});

describe("menu lateral: Configurações é um item único, sem submenu", () => {
  const menu = async (permissoes: Permissoes, role = "OPERADOR", pathname = "/dashboard") => {
    rota.atual = pathname;
    const { Sidebar } = await import("@/components/layout/sidebar");
    return renderToStaticMarkup(createElement(Sidebar, { session: { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role, permissoes } } as any }));
  };
  const links = (h: string) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

  it("um link só para /configuracoes no rodapé; nenhum dos itens antigos no menu (nem dentro de Configurações)", async () => {
    for (const p of ["/dashboard", "/configuracoes", "/configuracoes/tipos-os"]) {
      const h = await menu(permissoesTotais(), "ADMIN", p);
      const config = links(h).filter((l) => l.startsWith("/configuracoes"));
      // Rodapé + atalho do menu do usuário apontam para a mesma página; os checklists da frota são do grupo Frota
      expect(config.filter((l) => l === "/configuracoes").length, p).toBeGreaterThanOrEqual(1);
      expect(config.filter((l) => l !== "/configuracoes" && l !== "/configuracoes/checklists-veiculo"), p).toEqual([]);
      expect(h, p).not.toContain("Visão geral");
      expect(h, p).not.toContain("Tabelas de preços");
    }
  });

  it("em Configurações o item fica ativo e o menu continua no módulo (sem trocar para outro 'mundo')", async () => {
    const h = await menu(permissoesTotais(), "ADMIN", "/configuracoes");
    expect(h).toMatch(/aria-current="page"[^>]*data-acao="rodape-configuracoes"|data-acao="rodape-configuracoes"[^>]*aria-current="page"/);
    expect(h).toContain(">Dashboard<"); // o menu do módulo continua (não vira um menu de configurações)
  });

  it("quem não pode ver nenhuma configuração não vê o item", async () => {
    const h = await menu({ ...permissoesVazias(), ordens: { visualizar: true } });
    expect(h).not.toContain('data-acao="rodape-configuracoes"');
    expect(links(h)).not.toContain("/configuracoes");
  });
});
