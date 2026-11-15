"use client";

import { useRef } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { itemDeOpcao, itemGeraAlerta, porCategoria, type ItemDoModelo, type RespostaDoItem } from "@/lib/veiculos/checklist";

const FOTO_MAXIMA = 3 * 1024 * 1024;

/**
 * Os itens de um checklist de veículo, agrupados por categoria — o MESMO bloco para preencher, ver o
 * detalhe e corrigir depois. `somenteLeitura` mostra as respostas sem campo nenhum.
 */
export function ItensChecklist({ itens, respostas, onResposta, onErro, somenteLeitura }: {
  itens: ItemDoModelo[];
  respostas: Record<string, RespostaDoItem | undefined>;
  onResposta?: (itemId: string, r: RespostaDoItem) => void;
  onErro?: (mensagem: string) => void;
  somenteLeitura?: boolean;
}) {
  const fotoRef = useRef<HTMLInputElement>(null);
  const fotoItem = useRef<string | null>(null);
  const atual = (id: string): RespostaDoItem => respostas[id] ?? { valor: null, foto: null };
  const mudar = (id: string, parte: Partial<RespostaDoItem>) => onResposta?.(id, { ...atual(id), ...parte });

  function aoEscolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; const itemId = fotoItem.current;
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file || !itemId) return;
    if (file.size > FOTO_MAXIMA) { onErro?.("Foto muito grande. Máximo 3 MB."); return; }
    const leitor = new FileReader();
    leitor.onload = () => mudar(itemId, { foto: typeof leitor.result === "string" ? leitor.result : null });
    leitor.readAsDataURL(file);
  }

  return (
    <div className="space-y-4" data-itens-checklist>
      {!somenteLeitura && <input ref={fotoRef} type="file" accept="image/*" capture="environment" onChange={aoEscolherFoto} className="hidden" aria-label="Foto do item" />}
      {porCategoria(itens).map(([categoria, lista]) => (
        <div key={categoria} className="bg-white rounded-card border border-surface-border overflow-hidden" data-categoria={categoria}>
          <div className="px-4 py-2.5 bg-surface-alt border-b border-surface-border">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">{categoria}</p>
          </div>
          <div className="divide-y divide-surface-border">
            {lista.map((it) => {
              const r = atual(it.id);
              const alerta = itemGeraAlerta(it, r.valor);
              return (
                <div key={it.id} className="p-4 space-y-2" data-item-checklist={it.id}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{it.descricao}{it.obrigatorio && !somenteLeitura && <span className="text-atrasado ml-0.5">*</span>}</p>
                    {alerta && <span className="text-[10px] font-semibold bg-atencao-claro text-atencao-texto px-1.5 py-0.5 rounded-full shrink-0" data-alerta-item>Alerta</span>}
                  </div>

                  {itemDeOpcao(it.tipo) && (somenteLeitura ? (
                    <p className={cn("text-sm", r.valor ? (alerta ? "text-atencao-texto font-semibold" : "text-ink") : "text-ink-subtle")} data-valor-item>{r.valor ?? "Sem resposta"}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {it.opcoes.map((op, idx) => {
                        const sel = r.valor === op;
                        return (
                          <button key={op} type="button" onClick={() => mudar(it.id, { valor: op })} aria-pressed={sel} data-opcao={op}
                            className={cn("px-3 py-2 rounded-lg text-sm font-medium border transition-colors",
                              sel ? (idx === 0 ? "bg-success-500 border-success-500 text-white" : "bg-atencao border-atencao text-white")
                                : "bg-white border-surface-border text-ink-muted hover:border-primary-300")}>
                            {op}
                          </button>
                        );
                      })}
                    </div>
                  ))}

                  {it.tipo === "TEXTO" && (somenteLeitura
                    ? <p className={cn("text-sm whitespace-pre-wrap", r.valor ? "text-ink" : "text-ink-subtle")} data-valor-item>{r.valor ?? "Sem resposta"}</p>
                    : <Textarea value={r.valor ?? ""} onChange={(e) => mudar(it.id, { valor: e.target.value })} rows={2} placeholder="Descreva" aria-label={it.descricao} />)}

                  {it.tipo === "FOTO" && (
                    <div className="flex items-center gap-3">
                      {r.foto
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={r.foto} alt={it.descricao} className={cn("rounded-lg object-cover border border-surface-border", somenteLeitura ? "w-28 h-28" : "w-16 h-16")} data-foto-item />
                        : somenteLeitura && <p className="text-sm text-ink-subtle" data-valor-item>Sem foto</p>}
                      {!somenteLeitura && (
                        <Button type="button" variant="secondary" onClick={() => { fotoItem.current = it.id; fotoRef.current?.click(); }} className="text-xs py-1.5 px-3 h-auto">
                          <Camera className="w-4 h-4" aria-hidden /> {r.foto ? "Trocar foto" : "Tirar foto"}
                        </Button>
                      )}
                      {!somenteLeitura && r.foto && (
                        <button type="button" onClick={() => mudar(it.id, { foto: null })} aria-label={`Excluir a foto de ${it.descricao}`} className="p-1 text-atrasado hover:text-atrasado-texto"><X className="w-4 h-4" aria-hidden /></button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
