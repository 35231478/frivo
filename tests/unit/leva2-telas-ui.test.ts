// @vitest-environment happy-dom
/**
 * LEVA 2 — as telas (as regras estão em leva2-regras.test.ts):
 *  1. Central da OS: o layout decide pela largura DISPONÍVEL (container query), não pela da tela;
 *  2. Estoque: o selo e o saldo de quem está sem estoque;
 *  3. Clientes: Segmento e Satisfação fora do padrão da lista (continuam em "Colunas");
 *  4. Ficha do cliente: abre em consulta (cadastro como texto) com "Editar" como ação;
 *  5. Histórico da OS: resumo agrupado, registros sob demanda e o registro completo de auditoria;
 *  6. Gráfico do financeiro: um eixo, legenda, detalhe do mês por toque, tabela.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { ocultasEfetivas, PREFERENCIA_VAZIA } from "@/lib/preferencias";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const RAIZ = path.resolve(__dirname, "../..");
const fonte = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");

const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: vi.fn() }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<typeof import("@/components/ui/avisos")>()), toast: () => {} }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp, usePathname: () => "/",
  useRouter: () => ({ push: nav.push, replace: () => {}, refresh: () => {}, back: () => {} }),
}));

let root: Root | null = null; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = (sel: string) => caixa.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/[\s ]+/g, " ").trim();async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(el); }); await flush();
}
beforeEach(() => {
  nav.sp = new URLSearchParams(); nav.push.mockClear();
  globalThis.fetch = vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; });

/* ───────────────────────── 1. central da OS ───────────────────────── */

describe("1. central da OS: o layout pela largura disponível", () => {
  it("o painel de Atividades só vai para o lado com 68rem disponíveis; os pares do Resumo, com 40rem na coluna", () => {
    const css = fonte("app/globals.css");
    expect(css).toContain(".os-central { container: os-central / inline-size; }");
    expect(css).toMatch(/@container os-central \(min-width: 68rem\) \{\s*\.os-colunas \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 24rem;/);
    expect(css).toContain(".os-abas { container: os-abas / inline-size; }");
    expect(css).toMatch(/@container os-abas \(min-width: 40rem\) \{\s*\.os-pares \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  });

  it("a central usa as classes de container — e não decide mais pela tela (xl:/md:)", () => {
    const detalhe = fonte("components/os/os-detalhe.tsx");
    expect(detalhe).toContain('<div className="os-central">');
    expect(detalhe).toContain('<div className="os-colunas" data-colunas-os>');
    expect(detalhe).toContain('className="os-abas bg-white');
    expect(detalhe).not.toMatch(/xl:grid-cols-\[minmax\(0,1fr\)_24rem\]/);
    const resumo = fonte("components/os/central/resumo-os.tsx");
    expect(resumo.match(/className="os-pares"/g)?.length).toBe(2);
    expect(resumo).not.toContain("md:grid-cols-2");
  });

  it("o título do painel e o resumo em duas linhas (não quebram no meio); o nome da empresa na trilha não quebra", () => {
    const painel = fonte("components/os/central/painel-atividades.tsx");
    expect(painel).toContain('<p className="text-xs font-medium text-ink-muted mt-0.5 truncate" data-resumo-painel>{resumo.texto}</p>');
    expect(fonte("components/layout/header.tsx")).toContain("whitespace-nowrap truncate max-w-[14rem] shrink-0\" data-trilha-empresa");
  });
});

/* ───────────────────────── 2. estoque ───────────────────────── */

describe("2. estoque: sem estoque não é OK", () => {
  it("o selo diz Sem estoque, em vermelho; o saldo zero também fica vermelho", async () => {
    const { SeloSituacao, SaldoQtd } = await import("@/components/estoque/situacao");
    const selo = renderToStaticMarkup(createElement(SeloSituacao, { situacao: "zerado" }));
    expect(selo).toContain(">Sem estoque<");
    expect(selo).toContain("bg-atrasado-claro");
    expect(renderToStaticMarkup(createElement(SeloSituacao, { situacao: "ok" }))).toContain(">Em estoque<");
    expect(renderToStaticMarkup(createElement(SaldoQtd, { saldo: 0, unidade: "un", situacao: "zerado" }))).toContain("text-atrasado");
    expect(renderToStaticMarkup(createElement(SaldoQtd, { saldo: 12, unidade: "un", situacao: "ok" }))).toContain("text-ink");
  });

  it("a lista filtra por Sem estoque, e o aviso do topo vem da regra (uma frase por situação)", async () => {
    const { FILTROS_SITUACAO } = await import("@/lib/estoque/servidor");
    expect(FILTROS_SITUACAO).toEqual({ zerado: "Sem estoque", abaixo: "Abaixo do mínimo", negativo: "Saldo negativo" });
    expect(fonte("app/(dashboard)/estoque/page.tsx")).toContain("const avisos = avisosEstoque(alertas);");
  });
});

/* ───────────────────────── 3. clientes ───────────────────────── */

describe("3. clientes: Segmento e Satisfação fora do padrão", () => {
  it("as duas colunas nascem escondidas (oculta) e continuam no menu Colunas", () => {
    const pagina = fonte("app/(dashboard)/clientes/page.tsx");
    expect(pagina).toContain('{ id: "segmento", titulo: "Segmento", largura: 140, ordenar: "segmento", classe: "truncate", oculta: true }');
    // (leva 3) a Satisfação passou a ser a média do aceite das OS: calculada, sem ordenar pela coluna
    expect(pagina).toContain('{ id: "satisfacao", titulo: "Satisfação", largura: 110, oculta: true }');
    // sem preferência salva, a regra da tabela esconde exatamente as duas
    const ocultas = ocultasEfetivas(PREFERENCIA_VAZIA, [{ id: "nome" }, { id: "segmento", oculta: true }, { id: "satisfacao", oculta: true }, { id: "os" }] as any);
    expect([...ocultas].sort()).toEqual(["satisfacao", "segmento"]);
    // quem já escolheu as colunas continua com a escolha dele
    expect([...ocultasEfetivas({ ...PREFERENCIA_VAZIA, ocultas: [] }, [{ id: "segmento", oculta: true }] as any)]).toEqual([]);
  });
});

/* ───────────────────────── 4. ficha do cliente ───────────────────────── */

const CLIENTE: any = {
  id: "cl1", nome: "Clínica Vida Plena Ltda", nomeFantasia: "Vida Plena", tipoPessoa: "JURIDICA", cpfCnpj: "11222333000181",
  ativo: true, statusFinanceiro: "ADIMPLENTE", logo: null, observacoes: "Portaria fecha às 18h.", satisfacao: null,
  tabelaPreco: { nome: "Contrato", ativo: true }, emailsFaturamento: ["financeiro@vidaplena.com.br"],
  unidades: [{ id: "u1", nome: "Matriz", principal: true, logradouro: "Rua das Flores", numero: "120", bairro: "Centro", cidade: "São Paulo", estado: "SP" }],
  contatosCliente: [{ id: "k1", nome: "Marta", cargo: "Gerente", principal: true, telefone: "11988887777", email: "marta@vidaplena.com.br" }],
  anexos: [{ id: "a1", nome: "contrato.pdf", tipo: "application/pdf", tamanho: 1000, criadoEm: "2026-11-01" }], interacoes: [], _count: { contratos: 1 },
};
async function montarCliente(props: any, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(ClienteForm, { initialData: CLIENTE, ...props }) }));
}

describe("4. ficha do cliente: consulta, com Editar como ação", () => {
  it("em consulta o cadastro aparece como texto — nenhum campo de digitação em Dados gerais, nada de Salvar", async () => {
    await montarCliente({ consulta: true });
    const ficha = $("[data-ficha-cliente]")!;
    expect(ficha).not.toBeNull();
    expect(ficha.querySelectorAll("input, textarea, select").length).toBe(0);
    // e o formulário de Dados gerais não está na página (nem escondido): nada de campo de nome ou documento
    expect(caixa.querySelector('input[name="nome"], input[name="cpfCnpj"], select[name="tipoPessoa"]')).toBeNull();
    expect(txt(ficha)).toContain("11.222.333/0001-81");
    expect(txt(ficha)).toContain("Rua das Flores, 120 · Centro · São Paulo/SP");
    expect(txt(ficha)).toContain("Marta");
    expect(txt(ficha)).toContain("financeiro@vidaplena.com.br");
    expect(txt(caixa)).not.toMatch(/\bSalvar\b/);
    expect(txt(caixa)).not.toContain("Modo somente leitura");
  });

  it("\"Editar\" leva à edição — na mesma aba em que a pessoa está", async () => {
    await montarCliente({ consulta: true });
    expect($$("[data-editar-cliente]").map((a) => a.getAttribute("href"))).toEqual(["/clientes/cl1/editar"]);
    await act(async () => { [...caixa.querySelectorAll("nav button")].find((b) => txt(b) === "Relacionamento")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect($("[data-editar-cliente]")!.getAttribute("href")).toBe("/clientes/cl1/editar?aba=relacionamento");
    expect(txt($("[data-observacoes-ficha]"))).toBe("Portaria fecha às 18h.");
  });

  it("sem permissão de editar, a ficha não oferece Editar; o status é só um selo", async () => {
    await montarCliente({ consulta: true }, montarPermissoes({ clientes: ["visualizar"] }));
    expect($("[data-editar-cliente]")).toBeNull();
    expect(caixa.querySelector('button[title="Mudar status do cliente"]')).toBeNull();
  });

  it("anexos em consulta: dá para ver, não para enviar nem excluir", async () => {
    await montarCliente({ consulta: true, abaInicial: "documentos" });
    expect(txt(caixa)).toContain("contrato.pdf");
    expect(caixa.querySelector('button[title="Visualizar"]')).not.toBeNull();
    expect(caixa.querySelector('button[title="Excluir"]')).toBeNull();
    expect(txt(caixa)).not.toContain("Enviar anexo");
  });

  it("a edição continua formulário; Cancelar volta para a ficha (não para a lista)", async () => {
    await montarCliente({});
    expect($("[data-ficha-cliente]")).toBeNull();
    expect(caixa.querySelectorAll("input").length).toBeGreaterThan(3);
    await act(async () => { [...caixa.querySelectorAll("button")].find((b) => txt(b) === "Cancelar")!.click(); });
    expect(nav.push).toHaveBeenCalledWith("/clientes/cl1");
  });

  it("a lista, a busca e o olho de quem só consulta levam à ficha; o lápis leva à edição", () => {
    const lista = fonte("app/(dashboard)/clientes/page.tsx");
    expect(lista).not.toContain("/editar`");
    expect(lista.match(/`\/clientes\/\$\{c\.id\}`/g)?.length).toBe(3);
    expect(fonte("lib/listas/sugestoes.ts")).toContain("href: `/clientes/${c.id}` })");
    expect(fonte("components/clientes/cliente-acoes.tsx")).toContain("const fichaHref = podeEditar ? `/clientes/${id}/editar` : `/clientes/${id}`;");
    expect(fonte("app/(dashboard)/clientes/[id]/page.tsx")).toContain("<ClienteForm consulta abaInicial={aba}");
  });
});

/* ───────────────────────── 5. histórico da OS ───────────────────────── */

const H = (i: number, min: number, acao: string, detalhes: string | null, quem = "Sérgio") =>
  ({ id: `h${String(i).padStart(2, "0")}`, acao, detalhes, criadoEm: new Date(Date.UTC(2026, 10, 23, 11, 0) + min * 60_000).toISOString(), usuario: { nome: quem } });
const HISTORICO = [
  H(1, 0, "OS criada", "Ordem de serviço OS-1 aberta", "Admin"),
  H(2, 1, "Atividade adicionada", "Preventiva", "Admin"), H(3, 1, "Status automático", "ABERTA → AGENDADA", "Admin"),
  H(4, 600, "Status da atividade alterado", `"Preventiva": AGENDADA → EM_ANDAMENTO (app do técnico)`), H(5, 600, "Status automático", "AGENDADA → EM_ANDAMENTO"),
  ...[6, 7, 8, 9, 10].map((i) => H(i, 600 + i, "Foto adicionada", `Antes — sala ${100 + i} (app do técnico)`)),
  ...[11, 12, 13].map((i) => H(i, 620 + i, "Item executado", `Item ${i}`)),
  H(14, 700, "Status da atividade alterado", `"Preventiva": EM_ANDAMENTO → CONCLUIDA`),
].reverse();

describe("5. histórico da OS: o resumo do gestor e a auditoria sob demanda", () => {
  it("por padrão, o resumo: linhas agrupadas, sem código de status", async () => {
    const { HistoricoOs } = await import("@/components/os/central/resumo-os");
    await montar(createElement(HistoricoOs, { historico: HISTORICO }));
    const linhas = $$("[data-historico-item]");
    expect(linhas.length).toBe(6);
    const texto = txt(caixa);
    expect(texto).toContain("5 fotos adicionadas");
    expect(texto).toContain("3 itens executados");
    expect(texto).toContain("Atividade iniciada");
    expect(texto).toContain("· OS em execução");
    expect(texto).not.toMatch(/EM_ANDAMENTO|AGENDADA →|app do técnico/);
  });

  it("uma linha agrupada abre os registros dela — com a hora e o texto gravado", async () => {
    const { HistoricoOs } = await import("@/components/os/central/resumo-os");
    await montar(createElement(HistoricoOs, { historico: HISTORICO }));
    const fotos = $$("[data-historico-item]").find((l) => txt(l).includes("5 fotos adicionadas"))!;
    const abrir = fotos.querySelector("[data-historico-abrir]") as HTMLButtonElement;
    expect(txt(abrir)).toBe("Ver os 5 registros");
    await act(async () => { abrir.click(); });
    expect(fotos.querySelectorAll("[data-historico-registros] li").length).toBe(5);
    expect(txt(fotos)).toContain("Antes — sala 110 (app do técnico)");
  });

  it("\"Registro completo\" mostra cada evento como foi gravado (a auditoria inteira)", async () => {
    const { HistoricoOs } = await import("@/components/os/central/resumo-os");
    await montar(createElement(HistoricoOs, { historico: HISTORICO }));
    await act(async () => { $('[data-modo-historico="registro"]')!.click(); });
    expect($("[data-historico]")!.getAttribute("data-historico")).toBe("registro");
    expect($$("[data-historico-registro]").length).toBe(8);
    await act(async () => { $("[data-historico-todo]")!.click(); });
    expect($$("[data-historico-registro]").length).toBe(HISTORICO.length);
    expect(txt(caixa)).toContain("AGENDADA → EM_ANDAMENTO");
  });

  it("sem registro: \"Nenhum registro.\"", async () => {
    const { HistoricoOs } = await import("@/components/os/central/resumo-os");
    await montar(createElement(HistoricoOs, { historico: [] }));
    expect(txt(caixa)).toBe("Nenhum registro.");
  });
});

/* ───────────────────────── 6. gráfico do financeiro ───────────────────────── */

const MESES = [
  { mes: "jun", ref: "2026-06", entradas: 48250.4, saidas: 31200 },
  { mes: "jul", ref: "2026-07", entradas: 52310.9, saidas: 35880.75 },
  { mes: "ago", ref: "2026-08", entradas: 18740, saidas: 29950.3 },
];

describe("6. gráfico do financeiro: legível no desktop e no celular", () => {
  it("um eixo com valores, legenda das duas séries, resultado do mês e do período", async () => {
    const { GraficoEntradasSaidas } = await import("@/components/financeiro/grafico-entradas-saidas");
    await montar(createElement(GraficoEntradasSaidas, { meses: MESES }));
    expect($$("[data-eixo-y] span").map(txt)).toEqual(["R$ 0", "R$ 20 mil", "R$ 40 mil", "R$ 60 mil"]);
    expect(txt($("[data-legenda]"))).toBe("Entradas Saídas");
    expect(txt($("[data-resultado-periodo]"))).toBe("R$ 22.270,25");
    expect($$("[data-resultado-mes]").map((e) => txt(e.querySelector(".hidden")))).toEqual(["+R$ 17 mil", "+R$ 16 mil", "−R$ 11 mil"]);
    expect($$("[data-resultado-mes]").map((e) => txt(e.querySelector(".sm\\:hidden")))).toEqual(["+17 mil", "+16 mil", "−11 mil"]);
    // o mês com o ano no primeiro e na virada
    expect($$("[data-mes-alvo]").map((b) => txt(b.querySelector("span")))).toEqual(["jun/26", "jul", "ago"]);
  });

  it("não há mais a linha de saldo com escala própria (dois eixos), nem as cores de status nas séries", () => {
    const pagina = fonte("app/(dashboard)/financeiro/page.tsx");
    expect(pagina).not.toContain("polyline");
    expect(pagina).not.toContain("saldoAcc");
    const grafico = fonte("components/financeiro/grafico-entradas-saidas.tsx");
    expect(grafico).not.toMatch(/bg-success-500|bg-atrasado"/);
    expect(grafico).toContain("serieGrafico.serie1");
  });

  it("tocar (ou passar o mouse) num mês mostra o detalhe exato; o toque não fecha o que o mouse abriu", async () => {
    const { GraficoEntradasSaidas } = await import("@/components/financeiro/grafico-entradas-saidas");
    await montar(createElement(GraficoEntradasSaidas, { meses: MESES }));
    const ago = $('[data-mes-alvo="2026-08"]')!;
    await act(async () => { ago.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); ago.click(); });
    const det = $('[data-detalhe-mes="2026-08"]')!;
    // cada linha do detalhe: rótulo e valor (o rótulo das séries leva o quadradinho da cor ao lado)
    const linhasDet = [...det.querySelectorAll("p")].map((p) => [...p.children].map(txt).filter(Boolean).join(" | ") || txt(p));
    expect(linhasDet).toEqual(["Agosto de 2026", "Entradas | R$ 18.740,00", "Saídas | R$ 29.950,30", "Resultado | -R$ 11.210,30"]);
    // o mês da direita abre o detalhe à esquerda (e vice-versa): nunca sai do cartão
    expect(det.className).toContain("left-0");
    await act(async () => { $('[data-mes-alvo="2026-06"]')!.click(); });
    expect($('[data-detalhe-mes="2026-06"]')!.className).toContain("right-0");
    expect(ago.getAttribute("aria-label")!.replace(/ /g, " ")).toBe("Agosto de 2026: entradas R$ 18.740,00, saídas R$ 29.950,30, resultado -R$ 11.210,30");
  });

  it("\"Ver em tabela\" traz os números exatos", async () => {
    const { GraficoEntradasSaidas } = await import("@/components/financeiro/grafico-entradas-saidas");
    await montar(createElement(GraficoEntradasSaidas, { meses: MESES }));
    const linhas = [...caixa.querySelectorAll("[data-tabela-grafico] tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map(txt).join(" "));
    expect(linhas).toEqual([
      "Junho de 2026 R$ 48.250,40 R$ 31.200,00 R$ 17.050,40",
      "Julho de 2026 R$ 52.310,90 R$ 35.880,75 R$ 16.430,15",
      "Agosto de 2026 R$ 18.740,00 R$ 29.950,30 -R$ 11.210,30",
    ]);
  });
});
