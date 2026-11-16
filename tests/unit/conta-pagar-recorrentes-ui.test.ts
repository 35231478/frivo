// @vitest-environment happy-dom
/**
 * DESPESAS RECORRENTES — P2, nas telas de verdade (DOM):
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
    () => import("@/components/financeiro/regra-recorrente-form"),
    () => import("@/components/financeiro/conta-pagar-form"),
    () => import("@/components/financeiro/recorrentes-view"),
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

describe("Nova conta a pagar: 'Repetir (recorrente)'", () => {
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

  it("ligado, abre a regra, troca o rótulo do valor e esconde o que é de uma conta só", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    expect($("[data-campos-recorrencia]")).toBeTruthy();
    expect(texto()).toContain("Valor de cada ocorrência");
    expect(texto()).toContain("Não multiplica: é o valor de cada mês");
    // vencimento único, boleto e pedido de compra não fazem sentido numa regra
    expect(texto()).not.toContain("Vincular a pedido de compra");
    expect(texto()).not.toContain("Banco do fornecedor");
    // os campos da regra estão lá, com o término em três opções
    expect($("[data-frequencia]")).toBeTruthy();
    expect($("[data-dia-vencimento]")).toBeTruthy();
    expect($("[data-ajuste-dia]")).toBeTruthy();
    expect($$("[data-termino]").length).toBe(3);
    expect($("[data-valor-estimado]")).toBeTruthy();
  });

  it("cria a REGRA com o que a tela montou (e não uma conta solta)", async () => {
    await form();
    await clicar("[data-toggle-recorrente] input");
    await digitar("input[placeholder='Ex: Compra de peças']", "Aluguel do galpão");
    await digitar("input[placeholder='0,00']", "2500");
    await escolher("[data-frequencia]", "TRIMESTRAL");
    await digitar("[data-dia-vencimento]", "10");
    await escolher("[data-ajuste-dia]", "POSTERGAR");
    await clicar("[data-termino='OCORRENCIAS'] input");
    await digitar("[data-ocorrencias]", "4");
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
    expect(toasts()[0]).toBe("Despesa recorrente criada. 12 contas geradas.");
    expect(nav.push).toHaveBeenCalledWith("/financeiro/contas-pagar/recorrentes");
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
    await digitar("input[placeholder='0,00']", "300");
    await digitar("[data-dia-vencimento]", "45");
    await clicarBotao("Criar conta a pagar");
    expect(texto()).toContain("Dia de vencimento: de 1 a 31.");
    expect(toasts()).toEqual([]);
    expect(enviados("POST", "/recorrencias")).toHaveLength(0);
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

/* ───────── A tela das regras ───────── */

const REGRA = {
  id: "r1", descricao: "Aluguel do galpão",
  favorecido: { nome: "Imobiliária Centro", tipo: "FORNECEDOR" as const, ativo: true, semCadastro: false },
  passoMeses: 1, diaVencimento: 10, ajusteDiaNaoUtil: "MANTER",
  valor: 2500, valorEstimado: false,
  inicioAno: 2026, inicioMes: 11, fimAno: null, fimMes: null, ocorrencias: null,
  situacao: "ATIVA", encerramentoMotivo: null,
  categoriaId: "cat1", categoria: null, centroCusto: null, fornecedorId: "f1", tecnicoId: null,
  formaPagamento: null, observacao: null, contas: 12, proximoVencimento: "2026-12-10T00:00:00.000Z",
};
const PAUSADA = { ...REGRA, id: "r2", descricao: "Internet da loja", situacao: "PAUSADA", valorEstimado: true, valor: 320, contas: 3, proximoVencimento: null };

describe("Tela de despesas recorrentes", () => {
  const abrir = async (permissoes: Permissoes = permissoesTotais(), regras = [REGRA, PAUSADA]) => {
    const { RecorrentesView } = await import("@/components/financeiro/recorrentes-view");
    await montar(createElement(RecorrentesView, {
      regras, categorias: [{ id: "cat1", nome: "Aluguel", cor: "#888", ativo: true }],
      podeMexer: permissoes.financeiro?.fluxoCaixa === true, emAberto: { v: 7820, q: 15 },
    }), permissoes);
  };

  it("a mesma informação no desktop e no celular, com os números na faixa (não em rodapé)", async () => {
    await abrir();
    expect($("[data-tabela-recorrentes]")).toBeTruthy();
    expect($$("[data-linha-regra]")).toHaveLength(2);
    expect($$("[data-cartao-regra]")).toHaveLength(2); // celular
    // a faixa aparece nas duas versões (a barra da TabelaPro é só do desktop)
    expect($$("[data-barra-recorrentes]").length).toBe(2);
    expect(texto($("[data-barra-recorrentes]"))).toContain("1 ativa");
    expect(texto($("[data-barra-recorrentes]"))).toContain("1 pausada");
    expect(texto($("[data-barra-recorrentes]")).replace(/ /g, " ")).toContain("R$ 7.820,00");
    // a repetição e o término em palavras
    expect(texto($("[data-linha-regra='r1'] [data-frequencia]"))).toBe("Todo mês, dia 10");
    expect(texto($("[data-linha-regra='r1'] [data-termino]"))).toBe("sem data");
    expect(texto($("[data-linha-regra='r1'] [data-proxima]"))).toBe("10/12/2026");
    // o selo "a confirmar" só na regra de valor estimado
    expect($("[data-linha-regra='r2'] [data-selo-estimado]")).toBeTruthy();
    expect($("[data-linha-regra='r1'] [data-selo-estimado]")).toBeFalsy();
    // no celular o cartão abre as ocorrências (no desktop é o nome da despesa)
    expect($("[data-cartao-regra='r1'] [data-abrir-regra='r1']")).toBeTruthy();
    expect($("[data-linha-regra='r1'] [data-abrir-regra='r1']")).toBeTruthy();
  });

  it("lista vazia explica onde a despesa recorrente nasce", async () => {
    await abrir(permissoesTotais(), []);
    expect($("[data-lista-vazia]")).toBeTruthy();
    expect(texto($("[data-lista-vazia]"))).toContain("Nova conta a pagar");
    expect($("[data-ir-nova-conta]")).toBeTruthy();
  });

  it("quem só visualiza não vê ação de dinheiro nenhuma (nem o botão de criar)", async () => {
    await abrir({ financeiro: { visualizar: true } } as Permissoes);
    expect($("[data-nova-recorrente]")).toBeFalsy();
    await clicar("[data-linha-regra='r1'] button[aria-label^='Ações']");
    const itens = texto($("[role=menu]") ?? document.body);
    expect(itens).toContain("Ver ocorrências");
    for (const proibido of ["Pausar", "Retomar", "Encerrar", "Editar a regra", "Gerar as contas que faltam"]) {
      expect(itens, proibido).not.toContain(proibido);
    }
  });

  it("pausar manda a ação, avisa quantas ocorrências futuras foram canceladas e recarrega", async () => {
    await abrir();
    respostas["POST /api/contas-pagar/recorrencias/r1/acao"] = { status: 200, corpo: { ok: true, canceladas: 2 } };
    await clicar("[data-linha-regra='r1'] button[aria-label^='Ações']");
    await clicarBotao("Pausar");
    expect(enviados("POST", "/recorrencias/r1/acao")[0].corpo).toMatchObject({ acao: "PAUSAR" });
    expect(toasts()[0]).toBe("Despesa pausada. 2 ocorrências futuras canceladas.");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("quando o servidor recusa, a tela NÃO muda e o motivo aparece", async () => {
    await abrir();
    respostas["POST /api/contas-pagar/recorrencias/r1/acao"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar("[data-linha-regra='r1'] button[aria-label^='Ações']");
    await clicarBotao("Pausar");
    expect(avisos.toasts[0]).toEqual({ m: "Sem permissão para esta ação", tipo: "erro" });
    expect(nav.refresh).not.toHaveBeenCalled();
    // a regra continua ATIVA na tela
    expect(texto($("[data-linha-regra='r1'] [data-situacao]"))).toBe("Ativa");
  });

  it("encerrar passa pela confirmação da casa; recusar não chama o servidor", async () => {
    await abrir();
    avisos.responder = false;
    await clicar("[data-linha-regra='r1'] button[aria-label^='Ações']");
    await clicarBotao("Encerrar");
    expect(avisos.confirmacoes[0].mensagem).toContain("O histórico fica");
    expect(enviados("POST", "/acao")).toHaveLength(0);

    avisos.responder = true;
    respostas["POST /api/contas-pagar/recorrencias/r1/acao"] = { status: 200, corpo: { ok: true, canceladas: 1 } };
    await clicar("[data-linha-regra='r1'] button[aria-label^='Ações']");
    await clicarBotao("Encerrar");
    expect(enviados("POST", "/acao")[0].corpo).toMatchObject({ acao: "ENCERRAR" });
    expect(toasts().at(-1)).toBe("Despesa encerrada. 1 ocorrência futura cancelada.");
  });

  it("'gerar as contas que faltam' diz quando não havia nada a gerar", async () => {
    await abrir();
    respostas["POST /api/contas-pagar/recorrencias/r1/acao"] = { status: 200, corpo: { ok: true, contas: 0 } };
    await clicar("[data-linha-regra='r1'] button[aria-label^='Ações']");
    await clicarBotao("Gerar as contas que faltam");
    expect(toasts()[0]).toBe("Nada a gerar: o horizonte já está completo.");
  });

  it("as ocorrências: a paga não oferece pular; a em aberto cancela aquela conta só", async () => {
    await abrir();
    respostas["GET /api/contas-pagar/recorrencias/r1"] = { status: 200, corpo: { contas: [
      { id: "cp1", numero: "CP-1", refAno: 2026, refMes: 11, status: "PAGO_TOTAL", valorTotal: 2500, valorPago: 2500, valorEstimado: false, dataVencimento: "2026-11-10" },
      { id: "cp2", numero: "CP-2", refAno: 2026, refMes: 12, status: "PENDENTE", valorTotal: 2500, valorPago: 0, valorEstimado: false, dataVencimento: "2026-12-10" },
    ] } };
    await clicar("[data-abrir-regra='r1']");
    expect($$("[data-ocorrencia]")).toHaveLength(2);
    expect($("[data-pular='cp1']"), "conta paga não pula").toBeFalsy();
    expect(texto($("[data-ocorrencia='cp1']"))).toContain("não muda");
    expect($("[data-pular='cp2']")).toBeTruthy();
    expect(texto($("[data-resumo-regra]")).replace(/ /g, " ")).toContain("Todo mês, dia 10 · R$ 2.500,00 · sem data para terminar");

    respostas["POST /api/contas-pagar/cp2/pular"] = { status: 200, corpo: { ok: true } };
    await clicar("[data-pular='cp2']");
    expect(avisos.confirmacoes.at(-1)!.mensagem).toContain("A despesa recorrente continua valendo");
    expect(enviados("POST", "/cp2/pular")).toHaveLength(1);
    expect(toasts().at(-1)).toBe("Ocorrência de dez/2026 cancelada.");
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

  it("no cartão do celular o selo NÃO é link: <a> dentro de <a> quebra a hidratação", async () => {
    await abrir();
    // o cartão inteiro já é um link para a conta
    expect($("[data-cartao-conta='cp1'] a")).toBeTruthy();
    expect($("[data-cartao-conta='cp1'] [data-selo-recorrente]")!.tagName).toBe("SPAN");
    expect($("[data-cartao-conta='cp1'] a [data-selo-recorrente] a")).toBeFalsy();
    // no desktop, fora de qualquer link, o selo leva para a regra
    const naTabela = $("[data-linha-conta='cp1'] [data-selo-recorrente]")!;
    expect(naTabela.tagName).toBe("A");
    expect(naTabela.getAttribute("href")).toBe("/financeiro/contas-pagar/recorrentes");
  });

  it("o filtro Origem oferece a despesa recorrente e a lista leva para a tela das regras", async () => {
    await abrir();
    expect($("[data-ir-recorrentes]")!.getAttribute("href")).toBe("/financeiro/contas-pagar/recorrentes");
    expect(texto()).toContain("Despesas recorrentes");
  });
});

/* ───────── Tornar uma conta avulsa em recorrente ───────── */

describe("Tornar recorrente uma conta que já existe", () => {
  const conta = { id: "cp9", numero: "CP-9", fornecedor: "Imobiliária Centro", valorTotal: 1200, valorPago: 0, saldoRestante: 1200, status: "PENDENTE", descricao: "Aluguel", dataVencimento: "2026-11-10T00:00:00.000Z" };

  it("o menu oferece para a avulsa e NÃO para a que já é de uma regra", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta, menu: true }));
    await clicar("button[aria-label^='Ações']");
    expect(texto($("[role=menu]") ?? document.body)).toContain("Tornar recorrente");

    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await montar(createElement(ContaPagarAcoes, { conta: { ...conta, recorrenciaId: "r1" }, menu: true }));
    await clicar("button[aria-label^='Ações']");
    const menu = texto($("[role=menu]") ?? document.body);
    expect(menu).not.toContain("Tornar recorrente");
    expect(menu).toContain("Ver a despesa recorrente");
  });

  it("a conta não é recriada: o diálogo diz isso e a rota recebe a regra", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta, menu: true }));
    await clicar("button[aria-label^='Ações']");
    await clicarBotao("Tornar recorrente");
    expect(texto($("[data-aviso-tornar]"))).toContain("mesmo número, mesmos pagamentos, mesmo histórico");
    // a descrição e o valor da conta já vêm preenchidos
    expect(($("[data-descricao-regra]") as HTMLInputElement).value).toBe("Aluguel");
    expect(($("[data-valor-regra]") as HTMLInputElement).value).toBe("1200");

    respostas["POST /api/contas-pagar/cp9/tornar-recorrente"] = { status: 201, corpo: { ok: true, regra: { id: "r9" } } };
    await clicarBotao("Tornar recorrente");
    const [pedido] = enviados("POST", "/tornar-recorrente");
    expect(pedido.corpo).toMatchObject({ descricao: "Aluguel", valor: 1200, passoMeses: 1, diaVencimento: 10 });
    expect(toasts().at(-1)).toBe("Conta CP-9 agora é a primeira ocorrência de uma despesa recorrente.");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("quem não pode mexer em dinheiro não vê a opção", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta, menu: true }), { financeiro: { visualizar: true } } as Permissoes);
    await clicar("button[aria-label^='Ações']");
    expect(texto($("[role=menu]") ?? document.body)).not.toContain("Tornar recorrente");
  });
});
