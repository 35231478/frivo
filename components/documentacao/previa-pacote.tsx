"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, FileText, ShieldAlert } from "lucide-react";
import { agruparItens, type Pendencia } from "@/lib/documentacao/pacote";
import { tamanhoEmPalavras } from "@/lib/colaborador/documentos";
import { formatarData } from "@/lib/utils";
import type { Previa } from "@/lib/documentacao/pacote-server";

/** As pendências de uma pessoa juntas: "Fulano — ASO (venceu em 10/01/2026), NR-35". */
function porPessoa(pendencias: readonly Pendencia[]) {
  const mapa = new Map<string, { id: string; nome: string; itens: Pendencia[] }>();
  for (const p of pendencias) {
    if (!mapa.has(p.colaboradorId)) mapa.set(p.colaboradorId, { id: p.colaboradorId, nome: p.colaboradorNome, itens: [] });
    mapa.get(p.colaboradorId)!.itens.push(p);
  }
  return [...mapa.values()];
}

/**
 * A PRÉVIA DO PACOTE: o que entra (na mesma estrutura de pastas que o cliente vai receber), o que
 * falta e o que está vencido.
 *
 * Vencido SEGURA: não há botão de "enviar assim mesmo". As duas saídas estão na linha de cada
 * pessoa — abrir a ficha para renovar o documento, ou tirar a pessoa do pacote.
 * Falta (a pessoa não tem aquele tipo de documento) não segura, mas pede a confirmação de quem envia.
 */
export function PreviaPacote({ previa, ciente, onCiente, onTirar, desabilitado }: {
  previa: Previa;
  ciente: boolean;
  onCiente: (v: boolean) => void;
  onTirar: (colaboradorId: string) => void;
  desabilitado?: boolean;
}) {
  const grupos = agruparItens(previa.itens, previa.organizacao);
  const pessoas = new Set(previa.itens.map((i) => i.colaboradorId)).size;

  return (
    <div className="space-y-3" data-previa-pacote data-liberado={previa.liberado ? "sim" : "nao"}>
      {previa.vencidos.length > 0 && (
        <section role="alert" className="border border-atrasado/30 bg-atrasado-claro rounded-lg p-3 sm:p-4 space-y-3" data-previa-vencidos>
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-5 h-5 text-atrasado shrink-0 mt-0.5" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold text-atrasado-texto">O pacote está segurado: há documento vencido</h3>
              <p className="text-sm text-atrasado-texto/90">Documento vencido não vai ao cliente. Renove o documento na ficha ou tire o colaborador do pacote.</p>
            </div>
          </div>
          <ul className="space-y-2">
            {porPessoa(previa.vencidos).map((p) => (
              <li key={p.id} className="bg-white border border-atrasado/20 rounded-lg px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between" data-vencido-de={p.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{p.nome}</p>
                  <p className="text-xs text-ink-muted">
                    {p.itens.map((i) => `${i.categoriaRotulo}${i.dataVencimento ? ` (venceu em ${formatarData(i.dataVencimento)})` : ""}`).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Link href={`/colaboradores/${p.id}/editar`} target="_blank" className="text-xs font-medium text-primary-600 hover:text-primary-700" data-abrir-ficha>
                    Abrir a ficha
                  </Link>
                  <button
                    type="button" disabled={desabilitado} onClick={() => onTirar(p.id)} data-tirar-do-pacote={p.id}
                    className="text-xs font-semibold text-atrasado-texto border border-atrasado/30 rounded-md px-2.5 py-1.5 hover:bg-atrasado-claro disabled:opacity-50"
                  >
                    Tirar do pacote
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {previa.faltando.length > 0 && (
        <section className="border border-atencao/30 bg-atencao-claro rounded-lg p-3 sm:p-4 space-y-2" data-previa-faltando>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-atencao shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-atencao-texto">Há colaborador sem documento de um tipo marcado</h3>
              <ul className="mt-1 text-sm text-atencao-texto/90 space-y-0.5">
                {porPessoa(previa.faltando).map((p) => (
                  <li key={p.id} data-faltando-de={p.id}><strong className="font-medium">{p.nome}:</strong> {p.itens.map((i) => i.categoriaRotulo).join(", ")}</li>
                ))}
              </ul>
            </div>
          </div>
          {previa.itens.length > 0 && previa.vencidos.length === 0 && (
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer pt-1">
              <input
                type="checkbox" checked={ciente} disabled={desabilitado} onChange={(e) => onCiente(e.target.checked)} data-ciente-das-faltas
                className="w-4 h-4 rounded border-surface-border text-acento focus:ring-acento"
              />
              Conferi a lista e quero enviar sem esses documentos
            </label>
          )}
        </section>
      )}

      {previa.itens.length === 0 ? (
        <p className="text-sm text-ink-muted bg-surface-alt border border-surface-border rounded-lg px-3 py-3" data-previa-vazia>
          Nenhum documento dos tipos marcados foi encontrado para estes colaboradores.
        </p>
      ) : (
        <section className="border border-surface-border rounded-lg bg-white overflow-hidden" data-previa-itens>
          <p className="px-3 py-2 text-xs font-semibold text-ink-muted border-b border-surface-linha bg-surface-alt/60" data-previa-resumo>
            {previa.itens.length} {previa.itens.length === 1 ? "arquivo" : "arquivos"} de {pessoas} {pessoas === 1 ? "colaborador" : "colaboradores"}
          </p>
          <div className="max-h-80 overflow-y-auto divide-y divide-surface-linha">
            {grupos.map((g) => (
              <div key={g.titulo} className="px-3 py-2" data-previa-grupo={g.titulo}>
                <p className="text-sm font-semibold text-ink">{g.titulo}</p>
                <ul className="mt-1 space-y-1">
                  {g.itens.map((i) => (
                    // No celular o nome ocupa a linha inteira e o tamanho e a validade descem; no desktop ficam à direita
                    <li key={i.documentoId} className="flex items-start gap-2 text-sm text-ink-muted" data-previa-item={i.documentoId}>
                      <FileText className="w-3.5 h-3.5 shrink-0 text-ink-subtle mt-1" aria-hidden />
                      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                        <span className="block truncate sm:flex-1">{i.rotulo} · {i.nome}</span>
                        <span className="flex items-center gap-3 text-xs shrink-0">
                          {tamanhoEmPalavras(i.tamanho) && <span>{tamanhoEmPalavras(i.tamanho)}</span>}
                          {i.dataVencimento && (
                            <span className={`flex items-center gap-1 ${i.venceEmBreve ? "text-atencao-texto font-medium" : ""}`} data-previa-validade>
                              <CalendarClock className="w-3 h-3" aria-hidden /> {i.venceEmBreve ? "Vence em" : "Válido até"} {formatarData(i.dataVencimento)}
                            </span>
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
