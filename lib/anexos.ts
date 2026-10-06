/**
 * Regras de anexos (upload/visualização) — arquivo puro, usável no servidor e no client.
 *
 * O tipo do arquivo é decidido pelo CONTEÚDO (assinatura dos primeiros bytes), nunca
 * pelo `type` que o navegador/cliente declara nem pelo prefixo de um data URL: assim um
 * HTML/SVG disfarçado de "image/png" não entra, e o que já está gravado é servido com um
 * tipo seguro.
 */

export const TIPOS_IMAGEM = ["image/png", "image/jpeg", "image/webp", "image/heic"] as const;

export const TIPOS_DOCUMENTO = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/** Anexos de OS, cliente e contrato: documentos e imagens. */
export const TIPOS_ANEXO: readonly string[] = [...TIPOS_DOCUMENTO, ...TIPOS_IMAGEM];

/** Tipos que podem abrir no navegador ("Visualizar"); o resto é sempre baixado. */
export const TIPOS_INLINE: readonly string[] = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

/** Valor do atributo `accept` dos inputs de arquivo de anexo. */
export const ACCEPT_ANEXO = ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.heic";

export const TAMANHO_MAX_ANEXO = 5 * 1024 * 1024; // 5 MB
export const MAX_FOTOS_CHAMADO = 6;

export const MSG_TIPO_NAO_PERMITIDO = "Tipo de arquivo não permitido. Envie PDF, DOC, XLS ou imagem (JPG, PNG, WEBP).";

export const podeVisualizarInline = (tipo: string) => TIPOS_INLINE.includes(tipo);

function comeca(bytes: Uint8Array, assinatura: number[], offset = 0) {
  if (bytes.length < offset + assinatura.length) return false;
  return assinatura.every((b, i) => bytes[offset + i] === b);
}

function extensao(nome: string) {
  const i = nome.lastIndexOf(".");
  return i >= 0 ? nome.slice(i + 1).toLowerCase() : "";
}

/**
 * Identifica o tipo real do arquivo pelos bytes iniciais. Retorna um MIME da lista
 * `TIPOS_ANEXO` ou `null` se não for um formato aceito.
 * Office (DOCX/XLSX são ZIP; DOC/XLS são OLE) é desambiguado pela extensão do nome.
 */
export function identificarTipo(bytes: Uint8Array, nome = ""): string | null {
  if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (comeca(bytes, [0x52, 0x49, 0x46, 0x46]) && comeca(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (comeca(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  // HEIC/HEIF (fotos de iPhone): "ftyp" no byte 4 + marca heic/heix/heim/heis/mif1/msf1
  if (comeca(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const marca = String.fromCharCode(...bytes.slice(8, 12));
    if (["heic", "heix", "heim", "heis", "mif1", "msf1", "hevc"].includes(marca)) return "image/heic";
    return null;
  }
  const ext = extensao(nome);
  if (comeca(bytes, [0x50, 0x4b, 0x03, 0x04])) { // ZIP
    if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return null;
  }
  if (comeca(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) { // OLE (Office antigo)
    if (ext === "doc") return "application/msword";
    if (ext === "xls") return "application/vnd.ms-excel";
    return null;
  }
  return null;
}

/** Nome de arquivo seguro para gravar/exibir (sem caminho nem caracteres de controle). */
export function nomeSeguro(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const limpo = base.replace(/[\u0000-\u001f\u007f"<>]/g, "").trim().slice(0, 200);
  return limpo || "arquivo";
}
