/**
 * Contrato recorrente — PR3-B: etapas NFS-e (C) e boleto (D) da rotina. PostgreSQL real, rotas e
 * funções reais; PlugNotas simulado no `fetch`, Banco Inter e e-mail simulados. Prova:
 *  - NFS-e "pelo sistema": empresa do contrato, ambiente da empresa (Homologação; Produção só com
 *    NFSE_EMISSAO_PRODUCAO=liberada); nota viva não deixa sair outra (nem da rotina, nem com a tela);
 *  - pendência (serviço, emitente, Produção fechada) não emite: PENDENCIA com o texto, no sino;
 *    corrigido, a rodada seguinte emite sozinha;
 *  - autorizada (aviso do PlugNotas ou reconciliação) → na hora, boleto Inter de cada cobrança que
 *    pode receber boleto + e-mail ao cliente; não aceita → PENDENCIA com o motivo; "Tentar de novo" emite outra;
 *  - boleto sozinho espera a NF feita à mão; conta com boleto/em perda fica de fora; Inter desligado =
 *    pendência; Inter fora = 3 tentativas; e-mail que não sai = pendência e "Tentar de novo" só reenvia;
 *  - concorrência: rodadas + tela ao mesmo tempo → 1 nota; aviso + rodada + rota do boleto → 1 boleto;
 *  - RBAC das chaves: NFS-e pede Fiscal; boleto pede Contas a receber; a tela mostra NF e boleto com links.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/contrato-recorrente-pr3b-pg
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pr3b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const TOKEN = "tok-sandbox-SEGREDO-pr3b";
const BASE = "https://api.sandbox.plugnotas.com.br";
const SEGREDO = "a".repeat(64);

const sessao = vi.hoisted(() => ({ atual: null as any }));
const email = vi.hoisted(() => ({ boleto: [] as string[], respostaBoleto: { ok: true } as { ok: boolean; erro?: string } }));
const inter = vi.hoisted(() => ({ n: 0, ativo: true, falha: null as string | null, atraso: 0 }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({
  enviarMedicao: vi.fn(async () => ({ ok: true })), enviarConfirmacaoPagamento: vi.fn(async () => {}),
  enviarBoleto: vi.fn(async (id: string) => { email.boleto.push(id); return email.respostaBoleto; }),
}));
vi.mock("@/lib/inter-api", () => ({
  carregarConfigInter: vi.fn(async () => ({ ativo: inter.ativo, config: inter.ativo ? {} : null })),
  emitirBoletoInter: vi.fn(async () => {
    if (inter.atraso) await new Promise((r) => setTimeout(r, inter.atraso));
    if (inter.falha) throw new Error(inter.falha);
    inter.n++;
    return { codigoSolicitacao: `cs-${inter.n}`, nossoNumero: `nn-${inter.n}`, codigoBarras: `0779${inter.n}`, linhaDigitavel: `0779 ${inter.n}` };
  }),
  cancelarBoletoInter: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

/* ───────── PlugNotas simulado ───────── */
const pn = vi.hoisted(() => ({ notas: new Map<string, any>(), envios: 0, seq: 0, atrasoEnvio: 0, aoConsultarCep: null as null | (() => Promise<unknown>) }));
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
async function fetchFalso(entrada: string | URL, init?: RequestInit) {
  const url = String(entrada);
  if (url.startsWith("https://viacep.com.br/")) {
    // Gancho de teste: algo acontece no meio da preparação da emissão (uma só vez)
    const f = pn.aoConsultarCep; pn.aoConsultarCep = null;
    if (f) await f();
    return resposta(200, { ibge: "5220454", localidade: "Senador Canedo", uf: "GO" });
  }
  const chave = new Headers(init?.headers).get("x-api-key");
  if (chave !== TOKEN) return resposta(401, { error: { message: "Unauthorized" } });
  const caminho = url.replace(BASE, "");
  if ((init?.method ?? "GET") === "POST" && caminho === "/nfse") {
    pn.envios++;
    if (pn.atrasoEnvio) await new Promise((r) => setTimeout(r, pn.atrasoEnvio));
    const corpo = JSON.parse(String(init!.body));
    const docs = corpo.map((n: any) => {
      const id = `pn${String(++pn.seq).padStart(4, "0")}`;
      pn.notas.set(id, { id, idIntegracao: n.idIntegracao, situacao: "PROCESSANDO" });
      return { idIntegracao: n.idIntegracao, prestador: n.prestador.cpfCnpj, id };
    });
    return resposta(200, { documents: docs, message: "Nota(as) em processamento", protocol: `prot-${pn.seq}` });
  }
  let m: RegExpMatchArray | null;
  if ((m = caminho.match(/^\/nfse\/consultar\/([^/]+)$/))) {
    const n = pn.notas.get(decodeURIComponent(m[1]));
    return n ? resposta(200, [{ ...n, emissao: "10/11/2026" }]) : resposta(404, { error: { message: "Nota não encontrada" } });
  }
  return resposta(404, { error: { message: "rota desconhecida" } });
}
const situar = (id: string, s: Record<string, unknown>) => pn.notas.set(id, { ...pn.notas.get(id), ...s });

const ADMIN = () => ({ user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } });
const logar = (s = ADMIN()) => { sessao.atual = s; };
const usuario = (perms: Record<string, string[]>) =>
  ({ user: { id: "uU", name: "Uli", email: "uli@x.com", empresaId: "e1", role: "OPERADOR", permissoes: montarPermissoes(perms as any), tecnicoId: null } });

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

vi.setConfig({ testTimeout: 90_000 });
const em = (iso: string) => vi.setSystemTime(new Date(iso));

describe.skipIf(!URL_PG)("Contrato recorrente PR3-B — NFS-e e boleto automáticos (PostgreSQL real)", () => {
  let prisma: any;
  let rotina: typeof import("@/lib/faturamento/rotina-contratos-server");
  let ws: typeof import("@/lib/nfse/webhook-server");
  let emissao: typeof import("@/lib/nfse/emissao-server");
  let boletoServer: typeof import("@/lib/financeiro/boleto-server");
  let seq = 0;
  let cliSeq = 0;

  /** CNPJ válido (dígitos verificadores) e diferente por cliente */
  const cnpj = (n: number) => {
    const base = `${String(11222333 + n).padStart(8, "0")}0001`.split("").map(Number);
    const dv = (ds: number[]) => { const p = ds.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = ds.reduce((a, d, i) => a + d * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
    const d1 = dv(base); const d2 = dv([...base, d1]);
    return [...base, d1, d2].join("");
  };
  /** Cliente com cadastro completo (tomador da NFS-e sem pendência) */
  const novoCliente = async () => {
    const id = `c${++cliSeq}`;
    await prisma.cliente.create({ data: {
      id, empresaId: "e1", nome: `Condomínio ${cliSeq}`, cpfCnpj: cnpj(cliSeq), email: `fin${cliSeq}@x.com`, diaFaturamento: 10,
      endereco: "Av. Goiás", numero: "100", bairro: "Centro", cidade: "Senador Canedo", estado: "GO", cep: "75250-000",
    } });
    return id;
  };
  const criar = async (dados: Record<string, unknown> = {}) => {
    const clienteId = (dados.clienteId as string) ?? await novoCliente();
    const b = {
      clienteId, numero: `CT-B${String(++seq).padStart(2, "0")}`, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 1000,
      dataInicio: "2026-09-01", dataFim: "2027-08-31", diaFaturamento: 10, servicoId: "sHig",
      faturamentoAutomatico: true, aprovacaoAutomatica: true, emitirNfseAuto: true, emitirBoletoAuto: true, ...dados,
    };
    const r = await chamar("contratos", "POST", {}, b);
    expect(r.status).toBe(201);
    return { id: r.json.id as string, numero: b.numero, body: b as Record<string, unknown>, clienteId };
  };
  const editar = (ct: { id: string; body: Record<string, unknown> }, mudar: Record<string, unknown>) => {
    ct.body = { ...ct.body, ...mudar };
    return chamar("contratos/[id]", "PUT", { id: ct.id }, ct.body);
  };
  const execucao = (contratoId: string, refAno = 2026, refMes = 11) =>
    prisma.faturamentoContratoExecucao.findUnique({ where: { contratoId_refAno_refMes: { contratoId, refAno, refMes } } });
  const notasDo = (contratoId: string) => prisma.notaFiscal.findMany({ where: { medicao: { contratoId } }, orderBy: { criadoEm: "asc" } });
  const contasDo = (contratoId: string) => prisma.contaReceber.findMany({ where: { contratoId, refAno: 2026, refMes: 11 } });
  const rodar = (agora?: Date) => rotina.rodarFaturamentoContratos(agora ? { agora } : {});
  /** O aviso do PlugNotas (webhook) com o segredo da empresa */
  const aviso = (corpo: unknown, agora = new Date()) => ws.receberAviso(SEGREDO, corpo, agora);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    rotina = await import("@/lib/faturamento/rotina-contratos-server");
    ws = await import("@/lib/nfse/webhook-server");
    emissao = await import("@/lib/nfse/emissao-server");
    boletoServer = await import("@/lib/financeiro/boleto-server");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com", cnaePrincipal: "4322302" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uU", empresaId: "e1", nome: "Uli", email: "uli@x.com", senha: "x", role: "OPERADOR" },
    ] });
    await prisma.configuracao.create({ data: { empresaId: "e1", issAliquota: 3.5 } });
    await prisma.empresaFiscal.create({ data: {
      empresaId: "e1", emitenteCnpj: "12345678000190", regimeTributario: "SIMPLES_NACIONAL", ambiente: "HOMOLOGACAO", status: "ATIVO",
      emitenteAmbiente: "HOMOLOGACAO", codigoMunicipio: "5220454", municipioNome: "Senador Canedo", municipioUf: "GO",
      webhookTokenHash: createHash("sha256").update(SEGREDO).digest("hex"),
    } });
    await prisma.servico.create({ data: { id: "sHig", empresaId: "e1", nome: "Higienização", codigoLc116: "14.01", codigoMunicipal: "140101", aliquotaISS: 5 } });
    vi.useFakeTimers({ toFake: ["Date"] });
    em("2026-11-10T11:23:00.000Z");
    logar();
  }, 240_000);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(fetchFalso));
    vi.stubEnv("PLUGNOTAS_API_TOKEN", TOKEN);
    vi.stubEnv("PLUGNOTAS_API_URL", "");
    email.boleto = []; email.respostaBoleto = { ok: true };
    inter.ativo = true; inter.falha = null; inter.atraso = 0;
    pn.atrasoEnvio = 0;
    logar();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("fluxo inteiro em Homologação: aprova → NFS-e pelo sistema → autorizada (aviso) → boleto + e-mail na hora → concluída; rodar de novo não emite nada", async () => {
    const a = await criar();
    const enviosAntes = pn.envios;
    await rodar();
    const [nota] = await notasDo(a.id);
    expect([nota.status, nota.ambiente, nota.emitidaPorId, nota.origem]).toEqual(["PROCESSANDO", "HOMOLOGACAO", null, "MEDICAO"]);
    expect(pn.envios - enviosAntes).toBe(1);
    let ex = await execucao(a.id);
    expect([ex.etapa, ex.situacao, ex.erro]).toEqual(["NFSE", "AGUARDANDO", null]);
    // A rodada seguinte (prefeitura ainda processando) não emite outra
    await rodar();
    expect(pn.envios - enviosAntes).toBe(1);
    expect(await notasDo(a.id)).toHaveLength(1);
    // Na tela: a NF "na prefeitura"; a conta ainda é previsão (sem NF não se cobra) → nada na coluna do boleto
    const antes = await chamar("faturamento-contratos", "GET", {}, undefined, "http://localhost/api/faturamento-contratos?ano=2026&mes=11");
    const l0 = antes.json.linhas.find((l: any) => l.contratoId === a.id);
    expect([l0.execucao.nf, l0.execucao.cobrancas, (await contasDo(a.id))[0].status]).toEqual([{ numero: null, situacao: "PREFEITURA" }, [], "PREVISTO"]);

    // A prefeitura autoriza; o aviso do PlugNotas chega → a execução segue na hora: boleto + e-mail
    situar(nota.plugnotasId, { situacao: "CONCLUIDO", numeroNfse: "4321", codigoVerificacao: "AB-12" });
    const r = await aviso({ id: nota.plugnotasId }, new Date("2026-11-10T11:30:00.000Z"));
    expect(r!.consultadas).toBe(1);
    ex = await execucao(a.id);
    expect([ex.etapa, ex.situacao, ex.erro]).toEqual(["CONCLUIDA", "CONCLUIDA", null]);
    const [conta] = await contasDo(a.id);
    expect([conta.status, conta.boletoStatus, conta.boletoNossoNumero]).toEqual(["A_RECEBER", "EMITIDO", `nn-${inter.n}`]);
    expect(email.boleto).toEqual([conta.id]);
    const evento = await prisma.contaReceberEvento.findFirst({ where: { contaReceberId: conta.id, tipo: "BOLETO_EMITIDO" } });
    expect([evento.usuarioId, evento.detalhe.endsWith("pela rotina do contrato")]).toEqual([null, true]);
    expect((await prisma.medicao.findUnique({ where: { id: ex.medicaoId } })).status).toBe("NF_EMITIDA");

    // Nada mais acontece: nem nota, nem boleto
    const nInter = inter.n;
    await rodar();
    expect([pn.envios - enviosAntes, inter.n, email.boleto.length]).toEqual([1, nInter, 1]);

    // A tela mostra a NF e o boleto, com links
    const tela = await chamar("faturamento-contratos", "GET", {}, undefined, "http://localhost/api/faturamento-contratos?ano=2026&mes=11");
    const linha = tela.json.linhas.find((l: any) => l.contratoId === a.id);
    expect([linha.execucao.nf, linha.execucao.cobrancas]).toEqual([{ numero: "4321", situacao: "AUTORIZADA" }, [{ id: conta.id, numero: conta.numero, boleto: "EMITIDO" }]]);
  });

  it("pendência não emite: sem serviço na nota → PENDENCIA com o texto da pendência, no sino; corrigido, a rodada seguinte emite sozinha", async () => {
    const b = await criar({ servicoId: null });
    const antes = pn.envios;
    await rodar();
    let ex = await execucao(b.id);
    expect([ex.etapa, ex.situacao]).toEqual(["NFSE", "PENDENCIA"]);
    expect(ex.erro).toMatch(/^Para a NFS-e sair: .*escolha o serviço do catálogo/);
    expect(pn.envios).toBe(antes);
    expect((await chamar("alertas", "GET")).json.faturamentoContratos).toBeGreaterThanOrEqual(1);
    // Corrige o item (a tela de emissão faz o mesmo)
    const medicao = await prisma.medicao.findUnique({ where: { id: ex.medicaoId }, include: { itens: true } });
    await emissao.vincularServicoItem("e1", medicao.id, medicao.itens[0].id, "sHig");
    em("2026-11-11T11:23:00.000Z");
    await rodar();
    ex = await execucao(b.id);
    expect([ex.etapa, ex.situacao, ex.erro]).toEqual(["NFSE", "AGUARDANDO", null]);
    expect(pn.envios).toBe(antes + 1);
  });

  it("Produção: empresa em Produção sem a liberação → pendência; com NFSE_EMISSAO_PRODUCAO=liberada → emite em Produção", async () => {
    em("2026-11-10T11:23:00.000Z");
    await prisma.empresaFiscal.update({ where: { empresaId: "e1" }, data: { ambiente: "PRODUCAO", emitenteAmbiente: "PRODUCAO" } });
    vi.stubEnv("PLUGNOTAS_API_TOKEN_PRODUCAO", TOKEN);
    vi.stubEnv("PLUGNOTAS_API_URL_PRODUCAO", BASE);
    try {
      const p = await criar();
      const antes = pn.envios;
      await rodar();
      let ex = await execucao(p.id);
      expect([ex.situacao, ex.erro]).toEqual(["PENDENCIA", "Para a NFS-e sair: A emissão em Produção ainda não está liberada: nesta fase as notas saem só em Homologação (testes)."]);
      expect(pn.envios).toBe(antes);
      vi.stubEnv("NFSE_EMISSAO_PRODUCAO", "liberada");
      const t = await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id });
      expect(t.json.execucao.situacao).toBe("AGUARDANDO");
      const [nota] = await notasDo(p.id);
      expect([nota.ambiente, nota.status]).toEqual(["PRODUCAO", "PROCESSANDO"]);
    } finally {
      await prisma.empresaFiscal.update({ where: { empresaId: "e1" }, data: { ambiente: "HOMOLOGACAO", emitenteAmbiente: "HOMOLOGACAO" } });
    }
  });

  it("não aceita (reconciliação) → PENDENCIA com o motivo no sino; não emite outra sozinha; \"Tentar de novo\" emite outra", async () => {
    em("2026-11-10T11:23:00.000Z");
    const r = await criar();
    await rodar();
    const [nota] = await notasDo(r.id);
    situar(nota.plugnotasId, { situacao: "REJEITADO", mensagem: "Código de serviço inválido." }); // o ponto final da prefeitura não dobra
    // Reconciliação (cron): a nota espera há mais de 2 min
    await ws.reconciliarNotas({ empresaId: "e1" }, new Date("2026-11-10T11:40:00.000Z"));
    let ex = await execucao(r.id);
    expect([ex.etapa, ex.situacao]).toEqual(["NFSE", "PENDENCIA"]);
    expect(ex.erro).toBe('A prefeitura não aceitou a NFS-e: Código de serviço inválido. Corrija e use "Tentar de novo".');
    const antes = pn.envios;
    em("2026-11-11T11:23:00.000Z");
    await rodar();
    expect(pn.envios).toBe(antes); // não insiste sozinha
    const t = await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id });
    expect([t.status, t.json.execucao.situacao]).toEqual([200, "AGUARDANDO"]);
    expect(pn.envios).toBe(antes + 1);
    expect((await notasDo(r.id)).map((n: any) => n.status)).toEqual(["REJEITADO", "PROCESSANDO"]);
  });

  it("nota viva da tela: alguém emitiu pela tela antes da rodada → a rotina não emite outra e segue quando a nota é autorizada", async () => {
    em("2026-11-10T11:23:00.000Z");
    const t = await criar({ emitirNfseAuto: false, emitirBoletoAuto: false });
    await rodar(); // aprova e conclui (sem NFS-e automática)
    const ex0 = await execucao(t.id);
    expect(ex0.situacao).toBe("CONCLUIDA");
    // Outro contrato: NFS-e automática, mas a pessoa emite pela tela no meio
    const v = await criar({ emitirBoletoAuto: false, aprovacaoAutomatica: true });
    const aprovacao = await prisma.faturamentoContratoExecucao.create({ data: { empresaId: "e1", contratoId: v.id, refAno: 2026, refMes: 11 } });
    // A rotina cria a medição e aprova; a NFS-e sai pela tela antes da etapa C (simulado: tira a chave, roda, devolve)
    await prisma.contrato.update({ where: { id: v.id }, data: { emitirNfseAuto: false } });
    await rotina.processarExecucao(aprovacao.id);
    const exV = await execucao(v.id);
    await emissao.emitirNotas({ id: "uA", empresaId: "e1" }, exV.medicaoId, { origem: "MEDICAO" });
    await prisma.contrato.update({ where: { id: v.id }, data: { emitirNfseAuto: true } });
    await prisma.faturamentoContratoExecucao.update({ where: { id: aprovacao.id }, data: { etapa: "NFSE", situacao: "PENDENTE", concluidaEm: null } });
    const antes = pn.envios;
    await rotina.processarExecucao(aprovacao.id);
    expect(pn.envios).toBe(antes);
    expect([(await execucao(v.id)).situacao, (await notasDo(v.id)).length]).toEqual(["AGUARDANDO", 1]);
    const [nota] = await notasDo(v.id);
    situar(nota.plugnotasId, { situacao: "CONCLUIDO", numeroNfse: "77" });
    await aviso({ id: nota.plugnotasId });
    expect((await execucao(v.id)).situacao).toBe("CONCLUIDA"); // sem boleto automático: acaba na NF
  });

  it("concorrência: duas rodadas e a emissão da tela ao mesmo tempo → uma nota só", async () => {
    em("2026-11-10T11:23:00.000Z");
    const c = await criar({ emitirBoletoAuto: false });
    const ex = await prisma.faturamentoContratoExecucao.create({ data: { empresaId: "e1", contratoId: c.id, refAno: 2026, refMes: 11 } });
    // Chega até a NFS-e sem emitir: deixa a chave desligada só para a aprovação
    await prisma.contrato.update({ where: { id: c.id }, data: { emitirNfseAuto: false } });
    await rotina.processarExecucao(ex.id);
    await prisma.contrato.update({ where: { id: c.id }, data: { emitirNfseAuto: true } });
    await prisma.faturamentoContratoExecucao.update({ where: { id: ex.id }, data: { etapa: "NFSE", situacao: "PENDENTE", concluidaEm: null } });
    const medicaoId = (await execucao(c.id)).medicaoId;
    pn.atrasoEnvio = 50;
    const rs = await Promise.allSettled([
      rodar(), rodar(),
      emissao.emitirNotas({ id: "uA", empresaId: "e1" }, medicaoId, { origem: "MEDICAO" }),
    ]);
    pn.atrasoEnvio = 0;
    const vivas = (await notasDo(c.id)).filter((n: any) => ["ENVIANDO", "PROCESSANDO", "CONCLUIDO"].includes(n.status));
    expect(vivas).toHaveLength(1);
    // Quem perdeu a corrida recebeu "outra emissão começou" (a tela) ou ficou esperando (a rotina)
    const falhas = rs.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    for (const f of falhas) expect(f.reason.message).toBe("Outra emissão desta medição acabou de começar. Atualize a tela.");
    expect(["AGUARDANDO"]).toContain((await execucao(c.id)).situacao);
  });

  it("boleto sozinho: espera a NF feita à mão; emite para a conta liberada; a que já tem boleto fica de fora; aviso + rodada + rota ao mesmo tempo → um boleto", async () => {
    em("2026-11-10T11:23:00.000Z");
    const d = await criar({ emitirNfseAuto: false });
    await rodar();
    let ex = await execucao(d.id);
    expect([ex.etapa, ex.situacao]).toEqual(["BOLETO", "AGUARDANDO"]); // espera a NF
    const nInter = inter.n;
    // NF registrada à mão → a conta libera; a rota do boleto e a rodada disputam a conta
    expect((await chamar("medicoes/[id]/acao", "POST", { id: ex.medicaoId }, { acao: "REGISTRAR_NF", nfNumero: "555" })).status).toBe(200);
    const [conta] = await contasDo(d.id);
    expect(conta.status).toBe("A_RECEBER");
    inter.atraso = 40;
    const rs = await Promise.all([
      rodar(), rodar(),
      chamar("contas-receber/[id]/boleto", "POST", { id: conta.id }, {}),
      boletoServer.emitirBoletoDaConta("e1", conta.id, { usuarioId: "uA" }).then(() => "ok", (e) => e.message),
    ]);
    inter.atraso = 0;
    expect(inter.n - nInter).toBe(1);
    const recusas = [rs[2].status === 201 ? null : rs[2].json.erro, rs[3] === "ok" ? null : rs[3]].filter(Boolean);
    for (const r of recusas) expect(r).toBe("Já existe um boleto emitido para esta conta.");
    ex = await execucao(d.id);
    expect([ex.etapa, ex.situacao]).toEqual(["CONCLUIDA", "CONCLUIDA"]);
    expect((await prisma.contaReceber.findUnique({ where: { id: conta.id } })).boletoStatus).toBe("EMITIDO");
    // A tela mostra a NF manual
    const tela = await chamar("faturamento-contratos", "GET", {}, undefined, "http://localhost/api/faturamento-contratos?ano=2026&mes=11");
    expect(tela.json.linhas.find((l: any) => l.contratoId === d.id).execucao.nf).toEqual({ numero: "555", situacao: "MANUAL" });
  });

  it("boleto: Inter desligado = pendência; Inter fora = 3 tentativas (1/dia) e FALHA; conta em perda fica de fora", async () => {
    em("2026-11-10T11:23:00.000Z");
    const f = await criar({ emitirNfseAuto: false });
    await rodar();
    const ex0 = await execucao(f.id);
    expect((await chamar("medicoes/[id]/acao", "POST", { id: ex0.medicaoId }, { acao: "REGISTRAR_NF", nfNumero: "601" })).status).toBe(200);
    inter.ativo = false;
    await rodar();
    let ex = await execucao(f.id);
    expect([ex.situacao, ex.erro]).toEqual(["PENDENCIA", 'O Banco Inter não está configurado/ativo: o boleto não sai. Configure em Configurações › Integrações e use "Tentar de novo".']);
    inter.ativo = true;
    inter.falha = "Inter fora do ar (503)";
    await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id });
    ex = await execucao(f.id);
    expect([ex.situacao, ex.tentativas, ex.erro]).toEqual(["PENDENTE", 1, "Inter fora do ar (503)"]);
    em("2026-11-11T11:23:00.000Z"); await rodar();
    em("2026-11-12T11:23:00.000Z"); await rodar();
    ex = await execucao(f.id);
    expect([ex.situacao, ex.tentativas]).toEqual(["FALHA", 3]);
    expect((await contasDo(f.id))[0].boletoStatus).toBeNull();
    // A conta vai para perda: no "Tentar de novo" ela fica de fora (não pode receber boleto) e a etapa acaba
    inter.falha = null;
    const [conta] = await contasDo(f.id);
    await prisma.contaReceber.update({ where: { id: conta.id }, data: { status: "PERDA" } });
    const nInter = inter.n;
    await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id });
    expect([(await execucao(f.id)).situacao, inter.n]).toEqual(["CONCLUIDA", nInter]);
  });

  it("e-mail do boleto que não sai: pendência no sino; \"Tentar de novo\" só reenvia o e-mail (não emite outro boleto); empresa que desligou o e-mail não vira pendência", async () => {
    em("2026-11-10T11:23:00.000Z");
    const g = await criar({ emitirNfseAuto: false });
    await rodar();
    const ex0 = await execucao(g.id);
    email.respostaBoleto = { ok: false, erro: "Destinatário sem e-mail." };
    expect((await chamar("medicoes/[id]/acao", "POST", { id: ex0.medicaoId }, { acao: "REGISTRAR_NF", nfNumero: "701" })).status).toBe(200);
    const nInter = inter.n;
    await rodar();
    let ex = await execucao(g.id);
    const [conta] = await contasDo(g.id);
    expect([ex.situacao, ex.erro]).toEqual(["PENDENCIA", `Boleto emitido, mas o e-mail não saiu (${conta.numero}: Destinatário sem e-mail.). Mande pela conta a receber ou use "Tentar de novo".`]);
    expect(inter.n - nInter).toBe(1);
    // A rodada seguinte não reenvia sozinha, e a pendência continua (não vira "Concluída" sem o e-mail)
    em("2026-11-11T11:23:00.000Z"); await rodar();
    expect(email.boleto.filter((id) => id === conta.id)).toHaveLength(1);
    expect((await execucao(g.id)).situacao).toBe("PENDENCIA");
    // Um e-mail ANTIGO da conta (antes deste boleto) não conta como o e-mail do boleto
    const emitidoEm = (await prisma.contaReceber.findUnique({ where: { id: conta.id } })).boletoEmitidoEm;
    await prisma.emailLog.create({ data: { empresaId: "e1", para: "fin@x.com", assunto: "Cobrança antiga", referenciaId: conta.id, referenciaTipo: "ContaReceber", status: "ENVIADO", enviadoEm: new Date(emitidoEm.getTime() - 86_400_000) } });
    em("2026-11-12T11:23:00.000Z"); await rodar();
    expect((await execucao(g.id)).situacao).toBe("PENDENCIA");
    // Corrigido o cadastro: "Tentar de novo" reenvia só o e-mail
    email.respostaBoleto = { ok: true };
    await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id });
    ex = await execucao(g.id);
    expect([ex.situacao, inter.n - nInter, email.boleto.filter((id) => id === conta.id).length]).toEqual(["CONCLUIDA", 1, 2]);

    // E-mail que não saiu, mandado depois à mão pela conta: "Tentar de novo" conclui sem mandar outro
    email.respostaBoleto = { ok: false, erro: "Destinatário sem e-mail." };
    const k = await criar({ emitirNfseAuto: false });
    await rodar();
    const exK0 = await execucao(k.id);
    expect((await chamar("medicoes/[id]/acao", "POST", { id: exK0.medicaoId }, { acao: "REGISTRAR_NF", nfNumero: "703" })).status).toBe(200);
    await rodar();
    const exK = await execucao(k.id);
    const [contaK] = await contasDo(k.id);
    expect(exK.situacao).toBe("PENDENCIA");
    await prisma.emailLog.create({ data: { empresaId: "e1", para: "fin@x.com", assunto: "Boleto", referenciaId: contaK.id, referenciaTipo: "ContaReceber", status: "ENVIADO", enviadoEm: new Date(Date.now() + 60_000) } });
    const enviosK = email.boleto.filter((id) => id === contaK.id).length;
    await chamar("faturamento-contratos/[id]/tentar", "POST", { id: exK.id });
    expect([(await execucao(k.id)).situacao, email.boleto.filter((id) => id === contaK.id).length]).toEqual(["CONCLUIDA", enviosK]);

    // Empresa desligou o e-mail de boleto: não é pendência
    const h = await criar({ emitirNfseAuto: false });
    await rodar();
    const exH = await execucao(h.id);
    email.respostaBoleto = { ok: false, erro: "Notificação desativada." };
    expect((await chamar("medicoes/[id]/acao", "POST", { id: exH.medicaoId }, { acao: "REGISTRAR_NF", nfNumero: "702" })).status).toBe(200);
    await rodar();
    expect((await execucao(h.id)).situacao).toBe("CONCLUIDA");
  });

  it("a tela emite o boleto (com o nome de quem clicou) antes da rodada: a rotina não emite outro e conclui", async () => {
    em("2026-11-10T11:23:00.000Z");
    const t = await criar({ emitirNfseAuto: false });
    await rodar();
    const ex0 = await execucao(t.id);
    expect((await chamar("medicoes/[id]/acao", "POST", { id: ex0.medicaoId }, { acao: "REGISTRAR_NF", nfNumero: "801" })).status).toBe(200);
    const [conta] = await contasDo(t.id);
    const nInter = inter.n;
    expect((await chamar("contas-receber/[id]/boleto", "POST", { id: conta.id }, {})).status).toBe(201);
    const evento = await prisma.contaReceberEvento.findFirst({ where: { contaReceberId: conta.id, tipo: "BOLETO_EMITIDO" } });
    expect([evento.usuarioId, evento.detalhe.includes("pela rotina")]).toEqual(["uA", false]);
    await rodar();
    expect([(await execucao(t.id)).situacao, inter.n - nInter]).toEqual(["CONCLUIDA", 1]);
  });

  it("boleto sozinho + NFS-e emitida pela tela: a autorização (aviso) já leva ao boleto, sem esperar a rodada", async () => {
    em("2026-11-10T11:23:00.000Z");
    const t = await criar({ emitirNfseAuto: false });
    await rodar();
    const ex0 = await execucao(t.id);
    expect([ex0.etapa, ex0.situacao]).toEqual(["BOLETO", "AGUARDANDO"]);
    await emissao.emitirNotas({ id: "uA", empresaId: "e1" }, ex0.medicaoId, { origem: "MEDICAO" });
    const [nota] = await notasDo(t.id);
    situar(nota.plugnotasId, { situacao: "CONCLUIDO", numeroNfse: "880" });
    const nInter = inter.n;
    await aviso({ id: nota.plugnotasId });
    const ex = await execucao(t.id);
    expect([ex.etapa, ex.situacao, inter.n - nInter, (await contasDo(t.id))[0].boletoStatus]).toEqual(["CONCLUIDA", "CONCLUIDA", 1, "EMITIDO"]);
  });

  it("parcelas: cada parcela ganha o seu boleto; a tela lista as parcelas (não o lançamento parcelado)", async () => {
    em("2026-11-10T11:23:00.000Z");
    const t = await criar({ emitirNfseAuto: false });
    await rodar();
    const ex0 = await execucao(t.id);
    expect((await chamar("medicoes/[id]/acao", "POST", { id: ex0.medicaoId }, { acao: "REGISTRAR_NF", nfNumero: "901" })).status).toBe(200);
    const [conta] = await contasDo(t.id);
    const metade = Math.round(Number(conta.valor) * 50) / 100;
    const resto = Math.round((Number(conta.valor) - metade) * 100) / 100;
    const parc = await chamar("contas-receber/[id]/parcelar", "POST", { id: conta.id }, { parcelas: [{ vencimento: "2026-11-20", valor: metade }, { vencimento: "2026-12-20", valor: resto }] });
    expect(parc.status).toBeLessThan(300);
    const nInter = inter.n;
    await rodar();
    expect([(await execucao(t.id)).situacao, inter.n - nInter]).toEqual(["CONCLUIDA", 2]);
    const parcelas = await prisma.contaReceber.findMany({ where: { lancamentoId: conta.id }, orderBy: { parcelaNumero: "asc" } });
    expect(parcelas.map((p: any) => p.boletoStatus)).toEqual(["EMITIDO", "EMITIDO"]);
    const tela = await chamar("faturamento-contratos", "GET", {}, undefined, "http://localhost/api/faturamento-contratos?ano=2026&mes=11");
    const linha = tela.json.linhas.find((l: any) => l.contratoId === t.id);
    expect(linha.execucao.cobrancas.map((c: any) => [c.id, c.boleto])).toEqual(parcelas.map((p: any) => [p.id, "EMITIDO"]));
  });

  it("NFS-e: medição cancelada no meio encerra; cliente que exige pedido de compra espera o PC (sem emitir, sem sino)", async () => {
    em("2026-11-10T11:23:00.000Z");
    const x = await criar({ servicoId: null });
    await rodar();
    let ex = await execucao(x.id);
    expect([ex.etapa, ex.situacao]).toEqual(["NFSE", "PENDENCIA"]);
    const m = await prisma.medicao.findUnique({ where: { id: ex.medicaoId } });
    await prisma.medicao.update({ where: { id: m.id }, data: { status: "CANCELADA" } });
    em("2026-11-11T11:23:00.000Z");
    await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id });
    ex = await execucao(x.id);
    expect([ex.situacao, ex.erro]).toEqual(["CANCELADA", `A medição ${m.numero} foi cancelada.`]);

    em("2026-11-10T11:23:00.000Z");
    const cliPc = await novoCliente();
    await prisma.cliente.update({ where: { id: cliPc }, data: { exigePcAntesNf: true } });
    const y = await criar({ clienteId: cliPc });
    const antes = pn.envios;
    await rodar();
    const exY = await execucao(y.id);
    expect([exY.etapa, exY.situacao, exY.erro, pn.envios - antes, (await notasDo(y.id)).length]).toEqual(["NFSE", "AGUARDANDO", null, 0, 0]);
    expect((await prisma.medicao.findUnique({ where: { id: exY.medicaoId } })).status).toBe("AGUARDANDO_PC");
  });

  it("corrida certa: a tela emite no meio da preparação da rotina → a rotina recebe \"outra emissão começou\" e espera (sem contar tentativa, sem nota em dobro)", async () => {
    em("2026-11-10T11:23:00.000Z");
    // Cliente fora do município da empresa: a emissão consulta o CEP (é aí que a tela entra)
    const cli = await novoCliente();
    await prisma.cliente.update({ where: { id: cli }, data: { cidade: "Goiânia", cep: "74000-000" } });
    const z = await criar({ clienteId: cli, emitirBoletoAuto: false });
    let daTela: unknown = null;
    pn.aoConsultarCep = async () => {
      const ex = await execucao(z.id);
      daTela = await emissao.emitirNotas({ id: "uA", empresaId: "e1" }, ex.medicaoId, { origem: "MEDICAO" }).then(() => "ok", (e) => e.message);
    };
    const antes = pn.envios;
    await rodar();
    pn.aoConsultarCep = null;
    expect(daTela).toBe("ok");
    const ex = await execucao(z.id);
    expect([ex.etapa, ex.situacao, ex.tentativas, ex.erro, pn.envios - antes, (await notasDo(z.id)).length]).toEqual(["NFSE", "AGUARDANDO", 0, null, 1, 1]);
  });

  it("RBAC das chaves: NFS-e automática pede Fiscal; boleto automático pede Contas a receber; só Medições não liga nenhuma das duas", async () => {
    const base = await criar({ emitirNfseAuto: false, emitirBoletoAuto: false });
    logar(usuario({ contratos: ["visualizar", "editar"], financeiro: ["visualizar", "medicoes"] }));
    let r = await editar(base, { emitirNfseAuto: true });
    expect([r.status, r.json.erro]).toEqual([403, "Ligar ou desligar a emissão automática da NFS-e pede a permissão Financeiro › Fiscal."]);
    base.body.emitirNfseAuto = false;
    r = await editar(base, { emitirBoletoAuto: true });
    expect([r.status, r.json.erro]).toEqual([403, "Ligar ou desligar o boleto automático pede a permissão Financeiro › Contas a receber."]);
    base.body.emitirBoletoAuto = false;
    expect((await editar(base, { aprovacaoAutomatica: false })).status).toBe(200); // o resto continua
    logar(usuario({ contratos: ["visualizar", "editar"], financeiro: ["visualizar", "medicoes", "fiscal", "contasReceber"] }));
    expect((await editar(base, { emitirNfseAuto: true, emitirBoletoAuto: true })).status).toBe(200);
    const salvo = await prisma.contrato.findUnique({ where: { id: base.id } });
    expect([salvo.emitirNfseAuto, salvo.emitirBoletoAuto]).toEqual([true, true]);
    // Criar já com a chave também pede a permissão
    logar(usuario({ contratos: ["visualizar", "criar", "editar"], financeiro: ["visualizar", "medicoes", "fiscal"] }));
    const cli = await novoCliente();
    const novo = await chamar("contratos", "POST", {}, { ...base.body, clienteId: cli, numero: "CT-RBAC-POST", emitirNfseAuto: true, emitirBoletoAuto: true });
    expect([novo.status, novo.json.erro]).toEqual([403, "Ligar ou desligar o boleto automático pede a permissão Financeiro › Contas a receber."]);
    expect(await prisma.contrato.count({ where: { numero: "CT-RBAC-POST" } })).toBe(0);
    // Sem Fiscal, desligar também é recusado (a chave é dele)
    logar(usuario({ contratos: ["visualizar", "editar"], financeiro: ["visualizar", "medicoes", "contasReceber"] }));
    expect((await editar(base, { emitirNfseAuto: false })).status).toBe(403);
    logar();
  });
});
