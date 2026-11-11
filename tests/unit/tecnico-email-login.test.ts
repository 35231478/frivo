// @vitest-environment happy-dom
/**
 * App do técnico — o e-mail de LOGIN fica somente leitura em Meus dados.
 * O técnico é ligado às OS dele pelo e-mail de login: se trocasse pelo app, perderia o acesso até o
 * escritório acertar. Então:
 *  - na TELA do app: o e-mail aparece, não dá para editar, e uma linha diz que a troca é pelo escritório;
 *    nome e foto continuam editáveis; ao salvar o nome, o e-mail nem vai no corpo;
 *  - no SERVIDOR: a rota recusa a troca de e-mail de quem está no modo técnico (a tela não é a trava);
 *  - o PAINEL não muda: quem não é técnico continua trocando o próprio e-mail como antes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { MSG_EMAIL_DO_TECNICO } from "@/lib/tecnico/modo";
import type { EstadoSync } from "@/lib/tecnico/offline/motor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/* ───────── servidor: a rota real, com um "banco" mínimo ───────── */
const SENHA = "Senha-certa1";
const banco = vi.hoisted(() => ({ usuarios: [] as { id: string; nome: string; email: string; senha: string }[], updates: [] as any[] }));
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: async () => sessao.atual }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    usuario: {
      findUnique: async ({ where }: any) => banco.usuarios.find((u) => u.id === where.id) ?? null,
      findFirst: async ({ where }: any) => banco.usuarios.find((u) => u.email.toLowerCase() === String(where.email.equals).toLowerCase() && u.id !== where.id.not) ?? null,
      update: async ({ where, data }: any) => { banco.updates.push({ where, data }); const u = banco.usuarios.find((x) => x.id === where.id)!; Object.assign(u, data); return { nome: u.nome, email: u.email }; },
    },
  },
}));
vi.mock("@/lib/acesso/limite", () => ({ conferirBloqueio: async () => ({ bloqueado: false }), limparTentativas: async () => {}, registrarTentativa: async () => [] }));
const sessaoCliente = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: sessaoCliente.update }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));

async function salvarNoServidor(corpo: unknown) {
  const { PATCH } = await import("@/app/api/perfil/route");
  const res = await PATCH(new NextRequest("http://localhost/api/perfil", { method: "PATCH", body: JSON.stringify(corpo), headers: { "content-type": "application/json" } }));
  return { status: res.status, json: await res.json() };
}
const como = (user: Record<string, unknown>) => { sessao.atual = { user: { empresaId: "e1", ...user } }; };
const tecnicoDoApp = () => como({ id: "uTec", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" });
const trocaCompleta = (email: string) => ({ nome: "João Silva", email, confirmacaoEmail: email, senhaAtual: SENHA });

beforeEach(async () => {
  const hash = await bcrypt.hash(SENHA, 4);
  banco.usuarios = [
    { id: "uTec", nome: "João Silva", email: "joao@clima.com", senha: hash },
    { id: "uAdm", nome: "Ana Souza", email: "ana@clima.com", senha: hash },
    { id: "uOp", nome: "Bia Lima", email: "bia@clima.com", senha: hash },
  ];
  banco.updates = [];
  sessaoCliente.update.mockClear();
  tecnicoDoApp();
});

describe("servidor: o técnico do app não troca o próprio e-mail de login", () => {
  it("papel TECNICO: recusa (403) mesmo com confirmação e senha atual certas — nada é gravado", async () => {
    const r = await salvarNoServidor(trocaCompleta("novo@clima.com"));
    expect(r).toEqual({ status: 403, json: { erro: MSG_EMAIL_DO_TECNICO } });
    expect(MSG_EMAIL_DO_TECNICO).toBe("O e-mail de login é trocado pelo escritório, na ficha do colaborador.");
    expect(banco.updates).toEqual([]);
    expect(banco.usuarios.find((u) => u.id === "uTec")!.email).toBe("joao@clima.com");
  });

  it("recusa inteira: nem o nome que veio junto é gravado (não fica meia alteração)", async () => {
    const r = await salvarNoServidor({ ...trocaCompleta("novo@clima.com"), nome: "Outro Nome" });
    expect(r.status).toBe(403);
    expect(banco.usuarios.find((u) => u.id === "uTec")!.nome).toBe("João Silva");
  });

  it("técnico por PERFIL (operador com permissões de técnico, ligado a um técnico): também recusa", async () => {
    como({ id: "uTec", role: "OPERADOR", permissoes: PRESETS.TECNICO, tecnicoId: "t1" });
    expect((await salvarNoServidor(trocaCompleta("novo@clima.com"))).status).toBe(403);
    expect(banco.updates).toEqual([]);
  });

  it("o NOME continua editável pelo técnico (só nome no corpo, como o app manda)", async () => {
    const r = await salvarNoServidor({ nome: "João P. Silva" });
    expect(r).toEqual({ status: 200, json: { nome: "João P. Silva", email: "joao@clima.com" } });
    expect(banco.updates).toEqual([{ where: { id: "uTec" }, data: { nome: "João P. Silva" } }]);
  });

  it("app antigo guardado no aparelho (manda o MESMO e-mail junto do nome): salva o nome normalmente", async () => {
    const r = await salvarNoServidor({ nome: "João P. Silva", email: "Joao@Clima.com" });
    expect(r.status).toBe(200);
    expect(banco.updates).toEqual([{ where: { id: "uTec" }, data: { nome: "João P. Silva" } }]);
  });

  it("PAINEL não muda: administrador e operador do escritório continuam trocando o próprio e-mail (com confirmação e senha)", async () => {
    como({ id: "uAdm", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null });
    expect(await salvarNoServidor({ ...trocaCompleta("ana.souza@clima.com"), nome: "Ana Souza" })).toEqual({ status: 200, json: { nome: "Ana Souza", email: "ana.souza@clima.com" } });
    como({ id: "uOp", role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null });
    expect((await salvarNoServidor({ ...trocaCompleta("bia.lima@clima.com"), nome: "Bia Lima" })).status).toBe(200);
    // E as regras de sempre do painel continuam: sem a senha atual não troca
    expect((await salvarNoServidor({ nome: "Bia Lima", email: "outra@clima.com", confirmacaoEmail: "outra@clima.com" })).status).toBe(400);
    expect(banco.usuarios.find((u) => u.id === "uOp")!.email).toBe("bia.lima@clima.com");
  });

  it("administrador que TAMBÉM é técnico (usa o painel): não é barrado — o painel é dele", async () => {
    como({ id: "uAdm", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: "t9" });
    expect((await salvarNoServidor(trocaCompleta("ana.nova@clima.com"))).status).toBe(200);
  });

  it("quem troca o e-mail de login do técnico é o escritório: a ficha do colaborador leva o login junto (código que já existia)", () => {
    const rota = fs.readFileSync(path.resolve(__dirname, "../../app/api/tecnicos/[id]/route.ts"), "utf8");
    expect(rota).toMatch(/emailNovo\.toLowerCase\(\) !== emailAntigo\.toLowerCase\(\)[\s\S]{0,700}prisma\.usuario\.update\(\{ where: \{ id: login\.id \}, data: \{ email: emailNovo \} \}\)/);
  });
});

/* ───────── tela ───────── */
describe("tela: Meus dados", () => {
  let root: Root; let caixa: HTMLDivElement;
  let chamadas: { url: string; corpo: any }[];
  const estado: EstadoSync = { situacao: "sincronizado", pendentes: 0, erros: 0, ultimoSync: null, versao: 0 };
  const motorFalso = { assinar: (fn: (e: EstadoSync) => void) => { fn(estado); return () => {}; }, banco: { fila: async () => [], retratos: async () => [] } } as any;
  const perfilInicial = { nome: "João Silva", email: "joao@clima.com", avatar: null, empresaNome: "Clima Total", perfilNome: null, cargo: "Técnico" };

  beforeEach(() => {
    chamadas = [];
    // A tela fala com a rota REAL
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body)); chamadas.push({ url, corpo });
      const r = await salvarNoServidor(corpo);
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
    }));
  });
  afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 4)); }); };
  const texto = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
  const digitar = async (el: Element | null | undefined, v: string) => {
    expect(el).toBeTruthy();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
    await esperar();
  };
  const botoes = (rotulo: string) => [...caixa.querySelectorAll<HTMLButtonElement>("button")].filter((b) => texto(b) === rotulo);
  const visivel = (el: Element) => !el.closest(".hidden");
  /** O campo cujo rótulo é `rotulo`, na aba visível */
  const campo = (rotulo: string) => [...caixa.querySelectorAll("label")].filter(visivel).find((l) => texto(l).replace(/\*$/, "").trim() === rotulo)?.parentElement?.querySelector<HTMLInputElement>("input") ?? null;
  const montar = async (el: any) => { caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa); await act(async () => { root.render(el); }); await esperar(); };

  async function abrirNoApp() {
    const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
    const { PerfilTecnico } = await import("@/components/tecnico/perfil");
    await montar(createElement(ProvedorTecnico, { usuario: { id: "uTec", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true }, motorPronto: motorFalso, children: createElement(PerfilTecnico, { perfilInicial: perfilInicial as any }) }));
    await clicar(botoes("Meus dados")[0]);
  }
  async function abrirNoPainel() {
    const { PerfilClient } = await import("@/components/perfil/perfil-client");
    await montar(createElement(PerfilClient, { initial: perfilInicial }));
  }

  describe("no APP do técnico", () => {
    it("o e-mail de login aparece, mas é somente leitura — com a linha dizendo que a troca é pelo escritório", async () => {
      await abrirNoApp();
      const email = campo("E-mail de login")!;
      expect(email.value).toBe("joao@clima.com");
      expect(email.readOnly).toBe(true);
      expect(email.getAttribute("aria-readonly")).toBe("true");
      expect(email.hasAttribute("data-email-somente-leitura")).toBe(true);
      expect(texto(email.closest("div.space-y-1, div")!.parentElement)).toContain("A troca do e-mail de login é feita pelo escritório.");
      expect(campo("E-mail")).toBeNull(); // o campo editável do painel não existe aqui
    });

    it("não dá para editar: digitar no campo não muda nada, e os campos de troca (confirmar e-mail, senha atual) nunca aparecem", async () => {
      await abrirNoApp();
      await digitar(campo("E-mail de login"), "outro@clima.com");
      expect(campo("E-mail de login")!.value).toBe("joao@clima.com");
      expect(campo("Confirmar e-mail")).toBeNull();
      expect(campo("Senha atual")).toBeNull();
      expect([...caixa.querySelectorAll("input[type='password']")].filter(visivel)).toHaveLength(0);
    });

    it("o NOME continua editável: salva pela rota real, e o e-mail nem vai no corpo", async () => {
      vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
      await abrirNoApp();
      const nome = campo("Nome completo")!;
      expect(nome.readOnly).toBe(false);
      await digitar(nome, "João Pedro Silva");
      await clicar(botoes("Salvar alterações").at(-1));
      expect(chamadas).toEqual([{ url: "/api/perfil", corpo: { nome: "João Pedro Silva" } }]);
      expect(banco.usuarios.find((u) => u.id === "uTec")).toMatchObject({ nome: "João Pedro Silva", email: "joao@clima.com" });
      expect(sessaoCliente.update).toHaveBeenCalledWith({ name: "João Pedro Silva", email: "joao@clima.com" });
    });

    it("a FOTO continua editável: a aba 'Foto de perfil' segue com 'Alterar foto'", async () => {
      await abrirNoApp();
      await clicar(botoes("Foto de perfil")[0]);
      expect(botoes("Alterar foto").filter(visivel)).toHaveLength(1);
      expect(botoes("Alterar foto")[0].disabled).toBe(false);
    });

    it("o campo travado segue com alvo de 44 px no app (está dentro da área de Meus dados)", async () => {
      await abrirNoApp();
      const area = caixa.querySelector("[data-meus-dados-app]")!;
      expect(area.contains(campo("E-mail de login"))).toBe(true);
      expect(area.className).toContain("[&_input]:min-h-[44px]");
    });
  });

  describe("no PAINEL (Meu perfil) — nada muda", () => {
    it("o e-mail continua editável; ao mudar, pede confirmação e senha atual, como antes", async () => {
      como({ id: "uAdm", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null });
      await abrirNoPainel();
      expect(caixa.querySelector("[data-email-somente-leitura]")).toBeNull();
      expect(texto(caixa)).not.toContain("feita pelo escritório");
      const email = campo("E-mail")!;
      expect(email.readOnly).toBe(false);
      await digitar(email, "joao.novo@clima.com");
      expect(campo("E-mail")!.value).toBe("joao.novo@clima.com");
      expect(campo("Confirmar e-mail")).toBeTruthy();
      expect(campo("Senha atual")).toBeTruthy();
    });

    it("salvar no painel manda nome + e-mail + confirmação + senha (o corpo de sempre) e troca o e-mail", async () => {
      vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
      como({ id: "uAdm", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null });
      await abrirNoPainel();
      await digitar(campo("E-mail"), "ana.souza@clima.com");
      await digitar(campo("Confirmar e-mail"), "ana.souza@clima.com");
      await digitar(campo("Senha atual"), SENHA);
      await clicar(botoes("Salvar alterações").at(-1));
      expect(chamadas[0].corpo).toEqual({ nome: "João Silva", email: "ana.souza@clima.com", confirmacaoEmail: "ana.souza@clima.com", senhaAtual: SENHA });
      expect(banco.usuarios.find((u) => u.id === "uAdm")!.email).toBe("ana.souza@clima.com");
    });
  });
});
