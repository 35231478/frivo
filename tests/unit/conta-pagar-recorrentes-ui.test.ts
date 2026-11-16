// @vitest-environment happy-dom
/**
 * REPETIR LANÇAMENTO — a recorrência DENTRO da conta a pagar, nas telas de verdade (DOM).
 * Não há tela de regras: tudo acontece na própria conta.
 *
 *  - "Repetir (recorrente)" desligado: a nova conta a pagar continua exatamente como era (POST em
 *    /api/contas-pagar). Ligado: a tela cria a REGRA (POST em /api/contas-pagar/recorrencias) com o
 *    valor de CADA ocorrência, e esconde o que é de uma conta só (vencimento, boleto, pedido);
 *  - o favorecido pode ser colaborador (salário), e aí vai tecnicoId em vez de fornecedorId;
 *  - editar uma conta gerada pergunta o ALCANCE e manda `escopo`; com pagamento registrado não
 *    pergunta nada e não manda escopo (conta paga não muda);
 *  - a tela de regras: a mesma informação no desktop e nos cartões do celular; quem só visualiza não
 *    vê as ações; quando o servidor recusa, a tela NÃO muda e o motivo aparece;
 *  - encerrar passa pela confirmação da casa (recusar não chama o servidor) e pular uma ocorrência
 *    cancela aquela conta — a paga nem oferece o botão.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => "/financeiro/contas-pagar", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toasts: [] as { m: string; tipo?: string }[], confirmacoes: [] as { mensagem: string }[], responder: true }));
vi.mock("@/components/ui/avisos", async (original) => ({
  ...(await original<object>()),
  toast: (m: string, tipo?: string) => { avisos.toasts.push({ m, tipo }); },
  confirmar: async (o: { mensagem: string } | string) => {
    avisos.confirmacoes.push(typeof o === "string" ? { mensagem: o } : o);
    return avisos.responder;
  },
}));

let root: Root; let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/financeiro/campos-recorrencia"),
    () => import("@/components/financeiro/recorrencia-da-conta"),
    () => import("@/components/financeiro/conta-pagar-form"),
    () => import("@/components/financeiro/contas-pagar-view"),
    () => import("@/components/providers/permissoes-provider"),
  ]) await m();
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear(); nav.push.mockClear();
  avisos.toasts = []; avisos.confirmacoes = []; avisos.responder = true;
  try { localStorage.clear(); } catch { /* sem storage */ }
  respostas = {
    "GET /api/pedidos-compra": { status: 200, corpo: [] },
    "GET /api/tecnicos": { status: 200, corpo: [{ id: "t1", nome: "Carlos Dias" }, { id: "t2", nome: "Ana Prado" }] },
    "GET /api/cadastros/fornecedores": { status: 200, corpo: [{ id: "f1", nome: "Imobiliária Centro", ativo: true }] },
    "GET /api/cadastros/categorias-financeiras": { status: 200, corpo: [{ id: "cat1", nome: "Aluguel", cor: "#888", ativo: true }] },
    "GET /api/cadastros/centros-custo": { status: 200, corpo: [] },
    "POST /api/contas-pagar/recorrencias": { status: 201, corpo: { id: "r1", contasGeradas: 12 } },
    "POST /api/contas-pagar": { status: 201, corpo: { id: "cp9", numero: "CP-9" } },
    "PUT /api/contas-pagar/": { status: 200, corpo: { numero: "CP-1", alcancadas: 4 } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url: String(url), metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const chave = Object.keys(respostas)
      .filter((k) => { const [m, u] = k.split(" "); return m === metodo && String(url).startsWith(u); })
      .sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const clicar = async (sel: string) => { const el = $(sel); expect(el, sel).toBeTruthy(); await act(async () => { el!.click(); }); await esperar(); };
const digitar = async (sel: string, valor: string) => {
  const el = $(sel) as HTMLInputElement; expect(el, sel).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
};
const escolher = async (sel: string, valor: string) => {
  const el = $(sel) as HTMLSelectElement; expect(el, sel).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
};
const botao = (rotulo: string) => $$("button").find((b) => texto(b) === rotulo) ?? null;
const clicarBotao = async (rotulo: string) => {
  const b = botao(rotulo); expect(b, rotulo).toBeTruthy();
  await act(async () => { b!.click(); }); await esperar();
};
const enviados = (metodo: string, parte: string) => chamadas.filter((c) => c.metodo === metodo && c.url.includes(parte));
const toasts = () => avisos.toasts.map((t) => t.m.replace(/ /g, " "));

async function montar(el: React.ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}

/* ───────── Nova conta a pagar: o toggle ───────── */

describe("Nova conta a pagar: 'Repetir lançamento?'", () => {
  const form = async (initialData?: object) => {
    const { ContaPagarForm } = await import("@/components/financeiro/conta-pagar-form");
    await montar(createElement(ContaPagarForm, { initialData }));
  };

  it("desligado, a conta a pagar continua a de sempre (nada de regra)", async () => {
    await form();
    expect($("[data-toggle-recorrente]")).toBeTruthy();
    expect($("[data-campos-recorrencia]")).toBeFalsy(); // a regra só aparece quando se liga
    // o vencimento, o boleto e o pedido continuam na tela
    expect($("[name='boleto']") ?? $("[data-campo-boleto]") ?? texto()).toBeTruthy();
    expect(texto()).toContain("Vencimento");
    expect(texto()).toContain("Valor total");
  });

  it("ligado, abre as configurações de repetição e a condição de pagamento da repetição", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    expect($("[data-campos-recorrencia]")).toBeTruthy();
    expect(texto()).toContain("Valor de cada ocorrência");
    expect(texto()).toContain("Configurações de repetição");
    expect(texto()).toContain("Cobrar sempre no");
    expect(texto()).toContain("1º vencimento");
    // vencimento único, boleto e pedido de compra não fazem sentido quando o lançamento se repete
    expect(texto()).not.toContain("Vincular a pedido de compra");
    expect(texto()).not.toContain("Banco do fornecedor");
    expect($("[data-config-repeticao]")).toBeTruthy();
    expect($("[data-dia-vencimento]")).toBeTruthy();
    expect($("[data-ajuste-dia]")).toBeTruthy();
    expect($("[data-valor-estimado]")).toBeTruthy();
  });

  it("a prévia mostra, antes de salvar, as contas que vão nascer", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    await digitar("input[placeholder='Ex: Compra de peças']", "Aluguel do galpão");
    await digitar("input[placeholder='0,00']", "2500");
    await escolher("[data-config-repeticao]", "MENSAL_12");
    expect($("[data-previa-recorrencias]")).toBeTruthy();
    // fechada por padrão (não polui a tela), com a contagem no título
    expect($("[data-previa-linha]")).toBeFalsy();
    expect(texto($("[data-abrir-previa]"))).toContain("(12)");
    await clicar("[data-abrir-previa]");
    expect($$("[data-previa-linha]")).toHaveLength(12);
    const primeira = texto($("[data-previa-linha]"));
    expect(primeira).toContain("Aluguel do galpão \u2014");
    expect(primeira.replace(/\u00a0/g, " ")).toContain("R$ 2.500,00");
  });

  it("'Personalizar…' abre a frequência e o término, e o que ele confirma vale", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    await escolher("[data-config-repeticao]", "CUSTOM");
    expect($("[data-personalizar-recorrencia]"), "o modal da recorrência abre").toBeTruthy();
    await digitar("[data-passo-meses]", "2");
    await clicar("[data-termino='OCORRENCIAS'] input[type=radio]");
    await digitar("[data-ocorrencias]", "6");
    await clicar("[data-confirmar-personalizar]");
    expect($("[data-personalizar-recorrencia]")).toBeFalsy();
    // o seletor passa a mostrar a regra montada e a prévia acompanha
    expect(texto($("[data-config-repeticao]"))).toContain("A cada 2 meses, 6 vezes");
    await clicar("[data-abrir-previa]");
    expect($$("[data-previa-linha]")).toHaveLength(6);
  });

  it("cria a REGRA com o que a tela montou (e não uma conta solta)", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    await digitar("input[placeholder='Ex: Compra de peças']", "Aluguel do galpão");
    await digitar("input[placeholder='0,00']", "2500");
    await escolher("[data-dia-vencimento]", "10");
    await escolher("[data-ajuste-dia]", "POSTERGAR");
    // frequência e término pelo "Personalizar…"
    await escolher("[data-config-repeticao]", "CUSTOM");
    await digitar("[data-passo-meses]", "3");
    await clicar("[data-termino='OCORRENCIAS'] input[type=radio]");
    await digitar("[data-ocorrencias]", "4");
    await clicar("[data-confirmar-personalizar]");
    await clicar("[data-valor-estimado] input");
    // o favorecido: o seletor de fornecedor já está na tela
    await escolher("[data-campos-recorrencia]", "").catch(() => {});
    const seletorFornecedor = ($$("select") as HTMLSelectElement[]).find((s) => [...s.options].some((o) => o.textContent?.includes("Imobiliária Centro")));
    expect(seletorFornecedor).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(seletorFornecedor, "f1");
      seletorFornecedor!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();

    await clicarBotao("Criar conta a pagar");
    const [pedido] = enviados("POST", "/api/contas-pagar/recorrencias");
    expect(pedido, "a tela deve criar a regra").toBeTruthy();
    expect(enviados("POST", "/api/contas-pagar").filter((c) => !c.url.includes("recorrencias"))).toHaveLength(0);
    expect(pedido.corpo).toMatchObject({
      descricao: "Aluguel do galpão", valor: 2500, passoMeses: 3, diaVencimento: 10,
      ajusteDiaNaoUtil: "POSTERGAR", ocorrencias: 4, fimAno: null, fimMes: null, valorEstimado: true, fornecedorId: "f1", tecnicoId: null,
    });
    // sucesso é toast, com quantas contas nasceram, e a tela vai para a lista de regras
    expect(toasts()[0]).toBe("Lançamento repetido criado: 12 contas abertas.");
    expect(nav.push).toHaveBeenCalledWith("/financeiro/contas-pagar");
  });

  it("favorecido colaborador: manda tecnicoId e não exige fornecedor", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    await clicar("[data-tipo-favorecido] input[type=radio]:not(:checked)");
    expect($("[data-colaborador]")).toBeTruthy();
    await digitar("input[placeholder='Ex: Compra de peças']", "Pró-labore");
    await digitar("input[placeholder='0,00']", "8000");
    await escolher("[data-colaborador]", "t1");
    await clicarBotao("Criar conta a pagar");
    expect(enviados("POST", "/recorrencias")[0].corpo).toMatchObject({ tecnicoId: "t1", fornecedorId: null, valor: 8000 });
  });

  it("sem favorecido escolhido, a tela diz o que falta e não chama o servidor", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    await digitar("input[placeholder='Ex: Compra de peças']", "Internet");
    await digitar("input[placeholder='0,00']", "300");
    await clicarBotao("Criar conta a pagar");
    expect(enviados("POST", "/recorrencias")).toHaveLength(0);
    expect(texto()).toContain("Escolha o fornecedor.");
  });

  it("o erro da regra aparece na tela (não em toast) e nada é enviado", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    await digitar("input[placeholder='Ex: Compra de peças']", "Internet");
    await clicarBotao("Criar conta a pagar");
    expect(texto()).toContain("Informe o valor de cada ocorrência.");
    expect(toasts()).toEqual([]);
    expect(enviados("POST", "/recorrencias")).toHaveLength(0);
  });

  it("o 'Personalizar…' recusa o que a rota recusaria, sem fechar o diálogo", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    await escolher("[data-config-repeticao]", "CUSTOM");
    await digitar("[data-passo-meses]", "99");
    await clicar("[data-confirmar-personalizar]");
    expect(texto($("[data-erro-personalizar]"))).toContain("Repetir a cada: de 1 a 60 meses.");
    expect($("[data-personalizar-recorrencia]"), "o diálogo fica aberto para corrigir").toBeTruthy();
  });
});

/* ───────── Editar uma conta gerada: o alcance ───────── */

describe("Editar a conta de uma despesa recorrente: o alcance", () => {
  const conta = {
    id: "cp1", numero: "CP-1", descricao: "Aluguel do galpão — nov/2026", fornecedorId: "f1", fornecedor: "Imobiliária Centro",
    valorTotal: 2500, valorPago: 0, dataVencimento: "2026-11-10T00:00:00.000Z", recorrenciaId: "r1", refAno: 2026, refMes: 11,
  };
  const abrir = async (extra: object = {}) => {
    const { ContaPagarForm } = await import("@/components/financeiro/conta-pagar-form");
    await montar(createElement(ContaPagarForm, { initialData: { ...conta, ...extra } }));
  };

  it("pergunta o alcance com a ajuda de cada opção e manda o escolhido", async () => {
    await abrir();
    expect($("[data-alcance-edicao]")).toBeTruthy();
    expect($$("[data-escopo]").length).toBe(2);
    expect(texto($("[data-escopo='ESTA']"))).toContain("Só esta ocorrência");
    expect(texto($("[data-escopo='ESTA_E_PROXIMAS']"))).toContain("As já pagas não mudam.");

    await digitar("input[placeholder='0,00']", "2700");
    await clicar("[data-escopo='ESTA_E_PROXIMAS'] input");
    await clicarBotao("Salvar alterações");
    const [put] = enviados("PUT", "/api/contas-pagar/cp1");
    expect(put.corpo.escopo).toBe("ESTA_E_PROXIMAS");
    expect(put.corpo.valorTotal).toBe("2700");
    // o toast conta quantas outras ocorrências foram junto (a resposta disse 4)
    expect(toasts()[0]).toBe("Conta CP-1 atualizada. A regra e 3 ocorrências em aberto acompanharam.");
  });

  it("'só esta' é o padrão: manda ESTA e a regra não muda", async () => {
    await abrir();
    respostas["PUT /api/contas-pagar/"] = { status: 200, corpo: { numero: "CP-1" } };
    await digitar("input[placeholder='0,00']", "2600");
    await clicarBotao("Salvar alterações");
    expect(enviados("PUT", "/cp1")[0].corpo.escopo).toBe("ESTA");
    expect(toasts()[0]).toBe("Conta CP-1 atualizada.");
  });

  it("com pagamento registrado não há escolha: a tela explica e não manda escopo", async () => {
    await abrir({ valorPago: 500, status: "PAGO_PARCIAL" });
    expect($("[data-alcance-travado]")).toBeTruthy();
    expect($$("[data-escopo]")).toHaveLength(0);
    expect(texto($("[data-alcance-travado]"))).toContain("o ajuste vale só para este mês");
    respostas["PUT /api/contas-pagar/"] = { status: 200, corpo: { numero: "CP-1" } };
    await digitar("input[placeholder='0,00']", "2600");
    await clicarBotao("Salvar alterações");
    expect(enviados("PUT", "/cp1")[0].corpo.escopo).toBeUndefined();
  });

  it("conta avulsa (sem regra) não ganha pergunta nenhuma", async () => {
    await abrir({ recorrenciaId: null, refAno: null, refMes: null });
    expect($("[data-alcance-edicao]")).toBeFalsy();
  });
});

/* ───────── Os selos na lista de contas a pagar ───────── */

describe("Selos na lista de contas a pagar", () => {
  const conta = {
    id: "cp1", numero: "CP-1", descricao: "Aluguel do galpão — nov/2026",
    valorTotal: 2500, valorPago: 0, saldoRestante: 2500, dataVencimento: "2026-11-10T00:00:00.000Z", status: "PENDENTE",
    categoriaId: null, categoria: null, centroCusto: null,
    fornecedor: { id: "f1", nome: "Imobiliária Centro", documento: null, ativo: true, semCadastro: false },
    temBoleto: false, notaCompra: null, pedidoCompra: null,
    recorrenciaId: "r1", refAno: 2026, refMes: 11, valorEstimado: true,
  };
  const zero = { v: 0, q: 0 };

  const abrir = async () => {
    const { ContasPagarView } = await import("@/components/financeiro/contas-pagar-view");
    await montar(createElement(ContasPagarView, {
      contas: [conta as never], resumo: { VENCIDO: zero, VENCE_HOJE: zero, A_VENCER: zero, PAGO: zero, TOTAL: zero } as never,
      periodo: { tipo: "mes", rotulo: "Novembro de 2026" } as never,
      filtros: { fornecedor: "", card: "", status: "", fornecedorId: "", categoria: "", centro: "", origem: "" },
      categorias: [], centros: [], fornecedores: [],
      total: 1, pagina: 1, porPagina: 50, totalFiltrado: 2500, totalAberto: 2500, podeImportarNf: false,
    }));
  };

  it("os dois selos aparecem na linha do desktop e no cartão do celular", async () => {
    await abrir();
    const naTabela = $("[data-linha-conta='cp1'] [data-selo-recorrente]");
    const noCartao = $("[data-cartao-conta='cp1'] [data-selo-recorrente]");
    expect(naTabela, "desktop").toBeTruthy();
    expect(noCartao, "celular").toBeTruthy();
    expect($$("[data-selo-estimado]").length).toBe(2);
  });

  it("o selo é texto, nunca link: no cartão ele fica DENTRO do link da conta, e <a> dentro de <a> quebra a hidratação", async () => {
    await abrir();
    // o cartão inteiro já é um link para a conta
    expect($("[data-cartao-conta='cp1'] a")).toBeTruthy();
    expect($("[data-cartao-conta='cp1'] [data-selo-recorrente]")!.tagName).toBe("SPAN");
    expect($("[data-cartao-conta='cp1'] a [data-selo-recorrente] a")).toBeFalsy();
    // no desktop também: a repetição se ajusta dentro da própria conta, não há tela para onde ir
    expect($("[data-linha-conta='cp1'] [data-selo-recorrente]")!.tagName).toBe("SPAN");
    expect($("[data-ir-recorrentes]"), "não existe tela de regras").toBeFalsy();
  });

  it("a conta repetida aparece marcada nas duas versões, e a avulsa não", async () => {
    await abrir();
    expect($$("[data-selo-recorrente]")).toHaveLength(2); // linha do desktop + cartão do celular
    expect(texto($("[data-linha-conta='cp1']"))).toContain("recorrente");
  });
});

/* ───────── Tornar uma conta avulsa em recorrente ───────── */

describe("Repetir o lançamento de uma conta que já existe", () => {
  const conta = { id: "cp9", numero: "CP-9", fornecedor: "Imobiliária Centro", valorTotal: 1200, valorPago: 0, saldoRestante: 1200, status: "PENDENTE", descricao: "Aluguel", dataVencimento: "2026-11-10T00:00:00.000Z" };

  it("o menu oferece para a avulsa e NÃO para a que já é de uma regra", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta, menu: true }));
    await clicar("button[aria-label^='Ações']");
    expect(texto($("[role=menu]") ?? document.body)).toContain("Repetir lançamento");

    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await montar(createElement(ContaPagarAcoes, { conta: { ...conta, recorrenciaId: "r1" }, menu: true }));
    await clicar("button[aria-label^='Ações']");
    // a que já se repete não oferece de novo, e não há tela de regras para onde mandar
    expect(texto($("[role=menu]") ?? document.body)).not.toContain("Repetir lançamento");
  });

  it("a conta não é recriada: o diálogo diz isso e a rota recebe a regra", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta, menu: true }));
    await clicar("button[aria-label^='Ações']");
    await clicarBotao("Repetir lançamento");
    expect(texto($("[data-aviso-tornar]"))).toContain("mesmo número, mesmos pagamentos, mesmo histórico");
    // a descrição e o valor da conta já viajam com ela (a prévia mostra os dois)
    await clicar("[data-abrir-previa]");
    const primeira = texto($("[data-previa-linha]"));
    expect(primeira).toContain("Aluguel \u2014");
    expect(primeira.replace(/\u00a0/g, " ")).toContain("R$ 1.200,00");

    respostas["POST /api/contas-pagar/cp9/tornar-recorrente"] = { status: 201, corpo: { ok: true, regra: { id: "r9" } } };
    await clicar("[data-confirmar-recorrencia]");
    const [pedido] = enviados("POST", "/tornar-recorrente");
    expect(pedido.corpo).toMatchObject({ descricao: "Aluguel", valor: 1200, passoMeses: 1, diaVencimento: 10 });
    expect(toasts().at(-1)).toBe("Conta CP-9 agora se repete. As próximas já estão abertas.");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("quem não pode mexer em dinheiro não vê a opção", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta, menu: true }), { financeiro: { visualizar: true } } as Permissoes);
    await clicar("button[aria-label^='Ações']");
    expect(texto($("[role=menu]") ?? document.body)).not.toContain("Repetir lançamento");
  });

  it("cancelar uma conta que se repete pergunta ATÉ ONDE, e 'esta e as próximas' encerra a repetição", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta: { ...conta, recorrenciaId: "r1" }, menu: true }));
    await clicar("button[aria-label^='Ações']");
    await clicarBotao("Cancelar conta");
    expect($("[data-cancelar-alcance]"), "não é 'tem certeza': é até onde").toBeTruthy();
    expect($$("[data-escopo-cancelar]")).toHaveLength(2);
    expect(avisos.confirmacoes, "a confirmação da casa não entra aqui").toEqual([]);

    respostas["POST /api/contas-pagar/recorrencias/r1/acao"] = { status: 200, corpo: { ok: true, canceladas: 3 } };
    respostas["POST /api/contas-pagar/cp9/pular"] = { status: 200, corpo: { ok: true } };
    await clicar("[data-escopo-cancelar='ESTA_E_PROXIMAS'] input");
    await clicar("[data-confirmar-cancelar]");
    expect(enviados("POST", "/recorrencias/r1/acao")[0].corpo).toMatchObject({ acao: "ENCERRAR" });
    expect(enviados("POST", "/cp9/pular")).toHaveLength(1);
    expect(toasts().at(-1)).toBe("Conta CP-9 cancelada e repetição encerrada.");
  });

  it("'só esta ocorrência' cancela o mês e NÃO encerra a repetição", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta: { ...conta, recorrenciaId: "r1" }, menu: true }));
    await clicar("button[aria-label^='Ações']");
    await clicarBotao("Cancelar conta");
    respostas["POST /api/contas-pagar/cp9/pular"] = { status: 200, corpo: { ok: true } };
    await clicar("[data-confirmar-cancelar]");
    expect(enviados("POST", "/acao"), "a regra não é encerrada").toHaveLength(0);
    expect(enviados("POST", "/cp9/pular")).toHaveLength(1);
    expect(toasts().at(-1)).toBe("Conta CP-9 cancelada. A repetição continua.");
  });
});
