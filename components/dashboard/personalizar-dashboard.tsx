"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COOKIE_DASHBOARD, PREF_PADRAO, serializarPreferencia, type BlocoId } from "@/lib/dashboard/blocos";

interface Item { id: BlocoId; titulo: string; descricao: string }

/**
 * Liga/desliga e reordena os blocos. A preferência fica num cookie deste navegador
 * (sem banco): o servidor lê o cookie e só consulta os blocos visíveis, já na ordem certa.
 */
export function PersonalizarDashboard({ blocos, ocultosIniciais }: { blocos: Item[]; ocultosIniciais: BlocoId[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<Item[]>(blocos);
  const [ocultos, setOcultos] = useState<Set<BlocoId>>(new Set(ocultosIniciais));

  function abrir() { setLista(blocos); setOcultos(new Set(ocultosIniciais)); setAberto(true); }

  function mover(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    const nova = [...lista];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setLista(nova);
  }

  function alternar(id: BlocoId) {
    setOcultos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function gravar(valor: string | null) {
    const umAno = 60 * 60 * 24 * 365;
    document.cookie = valor === null
      ? `${COOKIE_DASHBOARD}=; path=/; max-age=0; samesite=lax`
      : `${COOKIE_DASHBOARD}=${valor}; path=/; max-age=${umAno}; samesite=lax`;
    setAberto(false);
    router.refresh();
  }

  function salvar() {
    // Guarda a ordem completa (inclui blocos de outros perfis na posição padrão)
    const meus = lista.map((b) => b.id);
    const ordem = [...meus, ...PREF_PADRAO.ordem.filter((id) => !meus.includes(id))];
    gravar(serializarPreferencia({ ordem, ocultos: [...ocultos] }));
  }

  const visiveis = lista.length - lista.filter((b) => ocultos.has(b.id)).length;

  return (
    <>
      <Button type="button" variant="secondary" onClick={abrir} data-acao="personalizar-dashboard">
        <SlidersHorizontal className="w-4 h-4" /> Personalizar
      </Button>
      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo="Personalizar dashboard">
        <p className="text-sm text-ink-muted mb-3">
          Escolha os blocos e a ordem. Vale para este navegador. Só aparecem os blocos que o seu perfil pode ver.
        </p>
        <ul className="divide-y divide-surface-border border border-surface-border rounded-lg" data-lista="blocos-dashboard">
          {lista.map((b, i) => {
            const oculto = ocultos.has(b.id);
            return (
              <li key={b.id} data-item-bloco={b.id} className={cn("flex items-center gap-2 px-3 py-2.5", oculto && "bg-surface-alt")}>
                <button type="button" onClick={() => alternar(b.id)} aria-pressed={!oculto}
                  aria-label={oculto ? `Mostrar ${b.titulo}` : `Ocultar ${b.titulo}`}
                  className={cn("p-1.5 rounded-md shrink-0", oculto ? "text-ink-subtle hover:bg-white" : "text-primary-600 hover:bg-primary-50")}>
                  {oculto ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", oculto ? "text-ink-subtle line-through" : "text-ink")}>{b.titulo}</p>
                  <p className="text-xs text-ink-subtle truncate">{b.descricao}</p>
                </div>
                <div className="flex shrink-0">
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${b.titulo}`}
                    className="p-1.5 rounded-md text-ink-muted hover:bg-surface-alt disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} aria-label={`Descer ${b.titulo}`}
                    className="p-1.5 rounded-md text-ink-muted hover:bg-surface-alt disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
          <Button type="button" variant="ghost" onClick={() => gravar(null)}><RotateCcw className="w-4 h-4" /> Restaurar padrão</Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="button" onClick={salvar} disabled={visiveis === 0} data-acao="salvar-dashboard">Salvar</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
