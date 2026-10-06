import {
  identificarTipo, MSG_TIPO_NAO_PERMITIDO, nomeSeguro, podeVisualizarInline, TAMANHO_MAX_ANEXO, TIPOS_ANEXO,
} from "@/lib/anexos";

export type ArquivoValidado = { nome: string; tipo: string; tamanho: number; conteudo: string };
export type ResultadoValidacao = { ok: true; arquivo: ArquivoValidado } | { ok: false; erro: string };

interface Opcoes {
  /** Tipos aceitos (padrão: documentos + imagens). */
  tipos?: readonly string[];
  tamanhoMax?: number;
  mensagemTipo?: string;
}

const erroTamanho = (max: number): ResultadoValidacao =>
  ({ ok: false, erro: `Arquivo muito grande. Tamanho máximo: ${Math.round(max / 1024 / 1024)} MB.` });

function validarBytes(bytes: Uint8Array, nomeOriginal: string, op: Opcoes): ResultadoValidacao {
  const tamanhoMax = op.tamanhoMax ?? TAMANHO_MAX_ANEXO;
  if (bytes.length === 0) return { ok: false, erro: "Arquivo vazio." };
  if (bytes.length > tamanhoMax) return erroTamanho(tamanhoMax);
  const nome = nomeSeguro(nomeOriginal);
  const tipo = identificarTipo(bytes, nome);
  if (!tipo || !(op.tipos ?? TIPOS_ANEXO).includes(tipo)) {
    return { ok: false, erro: op.mensagemTipo ?? MSG_TIPO_NAO_PERMITIDO };
  }
  const conteudo = `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;
  return { ok: true, arquivo: { nome, tipo, tamanho: bytes.length, conteudo } };
}

/** Valida um arquivo vindo de multipart/form-data. O tipo gravado é o detectado pelo conteúdo. */
export async function validarArquivoUpload(file: File, op: Opcoes = {}): Promise<ResultadoValidacao> {
  const tamanhoMax = op.tamanhoMax ?? TAMANHO_MAX_ANEXO;
  // Recusa antes de ler o arquivo inteiro na memória
  if (file.size > tamanhoMax) return erroTamanho(tamanhoMax);
  return validarBytes(new Uint8Array(await file.arrayBuffer()), file.name, op);
}

/** Decodifica um data URL base64 (sem confiar no MIME do prefixo). */
export function decodificarDataUrl(conteudo: string): Uint8Array | null {
  const m = /^data:[^;,]*(?:;[^;,]*)*;base64,([\s\S]*)$/.exec(conteudo);
  if (!m) return null;
  return new Uint8Array(Buffer.from(m[1], "base64"));
}

/** Valida um arquivo enviado como data URL dentro de JSON (portal, cadastro de cliente). */
export function validarDataUrl(conteudo: string, nome: string, op: Opcoes = {}): ResultadoValidacao {
  const tamanhoMax = op.tamanhoMax ?? TAMANHO_MAX_ANEXO;
  // base64 ocupa ~4/3 do binário; corta strings absurdas antes de decodificar
  if (conteudo.length > Math.ceil(tamanhoMax * 1.4) + 100) return erroTamanho(tamanhoMax);
  const bytes = decodificarDataUrl(conteudo);
  if (!bytes) return { ok: false, erro: op.mensagemTipo ?? "Arquivo inválido." };
  return validarBytes(bytes, nome, op);
}

/**
 * Resposta HTTP para baixar/visualizar um anexo gravado como data URL.
 * O Content-Type sai do conteúdo real (registros antigos podem ter qualquer coisa gravada);
 * só imagens comuns e PDF abrem inline, e sempre com `nosniff` + CSP restritiva — um
 * HTML/SVG gravado no passado é entregue como download binário, sem executar.
 */
export function respostaAnexo(anexo: { nome: string; conteudo: string }, inlinePedido: boolean): Response {
  const bytes = decodificarDataUrl(anexo.conteudo) ?? new Uint8Array(Buffer.from(anexo.conteudo, "base64"));
  const nome = nomeSeguro(anexo.nome);
  const detectado = identificarTipo(bytes, nome);
  const tipo = detectado ?? "application/octet-stream";
  const inline = inlinePedido && podeVisualizarInline(tipo);

  const headers: Record<string, string> = {
    "Content-Type": tipo,
    "Content-Length": String(bytes.length),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nome)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  // O visualizador de PDF do navegador não abre em documento "sandbox"; para o resto, sandbox total.
  if (tipo !== "application/pdf") {
    headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
  }
  return new Response(Buffer.from(bytes), { headers });
}
