/**
 * PlugNotas FALSO para os testes, no nível do `fetch` (como o Resend é mockado): responde como a
 * API (x-api-key, POST/GET /certificado, GET/POST/PATCH /empresa) em sandbox e produção, guarda o
 * que foi cadastrado e registra cada chamada (sem expor a senha fora do registro de teste).
 * Também responde ViaCEP e BrasilAPI (municípios do IBGE) para a busca do código do município.
 */
import { vi } from "vitest";

export const SANDBOX = "https://api.sandbox.plugnotas.com.br";
export const PRODUCAO = "https://api.plugnotas.com.br";

export interface Chamada { metodo: string; url: string; base: string; caminho: string; token: string | null; json?: any; form?: { campos: Record<string, string>; arquivo?: { nome: string; tamanho: number; tipo: string } } }

export function criarPlugNotasFalso() {
  const estado = {
    chamadas: [] as Chamada[],
    tokens: { [SANDBOX]: "token-sandbox", [PRODUCAO]: "token-producao" } as Record<string, string>,
    empresas: {} as Record<string, Record<string, any>>, // base|cnpj → corpo
    certificados: {} as Record<string, { id: string; vencimento: string; base: string }>,
    vencimentoCertificado: "2027-10-01T00:00:00.000Z",
    /** força uma resposta: chave "METODO /caminho" (ou "METODO /prefixo*") → { status, corpo } */
    falhas: {} as Record<string, { status: number; corpo: unknown } | "rede" | "tempo">,
    viacep: {} as Record<string, unknown>,
    ibge: {} as Record<string, unknown>,
    seq: 0,
  };

  const resposta = (status: number, corpo: unknown) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

  async function fetchFalso(entrada: string | URL, init: RequestInit = {}): Promise<Response> {
    const url = String(entrada);
    if (url.startsWith("https://viacep.com.br/ws/")) {
      const cep = url.split("/")[4];
      return cep in estado.viacep ? resposta(200, estado.viacep[cep]) : resposta(200, { erro: true });
    }
    if (url.startsWith("https://brasilapi.com.br/api/ibge/municipios/v1/")) {
      const uf = url.split("/").pop()!;
      return uf in estado.ibge ? resposta(200, estado.ibge[uf]) : resposta(404, { message: "UF inválida" });
    }
    const base = [SANDBOX, PRODUCAO].find((b) => url.startsWith(b));
    if (!base) throw new Error(`fetch inesperado nos testes: ${url}`);
    const caminho = url.slice(base.length);
    const metodo = String(init.method ?? "GET");
    const headers = new Headers(init.headers);
    const ch: Chamada = { metodo, url, base, caminho, token: headers.get("x-api-key") };
    if (init.body instanceof FormData) {
      const campos: Record<string, string> = {};
      let arquivo: { nome: string; tamanho: number; tipo: string } | undefined;
      for (const [k, v] of init.body.entries()) {
        if (typeof v === "string") campos[k] = v;
        else arquivo = { nome: (v as File).name, tamanho: (v as Blob).size, tipo: (v as Blob).type };
      }
      ch.form = { campos, arquivo };
    } else if (typeof init.body === "string") ch.json = JSON.parse(init.body);
    estado.chamadas.push(ch);

    const chave = `${metodo} ${caminho}`;
    const falha = estado.falhas[chave] ?? Object.entries(estado.falhas).find(([k]) => k.endsWith("*") && chave.startsWith(k.slice(0, -1)))?.[1];
    if (falha === "rede") throw new TypeError("fetch failed");
    if (falha === "tempo") { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; }
    if (falha) return resposta(falha.status, falha.corpo);
    if (ch.token !== estado.tokens[base]) return resposta(401, { error: { message: "Unauthorized" } });

    if (metodo === "POST" && caminho === "/certificado") {
      if (!ch.form?.arquivo || !ch.form.campos.senha) return resposta(400, { error: { message: "Arquivo e senha são obrigatórios" } });
      const id = `cert-${++estado.seq}`;
      estado.certificados[id] = { id, vencimento: estado.vencimentoCertificado, base };
      return resposta(200, { message: "Certificado cadastrado com sucesso", data: { id } });
    }
    const mCert = caminho.match(/^\/certificado\/(.+)$/);
    if (metodo === "GET" && mCert) {
      const c = estado.certificados[decodeURIComponent(mCert[1])];
      return c && c.base === base ? resposta(200, { id: c.id, vencimento: c.vencimento }) : resposta(404, { error: { message: "Certificado não encontrado" } });
    }
    const mEmp = caminho.match(/^\/empresa\/(\d+)$/);
    if (metodo === "GET" && mEmp) {
      const e = estado.empresas[`${base}|${mEmp[1]}`];
      return e ? resposta(200, e) : resposta(404, { error: { message: "Empresa não encontrada" } });
    }
    if (metodo === "POST" && caminho === "/empresa") {
      const k = `${base}|${ch.json.cpfCnpj}`;
      if (estado.empresas[k]) return resposta(409, { error: { message: "Empresa já cadastrada" } });
      if (!estado.certificados[ch.json.certificado]) return resposta(400, { error: { message: "Certificado não encontrado", data: { certificado: ch.json.certificado } } });
      estado.empresas[k] = ch.json;
      return resposta(200, { message: "Empresa cadastrada com sucesso", data: { cnpj: ch.json.cpfCnpj } });
    }
    if (metodo === "PATCH" && mEmp) {
      const k = `${base}|${mEmp[1]}`;
      if (!estado.empresas[k]) return resposta(404, { error: { message: "Empresa não encontrada" } });
      estado.empresas[k] = { ...estado.empresas[k], ...ch.json };
      return resposta(200, { message: "Empresa alterada com sucesso" });
    }
    return resposta(404, { error: { message: `Rota falsa não encontrada: ${chave}` } });
  }

  const fetchMock = vi.fn(fetchFalso);
  return {
    estado,
    fetchMock,
    instalar() {
      vi.stubGlobal("fetch", fetchMock);
      process.env.PLUGNOTAS_API_TOKEN = estado.tokens[SANDBOX];
      delete process.env.PLUGNOTAS_API_TOKEN_PRODUCAO;
      delete process.env.PLUGNOTAS_API_URL;
      delete process.env.PLUGNOTAS_API_URL_PRODUCAO;
    },
    zerar() {
      estado.chamadas = []; estado.empresas = {}; estado.certificados = {}; estado.falhas = {}; estado.viacep = {}; estado.ibge = {};
      estado.vencimentoCertificado = "2027-10-01T00:00:00.000Z";
      fetchMock.mockClear();
    },
    /** só as chamadas ao PlugNotas, como "METODO /caminho" */
    rotas: () => estado.chamadas.map((c) => `${c.metodo} ${c.caminho}`),
  };
}
