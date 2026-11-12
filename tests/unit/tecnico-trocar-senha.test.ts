// @vitest-environment happy-dom
/**
 * O técnico troca a PRÓPRIA senha pelo app — em UM lugar só: Perfil › Meus dados › Segurança (o card
 * "Trocar senha" solto no Perfil saiu: era a mesma função duas vezes).
 * A rota (/api/perfil/senha) já existia e não foi alterada: aqui prova-se que ela serve ao técnico
 * (papel TECNICO) com as mesmas regras — senha atual obrigatória, senha forte, só a própria, guardada
 * como hash bcrypt — e que, pelo caminho que ficou, nada se perdeu: a tela manda só o que deve,
 * valida antes de enviar, mostra os erros do servidor e, sem sinal, avisa e mantém o que foi digitado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import type { EstadoSync } from "@/lib/tecnico/offline/motor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/* ───────── servidor: a rota real, com um "banco" mínimo ───────── */
const SENHA_ANTIGA = "Antiga-123";
const banco = vi.hoisted(() => ({ usuarios: [] as { id: string; senha: string; role: string }[], updates: [] as any[] }));
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: async () => sessao.atual }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    usuario: {
      findUnique: async ({ where }: any) => banco.usuarios.find((u) => u.id === where.id) ?? null,
      update: async ({ where, data }: any) => { banco.updates.push({ where, data }); const u = banco.usuarios.find((x) => x.id === where.id)!; Object.assign(u, data); return u; },
    },
  },
}));
vi.mock("@/lib/acesso/limite", () => ({ conferirBloqueio: async () => ({ bloqueado: false }), limparTentativas: async () => {}, registrarTentativa: async () => [] }));
vi.mock("@/lib/acesso/sessao-cookie", () => ({ regravarSessaoAtual: async () => true }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));

async function trocarNoServidor(corpo: unknown) {
  const { PATCH } = await import("@/app/api/perfil/senha/route");
  const res = await PATCH(new NextRequest("http://localhost/api/perfil/senha", { method: "PATCH", body: JSON.stringify(corpo), headers: { "content-type": "application/json" } }));
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  const hash = await bcrypt.hash(SENHA_ANTIGA, 4);
  banco.usuarios = [{ id: "uTec", senha: hash, role: "TECNICO" }, { id: "uOutro", senha: hash, role: "TECNICO" }];
  banco.updates = [];
  sessao.atual = { user: { id: "uTec", empresaId: "e1", role: "TECNICO", permissoes: { ordens: { visualizar: true, editar: true } } } };
});

describe("servidor: a rota que já existia serve ao técnico, só para a PRÓPRIA senha", () => {
  it("técnico troca a própria senha: guardada como hash bcrypt (nunca o texto); a antiga deixa de valer", async () => {
    const r = await trocarNoServidor({ senhaAtual: SENHA_ANTIGA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect(r).toEqual({ status: 200, json: { ok: true } });
    const eu = banco.usuarios.find((u) => u.id === "uTec")!;
    expect(eu.senha).toMatch(/^\$2[aby]\$12\$/); // bcrypt, custo 12
    expect(eu.senha).not.toContain("Nova-senha9");
    expect(await bcrypt.compare("Nova-senha9", eu.senha)).toBe(true);
    expect(await bcrypt.compare(SENHA_ANTIGA, eu.senha)).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain("Nova-senha9"); // a resposta não devolve a senha
  });

  it("só a própria: quem é trocado vem da SESSÃO — id/usuário no corpo é recusado e o outro técnico não muda", async () => {
    const outroAntes = banco.usuarios.find((u) => u.id === "uOutro")!.senha;
    for (const extra of [{ usuarioId: "uOutro" }, { id: "uOutro" }, { userId: "uOutro" }, { email: "outro@x.com" }]) {
      expect((await trocarNoServidor({ senhaAtual: SENHA_ANTIGA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9", ...extra })).status, JSON.stringify(extra)).toBe(400);
    }
    expect(banco.updates).toEqual([]);
    await trocarNoServidor({ senhaAtual: SENHA_ANTIGA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect(banco.updates.map((u) => u.where)).toEqual([{ id: "uTec" }]);
    expect(banco.usuarios.find((u) => u.id === "uOutro")!.senha).toBe(outroAntes);
  });

  it("mesma força mínima do sistema e senha atual obrigatória; sem sessão não troca", async () => {
    const antes = banco.usuarios[0].senha;
    expect((await trocarNoServidor({ senhaAtual: SENHA_ANTIGA, novaSenha: "curta1", confirmar: "curta1" })).json.erro).toBe("A senha precisa ter pelo menos 8 caracteres.");
    expect((await trocarNoServidor({ senhaAtual: SENHA_ANTIGA, novaSenha: "somenteletras", confirmar: "somenteletras" })).json.erro).toBe("A senha precisa ter pelo menos um número.");
    expect((await trocarNoServidor({ senhaAtual: SENHA_ANTIGA, novaSenha: "12345678", confirmar: "12345678" })).json.erro).toBe("A senha precisa ter pelo menos uma letra.");
    expect(await trocarNoServidor({ senhaAtual: "errada-999", novaSenha: "Nova-senha9", confirmar: "Nova-senha9" })).toEqual({ status: 400, json: { erro: "Senha atual incorreta." } });
    expect((await trocarNoServidor({ novaSenha: "Nova-senha9", confirmar: "Nova-senha9" })).status).toBe(400);
    sessao.atual = null;
    expect((await trocarNoServidor({ senhaAtual: SENHA_ANTIGA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" })).status).toBe(401);
    expect(banco.usuarios[0].senha).toBe(antes);
  });
});

/* ───────── tela do app: Perfil › Meus dados › Segurança ───────── */
describe("app do técnico › Perfil › Meus dados › Segurança (o único lugar da troca de senha)", () => {
  let root: Root; let caixa: HTMLDivElement;
  let chamadas: { url: string; init: RequestInit }[];
  let responder: () => Response | Promise<Response>;
  const estado = (situacao: EstadoSync["situacao"]): EstadoSync => ({ situacao, pendentes: 0, erros: 0, ultimoSync: null, versao: 0 });
  const motorFalso = (situacao: EstadoSync["situacao"]) => ({ assinar: (fn: (e: EstadoSync) => void) => { fn(estado(situacao)); return () => {}; }, banco: { fila: async () => [], retratos: async () => [] } }) as any;

  beforeEach(() => {
    chamadas = [];
    responder = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return responder(); }));
  });
  afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const esperar = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 3)); }); };
  const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
  const digitar = async (el: Element | null | undefined, v: string) => {
    expect(el).toBeTruthy();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const botoes = (rotulo: string) => [...caixa.querySelectorAll<HTMLButtonElement>("button")].filter((b) => texto(b) === rotulo);
  const visivel = (el: Element) => !el.closest(".hidden");
  /** Os campos de senha da aba Segurança (a aba "Dados pessoais" fica escondida, com o estado preservado) */
  const campos = () => [...caixa.querySelectorAll<HTMLInputElement>("[data-meus-dados-app] input[type='password']")].filter(visivel);
  const erro = () => texto(caixa.querySelector("[data-meus-dados-app] .bg-atrasado-claro")) || null;

  async function abrirPerfil(situacao: EstadoSync["situacao"] = "sincronizado") {
    const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
    const { PerfilTecnico } = await import("@/components/tecnico/perfil");
    caixa = document.createElement("div"); document.body.appendChild(caixa);
    root = createRoot(caixa);
    const perfilInicial = { nome: "João", email: "j@x.com", avatar: null, empresaNome: "Clima", perfilNome: null, cargo: "Técnico" } as any;
    await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: { id: "uTec", nome: "João", email: "j@x.com", empresaNome: "Clima", podeGravar: true }, motorPronto: motorFalso(situacao), children: createElement(PerfilTecnico, { perfilInicial }) })); });
    await esperar();
  }
  async function abrirSeguranca(situacao: EstadoSync["situacao"] = "sincronizado") {
    await abrirPerfil(situacao);
    await clicar(botoes("Meus dados")[0]);
    await clicar(botoes("Segurança")[0]);
    expect(campos()).toHaveLength(3);
  }
  const preencher = async (atual: string, nova: string, confirmar: string) => {
    const [a, n, c] = campos();
    await digitar(a, atual); await digitar(n, nova); await digitar(c, confirmar);
  };
  /** "Trocar senha" do rodapé do formulário (há também o da faixa de cima: os dois fazem o mesmo) */
  const enviar = async () => { await clicar(botoes("Trocar senha").at(-1)); };

  it("o card solto saiu do Perfil: 'Trocar senha' não aparece até abrir Meus dados › Segurança", async () => {
    await abrirPerfil();
    expect(caixa.querySelector("[data-trocar-senha]")).toBeNull();
    expect(texto(caixa)).not.toContain("Trocar senha");
    expect(caixa.querySelectorAll("input[type='password']")).toHaveLength(0);
    await clicar(botoes("Meus dados")[0]);
    await clicar(botoes("Segurança")[0]);
    expect(botoes("Trocar senha").length).toBeGreaterThan(0);
  });

  it("em Segurança: senha atual, nova (requisitos ao vivo) e confirmação — campos de senha, nunca texto", async () => {
    await abrirSeguranca();
    expect(campos().map((c) => [c.type, c.autocomplete])).toEqual([["password", "current-password"], ["password", "new-password"], ["password", "new-password"]]);
    await digitar(campos()[1], "abc");
    expect([...caixa.querySelectorAll("[data-meus-dados-app] [data-requisito]")].filter(visivel).map((r) => [r.getAttribute("data-requisito"), r.getAttribute("data-ok")]))
      .toEqual([["tamanho", "false"], ["letra", "true"], ["numero", "false"]]);
  });

  it("no app, tudo o que se toca em Meus dados tem pelo menos 44 px (abas, campos e botões)", async () => {
    await abrirSeguranca();
    const area = caixa.querySelector("[data-meus-dados-app]")!;
    expect(area.className).toContain("[&_button]:min-h-[44px]");
    expect(area.className).toContain("[&_input]:min-h-[44px]");
    // A aba, os três campos e o botão de trocar estão todos dentro dessa área
    for (const el of [botoes("Segurança")[0], ...campos(), ...botoes("Trocar senha")]) expect(area.contains(el)).toBe(true);
  });

  it("valida antes de enviar (mesma regra do sistema): nada sai para o servidor com senha fraca, confirmação diferente ou igual à atual", async () => {
    await abrirSeguranca();
    await enviar();
    expect(erro()).toBe("Informe a senha atual.");
    await preencher(SENHA_ANTIGA, "curta1", "curta1"); await enviar();
    expect(erro()).toBe("A senha precisa ter pelo menos 8 caracteres.");
    await preencher(SENHA_ANTIGA, "somenteletras", "somenteletras"); await enviar();
    expect(erro()).toBe("A senha precisa ter pelo menos um número.");
    await preencher(SENHA_ANTIGA, "Nova-senha9", "Nova-senha8"); await enviar();
    expect(erro()).toBe("A confirmação da nova senha não coincide.");
    await preencher(SENHA_ANTIGA, SENHA_ANTIGA, SENHA_ANTIGA); await enviar();
    expect(erro()).toBe("A nova senha precisa ser diferente da atual.");
    expect(chamadas).toEqual([]);
  });

  it("envia só senha atual + nova + confirmação (sem id de ninguém); deu certo: avisa e limpa os campos", async () => {
    const avisos = await import("@/components/ui/avisos");
    const toast = vi.spyOn(avisos, "toast").mockImplementation(() => {});
    await abrirSeguranca();
    await preencher(SENHA_ANTIGA, "Nova-senha9", "Nova-senha9"); await enviar();
    expect(chamadas.length).toBe(1);
    expect(chamadas[0].url).toBe("/api/perfil/senha");
    expect(chamadas[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({ senhaAtual: SENHA_ANTIGA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Senha alterada"));
    expect(erro()).toBeNull();
    expect(campos().map((c) => c.value)).toEqual(["", "", ""]);
  });

  it("o botão da faixa de cima faz o mesmo que o do rodapé", async () => {
    vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
    await abrirSeguranca();
    expect(botoes("Trocar senha")).toHaveLength(2);
    await preencher(SENHA_ANTIGA, "Nova-senha9", "Nova-senha9");
    await clicar(botoes("Trocar senha")[0]);
    expect(chamadas.map((c) => c.url)).toEqual(["/api/perfil/senha"]);
  });

  it("o servidor recusou (senha atual errada, muitas tentativas): mostra o motivo e mantém o que foi digitado", async () => {
    responder = () => new Response(JSON.stringify({ erro: "Senha atual incorreta." }), { status: 400, headers: { "content-type": "application/json" } });
    await abrirSeguranca();
    await preencher("errada-999", "Nova-senha9", "Nova-senha9"); await enviar();
    expect(erro()).toBe("Senha atual incorreta.");
    expect(campos().map((c) => c.value)).toEqual(["errada-999", "Nova-senha9", "Nova-senha9"]);
  });

  it("sem sinal: avisa que não deu, não trava o app e mantém o que foi digitado (senha não entra na fila do aparelho)", async () => {
    responder = () => Promise.reject(new TypeError("Failed to fetch"));
    await abrirSeguranca("offline");
    await preencher(SENHA_ANTIGA, "Nova-senha9", "Nova-senha9"); await enviar();
    expect(erro()).toBe("Erro de conexão.");
    expect(campos().map((c) => c.value)).toEqual([SENHA_ANTIGA, "Nova-senha9", "Nova-senha9"]);
    expect(botoes("Trocar senha").at(-1)!.disabled).toBe(false); // dá para tentar de novo quando o sinal voltar
  });

  it("fluxo inteiro tela → rota real: a senha do técnico muda no banco como hash", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const r = await trocarNoServidor(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
    }));
    vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
    await abrirSeguranca();
    await preencher(SENHA_ANTIGA, "Nova-senha9", "Nova-senha9"); await enviar();
    expect(erro()).toBeNull();
    expect(await bcrypt.compare("Nova-senha9", banco.usuarios.find((u) => u.id === "uTec")!.senha)).toBe(true);
  });
});
