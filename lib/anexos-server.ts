import { NextResponse } from "next/server";
import {
  identificarTipo, MSG_TIPO_NAO_PERMITIDO, nomeSeguro, podeVisualizarInline, TAMANHO_MAX_ANEXO, TIPOS_ANEXO, TIPOS_IMAGEM,
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

// ───────────────────────── Fotos (equipamento, veículo, avatar, logo) ─────────────────────────

const MSG_FOTO = "Envie apenas imagens (JPG, PNG, WEBP ou HEIC).";
const TAMANHO_MAX_FOTO = 3 * 1024 * 1024; // 3 MB por foto (as telas já reduzem para ~300 KB)

/**
 * Valida uma foto enviada como data URL: o tipo é decidido pelos BYTES (um HTML/SVG
 * disfarçado de "image/png" é recusado) e o retorno traz o data URL normalizado com o
 * MIME real — é esse valor que deve ser gravado.
 */
export function validarFoto(conteudo: string, op: Opcoes = {}): ResultadoValidacao {
  return validarDataUrl(conteudo, "foto", { tipos: TIPOS_IMAGEM, tamanhoMax: TAMANHO_MAX_FOTO, mensagemTipo: MSG_FOTO, ...op });
}

/** Valida uma lista de fotos; devolve a lista normalizada (MIME real) ou o 1º erro. */
export function validarFotos(fotos: readonly string[] | undefined, op: Opcoes = {}):
  { ok: true; fotos: string[] } | { ok: false; erro: string } {
  const lista = fotos ?? [];
  const saida: string[] = [];
  for (let i = 0; i < lista.length; i++) {
    const r = validarFoto(lista[i], op);
    if (!r.ok) return { ok: false, erro: `Foto ${i + 1}: ${r.erro}` };
    saida.push(r.arquivo.conteudo);
  }
  return { ok: true, fotos: saida };
}

/**
 * Valida o arquivo de um documento (colaborador/veículo) gravado como data URL:
 * mesmos tipos dos anexos (PDF, Office e imagens), decididos pelos bytes.
 */
export function validarDocumentoDataUrl(arquivoUrl: string | null | undefined, nome: string):
  { ok: true; conteudo: string | null } | { ok: false; erro: string } {
  if (!arquivoUrl) return { ok: true, conteudo: null };
  const r = validarDataUrl(arquivoUrl, nome);
  if (!r.ok) return { ok: false, erro: `Documento "${nome}": ${r.erro}` };
  return { ok: true, conteudo: r.arquivo.conteudo };
}

/**
 * Serve uma foto gravada como data URL. O Content-Type sai dos BYTES reais e só imagem
 * comum é servida — um HTML/SVG ou uma URL gravados no passado viram 404, nunca executam
 * e nunca redirecionam. Sempre com `nosniff` + CSP sandbox.
 */
export function respostaFoto(valor: string | null | undefined): Response {
  const semFoto = () => NextResponse.json({ erro: "Sem foto" }, { status: 404 });
  if (!valor) return semFoto();
  const bytes = decodificarDataUrl(valor);
  if (!bytes) return semFoto();
  const tipo = identificarTipo(bytes);
  if (!tipo || !(TIPOS_IMAGEM as readonly string[]).includes(tipo)) return semFoto();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
