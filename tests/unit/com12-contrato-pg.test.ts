/**
 * COM-1.2 — Comissão sobre CONTRATO com as rotas e o Prisma de verdade no PostgreSQL REAL (schema descartável):
 *  - proposta convertida: o vendedor do contrato é o da proposta; a comissão nasce PREVISTA (uma por mensalidade da
 *    janela + o fixo no fechamento) e nada é liberado até o dinheiro entrar; proposta aceita sem virar contrato não gera;
 *  - mensalidade recebida libera a parte dela (PARCIAL = proporcional; o fixo sai com a 1ª mensalidade); recebimento
 *    ESTORNADO estorna; fatura cancelada estorna; mensalidade fora da janela não gera;
 *  - precedência: a regra do TIPO de contrato vence "todos os contratos"; janela "enquanto ativo" (0) cresce com as
 *    mensalidades que o contrato passa a cobrar;
 *  - status: "Aguardando assinatura" não gera; virar ATIVO é o fechamento; suspenso/cancelado para de gerar dali em
 *    diante (o liberado fica); reajuste vale para as próximas; renovação só com "Renovação também gera";
 *  - "Trocar vendedor" do contrato: a permissão, o motivo no histórico, o liberado estorna do antigo e o novo ganha;
 *    pago no fechamento recusa;
 *  - contrato de antes (sem vendedor) não gera nada; isolamento entre empresas; extrato, fechamento e relatório.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/com12-contrato-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_com12_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}), enviarEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/push/eventos", async (o) => ({ ...(await o<object>()), agendarPush: vi.fn(), notificarRespostaOrcamento: vi.fn() }));
vi.setConfig({ testTimeout: 120_000 });

const USUARIOS: Record<string, { empresaId: string; nome: string }> = {
  uAdm: { empresaId: "e1", nome: "Ana Gestora" }, uV: { empresaId: "e1", nome: "Vitor Vendas" }, uP: { empresaId: "e1", nome: "Paula Pessoa" },
  uB: { empresaId: "e2", nome: "Beto Outra" },
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
const COMP = (n = 0) => { const t = agora.getUTCFullYear() * 12 + agora.getUTCMonth() + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const hoje = () => agora.toISOString().slice(0, 10);
const diaDoMes = (n: number, dia = 1) => { const t = agora.getUTCFullYear() * 12 + agora.getUTCMonth() + n; return new Date(Date.UTC(Math.floor(t / 12), t % 12, dia)).toISOString().slice(0, 10); };

describe.skipIf(!URL_PG)("COM-1.2 — comissão sobre contrato (PostgreSQL real)", () => {
  let prisma: any;
  let srv: typeof import("@/lib/comissoes/servidor");
  let ct: typeof import("@/lib/comissoes/contrato-server");
  let med: typeof import("@/lib/faturamento/medicao-contrato-server");
  let n = 0;

  const comissoes = (contratoId: string) => prisma.comissao.findMany({ where: { contratoId }, orderBy: [{ itemTipo: "asc" }, { competencia: "asc" }], include: { lancamentos: true } });
  const liberado = async (contratoId: string, papel?: string) =>
    Math.round(((await prisma.comissaoLancamento.aggregate({ where: { comissao: { contratoId, ...(papel ? { papel } : {}) } }, _sum: { valor: true } }))._sum.valor ?? 0) * 100) / 100;
  const sincronizar = () => srv.sincronizarComissoes("e1");

  /** Cria um contrato pela rota (quem está logado é o criador = o vendedor) */
  async function novoContrato(dados: Record<string, unknown> = {}) {
    n++;
    const r = await chamar("contratos", "POST", {}, {
      clienteId: "c1", numero: `CT-COM-${n}`, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 1000, dataInicio: hoje(), dataFim: diaDoMes(11, 28), diaFaturamento: 10, ...dados,
    });
    expect(r.status).toBe(201);
    return r.json.id as string;
  }
  /** Fatura a mensalidade da competência (n meses a partir de hoje), envia, aprova e devolve a conta a receber dela */
  async function faturarMensalidade(contratoId: string, mesesAFrente = 0) {
    const c = await prisma.contrato.findUnique({ where: { id: contratoId }, include: { cliente: true } });
    const [ano, mes] = COMP(mesesAFrente).split("-").map(Number);
    const r = await med.gerarMedicaoDeContratos({ empresaId: c.empresaId, cliente: c.cliente, contratos: [c], ano, mes, porContrato: true });
    expect(r.status).toBe("criada");
    const id = (r as any).medicao.id;
    logar("uAdm");
    expect((await chamar("medicoes/[id]/acao", "POST", { id }, { acao: "ENVIAR" })).status).toBe(200);
    expect((await chamar("medicoes/[id]/acao", "POST", { id }, { acao: "APROVAR_MANUAL" })).status).toBe(200);
    const conta = await prisma.contaReceber.findFirst({ where: { medicaoId: id, status: { not: "CANCELADO" } } });
    expect(conta).toBeTruthy();
    return { medicaoId: id, conta };
  }
  const receber = (contaId: string, valor?: number) => chamar("contas-receber/[id]/recebimentos", "POST", { id: contaId }, { ...(valor !== undefined ? { valor } : {}), data: hoje() });
  const status = (id: string, s: string) => chamar("contratos/[id]/status", "PATCH", { id }, { status: s, motivo: "Teste fictício" });

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
    ct = await import("@/lib/comissoes/contrato-server");
    med = await import("@/lib/faturamento/medicao-contrato-server");
    await Promise.all(["contratos", "contratos/[id]/status", "contratos/[id]/vendedor", "orcamentos/[id]/gerar-contrato", "contas-receber/[id]/recebimentos", "contas-receber/[id]/recebimentos/estornar",
      "medicoes/[id]/acao", "comissoes", "comissoes/regras", "perfil/comissoes", "configuracoes"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Fictícia", cnpj: "12345678000190", email: "e1@ficticio.test" }, { id: "e2", nome: "Outra Fictícia", cnpj: "98765432000110", email: "e2@ficticio.test" }] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: Object.entries(USUARIOS).map(([id, u]) => ({ id, empresaId: u.empresaId, nome: u.nome, email: `${id}@ficticio.test`, senha: "x" })) });
    await prisma.cargo.createMany({ data: [{ id: "cgV", empresaId: "e1", nome: "Vendedores" }] });
    await prisma.tecnico.create({ data: { id: "tV", empresaId: "e1", nome: "Vitor Vendas", cpf: "11122233344", telefone: "11999990000", email: "uV@ficticio.test", cargoId: "cgV" } });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "11222333000181" }, { id: "c2", empresaId: "e2", nome: "Padaria da Outra", cpfCnpj: "11222333000262" }] });
    // e1: todos 5% das mensalidades nos 3 primeiros meses; Vitor R$ 200 no fechamento; cargo Vendedores 10% em Locação enquanto ativo
    logar("uAdm");
    for (const r of [
      { quemTipo: "TODOS", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 5, meses: 3 },
      { quemTipo: "PESSOA", usuarioId: "uV", sobreTipo: "CONTRATOS", base: "FIXO_CONTRATO", valor: 200 },
      { quemTipo: "CARGO", cargoId: "cgV", sobreTipo: "CONTRATOS", tipoContrato: "LOCACAO", base: "PERC_MENSALIDADE", valor: 10, meses: 0 },
    ]) expect((await chamar("comissoes/regras", "POST", {}, r)).status).toBe(201);
    logar("uB");
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 50, meses: 1 })).status).toBe(201);
  }, 300_000);
  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("a tela recusa regra de contrato com base de venda, papel Executor ou repetida; a mesma pessoa pode ter % e fixo", async () => {
    logar("uAdm");
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "CONTRATOS", base: "PERC_VENDA", valor: 5 })).status).toBe(400);
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", papel: "EXECUTOR", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 5 })).status).toBe(400);
    expect((await chamar("comissoes/regras", "POST", {}, { quemTipo: "TODOS", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 7, meses: 6 })).status).toBe(409);
    const tela = await chamar("comissoes", "GET");
    expect(tela.json.regras.filter((r: any) => r.sobreTipo === "CONTRATOS").map((r: any) => [r.base, r.tipoContrato, r.meses]))
      .toEqual(expect.arrayContaining([["PERC_MENSALIDADE", null, 3], ["FIXO_CONTRATO", null, null], ["PERC_MENSALIDADE", "LOCACAO", 0]]));
    expect(tela.json.config.renovacaoGera).toBe(false);
  });

  it("proposta convertida: vendedor da proposta; nasce PREVISTA (3 mensalidades + fixo) e nada liberado; aceita sem converter não gera", async () => {
    const prop = await prisma.orcamento.create({ data: {
      empresaId: "e1", codigo: "PROP-1", nome: "Proposta fictícia", clienteId: "c1", criadoPorId: "uAdm", vendedorId: "uV", status: "APROVADO", tipo: "PROPOSTA_CONTRATO",
      tokenPublico: `tok-prop-${Math.random()}`, valorMensal: 1000, totalGeral: 12000, dataInicioContrato: new Date(`${hoje()}T12:00:00Z`),
    } });
    await sincronizar();
    expect(await prisma.comissao.count({ where: { empresaId: "e1" } })).toBe(0); // aceita, sem contrato: nada
    logar("uAdm"); // quem converte não é o vendedor: o vendedor segue o da proposta
    const r = await chamar("orcamentos/[id]/gerar-contrato", "POST", { id: prop.id });
    expect(r.status).toBe(201);
    const contrato = await prisma.contrato.findUnique({ where: { id: r.json.contratoId } });
    expect(contrato.vendedorId).toBe("uV");
    const cs = await comissoes(contrato.id);
    expect(cs.map((c: any) => [c.itemTipo, c.competencia, Number(c.valor), c.usuarioId, c.quando, c.base])).toEqual([
      ["FIXO", COMP(0), 200, "uV", "RECEBIMENTO", "FIXO_CONTRATO"],
      ["MENSALIDADE", COMP(0), 50, "uV", "RECEBIMENTO", "PERC_MENSALIDADE"],
      ["MENSALIDADE", COMP(1), 50, "uV", "RECEBIMENTO", "PERC_MENSALIDADE"],
      ["MENSALIDADE", COMP(2), 50, "uV", "RECEBIMENTO", "PERC_MENSALIDADE"],
    ]);
    expect(cs[1].regraDescricao).toBe("Todos · Todos os contratos · 5% das mensalidades nos 3 primeiros meses");
    expect(cs[0].regraDescricao).toBe("Vitor Vendas (pessoa) · Todos os contratos · R$ 200,00 no fechamento");
    expect(await liberado(contrato.id)).toBe(0);
    // Converter de novo não duplica (idempotente)
    expect((await chamar("orcamentos/[id]/gerar-contrato", "POST", { id: prop.id })).json.jaExistia).toBe(true);
    expect(await ct.gerarComissoesDoContrato("e1", contrato.id)).toBe(0);
    expect(await prisma.comissao.count({ where: { contratoId: contrato.id } })).toBe(4);
    // O extrato da pessoa: o contrato, previsto
    logar("uV");
    const ext = await chamar("perfil/comissoes", "GET");
    const linha = ext.json.vendas.find((v: any) => v.chave === `ct:${contrato.id}`);
    expect(linha).toMatchObject({ tipo: "CONTRATO", codigo: contrato.numero, nome: "Contrato", cliente: "Hospital Fictício", prevista: 350, liberada: 0, paga: 0 });
    expect(linha.itens.map((i: any) => i.descricao)).toEqual(["Fechamento do contrato", `Mensalidade ${COMP(0).slice(5)}/${COMP(0).slice(0, 4)}`, expect.any(String), expect.any(String)]);
    expect(JSON.stringify(ext.json)).not.toMatch(/baseValor|base_valor/);
  });

  it("mensalidade recebida libera a parte dela (parcial = proporcional; o fixo sai com a 1ª); estorno estorna; fora da janela nada", async () => {
    logar("uV");
    const id = await novoContrato();
    expect((await prisma.contrato.findUnique({ where: { id } })).vendedorId).toBe("uV");
    const { conta } = await faturarMensalidade(id, 0);
    logar("uAdm");
    expect((await receber(conta.id, 400)).status).toBe(201);
    await sincronizar();
    const fixo = () => prisma.comissao.findFirst({ where: { contratoId: id, itemTipo: "FIXO" }, include: { lancamentos: true } });
    const mes0 = () => prisma.comissao.findFirst({ where: { contratoId: id, competencia: COMP(0), itemTipo: "MENSALIDADE" }, include: { lancamentos: true } });
    expect((await mes0()).lancamentos.map((l: any) => [l.tipo, Number(l.valor), l.motivo])).toEqual([["LIBERACAO", 20, "Mensalidade do contrato recebida"]]); // 5% de 400
    expect((await fixo()).lancamentos.map((l: any) => Number(l.valor))).toEqual([80]); // 200 × 40%
    // Quita: libera o resto
    expect((await receber(conta.id)).status).toBe(201);
    await sincronizar();
    expect(await liberado(id)).toBe(250); // 50 da 1ª mensalidade + 200 do fixo
    // Estorna um recebimento: a comissão daquela parte volta
    const rec = await prisma.contaReceberRecebimento.findFirst({ where: { contaReceberId: conta.id, valor: 400 } });
    expect((await chamar("contas-receber/[id]/recebimentos/estornar", "POST", { id: conta.id }, { recebimentoId: rec.id, motivo: "Cheque devolvido" })).status).toBe(200);
    await sincronizar();
    expect(await liberado(id)).toBe(150); // 5% de 600 + 200 × 60%
    expect((await mes0()).lancamentos.at(-1)).toMatchObject({ tipo: "ESTORNO", motivo: "Mensalidade estornada ou cancelada" });
    // Sincronizar de novo não cria nada (idempotente)
    const antes = await prisma.comissaoLancamento.count();
    await sincronizar();
    expect(await prisma.comissaoLancamento.count()).toBe(antes);
    // A 4ª mensalidade está fora da janela de 3 meses: recebida, não gera nada
    const fora = await faturarMensalidade(id, 3);
    logar("uAdm");
    expect((await receber(fora.conta.id)).status).toBe(201);
    await sincronizar();
    expect(await prisma.comissao.count({ where: { contratoId: id, competencia: COMP(3) } })).toBe(0);
    expect(await liberado(id)).toBe(150);
    // Fatura cancelada: a mensalidade some — estorna
    const m1 = await faturarMensalidade(id, 1);
    logar("uAdm");
    expect((await receber(m1.conta.id)).status).toBe(201);
    await sincronizar();
    expect(await liberado(id)).toBe(200);
    // Estorna o recebimento e cancela a fatura (o cancelamento recusa fatura com dinheiro dentro)
    const r1 = await prisma.contaReceberRecebimento.findFirst({ where: { contaReceberId: m1.conta.id } });
    expect((await chamar("contas-receber/[id]/recebimentos/estornar", "POST", { id: m1.conta.id }, { recebimentoId: r1.id, motivo: "Devolvido" })).status).toBe(200);
    expect((await chamar("medicoes/[id]/acao", "POST", { id: m1.medicaoId }, { acao: "CANCELAR" })).status).toBe(200);
    await sincronizar();
    expect(await liberado(id)).toBe(150);
  });

  it("a regra do TIPO vence a geral; a janela 'enquanto ativo' cresce com as mensalidades que o contrato passa a cobrar", async () => {
    logar("uV");
    const id = await novoContrato({ tipo: "LOCACAO" });
    const cs = await comissoes(id);
    const mensal = cs.filter((c: any) => c.itemTipo === "MENSALIDADE");
    // As previsões que o contrato já gerou (dentro da vigência) viraram mensalidades: cargo + tipo (10%) vence todos (5%)
    const previsoes = await prisma.contaReceber.count({ where: { contratoId: id } });
    expect(previsoes).toBeGreaterThan(3);
    expect(mensal.length).toBe(previsoes);
    expect(new Set(mensal.map((c: any) => Number(c.valor)))).toEqual(new Set([100]));
    expect(mensal.every((c: any) => c.meses === 0 && c.regraDescricao === "Vendedores (cargo) · Contratos de Locação · 10% das mensalidades enquanto o contrato estiver ativo")).toBe(true);
    expect(cs.filter((c: any) => c.itemTipo === "FIXO").length).toBe(1); // o fixo da pessoa (outra base) também vale
    // Uma mensalidade nova cobrada (a vigência foi estendida): na próxima conta, ganha a sua comissão
    const ultima = mensal.at(-1).competencia as string;
    const [a, m] = ultima.split("-").map(Number);
    const prox = m === 12 ? { ano: a + 1, mes: 1 } : { ano: a, mes: m + 1 };
    await prisma.contaReceber.create({ data: { empresaId: "e1", clienteId: "c1", contratoId: id, refAno: prox.ano, refMes: prox.mes, numero: `X-${id}`, descricao: "Mensalidade fictícia", valor: 1200, status: "PREVISTO" } });
    await sincronizar();
    const nova = await prisma.comissao.findFirst({ where: { contratoId: id, competencia: `${prox.ano}-${String(prox.mes).padStart(2, "0")}` } });
    expect(Number(nova.valor)).toBe(120); // reajustada: 10% de 1.200
  });

  it("status: aguardando assinatura não gera; virar ATIVO é o fechamento; suspenso para dali em diante (o liberado fica); renovação só com a chave", async () => {
    logar("uV");
    const id = await novoContrato({ status: "AGUARDANDO_ASSINATURA" });
    expect(await prisma.comissao.count({ where: { contratoId: id } })).toBe(0);
    logar("uAdm");
    expect((await status(id, "ATIVO")).status).toBe(200);
    expect(await prisma.comissao.count({ where: { contratoId: id } })).toBe(4); // 3 mensalidades + fixo do vendedor (Vitor criou)
    const { conta } = await faturarMensalidade(id, 0);
    logar("uAdm");
    expect((await receber(conta.id)).status).toBe(201);
    await sincronizar();
    expect(await liberado(id)).toBe(250);
    // Suspende: as mensalidades dali em diante deixam de valer (previsto zera); o que já foi liberado fica
    expect((await status(id, "SUSPENSO")).status).toBe(200);
    const depois = await prisma.comissao.findMany({ where: { contratoId: id, itemTipo: "MENSALIDADE", competencia: { gte: COMP(0) } }, include: { lancamentos: true } });
    expect(depois.map((c: any) => [c.competencia, Number(c.valor), c.lancamentos.length])).toEqual([[COMP(0), 50, 1], [COMP(1), 0, 0], [COMP(2), 0, 0]]);
    expect(await liberado(id)).toBe(250);
    // Reativa: volta a valer
    expect((await status(id, "ATIVO")).status).toBe(200);
    expect((await prisma.comissao.findMany({ where: { contratoId: id, competencia: COMP(1), itemTipo: "MENSALIDADE" } })).map((c: any) => Number(c.valor))).toEqual([50]);
    // Renovação: sem a chave, não gera ciclo novo; com a chave, gera (o ciclo começa no mês da renovação)
    const daqui1Ano = new Date(Date.UTC(agora.getUTCFullYear() + 1, agora.getUTCMonth(), 15));
    // (o contrato já voltou a ATIVO quando o gatilho roda, como depois da troca de status)
    await prisma.contrato.update({ where: { id }, data: { status: "ATIVO" } });
    await ct.comissoesDoContratoNoStatus("e1", id, "EM_RENOVACAO", "ATIVO", daqui1Ano);
    expect(await prisma.comissao.count({ where: { contratoId: id } })).toBe(4);
    expect((await chamar("comissoes", "PUT", {}, { quando: "RECEBIMENTO", liquidaImpostos: false, renovacaoGera: true })).status).toBe(200);
    await prisma.contrato.update({ where: { id }, data: { status: "ATIVO" } });
    await ct.comissoesDoContratoNoStatus("e1", id, "EM_RENOVACAO", "ATIVO", daqui1Ano);
    const ciclos = await prisma.comissao.groupBy({ by: ["cicloInicio"], where: { contratoId: id }, _count: true });
    expect(ciclos.length).toBe(2);
    const renov = await prisma.comissao.findFirst({ where: { contratoId: id, itemTipo: "FIXO", cicloInicio: { not: COMP(0) } } });
    expect(renov.descricao).toBe("Renovação do contrato");
    expect((await chamar("comissoes", "PUT", {}, { quando: "RECEBIMENTO", liquidaImpostos: false, renovacaoGera: false })).status).toBe(200);
    // A tela geral de Configurações (que manda a configuração INTEIRA de volta) não mexe na chave da renovação
    const geral = (await chamar("configuracoes", "GET")).json;
    expect((await chamar("configuracoes", "PUT", {}, { ...geral, comissaoRenovacaoGera: true })).status).toBe(200);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).comissaoRenovacaoGera).toBe(false);
  });

  it("trocar o vendedor do contrato: precisa da permissão e do motivo (no histórico); o liberado estorna do antigo, o novo ganha; pago recusa", async () => {
    logar("uV");
    const id = await novoContrato();
    const { conta } = await faturarMensalidade(id, 0);
    logar("uAdm");
    expect((await receber(conta.id)).status).toBe(201);
    await sincronizar();
    expect(await liberado(id)).toBe(250);
    // Sem "Trocar vendedor": 403; sem motivo: 400
    logar("uAdm", montarPermissoes({ contratos: ["visualizar", "editar"], orcamentos: ["visualizar"] }));
    expect((await chamar("contratos/[id]/vendedor", "PATCH", { id }, { vendedorId: "uP", motivo: "Carteira nova" })).status).toBe(403);
    logar("uAdm");
    expect((await chamar("contratos/[id]/vendedor", "PATCH", { id }, { vendedorId: "uP" })).status).toBe(400);
    expect((await chamar("contratos/[id]/vendedor", "PATCH", { id }, { vendedorId: "uV", motivo: "Carteira nova" })).status).toBe(400); // o mesmo
    const r = await chamar("contratos/[id]/vendedor", "PATCH", { id }, { vendedorId: "uP", motivo: "Carteira nova da Paula" });
    expect(r.status).toBe(200);
    expect(r.json.vendedor).toEqual({ id: "uP", nome: "Paula Pessoa" });
    const c = await prisma.contrato.findUnique({ where: { id }, include: { historicoStatus: true } });
    expect(c.vendedorId).toBe("uP");
    expect(c.historicoStatus.map((h: any) => [h.statusAnterior, h.statusNovo, h.motivo])).toContainEqual(["ATIVO", "ATIVO", "Vendedor: Vitor Vendas → Paula Pessoa. Motivo: Carteira nova da Paula"]);
    // A linha do tempo do cliente mostra mudanças de STATUS do contrato: a troca de vendedor (status igual) fica de fora
    const { carregarHistoricoCliente } = await import("@/lib/clientes/historico-server");
    const evs = await carregarHistoricoCliente("e1", "c1", { comFinanceiro: false });
    expect(evs.filter((e: any) => e.href === `/contratos/${id}` && /ativo/.test(e.titulo)).length).toBe(0);
    // O antigo: estornado e substituído (histórico); a Paula ganha a dela (todos 5%; o fixo era só do Vitor) já liberada
    expect(await liberado(id, "VENDEDOR_ANTERIOR")).toBe(0);
    expect((await prisma.comissao.findMany({ where: { contratoId: id, papel: "VENDEDOR_ANTERIOR" } })).every((x: any) => x.chave === null && x.usuarioId === "uV")).toBe(true);
    const novas = await prisma.comissao.findMany({ where: { contratoId: id, papel: "VENDEDOR" } });
    expect(novas.map((x: any) => [x.usuarioId, x.itemTipo, Number(x.valor)]).sort()).toEqual([["uP", "MENSALIDADE", 50], ["uP", "MENSALIDADE", 50], ["uP", "MENSALIDADE", 50]]);
    expect(await liberado(id, "VENDEDOR")).toBe(50);
    // Pago num fechamento FECHADO: a troca é recusada
    const f = await prisma.desempenhoFechamento.create({ data: { empresaId: "e1", competencia: "2027-01", versao: 91, painel: {}, premios: [], fechadoPorNome: "Fictício", fechadoEm: new Date() } });
    await prisma.comissaoLancamento.updateMany({ where: { comissao: { contratoId: id, papel: "VENDEDOR" } }, data: { fechamentoId: f.id } });
    const recusa = await chamar("contratos/[id]/vendedor", "PATCH", { id }, { vendedorId: "uV", motivo: "Voltou para o Vitor" });
    expect(recusa.status).toBe(409);
    expect(recusa.json.erro).toBe("A comissão deste contrato já foi paga no fechamento de 01/2027: a troca de vendedor não pode mudar o que já foi pago. Fale com o financeiro.");
    expect((await prisma.contrato.findUnique({ where: { id } })).vendedorId).toBe("uP");
    await prisma.comissaoLancamento.updateMany({ where: { fechamentoId: f.id }, data: { fechamentoId: null } });
    await prisma.desempenhoFechamento.delete({ where: { id: f.id } });
    // Para alguém SEM regra (nenhuma de contrato ativa): o liberado da Paula é estornado na hora, e nada nasce para o novo
    const ativas = await prisma.comissaoRegra.findMany({ where: { empresaId: "e1", ativo: true, sobreTipo: "CONTRATOS" }, select: { id: true } });
    await prisma.comissaoRegra.updateMany({ where: { id: { in: ativas.map((x: any) => x.id) } }, data: { ativo: false } });
    try {
      expect((await chamar("contratos/[id]/vendedor", "PATCH", { id }, { vendedorId: "uV", motivo: "Voltou para o Vitor" })).status).toBe(200);
      expect(await liberado(id)).toBe(0);
      expect(await prisma.comissao.count({ where: { contratoId: id, papel: "VENDEDOR" } })).toBe(0);
    } finally {
      await prisma.comissaoRegra.updateMany({ where: { id: { in: ativas.map((x: any) => x.id) } }, data: { ativo: true } });
    }
  });

  it("contrato de antes (sem vendedor) não gera nada, nem ao reativar; isolamento entre empresas", async () => {
    const antigo = await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c1", numero: "CT-ANTIGO", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 900, dataInicio: new Date() } });
    await ct.comissoesDoContratoNoStatus("e1", antigo.id, null, "ATIVO");
    logar("uAdm");
    expect((await status(antigo.id, "SUSPENSO")).status).toBe(200);
    expect((await status(antigo.id, "ATIVO")).status).toBe(200);
    expect(await prisma.comissao.count({ where: { contratoId: antigo.id } })).toBe(0);
    // A outra empresa: a regra dela (50%, 1 mês) só para o contrato dela
    logar("uB");
    const r = await chamar("contratos", "POST", {}, { clienteId: "c2", numero: "CT-OUTRA", tipo: "LOCACAO", status: "ATIVO", valorMensal: 400, dataInicio: hoje(), diaFaturamento: 10 });
    expect(r.status).toBe(201);
    const cs = await comissoes(r.json.id);
    expect(cs.map((c: any) => [c.empresaId, c.usuarioId, Number(c.valor)])).toEqual([["e2", "uB", 200]]);
    // A regra de Locação da e1 (cargo de outra empresa) não chega na e2; e o extrato de cada um é só dele
    expect(await prisma.comissao.count({ where: { empresaId: "e2", NOT: { usuarioId: "uB" } } })).toBe(0);
    const ext = await chamar("perfil/comissoes", "GET");
    expect(ext.json.vendas.every((v: any) => v.cliente === "Padaria da Outra")).toBe(true);
    // Trocar o vendedor de um contrato de outra empresa: não encontrado
    expect((await chamar("contratos/[id]/vendedor", "PATCH", { id: antigo.id }, { vendedorId: "uB", motivo: "Tentativa fictícia" })).status).toBe(404);
  });

  it("fechamento do mês e relatório: o liberado do contrato entra como as demais comissões (uma linha por pessoa)", async () => {
    const movs = await srv.movimentosAbertos("e1", COMP(0));
    const doContrato = movs.filter((m) => m.usuarioId === "uV");
    expect(doContrato.length).toBeGreaterThan(0);
    const mes = srv.comissoesDoMes(movs);
    expect(mes.pessoas.find((p) => p.usuarioId === "uV")?.valor).toBeGreaterThan(0);
    const rel = await srv.relatorioDeComissoes("e1", COMP(0), "RECEBIMENTO");
    const vitor = rel.pessoas.find((p) => p.usuarioId === "uV");
    expect(vitor?.vendas.some((v) => v.chave.startsWith("ct:") && v.nome === "Contrato" && v.valor > 0)).toBe(true);
    // O Vitor só tem comissão de contrato: nada dela vira linha de venda ou de OS no relatório
    expect(vitor?.vendas.every((v) => v.chave.startsWith("ct:"))).toBe(true);
    // A vista "por emissão" mostra o contrato do mesmo jeito (o gatilho do contrato é sempre o recebimento)
    const relE = await srv.relatorioDeComissoes("e1", COMP(0), "EMISSAO");
    expect(relE.pessoas.find((p) => p.usuarioId === "uV")?.vendas.filter((v) => v.chave.startsWith("ct:")).length)
      .toBe(vitor?.vendas.filter((v) => v.chave.startsWith("ct:")).length);
  });
});
