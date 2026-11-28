/**
 * PJ4 — os NÚMEROS das comissões conferidos À MÃO, cenário a cenário, pelas rotas e pelo Prisma de verdade no
 * PostgreSQL REAL. Cada valor esperado foi calculado na mão (a conta está no comentário) e é comparado com o que as
 * TELAS mostram: o extrato de "Minhas comissões" (GET /api/perfil/comissoes, a mesma resposta da tela) e a folha do
 * fechamento do Desempenho (a prévia e a conta a pagar gerada para cada pessoa).
 *
 * Empresa fictícia "Polar Fictícia". Regras do VENDEDOR:
 *   R1 Ana (pessoa) · Todos os serviços · 7%
 *   R2 Vendedores (cargo) · categoria "Instalação" · 5%
 *   R3 Todos · serviço "Instalação VRF" · 3%
 *   R4 Todos · Peças · R$ 10 por item
 *   R5 Todos · Todos os serviços · 5%
 * Regra do TÉCNICO: Todos · Executor · 10% da venda · dividido igual. Teto do João: R$ 150 no mês.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pj4-cenarios-comissoes-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pj4_cenarios_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}), enviarEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/push/eventos", async (o) => ({ ...(await o<object>()), agendarPush: vi.fn(), notificarRespostaOrcamento: vi.fn() }));
vi.setConfig({ testTimeout: 120_000 });

const USUARIOS: Record<string, { empresaId: string; nome: string }> = {
  uAdm: { empresaId: "e1", nome: "Gestora Fictícia" }, uAna: { empresaId: "e1", nome: "Ana Vendas" }, uBruno: { empresaId: "e1", nome: "Bruno Vendas" },
  uCarla: { empresaId: "e1", nome: "Carla Vendas" }, uJoao: { empresaId: "e1", nome: "João Técnico" }, uMaria: { empresaId: "e1", nome: "Maria Técnica" },
  uOutra: { empresaId: "e2", nome: "Pessoa da Outra" },
};
const logar = (id: string, permissoes: Permissoes = permissoesTotais(), role = "OPERADOR") => {
  const u = USUARIOS[id];
  sessao.atual = { user: { id, name: u.nome, email: `${id}@ficticio.test`, empresaId: u.empresaId, role, permissoes, tecnicoId: null } };
};
async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = metodo === "GET" && mod.GET.length === 0 ? await mod.GET() : await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const agora = new Date();
const hoje = () => agora.toISOString().slice(0, 10);
const COMP = (n = 0) => { const t = agora.getUTCFullYear() * 12 + agora.getUTCMonth() + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const r2 = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const DIA = 86_400_000;

describe.skipIf(!URL_PG)("PJ4 — comissões: 6 cenários com os números conferidos à mão (PostgreSQL real)", () => {
  let prisma: any;
  let srv: typeof import("@/lib/comissoes/servidor");
  let exe: typeof import("@/lib/comissoes/executor-server");
  let fech: typeof import("@/lib/desempenho/fechamento-server");
  let med: typeof import("@/lib/faturamento/medicao-contrato-server");
  let n = 0;

  /** O extrato da pessoa como a tela "Minhas comissões" recebe */
  async function extrato(id: string) {
    logar(id, montarPermissoes({ orcamentos: ["visualizar"] }));
    const r = await chamar("perfil/comissoes", "GET");
    expect(r.status).toBe(200);
    return r.json as { totais: { prevista: number; liberada: number; paga: number }; vendas: any[] };
  }
  const daVenda = async (id: string, chave: string) => (await extrato(id)).vendas.find((v) => v.chave === chave || v.orcamentoId === chave);
  const config = (quando: string) => { logar("uAdm"); return chamar("comissoes", "PUT", {}, { quando, liquidaImpostos: false }); };

  async function novoOrcamento(o: { vendedorId: string; servicos?: { servicoId?: string; descricao: string; v: number; q?: number }[]; pecas?: { descricao: string; v: number; q?: number }[]; descontoServicos?: number }) {
    const servicos = (o.servicos ?? []).map((s, i) => ({ servicoId: s.servicoId ?? null, descricao: s.descricao, quantidade: s.q ?? 1, valorUnitario: s.v, valorTotal: (s.q ?? 1) * s.v, ordem: i }));
    const produtos = (o.pecas ?? []).map((p, i) => ({ descricao: p.descricao, quantidade: p.q ?? 1, valorUnitario: p.v, valorTotal: (p.q ?? 1) * p.v, ordem: i }));
    const totS = servicos.reduce((s, l) => s + l.valorTotal, 0) - (o.descontoServicos ?? 0);
    const totP = produtos.reduce((s, l) => s + l.valorTotal, 0);
    n++;
    return prisma.orcamento.create({ data: {
      empresaId: "e1", codigo: `ORC-PJ4-${n}`, nome: `Venda fictícia ${n}`, clienteId: "c1", criadoPorId: o.vendedorId, vendedorId: o.vendedorId,
      status: "RASCUNHO", tipo: "COMUM", tokenPublico: `tok-pj4-${n}-${Math.random()}`, totalServicos: totS, totalProdutos: totP, totalGeral: totS + totP,
      descontoServicos: o.descontoServicos ?? 0, tipoDescontoServicos: "VALOR", servicos: { create: servicos }, produtos: { create: produtos },
    } });
  }
  const aprovar = (id: string) => { logar("uAdm"); return chamar("orcamentos/[id]/aprovacao-equipe", "POST", { id }, { nome: "Cliente Fictício", canal: "TELEFONE" }); };
  async function faturar(id: string) {
    logar("uAdm");
    expect((await chamar("orcamentos/[id]/faturar", "POST", { id })).status).toBe(201);
    const m = await prisma.medicao.findFirst({ where: { itens: { some: { orcamentoId: id } } }, orderBy: { criadoEm: "desc" } });
    const conta = await prisma.contaReceber.findFirst({ where: { medicaoId: m.id, status: { not: "CANCELADO" } } });
    return { medicaoId: m.id as string, conta };
  }
  const receber = (contaId: string, valor: number) => { logar("uAdm"); return chamar("contas-receber/[id]/recebimentos", "POST", { id: contaId }, { valor, data: hoje() }); };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const sql of ["2026-11-14_faturamento_travas_retencoes.sql", "2026-11-16_faturar_avulso.sql", "2026-11-08_faturamento_parcial.sql", "2027-02-11_comissoes.sql",
      "2027-02-14_comissoes_vencimento.sql", "2027-02-14_comissao_executor.sql", "2027-02-15_comissao_contrato.sql"]) {
      execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql", sql)], {
        env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
      });
    }
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    srv = await import("@/lib/comissoes/servidor");
    exe = await import("@/lib/comissoes/executor-server");
    fech = await import("@/lib/desempenho/fechamento-server");
    med = await import("@/lib/faturamento/medicao-contrato-server");
    await Promise.all(["orcamentos/[id]/aprovacao-equipe", "orcamentos/[id]/faturar", "orcamentos/[id]/vendedor", "contas-receber/[id]/recebimentos", "contas-receber/[id]/recebimentos/estornar",
      "medicoes/[id]/acao", "comissoes", "comissoes/regras", "perfil/comissoes", "contratos", "contratos/[id]/status"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Polar Fictícia", cnpj: "11222333000181", email: "e1@ficticio.test" }, { id: "e2", nome: "Outra Fictícia", cnpj: "98765432000110", email: "e2@ficticio.test" }] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: Object.entries(USUARIOS).map(([id, u]) => ({ id, empresaId: u.empresaId, nome: u.nome, email: `${id}@ficticio.test`, senha: "x" })) });
    await prisma.cargo.create({ data: { id: "cgV", empresaId: "e1", nome: "Vendedores" } });
    // A Ana é colaboradora do cargo Vendedores (o cargo vem pelo e-mail de acesso); João e Maria são os técnicos
    await prisma.tecnico.createMany({ data: [
      { id: "tAna", empresaId: "e1", nome: "Ana Vendas", cpf: "1", telefone: "1", email: "uAna@ficticio.test", cargoId: "cgV", tipoEquipe: "ADMINISTRATIVO", tipo: "ADMINISTRATIVO" },
      { id: "tJoao", empresaId: "e1", nome: "João Técnico", cpf: "2", telefone: "1", email: "uJoao@ficticio.test" },
      { id: "tMaria", empresaId: "e1", nome: "Maria Técnica", cpf: "3", telefone: "1", email: "uMaria@ficticio.test" },
    ] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "45723174000110" }, { id: "c2", empresaId: "e2", nome: "Padaria da Outra", cpfCnpj: "11222333000262" }] });
    await prisma.unidade.create({ data: { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.servico.createMany({ data: [
      { id: "sVRF", empresaId: "e1", nome: "Instalação VRF", codigo: "VRF01", categoria: "Instalação" },
      { id: "sSplit", empresaId: "e1", nome: "Manutenção split", codigo: "MAN01", categoria: "Instalação" },
      { id: "sLimp", empresaId: "e1", nome: "Limpeza", codigo: "LIM01", categoria: "Higienização" },
    ] });
    // Técnico: tipo de equipamento com checklist (a trava de qualidade) e dois splits
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split" } });
    await prisma.checklistTipoItem.create({ data: { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Filtro", tipoResposta: "OK_ATENCAO_NA", ordem: 1, criadoEm: new Date("2026-01-01") } });
    await prisma.equipamento.createMany({ data: ["q1", "q2", "q3"].map((id, i) => ({ id, empresaId: "e1", unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", nome: `Split ${i + 1}`, patrimonio: `PJ4-${i}`, tipoEquipamentoId: "te1" })) });
    await prisma.tipoOs.create({ data: { id: "toPrev", empresaId: "e1", nome: "Preventiva" } });

    logar("uAdm");
    for (const r of [
      { quemTipo: "PESSOA", usuarioId: "uAna", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 7 },
      { quemTipo: "CARGO", cargoId: "cgV", sobreTipo: "CATEGORIA", categoria: "Instalação", base: "PERC_VENDA", valor: 5 },
      { quemTipo: "TODOS", sobreTipo: "SERVICO", servicoId: "sVRF", base: "PERC_VENDA", valor: 3 },
      { quemTipo: "TODOS", sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 10 },
      { quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 5 },
      { quemTipo: "TODOS", papel: "EXECUTOR", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 10, divisao: "IGUAL" },
      { quemTipo: "PESSOA", usuarioId: "uAna", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 10, meses: 3 },
      { quemTipo: "PESSOA", usuarioId: "uAna", sobreTipo: "CONTRATOS", base: "FIXO_CONTRATO", valor: 200 },
    ]) { const r1 = await chamar("comissoes/regras", "POST", {}, r); expect(r1.status, JSON.stringify(r1.json)).toBe(201); }
    await prisma.comissaoTeto.create({ data: { empresaId: "e1", quemTipo: "PESSOA", usuarioId: "uJoao", valor: 150 } });
    // A outra empresa tem regra própria e nunca aparece aqui
    logar("uOutra");
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 50 })).status).toBe(201);
  }, 300_000);
  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("C1 — precedência e desconto, liberada na APROVAÇÃO: Ana vende R$ 23.300 com R$ 2.300 de desconto nos serviços = R$ 723,00", async () => {
    expect((await config("APROVACAO")).status).toBe(200);
    // Serviços 20.000 + 2.000 + 1.000 = 23.000; desconto 2.300 → cada linha × 0,9
    //  Instalação VRF   18.000 × 3% (Todos + o serviço vence cargo+categoria e o fixo da Ana) = 540,00
    //  Manutenção split  1.800 × 5% (cargo + categoria "Instalação" vence o fixo da Ana)    =  90,00
    //  Limpeza             900 × 7% (o fixo da Ana: pessoa + todos)                         =  63,00
    //  3 filtros (peças)   3 × R$ 10                                                        =  30,00   → total 723,00
    const o = await novoOrcamento({
      vendedorId: "uAna", descontoServicos: 2300,
      servicos: [{ servicoId: "sVRF", descricao: "Instalação VRF", v: 20000 }, { servicoId: "sSplit", descricao: "Manutenção split", v: 2000 }, { servicoId: "sLimp", descricao: "Limpeza", v: 1000 }],
      pecas: [{ descricao: "Filtro", v: 100, q: 3 }],
    });
    expect((await aprovar(o.id)).status).toBe(200);
    const cs = await prisma.comissao.findMany({ where: { orcamentoId: o.id }, orderBy: { descricao: "asc" } });
    expect(cs.map((c: any) => [c.descricao, r2(c.valor)])).toEqual([["Filtro", 30], ["Instalação VRF", 540], ["Limpeza", 63], ["Manutenção split", 90]]);
    expect(await daVenda("uAna", o.id)).toMatchObject({ prevista: 0, liberada: 723, paga: 0 });
  });

  it("C2 — por RECEBIMENTO, parcial, estorno e de novo: Bruno vende R$ 10.000 a 5% = R$ 500", async () => {
    expect((await config("RECEBIMENTO")).status).toBe(200);
    const o = await novoOrcamento({ vendedorId: "uBruno", servicos: [{ descricao: "Visita técnica", v: 10000 }] });
    expect((await aprovar(o.id)).status).toBe(200);
    expect(await daVenda("uBruno", o.id)).toMatchObject({ prevista: 500, liberada: 0 });
    const { conta } = await faturar(o.id);
    expect(r2(conta.valor)).toBe(10000);
    // Entrou R$ 4.000 = 40% → 200 liberados, 300 previstos
    expect((await receber(conta.id, 4000)).status).toBe(201);
    expect(await daVenda("uBruno", o.id)).toMatchObject({ prevista: 300, liberada: 200 });
    // O recebimento estornado (cheque devolvido) → −200: volta tudo para previsto
    const rec = await prisma.contaReceberRecebimento.findFirst({ where: { contaReceberId: conta.id } });
    logar("uAdm");
    expect((await chamar("contas-receber/[id]/recebimentos/estornar", "POST", { id: conta.id }, { recebimentoId: rec.id, motivo: "Cheque devolvido" })).status).toBe(200);
    expect(await daVenda("uBruno", o.id)).toMatchObject({ prevista: 500, liberada: 0 });
    // Entrou tudo: 500 liberados
    expect((await receber(conta.id, 10000)).status).toBe(201);
    expect(await daVenda("uBruno", o.id)).toMatchObject({ prevista: 0, liberada: 500 });
  });

  it("C3 — troca de vendedor depois de liberar metade: Bruno vende R$ 8.000 (5% = 400), entra R$ 4.000, a venda passa para a Carla", async () => {
    const o = await novoOrcamento({ vendedorId: "uBruno", servicos: [{ descricao: "Manutenção de câmara fria", v: 8000 }] });
    expect((await aprovar(o.id)).status).toBe(200);
    const { conta } = await faturar(o.id);
    expect((await receber(conta.id, 4000)).status).toBe(201);
    expect(await daVenda("uBruno", o.id)).toMatchObject({ prevista: 200, liberada: 200 });
    logar("uAdm");
    expect((await chamar("orcamentos/[id]/vendedor", "PATCH", { id: o.id }, { vendedorId: "uCarla", motivo: "Carteira redistribuída" })).status).toBe(200);
    // Bruno: +200 −200 = 0 (a linha some do extrato dele); Carla: 200 liberados (a metade que entrou) + 200 previstos
    expect(await daVenda("uBruno", o.id)).toBeUndefined();
    expect(await daVenda("uCarla", o.id)).toMatchObject({ prevista: 200, liberada: 200 });
  });

  it("C4 — liberada na aprovação, fatura cancelada estorna, refaturar devolve: Carla vende R$ 5.000 a 5% = R$ 250", async () => {
    expect((await config("APROVACAO")).status).toBe(200);
    const o = await novoOrcamento({ vendedorId: "uCarla", servicos: [{ descricao: "Instalação de cortina de ar", v: 5000 }] });
    expect((await aprovar(o.id)).status).toBe(200);
    expect(await daVenda("uCarla", o.id)).toMatchObject({ liberada: 250 });
    const { medicaoId } = await faturar(o.id);
    logar("uAdm");
    expect((await chamar("medicoes/[id]/acao", "POST", { id: medicaoId }, { acao: "CANCELAR", motivo: "Emitida errada" })).status).toBe(200);
    expect(await daVenda("uCarla", o.id)).toMatchObject({ liberada: 0, prevista: 250 });
    const est = await prisma.comissaoLancamento.findFirst({ where: { comissao: { orcamentoId: o.id }, tipo: "ESTORNO" } });
    expect([r2(est.valor), est.motivo]).toEqual([-250, "Fatura cancelada"]);
    await faturar(o.id);
    expect(await daVenda("uCarla", o.id)).toMatchObject({ liberada: 250, prevista: 0 });
    expect((await config("RECEBIMENTO")).status).toBe(200);
  });

  it("C5 — dupla de técnicos com teto: OS de R$ 2.000 em 2 splits (João e Maria, 10% dividido igual) + outra OS do João de R$ 1.000", async () => {
    // Cada split = 1.000 da linha (÷ 2 vinculados) × 10% = 100, metade para cada um: João 100, Maria 100
    // A segunda OS (só o João, 1 split, R$ 1.000): 1.000 × 10% = 100 para o João. João no mês: 200 → o teto paga 150
    const novaOs = async (valor: number, equipamentos: string[], tecnicos: string[]) => {
      n++;
      const id = `osPj4${n}`;
      await prisma.ordemServico.create({ data: {
        id, empresaId: "e1", numero: `OS-PJ4-${n}`, clienteId: "c1", criadoPorId: "uAdm", descricao: "Preventiva fictícia", status: "CONCLUIDA", dataConclusao: new Date(agora.getTime() - DIA),
        itensOrcamento: { create: [{ descricao: "Limpeza de split", quantidade: 1, valorUnitario: valor, valorTotal: valor, servicoId: "sLimp", tipo: "SERVICO" }] },
      } });
      const [resp, ...equipe] = tecnicos;
      await prisma.atividadeOs.create({ data: { id: `at-${id}`, empresaId: "e1", ordemServicoId: id, titulo: "Limpeza", tipoOsId: "toPrev", tecnicoId: resp, status: "CONCLUIDA", concluidaEm: new Date(agora.getTime() - DIA), tecnicosEquipe: { create: equipe.map((tecnicoId) => ({ tecnicoId })) } } });
      for (const e of equipamentos) {
        await prisma.atividadeEquipamento.create({ data: { atividadeId: `at-${id}`, equipamentoId: e, feito: true, feitoEm: new Date(agora.getTime() - 2 * DIA) } });
        await prisma.checklistResposta.create({ data: { empresaId: "e1", atividadeId: `at-${id}`, equipamentoId: e, itemId: "i1", textoItem: "Filtro", status: "OK" } });
      }
      return id;
    };
    const os1 = await novaOs(2000, ["q1", "q2"], ["tJoao", "tMaria"]);
    const os2 = await novaOs(1000, ["q3"], ["tJoao"]);
    await exe.sincronizarExecutor("e1", { osIds: [os1, os2] }, agora);
    expect(await daVenda("uJoao", `os:${os1}`)).toMatchObject({ liberada: 100 });
    expect(await daVenda("uMaria", `os:${os1}`)).toMatchObject({ liberada: 100 });
    expect(await daVenda("uJoao", `os:${os2}`)).toMatchObject({ liberada: 100 });
    // A folha do mês: João 150 (teto), Maria 100
    const previa = await fech.previaDoFechamento("e1", COMP(0), agora);
    expect(previa.folha.linhas.find((l) => l.usuarioId === "uJoao")!.comissao).toBe(150);
    expect(previa.folha.linhas.find((l) => l.usuarioId === "uMaria")!.comissao).toBe(100);
  });

  it("C6 — contrato: Ana fecha um contrato de R$ 1.500/mês (10% nos 3 primeiros meses + R$ 200 no fechamento)", async () => {
    // Prevista ao fechar: 3 × 150 + 200 = 650. Entra R$ 750 da 1ª (50%): 75 + 100 (o fixo sai com a 1ª, proporcional) = 175
    // Entra o resto da 1ª: 150 + 200 = 350 liberados; 300 previstos (as outras duas mensalidades)
    logar("uAna");
    const r = await chamar("contratos", "POST", {}, { clienteId: "c1", numero: "CT-PJ4-1", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 1500, dataInicio: hoje(), dataFim: new Date(agora.getTime() + 330 * DIA).toISOString().slice(0, 10), diaFaturamento: 10 });
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    const chave = `ct:${id}`;
    expect(await daVenda("uAna", chave)).toMatchObject({ prevista: 650, liberada: 0 });
    const c = await prisma.contrato.findUnique({ where: { id }, include: { cliente: true } });
    const [ano, mes] = COMP(0).split("-").map(Number);
    const g = await med.gerarMedicaoDeContratos({ empresaId: "e1", cliente: c.cliente, contratos: [c], ano, mes, porContrato: true });
    expect(g.status).toBe("criada");
    const medId = (g as any).medicao.id;
    logar("uAdm");
    expect((await chamar("medicoes/[id]/acao", "POST", { id: medId }, { acao: "ENVIAR" })).status).toBe(200);
    expect((await chamar("medicoes/[id]/acao", "POST", { id: medId }, { acao: "APROVAR_MANUAL" })).status).toBe(200);
    const conta = await prisma.contaReceber.findFirst({ where: { medicaoId: medId, status: { not: "CANCELADO" } } });
    expect((await receber(conta.id, 750)).status).toBe(201);
    expect(await daVenda("uAna", chave)).toMatchObject({ prevista: 475, liberada: 175 });
    expect((await receber(conta.id, 750)).status).toBe(201);
    expect(await daVenda("uAna", chave)).toMatchObject({ prevista: 300, liberada: 350 });
  });

  it("FECHAMENTO do mês: UMA conta a pagar por pessoa, com os números acima; o extrato passa a mostrar Paga; outra empresa não vê nada", async () => {
    // Ana: 723 (C1) + 350 (C6) = 1.073 · Bruno: 500 (C2) · Carla: 200 (C3) + 250 (C4) = 450 · João: 150 (teto) · Maria: 100
    const autor = { empresaId: "e1", usuarioId: "uAdm", nome: "Gestora Fictícia" };
    const f = await fech.fecharMes(autor, { competencia: COMP(0), ciente: true }, agora);
    const linhas = await prisma.desempenhoFechamentoLinha.findMany({ where: { fechamentoId: f.id }, include: { contaPagar: true } });
    const conta = (u: string) => r2(linhas.find((l: any) => l.usuarioId === u)?.contaPagar?.valorTotal);
    expect({ ana: conta("uAna"), bruno: conta("uBruno"), carla: conta("uCarla"), joao: conta("uJoao"), maria: conta("uMaria") })
      .toEqual({ ana: 1073, bruno: 500, carla: 450, joao: 150, maria: 100 });
    expect(linhas.filter((l: any) => l.contaPagar).length).toBe(5); // uma por pessoa
    expect((await extrato("uAna")).totais).toMatchObject({ paga: 1073, liberada: 0, prevista: 300 });
    expect((await extrato("uJoao")).totais).toMatchObject({ paga: 150, liberada: 50 }); // o excedente do teto passa para o mês seguinte
    // Ver só os próprios: cada um vê só o seu; a pessoa da outra empresa não vê nada daqui
    expect((await extrato("uBruno")).vendas.every((v) => v.chave !== `ct:` && !String(v.codigo).startsWith("CT-"))).toBe(true);
    logar("uOutra", montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await chamar("perfil/comissoes", "GET")).json.vendas).toEqual([]);
  });

  it("C7 — recebimentos em dois meses pegos numa conta só: cada mês leva a sua parte (o fechamento do mês passado não perde nada)", async () => {
    // Venda de R$ 1.000 a 5% = 50; entram 500 no dia 15 do mês passado e 500 hoje, e só depois alguém olha o extrato
    expect((await config("RECEBIMENTO")).status).toBe(200);
    const o = await novoOrcamento({ vendedorId: "uBruno", servicos: [{ descricao: "Revisão de chiller", v: 1000 }] });
    expect((await aprovar(o.id)).status).toBe(200);
    const { conta } = await faturar(o.id);
    const passado = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 15)).toISOString().slice(0, 10);
    logar("uAdm");
    expect((await chamar("contas-receber/[id]/recebimentos", "POST", { id: conta.id }, { valor: 500, data: passado })).status).toBe(201);
    expect((await receber(conta.id, 500)).status).toBe(201);
    expect(await daVenda("uBruno", o.id)).toMatchObject({ liberada: 50, prevista: 0 });
    const lanc = await prisma.comissaoLancamento.findMany({ where: { comissao: { orcamentoId: o.id } }, orderBy: { data: "asc" } });
    expect(lanc.map((l: any) => [l.data.toISOString().slice(0, 7), r2(l.valor)])).toEqual([[COMP(-1), 25], [COMP(0), 25]]);
  });
});
