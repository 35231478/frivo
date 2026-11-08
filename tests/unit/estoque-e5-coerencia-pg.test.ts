/**
 * Estoque E5 — coerência material/peça nos caminhos de cobrança, num PostgreSQL real com as rotas de verdade:
 *  - "Gerar medição" (gerar-medicao): a peça (item PRODUTO executado) entra como linha de produto, o serviço já ajustado;
 *    o material incluso não vira linha; nada de custo;
 *  - "Medição completa" (gerar-medicao-completa → relatório + medição): serviço do período numa linha + a peça como
 *    produto, somando o valor do relatório; o link público da medição e o relatório da OS não mostram material nem custo;
 *  - "Faturar": as mesmas linhas do "Gerar medição" (coerência entre os três caminhos);
 *  - OS antiga (itens sem tipo): medição completa com uma linha só, como antes; gerar medição só serviço;
 *  - visão interna: separado / consumido / devolvido por material com quem e quando (sem custo na tela);
 *  - multiempresa: OS de outra empresa = 404 nos três caminhos.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/estoque-e5-coerencia-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_e5_coerencia_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const gerarMedicao = (id: string) => chamar("ordens/[id]/gerar-medicao", "POST", undefined, { id });
const completa = (id: string) => chamar("ordens/[id]/gerar-medicao-completa", "POST", undefined, { id });
const faturar = (id: string) => chamar("ordens/[id]/faturar", "POST", {}, { id });
const linhasDe = (itens: any[]) => itens.map((l) => [l.tipo, l.descricao, Number(l.quantidade), Number(l.valorUnitario), Number(l.valorTotal), l.servicoId ?? null, l.produtoId ?? null]);

describe.skipIf(!URL_PG)("Coerência material/peça nos caminhos de cobrança (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;
  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSE-${++seq}`, clienteId: "c1", criadoPorId: "u1", status: "CONCLUIDA", statusManual: true, origem: "MANUAL", descricao: "Instalação", dataConclusao: new Date(), ...dados } });
  /** A OS da E3.3b: serviço 800 + ajuste 40 (tubo 5 em vez de 3) = 840 com o snapshot (tubo incluso + capacitor peça) e a peça derivada como item PRODUTO */
  async function osComMaterial(dados: Record<string, unknown> = {}) {
    const os = await novaOs(dados);
    const item = await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 840, valorTotal: 840, valorBase: 800, ajusteMateriais: 40, executado: true, ordem: 0 } });
    const tubo = await prisma.osMaterial.create({ data: { ordemServicoId: os.id, osItemId: item.id, produtoId: "tubo", descricao: "Tubo de cobre 1/4", unidade: "m", comportamento: "INCLUSO_NO_SERVICO", quantidade: 5, quantidadePadrao: 3, valorVendaUnit: 20, custoUnit: 12, origem: "KIT", kitNome: "Kit instalação", ordem: 0 } });
    const cap = await prisma.osMaterial.create({ data: { ordemServicoId: os.id, osItemId: item.id, produtoId: "cap", descricao: "Capacitor 35uF", unidade: "un", comportamento: "VENDA_A_PARTE", quantidade: 1, quantidadePadrao: 1, valorVendaUnit: 80, custoUnit: 45, origem: "SOLTO", ordem: 1 } });
    const peca = await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, tipo: "PRODUTO", produtoId: "cap", descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 80, valorTotal: 80, materialId: cap.id, executado: true, ordem: 1 } });
    return { os, item, peca, tubo, cap };
  }
  const medicaoDaOs = (osId: string) => prisma.medicao.findFirst({ where: { itens: { some: { ordemServicoId: osId } } }, include: { itens: { orderBy: { ordem: "asc" } } } });
  const ESPERADO = [["SERVICO", "Instalação split", 1, 840, 840, "sInst", null], ["PRODUTO", "Capacitor 35uF", 1, 80, 80, null, "cap"]];

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens/[id]/gerar-medicao", "ordens/[id]/gerar-medicao-completa", "ordens/[id]/faturar"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u3", empresaId: "e1", nome: "Zé do Almoxarifado", email: "z@x.com", senha: "x" }, { id: "u4", empresaId: "e1", nome: "Carlos Técnico", email: "c@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" }, { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100" }] });
    await prisma.produto.createMany({ data: [{ id: "tubo", empresaId: "e1", nome: "Tubo de cobre 1/4", unidade: "m" }, { id: "cap", empresaId: "e1", nome: "Capacitor 35uF", unidade: "un" }] });
    await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800 } });
    const { movimentar } = await import("@/lib/estoque/servidor");
    await movimentar({ empresaId: "e1", produtoId: "tubo", operacao: "ENTRADA", valor: 10, custoUnitario: 12 });
    await movimentar({ empresaId: "e1", produtoId: "cap", operacao: "ENTRADA", valor: 3, custoUnitario: 45 });
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("Gerar medição: a peça entra como PRODUTO (com o produto do catálogo), o serviço já ajustado; o material incluso não vira linha; nada de custo", async () => {
    const { os } = await osComMaterial();
    const r = await gerarMedicao(os.id);
    expect(r.json?.erro ?? r.status).toBe(201);
    const med = await medicaoDaOs(os.id);
    expect(linhasDe(med.itens)).toEqual(ESPERADO);
    expect(Number(med.valorTotal)).toBe(920);
    expect(JSON.stringify(med)).not.toMatch(/tubo|custo|incluso/i);
    // Repetir devolve a mesma (idempotência de sempre)
    expect((await gerarMedicao(os.id)).json).toMatchObject({ id: med.id, jaExistia: true });
  });

  it("Medição completa (relatório + medição): serviço do período numa linha + a peça como produto, somando o valor do relatório; o link público e o relatório da OS não mostram material nem custo", async () => {
    const { os } = await osComMaterial();
    // Peça orçada e NÃO executada: não entra (só o executado é cobrado, como nos outros caminhos)
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, tipo: "PRODUTO", produtoId: "cap", descricao: "Capacitor reserva", quantidade: 1, valorUnitario: 80, valorTotal: 80, executado: false, ordem: 2 } });
    const r = await completa(os.id);
    expect(r.json?.erro ?? r.status).toBe(201);
    expect(r.json.medicaoToken).toBeTruthy();
    const rel = await prisma.relatorioOs.findFirst({ where: { ordemServicoId: os.id, escopo: "MEDICAO_COMPLETA" } });
    expect(Number(rel.valorFinanceiro)).toBe(920);
    const med = await medicaoDaOs(os.id);
    expect(linhasDe(med.itens)).toEqual([["SERVICO", `Serviço do período — ${rel.numero}`, 1, 840, 840, null, null], ["PRODUTO", "Capacitor 35uF", 1, 80, 80, null, "cap"]]);
    expect(Number(med.valorTotal)).toBe(920);
    expect(med.itens.every((i: any) => i.ordemServicoId === os.id)).toBe(true);
    // O que o cliente vê no link da medição (a mesma consulta da página pública): peça sim, material incluso e custo nunca
    const publica = await prisma.medicao.findUnique({ where: { tokenPublico: r.json.medicaoToken }, include: { empresa: true, cliente: true, itens: { orderBy: { ordem: "asc" } } } });
    const json = JSON.stringify(publica);
    expect(json).toContain("Capacitor 35uF");
    expect(json).not.toMatch(/tubo de cobre|custo|incluso|quantidadeSeparada|Capacitor reserva/i);
    // O relatório da OS (documento do cliente) não lista material nem custo
    const { carregarRelatorioPorToken } = await import("@/lib/relatorio-server");
    const doc = await carregarRelatorioPorToken(rel.tokenPublico);
    expect(doc).toBeTruthy();
    expect(JSON.stringify(doc)).not.toMatch(/tubo de cobre|custo|material/i);
  });

  it("Faturar produz as MESMAS linhas do Gerar medição (coerência entre os caminhos); os três caminhos nunca duplicam a cobrança", async () => {
    const { os } = await osComMaterial();
    const f = await faturar(os.id);
    expect(f.json?.erro ?? f.status).toBe(201);
    const fat = await medicaoDaOs(os.id);
    expect(linhasDe(fat.itens)).toEqual(ESPERADO);
    expect(Number(fat.valorTotal)).toBe(920);
    expect(fat.avulsa).toBe(true);
    // A OS já faturada: os outros caminhos devolvem a existente / recusam, sem segunda cobrança
    expect((await gerarMedicao(os.id)).json).toMatchObject({ jaExistia: true });
    expect((await completa(os.id)).status).toBe(409);
    expect(await prisma.medicao.count({ where: { itens: { some: { ordemServicoId: os.id } } } })).toBe(1);
  });

  it("OS antiga (itens sem tipo nem material): medição completa com uma linha só, como antes; gerar medição só serviço — dados antigos idênticos", async () => {
    const os = await novaOs();
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, descricao: "Troca do compressor", quantidade: 1, valorUnitario: 400, valorTotal: 400, executado: true } });
    const r = await completa(os.id);
    expect(r.status).toBe(201);
    const med = await medicaoDaOs(os.id);
    const rel = await prisma.relatorioOs.findFirst({ where: { ordemServicoId: os.id } });
    expect(linhasDe(med.itens)).toEqual([["SERVICO", `Serviço do período — ${rel.numero}`, 1, 400, 400, null, null]]);
    const os2 = await novaOs();
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os2.id, descricao: "Troca do compressor", quantidade: 1, valorUnitario: 400, valorTotal: 400, executado: true } });
    expect((await gerarMedicao(os2.id)).status).toBe(201);
    expect(linhasDe((await medicaoDaOs(os2.id)).itens)).toEqual([["SERVICO", "Troca do compressor", 1, 400, 400, null, null]]);
  });

  it("visão interna: por material, separado / consumido / devolvido com quem e quando — e nenhum custo na tela", async () => {
    const { os, tubo, cap } = await osComMaterial({ status: "EM_ANDAMENTO" });
    const { separarMateriais, separacaoDaOs } = await import("@/lib/estoque/separacao-server");
    const { consumirMateriais } = await import("@/lib/estoque/consumo-server");
    const { devolverMateriais } = await import("@/lib/estoque/devolucao-server");
    await separarMateriais("e1", os.id, "u3", [{ id: tubo.id, quantidade: 5 }, { id: cap.id, quantidade: 1 }]);
    await consumirMateriais("e1", os.id, "u4", [{ id: tubo.id, quantidade: 3 }, { id: cap.id, quantidade: 1 }]);
    await devolverMateriais("e1", os.id, "u3", [tubo.id]);
    const tela = (await separacaoDaOs("e1", os.id))!;
    expect(tela.materiais.map((m) => [m.descricao, m.quantidadeSeparada, m.quantidadeConsumida, m.quantidadeDevolvida, m.situacao, m.separadoPor, m.consumidoPor, m.devolvidoPor]))
      .toEqual([["Tubo de cobre 1/4", 5, 3, 2, "devolvido", "Zé do Almoxarifado", "Carlos Técnico", "Zé do Almoxarifado"], ["Capacitor 35uF", 1, 1, 0, "consumido", "Zé do Almoxarifado", "Carlos Técnico", null]]);
    expect(tela.materiais.every((m) => m.separadoEm && m.consumidoEm)).toBe(true);
    expect(tela.resumo).toMatchObject({ prestado: true });
    expect(JSON.stringify(tela)).not.toMatch(/custo/i);
    // A página da OS carrega os materiais com quem separou/consumiu/devolveu (a aba Materiais & Compras lê daqui)
    const pagina = await prisma.ordemServico.findFirst({ where: { id: os.id }, include: { itensOrcamento: { include: { materiais: { orderBy: { ordem: "asc" }, include: { separadoPor: { select: { nome: true } }, consumidoPor: { select: { nome: true } }, devolvidoPor: { select: { nome: true } } } } } } } });
    const mt = pagina.itensOrcamento[0].materiais[0];
    expect([mt.separadoPor.nome, mt.consumidoPor.nome, mt.devolvidoPor.nome]).toEqual(["Zé do Almoxarifado", "Carlos Técnico", "Zé do Almoxarifado"]);
  });

  it("multiempresa: OS de outra empresa = 404 nos três caminhos; nada é criado", async () => {
    const osX = await prisma.ordemServico.create({ data: { empresaId: "e2", numero: "OS-X", clienteId: "c9", criadoPorId: "u2", status: "CONCLUIDA", origem: "MANUAL", descricao: "x" } });
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: osX.id, descricao: "Da outra", quantidade: 1, valorUnitario: 100, valorTotal: 100, executado: true } });
    expect((await gerarMedicao(osX.id)).status).toBe(404);
    expect((await completa(osX.id)).status).toBe(404);
    expect((await faturar(osX.id)).status).toBe(404);
    expect(await prisma.medicao.count({ where: { empresaId: "e2" } })).toBe(0);
    expect(await prisma.relatorioOs.count({ where: { ordemServicoId: osX.id } })).toBe(0);
  });
});
