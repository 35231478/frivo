// @vitest-environment happy-dom
/**
 * Tema 2 — o técnico troca a PRÓPRIA senha no Perfil do app.
 * A rota (/api/perfil/senha) já existia e não foi alterada: aqui prova-se que ela serve ao técnico
 * (papel TECNICO) com as mesmas regras — senha atual obrigatória, senha forte, só a própria, guardada
 * como hash bcrypt — e que a tela do app manda só o que deve, mostra os erros e pede sinal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import type { EstadoSync } from "@/lib/tecnico/offline/motor";

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

/* ───────── tela do app ───────── */
describe("app do técnico › Perfil › Trocar senha", () => {
  let root: Root; let caixa: HTMLDivElement;
  let chamadas: { url: string; init: RequestInit }[];
  let responder: () => Response;
  const estado = (situacao: EstadoSync["situacao"]): EstadoSync => ({ situacao, pendentes: 0, erros: 0, ultimoSync: null, versao: 0 });
  const motorFalso = (situacao: EstadoSync["situacao"]) => ({ assinar: (fn: (e: EstadoSync) => void) => { fn(estado(situacao)); return () => {}; }, banco: { fila: async () => [], retratos: async () => [] } }) as any;

  beforeEach(() => {
    chamadas = [];
    responder = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return responder(); }));
  });
  afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const $ = <T extends Element = HTMLElement>(s: string) => caixa.querySelector(s) as T | null;
  const esperar = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 3)); }); };
  const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
  const digitar = async (el: Element | null, v: string) => {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  async function montar(situacao: EstadoSync["situacao"] = "sincronizado", filho?: any) {
    const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
    const { TrocarSenha } = await import("@/components/tecnico/trocar-senha");
    caixa = document.createElement("div"); document.body.appendChild(caixa);
    root = createRoot(caixa);
    await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: { id: "uTec", nome: "João", email: "j@x.com", empresaNome: "Clima", podeGravar: true }, motorPronto: motorFalso(situacao), children: filho ?? createElement(TrocarSenha) })); });
    await esperar();
  }
  const preencher = async (atual: string, nova: string, confirmar: string) => {
    await digitar($("[data-senha-atual]"), atual); await digitar($("[data-senha-nova]"), nova); await digitar($("[data-senha-confirmar]"), confirmar);
  };
  const enviar = async () => { await act(async () => { $("[data-trocar-senha] form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await esperar(); };

  it("está no Perfil do app, com alvo de toque ≥44px; abre com senha atual, nova (requisitos ao vivo) e confirmação — campos de senha, nunca texto", async () => {
    const { PerfilTecnico } = await import("@/components/tecnico/perfil");
    await montar("sincronizado", createElement(PerfilTecnico, { perfilInicial: { nome: "João", email: "j@x.com", avatar: null, empresaNome: "Clima", perfilNome: null, cargo: "Técnico" } as any }));
    const abrir = $("[data-trocar-senha] > button")!;
    expect(abrir.textContent).toContain("Trocar senha");
    expect(abrir.className).toContain("touch-target");
    expect($("[data-trocar-senha] form")).toBeNull(); // fechado até tocar (não polui o Perfil)
    await clicar(abrir);
    const campos = [...caixa.querySelectorAll<HTMLInputElement>("[data-trocar-senha] input")];
    expect(campos.map((c) => [c.type, c.autocomplete])).toEqual([["password", "current-password"], ["password", "new-password"], ["password", "new-password"]]);
    for (const c of campos) expect(c.className).toContain("touch-target");
    await digitar($("[data-senha-nova]"), "abc");
    expect([...caixa.querySelectorAll("[data-trocar-senha] [data-requisito]")].map((r) => [r.getAttribute("data-requisito"), r.getAttribute("data-ok")])).toEqual([["tamanho", "false"], ["letra", "true"], ["numero", "false"]]);
  });

  it("valida antes de enviar (mesma regra do sistema): nada sai para o servidor com senha fraca, confirmação diferente ou igual à atual", async () => {
    await montar(); await clicar($("[data-trocar-senha] > button"));
    const erro = () => $("[data-erro-senha]")?.textContent ?? null;
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

  it("envia só senha atual + nova + confirmação (sem id de ninguém); deu certo: avisa, limpa os campos e fecha", async () => {
    const avisos = await import("@/components/ui/avisos");
    const toast = vi.spyOn(avisos, "toast").mockImplementation(() => {});
    await montar(); await clicar($("[data-trocar-senha] > button"));
    await preencher(SENHA_ANTIGA, "Nova-senha9", "Nova-senha9"); await enviar();
    expect(chamadas.length).toBe(1);
    expect(chamadas[0].url).toBe("/api/perfil/senha");
    expect(chamadas[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({ senhaAtual: SENHA_ANTIGA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Senha alterada"));
    expect($("[data-trocar-senha] form")).toBeNull();
    await clicar($("[data-trocar-senha] > button"));
    expect([...caixa.querySelectorAll<HTMLInputElement>("[data-trocar-senha] input")].map((c) => c.value)).toEqual(["", "", ""]);
  });

  it("o servidor recusou (senha atual errada, muitas tentativas): mostra o motivo e mantém o formulário", async () => {
    responder = () => new Response(JSON.stringify({ erro: "Senha atual incorreta." }), { status: 400, headers: { "content-type": "application/json" } });
    await montar(); await clicar($("[data-trocar-senha] > button"));
    await preencher("errada-999", "Nova-senha9", "Nova-senha9"); await enviar();
    expect($("[data-erro-senha]")!.textContent).toBe("Senha atual incorreta.");
    expect($("[data-erro-senha]")!.getAttribute("role")).toBe("alert");
    expect($("[data-trocar-senha] form")).not.toBeNull();
    expect($<HTMLInputElement>("[data-senha-nova]")!.value).toBe("Nova-senha9");
  });

  it("sem sinal: explica e não deixa enviar (senha não entra na fila do aparelho)", async () => {
    await montar("offline"); await clicar($("[data-trocar-senha] > button"));
    expect($("[data-senha-sem-sinal]")!.textContent).toBe("Trocar a senha precisa de sinal.");
    expect($<HTMLButtonElement>("[data-salvar-senha]")!.disabled).toBe(true);
    await preencher(SENHA_ANTIGA, "Nova-senha9", "Nova-senha9");
    await clicar($("[data-salvar-senha]"));
    expect(chamadas).toEqual([]);
  });

  it("fluxo inteiro tela → rota real: a senha do técnico muda no banco como hash", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const r = await trocarNoServidor(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
    }));
    vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
    await montar(); await clicar($("[data-trocar-senha] > button"));
    await preencher(SENHA_ANTIGA, "Nova-senha9", "Nova-senha9"); await enviar();
    expect($("[data-erro-senha]")).toBeNull();
    expect(await bcrypt.compare("Nova-senha9", banco.usuarios.find((u) => u.id === "uTec")!.senha)).toBe(true);
  });
});
