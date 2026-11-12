/**
 * Localização do aparelho (GPS) para o app do colaborador: usada pela trava "exigir localização
 * ativa" e pela marca d'água com coordenadas. Só navegador. Nunca lança: sem suporte/permissão
 * devolve null (o chamador decide o que fazer).
 */

export interface Coordenadas { lat: number; lng: number; precisao: number | null }

/** Posição atual, uma vez. `timeoutMs` curto para não travar a foto; null quando não dá. */
export function posicaoAtual(timeoutMs = 8000): Promise<Coordenadas | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let respondido = false;
    const pronto = (v: Coordenadas | null) => { if (!respondido) { respondido = true; resolve(v); } };
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => pronto({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy ?? null }),
        () => pronto(null),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
      );
    } catch { pronto(null); }
    // Rede de segurança: alguns navegadores não chamam o erro no prazo
    setTimeout(() => pronto(null), timeoutMs + 500);
  });
}

export interface Bateria { /** 0–100 */ nivel: number; carregando: boolean }

/**
 * Bateria do aparelho, quando o navegador informa (Chrome/Android). No iPhone a web não dá acesso
 * (o Safari não tem a API): devolve null — quem mostra escreve "—", nunca um número inventado.
 */
export async function nivelBateria(): Promise<Bateria | null> {
  const nav = typeof navigator === "undefined" ? null : (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> });
  if (!nav || typeof nav.getBattery !== "function") return null;
  try {
    const b = await nav.getBattery();
    if (typeof b?.level !== "number" || !Number.isFinite(b.level)) return null;
    return { nivel: Math.max(0, Math.min(100, Math.round(b.level * 100))), carregando: !!b.charging };
  } catch {
    return null;
  }
}

/** "-23,550520, -46,633308" (6 casas) — como as coordenadas aparecem na marca d'água. */
export function formatarCoord(c: Coordenadas): string {
  const n = (v: number) => v.toFixed(6);
  return `${n(c.lat)}, ${n(c.lng)}`;
}

/** Estado da permissão de localização, quando o navegador expõe a Permissions API. */
export async function permissaoLocalizacao(): Promise<PermissionState | "indisponivel"> {
  if (typeof navigator === "undefined" || !("permissions" in navigator) || !navigator.permissions?.query) return "indisponivel";
  try {
    const r = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return r.state;
  } catch {
    return "indisponivel";
  }
}
