/**
 * Leva I.2 — grupo A, as regras puras (sem banco; dados fictícios):
 *  1/2 — a trilha da empresa: o "antes → depois" de cada campo, o detalhe da nova senha (sem a senha), os rótulos;
 *  3   — o e-mail de login único (lib/acesso/email-unico): normalização, o filtro, os dois espaços de login, e que
 *        TODO lugar que cria ou altera login usa o helper (não sobrou conferência só da empresa);
 *  4   — CSV contra fórmula: o apóstrofo na ida (só texto; número não), a retirada na volta, e a ida e volta pelo
 *        leitor e pelo motor da importação.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const banco = vi.hoisted(() => ({
  usuario: { findFirst: vi.fn(async (_: unknown): Promise<unknown> => null) },
  contatoCliente: { findFirst: vi.fn(async (_: unknown): Promise<unknown> => null) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: banco }));

import { emailDeLoginEmUso, emailDePortalEmUso, filtroEmailEmUso, MSG_EMAIL_LOGIN_EM_USO, MSG_EMAIL_PORTAL_EM_USO, normalizarEmailLogin } from "@/lib/acesso/email-unico";
import { CAMPOS_EMPRESA, detalheNovaSenhaAdmin, diferencasEmpresa, ROTULO_EVENTO_EMPRESA, rotuloEventoEmpresa, TIPOS_EVENTO_EMPRESA, type DadosEmpresa } from "@/lib/empresa/eventos";
import { desprotegerFormula, protegerFormula } from "@/lib/exportacao/formula";
import { celulaCsv, dinheiro, linhaCsv, numero, BOM } from "@/lib/exportacao/arquivos";
import { lerCsv } from "@/lib/folha/planilha";
import { analisar } from "@/lib/importacao/motor";
import { IMPORTACOES } from "@/lib/importacao/entidades";

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");

/* ───────────────────────── 1 / 2 ───────────────────────── */
describe("A trilha da empresa (regra pura)", () => {
  const ANTES: DadosEmpresa = { razaoSocial: "Clima Aurora Ltda", nomeFantasia: "Aurora", cnpj: "11.222.333/0001-81", email: "aurora@ficticio.test", telefone: null };

  it("uma linha por campo que mudou, na ordem da tela, com (vazio) para o que não tem valor", () => {
    expect(diferencasEmpresa(ANTES, { ...ANTES, razaoSocial: "Clima Aurora Serviços Ltda", nomeFantasia: null, telefone: "(11) 4000-0000" })).toEqual([
      "Razão social: Clima Aurora Ltda → Clima Aurora Serviços Ltda",
      "Nome fantasia: Aurora → (vazio)",
      "Telefone: (vazio) → (11) 4000-0000",
    ]);
    expect(CAMPOS_EMPRESA.map(([c]) => c)).toEqual(["razaoSocial", "nomeFantasia", "cnpj", "email", "telefone"]);
  });

  it("nada mudou = nenhuma linha: vazio e nulo são o mesmo, espaços nas pontas e a caixa do e-mail não contam", () => {
    expect(diferencasEmpresa(ANTES, { ...ANTES })).toEqual([]);
    expect(diferencasEmpresa({ ...ANTES, telefone: "" }, { ...ANTES, telefone: null })).toEqual([]);
    expect(diferencasEmpresa(ANTES, { ...ANTES, email: "AURORA@Ficticio.test", razaoSocial: " Clima Aurora Ltda " })).toEqual([]);
    // A caixa da razão social conta (é o nome que sai nos documentos)
    expect(diferencasEmpresa(ANTES, { ...ANTES, razaoSocial: "CLIMA AURORA LTDA" })).toHaveLength(1);
  });

  it("o detalhe da nova senha diz de quem foi e nunca leva a senha; os rótulos cobrem todos os tipos", () => {
    const d = detalheNovaSenhaAdmin({ nome: "Beatriz", email: "beatriz@aurora.ficticio" });
    expect(d).toContain("Beatriz (beatriz@aurora.ficticio)");
    expect(d).not.toMatch(/senha:/i);
    for (const t of TIPOS_EVENTO_EMPRESA) expect(ROTULO_EVENTO_EMPRESA[t]).toBeTruthy();
    expect(rotuloEventoEmpresa("NOVA_SENHA_ADMIN")).toBe("Nova senha provisória do administrador");
    expect(rotuloEventoEmpresa("DESCONHECIDO")).toBe("DESCONHECIDO");
    expect(Object.values(ROTULO_EVENTO_EMPRESA).join(" ")).not.toMatch(/você/i);
  });
});

/* ───────────────────────── 3 ───────────────────────── */
describe("E-mail de login único no Frivo inteiro (lib/acesso/email-unico)", () => {
  beforeEach(() => { banco.usuario.findFirst.mockClear(); banco.contatoCliente.findFirst.mockClear(); });

  it("normaliza como o login compara; o filtro é sem diferença de caixa e exclui o próprio registro", () => {
    expect(normalizarEmailLogin("  Ana@Ficticio.TEST ")).toBe("ana@ficticio.test");
    expect(normalizarEmailLogin("   ")).toBeNull();
    expect(normalizarEmailLogin(null)).toBeNull();
    expect(filtroEmailEmUso("ana@ficticio.test")).toEqual({ email: { equals: "ana@ficticio.test", mode: "insensitive" } });
    expect(filtroEmailEmUso("ana@ficticio.test", "u1")).toEqual({ email: { equals: "ana@ficticio.test", mode: "insensitive" }, id: { not: "u1" } });
  });

  it("usuários: procura em TODAS as empresas (sem empresaId no filtro); contatos: só os que têm acesso ao portal", async () => {
    expect(await emailDeLoginEmUso("  ")).toBe(false);
    expect(banco.usuario.findFirst).not.toHaveBeenCalled();
    banco.usuario.findFirst.mockResolvedValueOnce({ id: "uOutra" });
    expect(await emailDeLoginEmUso("Joana@Boreal.Ficticio", "u1")).toBe(true);
    const where = (banco.usuario.findFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ email: { equals: "joana@boreal.ficticio", mode: "insensitive" }, id: { not: "u1" } });
    expect(where).not.toHaveProperty("empresaId");

    expect(await emailDePortalEmUso("portal@ficticio.test", "c1")).toBe(false);
    expect((banco.contatoCliente.findFirst.mock.calls[0][0] as { where: unknown }).where).toEqual({
      email: { equals: "portal@ficticio.test", mode: "insensitive" }, id: { not: "c1" }, senha: { not: null },
    });
  });

  it("as mensagens: claras, sem \"você\"", () => {
    expect(MSG_EMAIL_LOGIN_EM_USO).toBe("Este e-mail já é login de outro usuário do Frivo. Use outro e-mail.");
    expect(MSG_EMAIL_PORTAL_EM_USO).toBe("Este e-mail já é acesso ao portal de outro contato do Frivo. Use outro e-mail.");
    expect(`${MSG_EMAIL_LOGIN_EM_USO} ${MSG_EMAIL_PORTAL_EM_USO}`).not.toMatch(/você/i);
  });

  it("todo lugar que cria ou altera um login usa o helper (e não sobrou conferência só dentro da empresa)", () => {
    const LOGIN = [
      "lib/cadastros/especificos.ts",           // Configurações › Usuários
      "app/api/tecnicos/[id]/acesso/route.ts",   // acesso ao app do técnico
      "app/api/tecnicos/[id]/route.ts",          // ficha do colaborador (o login acompanha o e-mail)
      "app/api/perfil/route.ts",                 // Meu perfil
      "lib/empresa/criar-empresa.ts",            // Nova empresa
    ];
    for (const f of LOGIN) expect(fonte(f), f).toMatch(/emailDeLoginEmUso\(/);
    const PORTAL = [
      "app/api/clientes/[id]/contatos/[contatoId]/acesso-portal/route.ts", // liberar e gerar senha
      "app/api/clientes/[id]/contatos/[contatoId]/route.ts",               // editar o e-mail de quem tem acesso
    ];
    for (const f of PORTAL) expect(fonte(f), f).toMatch(/emailDePortalEmUso\(/);
    expect(fonte("lib/cadastros/especificos.ts")).not.toContain("Já existe um usuário com este e-mail.");
    expect(fonte("app/api/clientes/[id]/contatos/[contatoId]/acesso-portal/route.ts")).not.toContain("Já existe acesso de portal com este e-mail");
    expect(fonte("app/api/perfil/route.ts")).not.toContain("usuario.findFirst({\n      where: { email");
  });
});

/* ───────────────────────── 4 ───────────────────────── */
describe("CSV contra fórmula (lib/exportacao/formula)", () => {
  it("ida: texto que começa com = + - @ TAB CR ganha o apóstrofo; número e número formatado não", () => {
    const casos: [unknown, unknown][] = [
      ['=HYPERLINK("http://golpe.ficticio";"x")', `'=HYPERLINK("http://golpe.ficticio";"x")`],
      ["-5 graus", "'-5 graus"],
      ["+55 (11) 4000-0000", "'+55 (11) 4000-0000"],
      ["@menção", "'@menção"],
      ["\tcom tab", "'\tcom tab"],
      ["\rcom cr", "'\rcom cr"],
      ["=1+1", "'=1+1"],
      ["-5+3", "'-5+3"],
      // números: nunca
      [-5, -5], ["-5", "-5"], ["-1250,50", "-1250,50"], ["+3", "+3"], ["-0.5", "-0.5"],
      // texto comum e o que não é texto
      ["Padaria", "Padaria"], ["a=b", "a=b"], ["", ""], [null, null], [undefined, undefined],
    ];
    for (const [v, esperado] of casos) expect(protegerFormula(v), JSON.stringify(v)).toEqual(esperado);
  });

  it("volta: tira o apóstrofo só antes de = + - @ TAB CR; o resto fica como veio", () => {
    expect(desprotegerFormula("'=HYPERLINK(1)")).toBe("=HYPERLINK(1)");
    expect(desprotegerFormula("'-5 graus")).toBe("-5 graus");
    expect(desprotegerFormula("'@x")).toBe("@x");
    expect(desprotegerFormula("'\tx")).toBe("\tx");
    expect(desprotegerFormula("'Ponto de vista'")).toBe("'Ponto de vista'");
    expect(desprotegerFormula("''=x")).toBe("''=x");
    expect(desprotegerFormula(-5)).toBe(-5);
    expect(desprotegerFormula(null)).toBeNull();
    for (const v of ["=x", "-5 graus", "+55", "@a", "texto", "-5"]) expect(desprotegerFormula(protegerFormula(v))).toBe(v);
  });

  it("a célula do CSV da exportação: o apóstrofo entra antes das aspas; números (inclusive os formatados) saem como número", () => {
    expect(celulaCsv('=HYPERLINK("a";"b")')).toBe(`"'=HYPERLINK(""a"";""b"")"`);
    expect(celulaCsv("-5 graus")).toBe("'-5 graus");
    expect(celulaCsv("\rx")).toBe(`"'\rx"`);
    expect(celulaCsv(-5)).toBe("-5");
    expect(celulaCsv(numero(-5))).toBe("-5");
    expect(celulaCsv(dinheiro(-1250.5))).toBe("-1250,50");
    expect(linhaCsv(["=1", -2, "-2"])).toBe("'=1;-2;-2\r\n");
  });

  it("ida e volta: o CSV exportado, lido pelo leitor e pelo motor da importação, devolve o valor original", () => {
    const def = IMPORTACOES.clientes;
    const original: Record<string, string> = {
      nome: '=HYPERLINK("http://golpe.ficticio";"clique")', cnpj_cpf: "11.444.777/0001-61", nome_fantasia: "-5 graus",
      telefone: "+55 (11) 4000-0000", observacoes: "@equipe ver amanhã", numero: "-5",
    };
    const cab = def.colunas.map((c) => c.titulo);
    const csv = BOM + linhaCsv(cab) + linhaCsv(def.colunas.map((c) => original[c.chave] ?? ""));
    expect(csv).toContain(";'-5 graus;");
    expect(csv).toContain(";-5;");
    const a = analisar(lerCsv(csv), def, { existentes: new Map(), refs: {}, podeAtualizar: true });
    expect(a.linhas).toHaveLength(1);
    const l = a.linhas[0];
    expect(l.status).toBe("criar");
    for (const [k, v] of Object.entries(original)) expect(l.valores[k], k).toBe(v);
    expect(l.dados).toMatchObject({ observacoes: "@equipe ver amanhã", telefone: "+55 (11) 4000-0000", numero: "-5" });
    expect(String(l.dados!.nome).startsWith("=")).toBe(true);
    expect(String(l.dados!.nome).startsWith("'")).toBe(false);
  });
});
