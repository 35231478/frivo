import { ImageResponse } from "next/og";
import { acento, neutro } from "@/lib/ui/tokens";
import { CTA, HERO } from "@/components/marketing/conteudo";

// Imagem de compartilhamento (Open Graph / WhatsApp / redes) da home de vendas, gerada no build.
export const alt = "Frivo — sistema de gestão para empresas de climatização";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function ImagemOg() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: neutro.superficie, color: neutro.texto }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="72" height="72" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="10" fill={acento.DEFAULT} />
            <g stroke="white" strokeWidth="2" strokeLinecap="round">
              <line x1="20" y1="9" x2="20" y2="31" />
              <line x1="9" y1="20" x2="31" y2="20" />
              <line x1="12.5" y1="12.5" x2="27.5" y2="27.5" />
              <line x1="27.5" y1="12.5" x2="12.5" y2="27.5" />
            </g>
          </svg>
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>frivo</div>
        </div>
        <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2, maxWidth: 980 }}>{HERO.titulo}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ display: "flex", background: acento.DEFAULT, color: "white", fontSize: 32, fontWeight: 600, padding: "18px 32px", borderRadius: 14 }}>{CTA.principal}</div>
          <div style={{ fontSize: 30, color: neutro.secundario }}>Sem cartão de crédito</div>
        </div>
      </div>
    ),
    size,
  );
}
