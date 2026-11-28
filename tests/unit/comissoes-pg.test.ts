/**
 * COM-1 — Comissões do vendedor, com as rotas e o Prisma de verdade no PostgreSQL REAL (schema descartável).
 *  - precedência: o item manda (serviço > categoria > todos), a pessoa desempata (pessoa > cargo > todos); peças só nas linhas de peça;
 *  - CONGELAMENTO: a comissão nasce na aprovação com a regra daquele dia; mudar a regra depois não mexe nela;
 *  - recebimento PARCIAL libera proporcional; recebimento ESTORNADO estorna; fatura cancelada não libera;
 *  - os gatilhos "na aprovação" e "na conclusão da OS"; orçamento cancelado depois da aprovação estorna;
 *  - FECHAMENTO do mês (sem o programa de bônus): uma conta a pagar por pessoa, comissões pagas; reabrir cancela a
 *    conta e devolve as comissões; com pagamento na conta, não reabre;
 *  - permissão: "Trocar vendedor" (com motivo, na trilha, segue para a OS), regras e configuração ("Desempenho ›
 *    Gerenciar"); o extrato é só da própria pessoa e nunca leva custo/base;
 *  - isolamento entre empresas.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/comissoes-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_comissoes_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}), enviarEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/push/eventos", async (o) => ({ ...(await o<object>()), agendarPush: vi.fn(), notificarRespostaOrcamento: vi.fn() }));
vi.setConfig({ testTimeout: 90_000 });

const USUARIOS: Record<string, { empresaId: string; nome: string }> = {
  uAdm: { empresaId: "e1", nome: "Ana Gestora" }, uV: { empresaId: "e1", nome: "Vitor Vendas" }, uP: { empresaId: "e1", nome: "Paula Pessoa" },
  uB: { empresaId: "e2", nome: "Beto Outra" },
};
const logar = (id: string, permissoes: Permissoes = permissoesTotais(), role = "OPERADOR") => {
  const u = USUARIOS[id];
  sessao.atual = { user: { id, name: u.nome, email: `${id}@ficticio.test`, empresaId: u.empresaId, role, permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = metodo === "GET" && mod.GET.length === 0 ? await mod.GET() : await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const hoje = () => new Date().toISOString().slice(0, 10);
const competencia = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
/** O N-º dia útil (seg–sex) do mês seguinte ao de hoje, contado à mão (o teste não usa a regra que testa) */
const nesimoDiaUtilDoProximoMes = (n: number) => {
  const d = new Date(); const ano = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(); const mes = (d.getUTCMonth() + 1) % 12;
  for (let dia = 1, uteis = 0; dia <= 31; dia++) { const x = new Date(Date.UTC(ano, mes, dia)); if (x.getUTCDay() % 6 !== 0 && ++uteis === n) return x.toISOString().slice(0, 10); }
  return "";
};
const diaDoProximoMes = (dia: number) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, dia)).toISOString().slice(0, 10); };

describe.skipIf(!URL_PG)("COM-1 — comissões (PostgreSQL real)", () => {
  let prisma: any;
  let srv: typeof import("@/lib/comissoes/servidor");
  let fech: typeof import("@/lib/desempenho/fechamento-server");
  let n = 0;

  /** Orçamento em rascunho do vendedor: serviços (com catálogo) e peças */
  async function novoOrcamento(o: { vendedorId?: string; empresaId?: string; clienteId?: string; servicos?: { servicoId?: string | null; descricao: string; v: number; q?: number }[]; pecas?: { produtoId?: string | null; descricao: string; v: number; q?: number }[] } = {}) {
    const empresaId = o.empresaId ?? "e1";
    const servicos = (o.servicos ?? []).map((s, i) => ({ servicoId: s.servicoId ?? null, descricao: s.descricao, quantidade: s.q ?? 1, valorUnitario: s.v, valorTotal: (s.q ?? 1) * s.v, ordem: i }));
    const produtos = (o.pecas ?? []).map((p, i) => ({ produtoId: p.produtoId ?? null, descricao: p.descricao, quantidade: p.q ?? 1, valorUnitario: p.v, valorTotal: (p.q ?? 1) * p.v, ordem: i }));
    const total = [...servicos, ...produtos].reduce((s, l) => s + l.valorTotal, 0);
    n++;
    return prisma.orcamento.create({ data: {
      empresaId, codigo: `ORC-${empresaId}-${n}`, nome: `Venda fictícia ${n}`, clienteId: o.clienteId ?? (empresaId === "e1" ? "c1" : "c2"), criadoPorId: o.vendedorId ?? "uV", vendedorId: o.vendedorId ?? "uV",
      status: "RASCUNHO", tipo: "COMUM", tokenPublico: `tok-${n}-${Math.random()}`, totalServicos: servicos.reduce((s, l) => s + l.valorTotal, 0), totalProdutos: produtos.reduce((s, l) => s + l.valorTotal, 0), totalGeral: total,
      servicos: { create: servicos }, produtos: { create: produtos },
    } });
  }
  const aprovar = (id: string) => chamar("orcamentos/[id]/aprovacao-equipe", "POST", { id }, { nome: "Cliente Fictício", canal: "TELEFONE" });
  const faturar = (id: string, corpo?: unknown) => chamar("orcamentos/[id]/faturar", "POST", { id }, corpo);
  const comissoes = (orcamentoId: string) => prisma.comissao.findMany({ where: { orcamentoId }, orderBy: [{ itemTipo: "desc" }, { descricao: "asc" }], include: { lancamentos: true } });
  const liberado = async (orcamentoId: string) => Math.round((await prisma.comissaoLancamento.aggregate({ where: { comissao: { orcamentoId } }, _sum: { valor: true } }))._sum.valor * 100 || 0) / 100;
  const contaDaFatura = async (medicaoId: string) => prisma.contaReceber.findFirst({ where: { medicaoId, status: { not: "CANCELADO" } } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    // As travas de produção do faturamento e o SQL desta leva (CHECKs) por cima
    for (const sql of ["2026-11-14_faturamento_travas_retencoes.sql", "2026-11-16_faturar_avulso.sql", "2026-11-08_faturamento_parcial.sql", "2027-02-11_comissoes.sql", "2027-02-14_comissoes_vencimento.sql"]) {
      execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql", sql)], {
        env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
      });
    }
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    srv = await import("@/lib/comissoes/servidor");
    fech = await import("@/lib/desempenho/fechamento-server");
    await Promise.all(["orcamentos/[id]/aprovacao-equipe", "orcamentos/[id]/faturar", "orcamentos/[id]/vendedor", "contas-receber/[id]/recebimentos", "contas-receber/[id]/recebimentos/estornar",
      "medicoes/[id]/acao", "comissoes", "comissoes/regras", "comissoes/regras/[id]", "perfil/comissoes", "orcamentos/[id]/gerar-os"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Fictícia", cnpj: "12345678000190", email: "e1@ficticio.test" }, { id: "e2", nome: "Outra Fictícia", cnpj: "98765432000110", email: "e2@ficticio.test" }] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: Object.entries(USUARIOS).map(([id, u]) => ({ id, empresaId: u.empresaId, nome: u.nome, email: `${id}@ficticio.test`, senha: "x" })) });
    await prisma.cargo.createMany({ data: [{ id: "cgV", empresaId: "e1", nome: "Vendedores" }, { id: "cgB", empresaId: "e2", nome: "Vendas da outra" }] });
    // O vendedor tem cadastro de colaborador (mesmo e-mail): dá o cargo e junta com o bônus na folha
    await prisma.tecnico.create({ data: { id: "tV", empresaId: "e1", nome: "Vitor Vendas", cpf: "11122233344", telefone: "11999990000", email: "UV@ficticio.test", cargoId: "cgV" } });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "11222333000181" }, { id: "c2", empresaId: "e2", nome: "Padaria da Outra", cpfCnpj: "11222333000262" }] });
    await prisma.servico.createMany({ data: [
      { id: "sInst", empresaId: "e1", nome: "Instalação split", codigo: "INST01", categoria: "Instalação" },
      { id: "sLimp", empresaId: "e1", nome: "Limpeza", codigo: "LIMP01", categoria: "Manutenção" },
      { id: "sOut", empresaId: "e2", nome: "Serviço da outra", codigo: "OUTR01" },
    ] });
    await prisma.produto.create({ data: { id: "pGas", empresaId: "e1", nome: "Gás R410A", unidade: "kg", valorPadrao: 50, saldo: 10 } });
    // Regras (e1): todos 2% em tudo; cargo Vendedores 5% em Instalação; Vitor 10% na Limpeza; peças R$ 7 por item
    logar("uAdm");
    for (const r of [
      { quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 2 },
      { quemTipo: "CARGO", cargoId: "cgV", sobreTipo: "CATEGORIA", categoria: "instalação", base: "PERC_VENDA", valor: 5 },
      { quemTipo: "PESSOA", usuarioId: "uV", sobreTipo: "SERVICO", servicoId: "sLimp", base: "PERC_VENDA", valor: 10 },
      { quemTipo: "TODOS", sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 7 },
    ]) expect((await chamar("comissoes/regras", "POST", {}, r)).status).toBe(201);
    // e2: uma regra própria
    logar("uB");
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 50 })).status).toBe(201);
  }, 300_000);
  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("precedência na aprovação: o item manda (serviço > categoria > todos), a pessoa desempata; peças só nas linhas de peça — e a regra fica congelada", async () => {
    const o = await novoOrcamento({
      servicos: [{ servicoId: "sInst", descricao: "Instalação split", v: 1000 }, { servicoId: "sLimp", descricao: "Limpeza", v: 200 }, { descricao: "Visita avulsa", v: 100 }],
      pecas: [{ produtoId: "pGas", descricao: "Gás R410A", v: 50, q: 2 }],
    });
    logar("uAdm");
    expect((await aprovar(o.id)).status).toBe(200);
    const cs = await comissoes(o.id);
    expect(cs.map((c: any) => [c.descricao, Number(c.valor), c.usuarioId, c.quando])).toEqual([
      ["Instalação split", 50, "uV", "RECEBIMENTO"], // cargo + categoria (5%) vence "todos" (2%)
      ["Limpeza", 20, "uV", "RECEBIMENTO"], // pessoa + serviço (10%)
      ["Visita avulsa", 2, "uV", "RECEBIMENTO"], // sem catálogo: só "todos os serviços" (2%)
      ["Gás R410A", 14, "uV", "RECEBIMENTO"], // peça: R$ 7 × 2
    ]);
    expect(cs[0].regraDescricao).toBe("Vendedores (cargo) · instalação (categoria) · 5% da venda");
    // Ainda nada liberado: tudo previsto até o dinheiro entrar
    expect(await liberado(o.id)).toBe(0);
    // CONGELAMENTO: muda a regra do cargo para 9% — a comissão já nascida não muda; aprovar de novo não duplica
    logar("uAdm");
    const regra = await prisma.comissaoRegra.findFirst({ where: { cargoId: "cgV" } });
    expect((await chamar("comissoes/regras/[id]", "PATCH", { id: regra.id }, { quemTipo: "CARGO", cargoId: "cgV", sobreTipo: "CATEGORIA", categoria: "Instalação", base: "PERC_VENDA", valor: 9 })).status).toBe(200);
    expect(await srv.gerarComissoesDoOrcamento("e1", o.id)).toBe(0);
    expect((await comissoes(o.id)).map((c: any) => Number(c.valor))).toEqual([50, 20, 2, 14]);
    await prisma.comissaoRegra.update({ where: { id: regra.id }, data: { valor: 5 } });
    // O ITEM MANDA: o "fixo" do vendedor (pessoa + todos, 8%) perde para a regra da categoria (cargo, 5%) na
    // instalação e vale no item sem regra própria (a visita avulsa, onde antes valia o "todos" de 2%)
    const fixo = await chamar("comissoes/regras", "POST", {}, { quemTipo: "PESSOA", usuarioId: "uV", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 8 });
    expect(fixo.status).toBe(201);
    const o2 = await novoOrcamento({ servicos: [{ servicoId: "sInst", descricao: "Instalação split", v: 1000 }, { descricao: "Visita avulsa", v: 100 }] });
    logar("uAdm");
    expect((await aprovar(o2.id)).status).toBe(200);
    expect((await comissoes(o2.id)).map((c: any) => [c.descricao, Number(c.valor)])).toEqual([["Instalação split", 50], ["Visita avulsa", 8]]);
    await prisma.comissaoRegra.update({ where: { id: fixo.json.id }, data: { ativo: false } });
    // PJ4: editar a regra desativada (a tela não manda "ativo") não a reativa; e a categoria sem acento é a mesma regra
    expect((await chamar("comissoes/regras/[id]", "PATCH", { id: fixo.json.id }, { quemTipo: "PESSOA", usuarioId: "uV", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 7 })).status).toBe(200);
    expect(await prisma.comissaoRegra.findUnique({ where: { id: fixo.json.id } })).toMatchObject({ ativo: false });
    expect(Number((await prisma.comissaoRegra.findUnique({ where: { id: fixo.json.id } })).valor)).toBe(7);
    const semAcento = await chamar("comissoes/regras", "POST", {}, { quemTipo: "CARGO", cargoId: "cgV", sobreTipo: "CATEGORIA", categoria: "Instalacao", base: "PERC_VENDA", valor: 4 });
    expect(semAcento.status).toBe(409);
    // Proposta de contrato fica fora nesta leva (pergunta 1 do PR): aprovada e com vendedor, não gera comissão
    const prop = await novoOrcamento({ servicos: [{ servicoId: "sInst", descricao: "Instalação split", v: 1000 }] });
    await prisma.orcamento.update({ where: { id: prop.id }, data: { tipo: "PROPOSTA_CONTRATO", status: "APROVADO" } });
    expect(await srv.gerarComissoesDoOrcamento("e1", prop.id)).toBe(0);
    expect(await comissoes(prop.id)).toEqual([]);
  });

  it("recebimento PARCIAL libera proporcional; recebimento ESTORNADO estorna; quitado libera tudo; o extrato acompanha", async () => {
    const o = await novoOrcamento({ servicos: [{ servicoId: "sInst", descricao: "Instalação split", v: 1000 }] });
    logar("uAdm");
    await aprovar(o.id);
    expect((await faturar(o.id)).status).toBe(201);
    const med = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: o.id } } } });
    expect(med.vendedorId).toBe("uV"); // o vendedor segue para a fatura
    const conta = await contaDaFatura(med.id);
    expect(Number(conta.valor)).toBe(1000);
    // 40% recebido → 40% da comissão (50) = 20
    expect((await chamar("contas-receber/[id]/recebimentos", "POST", { id: conta.id }, { valor: 400, data: hoje() })).status).toBe(201);
    await srv.sincronizarComissoes("e1");
    expect(await liberado(o.id)).toBe(20);
    // Recalcular de novo não libera duas vezes
    await srv.sincronizarComissoes("e1");
    expect(await liberado(o.id)).toBe(20);
    // Estorno do recebimento → estorno automático da comissão
    const rec = await prisma.contaReceberRecebimento.findFirst({ where: { contaReceberId: conta.id } });
    expect((await chamar("contas-receber/[id]/recebimentos/estornar", "POST", { id: conta.id }, { recebimentoId: rec.id, motivo: "Cheque devolvido" })).status).toBe(200);
    await srv.sincronizarComissoes("e1");
    expect(await liberado(o.id)).toBe(0);
    const movs = await prisma.comissaoLancamento.findMany({ where: { comissao: { orcamentoId: o.id } }, orderBy: { criadoEm: "asc" } });
    expect(movs.map((m: any) => [m.tipo, Number(m.valor)])).toEqual([["LIBERACAO", 20], ["ESTORNO", -20]]);
    expect(movs[1].motivo).toBe("Recebimento estornado ou fatura cancelada");
    // Quitado → libera tudo
    expect((await chamar("contas-receber/[id]/recebimentos", "POST", { id: conta.id }, { data: hoje() })).status).toBe(201);
    logar("uV", montarPermissoes({ orcamentos: ["visualizar"] }));
    const ext = await chamar("perfil/comissoes", "GET");
    const venda = ext.json.vendas.find((v: any) => v.orcamentoId === o.id);
    expect([venda.prevista, venda.liberada, venda.paga]).toEqual([0, 50, 0]);
    // O extrato nunca leva custo, base em reais nem margem
    expect(JSON.stringify(ext.json)).not.toMatch(/baseValor|custo|margem|lucro\b/i);
  });

  it("relatório do mês por data de EMISSÃO (da fatura, como no OMIE) ou de RECEBIMENTO (só o que entrou no mês); abre na vista da configuração; só Desempenho › Gerenciar", async () => {
    const o = await novoOrcamento({ servicos: [{ servicoId: "sInst", descricao: "Instalação split", v: 1000 }] });
    logar("uAdm");
    await aprovar(o.id);
    expect((await faturar(o.id)).status).toBe(201);
    const med = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: o.id } } } });
    const conta = await contaDaFatura(med.id);
    // Entrou R$ 300 no mês passado e R$ 100 neste: por recebimento, este mês vale só 10% (R$ 5 de R$ 50)
    const d = new Date(); const passado = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)).toISOString().slice(0, 10);
    expect((await chamar("contas-receber/[id]/recebimentos", "POST", { id: conta.id }, { valor: 300, data: passado })).status).toBe(201);
    expect((await chamar("contas-receber/[id]/recebimentos", "POST", { id: conta.id }, { valor: 100, data: hoje() })).status).toBe(201);
    const daVenda = (r: any) => r.json.pessoas.flatMap((p: any) => p.vendas.map((v: any) => ({ ...v, pessoa: p.nome }))).find((v: any) => v.orcamentoId === o.id);
    const mes = competencia();
    const rec = await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mes}`);
    expect(rec.status).toBe(200);
    expect([rec.json.vista, rec.json.quando]).toEqual(["RECEBIMENTO", "RECEBIMENTO"]); // abre na vista da configuração
    expect([daVenda(rec).valor, daVenda(rec).pessoa]).toEqual([5, "Vitor Vendas"]);
    const mesPassado = passado.slice(0, 7);
    const recPassado = await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mesPassado}&vista=RECEBIMENTO`);
    expect(daVenda(recPassado).valor).toBe(15); // os 30% que entraram no mês passado
    const emi = await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mes}&vista=EMISSAO`);
    expect(emi.json.vista).toBe("EMISSAO");
    expect(daVenda(emi).valor).toBe(50); // a fatura (inteira) foi emitida neste mês: a comissão inteira
    expect(daVenda(await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mesPassado}&vista=EMISSAO`))).toBeUndefined();
    // COM-1.1: a emissão é a da FATURA (não a aprovação) — aprovada sem fatura emitida não aparece; cancelada depois, sai
    const naVista = async (id: string) => (await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mes}&vista=EMISSAO`)).json.pessoas.flatMap((p: any) => p.vendas).find((v: any) => v.orcamentoId === id);
    const semFatura = await novoOrcamento({ servicos: [{ servicoId: "sInst", descricao: "Instalação split", v: 400 }] });
    await aprovar(semFatura.id);
    expect(await naVista(semFatura.id)).toBeUndefined();
    expect((await faturar(semFatura.id)).status).toBe(201);
    expect((await naVista(semFatura.id)).valor).toBe(20);
    // A fatura que voltou para RASCUNHO (mesmo já enviada antes) não é emissão
    const medSem = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: semFatura.id } } } });
    await prisma.medicao.update({ where: { id: medSem.id }, data: { status: "RASCUNHO", dataEnvio: new Date() } });
    expect(await naVista(semFatura.id)).toBeUndefined();
    await prisma.medicao.update({ where: { id: medSem.id }, data: { status: medSem.status, dataEnvio: medSem.dataEnvio } });
    expect((await naVista(semFatura.id)).valor).toBe(20);
    await prisma.orcamento.update({ where: { id: semFatura.id }, data: { status: "CANCELADO" } });
    expect(await naVista(semFatura.id)).toBeUndefined();
    // A data mostrada é a da emissão da fatura (NF registrada à mão vale mais que o título): NF no mês passado = emitida lá
    const comNf = await novoOrcamento({ servicos: [{ servicoId: "sInst", descricao: "Instalação split", v: 200 }] });
    await aprovar(comNf.id);
    expect((await faturar(comNf.id)).status).toBe(201);
    const medNf = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: comNf.id } } } });
    await prisma.medicaoNf.create({ data: { medicaoId: medNf.id, numero: "NF-FICT-1", emitidaEm: new Date(`${passado}T12:00:00Z`) } });
    expect(await naVista(comNf.id)).toBeUndefined();
    const noPassado = (await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mesPassado}&vista=EMISSAO`)).json.pessoas.flatMap((p: any) => p.vendas).find((v: any) => v.orcamentoId === comNf.id);
    expect([noPassado.valor, noPassado.data.slice(0, 10)]).toEqual([10, passado]);
    expect(daVenda(await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mes}&vista=EMISSAO`)).valor).toBe(50);
    // A vista não muda o que o fechamento paga (segue a configuração): o liberado continua sendo os 40% que entraram
    await srv.sincronizarComissoes("e1");
    expect(await liberado(o.id)).toBe(20);
    // O fechamento do mês passado não pega movimento deste mês (só até o fim da competência)
    const movsDeste = await prisma.comissaoLancamento.findMany({ where: { comissao: { orcamentoId: o.id }, data: { gte: new Date(`${mes}-01T00:00:00Z`) } }, select: { id: true } });
    expect(movsDeste.length).toBeGreaterThan(0);
    const abertosPassado = new Set((await srv.movimentosAbertos("e1", mesPassado)).map((m: any) => m.id));
    const abertosDeste = new Set((await srv.movimentosAbertos("e1", mes)).map((m: any) => m.id));
    expect(movsDeste.map((m: any) => [abertosPassado.has(m.id), abertosDeste.has(m.id)])).toEqual(movsDeste.map(() => [false, true]));
    // Só quem fecha o mês vê; o vendedor não
    logar("uV", montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mes}`)).status).toBe(403);
    // Outra empresa: nada desta
    logar("uB");
    const outra = await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${mes}&vista=EMISSAO`);
    expect(outra.json.pessoas).toEqual([]);
  });

  it("fatura CANCELADA não libera nada; orçamento cancelado depois da aprovação (gatilho 'na aprovação') estorna", async () => {
    const o = await novoOrcamento({ servicos: [{ servicoId: "sLimp", descricao: "Limpeza", v: 300 }] });
    logar("uAdm");
    await aprovar(o.id);
    await faturar(o.id);
    const med = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: o.id } } } });
    expect((await chamar("medicoes/[id]/acao", "POST", { id: med.id }, { acao: "CANCELAR" })).status).toBe(200);
    await srv.sincronizarComissoes("e1");
    expect(await liberado(o.id)).toBe(0);
    // Conta a receber com dinheiro que depois é CANCELADA: o que entrou nela deixa de contar (estorna o liberado)
    const c = await novoOrcamento({ servicos: [{ servicoId: "sLimp", descricao: "Limpeza", v: 300 }] });
    await aprovar(c.id);
    await faturar(c.id);
    const medC = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: c.id } } } });
    const contaC = await contaDaFatura(medC.id);
    expect((await chamar("contas-receber/[id]/recebimentos", "POST", { id: contaC.id }, { valor: 300, data: hoje() })).status).toBe(201);
    await srv.sincronizarComissoes("e1");
    expect(await liberado(c.id)).toBe(30);
    await prisma.contaReceber.update({ where: { id: contaC.id }, data: { status: "CANCELADO" } });
    await srv.sincronizarComissoes("e1");
    expect(await liberado(c.id)).toBe(0);

    // Gatilho "na aprovação": libera tudo ao aprovar; cancelou depois → estorno automático
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "APROVACAO" } });
    const a = await novoOrcamento({ servicos: [{ servicoId: "sLimp", descricao: "Limpeza", v: 500 }] });
    await aprovar(a.id);
    expect(await liberado(a.id)).toBe(50);
    expect((await comissoes(a.id))[0].quando).toBe("APROVACAO");
    await prisma.orcamento.update({ where: { id: a.id }, data: { status: "CANCELADO" } });
    await srv.sincronizarComissoes("e1");
    expect(await liberado(a.id)).toBe(0);
    // A configuração mudar depois não mexe na comissão já nascida (o "quando" é dela)
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "RECEBIMENTO" } });
    expect((await comissoes(a.id))[0].quando).toBe("APROVACAO");
  });

  it("COM-1.1 — 'na aprovação': a fatura cancelada (sem outra viva) ESTORNA; título cancelado também; refaturar devolve; sem fatura nunca estorna", async () => {
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "APROVACAO" } });
    const a = await novoOrcamento({ servicos: [{ servicoId: "sLimp", descricao: "Limpeza", v: 500 }] });
    logar("uAdm");
    await aprovar(a.id);
    expect(await liberado(a.id)).toBe(50);
    await srv.sincronizarComissoes("e1", { orcamentoIds: [a.id] });
    expect(await liberado(a.id)).toBe(50); // ainda sem fatura: a venda vale
    expect((await faturar(a.id)).status).toBe(201);
    const med = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: a.id } } } });
    expect((await chamar("medicoes/[id]/acao", "POST", { id: med.id }, { acao: "CANCELAR" })).status).toBe(200);
    await srv.sincronizarComissoes("e1", { orcamentoIds: [a.id] });
    expect(await liberado(a.id)).toBe(0);
    expect((await prisma.comissaoLancamento.findFirst({ where: { comissao: { orcamentoId: a.id }, tipo: "ESTORNO" } })).motivo).toBe("Fatura cancelada");
    // Refaturou: volta a valer
    expect((await faturar(a.id)).status).toBe(201);
    await srv.sincronizarComissoes("e1", { orcamentoIds: [a.id] });
    expect(await liberado(a.id)).toBe(50);
    // A fatura viva com TODOS os títulos cancelados conta como cancelada
    const nova = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: a.id } }, status: { not: "CANCELADA" } } });
    expect(await prisma.contaReceber.count({ where: { medicaoId: nova.id } })).toBeGreaterThan(0);
    // Título EXCLUÍDO conta como cancelado: com o título só excluído (não cancelado), também estorna
    await prisma.contaReceber.updateMany({ where: { medicaoId: nova.id }, data: { excluidaEm: new Date() } });
    await srv.sincronizarComissoes("e1", { orcamentoIds: [a.id] });
    expect(await liberado(a.id)).toBe(0);
    await prisma.contaReceber.updateMany({ where: { medicaoId: nova.id }, data: { excluidaEm: null } });
    await srv.sincronizarComissoes("e1", { orcamentoIds: [a.id] });
    expect(await liberado(a.id)).toBe(50); // o título voltou: a fatura vive de novo
    await prisma.contaReceber.updateMany({ where: { medicaoId: nova.id }, data: { status: "CANCELADO" } });
    await srv.sincronizarComissoes("e1", { orcamentoIds: [a.id] });
    expect(await liberado(a.id)).toBe(0);
    // O gatilho "no recebimento" não muda: o dinheiro manda (aqui, sem dinheiro, nada é liberado de qualquer jeito)
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "RECEBIMENTO" } });
    expect((await comissoes(a.id))[0].quando).toBe("APROVACAO");
  });

  it("gatilho 'na conclusão da OS': nada até concluir; concluída libera; o vendedor segue para a OS", async () => {
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "CONCLUSAO_OS" } });
    const o = await novoOrcamento({ servicos: [{ servicoId: "sInst", descricao: "Instalação split", v: 2000 }] });
    logar("uAdm");
    await aprovar(o.id);
    expect((await chamar("orcamentos/[id]/gerar-os", "POST", { id: o.id }, { execucao: { tecnicoId: "tV" } })).status).toBeLessThan(300);
    const os = await prisma.ordemServico.findFirst({ where: { orcamentoOrigemId: o.id } });
    expect(os.vendedorId).toBe("uV");
    await srv.sincronizarComissoes("e1");
    expect(await liberado(o.id)).toBe(0);
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CONCLUIDA", dataConclusao: new Date() } });
    await srv.sincronizarComissoes("e1");
    expect(await liberado(o.id)).toBe(100);
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "RECEBIMENTO" } });
  });

  it("FECHAMENTO do mês (empresa sem o programa de bônus): a folha tem a comissão, UMA conta a pagar por pessoa; reabrir cancela e devolve; conta com pagamento não reabre", async () => {
    const autor = { empresaId: "e1", usuarioId: "uAdm", nome: "Ana Gestora" };
    const previa = await fech.previaDoFechamento("e1", competencia());
    expect(previa.comissoes).toBe(true);
    expect(previa.bonus).toBe(false);
    const linha = previa.folha.linhas.find((l) => l.usuarioId === "uV")!;
    const aberto = Math.round((await prisma.comissaoLancamento.aggregate({ where: { usuarioId: "uV", fechamentoId: null }, _sum: { valor: true } }))._sum.valor * 100) / 100;
    expect(linha).toMatchObject({ nome: "Vitor Vendas", tecnicoId: "tV", perfil: "Comissão", valor: 0, comissao: aberto });
    expect(aberto).toBeGreaterThan(0);

    // Corrida: alguém pega uma das comissões do mês no meio do fechamento (um gatilho no banco simula isso ao
    // gravar o fechamento) → recusa com a mensagem e NADA fica gravado (nem fechamento, nem conta, nem comissão paga)
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION corrida_comissao() RETURNS trigger AS $f$ BEGIN
      UPDATE comissao_lancamentos SET fechamento_id = NEW.id WHERE id = (SELECT id FROM comissao_lancamentos WHERE fechamento_id IS NULL AND empresa_id = NEW.empresa_id ORDER BY id LIMIT 1);
      RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER corrida_comissao AFTER INSERT ON desempenho_fechamentos FOR EACH ROW EXECUTE FUNCTION corrida_comissao()`);
    const contasAntes = await prisma.contaPagar.count();
    try {
      await expect(fech.fecharMes(autor, { competencia: competencia(), ciente: true })).rejects.toThrow(fech.MSG_COMISSOES_MUDARAM);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER corrida_comissao ON desempenho_fechamentos`);
    }
    expect(await prisma.desempenhoFechamento.count({ where: { empresaId: "e1", competencia: competencia() } })).toBe(0);
    expect(await prisma.contaPagar.count()).toBe(contasAntes);
    expect(Math.round((await prisma.comissaoLancamento.aggregate({ where: { usuarioId: "uV", fechamentoId: null }, _sum: { valor: true } }))._sum.valor * 100) / 100).toBe(aberto);

    const f = await fech.fecharMes(autor, { competencia: competencia(), ciente: true });
    expect(f.totalComissao).toBe(aberto);
    const gravada = await prisma.desempenhoFechamentoLinha.findFirst({ where: { fechamentoId: f.id, usuarioId: "uV" }, include: { contaPagar: true } });
    expect(gravada.contaPagar).toMatchObject({ fornecedor: "Vitor Vendas", tecnicoId: "tV", status: "PENDENTE" });
    expect(Number(gravada.contaPagar.valorTotal)).toBe(aberto);
    expect(gravada.contaPagar.descricao).toMatch(/^Comissões — /);
    // COM-1.1: sem configurar, a conta vence no 5º dia útil do mês seguinte
    expect(gravada.contaPagar.dataVencimento.toISOString().slice(0, 10)).toBe(nesimoDiaUtilDoProximoMes(5));
    expect(await prisma.comissaoLancamento.count({ where: { usuarioId: "uV", fechamentoId: null } })).toBe(0);
    // O extrato mostra "paga"
    logar("uV", montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await chamar("perfil/comissoes", "GET")).json.totais.paga).toBe(aberto);

    // Reabrir: a conta (sem pagamento) é cancelada e as comissões voltam a "liberada"
    await fech.reabrirMes(autor, f.id, "Conferir a comissão do Vitor de novo");
    expect((await prisma.contaPagar.findUnique({ where: { id: gravada.contaPagar.id } })).status).toBe("CANCELADO");
    expect(await prisma.comissaoLancamento.count({ where: { usuarioId: "uV", fechamentoId: null } })).toBeGreaterThan(0);

    // COM-1.1: Configurações › Comissões › vencimento — tipo e dia juntos, dentro do limite; vale no próximo fechamento
    logar("uAdm");
    const cfg = (x: object) => chamar("comissoes", "PUT", {}, { quando: "RECEBIMENTO", liquidaImpostos: false, ...x });
    expect((await cfg({ vencimentoTipo: "DIA_UTIL", vencimentoDia: 21 })).status).toBe(400);
    expect((await cfg({ vencimentoTipo: "DIA_FIXO", vencimentoDia: 32 })).status).toBe(400);
    expect((await cfg({ vencimentoTipo: "DIA_FIXO" })).status).toBe(400);
    expect((await cfg({ vencimentoTipo: "DIA_FIXO", vencimentoDia: 10 })).status).toBe(200);
    expect((await chamar("comissoes", "GET")).json.config.vencimento).toEqual({ tipo: "DIA_FIXO", dia: 10 });
    expect((await cfg({})).status).toBe(200); // sem o vencimento no corpo: fica como está
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).comissaoVencimentoDia).toBe(10);
    // A tela geral de Configurações (que manda a configuração INTEIRA de volta) não mexe no vencimento
    const geral = (await chamar("configuracoes", "GET")).json;
    expect((await chamar("configuracoes", "PUT", {}, { ...geral, comissaoVencimentoTipo: "DIA_UTIL", comissaoVencimentoDia: 3 })).status).toBe(200);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).comissaoVencimentoDia).toBe(10);
    // O banco recusa o que a tela recusa (o CHECK do SQL)
    await expect(prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoVencimentoTipo: "DIA_UTIL", comissaoVencimentoDia: 25 } })).rejects.toThrow();

    // Fecha de novo (versão 2) e registra um pagamento na conta nova: aí não reabre
    const f2 = await fech.fecharMes(autor, { competencia: competencia(), ciente: true });
    expect(f2.versao).toBe(2);
    const l2 = await prisma.desempenhoFechamentoLinha.findFirst({ where: { fechamentoId: f2.id, usuarioId: "uV" } });
    expect((await prisma.contaPagar.findUnique({ where: { id: l2.contaPagarId } })).dataVencimento.toISOString().slice(0, 10)).toBe(diaDoProximoMes(10));
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoVencimentoTipo: "DIA_UTIL", comissaoVencimentoDia: 5 } });
    await prisma.contaPagar.update({ where: { id: l2.contaPagarId }, data: { valorPago: 10, status: "PAGO_PARCIAL" } });
    await expect(fech.reabrirMes(autor, f2.id, "Tentando reabrir com pagamento")).rejects.toThrow(/já tem pagamento registrado/);
    expect((await prisma.desempenhoFechamento.findUnique({ where: { id: f2.id } })).situacao).toBe("FECHADO");
  });

  it("permissão: 'Trocar vendedor' (motivo, trilha, segue para a OS; recusa com comissão liberada); regras e configuração exigem Desempenho › Gerenciar", async () => {
    const o = await novoOrcamento({ servicos: [{ servicoId: "sLimp", descricao: "Limpeza", v: 100 }] });
    // Sem a permissão: 403 (mesmo com todo o resto)
    const semTroca = permissoesTotais(); semTroca.orcamentos = { ...semTroca.orcamentos, trocarVendedor: false };
    logar("uP", semTroca);
    expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: o.id }, { vendedorId: "uP", motivo: "Assumi o cliente" })).status).toBe(403);
    // Com a permissão: sem motivo 400; com motivo troca, registra e segue para a OS
    logar("uP");
    expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: o.id }, { vendedorId: "uP" })).status).toBe(400);
    expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: o.id }, { vendedorId: "uB", motivo: "Outra empresa" })).status).toBe(400); // usuário de outra empresa
    expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: o.id }, { vendedorId: "uP", motivo: "Assumi o cliente" })).status).toBe(200);
    const ev = await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: o.id, tipo: "VENDEDOR" } });
    expect(ev.detalhe).toBe("Vendedor: Vitor Vendas → Paula Pessoa. Motivo: Assumi o cliente");
    expect(ev.usuarioId).toBe("uP");
    // A troca segue para a OS já gerada do orçamento
    const comOs = await novoOrcamento({ servicos: [{ servicoId: "sLimp", descricao: "Limpeza", v: 100 }] });
    const osDele = await prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OS-troca-${comOs.id}`, clienteId: "c1", descricao: "Serviço fictício", criadoPorId: "uV", vendedorId: "uV", orcamentoOrigemId: comOs.id } });
    expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: comOs.id }, { vendedorId: "uP", motivo: "Assumi o cliente" })).status).toBe(200);
    expect((await prisma.ordemServico.findUnique({ where: { id: osDele.id } })).vendedorId).toBe("uP");
    // Aprovado depois da troca: a comissão é da Paula (regra "todos" 2%)
    logar("uAdm");
    await aprovar(o.id);
    expect((await comissoes(o.id)).map((c: any) => [c.usuarioId, Number(c.valor)])).toEqual([["uP", 2]]);
    // COM-1.1 (decisão do item 2; antes: recusava): com comissão liberada a troca VALE — na mesma transação estorna do
    // antigo (fica no histórico como substituída) e libera para o novo, com o mesmo "quando" congelado
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "APROVACAO" } });
    const b = await novoOrcamento({ servicos: [{ servicoId: "sLimp", descricao: "Limpeza", v: 100 }] });
    await aprovar(b.id);
    const doVitor = await liberado(b.id);
    expect(doVitor).toBeGreaterThan(0);
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "RECEBIMENTO" } }); // a troca usa o "quando" da venda, não o de hoje
    expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: b.id }, { vendedorId: "uP", motivo: "Carteira redistribuída" })).status).toBe(200);
    const depois = await comissoes(b.id);
    const antiga = depois.find((c: any) => c.usuarioId === "uV");
    const nova = depois.find((c: any) => c.usuarioId === "uP");
    const soma = (c: any) => Math.round(c.lancamentos.reduce((s: number, l: any) => s + Number(l.valor), 0) * 100) / 100;
    expect([antiga.papel, soma(antiga), antiga.lancamentos.at(-1).motivo, antiga.lancamentos.at(-1).tipo]).toEqual(["VENDEDOR_ANTERIOR", 0, "Troca de vendedor", "ESTORNO"]);
    expect([nova.papel, nova.quando, Number(nova.valor), soma(nova)]).toEqual(["VENDEDOR", "APROVACAO", 2, 2]); // a regra da Paula (todos 2%), já liberada
    expect((await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: b.id, tipo: "VENDEDOR" } })).detalhe).toBe("Vendedor: Vitor Vendas → Paula Pessoa. Motivo: Carteira redistribuída");
    // Sincronizar de novo não mexe em nada (a substituída vale 0; a nova já está no alvo) e não nasce comissão repetida
    expect(await srv.sincronizarComissoes("e1", { orcamentoIds: [b.id] })).toBe(0);
    expect(await srv.gerarComissoesDoOrcamento("e1", b.id)).toBe(0);
    // O extrato do Vitor não tem nada a receber desta venda; o da Paula tem a comissão dela liberada
    logar("uV", montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await chamar("perfil/comissoes", "GET")).json.vendas.some((v: any) => v.orcamentoId === b.id)).toBe(false);
    logar("uP", montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await chamar("perfil/comissoes", "GET")).json.vendas.find((v: any) => v.orcamentoId === b.id)).toMatchObject({ prevista: 0, liberada: 2, paga: 0 });
    // O relatório por emissão (faturada a venda): só a da Paula; a substituída do Vitor não aparece
    logar("uAdm");
    expect((await faturar(b.id)).status).toBe(201);
    const rel = await chamar("comissoes/relatorio", "GET", {}, undefined, `?mes=${competencia()}&vista=EMISSAO`);
    expect(rel.json.pessoas.flatMap((p: any) => p.vendas.filter((v: any) => v.orcamentoId === b.id).map((v: any) => [p.nome, v.valor]))).toEqual([["Paula Pessoa", 2]]);
    // Já PAGA num fechamento: a troca é recusada, com o mês, e nada muda
    logar("uP");
    const f = await prisma.desempenhoFechamento.create({ data: { empresaId: "e1", competencia: "2027-01", versao: 90, painel: {}, premios: [], fechadoPorNome: "Fictício", fechadoEm: new Date() } });
    await prisma.comissaoLancamento.updateMany({ where: { comissaoId: nova.id }, data: { fechamentoId: f.id } });
    const recusa = await chamar("orcamentos/[id]/vendedor", "PATCH", { id: b.id }, { vendedorId: "uV", motivo: "Voltando para o Vitor" });
    expect([recusa.status, recusa.json.erro]).toEqual([409, "A comissão desta venda já foi paga no fechamento de 01/2027: a troca de vendedor não pode mudar o que já foi pago. Fale com o financeiro."]);
    expect((await prisma.orcamento.findUnique({ where: { id: b.id } })).vendedorId).toBe("uP");
    expect((await comissoes(b.id)).length).toBe(2);
    await prisma.comissaoLancamento.updateMany({ where: { comissaoId: nova.id }, data: { fechamentoId: null } });
    await prisma.desempenhoFechamento.delete({ where: { id: f.id } });
    // O novo vendedor sem regra que case (nenhuma ativa): o antigo é estornado do mesmo jeito; nada nasce para o novo
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "APROVACAO" } });
    const c2 = await novoOrcamento({ servicos: [{ servicoId: "sLimp", descricao: "Limpeza", v: 100 }] });
    logar("uAdm");
    await aprovar(c2.id);
    expect(await liberado(c2.id)).toBeGreaterThan(0);
    const ativas = await prisma.comissaoRegra.findMany({ where: { empresaId: "e1", ativo: true }, select: { id: true } });
    await prisma.comissaoRegra.updateMany({ where: { id: { in: ativas.map((r: any) => r.id) } }, data: { ativo: false } });
    try {
      expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: c2.id }, { vendedorId: "uP", motivo: "Sem regra para a Paula" })).status).toBe(200);
      expect(await liberado(c2.id)).toBe(0);
      expect((await comissoes(c2.id)).map((c: any) => [c.usuarioId, c.papel])).toEqual([["uV", "VENDEDOR_ANTERIOR"]]);
    } finally {
      await prisma.comissaoRegra.updateMany({ where: { id: { in: ativas.map((r: any) => r.id) } }, data: { ativo: true } });
      await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoQuando: "RECEBIMENTO" } });
    }

    // Regras e configuração: só com Desempenho › Gerenciar
    logar("uP", montarPermissoes({ orcamentos: ["visualizar", "criar", "editar", "trocarVendedor"], desempenho: ["visualizar"] }));
    expect((await chamar("comissoes", "GET")).status).toBe(403);
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 1 })).status).toBe(403);
    expect((await chamar("comissoes", "PUT", {}, { quando: "APROVACAO", liquidaImpostos: true })).status).toBe(403);
    // Quem só REVISA o Desempenho (sem "Gerenciar") também não mexe em regras nem na configuração
    logar("uP", montarPermissoes({ desempenho: ["visualizar", "revisar"] }));
    expect((await chamar("comissoes", "GET")).status).toBe(403);
    expect((await chamar("comissoes", "PUT", {}, { quando: "APROVACAO", liquidaImpostos: true })).status).toBe(403);
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 1 })).status).toBe(403);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).comissaoQuando).toBe("RECEBIMENTO");
    // Regra repetida (mesmo quem + mesmo alvo) é recusada; percentual acima de 100, também
    logar("uAdm");
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "PECAS", base: "PERC_VENDA", valor: 3 })).status).toBe(409);
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "CATEGORIA", categoria: "Outra", base: "PERC_VENDA", valor: 101 })).status).toBe(400);
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "PESSOA", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 3, papel: "RESPONSAVEL", usuarioId: "uP" })).status).toBe(400); // COM-2 ligou o Executor; o Responsável não
  });

  it("isolamento entre empresas: regras, comissões, extrato e fechamento de uma nunca tocam a outra", async () => {
    // e2 aprova uma venda própria (regra dela: 50%)
    const o = await novoOrcamento({ empresaId: "e2", vendedorId: "uB", servicos: [{ servicoId: "sOut", descricao: "Serviço da outra", v: 100 }] });
    logar("uB");
    expect((await aprovar(o.id)).status).toBe(200);
    expect((await comissoes(o.id)).map((c: any) => [c.usuarioId, Number(c.valor), c.empresaId])).toEqual([["uB", 50, "e2"]]);
    // e2 não enxerga nem usa nada de e1: a tela dela só tem a regra dela; não referencia cargo/serviço de e1
    const tela = await chamar("comissoes", "GET");
    expect(tela.json.regras.map((r: any) => r.valor)).toEqual([50]);
    expect(tela.json.opcoes.pessoas.map((p: any) => p.id)).toEqual(["uB"]);
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "CARGO", cargoId: "cgV", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 1 })).status).toBe(400);
    expect((await chamar("comissoes/regras/[id]", "PATCH", { id: (await prisma.comissaoRegra.findFirst({ where: { empresaId: "e1" } })).id }, { quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 1 })).status).toBe(404);
    // Trocar vendedor de orçamento de e1 a partir de e2: não encontrado
    const deE1 = await prisma.orcamento.findFirst({ where: { empresaId: "e1" } });
    expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: deE1.id }, { vendedorId: "uB", motivo: "Tentativa cruzada" })).status).toBe(404);
    // O extrato de e2 só tem a venda dela; sincronizar e1 não mexe nas de e2
    await srv.sincronizarComissoes("e1");
    expect(await prisma.comissaoLancamento.count({ where: { empresaId: "e2" } })).toBe(0);
    const ext = await chamar("perfil/comissoes", "GET");
    expect(ext.json.vendas.map((v: any) => v.orcamentoId)).toEqual([o.id]);
    // O fechamento de e1 não leva nada de e2
    const previa = await fech.previaDoFechamento("e1", competencia());
    expect(previa.folha.linhas.some((l) => l.usuarioId === "uB")).toBe(false);
  });

  it("empresa sem regra não vê nada de comissão: o extrato vem desligado e o fechamento continua bloqueado", async () => {
    await prisma.empresa.create({ data: { id: "e3", nome: "Sem Comissão", cnpj: "55555555000155", email: "e3@ficticio.test" } });
    await prisma.usuario.create({ data: { id: "uC", empresaId: "e3", nome: "Caio", email: "uC@ficticio.test", senha: "x" } });
    USUARIOS.uC = { empresaId: "e3", nome: "Caio" };
    logar("uC");
    expect((await chamar("perfil/comissoes", "GET")).json).toEqual({ ativo: false, vendas: [], totais: { prevista: 0, liberada: 0, paga: 0 } });
    expect((await fech.previaDoFechamento("e3", competencia())).bloqueio).toMatch(/Desempenho/);
  });

  it("PJ4: no extrato, a venda cancelada não tem mais nada previsto; os totais contam TODAS as comissões (não só as 600 da lista)", async () => {
    logar("uAdm");
    const o = await novoOrcamento({ vendedorId: "uP", servicos: [{ descricao: "Instalação fictícia", v: 1000 }] });
    expect((await aprovar(o.id)).status).toBe(200);
    const antes = (await srv.extratoDoUsuario("e1", "uP")).vendas.find((v) => v.orcamentoId === o.id)!;
    expect(antes.prevista).toBeGreaterThan(0);
    await prisma.orcamento.update({ where: { id: o.id }, data: { status: "CANCELADO" } });
    const ex = await srv.extratoDoUsuario("e1", "uP");
    expect(ex.vendas.find((v) => v.orcamentoId === o.id)?.prevista ?? 0).toBe(0);
    // 650 comissões previstas de R$ 1 numa venda viva: a lista para em 600, o total vê as 650
    const viva = await novoOrcamento({ vendedorId: "uP", servicos: [{ descricao: "Muitos itens", v: 10 }] });
    await prisma.orcamento.update({ where: { id: viva.id }, data: { status: "APROVADO" } });
    await prisma.comissao.createMany({ data: Array.from({ length: 650 }, (_, k) => ({
      empresaId: "e1", orcamentoId: viva.id, usuarioId: "uP", beneficiarioNome: "Paula Pessoa", papel: "VENDEDOR", itemTipo: "SERVICO", itemId: `x${k}`,
      descricao: `Item ${k}`, quantidade: 1, regraDescricao: "Fictícia", base: "PERC_VENDA", baseValor: 10, taxa: 10, valor: 1, quando: "APROVACAO", chave: `pj4-${k}`,
    })) });
    const depois = await srv.extratoDoUsuario("e1", "uP");
    const daViva = depois.vendas.find((v) => v.orcamentoId === viva.id)!;
    expect(depois.totais.prevista + depois.totais.liberada).toBeGreaterThanOrEqual(650);
    expect(daViva.itens.length).toBeLessThanOrEqual(600);
  });
});
