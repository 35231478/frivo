import Anthropic from "@anthropic-ai/sdk";

/**
 * Infraestrutura comum de leitura de fotos por IA (Claude com visão), usada pelo
 * cadastro de equipamento (etiqueta / placa da sala) e de veículo (CRLV).
 * - A chave vem de ANTHROPIC_API_KEY (nunca do código).
 * - A resposta tem formato fixo (JSON Schema estrito via structured outputs).
 * - Qualquer falha (sem chave, timeout, recusa, JSON inválido) vira `ErroOcr`; a tela
 *   cai para a digitação manual — o cadastro nunca trava por causa da IA.
 */

export const MODELO_OCR = "claude-opus-5-5";
const TIMEOUT_MS = 20_000; // por tentativa; o SDK repete 1x em timeout/429/5xx
export const TAMANHO_MAX_BYTES = 3 * 1024 * 1024; // a tela já reduz para ~1600px / JPEG (~200–500 KB)
export const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/webp"] as const;

export class ErroOcr extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

/** Campo de texto opcional no JSON Schema. */
export const texto = { anyOf: [{ type: "string" }, { type: "null" }] };
/** Campo de lista fechada (ou null) no JSON Schema. */
export const umDe = (valores: string[]) => ({ anyOf: [{ type: "string", enum: valores }, { type: "null" }] });

/** Separa "data:image/jpeg;base64,...." e valida tipo/tamanho. */
export function lerDataUrl(dataUrl: unknown): { mediaType: (typeof TIPOS_IMAGEM)[number]; base64: string } {
  const m = typeof dataUrl === "string" ? /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m) throw new ErroOcr("Imagem inválida.", 400);
  const mediaType = m[1] as (typeof TIPOS_IMAGEM)[number];
  if (!TIPOS_IMAGEM.includes(mediaType)) throw new ErroOcr("Formato não suportado (use JPG, PNG ou WEBP).", 400);
  if (Math.floor((m[2].length * 3) / 4) > TAMANHO_MAX_BYTES) throw new ErroOcr("Imagem muito grande.", 413);
  return { mediaType, base64: m[2] };
}

export async function chamarClaude(prompt: string, schema: object, imagem: { mediaType: (typeof TIPOS_IMAGEM)[number]; base64: string }): Promise<unknown> {
  if (!process.env.ANTHROPIC_API_KEY) throw new ErroOcr("Leitura por IA indisponível: a chave da Anthropic não está configurada.", 503);
  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  let resposta: Anthropic.Beta.BetaMessage;
  try {
    resposta = await client.beta.messages.create({
      model: MODELO_OCR,
      max_tokens: 4000,
      // Leitura de etiqueta é tarefa simples: esforço baixo = mais rápido e barato
      output_config: { effort: "low", format: { type: "json_schema", schema: schema as Record<string, unknown> } },
      // Se o modelo recusar por política, a API refaz no modelo recomendado (sem lista fixa para manter)
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: imagem.mediaType, data: imagem.base64 } },
          { type: "text", text: prompt },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ErroOcr("A leitura demorou demais (tempo esgotado).", 504);
    if (e instanceof Anthropic.AuthenticationError) throw new ErroOcr("Leitura por IA indisponível: chave da Anthropic inválida.", 503);
    if (e instanceof Anthropic.RateLimitError) throw new ErroOcr("Muitas leituras ao mesmo tempo. Tente de novo em instantes.", 429);
    if (e instanceof Anthropic.APIError) throw new ErroOcr(`Serviço de IA indisponível (${e.status ?? "erro"}).`, 502);
    throw new ErroOcr("Não foi possível falar com o serviço de IA.", 502);
  }
  if (resposta.stop_reason === "refusal") throw new ErroOcr("A IA não processou esta imagem.", 422);
  if (resposta.stop_reason === "max_tokens") throw new ErroOcr("A resposta da IA veio incompleta.", 502);
  const bloco = resposta.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  try { return JSON.parse(bloco?.text ?? ""); } catch { throw new ErroOcr("A IA devolveu uma resposta em formato inesperado.", 502); }
}
