/**
 * Cliente HTTP do PlugNotas (TecnoSpeed) — o ÚNICO lugar que fala com a API deles.
 *
 * Ambientes (cada um com a sua base e o seu token, ambos do ambiente do servidor, nunca no código):
 *   HOMOLOGACAO → PLUGNOTAS_API_URL (padrão https://api.sandbox.plugnotas.com.br) + PLUGNOTAS_API_TOKEN
 *   PRODUCAO    → PLUGNOTAS_API_URL_PRODUCAO (padrão https://api.plugnotas.com.br) + PLUGNOTAS_API_TOKEN_PRODUCAO
 * Sem o token de produção, produção fica bloqueada (começamos SEMPRE em homologação).
 *
 * Endpoints usados (autenticação pelo cabeçalho `x-api-key`):
 *   POST  /certificado            multipart: arquivo (.pfx) + senha → { data: { id } }
 *   GET   /certificado/{id}       dados do certificado (vencimento)
 *   GET   /empresa/{cpfCnpj}      o emitente (404 = não cadastrado)
 *   POST  /empresa                cadastra o emitente
 *   PATCH /empresa/{cpfCnpj}      atualiza o emitente
 *
 * Segurança: o certificado e a senha só passam por aqui em memória, vão por HTTPS e não são
 * gravados nem registrados em log; as mensagens de erro nunca incluem o token, o arquivo ou a senha.
 *   - a base precisa ser https:// (http só para localhost, em desenvolvimento): uma URL errada no
 *     ambiente não pode mandar token, .pfx e senha em texto aberto;
 *   - redirecionamento é recusado (`redirect: "error"`): o fetch repassaria o `x-api-key` (e, num
 *     307/308, o .pfx e a senha) para outro endereço;
 *   - a mensagem que vem do PlugNotas é repassada à tela e guardada em `ultimo_erro`: antes disso,
 *     o token e a senha são tirados dela, caso a API os ecoe.
 */
import { mensagemErroPlugNotas, type Ambiente, type CorpoEmpresaPlugNotas } from "@/lib/nfse/regras";

export class ErroPlugNotas extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const BASES: Record<Ambiente, { url: string; envUrl: string; envToken: string }> = {
  HOMOLOGACAO: { url: "https://api.sandbox.plugnotas.com.br", envUrl: "PLUGNOTAS_API_URL", envToken: "PLUGNOTAS_API_TOKEN" },
  PRODUCAO: { url: "https://api.plugnotas.com.br", envUrl: "PLUGNOTAS_API_URL_PRODUCAO", envToken: "PLUGNOTAS_API_TOKEN_PRODUCAO" },
};
const TIMEOUT_MS = 20_000;
/** Tamanho máximo da mensagem do PlugNotas que repassamos (tela e `ultimo_erro`) */
const MAX_MENSAGEM = 600;
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A base só vale com https (ou http no próprio computador, para desenvolvimento) */
function baseSegura(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && LOCAL.has(u.hostname));
  } catch {
    return false;
  }
}

/** Tira do texto qualquer segredo (token, senha) que o PlugNotas tenha ecoado na mensagem */
export function semSegredos(texto: string, segredos: (string | null | undefined)[]): string {
  const limpo = segredos.reduce<string>((t, s) => (s && s.length >= 4 ? t.split(s).join("•••") : t), texto);
  return limpo.length > MAX_MENSAGEM ? `${limpo.slice(0, MAX_MENSAGEM - 1)}…` : limpo;
}

/** O servidor tem o token deste ambiente? (a tela usa para avisar antes de tentar) */
export function ambienteDisponivel(ambiente: Ambiente): boolean {
  return !!process.env[BASES[ambiente].envToken]?.trim();
}

function conexao(ambiente: Ambiente) {
  const b = BASES[ambiente];
  const token = process.env[b.envToken]?.trim();
  if (!token) {
    throw new ErroPlugNotas(ambiente === "PRODUCAO"
      ? "Produção ainda não está liberada neste servidor (falta PLUGNOTAS_API_TOKEN_PRODUCAO). Use homologação."
      : "A integração com o PlugNotas não está configurada neste servidor (falta PLUGNOTAS_API_TOKEN).", 503);
  }
  const base = (process.env[b.envUrl]?.trim() || b.url).replace(/\/$/, "");
  if (!baseSegura(base)) throw new ErroPlugNotas(`O endereço do PlugNotas (${b.envUrl}) precisa começar com https://. Nada foi enviado.`, 503);
  return { base, token };
}

async function chamar(ambiente: Ambiente, caminho: string, init: { method: string; json?: unknown; form?: FormData }) {
  const { base, token } = conexao(ambiente);
  let res: Response;
  try {
    res = await fetch(`${base}${caminho}`, {
      method: init.method,
      headers: { "x-api-key": token, Accept: "application/json", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    const tempo = (e as Error)?.name === "TimeoutError";
    throw new ErroPlugNotas(tempo ? "O PlugNotas não respondeu a tempo. Tente de novo." : "Não foi possível falar com o PlugNotas (rede). Tente de novo.", 504);
  }
  const corpo = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, corpo, token };
}

/** Erro do PlugNotas em português, sem o token nem os outros segredos da chamada (a senha) */
const falha = (r: { status: number; corpo: unknown; token: string }, ...segredos: string[]) =>
  new ErroPlugNotas(semSegredos(mensagemErroPlugNotas(r.status, r.corpo), [r.token, ...segredos]), r.status >= 500 ? 502 : 422);

/** Envia o .pfx e a senha; devolve o id do certificado no PlugNotas */
export async function enviarCertificado(ambiente: Ambiente, arquivo: Buffer, nomeArquivo: string, senha: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append("arquivo", new Blob([new Uint8Array(arquivo)], { type: "application/x-pkcs12" }), nomeArquivo || "certificado.pfx");
  form.append("senha", senha);
  const r = await chamar(ambiente, "/certificado", { method: "POST", form });
  const corpo = r.corpo as { data?: { id?: unknown }; id?: unknown; error?: { data?: { id?: unknown } } } | null;
  // Certificado que já estava lá: o PlugNotas devolve o id existente junto do erro
  const id = corpo?.data?.id ?? corpo?.id ?? (r.status === 409 ? corpo?.error?.data?.id : undefined);
  if ((r.ok || r.status === 409) && typeof id === "string" && id) return { id };
  throw falha(r, senha);
}

/** Vencimento do certificado no PlugNotas (null se a resposta não trouxer) */
export async function consultarCertificado(ambiente: Ambiente, id: string): Promise<{ vencimento: Date | null }> {
  const r = await chamar(ambiente, `/certificado/${encodeURIComponent(id)}`, { method: "GET" });
  if (!r.ok) throw falha(r);
  const c = ((r.corpo as { data?: unknown })?.data ?? r.corpo) as Record<string, unknown> | null;
  const bruto = c?.vencimento ?? c?.validade ?? c?.dataValidade;
  const d = typeof bruto === "string" ? new Date(bruto) : null;
  return { vencimento: d && !Number.isNaN(d.getTime()) ? d : null };
}

/** O emitente no PlugNotas; null = não cadastrado */
export async function consultarEmpresa(ambiente: Ambiente, cnpj: string): Promise<Record<string, unknown> | null> {
  const r = await chamar(ambiente, `/empresa/${cnpj}`, { method: "GET" });
  if (r.status === 404) return null;
  if (!r.ok) throw falha(r);
  return ((r.corpo as { data?: unknown })?.data ?? r.corpo) as Record<string, unknown>;
}

/** Cadastra (POST) ou atualiza (PATCH) o emitente; devolve qual foi */
export async function salvarEmpresa(ambiente: Ambiente, corpo: CorpoEmpresaPlugNotas, existe: boolean): Promise<"cadastrado" | "atualizado"> {
  const r = existe
    ? await chamar(ambiente, `/empresa/${corpo.cpfCnpj}`, { method: "PATCH", json: corpo })
    : await chamar(ambiente, "/empresa", { method: "POST", json: corpo });
  if (!r.ok) throw falha(r);
  return existe ? "atualizado" : "cadastrado";
}
