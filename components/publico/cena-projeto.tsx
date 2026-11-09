"use client";

import { useMemo } from "react";
import type { FormaEquipamento, TipoAmbiente } from "@/lib/leads/btu";

/**
 * A cena do "projeto" da calculadora pública: um cômodo arquitetônico vetorial (render isométrico,
 * painel escuro premium) que cresce com a área e mostra o ar condicionado recomendado instalado,
 * detalhado por tipo, com móveis de contexto, luz do dia pela janela, névoa e flocos de ar frio,
 * cone de luz fria e um indicador de temperatura caindo. Só SVG/CSS (sem emoji), cores por token
 * (cena-* via variáveis CSS), e o movimento respeita prefers-reduced-motion (globals.css).
 */
export function CenaProjeto({ escala, forma, ativo, nInternas = 1, tipo }: {
  /** 0..1 — tamanho do cômodo (área) */
  escala: number;
  forma: FormaEquipamento;
  /** anima o ar frio (sai da unidade); desligado antes de ter área */
  ativo: boolean;
  /** quantas unidades internas (multisplit/VRF) */
  nInternas?: number;
  /** tipo do ambiente — define os móveis de contexto */
  tipo?: TipoAmbiente;
}) {
  const t = Math.max(0.36, Math.min(1, escala));
  const W = 480, H = 360, cx = 236, cy = 150;
  const halfW = 92 + 96 * t;   // meia-largura do losango do piso
  const halfH = 44 + 48 * t;   // meia-altura
  const altura = 96 + 40 * t;  // altura das paredes
  const P = (u: number, v: number, z = 0): [number, number] => [cx + (u - v) * halfW, cy + (u + v) * halfH - z];
  const pt = (p: number[]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const poly = (...ps: number[][]) => ps.map(pt).join(" ");

  // Cantos: A (fundo), B (direita), C (frente), D (esquerda); topos com z = altura
  const A = P(0, 0), B = P(1, 0), C = P(1, 1), D = P(0, 1);
  const At = P(0, 0, altura), Bt = P(1, 0, altura), Dt = P(0, 1, altura);

  const conjunto = forma === "multisplit" || forma === "vrf";
  const noTeto = forma === "cassete" || forma === "vrf";
  const noPiso = forma === "piso-teto";
  const nInt = conjunto ? Math.max(2, Math.min(4, nInternas)) : 1;

  // Flocos: tamanho, opacidade, duração, deriva e atraso variados (cristais de verdade)
  const flocos = useMemo(() => Array.from({ length: 9 }, (_, i) => ({
    dx: ((i * 37) % 70) - 30, dy: (i % 3) * 5,
    s: 0.55 + ((i * 13) % 50) / 100,      // escala 0.55..1.05
    op: 0.5 + ((i * 17) % 45) / 100,       // opacidade 0.5..0.95
    dur: 2.6 + ((i * 7) % 20) / 10,        // 2.6..4.5s
    drift: `${(i % 2 ? 1 : -1) * (6 + (i % 4) * 4)}px`,
    queda: `${54 + (i % 3) * 10}px`,
    delay: (i * 0.33).toFixed(2),
  })), []);

  return (
    <div className="cena-vars relative w-full overflow-hidden rounded-2xl bg-cena-fundo ring-1 ring-cena-borda shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]" data-cena-projeto data-forma={forma}>
      <div className="pointer-events-none absolute inset-0 anim-calc-brilho calc-glow" aria-hidden />
      <svg viewBox={`0 0 ${W} ${H}`} className="relative w-full h-auto" role="img" aria-label="Projeto do ambiente com o ar condicionado recomendado">
        <defs>
          <linearGradient id="cParedeD" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--cena-luz)" /><stop offset="1" stopColor="var(--cena-parede)" />
          </linearGradient>
          <linearGradient id="cParedeE" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--cena-parede)" /><stop offset="1" stopColor="var(--cena-parede2)" />
          </linearGradient>
          <linearGradient id="cPiso" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--cena-piso2)" /><stop offset="1" stopColor="var(--cena-piso)" />
          </linearGradient>
          <radialGradient id="cReflexo" cx="0.5" cy="0.1" r="0.8">
            <stop offset="0" stopColor="var(--cena-frio)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--cena-frio)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cVidro" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--cena-vidro)" stopOpacity="0.9" /><stop offset="1" stopColor="var(--cena-vidro)" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="cLuzDia" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor="var(--cena-vidro)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--cena-vidro)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cMist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--cena-frio)" stopOpacity="0.55" /><stop offset="1" stopColor="var(--cena-frio)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cCone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--cena-frio)" stopOpacity="0.5" /><stop offset="1" stopColor="var(--cena-frio)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cEquip" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--cena-equip)" /><stop offset="1" stopColor="var(--cena-equip2)" />
          </linearGradient>
          <radialGradient id="cVinheta" cx="0.5" cy="0.42" r="0.75">
            <stop offset="0.55" stopColor="#000000" stopOpacity="0" /><stop offset="1" stopColor="#000000" stopOpacity="0.45" />
          </radialGradient>
          <filter id="cBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" /></filter>
          <filter id="cBlurSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>

        {/* sombra de contato do cômodo no "chão" do painel */}
        <ellipse cx={cx} cy={cy + halfH + 24} rx={halfW * 0.95} ry={18} fill="#000000" opacity={0.4} filter="url(#cBlurSoft)" />

        {/* paredes (gradiente) + topo iluminado */}
        <polygon points={poly(A, D, Dt, At)} fill="url(#cParedeE)" className="anim-calc-entra" />
        <polygon points={poly(A, B, Bt, At)} fill="url(#cParedeD)" className="anim-calc-entra" />
        {/* rodapé */}
        <polygon points={poly(A, D, P(0, 1, 7), P(0, 0, 7))} fill="var(--cena-luz)" opacity={0.7} />
        <polygon points={poly(A, B, P(1, 0, 7), P(0, 0, 7))} fill="var(--cena-luz)" opacity={0.5} />

        {/* janela na parede esquerda, com luz do dia entrando */}
        <WindowLight P={P} altura={altura} />

        {/* piso (gradiente) + grade em perspectiva + reflexo frio */}
        <polygon points={poly(A, B, C, D)} fill="url(#cPiso)" className="anim-calc-entra" />
        <g className="anim-calc-entra">
          {[0.2, 0.4, 0.6, 0.8].map((g, i) => (
            <g key={g} stroke="var(--cena-borda)" strokeWidth={1} opacity={0.45 - i * 0.06}>
              <line x1={P(g, 0)[0]} y1={P(g, 0)[1]} x2={P(g, 1)[0]} y2={P(g, 1)[1]} />
              <line x1={P(0, g)[0]} y1={P(0, g)[1]} x2={P(1, g)[0]} y2={P(1, g)[1]} />
            </g>
          ))}
        </g>
        {/* ambient occlusion no canto do fundo */}
        <polygon points={poly(A, P(0.34, 0), P(0.34, 0.34), P(0, 0.34))} fill="#000000" opacity={0.18} filter="url(#cBlur)" />

        {/* móveis de contexto por tipo de ambiente */}
        <Moveis tipo={tipo} P={P} />

        {/* reflexo frio no piso, sob a unidade */}
        {ativo && <ellipse cx={P(0.6, 0.55)[0]} cy={P(0.6, 0.55)[1]} rx={halfW * 0.5} ry={halfH * 0.5} fill="url(#cReflexo)" />}

        {/* unidade externa (multisplit/VRF) + tubulação */}
        {conjunto && <UnidadeExterna P={P} vrf={forma === "vrf"} />}

        {/* unidades internas (detalhadas por forma) + ar frio na principal */}
        {Array.from({ length: nInt }).map((_, i) => {
          const z = noTeto ? altura - 6 : noPiso ? 0 : altura - 40;
          const base = P(0.66 - i * 0.2, 0.04 + i * 0.03, z);
          return (
            <g key={i} className="anim-calc-settle" style={{ animationDelay: `${0.15 + i * 0.12}s` }} data-unidade-interna={i}>
              <Equipamento forma={forma} x={base[0]} y={base[1]} principal={i === 0} />
              {ativo && i === 0 && <ArFrio x={base[0]} y={base[1]} forma={forma} flocos={flocos} />}
            </g>
          );
        })}

        {/* vinheta por cima de tudo */}
        <rect x={0} y={0} width={W} height={H} fill="url(#cVinheta)" pointerEvents="none" />
      </svg>
    </div>
  );
}

/* ───────── Peças ───────── */

/** Janela na parede esquerda com um feixe de luz do dia entrando no piso. */
function WindowLight({ P, altura }: { P: (u: number, v: number, z?: number) => [number, number]; altura: number }) {
  const jx1 = P(0, 0.42, altura - 24), jx2 = P(0, 0.72, altura - 24), jx3 = P(0, 0.72, altura - 70), jx4 = P(0, 0.42, altura - 70);
  // feixe de luz até o piso
  const f1 = P(0, 0.44, 0), f2 = P(0, 0.7, 0), f3 = P(0.42, 0.56, 0), f4 = P(0.3, 0.3, 0);
  return (
    <g>
      <polygon points={[f1, f2, f3, f4].map((p) => p.join(",")).join(" ")} fill="url(#cLuzDia)" opacity={0.8} />
      <polygon points={[jx1, jx2, jx3, jx4].map((p) => p.join(",")).join(" ")} fill="url(#cVidro)" />
      <polygon points={[jx1, jx2, jx3, jx4].map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--cena-luz)" strokeWidth={2} />
      <line x1={(jx1[0] + jx4[0]) / 2} y1={(jx1[1] + jx4[1]) / 2} x2={(jx2[0] + jx3[0]) / 2} y2={(jx2[1] + jx3[1]) / 2} stroke="var(--cena-luz)" strokeWidth={1.5} />
    </g>
  );
}

/** Móveis simples (silhueta isométrica) por tipo de ambiente. */
function Moveis({ tipo, P }: { tipo?: TipoAmbiente; P: (u: number, v: number, z?: number) => [number, number] }) {
  // caixa isométrica em (u,v) com dimensões (du,dv) e altura h
  const caixa = (u: number, v: number, du: number, dv: number, h: number, topo = "var(--cena-movel2)", lado = "var(--cena-movel)") => {
    const a = P(u, v, 0), b = P(u + du, v, 0), c = P(u + du, v + dv, 0), d = P(u, v + dv, 0);
    const at = P(u, v, h), bt = P(u + du, v, h), ct = P(u + du, v + dv, h), dt = P(u, v + dv, h);
    const pp = (ps: [number, number][]) => ps.map((p) => p.join(",")).join(" ");
    return (
      <g>
        <polygon points={pp([a, d, dt, at])} fill={lado} />
        <polygon points={pp([a, b, bt, at])} fill={lado} opacity={0.85} />
        <polygon points={pp([at, bt, ct, dt])} fill={topo} />
      </g>
    );
  };
  if (tipo === "quarto") return <g data-movel="cama">{caixa(0.12, 0.5, 0.34, 0.42, 14)}{/* travesseiro */}{caixa(0.14, 0.52, 0.12, 0.16, 20)}</g>;
  if (tipo === "sala") return <g data-movel="sofa">{caixa(0.1, 0.5, 0.44, 0.18, 16)}{caixa(0.1, 0.5, 0.44, 0.05, 30)}{/* TV na parede */}<Tv P={P} /></g>;
  if (tipo === "cozinha") return <g data-movel="bancada">{caixa(0.1, 0.12, 0.5, 0.12, 24)}</g>;
  if (tipo === "escritorio") return <g data-movel="mesa">{caixa(0.14, 0.46, 0.4, 0.2, 18)}{caixa(0.16, 0.62, 0.1, 0.1, 26)}</g>;
  if (tipo === "loja") return <g data-movel="balcao">{caixa(0.12, 0.5, 0.42, 0.14, 26)}</g>;
  if (tipo === "salao") return <g data-movel="mesas">{caixa(0.16, 0.5, 0.14, 0.14, 16)}{caixa(0.5, 0.56, 0.14, 0.14, 16)}</g>;
  if (tipo === "galpao") return <g data-movel="prateleiras">{caixa(0.1, 0.12, 0.12, 0.6, 46)}{caixa(0.5, 0.12, 0.12, 0.6, 46)}</g>;
  return null;
}

function Tv({ P }: { P: (u: number, v: number, z?: number) => [number, number] }) {
  const a = P(0.14, 0.5, 58), b = P(0.14, 0.72, 58), c = P(0.14, 0.72, 86), d = P(0.14, 0.5, 86);
  return <polygon points={[a, b, c, d].map((p) => p.join(",")).join(" ")} fill="var(--cena-fundo)" stroke="var(--cena-movel2)" strokeWidth={1.5} />;
}

/** A unidade interna detalhada por forma. */
function Equipamento({ forma, x, y, principal }: { forma: FormaEquipamento; x: number; y: number; principal: boolean }) {
  if (forma === "cassete" || forma === "vrf") {
    // cassete: quadrado embutido no teto com saídas nos 4 lados
    return (
      <g>
        <rect x={x - 22} y={y - 11} width={44} height={22} rx={3} fill="url(#cEquip)" stroke="var(--cena-equip2)" strokeWidth={1.2} />
        <rect x={x - 14} y={y - 6} width={28} height={12} rx={2} fill="var(--cena-piso2)" />
        {/* saídas (4 lados) */}
        <line x1={x - 20} y1={y} x2={x - 15} y2={y} stroke="var(--cena-equip2)" strokeWidth={2} />
        <line x1={x + 15} y1={y} x2={x + 20} y2={y} stroke="var(--cena-equip2)" strokeWidth={2} />
        <line x1={x} y1={y - 9} x2={x} y2={y - 5} stroke="var(--cena-equip2)" strokeWidth={2} />
        <line x1={x} y1={y + 5} x2={x} y2={y + 9} stroke="var(--cena-equip2)" strokeWidth={2} />
        {principal && <circle cx={x + 16} cy={y - 7} r={1.6} fill="var(--cena-led)" />}
      </g>
    );
  }
  if (forma === "piso-teto") {
    // gabinete alto no piso
    return (
      <g>
        <rect x={x - 14} y={y - 58} width={28} height={62} rx={6} fill="url(#cEquip)" stroke="var(--cena-equip2)" strokeWidth={1.2} />
        <rect x={x - 9} y={y - 50} width={18} height={30} rx={3} fill="var(--cena-piso2)" opacity={0.7} />
        {[0, 1, 2, 3].map((k) => <line key={k} x1={x - 9} y1={y - 16 + k * 3} x2={x + 9} y2={y - 16 + k * 3} stroke="var(--cena-equip2)" strokeWidth={1.2} />)}
        {principal && <circle cx={x + 8} cy={y - 52} r={1.8} fill="var(--cena-led)" />}
      </g>
    );
  }
  // hi-wall: formato clássico horizontal, com aletas, display/LED, no alto da parede
  return (
    <g>
      <rect x={x - 28} y={y - 9} width={56} height={17} rx={8} fill="url(#cEquip)" stroke="var(--cena-equip2)" strokeWidth={1.2} />
      {/* aletas/vent na base */}
      <rect x={x - 22} y={y + 4} width={44} height={4} rx={2} fill="var(--cena-piso2)" />
      {[0, 1, 2, 3, 4].map((k) => <line key={k} x1={x - 18 + k * 9} y1={y + 4} x2={x - 18 + k * 9} y2={y + 8} stroke="var(--cena-equip2)" strokeWidth={1} />)}
      {/* vinco superior */}
      <line x1={x - 22} y1={y - 3} x2={x + 22} y2={y - 3} stroke="var(--cena-equip2)" strokeWidth={1} opacity={0.6} />
      {principal && <circle cx={x + 20} cy={y - 2} r={1.8} fill="var(--cena-led)" />}
    </g>
  );
}

/** Condensadora externa (grade do ventilador) + tubulação. */
function UnidadeExterna({ P, vrf }: { P: (u: number, v: number, z?: number) => [number, number]; vrf: boolean }) {
  const base = P(-0.18, 0.2, 10);
  const x = base[0], y = base[1];
  return (
    <g data-unidade-externa>
      <rect x={x - 26} y={y - 30} width={52} height={38} rx={4} fill="url(#cEquip)" stroke="var(--cena-equip2)" strokeWidth={1.5} />
      {/* grade do ventilador */}
      <circle cx={x} cy={y - 11} r={14} fill="var(--cena-piso2)" stroke="var(--cena-equip2)" strokeWidth={1.5} />
      {[0, 1, 2, 3, 4, 5].map((k) => <line key={k} x1={x} y1={y - 11} x2={x + 12 * Math.cos((k * Math.PI) / 3)} y2={y - 11 + 12 * Math.sin((k * Math.PI) / 3)} stroke="var(--cena-equip2)" strokeWidth={1.3} />)}
      <circle cx={x} cy={y - 11} r={2.4} fill="var(--cena-equip2)" />
      {vrf && <rect x={x - 26} y={y - 30} width={52} height={38} rx={4} fill="none" stroke="var(--cena-frio)" strokeWidth={1} opacity={0.5} />}
      {/* tubulação para dentro do cômodo */}
      <path d={`M ${x + 24} ${y - 20} C ${x + 70} ${y - 26}, ${P(0.2, 0.05, 70)[0]} ${P(0.2, 0.05, 70)[1]}, ${P(0.4, 0.04, 66)[0]} ${P(0.4, 0.04, 66)[1]}`} fill="none" stroke="var(--cena-equip2)" strokeWidth={2.5} opacity={0.7} strokeLinecap="round" />
      <text x={x} y={y + 22} textAnchor="middle" fill="var(--cena-apoio)" fontSize={9}>{vrf ? "VRF" : "externa"}</text>
    </g>
  );
}

/** Ar frio saindo da unidade: cone de luz + névoa (blur) + flocos de neve + indicador de temperatura. */
function ArFrio({ x, y, forma, flocos }: {
  x: number; y: number; forma: FormaEquipamento;
  flocos: { dx: number; dy: number; s: number; op: number; dur: number; drift: string; queda: string; delay: string }[];
}) {
  const sai = forma === "cassete" || forma === "vrf" ? 10 : forma === "piso-teto" ? -18 : 9; // de onde o ar sai (y offset)
  const oy = y + sai;
  return (
    <g data-ar-frio>
      {/* cone de luz fria */}
      <polygon points={`${x - 10},${oy} ${x + 10},${oy} ${x + 26},${oy + 60} ${x - 26},${oy + 60}`} fill="url(#cCone)" className="anim-calc-cone" />
      {/* névoa/vapor frio (blur) */}
      <g filter="url(#cBlur)">
        {[0, 1, 2].map((k) => (
          <ellipse key={k} cx={x + (k - 1) * 8} cy={oy + 6} rx={13} ry={8} fill="url(#cMist)" className="anim-calc-mist" style={{ animationDelay: `${k * 0.5}s` }} />
        ))}
      </g>
      {/* flocos de neve (cristais) */}
      {flocos.map((f, k) => (
        <g key={k} className="anim-calc-floco"
          style={{ ["--calc-drift" as string]: f.drift, ["--calc-queda" as string]: f.queda, ["--calc-op" as string]: String(f.op), ["--calc-dur" as string]: `${f.dur}s`, animationDelay: `${f.delay}s`, transformOrigin: "center" } as React.CSSProperties}>
          <Cristal x={x + f.dx} y={oy + 8 + f.dy} s={f.s} />
        </g>
      ))}
      {/* indicador de temperatura caindo */}
      <IndicadorTemp x={x} y={oy} />
    </g>
  );
}

/** Um cristal de neve de 6 pontas com ramificações. */
function Cristal({ x, y, s }: { x: number; y: number; s: number }) {
  const braco = 5 * s;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} stroke="var(--cena-neve)" strokeWidth={1} strokeLinecap="round">
      {[0, 60, 120].map((a) => {
        const r = (a * Math.PI) / 180, dx = Math.cos(r) * braco, dy = Math.sin(r) * braco;
        const bx = Math.cos(r) * braco * 0.6, by = Math.sin(r) * braco * 0.6;
        const px = Math.cos(r + 0.6) * braco * 0.4, py = Math.sin(r + 0.6) * braco * 0.4;
        const qx = Math.cos(r - 0.6) * braco * 0.4, qy = Math.sin(r - 0.6) * braco * 0.4;
        return (
          <g key={a}>
            <line x1={-dx} y1={-dy} x2={dx} y2={dy} />
            <line x1={bx} y1={by} x2={bx + px} y2={by + py} />
            <line x1={bx} y1={by} x2={bx + qx} y2={by + qy} />
          </g>
        );
      })}
    </g>
  );
}

/** Indicador de temperatura caindo (26° → 21°) com um fade alternado. */
function IndicadorTemp({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x + 34} ${y + 2})`} data-temp>
      <rect x={-2} y={-11} width={40} height={20} rx={10} fill="var(--cena-painel)" stroke="var(--cena-frio)" strokeWidth={1} opacity={0.95} />
      <path d="M 7 -4 l 3 4 l 3 -4 z" fill="var(--cena-frio)" />
      <text x={24} y={4} textAnchor="middle" fill="var(--cena-texto)" fontSize={11} fontWeight={700}>21°</text>
    </g>
  );
}
