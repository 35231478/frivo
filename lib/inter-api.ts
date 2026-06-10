import https from "https";
import { prisma } from "@/lib/prisma";
import { descriptografar } from "@/lib/crypto";

/**
 * Cliente da API do Banco Inter (Cobrança v3). A API exige mTLS: além do
 * client_id/secret (OAuth2 client_credentials), é obrigatório enviar o certificado
 * (.crt) e a chave (.key) emitidos no Internet Banking PJ do Inter. Tudo fica
 * criptografado no banco (model IntegracaoInter) e é descriptografado aqui.
 *
 * Como não há credenciais reais em desenvolvimento, todas as funções lançam erro
 * claro quando a integração não está configurada/ativa.
 */

export interface ConfigInter {
  ambiente: "SANDBOX" | "PRODUCAO";
  clientId: string;
  clientSecret: string;
  contaCorrente: string | null;
  certificado: string;
  chavePrivada: string;
}

function baseUrl(ambiente: string): string {
  return ambiente === "PRODUCAO"
    ? "https://cdpj.partners.bancointer.com.br"
    : "https://cdpj-sandbox.partners.uatinter.co";
}

/** Carrega e descriptografa a configuração do Inter da empresa. */
export async function carregarConfigInter(empresaId: string): Promise<{ ativo: boolean; config: ConfigInter | null }> {
  const reg = await prisma.integracaoInter.findUnique({ where: { empresaId } });
  if (!reg) return { ativo: false, config: null };

  const clientId = reg.clientId;
  const clientSecret = descriptografar(reg.clientSecret);
  const certificado = descriptografar(reg.certificado);
  const chavePrivada = descriptografar(reg.chavePrivada);
  const completo = !!(clientId && clientSecret && certificado && chavePrivada);

  return {
    ativo: reg.ativo && completo,
    config: completo
      ? { ambiente: reg.ambiente, clientId: clientId!, clientSecret: clientSecret!, contaCorrente: reg.contaCorrente, certificado: certificado!, chavePrivada: chavePrivada! }
      : null,
  };
}

interface Resposta { status: number; json: any }

/** Requisição HTTPS com mTLS (certificado do cliente) para a API do Inter. */
function requisicao(cfg: ConfigInter, path: string, opts: { method?: string; token?: string; body?: any; form?: Record<string, string> }): Promise<Resposta> {
  const url = new URL(baseUrl(cfg.ambiente) + path);
  const payload = opts.form ? new URLSearchParams(opts.form).toString() : opts.body ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string | number> = {};
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  else if (opts.body) headers["Content-Type"] = "application/json";
  if (cfg.contaCorrente) headers["x-conta-corrente"] = cfg.contaCorrente;
  if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: opts.method ?? "GET",
        cert: cfg.certificado,
        key: cfg.chavePrivada,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: any = null;
          try { json = data ? JSON.parse(data) : null; } catch { json = data; }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Cache de token em memória por empresa
const tokenCache = new Map<string, { token: string; expira: number }>();

async function obterToken(empresaId: string, cfg: ConfigInter): Promise<string> {
  const cached = tokenCache.get(empresaId);
  if (cached && cached.expira > Date.now() + 30_000) return cached.token;

  const r = await requisicao(cfg, "/oauth/v2/token", {
    method: "POST",
    form: {
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "boleto-cobranca.read boleto-cobranca.write webhook.read webhook.write",
    },
  });
  if (r.status !== 200 || !r.json?.access_token) {
    throw new Error(`Falha na autenticação com o Inter (${r.status}): ${r.json?.title ?? r.json?.message ?? "verifique credenciais e certificado"}`);
  }
  const token = r.json.access_token as string;
  const expira = Date.now() + (Number(r.json.expires_in ?? 3600) * 1000);
  tokenCache.set(empresaId, { token, expira });
  return token;
}

/** Testa as credenciais obtendo um token OAuth2. */
export async function testarConexaoInter(empresaId: string): Promise<{ ok: boolean; erro?: string }> {
  const { config } = await carregarConfigInter(empresaId);
  if (!config) return { ok: false, erro: "Integração incompleta. Preencha credenciais, conta e certificado." };
  try {
    await obterToken(empresaId, config);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e?.message ?? "Erro desconhecido" };
  }
}

export interface DadosBoleto {
  seuNumero: string;          // referência interna (ex: número da conta a receber)
  valorNominal: number;
  dataVencimento: string;     // yyyy-mm-dd
  mensagem?: string;
  descontoValor?: number;     // R$ desconto (opcional)
  multaPercentual?: number;   // ex: 2
  jurosPercentualMes?: number; // ex: 1
  pagador: {
    nome: string;
    cpfCnpj: string;
    tipoPessoa: "FISICA" | "JURIDICA";
    cep?: string; endereco?: string; numero?: string; bairro?: string; cidade?: string; uf?: string;
  };
}

export interface BoletoEmitido {
  codigoSolicitacao: string;
  nossoNumero: string | null;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
}

/** Emite um boleto (cobrança v3) e retorna os identificadores. */
export async function emitirBoletoInter(empresaId: string, d: DadosBoleto): Promise<BoletoEmitido> {
  const { ativo, config } = await carregarConfigInter(empresaId);
  if (!ativo || !config) throw new Error("Integração com o Banco Inter não está configurada ou ativa.");
  const token = await obterToken(empresaId, config);

  const apenasNumeros = (s: string) => s.replace(/\D/g, "");
  const body: any = {
    seuNumero: d.seuNumero.slice(0, 15),
    valorNominal: Number(d.valorNominal.toFixed(2)),
    dataVencimento: d.dataVencimento,
    numDiasAgenda: 0,
    pagador: {
      cpfCnpj: apenasNumeros(d.pagador.cpfCnpj),
      tipoPessoa: d.pagador.tipoPessoa,
      nome: d.pagador.nome,
      cep: apenasNumeros(d.pagador.cep ?? "") || "00000000",
      endereco: d.pagador.endereco ?? "Não informado",
      numero: d.pagador.numero ?? "S/N",
      bairro: d.pagador.bairro ?? "Centro",
      cidade: d.pagador.cidade ?? "Não informado",
      uf: d.pagador.uf ?? "SP",
    },
  };
  if (d.mensagem) body.mensagem = { linha1: d.mensagem.slice(0, 78) };
  if (d.descontoValor && d.descontoValor > 0) {
    body.desconto = { codigoDesconto: "VALORFIXODATAINFORMADA", taxa: 0, valor: Number(d.descontoValor.toFixed(2)), quantidadeDias: 0 };
  }
  if (d.multaPercentual && d.multaPercentual > 0) {
    body.multa = { codigoMulta: "PERCENTUAL", taxa: d.multaPercentual, valor: 0 };
  }
  if (d.jurosPercentualMes && d.jurosPercentualMes > 0) {
    body.mora = { codigoMora: "TAXAMENSAL", taxa: d.jurosPercentualMes, valor: 0 };
  }

  const r = await requisicao(config, "/cobranca/v3/cobrancas", { method: "POST", token, body });
  if (r.status !== 200 && r.status !== 201 || !r.json?.codigoSolicitacao) {
    throw new Error(`Falha ao emitir boleto (${r.status}): ${detalheErro(r.json)}`);
  }
  const codigoSolicitacao = r.json.codigoSolicitacao as string;

  // Busca os dados do boleto recém-emitido
  let nossoNumero: string | null = null, linhaDigitavel: string | null = null, codigoBarras: string | null = null;
  try {
    const det = await consultarBoletoInter(empresaId, codigoSolicitacao);
    nossoNumero = det?.boleto?.nossoNumero ?? det?.cobranca?.nossoNumero ?? null;
    linhaDigitavel = det?.boleto?.linhaDigitavel ?? null;
    codigoBarras = det?.boleto?.codigoBarras ?? null;
  } catch { /* segue com o código de solicitação */ }

  return { codigoSolicitacao, nossoNumero, linhaDigitavel, codigoBarras };
}

/** Consulta a situação/dados de uma cobrança pelo código de solicitação. */
export async function consultarBoletoInter(empresaId: string, codigoSolicitacao: string): Promise<any> {
  const { config } = await carregarConfigInter(empresaId);
  if (!config) throw new Error("Integração não configurada.");
  const token = await obterToken(empresaId, config);
  const r = await requisicao(config, `/cobranca/v3/cobrancas/${codigoSolicitacao}`, { method: "GET", token });
  if (r.status !== 200) throw new Error(`Falha ao consultar boleto (${r.status}): ${detalheErro(r.json)}`);
  return r.json;
}

/** Cancela um boleto ainda não pago. */
export async function cancelarBoletoInter(empresaId: string, codigoSolicitacao: string, motivo = "Cancelado pelo emissor"): Promise<void> {
  const { config } = await carregarConfigInter(empresaId);
  if (!config) throw new Error("Integração não configurada.");
  const token = await obterToken(empresaId, config);
  const r = await requisicao(config, `/cobranca/v3/cobrancas/${codigoSolicitacao}/cancelamento`, {
    method: "POST", token, body: { motivoCancelamento: motivo },
  });
  if (r.status !== 200 && r.status !== 204) throw new Error(`Falha ao cancelar boleto (${r.status}): ${detalheErro(r.json)}`);
}

/** Baixa o PDF do boleto em base64 (data URL). */
export async function baixarPdfBoletoInter(empresaId: string, codigoSolicitacao: string): Promise<string> {
  const { config } = await carregarConfigInter(empresaId);
  if (!config) throw new Error("Integração não configurada.");
  const token = await obterToken(empresaId, config);
  const r = await requisicao(config, `/cobranca/v3/cobrancas/${codigoSolicitacao}/pdf`, { method: "GET", token });
  if (r.status !== 200 || !r.json?.pdf) throw new Error(`Falha ao baixar PDF (${r.status}): ${detalheErro(r.json)}`);
  return `data:application/pdf;base64,${r.json.pdf}`;
}

/** Configura a URL de webhook de cobrança no Inter. */
export async function configurarWebhookInter(empresaId: string, webhookUrl: string): Promise<void> {
  const { config } = await carregarConfigInter(empresaId);
  if (!config) throw new Error("Integração não configurada.");
  const token = await obterToken(empresaId, config);
  const r = await requisicao(config, "/cobranca/v3/cobrancas/webhook", { method: "PUT", token, body: { webhookUrl } });
  if (r.status !== 200 && r.status !== 204) throw new Error(`Falha ao configurar webhook (${r.status}): ${detalheErro(r.json)}`);
}

function detalheErro(json: any): string {
  if (!json) return "sem detalhes";
  if (typeof json === "string") return json;
  return json.detail ?? json.title ?? json.message ?? json.error_description ?? JSON.stringify(json).slice(0, 200);
}
