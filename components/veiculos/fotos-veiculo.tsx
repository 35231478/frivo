"use client";

import { useMemo, useRef, useState } from "react";
import { Car, ImagePlus, Loader2, X } from "lucide-react";
import { SlotFoto } from "@/components/ui/slot-foto";
import { reduzirImagem, FOTO_GALERIA } from "@/lib/imagem-cliente";
import {
  ANGULOS_VEICULO, MAX_OUTRAS_FOTOS, ROTULOS_FOTO_VEICULO, organizarFotosVeiculo,
  type AnguloVeiculo, type RotuloFotoVeiculo,
} from "@/lib/veiculo-fotos";

const DICAS: Record<AnguloVeiculo, string> = {
  FRENTE: "de frente, inteiro",
  TRASEIRA: "de trás, com a placa",
  LATERAL_ESQUERDA: "lado do motorista",
  LATERAL_DIREITA: "lado do passageiro",
};

/**
 * Fotos do veículo em espaços rotulados: Frente (capa), Traseira, Lateral esquerda,
 * Lateral direita e Outros (opcional). Cada foto é reduzida no navegador (JPEG 1280px)
 * antes de ir para o formulário — o mesmo tratamento do cadastro por foto do equipamento.
 */
export function FotosVeiculo({ fotos, rotulos, onChange, somenteLeitura }: {
  fotos: string[];
  rotulos: RotuloFotoVeiculo[];
  onChange: (fotos: string[], rotulos: RotuloFotoVeiculo[]) => void;
  somenteLeitura?: boolean;
}) {
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");
  const inputOutros = useRef<HTMLInputElement>(null);

  const { porAngulo, outros } = useMemo(() => {
    const org = organizarFotosVeiculo(fotos, rotulos);
    const porAngulo: Partial<Record<AnguloVeiculo, string>> = {};
    const outros: string[] = [];
    org.fotos.forEach((f, i) => {
      const r = org.fotosRotulos[i];
      if (r === "OUTRO") outros.push(f); else porAngulo[r] = f;
    });
    return { porAngulo, outros };
  }, [fotos, rotulos]);

  function emitir(angulos: Partial<Record<AnguloVeiculo, string>>, extras: string[]) {
    const f: string[] = []; const r: RotuloFotoVeiculo[] = [];
    for (const a of ANGULOS_VEICULO) if (angulos[a]) { f.push(angulos[a]!); r.push(a); }
    for (const x of extras) { f.push(x); r.push("OUTRO"); }
    onChange(f, r);
  }

  async function reduzir(file: File): Promise<string | null> {
    try {
      const { imagem } = await reduzirImagem(file, FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade);
      return imagem.dataUrl;
    } catch {
      setErro("Não foi possível abrir esta imagem. Tente outra foto.");
      return null;
    }
  }

  async function escolherAngulo(angulo: AnguloVeiculo, file: File | undefined) {
    if (!file) return;
    setErro(""); setProcessando(true);
    try {
      const url = await reduzir(file);
      if (url) emitir({ ...porAngulo, [angulo]: url }, outros);
    } finally { setProcessando(false); }
  }

  async function adicionarOutros(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? []); e.target.value = "";
    if (!arquivos.length) return;
    const vagas = MAX_OUTRAS_FOTOS - outros.length;
    if (vagas <= 0) { setErro(`Máximo de ${MAX_OUTRAS_FOTOS} fotos em "Outros".`); return; }
    setErro(""); setProcessando(true);
    try {
      const novas = (await Promise.all(arquivos.slice(0, vagas).map(reduzir))).filter((u): u is string => !!u);
      if (arquivos.length > vagas) setErro(`Máximo de ${MAX_OUTRAS_FOTOS} fotos em "Outros".`);
      if (novas.length) emitir(porAngulo, [...outros, ...novas]);
    } finally { setProcessando(false); }
  }

  return (
    <div className="space-y-3" data-fotos-veiculo>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {ANGULOS_VEICULO.map((a) => (
          <SlotFoto
            key={a} id={a} titulo={ROTULOS_FOTO_VEICULO[a]}
            selo={a === "FRENTE" ? "Capa" : "Recomendada"}
            seloCor={a === "FRENTE" ? "bg-primary-100 text-primary-700" : "bg-surface-alt text-ink-muted"}
            icone={Car} dica={DICAS[a]} url={porAngulo[a] ?? null}
            rotuloAria={`Foto ${ROTULOS_FOTO_VEICULO[a].toLowerCase()}`}
            onArquivo={(f) => !somenteLeitura && escolherAngulo(a, f)}
            onRemover={() => { if (somenteLeitura) return; const n = { ...porAngulo }; delete n[a]; emitir(n, outros); }}
          />
        ))}
      </div>

      <div data-slot="OUTRO" className="rounded-xl border border-surface-border p-2.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-ink">Outros <span className="font-normal text-ink-muted">(painel, interior, avarias…)</span></p>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">Opcional · até {MAX_OUTRAS_FOTOS}</span>
        </div>
        <input ref={inputOutros} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={adicionarOutros} aria-label="Outras fotos do veículo (arquivo)" />
        <div className="flex flex-wrap gap-2">
          {outros.map((f, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f} alt={`Outra foto ${i + 1}`} className="w-20 h-20 rounded-lg object-cover border border-surface-border" />
              {!somenteLeitura && (
                <button type="button" title="Remover foto" onClick={() => emitir(porAngulo, outros.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 bg-white border border-surface-border text-ink-muted hover:text-red-500 rounded-full p-0.5 shadow">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {!somenteLeitura && outros.length < MAX_OUTRAS_FOTOS && (
            <button type="button" onClick={() => inputOutros.current?.click()}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-surface-border hover:border-primary-400 flex flex-col items-center justify-center gap-0.5 text-ink-subtle hover:text-primary-600 text-[10px]">
              <ImagePlus className="w-5 h-5" /> Adicionar
            </button>
          )}
        </div>
      </div>

      {processando && <p className="flex items-center gap-1.5 text-xs text-ink-muted" data-fotos-processando><Loader2 className="w-3.5 h-3.5 animate-spin" /> Otimizando a foto…</p>}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      <p className="text-xs text-ink-subtle">
        A foto da <strong className="text-ink-muted">Frente</strong> é a capa do veículo (lista e cadastro). As fotos são otimizadas automaticamente antes de salvar.
        {!porAngulo.FRENTE && fotos.length > 0 && " Sem a frente, a capa fica com a próxima foto."}
      </p>
    </div>
  );
}
