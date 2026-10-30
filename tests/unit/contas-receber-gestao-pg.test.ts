/**
 * Contas a Receber — gestão, pelas rotas reais com o Prisma real num PostgreSQL real (schema
 * descartável via `prisma db push`):
 *  - detalhes (GET): origem com OS ligadas, itens, notas, boleto e a linha do tempo; outra empresa/excluída = 404;
 *  - edição completa (PUT): categoria, centro de custo, conta bancária (o nome vai para `banco`), forma,
 *    vencimento, valor, observações e cliente (só conta manual), com evento "Editada" do que mudou;
 *    vínculo de outra empresa/inativo novo = 400; travas: boleto emitido, nota fiscal, recebida;
 *  - baixa (RECEBIDO) com conta bancária e comentário → evento; medição vira PAGO; 2ª baixa = 409;
 *  - cancelar exige motivo; boleto emitido/recebida = 409;
 *  - excluir (lógico): só manual sem nota; some da lista e dos totais; registro e histórico ficam;
 *  - criação manual com conta bancária/centro + evento "Criada"; cobrança enviada vira evento;
 *  - contas vinculadas (orçamento, medição, OS) e o recibo (só recebida, valor por extenso);
 *  - cadastro de contas bancárias (nome único na empresa);
 *  - RBAC: sem Financeiro › Contas a receber = 403.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/contas-receber-gestao-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_cr_gestao_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}), enviarBoleto: vi.fn(async () => {}) }));
const nav = vi.hoisted(() => ({ redirect: vi.fn((u: string) => { throw new Error(`REDIRECT ${u}`); }), notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));
vi.mock("next/navigation", () => ({ redirect: nav.redirect, notFound: nav.notFound, useRouter: () => ({}), usePathname: () => "/" }));

const logar = (permissoes: Permissoes = permissoesTotais(), id = "u1", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

type Resp = { status: number; json: any };
async function chamar(rota: string, metodo: string, id: string | null, corpo?: unknown): Promise<Resp> {
  const mod = await import(`@/app/api/contas-receber/${rota}`);
  const url = `http://localhost/api/contas-receber${id ? `/${id}` : ""}`;
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, ...(corpo !== undefined && { body: JSON.stringify(corpo) }) });
  const res = await mod[metodo](req, id ? { params: Promise.resolve({ id }) } : undefined);
  return { status: res.status, json: await res.json() };
}
const item = (metodo: string, id: string, corpo?: unknown) => chamar("[id]/route", metodo, id, corpo);
const ROTAS = { "[id]/route": () => import("@/app/api/contas-receber/[id]/route"), route: () => import("@/app/api/contas-receber/route"), "[id]/notificar/route": () => import("@/app/api/contas-receber/[id]/notificar/route") };

describe.skipIf(!URL_PG)("Contas a Receber — gestão (PostgreSQL real)", () => {
  let prisma: any;
  const eventos = async (id: string) => (await prisma.contaReceberEvento.findMany({ where: { contaReceberId: id }, orderBy: { criadoEm: "asc" } })).map((e: any) => [e.tipo, e.detalhe]);
  let n = 0;
  async function conta(dados: Record<string, unknown> = {}) {
    n++;
    return prisma.contaReceber.create({
      data: { id: `cr${n}`, empresaId: "e1", clienteId: "c1", numero: `CR-2026-${String(n).padStart(4, "0")}`, descricao: "Manutenção corretiva", valor: 1234.56, status: "A_RECEBER", dataVencimento: new Date("2026-11-20T00:00:00Z"), ...dados },
    });
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((f) => f()));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Refrigeração Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "e@x.com", cidade: "São Paulo", estado: "SP" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "c2", empresaId: "e1", nome: "Padaria Pão Dourado", cpfCnpj: "11222333000262" },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.categoriaFinanceira.createMany({ data: [
      { id: "cat1", empresaId: "e1", nome: "Serviços avulsos" },
      { id: "catI", empresaId: "e1", nome: "Antiga", ativo: false },
    ] });
    await prisma.centroCusto.createMany({ data: [
      { id: "cc1", empresaId: "e1", nome: "Obra Shopping Norte" },
      { id: "ccX", empresaId: "e2", nome: "Da outra" },
    ] });
    await prisma.contaBancaria.createMany({ data: [
      { id: "cb1", empresaId: "e1", nome: "Inter PJ", banco: "Banco Inter (077)", agencia: "0001", conta: "1234567-8" },
      { id: "cbI", empresaId: "e1", nome: "Itaú (encerrada)", ativo: false },
      { id: "cbX", empresaId: "e2", nome: "Da outra" },
    ] });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("edição completa por ID, com o nome da conta bancária em `banco` e o evento do que mudou", async () => {
    const c = await conta({ banco: "Itaú (texto antigo)" });
    const r = await item("PUT", c.id, {
      descricao: "Manutenção corretiva — Bloco B", valor: 1500, dataVencimento: "2026-12-05", formaPagamento: "PIX",
      categoriaId: "cat1", centroCustoId: "cc1", contaBancariaId: "cb1", observacao: "Cliente pediu PIX.",
    });
    expect(r.status).toBe(200);
    const g = await prisma.contaReceber.findUnique({ where: { id: c.id } });
    expect(g).toMatchObject({ descricao: "Manutenção corretiva — Bloco B", formaPagamento: "PIX", categoriaId: "cat1", categoria: "Serviços avulsos", centroCustoId: "cc1", contaBancariaId: "cb1", banco: "Inter PJ", observacao: "Cliente pediu PIX." });
    expect(Number(g.valor)).toBe(1500);
    expect(g.dataVencimento.toISOString().slice(0, 10)).toBe("2026-12-05");
    const [[tipo, detalhe]] = await eventos(c.id);
    expect(tipo).toBe("EDITADA");
    expect(detalhe).toContain("Descrição alterada");
    expect(detalhe).toMatch(/Valor: R\$\s?1\.234,56 → R\$\s?1\.500,00/);
    expect(detalhe).toContain("Vencimento: 20/11/2026 → 05/12/2026");
    expect(detalhe).toContain("Forma de pagamento: — → PIX");
    expect(detalhe).toContain("Categoria: — → Serviços avulsos");
    expect(detalhe).toContain("Centro de custo: — → Obra Shopping Norte");
    expect(detalhe).toContain("Conta bancária: Itaú (texto antigo) → Inter PJ");
    expect(detalhe).toContain("Observações alterada");
    // Salvar sem mudar nada não grava evento
    await item("PUT", c.id, { descricao: "Manutenção corretiva — Bloco B" });
    expect(await eventos(c.id)).toHaveLength(1);
  });

  it("vínculos: de outra empresa = 400; escolha NOVA inativa = 400; manter a inativa que já tinha = 200", async () => {
    const c = await conta({ contaBancariaId: "cbI" });
    expect((await item("PUT", c.id, { contaBancariaId: "cbX" })).json.erro).toBe("Conta bancária inválido(a).");
    expect((await item("PUT", c.id, { centroCustoId: "ccX" })).json.erro).toBe("Centro de custo inválido(a).");
    expect((await item("PUT", c.id, { categoriaId: "catI" })).json.erro).toBe("Categoria financeira inativo(a): escolha um(a) ativo(a).");
    const outra = await conta();
    expect((await item("PUT", outra.id, { contaBancariaId: "cbI" })).status).toBe(400);
    expect((await item("PUT", c.id, { contaBancariaId: "cbI", descricao: "Mantém a conta antiga" })).status).toBe(200);
  });

  it("cliente: troca só na conta manual (cnpj acompanha); de orçamento = 409; de outra empresa = 400", async () => {
    const c = await conta();
    expect((await item("PUT", c.id, { clienteId: "cX" })).json.erro).toBe("Cliente inválido(a).");
    expect((await item("PUT", c.id, { clienteId: "c2" })).status).toBe(200);
    expect(await prisma.contaReceber.findUnique({ where: { id: c.id } })).toMatchObject({ clienteId: "c2", clienteCnpj: "11222333000262" });
    expect((await eventos(c.id)).at(-1)?.[1]).toContain("Cliente: Hospital Santa Luzia → Padaria Pão Dourado");
    const orc = await prisma.orcamento.create({ data: { id: "orcT", empresaId: "e1", codigo: "ORC-T", nome: "Troca", clienteId: "c1", criadoPorId: "u1", status: "APROVADO", tokenPublico: "tk-orcT" } });
    const deOrc = await conta({ orcamentoId: orc.id });
    const r = await item("PUT", deOrc.id, { clienteId: "c2" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toBe("O cliente vem da origem da conta.");
  });

  it("travas: boleto emitido trava valor e vencimento; nota fiscal trava o valor; recebida trava os dois", async () => {
    const comBoleto = await conta({ boletoStatus: "EMITIDO", boletoId: "b1" });
    expect((await item("PUT", comBoleto.id, { valor: 999 })).status).toBe(409);
    expect((await item("PUT", comBoleto.id, { dataVencimento: "2026-12-30" })).json.erro).toBe("Boleto emitido: cancele o boleto para mudar.");
    expect((await item("PUT", comBoleto.id, { valor: 1234.56, dataVencimento: "2026-11-20", observacao: "ok" })).status).toBe(200); // os mesmos valores passam
    const comNota = await conta();
    await prisma.notaFiscal.create({ data: { empresaId: "e1", clienteId: "c1", contaReceberId: comNota.id, origem: "MEDICAO", ambiente: "HOMOLOGACAO", status: "CONCLUIDO", grupo: "g", valorServicos: 1234.56, discriminacao: "x", tomadorCpfCnpj: "11222333000181", tomadorNome: "H" } });
    expect((await item("PUT", comNota.id, { valor: 10 })).json.erro).toBe("Valor da nota fiscal emitida.");
    expect((await item("PUT", comNota.id, { dataVencimento: "2026-12-30" })).status).toBe(200);
    const recebida = await conta({ status: "RECEBIDO", dataRecebimento: new Date() });
    expect((await item("PUT", recebida.id, { dataVencimento: "2026-12-30" })).json.erro).toBe("Conta recebida.");
    expect((await item("PUT", recebida.id, { categoriaId: "cat1" })).status).toBe(200); // classificação continua editável
  });

  it("baixa: recebida com data, forma, conta bancária e comentário no histórico; medição vira PAGO; 2ª baixa = 409", async () => {
    const med = await prisma.medicao.create({ data: { id: "medB", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0001", tokenPublico: "tk-medB", status: "APROVADA" } });
    const c = await conta({ medicaoId: med.id });
    const r = await item("PUT", c.id, { status: "RECEBIDO", dataRecebimento: "2026-11-18", formaPagamento: "PIX", contaBancariaId: "cb1", comentario: "Comprovante no e-mail" });
    expect(r.status).toBe(200);
    expect(await prisma.contaReceber.findUnique({ where: { id: c.id } })).toMatchObject({ status: "RECEBIDO", contaBancariaId: "cb1", banco: "Inter PJ", formaPagamento: "PIX" });
    expect((await prisma.medicao.findUnique({ where: { id: med.id } })).status).toBe("PAGO");
    const [[tipo, detalhe]] = await eventos(c.id);
    expect(tipo).toBe("RECEBIDA");
    expect(detalhe).toMatch(/^R\$\s?1\.234,56 em 18\/11\/2026 · PIX · Inter PJ · Comprovante no e-mail$/);
    const deNovo = await item("PUT", c.id, { status: "RECEBIDO" });
    expect(deNovo.status).toBe(409);
    expect(deNovo.json.erro).toBe("Esta conta já foi recebida.");
  });

  it("baixa em dois cliques simultâneos: só um vence (os outros = 409) e o histórico tem UMA baixa", async () => {
    const c = await conta();
    const rs = await Promise.all([1, 2, 3].map(() => item("PUT", c.id, { status: "RECEBIDO", dataRecebimento: "2026-11-18" })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await eventos(c.id)).filter((e: any[]) => e[0] === "RECEBIDA")).toHaveLength(1);
  });

  it("cancelar: exige motivo; grava data/motivo e o evento; boleto emitido ou recebida = 409", async () => {
    const c = await conta();
    expect((await item("PUT", c.id, { status: "CANCELADO" })).json.erro).toBe("Informe o motivo do cancelamento.");
    expect((await item("PUT", c.id, { status: "CANCELADO", motivoCancelamento: "Serviço não realizado" })).status).toBe(200);
    const g = await prisma.contaReceber.findUnique({ where: { id: c.id } });
    expect(g).toMatchObject({ status: "CANCELADO", motivoCancelamento: "Serviço não realizado" });
    expect(g.canceladaEm).toBeInstanceOf(Date);
    expect(await eventos(c.id)).toEqual([["CANCELADA", "Serviço não realizado"]]);
    const comBoleto = await conta({ boletoStatus: "EMITIDO", boletoId: "b2" });
    expect((await item("PUT", comBoleto.id, { status: "CANCELADO", motivoCancelamento: "x x x" })).json.erro).toContain("Cancele o boleto antes");
    const recebida = await conta({ status: "RECEBIDO" });
    const r = await item("PUT", recebida.id, { status: "CANCELADO", motivoCancelamento: "x x x" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toBe("Conta recebida não pode ser cancelada.");
  });

  it("excluir (lógico): manual some da lista e dos totais, registro e histórico ficam; 2× não duplica", async () => {
    const { whereContasReceber } = await import("@/lib/listas/filtros");
    const c = await conta({ descricao: "Lançada por engano" });
    const naLista = async () => (await prisma.contaReceber.findMany({ where: whereContasReceber("e1", {}), select: { id: true } })).some((x: any) => x.id === c.id);
    expect(await naLista()).toBe(true);
    const r = await item("DELETE", c.id, { motivo: "Duplicada" });
    expect(r.status).toBe(200);
    const g = await prisma.contaReceber.findUnique({ where: { id: c.id } });
    expect(g.status).toBe("CANCELADO");
    expect(g.excluidaEm).toBeInstanceOf(Date);
    expect(await naLista()).toBe(false);
    const ev = await eventos(c.id);
    expect(ev).toHaveLength(1);
    expect(ev[0][0]).toBe("EXCLUIDA");
    expect(ev[0][1]).toMatch(/^CR-2026-\d{4} — R\$\s?1\.234,56 \(status anterior: A_RECEBER\) · Duplicada$/);
    const deNovo = await item("DELETE", c.id);
    expect(deNovo.status).toBe(409);
    expect(deNovo.json.erro).toBe("Esta conta já foi excluída.");
    expect(await eventos(c.id)).toHaveLength(1);
    // Excluída não abre, não edita
    expect((await item("GET", c.id)).status).toBe(404);
    expect((await item("PUT", c.id, { descricao: "x" })).status).toBe(404);
  });

  it("excluir em cliques simultâneos: um só grava o evento de exclusão", async () => {
    const c = await conta();
    const rs = await Promise.all([1, 2, 3].map(() => item("DELETE", c.id)));
    expect(rs.some((r) => r.status === 200)).toBe(true);
    expect((await eventos(c.id)).filter((e: any[]) => e[0] === "EXCLUIDA")).toHaveLength(1);
  });

  it("excluir: medição, orçamento, contrato, nota fiscal e boleto ativo são recusados com o motivo (use Cancelar)", async () => {
    const med = await prisma.medicao.create({ data: { id: "medE", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0002", tokenPublico: "tk-medE" } });
    const ctr = await prisma.contrato.create({ data: { id: "ctrE", empresaId: "e1", clienteId: "c1", numero: "CT-2026-0001", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date() } });
    const casos: [Record<string, unknown>, string][] = [
      [{ medicaoId: med.id }, "Conta de medição: use Cancelar."],
      [{ orcamentoId: "orcT" }, "Conta de orçamento aprovado: use Cancelar."],
      [{ contratoId: ctr.id, refMes: 11, refAno: 2026 }, "Conta de contrato: use Cancelar."],
      [{ boletoStatus: "EMITIDO", boletoId: "b3" }, "Cancele o boleto antes de excluir."],
    ];
    for (const [dados, msg] of casos) {
      const c = await conta(dados);
      const r = await item("DELETE", c.id);
      expect(r.status).toBe(409);
      expect(r.json.erro).toBe(msg);
      expect((await prisma.contaReceber.findUnique({ where: { id: c.id } })).excluidaEm).toBeNull();
    }
    const comNota = await conta();
    await prisma.notaFiscal.create({ data: { empresaId: "e1", clienteId: "c1", contaReceberId: comNota.id, origem: "OS", ambiente: "PRODUCAO", status: "PROCESSANDO", grupo: "g", valorServicos: 1, discriminacao: "x", tomadorCpfCnpj: "11222333000181", tomadorNome: "H" } });
    expect((await item("DELETE", comNota.id)).json.erro).toBe("Conta com nota fiscal: use Cancelar.");
    // Nota rejeitada não é documento fiscal: a conta manual pode ser excluída
    const comRejeitada = await conta();
    await prisma.notaFiscal.create({ data: { empresaId: "e1", clienteId: "c1", contaReceberId: comRejeitada.id, origem: "OS", ambiente: "PRODUCAO", status: "REJEITADO", grupo: "g", valorServicos: 1, discriminacao: "x", tomadorCpfCnpj: "11222333000181", tomadorNome: "H" } });
    expect((await item("DELETE", comRejeitada.id)).status).toBe(200);
  });

  it("detalhes: origem com a OS da medição (item e relatório), itens, nota, boleto e histórico; outra empresa = 404", async () => {
    const os1 = await prisma.ordemServico.create({ data: { id: "osD1", empresaId: "e1", numero: "OS-2026-0101", clienteId: "c1", descricao: "x", criadoPorId: "u1" } });
    const os2 = await prisma.ordemServico.create({ data: { id: "osD2", empresaId: "e1", numero: "OS-2026-0102", clienteId: "c1", descricao: "y", criadoPorId: "u1" } });
    const med = await prisma.medicao.create({
      data: {
        id: "medD", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0003", tokenPublico: "tk-medD",
        itens: { create: [{ descricao: "Troca de compressor", quantidade: 1, valorUnitario: 1234.56, valorTotal: 1234.56, ordemServicoId: os1.id }] },
      },
    });
    await prisma.relatorioOs.create({ data: { empresaId: "e1", ordemServicoId: os2.id, numero: "REL-2026-0001", mesReferencia: 11, anoReferencia: 2026, tokenPublico: "tk-rel", medicaoId: med.id } });
    const c = await conta({ medicaoId: med.id, boletoStatus: "EMITIDO", boletoId: "b9", boletoLinhaDigitavel: "07790001", boletoVencimento: new Date("2026-11-20T00:00:00Z") });
    await item("PUT", c.id, { observacao: "Ligar antes" });
    const r = await item("GET", c.id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      numero: c.numero, origem: "MEDICAO", medicao: { id: "medD", numero: "MED-2026-0003", relatorios: [{ numero: "REL-2026-0001" }] },
      ordens: [{ id: "osD1", numero: "OS-2026-0101" }, { id: "osD2", numero: "OS-2026-0102" }],
      itens: [{ descricao: "Troca de compressor", quantidade: 1, valorTotal: 1234.56 }],
      boleto: { status: "EMITIDO", linhaDigitavel: "07790001", temPdf: true },
      cliente: { id: "c1", nome: "Hospital Santa Luzia" },
    });
    expect(r.json.eventos.map((e: any) => [e.tipo, e.usuario])).toEqual([["EDITADA", "Ana"]]);
    logar(permissoesTotais(), "u2", "e2");
    try { expect((await item("GET", c.id)).status).toBe(404); } finally { logar(); }
  });

  it("criação manual com conta bancária e centro + evento 'Criada'; cobrança enviada entra no histórico com o canal", async () => {
    const r = await chamar("route", "POST", null, { clienteId: "c1", descricao: "Visita técnica", valor: 250, contaBancariaId: "cb1", centroCustoId: "cc1" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ contaBancariaId: "cb1", banco: "Inter PJ", centroCustoId: "cc1" });
    await chamar("[id]/notificar/route", "POST", r.json.id, { canal: "whatsapp" });
    expect(await eventos(r.json.id)).toEqual([["CRIADA", "Lançamento manual"], ["COBRANCA_ENVIADA", "WhatsApp"]]);
    expect((await chamar("route", "POST", null, { clienteId: "c1", descricao: "x", valor: 1, contaBancariaId: "cbX" })).status).toBe(400);
  });

  it("contas vinculadas: do orçamento, da medição e da OS (por item, relatório ou orçamento gerador); excluída fica de fora", async () => {
    const { contasVinculadas } = await import("@/lib/financeiro/conta-receber-server");
    const orc = await prisma.orcamento.create({ data: { id: "orcV", empresaId: "e1", codigo: "ORC-V", nome: "V", clienteId: "c1", criadoPorId: "u1", status: "APROVADO", tokenPublico: "tk-orcV" } });
    const osG = await prisma.ordemServico.create({ data: { id: "osV", empresaId: "e1", numero: "OS-2026-0201", clienteId: "c1", descricao: "v", criadoPorId: "u1", orcamentoOrigemId: orc.id } });
    const doOrc = await conta({ orcamentoId: orc.id });
    const excluida = await conta({ orcamentoId: orc.id, excluidaEm: new Date(), status: "CANCELADO" });
    expect((await contasVinculadas("e1", { orcamentoId: orc.id })).map((c) => c.id)).toEqual([doOrc.id]);
    expect((await contasVinculadas("e1", { ordemServicoId: osG.id })).map((c) => c.id)).toEqual([doOrc.id]);
    expect((await contasVinculadas("e1", { ordemServicoId: "osD1" })).map((c) => c.numero)).toHaveLength(1);
    expect((await contasVinculadas("e1", { ordemServicoId: "osD2" })).map((c) => c.numero)).toHaveLength(1); // pelo relatório
    expect((await contasVinculadas("e1", { medicaoId: "medD" }))[0]).toMatchObject({ valor: 1234.56, status: "A_RECEBER" });
    expect((await contasVinculadas("e2", { orcamentoId: orc.id }))).toEqual([]);
    expect(excluida.id).toBeTruthy();
  });

  it("recibo: só para conta recebida, com o valor por extenso; aberta mostra 'Recibo indisponível'", async () => {
    const { default: Recibo } = await import("@/app/(impressao)/financeiro/contas-receber/[id]/recibo/page");
    const recebida = await conta({ status: "RECEBIDO", valor: 1500, dataRecebimento: new Date("2026-11-18T15:00:00Z"), formaPagamento: "PIX", contaBancariaId: "cb1", descricao: "Troca de compressor" });
    const html = renderToStaticMarkup(await Recibo({ params: Promise.resolve({ id: recebida.id }) }));
    const texto = html.replace(/<style>[^<]*<\/style>/, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    expect(texto).toContain("Recebemos de Hospital Santa Luzia, CPF/CNPJ 11.222.333/0001-81, a importância de R$ 1.500,00 (mil e quinhentos reais), referente a Troca de compressor.");
    expect(texto).toContain("18/11/2026");
    expect(texto).toContain("Inter PJ");
    expect(texto).toContain("São Paulo/SP, 18 de novembro de 2026.");
    const aberta = await conta();
    expect(renderToStaticMarkup(await Recibo({ params: Promise.resolve({ id: aberta.id }) }))).toContain("data-recibo-indisponivel");
    logar(montarPermissoes({ financeiro: ["visualizar"] }));
    try { await expect(Recibo({ params: Promise.resolve({ id: recebida.id }) })).rejects.toThrow("REDIRECT /sem-permissao"); } finally { logar(); }
  });

  it("cadastro de contas bancárias: cria pela rota genérica; nome repetido (sem diferença de maiúsculas) = 409", async () => {
    const mod = await import("@/app/api/cadastros/[entidade]/route");
    const criar = async (corpo: unknown) => {
      const res = await mod.POST(new NextRequest("http://localhost/api/cadastros/contas-bancarias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }), { params: Promise.resolve({ entidade: "contas-bancarias" }) } as any);
      return { status: res.status, json: await res.json() };
    };
    const r = await criar({ nome: "Bradesco movimento", banco: "Bradesco (237)" });
    expect(r.status).toBe(201);
    expect(await prisma.contaBancaria.findFirst({ where: { nome: "Bradesco movimento" } })).toMatchObject({ empresaId: "e1", ativo: true, banco: "Bradesco (237)" });
    const dup = await criar({ nome: "inter pj" });
    expect(dup.status).toBe(409);
    expect(dup.json.erro).toBe("Já existe a conta bancária “Inter PJ”.");
  });

  it("RBAC: sem Financeiro › Contas a receber, nenhuma ação passa (403)", async () => {
    const c = await conta();
    logar(montarPermissoes({ financeiro: ["visualizar"] }));
    try {
      expect((await item("GET", c.id)).status).toBe(403);
      expect((await item("PUT", c.id, { descricao: "x" })).status).toBe(403);
      expect((await item("DELETE", c.id)).status).toBe(403);
    } finally { logar(); }
    expect((await prisma.contaReceber.findUnique({ where: { id: c.id } })).excluidaEm).toBeNull();
  });
});
