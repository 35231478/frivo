/**
 * Aviso ao cliente pelo app do técnico ("A caminho" / "Cheguei") — rotas reais com o Prisma real num
 * PostgreSQL real (schema descartável via `prisma db push`), pela MESMA fila de sincronização do app.
 * Só o Resend é de mentira (o resto — configuração criptografada, modelos, destinatários, log — é real):
 *  - com sinal: o cliente recebe o e-mail curto, o horário fica na atividade e no histórico da OS, e o
 *    atendimento NÃO começa por causa do aviso;
 *  - idempotente: tocar de novo (outra operação, a mesma reenviada, dois aparelhos juntos) não avisa de novo;
 *  - tempo real: o que subiu tarde da fila registra o horário do toque e NÃO avisa; dentro da janela, avisa;
 *    relógio errado no aparelho não engana;
 *  - sem destino / e-mail da empresa fora / falha do Resend: o horário fica e o motivo vai para o histórico;
 *  - permissão desligada: nada é enviado e o retrato não leva nada do aviso;
 *  - privacidade: o e-mail do cliente nunca vai para o app; o WhatsApp só com "Exibir contatos do cliente".
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/aviso-cliente-pg
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_aviso_cliente_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const MIN = 60_000;

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const resend = vi.hoisted(() => ({ enviados: [] as any[], falhar: false }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async (m: any) => { resend.enviados.push(m); return resend.falhar ? { error: { message: "Domínio não verificado" } } : { data: { id: "x" } }; } };
  },
}));

const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), id = "uA") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId: "e1", role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comoTecnico = (tecnicoId = "t1", id = "uT") => {
  sessao.atual = { user: { id, name: "João", email: `${id}@x.com`, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
/** Um envio da fila: `agora` = relógio do aparelho na hora do envio (como o app manda) */
const sync = async (operacoes: unknown[], agora: number | null = Date.now()) =>
  (await chamar("tecnico/sync", "POST", {}, { operacoes, ...(agora !== null && { agora: new Date(agora).toISOString() }) })).json.resultados as any[];
/** Um toque: `em` = relógio do aparelho na hora do toque */
const toque = (evento: "A_CAMINHO" | "CHEGOU", atividadeId: string, em: number = Date.now()) =>
  ({ id: randomUUID(), tipo: "avisoCliente", atividadeId, em: new Date(em).toISOString(), dados: { evento } });
const retrato = async (atividadeId: string) => (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId })).json;

describe.skipIf(!URL_PG)("Aviso ao cliente: a caminho / cheguei (PostgreSQL real)", () => {
  let prisma: any;
  const registros = (atividadeId: string) => prisma.atividadeAviso.findMany({ where: { atividadeId }, orderBy: { registradoEm: "asc" } });
  const historico = async (osId: string) => (await prisma.osHistorico.findMany({ where: { ordemServicoId: osId, acao: { startsWith: "Técnico" } }, orderBy: { criadoEm: "asc" } }));
  const permitir = (dados: Record<string, boolean>) => prisma.configuracao.upsert({ where: { empresaId: "e1" }, create: { empresaId: "e1", ...dados }, update: dados });
  let n = 0;
  /** Uma atividade nova (cada caso com a sua: o aviso é um por atividade/evento/dia) */
  async function atividade(osId = "osA", extra: Record<string, unknown> = {}) {
    const id = `at${++n}`;
    await prisma.atividadeOs.create({ data: { id, empresaId: "e1", ordemServicoId: osId, titulo: "Preventiva mensal", tecnicoId: "t1", status: "AGENDADA", ...extra } });
    return id;
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    const { criptografar } = await import("@/lib/crypto");
    await Promise.all(["tecnico/sync", "tecnico/atividades/[atividadeId]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Engenharia Ltda", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.emailConfig.create({ data: { empresaId: "e1", ativo: true, apiKey: criptografar("re_teste"), remetente: "avisos@ct.com.br", nomeRemetente: "Clima Total" } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Outro técnico", email: "t2@x.com", senha: "x", role: "TECNICO" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@x.com" },
      { id: "t2", empresaId: "e1", nome: "Outro técnico", cpf: "2", telefone: "2", email: "t2@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "1", email: "cadastro@hospital.com", celular: "(11) 97777-0000", emailsCopia: ["copia@hospital.com"] },
      { id: "cSem", empresaId: "e1", nome: "Padaria sem e-mail", cpfCnpj: "2" },
      { id: "cNao", empresaId: "e1", nome: "Colégio que não quer e-mail de OS", cpfCnpj: "3", email: "secretaria@colegio.com", emailReceberOs: false },
      { id: "cSimples", empresaId: "e1", nome: "Loja só com cadastro", cpfCnpj: "4", email: "loja@loja.com", celular: "11 95555-1234" },
    ] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "kPrincipal", empresaId: "e1", clienteId: "c1", nome: "Dra. Paula", email: "diretoria@hospital.com", whatsapp: "(11) 98888-7777", principal: true },
      { id: "kManut", empresaId: "e1", clienteId: "c1", nome: "Seu Jorge", email: "manutencao@hospital.com", whatsapp: "(11) 96666-5555", tipo: "OPERACIONAL" },
      { id: "kChamado", empresaId: "e1", clienteId: "c1", nome: "Recepção", email: "recepcao@hospital.com", whatsapp: "(11) 94444-3333" },
    ] });
    // Aba Comunicação do cliente: as comunicações de ORDENS vão para o Seu Jorge, por e-mail e WhatsApp
    await prisma.comunicacaoPreferencia.create({ data: { empresaId: "e1", clienteId: "c1", contatoId: "kManut", tipo: "ORDENS", canal: "AMBOS" } });
    await prisma.ordemServico.createMany({ data: [
      { id: "osA", empresaId: "e1", numero: "OS-0042", clienteId: "c1", criadoPorId: "uA", descricao: "Preventiva" },
      { id: "osChamado", empresaId: "e1", numero: "OS-0043", clienteId: "c1", criadoPorId: "uA", descricao: "Chamado da recepção", contatoOrigemId: "kChamado" },
      { id: "osSem", empresaId: "e1", numero: "OS-0044", clienteId: "cSem", criadoPorId: "uA", descricao: "Forno" },
      { id: "osNao", empresaId: "e1", numero: "OS-0045", clienteId: "cNao", criadoPorId: "uA", descricao: "Salas" },
      { id: "osSimples", empresaId: "e1", numero: "OS-0046", clienteId: "cSimples", criadoPorId: "uA", descricao: "Loja" },
    ] });
    comoTecnico();
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    resend.enviados.length = 0; resend.falhar = false;
    comoTecnico();
    await permitir({ appAvisarCliente: true, appExibirContatosCliente: true, appExibirDadosCliente: true });
  });

  /* ───────── com sinal ───────── */
  it("A CAMINHO com sinal: e-mail curto ao contato de Ordens (com as cópias do cliente), horário na atividade e no histórico da OS", async () => {
    const a = await atividade();
    const antes = Date.now();
    const [r] = await sync([toque("A_CAMINHO", a)]);
    expect(r).toMatchObject({ ok: true, status: 201, dados: { evento: "A_CAMINHO", status: "ENVIADO", jaEstava: false, aviso: "Cliente avisado: técnico a caminho." } });

    expect(resend.enviados).toHaveLength(1);
    const email = resend.enviados[0];
    expect(email.to).toBe("manutencao@hospital.com");
    expect(email.cc).toEqual(["copia@hospital.com"]);
    expect(email.from).toBe("Clima Total <avisos@ct.com.br>");
    expect(email.subject).toBe("Técnico a caminho — Clima Total");
    expect(email.html).toContain("nosso técnico está a caminho do seu atendimento.");
    expect(email.html).toContain("Ordem de serviço OS-0042.");
    expect(email.html).not.toMatch(/\p{Extended_Pictographic}/u);

    const [reg] = await registros(a);
    expect(reg).toMatchObject({ empresaId: "e1", evento: "A_CAMINHO", usuarioId: "uT", avisoStatus: "ENVIADO", avisoPara: "manutencao@hospital.com", avisoDetalhe: null });
    expect(reg.registradoEm.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(reg.avisoEm).toBeInstanceOf(Date);

    const [h] = (await historico("osA")).filter((x: any) => x.criadoEm.getTime() === reg.registradoEm.getTime());
    expect(h).toMatchObject({ acao: "Técnico a caminho", usuarioId: "uT", detalhes: `"Preventiva mensal": cliente avisado por e-mail (manutencao@hospital.com) (app do técnico)` });
    // O e-mail fica no log de e-mails da empresa, ligado à OS
    expect(await prisma.emailLog.findFirst({ where: { referenciaId: "osA", assunto: "Técnico a caminho — Clima Total" } })).toMatchObject({ status: "ENVIADO", para: "manutencao@hospital.com", referenciaTipo: "OrdemServico" });
    // Avisar não é começar o atendimento
    expect((await prisma.atividadeOs.findUnique({ where: { id: a } })).status).toBe("AGENDADA");
  });

  it("CHEGUEI na mesma atividade: outro e-mail, com a frase da chegada; os dois ficam no histórico, em ordem", async () => {
    const a = await atividade();
    await sync([toque("A_CAMINHO", a)]);
    const [r] = await sync([toque("CHEGOU", a)]);
    expect(r.dados).toMatchObject({ evento: "CHEGOU", status: "ENVIADO", aviso: "Cliente avisado: técnico no local." });
    expect(resend.enviados.map((e) => e.subject)).toEqual(["Técnico a caminho — Clima Total", "Técnico no local — Clima Total"]);
    expect(resend.enviados[1].html).toContain("nosso técnico chegou ao local.");
    expect((await registros(a)).map((x: any) => x.evento)).toEqual(["A_CAMINHO", "CHEGOU"]);
  });

  it("OS aberta por um contato: quem abriu o chamado recebe; o contato de Ordens e as cópias vão em cópia", async () => {
    const a = await atividade("osChamado");
    await sync([toque("CHEGOU", a)]);
    expect(resend.enviados[0].to).toBe("recepcao@hospital.com");
    expect(resend.enviados[0].cc).toEqual(["manutencao@hospital.com", "copia@hospital.com"]);
  });

  it("cliente só com o e-mail do cadastro: é para lá que o aviso vai", async () => {
    const a = await atividade("osSimples");
    await sync([toque("A_CAMINHO", a)]);
    expect(resend.enviados[0].to).toBe("loja@loja.com");
  });

  /* ───────── idempotente ───────── */
  it("tocar DUAS vezes não avisa duas vezes: a segunda devolve o registro que já existia", async () => {
    const a = await atividade();
    const [primeiro] = await sync([toque("A_CAMINHO", a)]);
    const [segundo] = await sync([toque("A_CAMINHO", a)]); // outra operação (outro id): novo toque
    expect(resend.enviados).toHaveLength(1);
    expect(segundo).toMatchObject({ ok: true, dados: { status: "ENVIADO", jaEstava: true, aviso: null, em: primeiro.dados.em } });
    expect(await registros(a)).toHaveLength(1);
    expect((await historico("osA")).filter((h: any) => h.criadoEm.toISOString() === primeiro.dados.em)).toHaveLength(1);
  });

  it("a MESMA operação reenviada (o sinal caiu antes da resposta) devolve o resultado guardado, sem novo e-mail", async () => {
    const a = await atividade();
    const op = toque("CHEGOU", a);
    const [r1] = await sync([op]);
    const [r2] = await sync([op]);
    expect(r2).toMatchObject({ ok: true, repetida: true, dados: r1.dados });
    expect(resend.enviados).toHaveLength(1);
  });

  it("dois aparelhos tocando JUNTOS: a chave única deixa passar um só — um e-mail, um registro", async () => {
    const a = await atividade();
    const resultados = await Promise.all([sync([toque("A_CAMINHO", a)]), sync([toque("A_CAMINHO", a)]), sync([toque("A_CAMINHO", a)])]);
    expect(resultados.every(([r]) => r.ok)).toBe(true);
    expect(resultados.filter(([r]) => r.dados.jaEstava === false)).toHaveLength(1);
    expect(resend.enviados).toHaveLength(1);
    expect(await registros(a)).toHaveLength(1);
  });

  it("um por DIA: a atividade que continua amanhã pode avisar de novo", async () => {
    const a = await atividade();
    await prisma.atividadeAviso.create({ data: { empresaId: "e1", atividadeId: a, evento: "A_CAMINHO", dia: new Date(Date.now() - 3 * 24 * 60 * MIN), registradoEm: new Date(Date.now() - 3 * 24 * 60 * MIN), usuarioId: "uT", avisoStatus: "ENVIADO" } });
    const [r] = await sync([toque("A_CAMINHO", a)]);
    expect(r.dados).toMatchObject({ status: "ENVIADO", jaEstava: false });
    expect(resend.enviados).toHaveLength(1);
    expect(await registros(a)).toHaveLength(2);
  });

  /* ───────── tempo real: aviso velho não sai ───────── */
  it("tocou SEM SINAL e a fila subiu 40 min depois: registra o horário do TOQUE e NÃO avisa o cliente", async () => {
    const a = await atividade();
    const agora = Date.now();
    const [r] = await sync([toque("A_CAMINHO", a, agora - 40 * MIN)], agora);
    expect(r).toMatchObject({ ok: true, dados: { status: "ATRASADO", aviso: "Horário registrado. O aviso não foi enviado: faltou sinal na hora do toque." } });
    expect(resend.enviados).toHaveLength(0);
    const [reg] = await registros(a);
    expect(reg).toMatchObject({ avisoStatus: "ATRASADO", avisoPara: null, avisoEm: null, avisoDetalhe: "tocado sem sinal; chegou ao sistema 40 min depois" });
    expect(Math.abs(reg.registradoEm.getTime() - (agora - 40 * MIN))).toBeLessThan(5000);
    // O escritório vê o horário REAL do toque na linha do tempo, com o motivo de não ter havido aviso
    const h = (await historico("osA")).find((x: any) => x.criadoEm.getTime() === reg.registradoEm.getTime());
    expect(h.detalhes).toBe(`"Preventiva mensal": horário registrado; cliente não avisado — tocado sem sinal; chegou ao sistema 40 min depois (app do técnico)`);
  });

  it("o sinal voltou 3 min depois do toque: ainda faz sentido — o aviso sai e o horário é o do toque", async () => {
    const a = await atividade();
    const agora = Date.now();
    const [r] = await sync([toque("CHEGOU", a, agora - 3 * MIN)], agora);
    expect(r.dados.status).toBe("ENVIADO");
    expect(resend.enviados).toHaveLength(1);
    expect(Math.abs((await registros(a))[0].registradoEm.getTime() - (agora - 3 * MIN))).toBeLessThan(5000);
  });

  it("relógio do aparelho 3 h ADIANTADO: o atraso é medido pelo próprio aparelho — avisa, e grava o horário certo", async () => {
    const a = await atividade();
    const errado = Date.now() + 180 * MIN;
    const [r] = await sync([toque("A_CAMINHO", a, errado - MIN)], errado);
    expect(r.dados.status).toBe("ENVIADO");
    expect(Math.abs((await registros(a))[0].registradoEm.getTime() - (Date.now() - MIN))).toBeLessThan(5000);
  });

  it("relógio 3 h ATRASADO e fila que subiu tarde: continua sem avisar (o atraso real foi de 30 min)", async () => {
    const a = await atividade();
    const errado = Date.now() - 180 * MIN;
    const [r] = await sync([toque("A_CAMINHO", a, errado - 30 * MIN)], errado);
    expect(r.dados.status).toBe("ATRASADO");
    expect(resend.enviados).toHaveLength(0);
  });

  it("app antigo (envio sem o relógio do aparelho): vale o relógio do servidor", async () => {
    const a = await atividade();
    const [tarde] = await sync([toque("A_CAMINHO", a, Date.now() - 20 * MIN)], null);
    const [emTempo] = await sync([toque("CHEGOU", a, Date.now() - 1000)], null);
    expect([tarde.dados.status, emTempo.dados.status]).toEqual(["ATRASADO", "ENVIADO"]);
    expect(resend.enviados).toHaveLength(1);
  });

  it("'cheguei' e 'a caminho' na mesma fila que subiu tarde: os dois horários ficam, nenhum aviso sai", async () => {
    const a = await atividade();
    const agora = Date.now();
    const rs = await sync([toque("A_CAMINHO", a, agora - 50 * MIN), toque("CHEGOU", a, agora - 12 * MIN)], agora);
    expect(rs.map((r) => r.dados.status)).toEqual(["ATRASADO", "ATRASADO"]);
    expect(resend.enviados).toHaveLength(0);
    expect((await registros(a)).map((x: any) => x.evento)).toEqual(["A_CAMINHO", "CHEGOU"]);
  });

  it("'a caminho' depois de 'cheguei' no mesmo dia: registra, mas não avisa (não faz mais sentido)", async () => {
    const a = await atividade();
    await sync([toque("CHEGOU", a)]);
    const [r] = await sync([toque("A_CAMINHO", a)]);
    expect(r.dados.status).toBe("ATRASADO");
    expect(resend.enviados).toHaveLength(1);
    expect((await registros(a)).find((x: any) => x.evento === "A_CAMINHO").avisoDetalhe).toBe("a chegada já estava registrada");
  });

  /* ───────── quando o e-mail não sai, o horário fica ───────── */
  it("cliente SEM e-mail: nada é enviado; o horário fica e o histórico diz por quê", async () => {
    const a = await atividade("osSem");
    const [r] = await sync([toque("A_CAMINHO", a)]);
    expect(r).toMatchObject({ ok: true, dados: { status: "SEM_DESTINO", aviso: "Horário registrado. O cliente não tem e-mail para receber o aviso." } });
    expect(resend.enviados).toHaveLength(0);
    expect((await historico("osSem"))[0].detalhes).toBe(`"Preventiva mensal": horário registrado; cliente não avisado — o cliente não tem e-mail para avisos de OS (app do técnico)`);
  });

  it("cliente que NÃO recebe e-mails de OS (cadastro do cliente): respeitado — sem aviso", async () => {
    const a = await atividade("osNao");
    const [r] = await sync([toque("CHEGOU", a)]);
    expect(r.dados.status).toBe("SEM_DESTINO");
    expect(resend.enviados).toHaveLength(0);
    expect((await registros(a))[0].avisoDetalhe).toBe("o cliente não recebe e-mails de OS (cadastro do cliente)");
  });

  it("e-mail da empresa desativado, e depois falha do Resend: a gravação NÃO falha; o motivo fica registrado", async () => {
    const a = await atividade();
    await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: false } });
    try {
      const [r] = await sync([toque("A_CAMINHO", a)]);
      expect(r).toMatchObject({ ok: true, dados: { status: "INDISPONIVEL", aviso: "Horário registrado. O e-mail de aviso não pôde ser enviado." } });
      expect(resend.enviados).toHaveLength(0);
      expect((await registros(a))[0].avisoDetalhe).toBe("e-mail da empresa não configurado (Configurações › E-mail)");
    } finally {
      await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: true } });
    }
    resend.falhar = true;
    const [r2] = await sync([toque("CHEGOU", a)]);
    expect(r2).toMatchObject({ ok: true, dados: { status: "INDISPONIVEL" } });
    const chegou = (await registros(a)).find((x: any) => x.evento === "CHEGOU");
    expect(chegou).toMatchObject({ avisoStatus: "INDISPONIVEL", avisoPara: null, avisoDetalhe: "falha no envio do e-mail: Domínio não verificado" });
    // A falha também fica no log de e-mails
    expect(await prisma.emailLog.findFirst({ where: { referenciaId: "osA", status: "ERRO", assunto: "Técnico no local — Clima Total" } })).toBeTruthy();
  });

  it("modelo editado pela empresa (Configurações › E-mail › Modelos) é o que sai; modelo inativo = sem envio", async () => {
    const a = await atividade();
    await prisma.emailTemplate.create({ data: { empresaId: "e1", tipo: "TECNICO_A_CAMINHO", nome: "Técnico a caminho", assunto: "{{empresa_nome}} — equipe a caminho", corpo: "<p>Nossa equipe saiu para a OS {{numero_os}}.</p>", ativo: true } });
    try {
      await sync([toque("A_CAMINHO", a)]);
      expect(resend.enviados[0].subject).toBe("Clima Total — equipe a caminho");
      expect(resend.enviados[0].html).toContain("Nossa equipe saiu para a OS OS-0042.");
      await prisma.emailTemplate.update({ where: { empresaId_tipo: { empresaId: "e1", tipo: "TECNICO_A_CAMINHO" } }, data: { ativo: false } });
      const b = await atividade();
      const [r] = await sync([toque("A_CAMINHO", b)]);
      expect(r.dados.status).toBe("INDISPONIVEL");
      expect(resend.enviados).toHaveLength(1);
    } finally {
      await prisma.emailTemplate.deleteMany({ where: { empresaId: "e1", tipo: "TECNICO_A_CAMINHO" } });
    }
  });

  /* ───────── permissão (Equipes › App do colaborador) ───────── */
  it("'Avisar o cliente' DESLIGADO: o retrato não leva nada do aviso e, se um toque antigo chegar, nada é enviado", async () => {
    const a = await atividade();
    await permitir({ appAvisarCliente: false });
    const r = await retrato(a);
    expect(r.avisoCliente).toBeNull();
    const [res] = await sync([toque("A_CAMINHO", a)]);
    expect(res).toMatchObject({ ok: true, dados: { status: "INDISPONIVEL" } });
    expect(resend.enviados).toHaveLength(0);
    expect((await registros(a))[0].avisoDetalhe).toBe("aviso ao cliente desligado em Equipes › App do colaborador");
  });

  it("a permissão é salva pela tela de configurações (PUT /api/configuracoes) e nasce LIGADA", async () => {
    await prisma.configuracao.deleteMany({ where: { empresaId: "e1" } });
    const a = await atividade();
    expect((await retrato(a)).avisoCliente).toMatchObject({ empresa: "Clima Total" }); // sem linha de configuração = padrão LIGADO
    comoEscritorio();
    expect((await chamar("configuracoes", "PUT", {}, { appAvisarCliente: false })).status).toBe(200);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).appAvisarCliente).toBe(false);
    comoTecnico();
    expect((await retrato(a)).avisoCliente).toBeNull();
  });

  /* ───────── o que vai para o aparelho (privacidade) ───────── */
  it("retrato: nome da empresa para a mensagem, o WhatsApp de Ordens e os toques de HOJE — o e-mail do cliente nunca vai", async () => {
    const a = await atividade();
    await sync([toque("A_CAMINHO", a)]);
    const r = await retrato(a);
    expect(r.avisoCliente).toEqual({ empresa: "Clima Total", whatsapp: "(11) 96666-5555" });
    expect(r.execucao.avisos.A_CAMINHO).toMatchObject({ status: "ENVIADO" });
    expect(r.execucao.avisos.CHEGOU).toBeUndefined();
    const tudo = JSON.stringify(r);
    for (const email of ["manutencao@hospital.com", "copia@hospital.com", "diretoria@hospital.com", "cadastro@hospital.com"]) expect(tudo).not.toContain(email);
    // O resultado da gravação também não leva o destinatário
    const [res] = await sync([toque("CHEGOU", a)]);
    expect(JSON.stringify(res)).not.toMatch(/@hospital/);
  });

  it("toque de outro dia não vem como de hoje (o botão volta a aparecer)", async () => {
    const a = await atividade();
    const ontem = new Date(Date.now() - 26 * 60 * MIN);
    await prisma.atividadeAviso.create({ data: { empresaId: "e1", atividadeId: a, evento: "CHEGOU", dia: new Date(Date.UTC(ontem.getUTCFullYear(), ontem.getUTCMonth(), ontem.getUTCDate() - 1)), registradoEm: ontem, usuarioId: "uT", avisoStatus: "ENVIADO" } });
    expect((await retrato(a)).execucao.avisos).toEqual({});
  });

  it("WhatsApp do cliente: quem abriu o chamado → contato de Ordens → contato principal → celular do cadastro", async () => {
    expect((await retrato(await atividade("osChamado"))).avisoCliente.whatsapp).toBe("(11) 94444-3333");
    expect((await retrato(await atividade("osSimples"))).avisoCliente.whatsapp).toBe("11 95555-1234");
    expect((await retrato(await atividade("osSem"))).avisoCliente.whatsapp).toBeNull();
    // Sem preferência de Ordens: cai no contato principal
    await prisma.comunicacaoPreferencia.deleteMany({ where: { clienteId: "c1" } });
    try {
      expect((await retrato(await atividade("osA"))).avisoCliente.whatsapp).toBe("(11) 98888-7777");
    } finally {
      await prisma.comunicacaoPreferencia.create({ data: { empresaId: "e1", clienteId: "c1", contatoId: "kManut", tipo: "ORDENS", canal: "AMBOS" } });
    }
  });

  it("'Exibir contatos do cliente' DESLIGADO: o número não sai do servidor — e o e-mail automático continua saindo", async () => {
    const a = await atividade();
    await permitir({ appExibirContatosCliente: false });
    const r = await retrato(a);
    expect(r.avisoCliente).toEqual({ empresa: "Clima Total", whatsapp: null });
    expect(JSON.stringify(r)).not.toMatch(/96666|98888|97777/);
    const [res] = await sync([toque("A_CAMINHO", a)]);
    expect(res.dados.status).toBe("ENVIADO");
    expect(resend.enviados[0].to).toBe("manutencao@hospital.com");
  });

  /* ───────── quem pode ───────── */
  it("só nas atividades do próprio técnico; atividade concluída não avisa", async () => {
    const doOutro = await atividade("osA", { tecnicoId: "t2" });
    const [fora] = await sync([toque("A_CAMINHO", doOutro)]);
    expect(fora).toMatchObject({ ok: false, status: 403 });
    const feita = await atividade("osA", { status: "CONCLUIDA" });
    const [bloqueada] = await sync([toque("CHEGOU", feita)]);
    expect(bloqueada).toMatchObject({ ok: false, status: 409 });
    expect(resend.enviados).toHaveLength(0);
    expect(await registros(doOutro)).toHaveLength(0);
    expect(await registros(feita)).toHaveLength(0);
  });

  it("atividade de outra EMPRESA não existe para este técnico", async () => {
    const [r] = await sync([toque("A_CAMINHO", "nao-existe")]);
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("o aviso entra na fila junto com o resto: depois dele, a 1ª gravação da execução é que inicia o atendimento", async () => {
    const a = await atividade();
    const rs = await sync([toque("A_CAMINHO", a), toque("CHEGOU", a), { id: randomUUID(), tipo: "iniciar", atividadeId: a, em: new Date().toISOString() }]);
    expect(rs.map((r) => r.ok)).toEqual([true, true, true]);
    expect((await prisma.atividadeOs.findUnique({ where: { id: a } })).status).toBe("EM_ANDAMENTO");
    expect(resend.enviados).toHaveLength(2);
  });

  /* ───────── o card do Meu dia: é ele que abre (ou não) a OS ───────── */
  describe("o card do Meu dia e da Agenda", () => {
    const meuDia = async () => (await chamar("tecnico/meu-dia", "GET", {})).json;
    const agenda = async () => (await chamar("tecnico/agenda", "GET", {})).json;
    /** Uma atividade marcada para hoje, às 14:00 de Brasília */
    const hoje = (osId: string, extra: Record<string, unknown> = {}) => {
      const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      return atividade(osId, { dataAgendada: new Date(`${dia}T17:00:00.000Z`), ...extra });
    };
    const QR = "Ar da recepção pingando.\n\n[Chamado via QR Code] Solicitante: Marta Lima · E-mail: marta@hospital.com · Telefone: (11) 97777-1111";

    beforeAll(async () => {
      await prisma.ordemServico.createMany({ data: [
        { id: "osQr", empresaId: "e1", numero: "OS-0050", clienteId: "c1", criadoPorId: "uA", origem: "PORTAL_CLIENTE", chamadoNumero: "CH-0007", descricao: QR, observacoes: "Entrar pela portaria 2." },
        { id: "osEscritorio", empresaId: "e1", numero: "OS-0051", clienteId: "c1", criadoPorId: "uA", descricao: "Trocar o compressor", observacoes: "Levar escada." },
      ] });
    });
    afterEach(async () => { await prisma.atividadeOs.updateMany({ where: { empresaId: "e1" }, data: { dataAgendada: null } }); });

    it("cada card leva os toques de HOJE desta atividade: é o que diz se o técnico já chegou (e a OS abre)", async () => {
      const [semToque, aCaminho, chegou] = [await hoje("osA"), await hoje("osA"), await hoje("osA")];
      await sync([toque("A_CAMINHO", aCaminho), toque("A_CAMINHO", chegou), toque("CHEGOU", chegou)]);
      // toque de ontem não vale: a OS que segue agendada pede "Cheguei" de novo
      const ontem = new Date(Date.now() - 26 * 60 * MIN);
      await prisma.atividadeAviso.create({ data: { empresaId: "e1", atividadeId: semToque, evento: "CHEGOU", dia: new Date(Date.UTC(ontem.getUTCFullYear(), ontem.getUTCMonth(), ontem.getUTCDate() - 1)), registradoEm: ontem, usuarioId: "uT", avisoStatus: "ENVIADO" } });

      for (const lista of [(await meuDia()).atividades, (await agenda()).dias[0].atividades]) {
        const card = (id: string) => lista.find((c: any) => c.atividadeId === id);
        expect(card(semToque).avisos).toEqual({});
        expect(card(aCaminho).avisos).toEqual({ A_CAMINHO: { em: expect.any(String), status: "ENVIADO" } });
        expect(Object.keys(card(chegou).avisos).sort()).toEqual(["A_CAMINHO", "CHEGOU"]);
        expect(card(chegou).avisos.CHEGOU.status).toBe("ENVIADO");
        expect(card(chegou).status).toBe("AGENDADA"); // chegar não começa o atendimento
        expect(JSON.stringify(lista)).not.toMatch(/@hospital/); // o destinatário do aviso nunca vai
      }
    });

    it("o card diz se a OS veio de um chamado do cliente e traz a orientação do escritório (observação da atividade + observações da OS)", async () => {
      const doChamado = await hoje("osQr", { observacao: "Levar bomba de dreno." });
      const doEscritorio = await hoje("osEscritorio");
      const igual = await hoje("osEscritorio", { observacao: "Levar escada." }); // o mesmo texto nos dois lugares: uma vez só
      const lista = (await meuDia()).atividades;
      const card = (id: string) => lista.find((c: any) => c.atividadeId === id);
      expect(card(doChamado)).toMatchObject({ chamado: true, descricao: QR, orientacao: "Levar bomba de dreno.\n\nEntrar pela portaria 2." });
      expect(card(doEscritorio)).toMatchObject({ chamado: false, descricao: "Trocar o compressor", orientacao: "Levar escada." });
      expect(card(igual).orientacao).toBe("Levar escada.");
      expect((await retrato(doChamado)).cartao).toMatchObject({ chamado: true, orientacao: "Levar bomba de dreno.\n\nEntrar pela portaria 2." });
    });

    it("'Exibir dados do cliente' DESLIGADO: o pedido e a orientação vão; o nome, o e-mail e o telefone de quem pediu NÃO saem do servidor", async () => {
      const a = await hoje("osQr", { observacao: "Levar bomba de dreno." });
      await permitir({ appExibirDadosCliente: false, appExibirContatosCliente: false });
      const cards = [(await meuDia()).atividades.find((c: any) => c.atividadeId === a), (await agenda()).dias[0].atividades.find((c: any) => c.atividadeId === a), (await retrato(a)).cartao];
      for (const c of cards) {
        expect(c).toMatchObject({ cliente: "", endereco: "", descricao: "Ar da recepção pingando.", orientacao: "Levar bomba de dreno.\n\nEntrar pela portaria 2.", chamado: true });
        expect(JSON.stringify(c)).not.toMatch(/Marta|marta@|97777|Hospital/);
      }
      // só os contatos desligados: fica o nome de quem pediu; e-mail e telefone não
      await permitir({ appExibirDadosCliente: true, appExibirContatosCliente: false });
      const c = (await meuDia()).atividades.find((x: any) => x.atividadeId === a);
      expect(c.descricao).toBe("Ar da recepção pingando.\n\nSolicitante: Marta Lima");
    });

    it("'Avisar o cliente' DESLIGADO: o 'Cheguei' continua valendo como chegada — registra o horário, não envia nada, e o card passa a saber", async () => {
      const a = await hoje("osA");
      await permitir({ appAvisarCliente: false });
      const [res] = await sync([toque("CHEGOU", a)]);
      expect(res).toMatchObject({ ok: true, dados: { evento: "CHEGOU", status: "INDISPONIVEL" } });
      expect(resend.enviados).toHaveLength(0);
      expect((await meuDia()).atividades.find((c: any) => c.atividadeId === a).avisos.CHEGOU).toMatchObject({ status: "INDISPONIVEL" });
      const [h] = (await historico("osA")).filter((x: any) => x.detalhes.includes("aviso ao cliente desligado")).slice(-1);
      expect(h.acao).toBe("Técnico chegou ao local");
    });
  });
});
