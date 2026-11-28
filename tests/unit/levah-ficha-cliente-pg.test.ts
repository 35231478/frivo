/**
 * Leva H — Ficha do cliente profissional, contra PostgreSQL real:
 *  - o HISTÓRICO AUTOMÁTICO (lib/clientes/historico-server + GET /api/clientes/[id]/historico): cada fonte vira o
 *    evento certo, só deste cliente e desta empresa; o financeiro só para quem vê o financeiro; 404 / 403;
 *  - o cliente NOVO com endereço principal ganha o local "Principal" (POST /api/clientes);
 *  - o "Inadimplente · R$ X em atraso" (calcularStatusFinanceiroDetalhado.valorEmAtraso);
 *  - o "Ver só os próprios" (COM-1) no histórico: OS, orçamentos, pedidos e lembretes só os da pessoa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/levah-ficha-cliente-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_levah_ficha_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), role = "ADMIN", empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: "a@x.com", empresaId, role, permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

const D = (iso: string) => new Date(iso);

describe.skipIf(!URL_PG)("Leva H — ficha do cliente (PostgreSQL real)", () => {
  let prisma: any;
  let historicoServer: typeof import("@/lib/clientes/historico-server");

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

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    historicoServer = await import("@/lib/clientes/historico-server");
    await Promise.all([import("@/app/api/clientes/route"), import("@/app/api/clientes/[id]/historico/route")]);

    for (const e of ["e1", "e2"]) {
      await prisma.empresa.create({ data: { id: e, nome: `Empresa ${e}`, cnpj: e === "e1" ? "12345678000190" : "98765432000110", email: `${e}@x.com` } });
    }
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.usuario.create({ data: { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" } });
    const cli = (id: string, empresaId: string, cpfCnpj: string) => prisma.cliente.create({ data: { id, empresaId, nome: `Cliente ${id}`, cpfCnpj, tipoPessoa: "JURIDICA" } });
    await cli("c1", "e1", "11111111000111"); await cli("c2", "e1", "22222222000122"); await cli("cx", "e2", "33333333000133");

    // ── Fontes do cliente c1 ──
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", clienteId: "c1", numero: "OS-1", criadoPorId: "u1", descricao: "Preventiva", criadoEm: D("2026-11-01T12:00:00Z"), dataConclusao: D("2026-11-03T15:00:00Z") } });
    await prisma.ordemServico.create({ data: { id: "os2", empresaId: "e1", clienteId: "c1", numero: "OS-2", criadoPorId: "u1", descricao: "Ar pingando", origem: "PORTAL_CLIENTE", criadoEm: D("2026-11-04T12:00:00Z") } });
    await prisma.osAceite.create({ data: { empresaId: "e1", ordemServicoId: "os1", token: "tk-aceite-1", confirmadoEm: D("2026-11-03T18:00:00Z"), avaliacao: 5 } });
    await prisma.osAceite.create({ data: { empresaId: "e1", ordemServicoId: "os2", token: "tk-aceite-2" } }); // não confirmado: fora
    await prisma.orcamento.create({ data: { id: "orc1", empresaId: "e1", clienteId: "c1", codigo: "ORC-1", nome: "Troca do compressor", criadoPorId: "u1", tokenPublico: "tk-orc-1", criadoEm: D("2026-11-05T12:00:00Z") } });
    await prisma.orcamentoEvento.createMany({ data: [
      { id: "oe1", empresaId: "e1", orcamentoId: "orc1", tipo: "ENVIADO_EMAIL", detalhe: "para compras@c1.com", usuarioId: "u1", criadoEm: D("2026-11-05T13:00:00Z") },
      { id: "oe2", empresaId: "e1", orcamentoId: "orc1", tipo: "VISUALIZADO", criadoEm: D("2026-11-05T14:00:00Z") },
      { id: "oe3", empresaId: "e1", orcamentoId: "orc1", tipo: "APROVADO", criadoEm: D("2026-11-06T12:00:00Z") },
      { id: "oe4", empresaId: "e1", orcamentoId: "orc1", tipo: "EDITADO", criadoEm: D("2026-11-06T12:30:00Z") }, // tipo fora do histórico
    ] });
    await prisma.pedidoCliente.create({ data: { id: "pc1", empresaId: "e1", clienteId: "c1", numero: "PC-77", data: D("2026-11-07T00:00:00Z"), origem: "PORTAL", criadoEm: D("2026-11-07T12:00:00Z"), conferidoEm: D("2026-11-08T12:00:00Z"), situacao: "RECUSADO", motivoRecusa: "Sem assinatura" } });
    await prisma.pedidoClienteLembrete.create({ data: { empresaId: "e1", clienteId: "c1", etapa: 1, chave: "lembrete-c1-1", envio: "EMAIL", para: "compras@c1.com", enviadoEm: D("2026-11-09T12:00:00Z") } });
    await prisma.contrato.create({ data: { id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-9", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: D("2026-11-01T00:00:00Z"), criadoEm: D("2026-11-10T12:00:00Z") } });
    await prisma.contratoHistoricoStatus.create({ data: { empresaId: "e1", contratoId: "ct1", statusAnterior: "AGUARDANDO_ASSINATURA", statusNovo: "ATIVO", usuarioId: "u1", createdAt: D("2026-11-11T12:00:00Z") } });
    await prisma.interacaoCliente.create({ data: { id: "n1", empresaId: "e1", clienteId: "c1", usuarioId: "u1", tipo: "LIGACAO", descricao: "Pediu visita na sexta", criadoEm: D("2026-10-20T12:00:00Z") } });
    await prisma.medicao.create({ data: { id: "m1", empresaId: "e1", clienteId: "c1", numero: "FAT-3", tokenPublico: "tk-med-1", valorLiquido: 1500, criadoEm: D("2026-11-12T12:00:00Z"), dataEnvio: D("2026-11-12T13:00:00Z"), dataPagamento: D("2026-11-20T12:00:00Z") } });
    await prisma.contaReceber.create({ data: { id: "cr1", empresaId: "e1", clienteId: "c1", numero: "CR-1", descricao: "Parcela 1", valor: 1000, dataVencimento: D("2026-11-15T12:00:00Z") } });
    await prisma.contaReceberRecebimento.create({ data: { id: "rb1", empresaId: "e1", contaReceberId: "cr1", valor: 400, data: D("2026-11-16T12:00:00Z"), estornadoEm: D("2026-11-17T12:00:00Z") } });
    await prisma.contaReceberEvento.create({ data: { id: "ce1", empresaId: "e1", contaReceberId: "cr1", tipo: "COBRANCA_ENVIADA", detalhe: "por e-mail", criadoEm: D("2026-11-14T12:00:00Z") } });
    await prisma.emailLog.create({ data: { id: "em1", empresaId: "e1", para: "manut@c1.com", assunto: "Relatório da OS-1", referenciaTipo: "OrdemServico", referenciaId: "os1", status: "ENVIADO", enviadoEm: D("2026-11-03T19:00:00Z") } });
    await prisma.documentacaoEnvio.create({ data: { id: "de1", empresaId: "e1", clienteId: "c1", clienteNome: "Cliente c1" } });
    await prisma.documentacaoEnvioEvento.createMany({ data: [
      { id: "dv1", envioId: "de1", tipo: "EMAIL_ENVIADO", criadoEm: D("2026-11-18T12:00:00Z") },
      { id: "dv2", envioId: "de1", tipo: "ACESSO", criadoEm: D("2026-11-18T14:00:00Z") },
      { id: "dv3", envioId: "de1", tipo: "ACESSO", usuarioId: "u1", criadoEm: D("2026-11-18T15:00:00Z") }, // gente do escritório: fora
    ] });

    // ── Ruído: outro cliente da mesma empresa e cliente de outra empresa ──
    await prisma.ordemServico.create({ data: { id: "os9", empresaId: "e1", clienteId: "c2", numero: "OS-9", criadoPorId: "u1", descricao: "De outro cliente" } });
    await prisma.ordemServico.create({ data: { id: "osx", empresaId: "e2", clienteId: "cx", numero: "OS-X", criadoPorId: "u2", descricao: "De outra empresa" } });
    await prisma.interacaoCliente.create({ data: { empresaId: "e1", clienteId: "c2", usuarioId: "u1", tipo: "VISITA", descricao: "Nota do c2" } });
    await prisma.emailLog.create({ data: { empresaId: "e1", para: "x@c2.com", assunto: "Do c2", referenciaTipo: "OrdemServico", referenciaId: "os9" } });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const resumo = (evs: { id: string; tipo: string; titulo: string }[]) => evs.map((e) => `${e.tipo} | ${e.titulo}`);

  it("cada fonte vira o evento certo, do mais recente ao mais antigo; só deste cliente e desta empresa", async () => {
    const evs = await historicoServer.carregarHistoricoCliente("e1", "c1", { comFinanceiro: true });
    expect(resumo(evs)).toEqual([
      "financeiro | Fatura FAT-3 paga",
      "portal | Cliente abriu a documentação da equipe",
      "comunicacao | Documentação da equipe enviada por e-mail",
      "financeiro | Pagamento estornado · R$ 400,00",
      "financeiro | Pagamento recebido · R$ 400,00",
      "comunicacao | Cobrança enviada",
      "comunicacao | Fatura FAT-3 enviada ao cliente",
      "financeiro | Fatura FAT-3 criada",
      "contrato | Contrato CT-9: ativo",
      "contrato | Contrato CT-9 cadastrado",
      "comunicacao | Lembrete do pedido de compra enviado",
      "pedido | Pedido PC-77 recusado na conferência",
      "portal | Cliente enviou o pedido PC-77 pelo portal",
      "orcamento | Orçamento ORC-1 aprovado",
      "portal | Cliente abriu o orçamento ORC-1",
      "orcamento | Orçamento ORC-1 enviado por e-mail",
      "orcamento | Orçamento ORC-1 criado",
      "portal | Cliente abriu a OS OS-2 pelo portal",
      "comunicacao | E-mail enviado: Relatório da OS-1",
      "portal | Cliente confirmou o serviço da OS OS-1",
      "os | OS OS-1 concluída",
      "os | OS OS-1 criada",
      "nota | Ligação",
    ]);
    const por = (id: string) => evs.find((e) => e.id === id)!;
    expect(por("os-criada-os1")).toMatchObject({ detalhe: "Preventiva", href: "/ordens/os1", autor: "Ana" });
    expect(por("os-criada-os2").autor).toBeUndefined(); // o cliente abriu: sem autor do escritório
    expect(evs.find((e) => e.titulo.startsWith("Cliente confirmou"))!).toMatchObject({ detalhe: "Avaliação: 5 de 5", href: "/ordens/os1" });
    expect(por("orc-ev-oe1")).toMatchObject({ detalhe: "para compras@c1.com", autor: "Ana", href: "/orcamentos/orc1" });
    expect(por("pedido-conf-pc1").detalhe).toBe("Sem assinatura");
    expect(por("nota-n1")).toMatchObject({ detalhe: "Pediu visita na sexta", autor: "Ana" });
    expect(por("fatura-m1")).toMatchObject({ detalhe: "R$ 1.500,00", href: "/financeiro/medicoes/m1" });
    expect(por("cobranca-ce1").detalhe).toBe("por e-mail");
    expect(por("email-em1").detalhe).toBe("manut@c1.com");
    // nada do c2 nem da outra empresa
    expect(evs.some((e) => /OS-9|OS-X|Nota do c2|Do c2/.test(`${e.titulo} ${e.detalhe ?? ""}`))).toBe(false);
  });

  it("sem o financeiro: faturas, pagamentos e cobranças ficam de fora (o resto continua)", async () => {
    const evs = await historicoServer.carregarHistoricoCliente("e1", "c1", { comFinanceiro: false });
    expect(evs.some((e) => e.tipo === "financeiro")).toBe(false);
    expect(evs.some((e) => /Fatura|Cobrança|Pagamento/.test(e.titulo))).toBe(false);
    // fatura criada, enviada e paga; pagamento recebido e estornado; cobrança enviada: 6 a menos
    expect(evs.length).toBe(23 - 6);
  });

  it("o cliente de outra empresa não vaza: a busca com a empresa errada volta vazia", async () => {
    expect(await historicoServer.carregarHistoricoCliente("e2", "c1", { comFinanceiro: true })).toEqual([]);
  });

  it("corte: no máximo `limite` eventos (os mais recentes) e `porFonte` por fonte", async () => {
    const evs = await historicoServer.carregarHistoricoCliente("e1", "c1", { comFinanceiro: true, limite: 3 });
    expect(evs.map((e) => e.titulo)).toEqual(["Fatura FAT-3 paga", "Cliente abriu a documentação da equipe", "Documentação da equipe enviada por e-mail"]);
    const um = await historicoServer.carregarHistoricoCliente("e1", "c1", { comFinanceiro: false, porFonte: 1 });
    expect(um.filter((e) => e.id.startsWith("os-criada-")).length).toBe(1);
    // o aceite NÃO confirmado da OS-2 não ocupa a vaga: com 1 por fonte, vem o confirmado da OS-1
    expect(um.filter((e) => e.titulo.startsWith("Cliente confirmou")).map((e) => e.titulo)).toEqual(["Cliente confirmou o serviço da OS OS-1"]);
  });

  it("API: quem vê clientes vê o histórico; o financeiro só com contas a receber ou faturas", async () => {
    logar(montarPermissoes({ clientes: ["visualizar"] }), "OPERADOR");
    let r = await historicoApi("c1");
    expect(r.status).toBe(200);
    expect(r.json.eventos.some((e: any) => e.tipo === "financeiro")).toBe(false);
    expect(r.json.eventos.length).toBe(17);

    logar(montarPermissoes({ clientes: ["visualizar"], financeiro: ["contasReceber"] }), "OPERADOR");
    r = await historicoApi("c1");
    expect(r.json.eventos.length).toBe(23);
    logar(montarPermissoes({ clientes: ["visualizar"], financeiro: ["medicoes"] }), "OPERADOR");
    expect((await historicoApi("c1")).json.eventos.length).toBe(23);
    // datas chegam como texto ISO, ordenadas
    expect(typeof r.json.eventos[0].quando).toBe("string");
  });

  it("API: cliente de outra empresa → 404; sem ver clientes → 403", async () => {
    logar(permissoesTotais(), "ADMIN", "e2");
    expect((await historicoApi("c1")).status).toBe(404);
    logar(montarPermissoes({ ordens: ["visualizar"] }), "OPERADOR");
    expect((await historicoApi("c1")).status).toBe(403);
    logar();
  });

  it("cliente NOVO com endereço principal: ganha o local \"Principal\" com esse endereço", async () => {
    logar();
    const r = await criarCliente({
      tipoPessoa: "JURIDICA", nome: "Clínica Nova", cpfCnpj: "44.444.444/0001-44", telefone: "6233334444",
      cep: "74000-000", endereco: "Avenida Central", numero: "1000", complemento: "Sala 2", bairro: "Setor Central", cidade: "Goiânia", estado: "go",
    });
    expect(r.status).toBe(201);
    const c = await prisma.cliente.findUnique({ where: { id: r.json.id }, include: { unidades: true } });
    expect([c.endereco, c.cidade, c.cep]).toEqual(["Avenida Central", "Goiânia", "74000-000"]); // o principal fica no cadastro
    expect(c.unidades.map((u: any) => [u.nome, u.principal, u.logradouro, u.numero, u.estado, u.cep, u.telefone, u.empresaId]))
      .toEqual([["Principal", true, "Avenida Central", "1000", "GO", "74000-000", "6233334444", "e1"]]);
  });

  it("cliente NOVO com endereço principal e outros locais: Principal + os outros como secundários", async () => {
    const r = await criarCliente({
      tipoPessoa: "JURIDICA", nome: "Clínica Duas", cpfCnpj: "55.555.555/0001-55", endereco: "Avenida Central", numero: "1000", cidade: "Goiânia",
      unidades: [{ nome: "Anexo", principal: true, logradouro: "Rua dos Ipês", numero: "80", cidade: "Goiânia" }],
    });
    expect(r.status).toBe(201);
    const us = await prisma.unidade.findMany({ where: { clienteId: r.json.id }, orderBy: { nome: "asc" } });
    expect(us.map((u: any) => [u.nome, u.principal])).toEqual([["Anexo", false], ["Principal", true]]);
  });

  it("um local informado igual ao endereço principal não duplica; sem endereço nem local, nenhum local", async () => {
    let r = await criarCliente({
      tipoPessoa: "JURIDICA", nome: "Clínica Três", cpfCnpj: "66.666.666/0001-66", endereco: "Avenida Central", numero: "1000", cidade: "Goiânia",
      unidades: [{ nome: "Matriz", principal: true, logradouro: "avenida central", numero: "1000", cidade: "Goiânia" }],
    });
    expect((await prisma.unidade.findMany({ where: { clienteId: r.json.id } })).map((u: any) => [u.nome, u.principal])).toEqual([["Matriz", true]]);
    r = await criarCliente({ tipoPessoa: "JURIDICA", nome: "Clínica Quatro", cpfCnpj: "77.777.777/0001-77" });
    expect(r.status).toBe(201);
    expect(await prisma.unidade.count({ where: { clienteId: r.json.id } })).toBe(0);
  });

  it("\"Inadimplente\" com valor: soma o que falta das vencidas em aberto (baixa parcial abatida); o resto não entra", async () => {
    const { calcularStatusFinanceiroDetalhado } = await import("@/lib/status-financeiro");
    await prisma.cliente.create({ data: { id: "cf", empresaId: "e1", nome: "Financeiro", cpfCnpj: "88888888000188", tipoPessoa: "JURIDICA" } });
    const dia = (n: number) => new Date(Date.now() + n * 86_400_000);
    const conta = (id: string, valor: number, venc: Date, status: string, valorRecebido = 0, empresaId = "e1") =>
      prisma.contaReceber.create({ data: { id, empresaId, clienteId: "cf", numero: id, descricao: id, valor, valorRecebido, dataVencimento: venc, status } });
    expect(await calcularStatusFinanceiroDetalhado("cf", "e1")).toEqual({ status: "SEM_HISTORICO", totalProximos30Dias: 0, valorEmAtraso: 0 });
    await conta("v1", 1000, dia(-10), "A_RECEBER", 200);   // vencida, parcial: falta 800
    await conta("v2", 300.55, dia(-3), "ATRASADO");         // vencida: 300,55
    await conta("v3", 999, dia(-5), "RECEBIDO", 999);       // paga: fora
    await conta("v4", 500, dia(-5), "CANCELADO");           // cancelada: fora
    await conta("v5", 250, dia(5), "A_RECEBER");            // a vencer em 30 dias
    await conta("v6", 700, dia(60), "A_RECEBER");           // além de 30 dias: fora dos dois
    expect(await calcularStatusFinanceiroDetalhado("cf", "e1")).toEqual({ status: "INADIMPLENTE", totalProximos30Dias: 250, valorEmAtraso: 1100.55 });
    // a outra empresa não enxerga nada disso
    expect((await calcularStatusFinanceiroDetalhado("cf", "e2")).valorEmAtraso).toBe(0);
  });

  it("\"Ver só os próprios\" (COM-1): o vendedor vê no histórico só as OS, os orçamentos, os pedidos e os lembretes dele", async () => {
    await prisma.usuario.create({ data: { id: "u3", empresaId: "e1", nome: "Vera", email: "v@x.com", senha: "x" } });
    await prisma.ordemServico.create({ data: { id: "os3", empresaId: "e1", clienteId: "c1", numero: "OS-3", criadoPorId: "u1", vendedorId: "u3", descricao: "Da Vera", criadoEm: D("2026-11-21T12:00:00Z") } });
    await prisma.orcamento.create({ data: { id: "orc3", empresaId: "e1", clienteId: "c1", codigo: "ORC-3", nome: "Da Vera", criadoPorId: "u1", vendedorId: "u3", tokenPublico: "tk-orc-3", criadoEm: D("2026-11-21T13:00:00Z") } });
    await prisma.orcamentoEvento.create({ data: { empresaId: "e1", orcamentoId: "orc3", tipo: "APROVADO", criadoEm: D("2026-11-21T14:00:00Z") } });
    await prisma.pedidoCliente.create({ data: { id: "pc3", empresaId: "e1", clienteId: "c1", numero: "PC-3", data: D("2026-11-21T00:00:00Z"), criadoEm: D("2026-11-21T15:00:00Z"), ordens: { connect: [{ id: "os3" }] } } });
    await prisma.pedidoClienteLembrete.create({ data: { empresaId: "e1", clienteId: "c1", ordemServicoId: "os3", etapa: 1, chave: "lembrete-os3", envio: "EMAIL", para: "compras@c1.com", enviadoEm: D("2026-11-21T16:00:00Z") } });

    logar(montarPermissoes({ clientes: ["visualizar"], ordens: ["visualizar", "verSoProprios"], orcamentos: ["visualizar", "verSoProprios"] }), "OPERADOR", "e1", "u3");
    const r = await historicoApi("c1");
    expect(r.status).toBe(200);
    const titulos: string[] = r.json.eventos.map((e: any) => e.titulo);
    expect(titulos.filter((t) => /OS-|ORC-|PC-|Pedido|pedido de compra/.test(t))).toEqual([
      "Lembrete do pedido de compra enviado",
      "Pedido do cliente PC-3 registrado",
      "Orçamento ORC-3 aprovado",
      "Orçamento ORC-3 criado",
      "OS OS-3 criada",
    ]);
    // o que não é de OS nem de orçamento continua (notas, contratos, documentação)
    expect(titulos).toContain("Ligação");
    expect(titulos).toContain("Contrato CT-9 cadastrado");

    // sem a marca (ou ADMIN): vê tudo, inclusive as da Vera
    logar(montarPermissoes({ clientes: ["visualizar"], ordens: ["visualizar"], orcamentos: ["visualizar"] }), "OPERADOR", "e1", "u3");
    const todos: string[] = (await historicoApi("c1")).json.eventos.map((e: any) => e.titulo);
    expect(todos).toEqual(expect.arrayContaining(["OS OS-1 criada", "OS OS-3 criada", "Orçamento ORC-1 criado", "Pedido PC-77 recusado na conferência", "Pedido do cliente PC-3 registrado"]));
    logar();
  });
});
