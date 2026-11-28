/**
 * pj4 — pontas da ficha do cliente (Leva H), contra PostgreSQL real:
 *  - H02: o histórico só traz OS (com aceites e e-mails das OS), orçamentos, contratos e documentação da equipe para
 *    quem vê cada módulo;
 *  - H09: a mudança de status do contrato com o rótulo de verdade e o motivo; fatura cancelada não aparece "criada";
 *  - H12: o pedido "Resolvido por outro meio" não aparece como "conferido";
 *  - H03: o mesmo CPF/CNPJ com outra pontuação é repetido (POST e PUT); documento novo/trocado precisa ser válido;
 *  - H18: "exigir endereço" da empresa vale também no POST /api/clientes.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pj4-cliente-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pj4_cliente_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), role = "ADMIN") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role, permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });
const D = (iso: string) => new Date(iso);

describe.skipIf(!URL_PG)("pj4 — ficha do cliente (PostgreSQL real)", () => {
  let prisma: any;

  async function historicoApi(id: string) {
    const mod = await import("@/app/api/clientes/[id]/historico/route");
    const res = await mod.GET(new NextRequest(`http://localhost/api/clientes/${id}/historico`), { params: Promise.resolve({ id }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  async function criarCliente(corpo: unknown) {
    const mod = await import("@/app/api/clientes/route");
    const res = await mod.POST(new NextRequest("http://localhost/api/clientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  async function editarCliente(id: string, corpo: unknown) {
    const mod = await import("@/app/api/clientes/[id]/route");
    const res = await mod.PUT(new NextRequest(`http://localhost/api/clientes/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }), { params: Promise.resolve({ id }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/clientes/route"), import("@/app/api/clientes/[id]/route"), import("@/app/api/clientes/[id]/historico/route")]);

    await prisma.empresa.create({ data: { id: "e1", nome: "Empresa 1", cnpj: "12345678000190", email: "e1@x.com" } });
    await prisma.empresa.create({ data: { id: "e2", nome: "Empresa 2", cnpj: "98765432000110", email: "e2@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    // c1 como a importação grava (com pontuação); c2 só com os dígitos; cx: o mesmo CNPJ do c1, noutra empresa
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Cliente Um", cpfCnpj: "11.222.333/0001-81", tipoPessoa: "JURIDICA" } });
    await prisma.cliente.create({ data: { id: "c2", empresaId: "e1", nome: "Cliente Dois", cpfCnpj: "11444777000161", tipoPessoa: "JURIDICA" } });
    await prisma.cliente.create({ data: { id: "cx", empresaId: "e2", nome: "Cliente X", cpfCnpj: "45723174000110", tipoPessoa: "JURIDICA" } });

    // ── Fontes do c1 ──
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", clienteId: "c1", numero: "OS-1", criadoPorId: "u1", descricao: "Preventiva", criadoEm: D("2026-11-01T12:00:00Z") } });
    await prisma.osAceite.create({ data: { empresaId: "e1", ordemServicoId: "os1", token: "tk-pj4-aceite", confirmadoEm: D("2026-11-02T12:00:00Z"), avaliacao: 4 } });
    await prisma.emailLog.create({ data: { empresaId: "e1", para: "m@c1.com", assunto: "Relatório da OS-1", referenciaTipo: "OrdemServico", referenciaId: "os1", enviadoEm: D("2026-11-02T13:00:00Z") } });
    await prisma.orcamento.create({ data: { id: "orc1", empresaId: "e1", clienteId: "c1", codigo: "ORC-1", nome: "Troca", criadoPorId: "u1", tokenPublico: "tk-pj4-orc", criadoEm: D("2026-11-03T12:00:00Z") } });
    await prisma.orcamentoEvento.create({ data: { empresaId: "e1", orcamentoId: "orc1", tipo: "VISUALIZADO", criadoEm: D("2026-11-03T13:00:00Z") } });
    await prisma.contrato.create({ data: { id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-1", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: D("2026-11-01T00:00:00Z"), criadoEm: D("2026-11-04T12:00:00Z") } });
    await prisma.contratoHistoricoStatus.create({ data: { empresaId: "e1", contratoId: "ct1", statusAnterior: "ATIVO", statusNovo: "EM_RENOVACAO", motivo: "Reajuste anual em negociação", usuarioId: "u1", createdAt: D("2026-11-05T12:00:00Z") } });
    await prisma.contratoHistoricoStatus.create({ data: { empresaId: "e1", contratoId: "ct1", statusAnterior: "EM_RENOVACAO", statusNovo: "AGUARDANDO_ASSINATURA", usuarioId: "u1", createdAt: D("2026-11-05T13:00:00Z") } });
    await prisma.documentacaoEnvio.create({ data: { id: "de1", empresaId: "e1", clienteId: "c1", clienteNome: "Cliente Um" } });
    await prisma.documentacaoEnvioEvento.create({ data: { envioId: "de1", tipo: "EMAIL_ENVIADO", criadoEm: D("2026-11-06T12:00:00Z") } });
    await prisma.pedidoCliente.create({ data: { id: "pc1", empresaId: "e1", clienteId: "c1", numero: "PC-5", data: D("2026-11-07T00:00:00Z"), origem: "PORTAL", criadoEm: D("2026-11-07T12:00:00Z"), conferidoEm: D("2026-11-08T12:00:00Z"), situacao: "RESOLVIDO" } });
    await prisma.interacaoCliente.create({ data: { empresaId: "e1", clienteId: "c1", usuarioId: "u1", tipo: "LIGACAO", descricao: "Ligou", criadoEm: D("2026-11-09T12:00:00Z") } });
    await prisma.medicao.create({ data: { id: "m1", empresaId: "e1", clienteId: "c1", numero: "FAT-1", tokenPublico: "tk-pj4-m1", valorLiquido: 500, status: "CANCELADA", criadoEm: D("2026-11-10T12:00:00Z") } });
    await prisma.medicao.create({ data: { id: "m2", empresaId: "e1", clienteId: "c1", numero: "FAT-2", tokenPublico: "tk-pj4-m2", valorLiquido: 700, criadoEm: D("2026-11-11T12:00:00Z") } });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const titulos = async (perm: Record<string, Acao[]>) => {
    logar(montarPermissoes({ clientes: ["visualizar"], ...perm }), "OPERADOR");
    const r = await historicoApi("c1");
    expect(r.status).toBe(200);
    return (r.json.eventos as { titulo: string }[]).map((e) => e.titulo);
  };

  it("H02: só \"clientes\": nada de OS, aceite, e-mail da OS, orçamento, contrato nem documentação da equipe", async () => {
    expect(await titulos({})).toEqual(["Ligação", "Pedido PC-5: resolvido por outro meio", "Cliente enviou o pedido PC-5 pelo portal"]);
  });

  it("H02: cada módulo entra com a sua permissão (OS leva o aceite e os e-mails das OS)", async () => {
    const os = await titulos({ ordens: ["visualizar"] });
    expect(os).toEqual(expect.arrayContaining(["OS OS-1 criada", "Cliente confirmou o serviço da OS OS-1", "E-mail enviado: Relatório da OS-1"]));
    expect(os.some((t) => /ORC-|CT-|Documentação/.test(t))).toBe(false);
    const orc = await titulos({ orcamentos: ["visualizar"] });
    expect(orc).toEqual(expect.arrayContaining(["Orçamento ORC-1 criado", "Cliente abriu o orçamento ORC-1"]));
    expect(orc.some((t) => /OS-1|CT-|Documentação/.test(t))).toBe(false);
    const ct = await titulos({ contratos: ["visualizar"] });
    expect(ct.filter((t) => t.includes("CT-1"))).toEqual(["Contrato CT-1: aguardando assinatura", "Contrato CT-1: em renovação", "Contrato CT-1 cadastrado"]);
    const doc = await titulos({ documentos: ["enviar"] });
    expect(doc).toContain("Documentação da equipe enviada por e-mail");
    expect(doc.some((t) => /OS-1|ORC-|CT-/.test(t))).toBe(false);
  });

  it("H09: status do contrato com o rótulo e o motivo; fatura cancelada aparece cancelada, não criada", async () => {
    logar();
    const evs: any[] = (await historicoApi("c1")).json.eventos;
    const st = evs.filter((e) => e.id.startsWith("contrato-st-"));
    expect(st.map((e) => [e.titulo, e.detalhe ?? null])).toEqual([
      ["Contrato CT-1: aguardando assinatura", null],
      ["Contrato CT-1: em renovação", "Reajuste anual em negociação"],
    ]);
    const fat = evs.filter((e) => /^fatura-m\d$/.test(e.id)).map((e) => e.titulo).sort();
    expect(fat).toEqual(["Fatura FAT-1 cancelada", "Fatura FAT-2 criada"]);
  });

  it("H12: pedido resolvido por outro meio não aparece como \"conferido\"", async () => {
    logar();
    const t: string[] = (await historicoApi("c1")).json.eventos.map((e: any) => e.titulo);
    expect(t).toContain("Pedido PC-5: resolvido por outro meio");
    expect(t).not.toContain("Pedido PC-5 conferido");
  });

  it("H03: POST com o mesmo CNPJ escrito de outro jeito = repetido (409); de outra empresa não conta", async () => {
    logar();
    const base = { tipoPessoa: "JURIDICA", nome: "Repetido" };
    expect((await criarCliente({ ...base, cpfCnpj: "11222333000181" })).status).toBe(409); // c1 foi gravado com pontuação
    expect((await criarCliente({ ...base, cpfCnpj: "11.444.777/0001-61" })).status).toBe(409); // c2 foi gravado só com dígitos
    const outra = await criarCliente({ ...base, cpfCnpj: "45.723.174/0001-10" }); // existe só na e2
    expect(outra.status).toBe(201);
    // o que está gravado não muda
    expect((await prisma.cliente.findUnique({ where: { id: "c1" } })).cpfCnpj).toBe("11.222.333/0001-81");
  });

  it("H03: documento novo inválido = 400 com mensagem clara (CNPJ e CPF)", async () => {
    logar();
    const r = await criarCliente({ tipoPessoa: "JURIDICA", nome: "Inválido", cpfCnpj: "11.222.333/0001-82" });
    expect([r.status, r.json.erro]).toEqual([400, "CNPJ inválido: confira os 14 dígitos."]);
    const pf = await criarCliente({ tipoPessoa: "FISICA", nome: "Pessoa", cpfCnpj: "111.444.777-36" });
    expect([pf.status, pf.json.erro]).toEqual([400, "CPF inválido: confira os 11 dígitos."]);
  });

  it("H03: PUT — trocar para o CNPJ de outro (com outra pontuação) = 409; o próprio com outra pontuação passa; trocado inválido = 400", async () => {
    logar();
    const base = { tipoPessoa: "JURIDICA", nome: "Cliente Dois" };
    expect((await editarCliente("c2", { ...base, cpfCnpj: "11222333000181" })).status).toBe(409);
    expect((await editarCliente("c2", { ...base, cpfCnpj: "11.444.777/0001-61" })).status).toBe(200);
    const inv = await editarCliente("c2", { ...base, cpfCnpj: "11.444.777/0001-62" });
    expect([inv.status, inv.json.erro]).toEqual([400, "CNPJ inválido: confira os 14 dígitos."]);
  });

  it("H18: \"exigir endereço\" da empresa: o POST sem endereço principal nem local = 400; com o principal, cria", async () => {
    logar();
    await prisma.configuracao.create({ data: { empresaId: "e1", clienteExigirUnidade: true } });
    const sem = await criarCliente({ tipoPessoa: "JURIDICA", nome: "Sem endereço", cpfCnpj: "44.444.444/0001-91" });
    expect([sem.status, sem.json.erro]).toEqual([400, "Preencha o endereço principal ou adicione um local de atendimento (configuração da empresa)."]);
    expect(await prisma.cliente.count({ where: { nome: "Sem endereço" } })).toBe(0);
    const com = await criarCliente({ tipoPessoa: "JURIDICA", nome: "Com endereço", cpfCnpj: "44.444.444/0001-91", endereco: "Rua A", cidade: "Goiânia" });
    expect(com.status).toBe(201);
  });
});
