/**
 * Portal do cliente: senha provisória segura (regra pura) — a senha gerada, o destino de quem está logado
 * (sem ciclo), a mensagem ao contato, o cookie do portal (atributos certos ao regravar e ao apagar: lição do
 * #270), o limite de tentativas igual ao do painel e o SQL (aditivo, idempotente, sem tocar na coluna antiga).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { problemaSenha } from "@/lib/acesso/senha";
import { LIMITES } from "@/lib/acesso/limite";
import {
  ALFABETO_SENHA, ROTA_INICIO_PORTAL, ROTA_TROCA_PORTAL, TAMANHO_SENHA_PROVISORIA, destinoDoPortal, mensagemDoAcesso, trocaPendentePortal,
} from "@/lib/portal/senha-provisoria";
import { gerarSenhaProvisoria } from "@/lib/portal/gerar-senha";
import { COOKIE_PORTAL, apagarCookiePortal, atributosCookiePortal } from "@/lib/portal/sessao-cookie-portal";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");
afterEach(() => { vi.unstubAllEnvs(); });

describe("a senha provisória gerada", () => {
  it("12 caracteres do alfabeto sem ambíguos (0, O, 1, l, I), com letra e número: passa na regra das senhas novas", () => {
    for (let i = 0; i < 300; i++) {
      const s = gerarSenhaProvisoria();
      expect(s).toHaveLength(TAMANHO_SENHA_PROVISORIA);
      expect([...s].every((c) => ALFABETO_SENHA.includes(c))).toBe(true);
      expect(s).not.toMatch(/[0O1lI]/);
      expect(problemaSenha(s)).toBeNull();
    }
  });
  it("sorteio que só daria letras: um número entra; só números: uma letra entra", () => {
    const soLetras = gerarSenhaProvisoria(() => 0); // "A" sempre
    expect(soLetras).toMatch(/\d/);
    expect(problemaSenha(soLetras)).toBeNull();
    let n = 0;
    const soDigitos = gerarSenhaProvisoria((max) => (max === ALFABETO_SENHA.length ? ALFABETO_SENHA.length - 1 : n++ % max)); // "9" sempre
    expect(soDigitos).toMatch(/[A-Za-z]/);
    expect(problemaSenha(soDigitos)).toBeNull();
  });
  it("cada geração é diferente (gerador criptográfico)", () => {
    expect(new Set(Array.from({ length: 50 }, () => gerarSenhaProvisoria())).size).toBe(50);
  });
});

describe("para onde vai quem está logado (sem ciclo)", () => {
  it("com a troca pendente: a tela de troca; sem: o início do portal", () => {
    expect(destinoDoPortal({ trocarSenha: true })).toBe(ROTA_TROCA_PORTAL);
    expect(destinoDoPortal({ trocarSenha: false })).toBe(ROTA_INICIO_PORTAL);
    expect(destinoDoPortal({})).toBe(ROTA_INICIO_PORTAL);
    expect(trocaPendentePortal({ trocarSenha: "true" })).toBe(false); // só o booleano verdadeiro
    expect(trocaPendentePortal(null)).toBe(false);
    expect(ROTA_TROCA_PORTAL).not.toBe(ROTA_INICIO_PORTAL);
  });
});

describe("a mensagem ao contato (e-mail e WhatsApp)", () => {
  it("formal, com o link, o e-mail, a senha provisória e o aviso da troca no 1º acesso", () => {
    const m = mensagemDoAcesso({ contatoNome: "Paula", link: "https://x/portal/login", email: "paula@x.test", senha: "Abc23456defg" });
    expect(m).toMatch(/^Prezado\(a\) Paula,/);
    expect(m).toContain("Acesse: https://x/portal/login");
    expect(m).toContain("Senha provisória: Abc23456defg");
    expect(m).toContain("No primeiro acesso, o portal pede para criar uma senha própria.");
    expect(m).not.toMatch(/você|Olá|!/);
  });
  it("sem senha na tela (já não é exibida): a mensagem vai sem senha", () => {
    const m = mensagemDoAcesso({ contatoNome: "Paula", link: "l", email: "e", senha: null });
    expect(m).not.toContain("Senha");
  });
});

describe("o cookie do portal (lição do #270)", () => {
  it("em produção sempre com Secure; com o prefixo __Secure- sempre; HttpOnly, SameSite=Lax e Path=/", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(atributosCookiePortal()).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: true });
    vi.stubEnv("NODE_ENV", "development");
    expect(atributosCookiePortal().secure).toBe(false);
    expect(atributosCookiePortal(`__Secure-${COOKIE_PORTAL}`).secure).toBe(true);
  });
  it("o Auth.js do portal grava com os MESMOS atributos (um lugar só)", () => {
    expect(ler("lib/auth-portal.ts")).toContain("sessionToken: { name: COOKIE_PORTAL, options: atributosCookiePortal(COOKIE_PORTAL) }");
  });
  it("apagar: cada pedaço e o nome base, com Max-Age 0 e os atributos certos; o cookie do painel fica", () => {
    vi.stubEnv("NODE_ENV", "production");
    const set = vi.fn();
    const apagados = apagarCookiePortal({ cookies: { set } }, [`${COOKIE_PORTAL}.0`, `${COOKIE_PORTAL}.1`, "__Secure-authjs.session-token", "outro"]);
    expect(apagados).toEqual([COOKIE_PORTAL, `${COOKIE_PORTAL}.0`, `${COOKIE_PORTAL}.1`]);
    for (const [, valor, op] of set.mock.calls) {
      expect(valor).toBe("");
      expect(op).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 0 });
    }
    expect(set.mock.calls.map((c) => c[0])).not.toContain("__Secure-authjs.session-token");
  });
});

describe("limite de tentativas e o painel", () => {
  it("o login do portal tem o MESMO limite do login do painel (5 por e-mail, 20 por IP, 15 min)", () => {
    expect(LIMITES.PORTAL_LOGIN).toEqual(LIMITES.LOGIN);
    expect(LIMITES.PORTAL_TROCA_SENHA).toEqual(LIMITES.TROCA_SENHA);
  });
  it("o login do painel não foi tocado: não conhece a troca do portal", () => {
    expect(ler("lib/auth.ts")).not.toMatch(/portal/i);
  });
});

describe("o SQL (aditivo e idempotente)", () => {
  const sql = ler("prisma/sql/2027-02-09_portal_troca_senha.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
  it("só acrescenta a coluna (IF NOT EXISTS, padrão falso, não nula); não toca na coluna antiga nem em dados", () => {
    expect(sql).toBe('ALTER TABLE "contatos_cliente" ADD COLUMN IF NOT EXISTS "trocar_senha" BOOLEAN NOT NULL DEFAULT false;');
    expect(sql).not.toMatch(/senha_provisoria|DROP|UPDATE|DELETE/i);
  });
  it("a coluna antiga continua no schema, marcada como obsoleta, e nada a lê para mostrar", () => {
    expect(ler("prisma/schema.prisma")).toMatch(/OBSOLETA[\s\S]{0,400}senhaProvisoria\s+String\?\s+@map\("senha_provisoria"\)/);
    expect(ler("prisma/schema.prisma")).toMatch(/trocarSenha\s+Boolean\s+@default\(false\)\s+@map\("trocar_senha"\)/);
  });
});
