"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { CartaoPosicao } from "@/components/mapa/cartao-posicao";
import { frescor, iniciais, type Frescor, type PosicaoNoMapa, type TecnicoNoMapa } from "@/lib/tecnico/posicao";

export type TecnicoComPosicao = TecnicoNoMapa & { posicao: PosicaoNoMapa };

/** Sem nenhum marcador, o mapa abre no Brasil inteiro */
const BRASIL: L.LatLngTuple = [-14.2, -51.9];

/** O marcador muda com a idade da posição: cheio (atual), contorno (recente), cinza e apagado (antiga) */
const VISUAL: Record<Frescor, string> = {
  atual: "bg-acento text-white border-white",
  recente: "bg-white text-acento-hover border-acento",
  antiga: "bg-surface-linha text-ink-muted border-ink-subtle opacity-70",
};

function icone(nome: string, idade: Frescor, selecionado: boolean): L.DivIcon {
  const anel = selecionado ? " ring-4 ring-acento/30" : "";
  return L.divIcon({
    className: "",
    html: `<span data-marcador="${idade}" class="flex items-center justify-center w-10 h-10 rounded-full border-2 text-xs font-bold shadow-elevated ${VISUAL[idade]}${anel}">${iniciais(nome)}</span>`,
    iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22],
  });
}

/** Enquadra todos os marcadores (na chegada dos dados e a cada pedido) e leva ao técnico escolhido */
function Enquadramento({ tecnicos, selecionado, enquadrar, marcadores }: {
  tecnicos: TecnicoComPosicao[]; selecionado: string | null; enquadrar: number; marcadores: React.MutableRefObject<Map<string, L.Marker>>;
}) {
  const mapa = useMap();
  const tem = tecnicos.length > 0;
  const pontos = useRef(tecnicos);
  pontos.current = tecnicos;
  useEffect(() => {
    const p = pontos.current;
    if (!p.length) { mapa.setView(BRASIL, 4); return; }
    mapa.fitBounds(L.latLngBounds(p.map((t) => [t.posicao.lat, t.posicao.lng] as L.LatLngTuple)), { padding: [48, 48], maxZoom: 15 });
  }, [mapa, enquadrar, tem]);
  useEffect(() => {
    const t = selecionado ? pontos.current.find((x) => x.id === selecionado) : null;
    if (!t) return;
    const zoom = Math.max(mapa.getZoom(), 15);
    // O marcador fica um pouco abaixo do centro: sobra espaço em cima para o cartão (mapa baixo no celular)
    const centro = mapa.unproject(mapa.project([t.posicao.lat, t.posicao.lng], zoom).subtract([0, mapa.getSize().y * 0.22]), zoom);
    // O cartão abre quando o mapa chega: assim o Leaflet o encaixa na área visível
    const abrir = () => { const m = marcadores.current.get(t.id); if (m && !m.isPopupOpen()) m.openPopup(); };
    mapa.flyTo(centro, zoom, { duration: 0.6 });
    mapa.once("moveend", abrir);
    // Garantia: se o movimento foi interrompido (outro toque, o cartão anterior fechando), abre assim mesmo
    const garantia = setTimeout(abrir, 900);
    return () => { mapa.off("moveend", abrir); clearTimeout(garantia); };
  }, [mapa, selecionado, marcadores]);
  return null;
}

/**
 * O mapa (Leaflet + OpenStreetMap: sem chave de API e sem custo). Um marcador por técnico, na última
 * posição conhecida. Recebe só dados — a mesma tela serve quando as posições passarem a chegar do
 * app nativo, em segundo plano: muda a frequência com que `tecnicos` é atualizado, não o mapa.
 */
export function MapaLeaflet({ tecnicos, agora, selecionado, enquadrar, onSelecionar }: {
  tecnicos: TecnicoComPosicao[]; agora: number; selecionado: string | null;
  /** Muda quando alguém pede "Enquadrar todos" */ enquadrar: number;
  onSelecionar: (id: string | null) => void;
}) {
  const marcadores = useRef(new Map<string, L.Marker>());
  const centro = useMemo<L.LatLngTuple>(() => (tecnicos[0] ? [tecnicos[0].posicao.lat, tecnicos[0].posicao.lng] : BRASIL), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <MapContainer center={centro} zoom={tecnicos.length ? 13 : 4} scrollWheelZoom className="h-full w-full" data-mapa-leaflet>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Enquadramento tecnicos={tecnicos} selecionado={selecionado} enquadrar={enquadrar} marcadores={marcadores} />
      {tecnicos.map((t) => {
        const idade = frescor(t.posicao.registradoEm, agora);
        return (
          <Marker key={t.id} position={[t.posicao.lat, t.posicao.lng]} icon={icone(t.nome, idade, selecionado === t.id)} title={t.nome} alt={t.nome}
            zIndexOffset={idade === "antiga" ? -500 : selecionado === t.id ? 500 : 0}
            ref={(m) => { if (m) marcadores.current.set(t.id, m); else marcadores.current.delete(t.id); }}
            eventHandlers={{ click: () => onSelecionar(t.id) }}>
            <Popup autoPanPaddingTopLeft={[56, 12]} autoPanPaddingBottomRight={[12, 12]}><CartaoPosicao nome={t.nome} os={t.os} posicao={t.posicao} agora={agora} /></Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
