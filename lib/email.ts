import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { descriptografar } from "@/lib/crypto";
import { TEMPLATES_PADRAO, substituirVariaveis, montarEmailHtml, type DadosEmpresaEmail } from "@/lib/email-templates";
import { formatarMoeda, formatarData, nomeMes } from "@/lib/utils";

export interface ResultadoEmail { ok: boolean; erro?: string }

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.APP_URL || "").replace(/\/$/, "");
}

async function carregarConfig(empresaId: string) {
  const cfg = await prisma.emailConfig.findUnique({ where: { empresaId } });
  if (!cfg) return null;
  const apiKey = descriptografar(cfg.apiKey);
  return { ...cfg, apiKeyDecrypted: apiKey, completo: !!(cfg.ativo && apiKey && cfg.remetente) };
}

export async function emailConfigAtiva(empresaId: string): Promise<boolean> {
  const c = await carregarConfig(empresaId);
  return !!c?.completo;
}

/** Envia um e-mail usando um template (tipo) e registra no email_log. */
export async function enviarEmail(empresaId: string, p: {
  tipo: string;
  para: string;
  cc?: string[];
  variaveis: Record<string, string>;
  referenciaId?: string;
  referenciaTipo?: string;
}): Promise<ResultadoEmail> {
  const cfg = await carregarConfig(empresaId);
  if (!cfg?.completo) return { ok: false, erro: "E-mail não configurado ou inativo." };
  if (!p.para) return { ok: false, erro: "Destinatário sem e-mail." };

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { nome: true, nomeFantasia: true, telefone: true, celular: true, email: true, site: true, logo: true, endereco: true, cidade: true, estado: true },
  });
  if (!empresa) return { ok: false, erro: "Empresa não encontrada." };

  const def = TEMPLATES_PADRAO.find((t) => t.tipo === p.tipo);
  const tpl = await prisma.emailTemplate.findUnique({ where: { empresaId_tipo: { empresaId, tipo: p.tipo } } });
  if (tpl && !tpl.ativo) return { ok: false, erro: "Template inativo." };

  const assuntoBase = tpl?.assunto ?? def?.assunto ?? "{{empresa_nome}}";
  const corpoBase = tpl?.corpo ?? def?.corpo ?? "";

  const vars: Record<string, string> = {
    empresa_nome: empresa.nomeFantasia ?? empresa.nome,
    empresa_telefone: empresa.telefone ?? empresa.celular ?? "",
    empresa_email: empresa.email ?? "",
    empresa_site: empresa.site ?? "",
    ...p.variaveis,
  };

  const assunto = substituirVariaveis(assuntoBase, vars);
  const corpoHtml = substituirVariaveis(corpoBase, vars);
  const botaoUrl = def?.botaoVar ? vars[def.botaoVar] : undefined;
  const dadosEmpresa: DadosEmpresaEmail = { nome: empresa.nomeFantasia ?? empresa.nome, telefone: empresa.telefone ?? empresa.celular, email: empresa.email, site: empresa.site, endereco: empresa.endereco, cidade: empresa.cidade, estado: empresa.estado, logo: empresa.logo };
  const html = montarEmailHtml({ empresa: dadosEmpresa, corpoHtml, botaoLabel: botaoUrl ? def?.botaoLabel : undefined, botaoUrl: botaoUrl || undefined });

  let ok = true, erro: string | undefined;
  try {
    const resend = new Resend(cfg.apiKeyDecrypted!);
    const from = cfg.nomeRemetente ? `${cfg.nomeRemetente} <${cfg.remetente}>` : cfg.remetente!;
    const res = await resend.emails.send({ from, to: p.para, cc: p.cc?.length ? p.cc : undefined, replyTo: cfg.replyTo ?? undefined, subject: assunto, html } as any);
    if ((res as any)?.error) { ok = false; erro = (res as any).error.message ?? "Erro no envio."; }
  } catch (e: any) { ok = false; erro = e?.message ?? "Erro no envio."; }

  await prisma.emailLog.create({
    data: { empresaId, para: p.para, assunto, templateId: tpl?.id ?? null, referenciaId: p.referenciaId ?? null, referenciaTipo: p.referenciaTipo ?? null, status: ok ? "ENVIADO" : "ERRO", erro: erro ?? null },
  });

  return { ok, erro };
}

/** Envia um e-mail de teste para um destinatário. */
export async function enviarEmailTeste(empresaId: string, para: string): Promise<ResultadoEmail> {
  const cfg = await carregarConfig(empresaId);
  if (!cfg?.completo) return { ok: false, erro: "Preencha API Key e remetente e ative os e-mails." };
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, nomeFantasia: true, telefone: true, email: true, site: true, logo: true, endereco: true, cidade: true, estado: true } });
  const dados: DadosEmpresaEmail = { nome: empresa?.nomeFantasia ?? empresa?.nome ?? "Frivo", telefone: empresa?.telefone, email: empresa?.email, site: empresa?.site, endereco: empresa?.endereco, cidade: empresa?.cidade, estado: empresa?.estado, logo: empresa?.logo };
  const html = montarEmailHtml({ empresa: dados, corpoHtml: "<p>Este é um <strong>e-mail de teste</strong> do Frivo. Se você recebeu esta mensagem, sua configuração do Resend está funcionando! ✅</p>" });
  try {
    const resend = new Resend(cfg.apiKeyDecrypted!);
    const from = cfg.nomeRemetente ? `${cfg.nomeRemetente} <${cfg.remetente}>` : cfg.remetente!;
    const res = await resend.emails.send({ from, to: para, replyTo: cfg.replyTo ?? undefined, subject: "Teste de configuração — Frivo", html } as any);
    if ((res as any)?.error) return { ok: false, erro: (res as any).error.message };
    return { ok: true };
  } catch (e: any) { return { ok: false, erro: e?.message ?? "Erro no envio." }; }
}

function ccDoCliente(cli: { emailsCopia?: string[] | null }): string[] {
  return (cli.emailsCopia ?? []).filter(Boolean);
}

// ─────────────────────────────────────────────
// Helpers por módulo
// ─────────────────────────────────────────────

export async function enviarBoleto(contaReceberId: string): Promise<ResultadoEmail> {
  const c = await prisma.contaReceber.findUnique({ where: { id: contaReceberId }, include: { cliente: true } });
  if (!c) return { ok: false, erro: "Conta não encontrada." };
  const cfg = await prisma.emailConfig.findUnique({ where: { empresaId: c.empresaId } });
  if (!cfg?.notifBoletoEmitido || !c.cliente.emailReceberBoletos) return { ok: false, erro: "Notificação desativada." };
  const para = c.cliente.email ?? c.cliente.emailsFaturamento?.[0] ?? "";
  return enviarEmail(c.empresaId, {
    tipo: "BOLETO_EMITIDO", para, cc: ccDoCliente(c.cliente),
    referenciaId: c.id, referenciaTipo: "ContaReceber",
    variaveis: { cliente_nome: c.cliente.nomeFantasia ?? c.cliente.nome, cliente_cnpj: c.cliente.cpfCnpj, valor: formatarMoeda(Number(c.valor)), vencimento: c.dataVencimento ? formatarData(c.dataVencimento) : "—", descricao: c.descricao, link_boleto: c.boletoPdfUrl ?? c.boletoUrl ?? "" },
  });
}

export async function enviarLembreteVencimento(contaReceberId: string): Promise<ResultadoEmail> {
  const c = await prisma.contaReceber.findUnique({ where: { id: contaReceberId }, include: { cliente: true } });
  if (!c) return { ok: false, erro: "Conta não encontrada." };
  if (!c.cliente.emailReceberLembretes) return { ok: false, erro: "Cliente não recebe lembretes." };
  const dias = c.dataVencimento ? Math.max(0, Math.round((new Date(c.dataVencimento).getTime() - Date.now()) / 86400000)) : 0;
  return enviarEmail(c.empresaId, {
    tipo: "LEMBRETE_VENCIMENTO", para: c.cliente.email ?? "", cc: ccDoCliente(c.cliente), referenciaId: c.id, referenciaTipo: "ContaReceber",
    variaveis: { cliente_nome: c.cliente.nomeFantasia ?? c.cliente.nome, valor: formatarMoeda(Number(c.valor)), vencimento: c.dataVencimento ? formatarData(c.dataVencimento) : "—", dias_para_vencer: String(dias), descricao: c.descricao, link_boleto: c.boletoPdfUrl ?? "" },
  });
}

export async function enviarConfirmacaoPagamento(contaReceberId: string): Promise<ResultadoEmail> {
  const c = await prisma.contaReceber.findUnique({ where: { id: contaReceberId }, include: { cliente: true } });
  if (!c) return { ok: false, erro: "Conta não encontrada." };
  const cfg = await prisma.emailConfig.findUnique({ where: { empresaId: c.empresaId } });
  if (!cfg?.notifConfirmacaoPagamento || !c.cliente.emailReceberConfirmacoes) return { ok: false, erro: "Notificação desativada." };
  return enviarEmail(c.empresaId, {
    tipo: "CONFIRMACAO_PAGAMENTO", para: c.cliente.email ?? "", cc: ccDoCliente(c.cliente), referenciaId: c.id, referenciaTipo: "ContaReceber",
    variaveis: { cliente_nome: c.cliente.nomeFantasia ?? c.cliente.nome, valor: formatarMoeda(Number(c.valor)), descricao: c.descricao },
  });
}

export async function enviarMedicao(medicaoId: string): Promise<ResultadoEmail> {
  const m = await prisma.medicao.findUnique({ where: { id: medicaoId }, include: { cliente: true } });
  if (!m) return { ok: false, erro: "Medição não encontrada." };
  if (!m.cliente.emailReceberRelatorios) return { ok: false, erro: "Cliente não recebe relatórios." };
  const ref = m.mes ? `${nomeMes(m.mes)}/${m.ano ?? ""}` : (m.numero ?? "");
  const link = m.tokenPublico ? `${baseUrl()}/medicao/${m.tokenPublico}` : "";
  return enviarEmail(m.empresaId, {
    tipo: "MEDICAO_DISPONIVEL", para: m.cliente.email ?? "", cc: ccDoCliente(m.cliente), referenciaId: m.id, referenciaTipo: "Medicao",
    variaveis: { cliente_nome: m.cliente.nomeFantasia ?? m.cliente.nome, mes_referencia: ref, valor: formatarMoeda(Number(m.valorLiquido)), link_documento: link },
  });
}

export async function enviarOrcamento(orcamentoId: string): Promise<ResultadoEmail> {
  const o = await prisma.orcamento.findUnique({ where: { id: orcamentoId }, include: { cliente: true } });
  if (!o) return { ok: false, erro: "Orçamento não encontrado." };
  if (!o.cliente.emailReceberOrcamentos) return { ok: false, erro: "Cliente não recebe orçamentos." };
  return enviarEmail(o.empresaId, {
    tipo: "ORCAMENTO_ENVIADO", para: o.cliente.email ?? "", cc: ccDoCliente(o.cliente), referenciaId: o.id, referenciaTipo: "Orcamento",
    variaveis: { cliente_nome: o.cliente.nomeFantasia ?? o.cliente.nome, cliente_cnpj: o.cliente.cpfCnpj, numero_orcamento: o.codigo, valor: formatarMoeda(Number(o.totalGeral)), link_orcamento: `${baseUrl()}/orcamento/${o.tokenPublico}` },
  });
}

type TipoLembreteOrc = "nao_respondido" | "vencendo" | "vencido" | "aprovado_sem_os";
const TIPO_TPL_ORC: Record<TipoLembreteOrc, string> = {
  nao_respondido: "ORCAMENTO_NAO_RESPONDIDO",
  vencendo: "ORCAMENTO_VENCENDO",
  vencido: "ORCAMENTO_VENCIDO",
  aprovado_sem_os: "ORCAMENTO_APROVADO_SEM_OS",
};

export async function enviarLembreteOrcamento(orcamentoId: string, tipo: TipoLembreteOrc): Promise<ResultadoEmail> {
  const o = await prisma.orcamento.findUnique({ where: { id: orcamentoId }, include: { cliente: true } });
  if (!o) return { ok: false, erro: "Orçamento não encontrado." };
  if (!o.cliente.emailReceberOrcamentos) return { ok: false, erro: "Cliente não recebe orçamentos." };
  const dias = o.validadeEm ? Math.round((new Date(o.validadeEm).getTime() - Date.now()) / 86400000) : 0;
  return enviarEmail(o.empresaId, {
    tipo: TIPO_TPL_ORC[tipo], para: o.cliente.email ?? "", cc: ccDoCliente(o.cliente), referenciaId: o.id, referenciaTipo: "Orcamento",
    variaveis: { cliente_nome: o.cliente.nomeFantasia ?? o.cliente.nome, numero_orcamento: o.codigo, valor: formatarMoeda(Number(o.totalGeral)), dias_para_vencer: String(Math.max(0, dias)), data_aprovacao: o.assinadoEm ? formatarData(o.assinadoEm) : "", link_orcamento: `${baseUrl()}/orcamento/${o.tokenPublico}` },
  });
}

export async function enviarOS(ordemServicoId: string, tipo: "aberta" | "concluida"): Promise<ResultadoEmail> {
  const os = await prisma.ordemServico.findUnique({ where: { id: ordemServicoId }, include: { cliente: true } });
  if (!os) return { ok: false, erro: "OS não encontrada." };
  const cfg = await prisma.emailConfig.findUnique({ where: { empresaId: os.empresaId } });
  const toggle = tipo === "concluida" ? cfg?.notifOsConcluida : cfg?.notifOsAberta;
  if (!toggle || !os.cliente.emailReceberOs) return { ok: false, erro: "Notificação desativada." };
  return enviarEmail(os.empresaId, {
    tipo: tipo === "concluida" ? "OS_CONCLUIDA" : "OS_CONCLUIDA", para: os.cliente.email ?? "", cc: ccDoCliente(os.cliente), referenciaId: os.id, referenciaTipo: "OrdemServico",
    variaveis: { cliente_nome: os.cliente.nomeFantasia ?? os.cliente.nome, numero_os: os.numero, link_documento: "" },
  });
}
