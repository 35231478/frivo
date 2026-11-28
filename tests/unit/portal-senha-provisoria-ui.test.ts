// @vitest-environment happy-dom
/**
 * Portal do cliente: senha provisória segura NA TELA.
 *  - Escritório (Cliente › Portal): não há campo de senha; "Liberar acesso" gera a senha, que aparece UMA vez com
 *    Copiar e vai no convite (e-mail e WhatsApp) com o aviso da troca; reabriu, ela não aparece mais e há
 *    "Gerar nova senha provisória" (pede confirmação).
 *  - Portal (1º acesso): a tela de troca valida, manda a senha recebida e a nova, segue para o portal; Sair.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const avisos = vi.hoisted(() => ({ confirma: true, perguntas: [] as string[] }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  confirmar: vi.fn(async (o: { mensagem: string }) => { avisos.perguntas.push(o.mensagem); return avisos.confirma; }),
}));
const sair = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/app/(portal)/portal/actions", () => ({ portalLogout: vi.fn(async () => { sair.n++; }), portalLogin: vi.fn() }));

let raiz: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};
let copiado: string[] = [];
let foiPara: string[] = [];
beforeEach(() => {
  pedidos = []; respostas = {}; copiado = []; foiPara = []; avisos.confirma = true; avisos.perguntas = []; sair.n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { copiado.push(t); } } });
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, origin: "https://app.exemplo.test", assign: (u: string) => { foiPara.push(u); } } });
  caixa = document.createElement("div"); document.body.appendChild(caixa); raiz = createRoot(caixa);
});
afterEach(() => { act(() => raiz.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

const esperar = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const $ = (s: string) => caixa.querySelector(s) as HTMLElement | null;
const texto = (el: Element | null = caixa) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const botao = (t: string) => [...caixa.querySelectorAll("button")].find((b) => texto(b).includes(t)) as HTMLButtonElement | undefined;
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const digitar = async (el: HTMLInputElement | null, v: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
};
const URL_ACESSO = "/api/clientes/cli1/contatos/ct1/acesso-portal";

async function montarAcesso(temAcesso: boolean) {
  const { PortalAcessoContato } = await import("@/components/forms/portal-acesso-contato");
  await act(async () => {
    raiz.render(createElement(PortalAcessoContato, { clienteId: "cli1", contatoId: "ct1", contatoNome: "Paula Fictícia", emailInicial: "paula@clinica.test", whatsappInicial: "(62) 90000-0001", temAcesso }));
  });
  await clicar(botao(temAcesso ? "Gerenciar acesso ao portal" : "Dar acesso ao portal"));
}

describe("escritório: liberar o acesso ao portal", () => {
  it("não há campo de senha: só o e-mail e as permissões", async () => {
    await montarAcesso(false);
    const campos = [...caixa.querySelectorAll("input")].filter((i) => i.type !== "checkbox");
    expect(campos.map((i) => i.type)).toEqual(["email"]);
    expect(texto()).not.toMatch(/Senha temporária|Nova senha \(opcional\)/);
    expect(botao("Liberar acesso")).toBeTruthy();
  });

  it("'Liberar acesso': a senha gerada aparece UMA vez, com Copiar, e vai no convite com o aviso da troca", async () => {
    respostas[`PUT ${URL_ACESSO}`] = { status: 200, corpo: { temAcesso: true, senhaProvisoria: "Abc23456defg", acessoConcedidoEm: "2026-11-27T12:00:00Z" } };
    await montarAcesso(false);
    await clicar(botao("Liberar acesso"));
    expect(pedidos[0].corpo).not.toHaveProperty("senha");
    expect(pedidos[0].corpo.email).toBe("paula@clinica.test");
    expect(texto($("[data-senha-gerada]"))).toBe("Abc23456defg");
    expect(texto($("[data-senha-provisoria]"))).toContain("Aparece só agora. O contato cria a própria senha no 1º acesso.");
    await clicar($("[data-copiar-senha]"));
    expect(copiado).toEqual(["Abc23456defg"]);
    expect(texto($("[data-copiar-senha]"))).toBe("Copiada");
    const mail = decodeURIComponent(($("[data-convite-email]") as HTMLAnchorElement).href);
    const wpp = decodeURIComponent(($("[data-convite-whatsapp]") as HTMLAnchorElement).href);
    for (const m of [mail, wpp]) {
      expect(m).toContain("Senha provisória: Abc23456defg");
      expect(m).toContain("No primeiro acesso, o portal pede para criar uma senha própria.");
      expect(m).toContain("https://app.exemplo.test/portal/login");
    }
    expect(wpp).toContain("wa.me/5562900000001");
  });

  it("acesso que já existe: a senha NÃO aparece (não fica guardada); 'Gerar nova senha provisória' pede confirmação e mostra a nova uma vez", async () => {
    await montarAcesso(true);
    expect($("[data-senha-gerada]")).toBeNull();
    expect(texto($("[data-senha-nao-exibida]"))).toBe("Não fica guardada. Para enviar uma senha ao contato, gere uma nova.");
    expect(decodeURIComponent(($("[data-convite-whatsapp]") as HTMLAnchorElement).href)).not.toContain("Senha");
    avisos.confirma = false;
    await clicar($("[data-gerar-senha]"));
    expect(pedidos).toEqual([]); // cancelou: nada muda
    expect(avisos.perguntas[0]).toContain("A senha atual deixa de valer");
    avisos.confirma = true;
    respostas[`POST ${URL_ACESSO}`] = { status: 200, corpo: { temAcesso: true, senhaProvisoria: "Nova2345fghk" } };
    await clicar($("[data-gerar-senha]"));
    expect(pedidos.map((p) => p.metodo)).toEqual(["POST"]);
    expect(texto($("[data-senha-gerada]"))).toBe("Nova2345fghk");
  });

  it("salvar só as permissões de um acesso existente: nenhuma senha aparece", async () => {
    respostas[`PUT ${URL_ACESSO}`] = { status: 200, corpo: { temAcesso: true, senhaProvisoria: null } };
    await montarAcesso(true);
    await clicar(botao("Salvar acesso"));
    expect($("[data-senha-gerada]")).toBeNull();
    expect(texto()).toContain("Acesso atualizado.");
  });
});

describe("portal: a tela de troca no 1º acesso", () => {
  async function montarTroca() {
    const { PortalTrocarSenhaForm } = await import("@/components/portal/portal-trocar-senha-form");
    await act(async () => { raiz.render(createElement(PortalTrocarSenhaForm, { nome: "Paula Fictícia", email: "paula@clinica.test" })); });
  }
  const preencher = async (atual: string, nova: string, conf: string) => {
    await digitar($("[data-senha-atual]") as HTMLInputElement, atual);
    await digitar($("[data-senha-nova]") as HTMLInputElement, nova);
    await digitar($("[data-senha-confirmar]") as HTMLInputElement, conf);
  };
  const salvar = async () => { await act(async () => { ($("[data-portal-trocar-senha]") as HTMLFormElement).requestSubmit(); }); await esperar(); };

  it("diz de quem é a conta e que a senha veio da empresa; botões com alvo de toque ≥ 44 px", async () => {
    await montarTroca();
    expect(texto()).toContain("Crie a sua senha, Paula");
    expect(texto()).toContain("A senha de paula@clinica.test foi gerada pela empresa.");
    for (const s of ["[data-salvar-senha]", "[data-sair]"]) expect($(s)!.className).toContain("min-h-[44px]");
  });

  it("valida antes de enviar: sem a recebida, nova fraca, confirmação diferente, nova igual à recebida", async () => {
    await montarTroca();
    for (const [a, n, c, msg] of [
      ["", "MinhaSenha1", "MinhaSenha1", "Informe a senha recebida."],
      ["Abc23456defg", "curta", "curta", "A senha precisa ter pelo menos 8 caracteres."],
      ["Abc23456defg", "MinhaSenha1", "MinhaSenha2", "A confirmação não confere com a nova senha."],
      ["Abc23456defg", "Abc23456defg", "Abc23456defg", "A nova senha precisa ser diferente da recebida."],
    ]) {
      await preencher(a, n, c); await salvar();
      expect(texto($("[data-erro-troca]")), msg).toBe(msg);
    }
    expect(pedidos).toEqual([]);
  });

  it("trocou: manda a recebida e a nova e segue para o portal; erro do servidor aparece e fica na tela", async () => {
    await montarTroca();
    respostas["PATCH /api/portal/senha"] = { status: 400, corpo: { erro: "Senha recebida incorreta." } };
    await preencher("Errada23456x", "MinhaSenha1", "MinhaSenha1"); await salvar();
    expect(texto($("[data-erro-troca]"))).toBe("Senha recebida incorreta.");
    expect(foiPara).toEqual([]);
    respostas["PATCH /api/portal/senha"] = { status: 200, corpo: { ok: true } };
    await preencher("Abc23456defg", "MinhaSenha1", "MinhaSenha1"); await salvar();
    expect(pedidos.at(-1)).toEqual({ url: "/api/portal/senha", metodo: "PATCH", corpo: { senhaAtual: "Abc23456defg", novaSenha: "MinhaSenha1", confirmar: "MinhaSenha1" } });
    expect(foiPara).toEqual(["/portal/dashboard"]);
  });

  it("Sair encerra a sessão do portal", async () => {
    await montarTroca();
    await clicar($("[data-sair]"));
    expect(sair.n).toBe(1);
  });
});

/* ───────── Pronto pra janeiro 3: as pontas soltas da aba Portal ───────── */
describe("pronto-janeiro-3: Cliente › Portal", () => {
  async function montarLista(contatos: unknown[], onAcessoLiberado = vi.fn()) {
    const { PortalContatos } = await import("@/components/forms/portal-contatos");
    respostas["GET /api/clientes/cli1/contatos"] = { status: 200, corpo: contatos };
    await act(async () => { raiz.render(createElement(PortalContatos, { clienteId: "cli1", ativo: true, onGerenciar: () => {}, onAcessoLiberado })); });
    await esperar();
    return onAcessoLiberado;
  }
  it("liberar o acesso avisa a ficha (a chave \"Portal ativo\" liga, como o servidor) e o contato fica \"Aguardando 1º acesso\"", async () => {
    const aviso = await montarLista([{ id: "ct1", nome: "Paula Fictícia", email: "paula@clinica.test", temAcesso: false }]);
    expect($("[data-situacao-portal]")!.getAttribute("data-situacao-portal")).toBe("sem");
    respostas[`PUT ${URL_ACESSO}`] = { status: 200, corpo: { temAcesso: true, senhaProvisoria: "Prov-2026ab", acessoConcedidoEm: "2026-11-27T12:00:00.000Z" } };
    await clicar(botao("Dar acesso ao portal"));
    await clicar($("[data-salvar-acesso]"));
    expect(aviso).toHaveBeenCalled();
    expect(texto($("[data-situacao-portal]"))).toBe("Aguardando 1º acesso");
  });
  it("quem já entrou e criou a senha: \"Acesso ativo\"; quem ainda não: \"Aguardando 1º acesso\"", async () => {
    await montarLista([
      { id: "ct1", nome: "Paula", email: "p@x.test", temAcesso: true, trocarSenha: false },
      { id: "ct2", nome: "Rafael", email: "r@x.test", temAcesso: true, trocarSenha: true },
    ]);
    expect([...caixa.querySelectorAll("[data-situacao-portal]")].map((e) => texto(e))).toEqual(["Acesso ativo", "Aguardando 1º acesso"]);
  });
  it("revogar que falha mostra o motivo (antes: nada acontecia)", async () => {
    await montarAcesso(true);
    respostas[`DELETE ${URL_ACESSO}`] = { status: 403, corpo: { erro: "Sem permissão para editar clientes." } };
    await clicar(botao("Revogar"));
    expect(texto(caixa)).toContain("Sem permissão para editar clientes.");
    expect($("[data-fechar-acesso]")!.className).toContain("min-h-[44px]");
  });
});
