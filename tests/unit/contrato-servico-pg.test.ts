/**
 * Contrato recorrente — PR2 (serviço padrão do contrato). Rotas reais, Prisma real, PostgreSQL real.
 * Prova:
 *  - o contrato guarda o serviço padrão: da empresa (outra empresa → 400), escolha nova ativa (inativo
 *    novo → 400; manter o atual inativo vale), ausente no corpo = não mexe, vazio = tira;
 *  - "Gerar medições do mês": a mensalidade nasce com o serviço no item → a NFS-e não pede mais o serviço;
 *    as retenções vêm do serviço (mesma regra do Faturar) e a conta sai pelo líquido na aprovação;
 *  - sem serviço padrão: tudo como antes (item sem serviço, pendência na nota, sem retenção);
 *  - item sem serviço junto (adicional consolidado, outro contrato sem serviço) → a retenção fica de fora;
 *  - a prévia do formulário: bruto − retenções = cobrado, pendências fiscais do serviço, empresa e RBAC;
 *  - mesmo número: pôr o serviço no contrato não muda nenhuma previsão.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/contrato-servico-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_ctserv_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const AGORA = new Date("2026-11-15T15:00:00.000Z");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarBoleto: vi.fn(async () => {}), enviarMedicao: vi.fn(async () => {}), enviarConfirmacaoPagamento: vi.fn(async () => {}) }));

const logar = (empresaId = "e1", permissoes: any = permissoesTotais(), role = "ADMIN") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role, permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Contrato PR2 — serviço padrão: NFS-e sem pendência e retenções do serviço (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;

  const corpo = (dados: Record<string, unknown> = {}) => ({
    clienteId: "c1", numero: `CT-S${String(++seq).padStart(2, "0")}`, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO",
    valorMensal: 1000, dataInicio: "2026-11-01", dataFim: "2027-10-31", diaFaturamento: 10, ...dados,
  });
  const criar = async (dados: Record<string, unknown> = {}) => {
    const b = corpo(dados);
    const r = await chamar("contratos", "POST", {}, b);
    return { r, ct: { id: r.json?.id as string, body: b as Record<string, unknown> } };
  };
  const editar = (ct: { id: string; body: any }, mudar: Record<string, unknown>) => {
    ct.body = { ...ct.body, ...mudar };
    return chamar("contratos/[id]", "PUT", { id: ct.id }, ct.body);
  };
  const gerarMes = (mes: number, ano = 2026) => chamar("medicoes/gerar-mes", "POST", {}, { mes, ano });
  const medicaoDoCliente = (clienteId: string, mes: number) =>
    prisma.medicao.findFirst({ where: { clienteId, mes, ano: 2026, status: { not: "CANCELADA" } }, include: { itens: { orderBy: { ordem: "asc" } } } });
  const aprovar = async (id: string) => {
    expect((await chamar("medicoes/[id]/acao", "POST", { id }, { acao: "ENVIAR" })).status).toBe(200);
    expect((await chamar("medicoes/[id]/acao", "POST", { id }, { acao: "APROVAR_MANUAL" })).status).toBe(200);
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.configuracao.create({ data: { empresaId: "e1", issAliquota: 3 } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uB", empresaId: "e2", nome: "Bia", email: "bia@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11", diaFaturamento: 10 },
      { id: "c2", empresaId: "e1", nome: "Escola", cpfCnpj: "22.222.222/0001-22", diaFaturamento: 10 },
      { id: "c3", empresaId: "e1", nome: "Padaria", cpfCnpj: "33.333.333/0001-33", diaFaturamento: 10 },
      { id: "c4", empresaId: "e1", nome: "Hotel", cpfCnpj: "44.444.444/0001-44", diaFaturamento: 10 },
      { id: "c5", empresaId: "e1", nome: "Clínica", cpfCnpj: "66.666.666/0001-66", diaFaturamento: 10 },
      { id: "cX", empresaId: "e2", nome: "Outro", cpfCnpj: "55.555.555/0001-55" },
    ] });
    await prisma.servico.createMany({ data: [
      // ISS retido 5% + IR 1,5%: R$ 1.000 → retém R$ 65 → cobra R$ 935
      { id: "sRet", empresaId: "e1", nome: "Manutenção preventiva", codigo: "MANU01", codigoLc116: "14.01", issRetido: true, aliquotaISS: 5, retIr: true, aliquotaIR: 1.5 },
      // ISS retido sem alíquota própria: usa a da empresa (3%)
      { id: "sIssEmp", empresaId: "e1", nome: "Limpeza", codigo: "LIMP01", codigoLc116: "14.01", issRetido: true },
      // Sem retenção e sem código LC 116 (a nota ainda pediria o código)
      { id: "sSemLc", empresaId: "e1", nome: "Consultoria", codigo: "CONS01" },
      { id: "sInativo", empresaId: "e1", nome: "Antigo", codigo: "ANTI01", codigoLc116: "14.01", ativo: false },
      { id: "sOutra", empresaId: "e2", nome: "De outra empresa", codigo: "OUTR01", codigoLc116: "14.01" },
    ] });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    logar();
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("guarda o serviço padrão: só da empresa, escolha nova ativa, manter o inativo vale, ausente não mexe, vazio tira", async () => {
    expect((await criar({ servicoId: "sOutra" })).r).toMatchObject({ status: 400, json: { erro: "Serviço padrão inválido(a)." } });
    expect((await criar({ servicoId: "nao-existe" })).r.status).toBe(400);
    expect((await criar({ servicoId: "sInativo" })).r).toMatchObject({ status: 400, json: { erro: "Serviço padrão inativo(a): escolha um(a) ativo(a)." } });

    const { r, ct } = await criar({ servicoId: "sRet" });
    expect(r.status).toBe(201);
    expect((await prisma.contrato.findUnique({ where: { id: ct.id } })).servicoId).toBe("sRet");
    // Ausente no corpo: não mexe
    const { servicoId: _, ...semCampo } = ct.body as Record<string, unknown>;
    ct.body = semCampo;
    expect((await editar(ct, { observacoes: "x" })).status).toBe(200);
    expect((await prisma.contrato.findUnique({ where: { id: ct.id } })).servicoId).toBe("sRet");
    // Serviço inativado depois: o contrato continua com ele e salva normalmente
    await prisma.servico.update({ where: { id: "sRet" }, data: { ativo: false } });
    expect((await editar(ct, { servicoId: "sRet", observacoes: "y" })).status).toBe(200);
    await prisma.servico.update({ where: { id: "sRet" }, data: { ativo: true } });
    // Trocar por inativo: não
    expect((await editar(ct, { servicoId: "sInativo" })).status).toBe(400);
    // Vazio: tira; nulo (o que o formulário manda) também
    expect((await editar(ct, { servicoId: "" })).status).toBe(200);
    expect((await prisma.contrato.findUnique({ where: { id: ct.id } })).servicoId).toBeNull();
    expect((await editar(ct, { servicoId: "sIssEmp" })).status).toBe(200);
    expect((await prisma.contrato.findUnique({ where: { id: ct.id } })).servicoId).toBe("sIssEmp");
    expect((await editar(ct, { servicoId: null })).status).toBe(200);
    expect((await prisma.contrato.findUnique({ where: { id: ct.id } })).servicoId).toBeNull();
    // Outra empresa não usa o serviço daqui nem edita o contrato
    logar("e2");
    expect((await chamar("contratos", "POST", {}, { ...corpo({ clienteId: "cX" }), servicoId: "sRet" })).status).toBe(400);
    logar();
  });

  it("gerar-mes: a mensalidade nasce com o serviço → a NFS-e não pede o serviço; retenções do serviço; conta pelo líquido", async () => {
    const { ct } = await criar({ clienteId: "c5", servicoId: "sRet" });
    // Mesmo número: as previsões nascem pelo valor mensal bruto, como sem serviço
    const prev = await prisma.contaReceber.findMany({ where: { contratoId: ct.id }, select: { valor: true } });
    expect(prev.length).toBeGreaterThan(0);
    expect(prev.every((c: any) => Number(c.valor) === 1000)).toBe(true);

    expect((await gerarMes(11)).status).toBe(200);
    const med = await medicaoDoCliente("c5", 11);
    expect(med.itens.map((i: any) => [i.descricao, i.servicoId, Number(i.valorTotal)])).toEqual([[`Contrato ${ct.body.numero} — mensalidade`, "sRet", 1000]]);
    expect([Number(med.retIssAliquota), Number(med.retIrAliquota), med.retPisAliquota, Number(med.valorRetencoes)]).toEqual([5, 1.5, null, 65]);

    const { previaEmissao } = await import("@/lib/nfse/emissao-server");
    await aprovar(med.id);
    const p = await previaEmissao("e1", med.id);
    expect(p.itensSemServico).toEqual([]);
    expect(p.pendencias.filter((x: any) => x.area === "item" || x.area === "servico")).toEqual([]);
    // A conta do mês (a previsão promovida) sai pelo líquido: 1.000 − 65
    const conta = await prisma.contaReceber.findFirst({ where: { medicaoId: med.id } });
    expect([conta.contratoId, conta.refMes, Number(conta.valor)]).toEqual([ct.id, 11, 935]);
  });

  it("sem serviço padrão: como antes — item sem serviço, a nota pede o serviço, sem retenção, conta pelo bruto", async () => {
    await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c2", numero: "CT-SEM", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 800, dataInicio: new Date("2026-11-01T00:00:00Z") } });
    expect((await gerarMes(11)).status).toBe(200);
    const med = await medicaoDoCliente("c2", 11);
    expect(med.itens.map((i: any) => i.servicoId)).toEqual([null]);
    expect([med.retIssAliquota, med.retIrAliquota, Number(med.valorRetencoes)]).toEqual([null, null, 0]);
    const { previaEmissao } = await import("@/lib/nfse/emissao-server");
    await aprovar(med.id);
    const p = await previaEmissao("e1", med.id);
    expect(p.itensSemServico.map((i: any) => i.descricao)).toEqual(["Contrato CT-SEM — mensalidade"]);
    expect(p.pendencias.some((x: any) => x.area === "item" && /escolha o serviço do catálogo/.test(x.texto))).toBe(true);
    expect(Number((await prisma.contaReceber.findFirst({ where: { medicaoId: med.id } })).valor)).toBe(800);
  });

  it("ISS sem alíquota no serviço usa a da empresa; item sem serviço na mesma fatura deixa a retenção de fora (regra do Faturar)", async () => {
    // c3: um contrato só, ISS da empresa (3% de 2.000 = 60)
    await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c3", numero: "CT-ISS", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 2000, servicoId: "sIssEmp", dataInicio: new Date("2026-11-01T00:00:00Z") } });
    // c4: um contrato com serviço que retém + outro sem serviço → a retenção não vale para a fatura inteira
    await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c4", numero: "CT-H1", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 1000, servicoId: "sRet", dataInicio: new Date("2026-11-01T00:00:00Z") } });
    await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c4", numero: "CT-H2", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 500, dataInicio: new Date("2026-11-01T00:00:00Z") } });
    expect((await gerarMes(12)).status).toBe(200);
    const iss = await medicaoDoCliente("c3", 12);
    expect([Number(iss.retIssAliquota), iss.retIrAliquota, Number(iss.valorRetencoes)]).toEqual([3, null, 60]);
    const h = await medicaoDoCliente("c4", 12);
    expect(h.itens.map((i: any) => [i.descricao, i.servicoId]).sort()).toEqual([
      ["Contrato CT-H1 — mensalidade", "sRet"], ["Contrato CT-H2 — mensalidade", null],
    ]);
    expect([h.retIssAliquota, h.retIrAliquota, Number(h.valorRetencoes)]).toEqual([null, null, 0]);
    // Os dois com o mesmo serviço: vale de novo (65 + 32,50)
    await prisma.contrato.updateMany({ where: { numero: "CT-H2" }, data: { servicoId: "sRet" } });
    await chamar("medicoes/[id]/acao", "POST", { id: h.id }, { acao: "CANCELAR" });
    expect((await gerarMes(12)).status).toBe(200);
    const h2 = await medicaoDoCliente("c4", 12);
    expect([Number(h2.retIssAliquota), Number(h2.retIrAliquota), Number(h2.valorRetencoes)]).toEqual([5, 1.5, 97.5]);
  });

  it("prévia do formulário: bruto − retenções = cobrado; ISS da empresa; pendência fiscal; empresa e RBAC", async () => {
    const previa = (servicoId: string, valor: string) => chamar("contratos/previa-cobranca", "GET", {}, undefined, `?servicoId=${servicoId}&valor=${valor}`);
    const a = await previa("sRet", "1000");
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ servico: { id: "sRet", nome: "Manutenção preventiva", ativo: true }, bruto: 1000, total: 65, liquido: 935, pendenciasNfse: [] });
    expect(a.json.linhas.map((l: any) => [l.rotulo, l.aliquota, l.valor])).toEqual([["ISS retido", 5, 50], ["IR", 1.5, 15]]);
    expect((await previa("sIssEmp", "2000")).json).toMatchObject({ total: 60, liquido: 1940 });
    expect((await previa("sSemLc", "1000")).json).toMatchObject({ total: 0, liquido: 1000, pendenciasNfse: ["Código do serviço (LC 116)"] });
    expect((await previa("sInativo", "500")).json).toMatchObject({ servico: { ativo: false }, liquido: 500 });
    // centavos: 333,33 × 5% = 16,67; × 1,5% = 5,00 → 311,66
    expect((await previa("sRet", "333.33")).json).toMatchObject({ total: 21.67, liquido: 311.66 });
    expect((await previa("sRet", "abc")).json).toMatchObject({ bruto: 0, total: 0, liquido: 0 });
    // valor com mais de 2 casas: a prévia trabalha no centavo (como a medição)
    expect((await previa("sRet", "100.126")).json).toMatchObject({ bruto: 100.13 });
    expect((await chamar("contratos/previa-cobranca", "GET", {}, undefined, "?valor=10")).status).toBe(400);
    expect((await previa("sOutra", "1000")).status).toBe(404);
    // Usuário comum sem "ver contratos": 403 (o administrador passa sempre)
    logar("e1", { ...permissoesTotais(), contratos: { ...permissoesTotais().contratos, visualizar: false } }, "USUARIO");
    expect((await previa("sRet", "1000")).status).toBe(403);
    logar("e1", permissoesTotais(), "USUARIO");
    expect((await previa("sRet", "1000")).status).toBe(200);
    logar();
  });
});
