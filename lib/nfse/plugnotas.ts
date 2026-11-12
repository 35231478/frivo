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
 *   POST  /nfse                   emite (array de notas; mandamos uma por vez) → { documents: [{ id }], protocol }
 *   GET   /nfse/consultar/{id}    situação da nota (id do PlugNotas); sem a rota "consultar", tenta /nfse/{id}
 *   GET   /nfse/consultar/{idIntegracao}/{cnpj}  a mesma consulta pelo NOSSO id (quando o envio ficou sem resposta)
 *   GET   /nfse/pdf/{id}, /nfse/xml/{id}         o DANFSE e o XML (a tela baixa pelo nosso servidor: exigem o token)
 *   POST  /empresa/{cpfCnpj}/webhook  cadastra o aviso automático da empresa (já existe = PUT no mesmo caminho)
 *
 * Segurança: o certificado e a senha só passam por aqui em memória, vão por HTTPS e não são
 * gravados nem registrados em log; as mensagens de erro nunca incluem o token, o arquivo ou a senha.
 *   - a base precisa ser https:// (http só para localhost, em desenvolvimento): uma URL errada no
 *     ambiente não pode mandar token, .pfx e senha em texto aberto;
 *   - redirecionamento é recusado (`redirect: "error"`): o fetch repassaria o `x-api-key` (e, num
 *     307/308, o .pfx e a senha) para outro endereço;
 *   - a mensagem que vem do PlugNotas é repassada à tela e guardada em `ultimo_erro`: antes disso,
 *     o token e as senhas (do certificado e da prefeitura) são tirados dela, caso a API os ecoe.
 */
import { mensagemErroPlugNotas, type Ambiente, type CorpoEmpresaPlugNotas } from "@/lib/nfse/regras";
import { lerEmissao } from "@/lib/nfse/nota";

export class ErroPlugNotas extends Error {
  constructor(message: string, public status = 502) { super(message); }
  /** Não dá para saber se o PlugNotas recebeu (rede, tempo, erro 5xx deles): consulte antes de reenviar */
  get incerto() { return this.status >= 500; }
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

/** Mensagem vinda do PlugNotas (consulta/webhook) pronta para gravar/mostrar: sem os tokens do servidor */
export const mensagemLimpa = (texto: string) =>
  semSegredos(texto, AMBIENTES_TOKEN.map((a) => process.env[BASES[a].envToken]?.trim()));
const AMBIENTES_TOKEN: Ambiente[] = ["HOMOLOGACAO", "PRODUCAO"];

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

async function requisitar(ambiente: Ambiente, caminho: string, init: { method: string; json?: unknown; form?: FormData; accept?: string }) {
  const { base, token } = conexao(ambiente);
  let res: Response;
  try {
    res = await fetch(`${base}${caminho}`, {
      method: init.method,
      headers: { "x-api-key": token, Accept: init.accept ?? "application/json", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    const tempo = (e as Error)?.name === "TimeoutError";
    throw new ErroPlugNotas(tempo ? "O PlugNotas não respondeu a tempo. Tente de novo." : "Não foi possível falar com o PlugNotas (rede). Tente de novo.", 504);
  }
  return { res, token };
}

async function chamar(ambiente: Ambiente, caminho: string, init: { method: string; json?: unknown; form?: FormData }) {
  const { res, token } = await requisitar(ambiente, caminho, init);
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
  // a senha da prefeitura vai no corpo: se a API a ecoar no erro, sai da mensagem como o token
  if (!r.ok) throw falha(r, corpo.nfse?.config?.prefeitura?.senha ?? "");
  return existe ? "atualizado" : "cadastrado";
}

/* ───────── NFS-e ───────── */

/**
 * Envia UMA nota (o POST /nfse recebe um array). Devolve o id dela no PlugNotas e o protocolo.
 * Recusa de validação = ErroPlugNotas 422 (com os campos); sem resposta/5xx = `incerto` (pode ter
 * chegado: a consulta pelo idIntegracao decide). Aceito sem o id = também incerto.
 */
export async function emitirNfse(ambiente: Ambiente, nota: { idIntegracao: string }): Promise<{ id: string; protocolo: string | null }> {
  const r = await chamar(ambiente, "/nfse", { method: "POST", json: [nota] });
  if (!r.ok) throw falha(r);
  const lido = lerEmissao(r.corpo, nota.idIntegracao);
  if (!lido) throw new ErroPlugNotas("O PlugNotas recebeu o envio mas não devolveu o identificador da nota. Consulte o status antes de reenviar.", 502);
  return lido;
}

/** Situação da nota pelo id do PlugNotas ou pelo nosso idIntegracao (+ CNPJ do prestador). null = não existe lá */
export async function consultarNfse(ambiente: Ambiente, ref: { id?: string | null; idIntegracao: string; cnpj: string }): Promise<unknown | null> {
  const caminhos = ref.id
    ? [`/nfse/consultar/${encodeURIComponent(ref.id)}`, `/nfse/${encodeURIComponent(ref.id)}`]
    : [`/nfse/consultar/${encodeURIComponent(ref.idIntegracao)}/${encodeURIComponent(ref.cnpj)}`];
  for (const caminho of caminhos) {
    const r = await chamar(ambiente, caminho, { method: "GET" });
    if (r.status === 404) continue;
    if (!r.ok) throw falha(r);
    return r.corpo;
  }
  return null;
}

const TIPOS_ARQUIVO = { pdf: /^application\/pdf/i, xml: /(\/|\+)xml/i } as const;
/** Limite do arquivo baixado (um DANFSE tem dezenas de KB) */
export const MAX_ARQUIVO_NFSE = 10 * 1024 * 1024;

/** O PDF (DANFSE) ou o XML da nota, em bytes, para a tela baixar pelo nosso servidor */
export async function baixarNfse(ambiente: Ambiente, tipo: keyof typeof TIPOS_ARQUIVO, id: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { res, token } = await requisitar(ambiente, `/nfse/${tipo}/${encodeURIComponent(id)}`, { method: "GET", accept: tipo === "pdf" ? "application/pdf" : "application/xml" });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !TIPOS_ARQUIVO[tipo].test(contentType)) {
    const corpo = await res.json().catch(() => null);
    throw falha({ status: res.ok ? 502 : res.status, corpo, token });
  }
  const tamanho = Number(res.headers.get("content-length") ?? 0);
  if (tamanho > MAX_ARQUIVO_NFSE) throw new ErroPlugNotas("O arquivo da nota veio grande demais.", 502);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ARQUIVO_NFSE) throw new ErroPlugNotas("O arquivo da nota veio grande demais.", 502);
  return { bytes, contentType: tipo === "pdf" ? "application/pdf" : "application/xml" };
}

/**
 * Cadastra no PlugNotas o aviso automático (webhook) da empresa: a nossa URL (com o segredo da
 * empresa na query) e, de reforço, o mesmo segredo no cabeçalho Authorization. Já cadastrado (409)
 * = atualiza com PUT. Mensagem de erro sem o token, o segredo e a URL.
 */
export async function cadastrarWebhookNfse(ambiente: Ambiente, cnpj: string, url: string, segredo: string): Promise<void> {
  const corpo = { url, method: "POST", headers: { Authorization: `Bearer ${segredo}` } };
  const caminho = `/empresa/${encodeURIComponent(cnpj)}/webhook`;
  let r = await chamar(ambiente, caminho, { method: "POST", json: corpo });
  if (r.status === 409) r = await chamar(ambiente, caminho, { method: "PUT", json: corpo });
  if (!r.ok) throw falha(r, url, segredo);
}
