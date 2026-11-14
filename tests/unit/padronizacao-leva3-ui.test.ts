// @vitest-environment happy-dom
/**
 * PADRONIZAÇÃO — LEVA 3: as telas pequenas de Configurações montadas de verdade (DOM real, API simulada).
 *
 * PRIORIDADE Nº 1 — botão que grava, exclui ou inativa só aparece para quem pode:
 *  - quem só VISUALIZA as Configurações abre cada tela para leitura: sem Novo, Salvar, Excluir, Inativar,
 *    Testar, Gerar webhook nem Aplicar; campos travados; e o aviso "Somente leitura: requer a permissão…";
 *  - quem gerencia vê os botões;
 *  - se o servidor recusa (403), a TELA NÃO MUDA e a pessoa fica sabendo — o checklist de veículo não
 *    "desativa" mais na tela sozinho, e a logo não some sem o servidor confirmar.
 *
 * PADRÃO: lista (TabelaPro + cartões no celular + busca + estado vazio) em formulários, checklists de
 * veículo e padronização; toast em toda gravação; instrução no ⓘ (não em parágrafo); aviso de segurança
 * continua VISÍVEL; "tipo de OS" do formulário com cadastro inline e edição no contexto.
 *
 * (Numeração, Orçamentos e propostas e Impressão da OS têm o teste próprio de cada tela.)
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});
// Mapa e autocompletar de endereço (dados da empresa) não fazem parte do que se testa aqui
vi.mock("@/components/ui/mapa-endereco", () => ({ MapaEndereco: () => null }));
vi.mock("@/hooks/use-auto-geocode", () => ({ useAutoGeocode: () => {} }));

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

/** Gerencia as Configurações */
const GERENCIA = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
/** Só vê as Configurações e a Frota */
const SO_VE = montarPermissoes({ configuracoes: ["visualizar"], veiculos: ["visualizar"] });
/** Gerencia a Frota, e não as Configurações */
const FROTA = montarPermissoes({ veiculos: ["visualizar", "gerenciar"] });
const SOMENTE_LEITURA = "Somente leitura: requer a permissão Configurações › gerenciar.";

let root: Root, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as T | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
/** Botões pelo texto visível (o ícone não conta) */
const botoes = (t: string, dentro: ParentNode = document) => [...dentro.querySelectorAll("button")].filter((b) => txt(b) === t);
const botao = (t: string, dentro: ParentNode = document) => botoes(t, dentro).at(-1) ?? null;
async function digitar(el: Element | null | undefined, v: string) {
  expect(el, "campo a preencher").toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(el: ReactElement, permissoes: Permissoes) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { Avisos } = await import("@/components/ui/avisos");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [createElement("div", { key: "tela" }, el), createElement(Avisos, { key: "avisos" })] })); });
  await esperar();
}
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => [c[0], c[1] ?? "sucesso"]);
/** O que foi para as rotas da tela (a tabela também lê e grava a preferência de colunas do usuário) */
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));
const gaveta = () => $$('[role="dialog"]').filter((d) => !d.hasAttribute("data-confirmacao")).at(-1) ?? null;
const confirmacao = () => $("[data-confirmacao]");
/** O texto do ⓘ ao lado de um rótulo */
const dica = (rotulo: string, dentro: ParentNode = document) => {
  const b = $(`[data-dica][aria-label="Ajuda: ${rotulo}"]`, dentro);
  return b ? txt(document.getElementById(b.getAttribute("aria-describedby") ?? "")) : null;
};
const somenteLeitura = (dentro: ParentNode = document) => $$("[data-somente-leitura]", dentro).map(txt);

beforeAll(async () => {
  // Um de cada vez, com os avisos primeiro: importar em paralelo cria duas cópias do módulo simulado e
  // o teste passaria a ler um `toast` que não é o da tela
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/providers/permissoes-provider"), () => import("@/components/config/telas/formularios"), () => import("@/components/config/checklist-templates-client"),
    () => import("@/components/config/padronizacao-client"), () => import("@/components/config/email-config-client"), () => import("@/components/config/email-templates-client"),
    () => import("@/components/config/qr-config-client"), () => import("@/components/config/inter-config-client"), () => import("@/components/forms/configuracoes-client"),
  ]) await m();
}, 120_000);
beforeEach(async () => {
  chamadas.length = 0; respostas = {}; nav.refresh.mockClear();
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    // rota exata (sem a query): "/api/formularios/f1/vinculos" não é "/api/formularios"
    const chave = Object.keys(respostas).find((k) => { const [m, u] = k.split(" "); return m === metodo && url.split("?")[0] === u; });
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

/* ═════════ Formulários (checklist de OS) ═════════ */
describe("Formulários", () => {
  const F1 = { id: "f1", nome: "Checklist de instalação", descricao: "Ao fim da instalação", tipoOsId: "t1", tipoOs: { id: "t1", nome: "Instalação", cor: "#22c55e" }, campos: [{ id: "c1", label: "Dreno testado", tipo: "SIM_NAO", obrigatorio: true, ordem: 1 }, { id: "c2", label: "Foto", tipo: "FOTO", obrigatorio: false, ordem: 2 }] };
  const F2 = { id: "f2", nome: "Vistoria de entrega", descricao: "", tipoOsId: null, tipoOs: null, campos: [{ id: "c3", label: "Ambiente limpo", tipo: "SIM_NAO", obrigatorio: true, ordem: 1 }] };
  async function abrir(permissoes: Permissoes, lista: unknown[] = [F1, F2]) {
    const { TelaFormularios } = await import("@/components/config/telas/formularios");
    respostas["GET /api/formularios"] = { status: 200, corpo: lista };
    respostas["GET /api/tipos-os"] = { status: 200, corpo: [{ id: "t1", nome: "Instalação", cor: "#22c55e", ativo: true }] };
    await montar(createElement(TelaFormularios), permissoes);
  }
  const linhas = () => $$("[data-formulario]").map((l) => l.getAttribute("data-formulario"));

  it("quem só visualiza: vê a lista, sem 'Novo formulário' nem 'Inativar'; a gaveta abre travada, sem Salvar", async () => {
    await abrir(SO_VE);
    expect(linhas()).toEqual(["f1", "f2"]);
    expect($("[data-novo-formulario]")).toBeNull();
    expect($$("[data-inativar-formulario]")).toEqual([]);
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
    // abrir é "Ver", não "Editar"
    expect($$("[data-formulario] [data-abrir-formulario]").map((b) => b.getAttribute("aria-label"))).toEqual(["Ver Checklist de instalação", "Ver Vistoria de entrega"]);
    await clicar($("[data-formulario='f1'] [data-abrir-formulario]"));
    const g = gaveta()!;
    expect($<HTMLFieldSetElement>("[data-form-formulario] fieldset", g)!.disabled).toBe(true);
    expect(($("[data-nome-formulario]", g) as HTMLInputElement).value).toBe("Checklist de instalação");
    expect($("[data-salvar-formulario]", g)).toBeNull();
    expect($("[data-adicionar-campo]", g)).toBeNull();
    expect(botao("Fechar", g)).not.toBeNull();
    expect(gravacoes()).toEqual([]);
  });

  it("quem gerencia: Novo, Editar e Inativar à vista; criar manda o POST, avisa (toast) e a linha entra na lista", async () => {
    await abrir(GERENCIA);
    expect($("[data-novo-formulario]")).not.toBeNull();
    expect($$("[data-inativar-formulario]")).toHaveLength(4); // tabela + cartões do celular
    expect(somenteLeitura()).toEqual([]);
    expect($$("[data-formulario] [data-abrir-formulario]").map((b) => b.getAttribute("aria-label"))).toEqual(["Editar Checklist de instalação", "Editar Vistoria de entrega"]);
    await clicar($("[data-novo-formulario]"));
    const g = gaveta()!;
    expect(txt(g.querySelector("h2, h3"))).toBe("Novo formulário");
    // sem nome: fica na gaveta com o aviso, nada é enviado
    await clicar($("[data-salvar-formulario]", g));
    expect(txt($("[data-erro-formulario]", g))).toBe("Informe o nome do formulário.");
    expect(gravacoes()).toEqual([]);
    await digitar($("[data-nome-formulario]", g), "Aceite do cliente");
    await digitar($("[data-campo-formulario] input", g), "Cliente presente");
    respostas["POST /api/formularios"] = { status: 201, corpo: { id: "f3", nome: "Aceite do cliente", descricao: "", tipoOsId: null, tipoOs: null, campos: [{ id: "c9", label: "Cliente presente", tipo: "TEXTO_CURTO", obrigatorio: false, ordem: 1 }] } };
    await clicar($("[data-salvar-formulario]", g));
    expect(gravacoes()).toEqual([{ url: "/api/formularios", metodo: "POST", corpo: { nome: "Aceite do cliente", descricao: "", tipoOsId: null, campos: [{ label: "Cliente presente", tipo: "TEXTO_CURTO", obrigatorio: false, ordem: 1 }] } }]);
    expect(await toasts()).toEqual([["Formulário criado.", "sucesso"]]);
    // a gaveta fecha (fica só o tempo da animação de saída)
    expect(gaveta()?.className ?? "translate-x-full").toContain("translate-x-full");
    expect(linhas()).toEqual(["f3", "f1", "f2"]); // em ordem alfabética
  });

  it("recusa do servidor ao salvar: o motivo aparece na gaveta, sem toast, e a lista não muda", async () => {
    await abrir(GERENCIA);
    await clicar($("[data-formulario='f2'] [data-abrir-formulario]"));
    respostas["PUT /api/formularios/f2"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar($("[data-salvar-formulario]", gaveta()!));
    expect(txt($("[data-erro-formulario]", gaveta()!))).toBe("Sem permissão para esta ação");
    expect(await toasts()).toEqual([]);
    expect(linhas()).toEqual(["f1", "f2"]);
  });

  it("Inativar: mostra o impacto (onde é usado) antes; confirmado, manda o DELETE, avisa e a linha sai", async () => {
    await abrir(GERENCIA);
    respostas["GET /api/formularios/f1/vinculos"] = { status: 200, corpo: [{ id: "v1" }, { id: "v2" }] };
    await clicar($("[data-formulario='f1'] [data-inativar-formulario]"));
    expect(txt($("h3", confirmacao()!))).toBe('Inativar o formulário "Checklist de instalação"?');
    expect(txt($("p", confirmacao()!))).toBe("Em uso em 2 combinações de equipamento e tipo de OS. Ele deixa de aparecer nas próximas OS; as respostas já dadas continuam no histórico.");
    // cancelar: nada vai para o servidor
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    expect(linhas()).toEqual(["f1", "f2"]);
    await clicar($("[data-formulario='f1'] [data-inativar-formulario]"));
    expect(txt($("[data-confirmar-sim]"))).toBe("Inativar");
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: "/api/formularios/f1", metodo: "DELETE", corpo: null }]);
    expect(await toasts()).toEqual([["Formulário inativado.", "sucesso"]]);
    expect(linhas()).toEqual(["f2"]);
  });

  it("Inativar recusado pelo servidor: a linha CONTINUA na lista e o motivo vira aviso", async () => {
    await abrir(GERENCIA);
    respostas["DELETE /api/formularios/f2"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar($("[data-formulario='f2'] [data-inativar-formulario]"));
    expect(txt($("p", confirmacao()!))).toContain("Não está vinculado a nenhum equipamento.");
    await clicar($("[data-confirmar-sim]"));
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(linhas()).toEqual(["f1", "f2"]);
  });

  it("padrão de lista: tabela no desktop, cartões no celular, busca e estado vazio; a explicação fica no ⓘ", async () => {
    await abrir(GERENCIA);
    expect($("[data-tabela-pro='config-formularios']")).not.toBeNull();
    expect($$("[data-cartoes] [data-cartao]").map((c) => c.getAttribute("data-cartao"))).toEqual(["f1", "f2"]);
    expect(txt($("[data-total-formularios]"))).toBe("2 formulários");
    expect(dica("Formulários")).toContain("Inativar tira o formulário das próximas OS");
    // nada de parágrafo de instrução solto na tela
    expect($$("[data-formularios] > p").filter((p) => !p.hasAttribute("data-somente-leitura"))).toEqual([]);
    await digitar($("[data-formularios] input[type='search'], [data-formularios] input[placeholder='Pesquisar formulário']"), "vistoria");
    expect(linhas()).toEqual(["f2"]);
    expect(txt($("[data-total-formularios]"))).toBe("1 formulário");
    await digitar($("[data-formularios] input[placeholder='Pesquisar formulário']"), "zzz");
    expect(linhas()).toEqual([]);
    expect(txt($("[data-lista-vazia]"))).toContain("Nenhum formulário encontrado");
  });

  it("sem nenhum formulário: estado vazio próprio (e o botão de criar para quem gerencia)", async () => {
    await abrir(GERENCIA, []);
    expect(txt($("[data-lista-vazia]"))).toContain("Nenhum formulário cadastrado");
    expect($("[data-novo-formulario]")).not.toBeNull();
  });

  it("'Tipo de OS vinculado' é o seletor com cadastro inline e edição no contexto (referência), não um select solto", () => {
    const src = fonte("components/config/telas/formularios.tsx");
    expect(src).toContain("<SelectCadastroRapido");
    expect(src).toContain("entidade={TIPO_OS.entidade}");
    expect(src).toContain("criar={async (v) => {");
    expect(src).toContain("edicao={TIPO_OS.edicao(tiposOs,");
    expect(src).toContain('<TelaCadastroApoio titulo="Formulários"');
    expect(src).not.toMatch(/<table\b/);
  });
});

/* ═════════ Checklists de veículo ═════════ */
describe("Checklists de veículo", () => {
  const C1 = { id: "ck1", nome: "Checklist diário", descricao: "", frequencia: "DIARIO", ativo: true, itens: [{ id: "i1", categoria: "Motor", descricao: "Nível do óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true }], _count: { itens: 1, preenchidos: 12 } };
  const C2 = { id: "ck2", nome: "Checklist semanal", descricao: "", frequencia: "SEMANAL", ativo: true, itens: [], _count: { itens: 0, preenchidos: 0 } };
  async function abrir(permissoes: Permissoes) {
    const { ChecklistTemplatesClient } = await import("@/components/config/checklist-templates-client");
    respostas["GET /api/checklist-templates"] = { status: 200, corpo: [C1, C2] };
    await montar(createElement(ChecklistTemplatesClient), permissoes);
  }
  const linhas = () => $$("[data-modelo]").map((l) => l.getAttribute("data-modelo"));

  it("quem só visualiza: sem 'Novo modelo' nem 'Inativar'; a gaveta abre travada e sem Salvar", async () => {
    await abrir(SO_VE);
    expect(linhas()).toEqual(["ck1", "ck2"]);
    expect($("[data-novo-modelo]")).toBeNull();
    expect($$("[data-inativar-modelo]")).toEqual([]);
    expect(somenteLeitura()).toEqual(["Somente leitura: requer a permissão Configurações › gerenciar ou Frota › gerenciar."]);
    await clicar($("[data-modelo='ck1'] [data-abrir-modelo]"));
    expect($<HTMLFieldSetElement>("[data-form-modelo] fieldset", gaveta()!)!.disabled).toBe(true);
    expect($("[data-salvar-modelo]", gaveta()!)).toBeNull();
    expect($("[data-adicionar-item]", gaveta()!)).toBeNull();
  });

  it("Frota › gerenciar sozinha já libera os botões (a rota aceita Configurações OU Frota)", async () => {
    await abrir(FROTA);
    expect($("[data-novo-modelo]")).not.toBeNull();
    expect($$("[data-modelo] [data-inativar-modelo]")).toHaveLength(2);
    expect(somenteLeitura()).toEqual([]);
  });

  it("Inativar RECUSADO pelo servidor: o modelo continua na lista (antes sumia da tela mesmo com 403)", async () => {
    await abrir(GERENCIA);
    respostas["DELETE /api/checklist-templates/ck1"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar($("[data-modelo='ck1'] [data-inativar-modelo]"));
    expect(txt($("p", confirmacao()!))).toBe("Já foi preenchido 12 vezes. Ele deixa de aparecer para os próximos preenchimentos; os já feitos continuam no histórico.");
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: "/api/checklist-templates/ck1", metodo: "DELETE", corpo: null }]);
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(linhas()).toEqual(["ck1", "ck2"]);
  });

  it("Inativar aceito: avisa (toast) e o modelo sai da lista", async () => {
    await abrir(GERENCIA);
    await clicar($("[data-modelo='ck2'] [data-inativar-modelo]"));
    expect(txt($("p", confirmacao()!))).toContain("Ainda não foi preenchido.");
    await clicar($("[data-confirmar-sim]"));
    expect(await toasts()).toEqual([["Modelo de checklist inativado.", "sucesso"]]);
    expect(linhas()).toEqual(["ck1"]);
  });

  it("criar: valida na gaveta, manda o POST e avisa; padrão de lista com cartões e o ⓘ", async () => {
    await abrir(GERENCIA);
    expect($("[data-tabela-pro='config-checklists-veiculo']")).not.toBeNull();
    expect($$("[data-cartoes] [data-cartao]")).toHaveLength(2);
    expect(dica("Checklists de veículo")).toContain("Inativar tira o modelo dos próximos preenchimentos");
    await clicar($("[data-novo-modelo]"));
    const g = gaveta()!;
    await clicar($("[data-salvar-modelo]", g));
    expect(txt($("[data-erro-modelo]", g))).toBe("Informe o nome do modelo.");
    await digitar($("[data-nome-modelo]", g), "Checklist mensal");
    await digitar($("[aria-label='Categoria do item 1']", g), "Pneus");
    await digitar($("[aria-label='Descrição do item 1']", g), "Calibragem");
    // a regra das opções está no ⓘ dos itens, não repetida embaixo de cada item
    expect(dica("Itens", g)).toContain("a primeira é o estado saudável");
    expect($$("[data-item-modelo] p", g)).toEqual([]);
    respostas["POST /api/checklist-templates"] = { status: 201, corpo: { id: "ck3", nome: "Checklist mensal", frequencia: "DIARIO", ativo: true, itens: [{}], _count: { itens: 1, preenchidos: 0 } } };
    await clicar($("[data-salvar-modelo]", g));
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0]).toMatchObject({ url: "/api/checklist-templates", metodo: "POST", corpo: { nome: "Checklist mensal", frequencia: "DIARIO", itens: [{ categoria: "Pneus", descricao: "Calibragem", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true, ordem: 0 }] } });
    expect(await toasts()).toEqual([["Modelo de checklist criado.", "sucesso"]]);
    expect(linhas()).toEqual(["ck1", "ck2", "ck3"]);
  });

  it("a página fica no esqueleto das telas de apoio e volta para a Frota (quem entra pode não ter Configurações)", () => {
    const src = fonte("app/(dashboard)/configuracoes/checklists-veiculo/page.tsx");
    expect(src).toContain('<TelaCadastroApoio titulo="Checklists de veículo"');
    expect(src).toContain('voltar="/veiculos"');
  });
});

/* ═════════ Padronização de digitação ═════════ */
describe("Padronização de digitação", () => {
  const PLANO = {
    totalCampos: 3, totalRegistros: 2, amostraLimitada: false,
    porEntidade: [{ entidade: "cliente", rotulo: "Clientes", registros: 2, campos: 3 }],
    amostra: [{ rotulo: "Cliente", campo: "Nome", de: "HOSPITAL SANTA CLARA", para: "Hospital Santa Clara" }, { rotulo: "Cliente", campo: "E-mail", de: "ADM@X.COM", para: "adm@x.com" }],
  };
  async function abrir(podeAplicar: boolean) {
    const { PadronizacaoClient } = await import("@/components/config/padronizacao-client");
    await montar(createElement(PadronizacaoClient, { podeAplicar }), podeAplicar ? GERENCIA : SO_VE);
  }

  it("sem a permissão: nem a prévia é oferecida (a rota recusa as duas) — só o aviso de somente leitura", async () => {
    await abrir(false);
    expect($("[data-prever]")).toBeNull();
    expect($("[data-aplicar]")).toBeNull();
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
    expect(chamadas).toEqual([]);
  });

  it("prévia no padrão de lista; aplicar pede a confirmação própria, manda o POST e avisa", async () => {
    await abrir(true);
    expect($("[data-aplicar]")).toBeNull(); // só depois da prévia com mudanças
    respostas["GET /api/configuracoes/padronizacao"] = { status: 200, corpo: PLANO };
    await clicar($("[data-prever]"));
    expect(txt($("[data-resumo-previa]"))).toContain("3 campos em 2 registros mudariam. Nada foi gravado ainda.");
    expect($("[data-tabela-pro='config-padronizacao']")).not.toBeNull();
    expect($$("[data-tabela-pro='config-padronizacao'] tbody tr")).toHaveLength(2);
    expect($$("[data-cartoes] li")).toHaveLength(2);
    expect(gravacoes()).toEqual([]);
    await clicar($("[data-aplicar]"));
    expect(txt($("h3", confirmacao()!))).toBe("Aplicar a padronização?");
    expect(txt($("p", confirmacao()!))).toBe("Grava 3 campos em 2 registros. Não dá para desfazer em lote.");
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    respostas["POST /api/configuracoes/padronizacao"] = { status: 200, corpo: { totalCampos: 3, totalRegistros: 2, porEntidade: PLANO.porEntidade } };
    await clicar($("[data-aplicar]"));
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: "/api/configuracoes/padronizacao", metodo: "POST", corpo: null }]);
    expect(await toasts()).toEqual([["Padronização aplicada: 3 campos em 2 registros.", "sucesso"]]);
    expect(txt($("[data-resultado-padronizacao]"))).toContain("Padronização aplicada: 3 campos em 2 registros.");
    expect($("[data-aplicar]")).toBeNull();
  });

  it("servidor recusa o aplicar: o motivo aparece e a prévia continua (nada foi gravado)", async () => {
    await abrir(true);
    respostas["GET /api/configuracoes/padronizacao"] = { status: 200, corpo: PLANO };
    await clicar($("[data-prever]"));
    respostas["POST /api/configuracoes/padronizacao"] = { status: 403, corpo: { erro: "Sem permissão" } };
    await clicar($("[data-aplicar]"));
    await clicar($("[data-confirmar-sim]"));
    expect(txt($("[data-erro-padronizacao]"))).toBe("Sem permissão");
    expect(await toasts()).toEqual([["Sem permissão", "erro"]]);
    expect($("[data-resultado-padronizacao]")).toBeNull();
    expect($("[data-resumo-previa]")).not.toBeNull();
  });
});

/* ═════════ E-mail transacional ═════════ */
describe("E-mail transacional", () => {
  async function abrir(permissoes: Permissoes) {
    const { EmailConfigClient } = await import("@/components/config/email-config-client");
    respostas["GET /api/email/config"] = { status: 200, corpo: { ativo: true, remetente: "contato@clima.com.br", nomeRemetente: "Clima Total", replyTo: "", temApiKey: true } };
    await montar(createElement(EmailConfigClient), permissoes);
  }

  it("quem só visualiza: sem Salvar nem Testar; campos travados; a chave da API não aparece", async () => {
    await abrir(SO_VE);
    expect($("[data-salvar-email]")).toBeNull();
    expect($("[data-testar-email]")).toBeNull();
    expect($<HTMLFieldSetElement>("[data-email-config] fieldset")!.disabled).toBe(true);
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
    expect(($("[data-email-config] input[type='password']") as HTMLInputElement).value).toBe("");
    expect(gravacoes()).toEqual([]);
  });

  it("quem gerencia: salva (PUT), avisa com toast e não reenvia a chave que não foi digitada; o passo a passo fica no ⓘ", async () => {
    await abrir(GERENCIA);
    expect($("[data-testar-email]")).not.toBeNull();
    expect(somenteLeitura()).toEqual([]);
    expect(dica("Configuração do servidor")).toContain("Em resend.com, gere uma API Key e verifique o domínio");
    expect(txt($("[data-email-config]"))).not.toContain("Como configurar");
    expect($$("[data-email-config] ol")).toEqual([]);
    await clicar($("[data-salvar-email]"));
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0]).toMatchObject({ url: "/api/email/config", metodo: "PUT", corpo: { ativo: true, remetente: "contato@clima.com.br" } });
    expect("apiKey" in gravacoes()[0].corpo).toBe(false);
    expect("temApiKey" in gravacoes()[0].corpo).toBe(false);
    expect(await toasts()).toEqual([["Configuração de e-mail salva.", "sucesso"]]);
  });

  it("recusa do servidor: o motivo fica visível na tela, sem toast de sucesso", async () => {
    await abrir(GERENCIA);
    respostas["PUT /api/email/config"] = { status: 400, corpo: { erro: "Remetente inválido" } };
    await clicar($("[data-salvar-email]"));
    expect(txt($("[data-erro-email]"))).toBe("Remetente inválido");
    expect(await toasts()).toEqual([]);
  });
});

/* ═════════ Modelos de e-mail ═════════ */
describe("Modelos de e-mail", () => {
  const T1 = { id: "et1", tipo: "ORCAMENTO_ENVIADO", nome: "Orçamento enviado", assunto: "Seu orçamento", corpo: "<p>Olá</p>", ativo: true };
  async function abrir(permissoes: Permissoes, lista: unknown[] = [T1]) {
    const { EmailTemplatesClient } = await import("@/components/config/email-templates-client");
    respostas["GET /api/email/templates"] = { status: 200, corpo: lista };
    await montar(createElement(EmailTemplatesClient), permissoes);
  }

  it("quem só visualiza: abre o modelo para VER (com a prévia), travado e sem Salvar; não carrega padrões", async () => {
    await abrir(SO_VE);
    expect($("[data-carregar-padroes]")).toBeNull();
    expect(txt($("[data-modelo-email='et1']"))).toContain("Ver");
    expect(txt($("[data-modelo-email='et1']"))).not.toContain("Editar");
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
    await clicar($("[data-modelo-email='et1']"));
    expect($<HTMLFieldSetElement>("[data-editor-modelo] fieldset")!.disabled).toBe(true);
    expect($("[data-salvar-modelo-email]")).toBeNull();
    expect($("[data-editor-modelo] iframe")!.getAttribute("title")).toBe("Prévia do e-mail");
    expect(botao("Fechar", $("[data-editor-modelo]")!)).not.toBeNull();
    expect(gravacoes()).toEqual([]);
  });

  it("sem modelo nenhum e sem a permissão: não oferece carregar (só o aviso)", async () => {
    await abrir(SO_VE, []);
    expect(txt($("[data-sem-modelos]"))).toContain("Nenhum modelo próprio: os e-mails saem com o texto padrão.");
    expect($("[data-carregar-padroes]")).toBeNull();
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
  });

  it("quem gerencia: edita e salva (toast); 'carregar modelos que faltam' diz quantos entraram", async () => {
    await abrir(GERENCIA);
    expect(txt($("[data-total-modelos-email]"))).toContain("1 modelo");
    respostas["POST /api/email/templates"] = { status: 200, corpo: [T1, { ...T1, id: "et2", tipo: "OS_ABERTA", nome: "OS aberta" }, { ...T1, id: "et3", tipo: "OS_CONCLUIDA", nome: "OS concluída" }] };
    await clicar($("[data-carregar-padroes]"));
    expect(gravacoes()).toEqual([{ url: "/api/email/templates", metodo: "POST", corpo: { restaurarPadroes: true } }]);
    expect(await toasts()).toEqual([["2 modelos padrão adicionados.", "sucesso"]]);
    chamadas.length = 0;
    expect(txt($("[data-modelo-email='et1']"))).toContain("Editar");
    await clicar($("[data-modelo-email='et1']"));
    respostas["PUT /api/email/templates/et1"] = { status: 200, corpo: { ...T1, assunto: "Seu orçamento chegou" } };
    await digitar($("[data-editor-modelo] input"), "Seu orçamento chegou");
    await clicar($("[data-salvar-modelo-email]"));
    expect(gravacoes()).toEqual([{ url: "/api/email/templates/et1", metodo: "PUT", corpo: { assunto: "Seu orçamento chegou", corpo: "<p>Olá</p>", ativo: true } }]);
    expect((await toasts()).at(-1)).toEqual(["Modelo de e-mail salvo.", "sucesso"]);
  });

  it("carregar padrões recusado: avisa o motivo e a lista fica como estava", async () => {
    await abrir(GERENCIA);
    respostas["POST /api/email/templates"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar($("[data-carregar-padroes]"));
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(txt($("[data-total-modelos-email]"))).toContain("1 modelo");
  });
});

/* ═════════ QR Code ═════════ */
describe("QR Code", () => {
  const CFG: any = {
    paginaPublicaAtiva: true, mostrarHistorico: true, mostrarProximaManutencao: true, mostrarDadosEquipamento: true, mostrarLocalizacao: false,
    botaoWhatsapp: true, botaoOrcamento: false, botaoChamado: true, whatsappNumero: "", linkSite: "", mensagemBoasVindas: "",
    chamadoSomenteLogado: false, historicoSomenteLogado: false, orcamentoSomenteLogado: false,
  };
  async function abrir(permissoes: Permissoes) {
    const { QrConfigClient } = await import("@/components/config/qr-config-client");
    await montar(createElement(QrConfigClient, { inicial: CFG }), permissoes);
  }

  it("quem só visualiza: sem Salvar, tudo travado e o aviso de somente leitura", async () => {
    await abrir(SO_VE);
    expect($("[data-salvar-qr]")).toBeNull();
    expect($<HTMLFieldSetElement>("[data-qr-config] fieldset")!.disabled).toBe(true);
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
  });

  it("quem gerencia: salva (PUT com a configuração inteira) e avisa; recusa do servidor não derruba a tela", async () => {
    await abrir(GERENCIA);
    await clicar($("[data-salvar-qr]"));
    expect(gravacoes()).toEqual([{ url: "/api/configuracoes/qr-code", metodo: "PUT", corpo: CFG }]);
    expect(await toasts()).toEqual([["Configurações do QR Code salvas.", "sucesso"]]);
    // resposta de erro que NEM é JSON com { erro }: a tela mostra o texto de reserva
    respostas["PUT /api/configuracoes/qr-code"] = { status: 500, corpo: "falhou" };
    await clicar($("[data-salvar-qr]"));
    expect(txt($("[data-erro-qr]"))).toBe("Não foi possível salvar.");
    expect(await toasts()).toHaveLength(1);
  });
});

/* ═════════ Banco Inter ═════════ */
describe("Banco Inter", () => {
  const GET = { ativo: true, ambiente: "SANDBOX", clientId: "cid", contaCorrente: "123", temClientSecret: true, temCertificado: true, temChavePrivada: true, temWebhookSecret: true };
  async function abrir(permissoes: Permissoes) {
    const { InterConfigClient } = await import("@/components/config/inter-config-client");
    respostas["GET /api/integracoes/inter"] = { status: 200, corpo: GET };
    await montar(createElement(InterConfigClient), permissoes);
  }

  it("quem só visualiza: sem Salvar, Testar nem Gerar webhook; campos travados; o aviso de sandbox continua VISÍVEL", async () => {
    await abrir(SO_VE);
    expect($("[data-salvar-inter]")).toBeNull();
    expect($("[data-testar-inter]")).toBeNull();
    expect($("[data-gerar-webhook]")).toBeNull();
    expect($<HTMLFieldSetElement>("[data-inter-config] fieldset")!.disabled).toBe(true);
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
    // aviso de segurança não vai para o tooltip
    expect(txt($("[data-aviso-sandbox]"))).toBe("Modo sandbox: boletos de teste, sem valor real");
    expect(gravacoes()).toEqual([]);
  });

  it("quem gerencia: os três botões; salvar avisa e não manda segredo que não foi digitado; o passo a passo fica no ⓘ", async () => {
    await abrir(GERENCIA);
    expect($("[data-testar-inter]")).not.toBeNull();
    expect(txt($("[data-gerar-webhook]"))).toBe("Gerar nova URL (revoga a atual)");
    expect(dica("Client ID")).toContain("Em developers.inter.co, crie uma aplicação na conta PJ");
    expect(txt($("[data-inter-config]"))).not.toContain("Como obter as credenciais");
    expect($$("[data-inter-config] ol")).toEqual([]);
    await clicar($("[data-salvar-inter]"));
    expect(gravacoes()).toEqual([{ url: "/api/integracoes/inter", metodo: "PUT", corpo: { ativo: true, ambiente: "SANDBOX", clientId: "cid", contaCorrente: "123" } }]);
    expect(await toasts()).toEqual([["Configuração do Banco Inter salva.", "sucesso"]]);
  });

  it("gerar nova URL do webhook pede confirmação (revoga a atual); recusado, nada é enviado", async () => {
    await abrir(GERENCIA);
    await clicar($("[data-gerar-webhook]"));
    expect(txt($("h3", confirmacao()!))).toBe("Gerar nova URL de webhook?");
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
  });
});

/* ═════════ Dados da empresa ═════════ */
describe("Dados da empresa", () => {
  const EMPRESA: any = {
    id: "e1", nome: "Clima Total", nomeFantasia: null, cnpj: "12345678000190", email: "e@x.com", telefone: null, celular: null, site: null, logo: "data:image/png;base64,AAAA",
    endereco: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, cep: null, latitude: null, longitude: null,
    bancoNome: null, bancoAgencia: null, bancoConta: null, bancoTipoConta: null, bancoTitular: null, pixChave: null,
    inscricaoEstadual: null, inscricaoMunicipal: null, cnaePrincipal: null, responsavelTecnicoId: null,
  };
  async function abrir(permissoes: Permissoes, parte: "empresa" | "preferencias" = "empresa") {
    const { ConfiguracoesClient } = await import("@/components/forms/configuracoes-client");
    await montar(createElement(ConfiguracoesClient, { empresa: EMPRESA, config: { issAliquota: 0 } as any, parte }), permissoes);
  }
  const logo = () => $("img[alt='Logo']");

  it("quem só visualiza: sem Salvar, sem Trocar nem Excluir a logo; campos travados", async () => {
    await abrir(SO_VE);
    expect($("[data-salvar-empresa]")).toBeNull();
    expect($("[data-acoes-logo]")).toBeNull();
    expect(logo()).not.toBeNull();
    expect($$("fieldset").every((f) => (f as HTMLFieldSetElement).disabled)).toBe(true);
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
  });

  it("quem só visualiza as Preferências: sem Salvar e travado", async () => {
    await abrir(SO_VE, "preferencias");
    expect($("[data-salvar-preferencias]")).toBeNull();
    expect($$("fieldset").every((f) => (f as HTMLFieldSetElement).disabled)).toBe(true);
    expect(somenteLeitura()).toEqual([SOMENTE_LEITURA]);
  });

  it("quem gerencia: salvar avisa com toast (sem a caixa verde na tela)", async () => {
    await abrir(GERENCIA);
    await clicar($("[data-salvar-empresa]"));
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0]).toMatchObject({ url: "/api/empresa", metodo: "PUT", corpo: { nome: "Clima Total", cnpj: "12345678000190" } });
    expect(await toasts()).toEqual([["Dados da empresa salvos.", "sucesso"]]);
    expect(document.body.querySelector(".bg-ok-claro")).toBeNull();
  });

  it("excluir a logo pede confirmação; RECUSADO pelo servidor, a logo continua na tela (antes sumia sem conferir)", async () => {
    await abrir(GERENCIA);
    await clicar(botao("Excluir", $("[data-acoes-logo]")!));
    expect(txt($("h3", confirmacao()!))).toBe("Excluir a logo?");
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    expect(logo()).not.toBeNull();
    respostas["DELETE /api/empresa/logo"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar(botao("Excluir", $("[data-acoes-logo]")!));
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: "/api/empresa/logo", metodo: "DELETE", corpo: null }]);
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(logo()).not.toBeNull();
  });

  it("excluir a logo aceito: some da tela e avisa", async () => {
    await abrir(GERENCIA);
    await clicar(botao("Excluir", $("[data-acoes-logo]")!));
    await clicar($("[data-confirmar-sim]"));
    expect(await toasts()).toEqual([["Logo excluída.", "sucesso"]]);
    expect(logo()).toBeNull();
  });
});

/* ═════════ O que vale para todas ═════════ */
describe("as telas da leva, no código", () => {
  const TELAS_CLIENTE = [
    "components/config/telas/formularios.tsx", "components/config/checklist-templates-client.tsx", "components/config/numeracao-client.tsx",
    "components/config/padronizacao-client.tsx", "components/config/email-config-client.tsx", "components/config/email-templates-client.tsx",
    "components/config/qr-config-client.tsx", "components/config/inter-config-client.tsx", "components/config/orcamento-padroes-client.tsx",
    "components/config/impressao-os-client.tsx", "components/forms/configuracoes-client.tsx",
  ];
  it.each(TELAS_CLIENTE)("%s: avisa com toast ao gravar e usa o aviso único de somente leitura", (f) => {
    const src = fonte(f);
    expect(src).toMatch(/\btoast\(/);
    expect(src).toContain("SomenteLeitura");
    // confirmação e aviso nativos do navegador não entram
    expect(src).not.toMatch(/\b(window\.)?(alert|confirm)\(/);
  });

  it("as três telas de lista usam a tabela padrão (nada de <table> própria)", () => {
    for (const f of ["components/config/telas/formularios.tsx", "components/config/numeracao-client.tsx", "components/config/padronizacao-client.tsx", "components/config/checklist-templates-client.tsx"]) {
      const src = fonte(f);
      expect(src, f).toContain("<TabelaPro");
      expect(src, f).not.toMatch(/<table\b/);
      expect(src, f).toContain("data-cartoes");
    }
  });

  it("o aviso de somente leitura segue o formato da casa: 'Módulo › ação.'", () => {
    expect(fonte("components/config/permissao-config.tsx")).toContain('permissao = "Configurações › gerenciar"');
    expect(fonte("components/config/permissao-config.tsx")).toContain("Somente leitura: requer a permissão {permissao}.");
  });
});
