"use client";

import { useMemo } from "react";
import type { FormaEquipamento } from "@/lib/leads/btu";

/**
 * A cena do "projeto" da calculadora pública: um cômodo isométrico vetorial (painel escuro premium)
 * que cresce com a área e mostra o equipamento recomendado instalado, com um ar frio e flocos saindo
 * da unidade. Ilustrações próprias por forma (hi-wall na parede, piso-teto/cassete no teto, multisplit/
 * VRF com unidade externa + internas). Só SVG/CSS (sem emoji), cores por token (cena-*), e o movimento
 * respeita prefers-reduced-motion (globals.css).
 */
export function CenaProjeto({ escala, forma, ativo, nInternas = 1 }: {
  /** 0..1 — tamanho do cômodo (área) */
  escala: number;
  forma: FormaEquipamento;
  /** anima o ar frio (sai da unidade); desligado antes de ter área */
  ativo: boolean;
  /** quantas unidades internas (multisplit/VRF) */
  nInternas?: number;
}) {
  const t = Math.max(0.36, Math.min(1, escala));
  // Projeção isométrica simples: ponto do piso (u,v em 0..1) -> tela
  const cx = 200, cy = 150;
  const halfW = 70 + 78 * t;  // meia-largura do losango do piso
  const halfH = 34 + 38 * t;  // meia-altura
  const alturaParede = 70 + 30 * t;
  const P = (u: number, v: number, z = 0) => [cx + (u - v) * halfW, cy + (u + v) * halfH - z];
  const pt = (p: number[]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  // Cantos do piso
  const A = P(0, 0), B = P(1, 0), C = P(1, 1), D = P(0, 1);
  // Topo das paredes do fundo (A-B e A-D), subindo z
  const At = P(0, 0, alturaParede), Bt = P(1, 0, alturaParede), Dt = P(0, 1, alturaParede);
  const piso = `${pt(A)} ${pt(B)} ${pt(C)} ${pt(D)}`;
  const paredeEsq = `${pt(A)} ${pt(D)} ${pt(Dt)} ${pt(At)}`;   // parede esquerda (A-D)
  const paredeDir = `${pt(A)} ${pt(B)} ${pt(Bt)} ${pt(At)}`;   // parede direita (A-B)

  // Flocos de ar frio (posições/atrasos estáveis)
  const flocos = useMemo(() => Array.from({ length: 7 }, (_, i) => ({
    x: (i % 4) * 7 - 10, delay: (i * 0.34).toFixed(2), drift: `${(i % 2 ? 1 : -1) * (5 + (i % 3) * 3)}px`,
  })), []);

  // Âncora da unidade interna conforme a forma
  const naParede = forma === "hi-wall" || forma === "multisplit";
  const noTeto = forma === "cassete" || forma === "vrf";
  const noPiso = forma === "piso-teto";
  const conjunto = forma === "multisplit" || forma === "vrf";
  // Ponto onde a unidade fica (canto do fundo, na parede direita A-B, a meia altura)
  const unidade = P(0.62, 0.02, noTeto ? alturaParede - 14 : noPiso ? 22 : alturaParede - 26);
  const nInt = conjunto ? Math.max(2, Math.min(5, nInternas)) : 1;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-cena-fundo ring-1 ring-cena-borda" data-cena-projeto data-forma={forma}>
      {/* brilho de fundo (acento frio) */}
      <div className="pointer-events-none absolute inset-0 anim-calc-brilho calc-glow" aria-hidden />
      <svg viewBox="0 0 400 300" className="relative w-full h-auto" role="img" aria-label="Projeto do ambiente com o ar condicionado recomendado">
        {/* sombra do piso */}
        <ellipse cx={cx} cy={cy + halfH + 16} rx={halfW * 0.9} ry={14} className="fill-black/30" />
        {/* paredes e piso do cômodo */}
        <polygon points={paredeEsq} className="fill-cena-parede" />
        <polygon points={paredeDir} className="fill-cena-luz" />
        <polygon points={piso} className="fill-cena-piso" />
        {/* linhas de grade no piso (profundidade) */}
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="stroke-cena-borda" strokeWidth={1} opacity={0.5}>
            <line x1={P(g, 0)[0]} y1={P(g, 0)[1]} x2={P(g, 1)[0]} y2={P(g, 1)[1]} />
            <line x1={P(0, g)[0]} y1={P(0, g)[1]} x2={P(1, g)[0]} y2={P(1, g)[1]} />
          </g>
        ))}

        {/* unidade externa (multisplit/VRF): fora do cômodo, à esquerda */}
        {conjunto && (
          <g data-unidade-externa>
            <rect x={28} y={176} width={46} height={34} rx={4} className="fill-cena-equip" />
            <rect x={28} y={176} width={46} height={34} rx={4} className="fill-none stroke-cena-equip2" strokeWidth={1.5} />
            <circle cx={51} cy={193} r={11} className="fill-cena-piso" />
            <circle cx={51} cy={193} r={11} className="fill-none stroke-cena-frio" strokeWidth={1.5} />
            {[0, 1, 2].map((i) => <line key={i} x1={51} y1={193} x2={51 + 9 * Math.cos(i * 2.1)} y2={193 + 9 * Math.sin(i * 2.1)} className="stroke-cena-frio" strokeWidth={1.5} />)}
            <text x={51} y={224} textAnchor="middle" className="fill-cena-apoio text-[9px]">externa</text>
          </g>
        )}

        {/* unidade(s) interna(s) */}
        {Array.from({ length: nInt }).map((_, i) => {
          const base = P(0.62 - i * 0.16, 0.02 + i * 0.02, noTeto ? alturaParede - 14 : noPiso ? 24 : alturaParede - 26);
          const x = base[0], y = base[1];
          return (
            <g key={i} data-unidade-interna={i} className="anim-calc-entra" style={{ animationDelay: `${i * 0.12}s` }}>
              {/* brilho atrás da unidade */}
              <ellipse cx={x} cy={y + 6} rx={26} ry={10} className="fill-cena-frio/20" />
              {noTeto ? (
                // cassete: quadrado embutido no teto com grelha
                <g>
                  <rect x={x - 17} y={y - 8} width={34} height={16} rx={3} className="fill-cena-equip" />
                  <rect x={x - 17} y={y - 8} width={34} height={16} rx={3} className="fill-none stroke-cena-equip2" strokeWidth={1.2} />
                  <rect x={x - 10} y={y - 3} width={20} height={6} rx={2} className="fill-cena-piso" />
                </g>
              ) : noPiso ? (
                // piso-teto: gabinete alto
                <g>
                  <rect x={x - 11} y={y - 30} width={22} height={48} rx={4} className="fill-cena-equip" />
                  <rect x={x - 11} y={y - 30} width={22} height={48} rx={4} className="fill-none stroke-cena-equip2" strokeWidth={1.2} />
                  <rect x={x - 7} y={y + 6} width={14} height={8} rx={2} className="fill-cena-piso" />
                </g>
              ) : (
                // hi-wall: unidade fina e larga na parede
                <g>
                  <rect x={x - 22} y={y - 7} width={44} height={13} rx={5} className="fill-cena-equip" />
                  <rect x={x - 22} y={y - 7} width={44} height={13} rx={5} className="fill-none stroke-cena-equip2" strokeWidth={1.2} />
                  <line x1={x - 16} y1={y + 3} x2={x + 16} y2={y + 3} className="stroke-cena-equip2" strokeWidth={1.2} />
                </g>
              )}
              {/* ar frio + flocos saindo da unidade (só o 1º, para não poluir) */}
              {ativo && i === 0 && (
                <g data-ar-frio>
                  <path d={`M ${x - 14} ${y + 10} Q ${x} ${y + 26} ${x + 14} ${y + 10}`} className="fill-cena-frio/15 anim-calc-arfrio" />
                  {flocos.map((f, k) => (
                    <g key={k} className="anim-calc-floco" style={{ ["--calc-drift" as string]: f.drift, animationDelay: `${f.delay}s`, transformOrigin: "center" } as React.CSSProperties}>
                      <Floco x={x + f.x} y={y + 14} />
                    </g>
                  ))}
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Um floco de neve vetorial (6 pontas), em cena-neve. */
function Floco({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="stroke-cena-neve" strokeWidth={1.3} strokeLinecap="round">
      {[0, 60, 120].map((a) => {
        const r = (a * Math.PI) / 180, dx = Math.cos(r) * 4.5, dy = Math.sin(r) * 4.5;
        return <line key={a} x1={-dx} y1={-dy} x2={dx} y2={dy} />;
      })}
    </g>
  );
}
