/**
 * Observação em ÁUDIO (gravada no celular quando não dá para ditar nem digitar — ex.: sem sinal).
 * O tipo é conferido pelos BYTES (nunca pelo prefixo do data URL): WebM/Opus (Chrome/Android),
 * MP4/AAC (Safari/iPhone), Ogg, WAV e MP3. Servida com o tipo detectado, sem executar nada.
 */
import { decodificarDataUrl } from "@/lib/anexos-server";

export const TAMANHO_MAX_AUDIO = 3 * 1024 * 1024; // ~3 min de voz em Opus/AAC
export const MSG_AUDIO_INVALIDO = "Áudio inválido: grave de novo pelo app.";

const comeca = (b: Uint8Array, sig: number[], off = 0) => b.length >= off + sig.length && sig.every((x, i) => b[off + i] === x);

/** Tipo do áudio pelos bytes iniciais (null = não é um áudio aceito). */
export function tipoAudio(b: Uint8Array): string | null {
  if (comeca(b, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  if (comeca(b, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  if (comeca(b, [0x52, 0x49, 0x46, 0x46]) && comeca(b, [0x57, 0x41, 0x56, 0x45], 8)) return "audio/wav";
  if (comeca(b, [0x49, 0x44, 0x33]) || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (comeca(b, [0x66, 0x74, 0x79, 0x70], 4)) {
    const marca = String.fromCharCode(...b.slice(8, 12));
    if (["M4A ", "mp42", "isom", "iso2", "iso5", "iso6", "mp41", "dash", "3gp4", "3gp5"].includes(marca)) return "audio/mp4";
  }
  return null;
}

export type AudioValidado = { ok: true; dataUrl: string; tipo: string; tamanho: number } | { ok: false; erro: string };

/** Valida um áudio enviado como data URL (tamanho e tipo pelo conteúdo) e regrava o prefixo com o tipo real. */
export function validarAudio(dataUrl: string): AudioValidado {
  if (dataUrl.length > Math.ceil(TAMANHO_MAX_AUDIO * 1.4) + 100) return { ok: false, erro: "Áudio muito longo: grave até 3 minutos." };
  const bytes = decodificarDataUrl(dataUrl);
  if (!bytes || !bytes.length) return { ok: false, erro: MSG_AUDIO_INVALIDO };
  if (bytes.length > TAMANHO_MAX_AUDIO) return { ok: false, erro: "Áudio muito longo: grave até 3 minutos." };
  const tipo = tipoAudio(bytes);
  if (!tipo) return { ok: false, erro: MSG_AUDIO_INVALIDO };
  return { ok: true, dataUrl: `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`, tipo, tamanho: bytes.length };
}

/** Resposta HTTP do áudio gravado (tipo pelo conteúdo; nada executa). */
export function respostaAudio(dataUrl: string, nome: string): Response {
  const bytes = decodificarDataUrl(dataUrl) ?? new Uint8Array();
  const tipo = tipoAudio(bytes) ?? "application/octet-stream";
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; media-src 'self'; sandbox",
    },
  });
}
