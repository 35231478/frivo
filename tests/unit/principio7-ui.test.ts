// @vitest-environment happy-dom
/**
 * Princípio 7 nas telas (DOM real): texto curto na tela, explicação no ⓘ, e o que NÃO pode ir
 * para a dica continua visível.
 *  - Cadastro padrão: a ajuda vira ⓘ ao lado das abas; o erro (`aviso`) fica visível;
 *  - Interruptor com dica: o nome do switch é só o rótulo; clicar no ⓘ não liga/desliga;
 *  - Dados da empresa: explicações nos ⓘ (IE, dados bancários, RT); sem Fiscal, o aviso de
 *    "Somente leitura" continua na tela;
 *  - Preferências: ISS com a regra no ⓘ e o aviso curto visível.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-auto-geocode", () => ({ useAutoGeocode: () => {} }));

let root: Root, caixa: HTMLDivElement;
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}
/** Texto do balão de um ⓘ pelo nome acessível ("Ajuda: <rótulo>") */
const dica = (rotulo: string) => {
  const b = document.querySelector(`[data-dica][aria-label="Ajuda: ${rotulo}"]`);
  return b ? txt(document.getElementById(b.getAttribute("aria-describedby")!)) : null;
};

beforeAll(async () => {
  await import("@/components/cadastros/cadastro-padrao");
  await import("@/components/forms/configuracoes-client");
}, 60_000);
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url, "http://localhost");
    const corpo = u.searchParams.get("sugestoes") === "1" ? { sugestoes: [] }
      : { itens: [{ id: "c1", nome: "Obra Centro", ativo: true }], total: 1, pagina: 1, porPagina: 50, contagens: { ativos: 1, inativos: 0, todos: 1 } };
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("cadastro padrão", () => {
  it("a ajuda sai da tela e vai para o ⓘ ao lado das abas; o aviso (erro) fica visível", async () => {
    const { CadastroPadrao } = await import("@/components/cadastros/cadastro-padrao");
    await montar(createElement(CadastroPadrao, {
      entidade: "centros-custo", ajuda: "Alocação das despesas por obra.",
      aviso: createElement("p", { role: "alert" }, "Não foi possível salvar."),
    }));
    expect(dica("Sobre centros de custo")).toBe("Alocação das despesas por obra.");
    expect(txt(caixa)).not.toContain("Alocação das despesas");
    expect(txt(caixa.querySelector('[role="alert"]'))).toBe("Não foi possível salvar.");
    // o ⓘ fica junto das abas (mesma linha), não num parágrafo solto
    const b = caixa.querySelector('[data-dica][aria-label="Ajuda: Sobre centros de custo"]')!;
    expect(b.closest("div")!.parentElement!.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("sem ajuda, nenhum ⓘ nas abas", async () => {
    const { CadastroPadrao } = await import("@/components/cadastros/cadastro-padrao");
    await montar(createElement(CadastroPadrao, { entidade: "centros-custo" }));
    expect(caixa.querySelector('[data-dica][aria-label^="Ajuda: Sobre"]')).toBeNull();
  });
});

describe("interruptor com dica", () => {
  it("o switch se chama só pelo rótulo; clicar no ⓘ não liga; clicar no rótulo liga", async () => {
    const { ToggleSwitch } = await import("@/components/ui/toggle-switch");
    let ligado = false;
    const onChange = vi.fn((v: boolean) => { ligado = v; });
    await montar(createElement(ToggleSwitch, { label: "Exigir foto para concluir OS", dica: "A OS só é concluída com foto.", checked: ligado, onChange }));
    const sw = caixa.querySelector('[role="switch"]')!;
    const rotulo = document.getElementById(sw.getAttribute("aria-labelledby")!)!;
    expect(txt(rotulo)).toBe("Exigir foto para concluir OS");
    expect(dica("Exigir foto para concluir OS")).toBe("A OS só é concluída com foto.");
    expect(caixa.textContent).not.toContain("A OS só é concluída");
    await act(async () => { (caixa.querySelector("[data-dica]") as HTMLElement).click(); });
    expect(onChange).not.toHaveBeenCalled();
    expect(caixa.querySelector("label")!.htmlFor).toBe(sw.id);
    await act(async () => { (sw as HTMLElement).click(); });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("ToggleGroup: a explicação do grupo vai para o ⓘ do título", async () => {
    const { ToggleGroup } = await import("@/components/ui/toggle-switch");
    await montar(createElement(ToggleGroup, { title: "Notificações", dica: "Mensagens automáticas ao cliente.", children: null }));
    expect(dica("Notificações")).toBe("Mensagens automáticas ao cliente.");
    expect(txt(caixa)).toBe("Notificações");
  });
});

describe("Configurações › Dados da empresa e Preferências", () => {
  const EMPRESA: any = {
    id: "e1", nome: "Clima Total Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "a@b.com", logo: null,
    telefone: null, celular: null, site: null, endereco: "Av. Paulista", numero: "1000", complemento: null, bairro: null, cidade: "São Paulo",
    estado: "SP", cep: null, latitude: null, longitude: null, bancoNome: null, bancoAgencia: null, bancoConta: null, bancoTipoConta: null,
    bancoTitular: null, pixChave: null, inscricaoEstadual: null, inscricaoMunicipal: null, cnaePrincipal: "4322302", responsavelTecnicoId: null,
  };
  const CONFIG: any = { issAliquota: 2 };

  it("explicações nos ⓘ; os títulos em caixa de frase; nenhum parágrafo de orientação solto", async () => {
    const { ConfiguracoesClient } = await import("@/components/forms/configuracoes-client");
    await montar(createElement(ConfiguracoesClient, { empresa: EMPRESA, config: CONFIG, parte: "empresa" }));
    expect(txt(caixa.querySelector("h2"))).toBe("Dados da empresa");
    expect(dica("Inscrição estadual")).toBe("Impressa no cabeçalho do orçamento. Em branco, não é exibida. Informe “Isento” quando for o caso.");
    expect(dica("Dados bancários")).toBe("Exibidos no orçamento enviado ao cliente (link e impressão). Campos em branco não são exibidos.");
    expect(dica("Responsável técnico")).toContain("ART emitida após aprovação");
    expect(dica("Endereço")).toBe("Usado no cálculo da distância até os clientes e na busca do município da NFS-e.");
    for (const longo of ["Saem no orçamento", "Usado para calcular distância", "O orçamento novo já vem", "Sai no cabeçalho"]) expect(txt(caixa)).not.toContain(longo);
  });

  it("sem Financeiro › Fiscal: 'Somente leitura' continua VISÍVEL sob o CNAE (estado não vai para a dica)", async () => {
    const { ConfiguracoesClient } = await import("@/components/forms/configuracoes-client");
    await montar(createElement(ConfiguracoesClient, { empresa: EMPRESA, config: CONFIG, parte: "empresa" }), montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }));
    expect(txt(caixa)).toContain("Somente leitura: requer a permissão Financeiro › Fiscal.");
    expect(dica("CNAE principal")).toBe("Usado na NFS-e dos serviços que não têm CNAE próprio. Formato: 0000-0/00.");
  });

  it("Preferências: ISS com o aviso curto visível e a regra no ⓘ; toggles explicados nos ⓘ", async () => {
    const { ConfiguracoesClient } = await import("@/components/forms/configuracoes-client");
    await montar(createElement(ConfiguracoesClient, { empresa: EMPRESA, config: CONFIG, parte: "preferencias" }));
    expect(txt(caixa.querySelector("h2"))).toBe("Preferências");
    expect(txt(caixa)).toContain("Vale para os orçamentos criados a partir de agora.");
    expect(dica("Alíquota de ISS sobre serviços (%)")).toContain("No orçamento, aparece em linha própria; no documento do cliente, embutida nos preços.");
    expect(dica("Exigir foto para concluir OS")).toBe("A OS só é concluída com ao menos uma foto anexada pelo técnico.");
    expect(dica("Notificações")).toContain("abertura e na conclusão");
    expect(txt(caixa)).not.toContain("Defina quais campos devem ser preenchidos");
  });
});
