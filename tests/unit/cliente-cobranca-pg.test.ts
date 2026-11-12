/**
 * Cliente — seção "Cobrança e faturamento": as colunas reaproveitadas (emailsFaturamento,
 * whatsappFaturamento, boletoUnicoMensal, exigePcAntesNf, agrupaAdicionais) são salvas no CREATE e no
 * EDIT (o PUT não ignora nem zera o que vem no corpo). Também cobre a ponta solta do destinatário:
 * sem e-mail/WhatsApp de cobrança, o envio cai no contato principal (e, por fim, no cadastro).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/cliente-cobranca-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_cliente_cobranca_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role: "ADMIN", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await carregar();
  const req = new NextRequest("http://localhost/api/clientes", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const criarCliente = (corpo: unknown) => chamar(() => import("@/app/api/clientes/route"), "POST", {}, corpo);
const editarCliente = (id: string, corpo: unknown) => chamar(() => import("@/app/api/clientes/[id]/route"), "PUT", { id }, corpo);

const base = { tipoPessoa: "JURIDICA", nome: "Condomínio Alfa", cpfCnpj: "11.222.333/0001-81" };

describe.skipIf(!URL_PG)("Cliente › Cobrança e faturamento (PostgreSQL real)", () => {
  let prisma: any;
  let destino: typeof import("@/lib/cliente/cobranca-destino");
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    destino = await import("@/lib/cliente/cobranca-destino");
    await Promise.all([import("@/app/api/clientes/route"), import("@/app/api/clientes/[id]/route")]);
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("CREATE salva os campos de cobrança; EDIT atualiza sem zerar", async () => {
    const r = await criarCliente({
      ...base,
      emailsFaturamento: ["financeiro@alfa.com.br", "fiscal@alfa.com.br"],
      whatsappFaturamento: "(62) 99999-0000",
      boletoUnicoMensal: true, exigePcAntesNf: true, agrupaAdicionais: true,
    });
    expect(r.status).toBe(201);
    const id = r.json.id;
    let c = await prisma.cliente.findUnique({ where: { id } });
    expect(c.emailsFaturamento).toEqual(["financeiro@alfa.com.br", "fiscal@alfa.com.br"]);
    expect([c.whatsappFaturamento, c.boletoUnicoMensal, c.exigePcAntesNf, c.agrupaAdicionais])
      .toEqual(["(62) 99999-0000", true, true, true]);

    // EDIT: muda a lista e desliga as preferências; o PUT grava os novos valores sem zerar à toa.
    const e = await editarCliente(id, {
      ...base,
      emailsFaturamento: ["cobranca@alfa.com.br"],
      whatsappFaturamento: "(62) 98888-1111",
      boletoUnicoMensal: false, exigePcAntesNf: false, agrupaAdicionais: false,
    });
    expect(e.status).toBe(200);
    c = await prisma.cliente.findUnique({ where: { id } });
    expect(c.emailsFaturamento).toEqual(["cobranca@alfa.com.br"]);
    expect([c.whatsappFaturamento, c.boletoUnicoMensal, c.exigePcAntesNf, c.agrupaAdicionais])
      .toEqual(["(62) 98888-1111", false, false, false]);
  });

  it("e-mail inválido na lista de cobrança é rejeitado (400)", async () => {
    const mau = await criarCliente({ ...base, cpfCnpj: "11.444.777/0001-61", emailsFaturamento: ["nao-e-email"] });
    expect(mau.status).toBe(400);
  });

  it("destino de cobrança: e-mails de cobrança → contato principal → e-mail do cadastro", async () => {
    // (a) com e-mails de cobrança dedicados: usa o primeiro.
    const comEmails = await prisma.cliente.create({ data: {
      empresaId: "e1", tipoPessoa: "JURIDICA", nome: "Com Cobrança", cpfCnpj: "d1",
      email: "cadastro@x.com", emailsFaturamento: ["cob@x.com", "cc@x.com"],
    } });
    expect(await destino.emailCobranca(comEmails)).toBe("cob@x.com");

    // (b) sem e-mails de cobrança, mas com contato principal: cai no contato principal.
    const comContato = await prisma.cliente.create({ data: {
      empresaId: "e1", tipoPessoa: "JURIDICA", nome: "Com Contato", cpfCnpj: "d2", email: "cadastro2@x.com",
    } });
    await prisma.contatoCliente.create({ data: {
      empresaId: "e1", clienteId: comContato.id, nome: "Fin", email: "principal@x.com", whatsapp: "(62) 90000-0000", principal: true,
    } });
    expect(await destino.emailCobranca(comContato)).toBe("principal@x.com");
    expect(await destino.whatsappCobranca({ id: comContato.id, celular: "(62) 91111-1111" })).toBe("(62) 90000-0000");

    // (c) sem e-mails de cobrança e sem contato principal: cai no e-mail/celular do cadastro.
    const soCadastro = await prisma.cliente.create({ data: {
      empresaId: "e1", tipoPessoa: "JURIDICA", nome: "Só Cadastro", cpfCnpj: "d3",
      email: "cadastro3@x.com", celular: "(62) 93333-3333",
    } });
    expect(await destino.emailCobranca(soCadastro)).toBe("cadastro3@x.com");
    expect(await destino.whatsappCobranca(soCadastro)).toBe("(62) 93333-3333");
  });
});
