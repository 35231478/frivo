"use client";

import { useState } from "react";
import { Loader2, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanoLimpeza, ResultadoLimpeza } from "@/lib/texto/limpeza";

/**
 * Padronização de digitação dos dados antigos. Primeiro a PRÉVIA (lista o que mudaria, de → para, sem
 * gravar); depois, se houver mudanças, o botão aplica de verdade. Só quem gerencia as Configurações.
 */
export function PadronizacaoClient({ podeAplicar }: { podeAplicar: boolean }) {
  const [plano, setPlano] = useState<PlanoLimpeza | null>(null);
  const [resultado, setResultado] = useState<ResultadoLimpeza | null>(null);
  const [carregando, setCarregando] = useState<"previa" | "aplicar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  async function prever() {
    setCarregando("previa"); setErro(null); setResultado(null); setConfirmar(false);
    try {
      const r = await fetch("/api/configuracoes/padronizacao");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro ?? "Não foi possível gerar a prévia."); return; }
      setPlano(j as PlanoLimpeza);
    } catch { setErro("Falha de conexão ao gerar a prévia."); }
    finally { setCarregando(null); }
  }

  async function aplicar() {
    setCarregando("aplicar"); setErro(null);
    try {
      const r = await fetch("/api/configuracoes/padronizacao", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro ?? "Não foi possível aplicar."); return; }
      setResultado(j as ResultadoLimpeza);
      setPlano(null); setConfirmar(false);
    } catch { setErro("Falha de conexão ao aplicar."); }
    finally { setCarregando(null); }
  }

  const nada = plano && plano.totalCampos === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={prever} loading={carregando === "previa"}>
          Pré-visualizar mudanças
        </Button>
        {plano && plano.totalCampos > 0 && podeAplicar && !confirmar && (
          <Button variant="primary" onClick={() => setConfirmar(true)} disabled={carregando !== null}>
            Aplicar padronização
          </Button>
        )}
        {confirmar && (
          <div className="flex items-center gap-2 text-sm text-ink">
            <span>Confirma a gravação em {plano!.totalRegistros} registros?</span>
            <Button variant="primary" size="sm" onClick={aplicar} loading={carregando === "aplicar"}>Sim, aplicar</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmar(false)} disabled={carregando !== null}>Cancelar</Button>
          </div>
        )}
      </div>

      {erro && <p className="text-sm text-atrasado">{erro}</p>}

      {resultado && (
        <div className="rounded-lg border border-ok/30 bg-ok/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Check className="w-4 h-4 text-ok" />
            {resultado.totalCampos === 0
              ? "Nada a ajustar: os dados já estão padronizados."
              : `Padronização aplicada: ${resultado.totalCampos} campos em ${resultado.totalRegistros} registros.`}
          </p>
          {resultado.porEntidade.length > 0 && <ResumoEntidades itens={resultado.porEntidade} />}
        </div>
      )}

      {nada && (
        <p className="text-sm text-ink-muted">Nada a ajustar: os dados já estão padronizados.</p>
      )}

      {plano && plano.totalCampos > 0 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-surface-border bg-surface p-4">
            <p className="text-sm text-ink">
              {plano.totalCampos} campos em {plano.totalRegistros} registros mudariam. Nada foi gravado ainda.
            </p>
            <ResumoEntidades itens={plano.porEntidade} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-subtle">
              Prévia{plano.amostraLimitada ? ` (primeiras ${plano.amostra.length})` : ""}
            </p>
            <div className="overflow-x-auto rounded-lg border border-surface-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="bg-surface-page text-left text-xs text-ink-muted">
                    <th className="px-3 py-2 font-medium">Cadastro</th>
                    <th className="px-3 py-2 font-medium">Campo</th>
                    <th className="px-3 py-2 font-medium">De</th>
                    <th className="px-3 py-2 font-medium">Para</th>
                  </tr>
                </thead>
                <tbody>
                  {plano.amostra.map((m, i) => (
                    <tr key={i} className="border-t border-surface-linha">
                      <td className="px-3 py-2 text-ink-muted">{m.rotulo}</td>
                      <td className="px-3 py-2 text-ink-muted">{m.campo}</td>
                      <td className="px-3 py-2 text-ink-muted line-through">{m.de}</td>
                      <td className="px-3 py-2 text-ink">
                        <span className="inline-flex items-center gap-1">
                          <ArrowRight className="w-3 h-3 text-ink-subtle" />{m.para}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResumoEntidades({ itens }: { itens: { entidade: string; rotulo: string; registros: number; campos: number }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
      {itens.map((e) => (
        <li key={e.entidade}>
          <span className="text-ink">{e.rotulo}</span>: {e.registros} registros, {e.campos} campos
        </li>
      ))}
    </ul>
  );
}
