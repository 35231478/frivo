// @vitest-environment happy-dom
/**
 * pj4 — pontas da Leva I / I.2, as telas num DOM de verdade (dados fictícios):
 *  F04 contrato: Cancelar/Voltar são links (o aviso de sair sem salvar pergunta);
 *  F05 os painéis que gravam sozinhos não armam o "Sair sem salvar?" (data-sem-aviso);
 *  F07 conferir o material de campo: o servidor pede o motivo do preço de tabela → o campo aparece e vai junto;
 *  F11 a reserva das colunas no navegador é do usuário (a de outro usuário no mesmo navegador não vale nem sobe);
 *  F12 "Excluir da cobrança" pergunta antes;
 *  F13/F14 reajuste em massa: "8,5" com vírgula; o aviso do que aconteceu ao aplicar e ao desfazer;
 *  F15 o CEP que a consulta não respondeu pode ser consultado de novo;
 *  F16 cadastro rápido: o CEP diz quando não achou / não respondeu, e a resposta velha não vale;
 *  F18 sair sem salvar: o envio recusado pela validação não segura o aviso; "Descartar" no Meu perfil limpa;
 *  F19 /ordens "Sem agendamento": a barra do período (e os atalhos) saem;
 *  F23 editar empresa (dono do Frivo): sem os dados (a leitura falhou), Salvar fica desligado e o erro aparece.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), qs: "", caminho: "/" }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => nav.caminho, useSearchParams: () => new URLSearchParams(nav.qs) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, update: vi.fn(async () => null) }) }));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o?: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let raiz: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let responder: (url: string, metodo: string, corpo: any) => { status: number; corpo: unknown } | "falha" = () => ({ status: 200, corpo: [] });

beforeEach(() => {
  nav.push.mockClear(); nav.replace.mockClear(); nav.qs = ""; nav.caminho = "/";
  avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  chamadas.length = 0; responder = () => ({ status: 200, corpo: [] });
  try { localStorage.clear(); } catch { /* sem storage */ }
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" ? JSON.parse(init.body) : null;
    chamadas.push({ url: String(url), metodo, corpo });
    const r = responder(String(url), metodo, corpo);
    if (r === "falha") throw new Error("rede fora");
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement, o: { permissoes?: Permissoes; role?: string; usuarioId?: string } = {}) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  raiz = createRoot(caixa);
  await act(async () => { raiz!.render(createElement(PermissoesProvider, { role: o.role ?? "ADMIN", permissoes: o.permissoes ?? permissoesTotais(), usuarioId: o.usuarioId, empresaId: "e1", children: el } as any)); });
  await esperar();
}
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
const perguntouSair = () => avisos.confirmar.mock.calls.some((c) => (c[0] as { titulo?: string } | undefined)?.titulo === "Sair sem salvar?");

/* ═════════ F18 — sair sem salvar ═════════ */
describe("F18 sair sem salvar: o envio recusado pela validação não segura o aviso", () => {
  async function montarForm() {
    (window as any).happyDOM?.setURL("http://localhost:3000/clientes/novo");
    const { ProtegerSaida } = await import("@/components/ui/proteger-saida");
    await montar(createElement(ProtegerSaida, null, createElement("form", { onSubmit: (e: Event) => e.preventDefault(), "data-form": "" },
      createElement("input", { "data-nome": "", required: true }),
      createElement("a", { href: "/clientes", "data-sair": "" }, "Cancelar"))));
  }
  const enviar = () => act(async () => { ($("[data-form]") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

  it("o formulário leva o foco ao campo com erro logo depois do envio: sair volta a perguntar", async () => {
    await montarForm();
    await digitar($("[data-nome]"), "Hospital");
    await enviar();
    await act(async () => { $<HTMLInputElement>("[data-nome]")!.focus(); });
    await clicar($("[data-sair]"));
    expect(perguntouSair()).toBe(true);
  });
  it("o campo inválido do navegador (evento invalid) também", async () => {
    await montarForm();
    await digitar($("[data-nome]"), "Hospital");
    await enviar();
    await act(async () => { $("[data-nome]")!.dispatchEvent(new Event("invalid", { cancelable: true })); });
    await clicar($("[data-sair]"));
    expect(perguntouSair()).toBe(true);
  });
  it("mexer depois do envio (o salvar não saiu da tela) também", async () => {
    await montarForm();
    await digitar($("[data-nome]"), "Hospital");
    await enviar();
    await digitar($("[data-nome]"), "Hospital Santa");
    await clicar($("[data-sair]"));
    expect(perguntouSair()).toBe(true);
  });
  it("Meu perfil: Descartar marca o formulário como salvo (sair não pergunta)", async () => {
    (window as any).happyDOM?.setURL("http://localhost:3000/perfil");
    const { PerfilClient } = await import("@/components/perfil/perfil-client");
    const initial = { nome: "Ana Fictícia", email: "ana@ficticio.test", telefone: "", avatar: null, empresaNome: "Clima Fictícia", perfilNome: null, cargo: "Administrador", ultimoAcesso: "2026-11-27T12:00:00.000Z" };
    await montar(createElement("div", null, createElement(PerfilClient as any, { initial }), createElement("a", { href: "/dashboard", "data-sair": "" }, "Painel")));
    await digitar($("[data-telefone]"), "(11) 90000-0000");
    const descartar = $$("button").find((b) => txt(b) === "Descartar");
    await clicar(descartar);
    await clicar($("[data-sair]"));
    expect(perguntouSair()).toBe(false);
  });
});

/* ═════════ F04 — contrato: Cancelar e Voltar são links ═════════ */
describe("F04 contrato: Cancelar passa pelo aviso de sair sem salvar", () => {
  it("com alteração, Cancelar pergunta (é um link para /contratos)", async () => {
    (window as any).happyDOM?.setURL("http://localhost:3000/contratos/novo");
    nav.caminho = "/contratos/novo";
    const [{ ProtegerSaida }, { ContratoForm }] = await Promise.all([import("@/components/ui/proteger-saida"), import("@/components/forms/contrato-form")]);
    await montar(createElement(ProtegerSaida, null, createElement(ContratoForm as any, { clientes: [], tecnicos: [] })));
    const cancelar = $$<HTMLAnchorElement>('a[href="/contratos"]').find((a) => txt(a) === "Cancelar");
    expect(cancelar, "Cancelar é link").toBeTruthy();
    await digitar($("[data-proteger-saida] input:not([type=hidden]):not([type=checkbox])"), "CT-99");
    avisos.confirmar.mockImplementation(async () => false);
    await clicar(cancelar);
    expect(perguntouSair()).toBe(true);
    expect(nav.push).not.toHaveBeenCalled();
  });
});

/* ═════════ F05 — painéis que gravam sozinhos ═════════ */
describe("F05 os painéis que gravam sozinhos não armam o aviso", () => {
  it("Acesso ao app dentro da ficha protegida: digitar a senha não faz sair perguntar", async () => {
    (window as any).happyDOM?.setURL("http://localhost:3000/colaboradores/t1/editar");
    const [{ ProtegerSaida }, { AcessoAppColaborador }] = await Promise.all([import("@/components/ui/proteger-saida"), import("@/components/forms/acesso-app-colaborador")]);
    await montar(createElement(ProtegerSaida, null, createElement("div", null,
      createElement(AcessoAppColaborador, { tecnicoId: "t1", emailSalvo: "joao@clima.test", inicial: { temLogin: false, acessoAtivo: true, role: null } }),
      createElement("a", { href: "/colaboradores", "data-sair": "" }, "Voltar"))));
    await digitar($("[data-acesso-senha]"), "Senha#2026");
    await clicar($("[data-sair]"));
    expect(perguntouSair()).toBe(false);
  });
  it("contatos, acesso ao portal e anexos do cliente: a raiz de cada um leva data-sem-aviso", async () => {
    responder = (u) => (u.endsWith("/contatos") ? { status: 200, corpo: [{ id: "ct1", nome: "Paula Compras", email: "compras@p.test", telefone: null, cargo: null, principal: true, temAcesso: false, trocarSenha: false, acessoConcedidoEm: null }] } : { status: 200, corpo: [] });
    const [{ ContatosManager }, { PortalContatos }, { AnexosManager }] = await Promise.all([
      import("@/components/forms/contatos-manager"), import("@/components/forms/portal-contatos"), import("@/components/forms/anexos-manager"),
    ]);
    await montar(createElement("div", null,
      createElement("div", { "data-p": "contatos" }, createElement(ContatosManager as any, { clienteId: "c1", contatosIniciais: [] })),
      createElement("div", { "data-p": "portal" }, createElement(PortalContatos as any, { clienteId: "c1", ativo: true, onGerenciar: () => {} })),
      createElement("div", { "data-p": "anexos" }, createElement(AnexosManager as any, { clienteId: "c1", anexosIniciais: [] }))));
    for (const p of ["contatos", "portal", "anexos"]) expect($(`[data-p="${p}"] > *`)?.hasAttribute("data-sem-aviso"), p).toBe(true);
  });
  it("endereços (locais) do cliente: a raiz também leva data-sem-aviso", async () => {
    const { UnidadesManager } = await import("@/components/forms/unidades-manager");
    await montar(createElement("div", { "data-p": "locais" }, createElement(UnidadesManager as any, { clienteId: "c1", unidadesIniciais: [] })));
    expect($(`[data-p="locais"] > *`)?.hasAttribute("data-sem-aviso")).toBe(true);
  });
});

/* ═════════ F07 + F12 — conferir o material de campo ═════════ */
describe("F07/F12 material de campo a conferir", () => {
  const CAP = { id: "iCap", descricao: "Capacitor 35 µF", quantidade: 2, valorUnitario: 60 };
  async function montarConferir(onConferido = vi.fn()) {
    const { MaterialCampoConferir } = await import("@/components/os/material-campo-conferir");
    await montar(createElement(MaterialCampoConferir, { osId: "os1", itens: [CAP], podeConferir: true, onConferido }));
    return onConferido;
  }
  it("F12: Excluir da cobrança pergunta; sem confirmar, nada vai ao servidor", async () => {
    await montarConferir();
    avisos.confirmar.mockImplementation(async () => false);
    await clicar($("[data-campo-remover]"));
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: "Excluir da cobrança?", confirmarTexto: "Excluir", perigo: true }));
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
    avisos.confirmar.mockImplementation(async () => true);
    responder = () => ({ status: 200, corpo: { ok: true, item: null } });
    await clicar($("[data-campo-remover]"));
    expect(chamadas.filter((c) => c.metodo === "POST").map((c) => c.corpo)).toEqual([{ acao: "remover" }]);
  });
  it("F07: o servidor pede o motivo do preço de tabela — o campo aparece e o motivo vai no próximo Confirmar", async () => {
    const onConferido = await montarConferir();
    responder = (_u, _m, corpo) => corpo?.motivoPrecoTabela
      ? { status: 200, corpo: { ok: true, item: { ...CAP, valorUnitario: 50, conferirCampo: false } } }
      : { status: 400, corpo: { erro: "Informe o motivo da alteração do preço de tabela (Capacitor 35 µF).", precoTabela: true } };
    await digitar($("[data-campo-preco]"), "50");
    expect($("[data-campo-motivo-preco]")).toBeNull();
    await clicar($("[data-campo-confirmar]"));
    expect(txt($("[data-erro-campo]"))).toContain("Informe o motivo");
    await digitar($("[data-campo-motivo-preco]"), "Desconto negociado");
    await clicar($("[data-campo-confirmar]"));
    expect(chamadas.filter((c) => c.metodo === "POST").at(-1)!.corpo).toEqual({ acao: "confirmar", quantidade: 2, valorUnitario: 50, motivoPrecoTabela: "Desconto negociado" });
    expect(onConferido).toHaveBeenCalledWith("iCap", expect.objectContaining({ valorUnitario: 50 }));
  });
});

/* ═════════ F11 — a reserva das colunas é do usuário ═════════ */
describe("F11 colunas da tabela no navegador compartilhado", () => {
  const COLUNAS = [{ id: "placa", titulo: "Placa", obrigatoria: true }, { id: "modelo", titulo: "Modelo" }];
  const LINHAS = [{ id: "v1", celulas: { placa: "ABC1D23", modelo: "Fiorino" } }];
  const cabecalhos = () => $$("thead th").map((t) => t.getAttribute("data-coluna"));
  it("a preferência deixada por outro usuário (chave sem usuário) não vale nem sobe; a do usuário fica na chave dele", async () => {
    localStorage.setItem("frivo:tabela:pj4", JSON.stringify({ larguras: {}, ocultas: ["modelo"] }));
    responder = () => ({ status: 200, corpo: { valor: null } });
    const { TabelaPro } = await import("@/components/listagem/tabela-pro");
    await montar(createElement(TabelaPro as any, { tela: "pj4", colunas: COLUNAS, linhas: LINHAS }), { usuarioId: "u1" });
    expect(cabecalhos()).toContain("modelo");
    expect(chamadas.filter((c) => c.metodo === "PUT")).toEqual([]);
    act(() => raiz!.unmount()); raiz = null;
    localStorage.setItem("frivo:tabela:pj4:u1", JSON.stringify({ larguras: {}, ocultas: ["modelo"] }));
    caixa.innerHTML = "";
    await montar(createElement(TabelaPro as any, { tela: "pj4", colunas: COLUNAS, linhas: LINHAS }), { usuarioId: "u1" });
    expect(cabecalhos()).not.toContain("modelo");
    const { chaveLocalTabela } = await import("@/components/listagem/tabela-pro");
    expect([chaveLocalTabela("tabela:x", "u9"), chaveLocalTabela("tabela:x", undefined)]).toEqual(["frivo:tabela:x:u9", "frivo:tabela:x"]);
  });
});

/* ═════════ F13/F14 — reajuste em massa ═════════ */
describe("F13/F14 reajuste em massa", () => {
  const linha = (d: string, de: number, para: number) => ({ descricao: d, antes: { valorFinal: de }, depois: { valorFinal: para } });
  it("F14: \"8,5\" (com vírgula) vale 8,5%; F13: aplicar avisa quantos itens foram reajustados", async () => {
    responder = (_u, _m, corpo) => ({ status: corpo?.previa ? 200 : 201, corpo: { ok: true, previa: !!corpo?.previa, linhas: [linha("Limpeza", 150, 162.75), linha("Capacitor", 60, 65.1)] } });
    const { ModalReajuste } = await import("@/components/cadastros/editores/reajuste-tabela");
    const onAplicado = vi.fn();
    await montar(createElement(ModalReajuste, { aberto: true, tabelaId: "t1", itemIds: [], onFechar: () => {}, onAplicado }));
    const campo = $<HTMLInputElement>("[data-valor-reajuste]")!;
    expect(campo.type).not.toBe("number");
    await digitar(campo, "8,5");
    await clicar($("[data-ver-previa]"));
    expect(chamadas.at(-1)!.corpo).toMatchObject({ tipo: "PERCENTUAL", valor: 8.5, previa: true });
    await digitar($("[data-motivo-reajuste]"), "Reajuste anual (IPCA)");
    await clicar($("[data-aplicar-reajuste]"));
    expect(chamadas.at(-1)!.corpo).toMatchObject({ valor: 8.5, previa: false });
    expect(avisos.toast).toHaveBeenCalledWith("Reajuste aplicado: 2 itens reajustados.");
    expect(onAplicado).toHaveBeenCalled();
  });
  it("F14: o sinal de menos continua reduzindo (\"-3,5\")", async () => {
    responder = () => ({ status: 200, corpo: { ok: true, previa: true, linhas: [] } });
    const { ModalReajuste } = await import("@/components/cadastros/editores/reajuste-tabela");
    await montar(createElement(ModalReajuste, { aberto: true, tabelaId: "t1", itemIds: [], onFechar: () => {}, onAplicado: () => {} }));
    await digitar($("[data-valor-reajuste]"), "-3,5");
    await clicar($("[data-ver-previa]"));
    expect(chamadas.at(-1)!.corpo).toMatchObject({ valor: -3.5 });
  });
  it("F13: desfazer avisa quantos itens voltaram ao preço anterior", async () => {
    responder = () => ({ status: 200, corpo: { ok: true, lote: {}, plano: { voltam: [{ descricao: "Limpeza", atual: 165, preco: { valorFinal: 150 } }], ignorados: [] } } });
    const { DesfazerReajuste } = await import("@/components/cadastros/editores/reajuste-tabela");
    const onDesfeito = vi.fn();
    await montar(createElement(DesfazerReajuste, { tabelaId: "t1", lote: { id: "l1", tipo: "PERCENTUAL", valor: 10, motivo: "Reajuste anual", criadoEm: "2026-11-20T12:00:00.000Z" }, onDesfeito }));
    await clicar($("[data-desfazer-reajuste]"));
    await clicar($("[data-confirmar-desfazer]"));
    expect(avisos.toast).toHaveBeenCalledWith("Reajuste desfeito: 1 item voltou ao preço anterior.");
    expect(onDesfeito).toHaveBeenCalled();
  });
});

/* ═════════ F15 / F16 — CEP ═════════ */
describe("F15/F16 o CEP", () => {
  it("F15: a consulta não respondeu — redigitar o mesmo CEP consulta de novo (e acha)", async () => {
    let fora = true;
    responder = (u) => (fora ? "falha" : { status: 200, corpo: u.includes("viacep") ? { cep: "01310-100", logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" } : {} });
    const { CampoCep, DICA_CEP } = await import("@/components/ui/campo-cep");
    const achou = vi.fn();
    const Tela = () => { const [valor, setValor] = useState(""); return createElement(CampoCep, { valor, onValor: setValor, onEndereco: achou }); };
    await montar(createElement(Tela));
    await digitar($("[data-campo='cep']"), "01310100");
    expect(document.body.textContent).toContain(DICA_CEP.indisponivel);
    const consultas = chamadas.length;
    fora = false;
    await digitar($("[data-campo='cep']"), "0131010");
    await digitar($("[data-campo='cep']"), "01310100");
    expect(chamadas.length).toBeGreaterThan(consultas);
    expect(achou).toHaveBeenCalledWith(expect.objectContaining({ logradouro: "Avenida Paulista" }));
  });

  const CAMPOS = [{ nome: "cep", label: "CEP", tipo: "cep" }, { nome: "logradouro", label: "Endereço" }];
  async function abrirRapido() {
    const { CadastroRapidoModal } = await import("@/components/ui/select-cadastro-rapido");
    await montar(createElement(CadastroRapidoModal as any, { aberto: true, onFechar: () => {}, titulo: "Novo local", campos: CAMPOS, onCriado: () => {}, criar: async () => ({ value: "x", label: "x" }) }));
    return $<HTMLInputElement>('[role="dialog"] input[inputmode="numeric"]');
  }
  it("F16: CEP que não existe e consulta fora do ar: a mesma frase do campo de CEP", async () => {
    const { DICA_CEP } = await import("@/components/ui/campo-cep");
    responder = () => ({ status: 404, corpo: {} });
    const cep = await abrirRapido();
    await digitar(cep, "99999999");
    expect(txt($("[data-dica-cep]"))).toBe(DICA_CEP.naoEncontrado);
    responder = () => "falha";
    await digitar(cep, "88888888");
    expect(txt($("[data-dica-cep]"))).toBe(DICA_CEP.indisponivel);
    await digitar(cep, "8888");
    expect($("[data-dica-cep]")).toBeNull();
  });
  it("F16: a resposta que chega depois de trocar o CEP não preenche o endereço", async () => {
    let soltar: (() => void) | null = null;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const corpo = String(url).includes("01310100") ? { cep: "01310-100", logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" } : { erro: true };
      const resp = () => new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
      if (String(url).includes("01310100")) return new Promise<Response>((r) => { soltar = () => r(resp()); });
      return Promise.resolve(resp());
    }));
    const cep = await abrirRapido();
    await digitar(cep, "01310100"); // fica esperando
    await digitar(cep, "0131"); // trocou
    await act(async () => { soltar?.(); });
    await esperar();
    const endereco = $$<HTMLInputElement>('[role="dialog"] input').find((i) => i !== cep && i.getAttribute("inputmode") !== "numeric")!;
    expect(endereco.value).toBe("");
  });
});

/* ═════════ F19 — /ordens "Sem agendamento" ═════════ */
describe("F19 /ordens com o filtro Sem agendamento", () => {
  async function montarOrdens(qs: string) {
    nav.qs = qs; nav.caminho = "/ordens";
    const [{ OrdensListaClient }, { periodoTela }, { periodoOrdens }, { SelecaoMassaProvider }] = await Promise.all([
      import("@/components/ordens/ordens-lista-client"), import("@/lib/periodo"), import("@/lib/listas/filtros"), import("@/components/acoes-massa/selecao"),
    ]);
    const periodo = periodoTela(periodoOrdens(Object.fromEntries(new URLSearchParams(qs).entries()), new Date("2026-11-04T15:00:00Z")));
    await montar(createElement(SelecaoMassaProvider as any, { entidade: "ordens", idsPagina: [], total: 0, children:
      createElement(OrdensListaClient as any, { ordens: [], total: 0, pagina: 1, porPagina: 50, periodo, opcoes: { clientes: [], usuarios: [], tiposOs: [], contratos: [] } }) }));
  }
  const tecla = (key: string) => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
  it("sem o filtro, a barra do período e as setas; com agenda=sem, a barra sai e ← não navega", async () => {
    await montarOrdens("");
    expect($("[data-periodo]")).not.toBeNull();
    act(() => raiz!.unmount()); raiz = null; caixa.innerHTML = "";
    await montarOrdens("agenda=sem");
    expect($("[data-periodo]")).toBeNull();
    expect($("[data-mes-anterior]")).toBeNull();
    await tecla("ArrowLeft"); await tecla("t");
    await esperar();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

/* ═════════ F23 — editar empresa sem os dados ═════════ */
describe("F23 editar empresa (dono do Frivo): a leitura falhou", () => {
  it("o erro aparece e Salvar fica desligado (não grava campos vazios por cima)", async () => {
    responder = () => ({ status: 500, corpo: { erro: "Não foi possível carregar a empresa." } });
    const { EmpresasAdmin } = await import("@/components/admin/empresas-admin");
    const EMPRESAS = [{ id: "e2", nome: "Refrigeração Aurora Ltda (fictícia)", nomeFantasia: "Aurora Clima", cnpj: "11.222.333/0001-81", ativo: true, criadoEm: "2026-11-27T12:00:00.000Z", usuarios: 1 }];
    await montar(createElement(EmpresasAdmin, { inicial: EMPRESAS, empresaDoDono: "e1" }), { role: "SUPER_ADMIN" });
    await clicar($('[data-editar-empresa="e2"]'));
    expect(txt($("[data-erro-editar-empresa]"))).toContain("Não foi possível carregar a empresa.");
    expect($<HTMLButtonElement>("[data-salvar-empresa]")!.disabled).toBe(true);
    await act(async () => { ($("[data-form-editar-empresa]") as HTMLFormElement).requestSubmit(); });
    await esperar();
    expect(chamadas.filter((c) => c.metodo === "PUT")).toEqual([]);
  });
});
