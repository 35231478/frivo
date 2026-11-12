"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

type Duplicado = { id: string; descricao: string; fabricanteModelo: string; local: string; ativo: boolean };
/** Equipamento salvo NESTA leva do cadastro por foto (a sequência de "Cadastrar outro") */
export interface ItemLeva { id: string; numeroSerie: string; descricao: string }

/** A partir de quantos caracteres a série é conferida (menos que isso dá coincidência demais) */
export const SERIE_MIN = 3;
/** Mesma etiqueta? Sem ligar para maiúsculas e espaços nas pontas — a mesma regra da consulta ao servidor */
export function mesmaSerie(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  return x.length >= SERIE_MIN && x === (b ?? "").trim().toLowerCase();
}

/**
 * Aviso (não bloqueia) quando o nº de série digitado/lido já existe em outro equipamento da
 * empresa — normalmente a mesma etiqueta cadastrada duas vezes. Com `leva`, avisa também (e na
 * hora, sem depender do servidor) quando a série repete uma que acabou de ser cadastrada na mesma
 * leva: a etiqueta fotografada duas vezes.
 */
export function AvisoSerieDuplicada({ numero, ignorarId, leva = [] }: { numero: string; ignorarId?: string; leva?: ItemLeva[] }) {
  const [duplicados, setDuplicados] = useState<Duplicado[]>([]);

  useEffect(() => {
    const n = numero.trim();
    if (n.length < SERIE_MIN) { setDuplicados([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ numero: n, ...(ignorarId && { ignorar: ignorarId }) });
      fetch(`/api/equipamentos/serie?${qs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { duplicados: [] }))
        .then((d) => setDuplicados(Array.isArray(d?.duplicados) ? d.duplicados : []))
        .catch(() => {});
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [numero, ignorarId]);

  // Da mesma leva: confere no aparelho (vale sem sinal e antes de o servidor responder)
  const daLeva = leva.filter((l) => l.id !== ignorarId && mesmaSerie(numero, l.numeroSerie));
  const idsLeva = new Set(daLeva.map((l) => l.id));
  const doServidor = duplicados.filter((d) => !idsLeva.has(d.id));
  const total = daLeva.length + doServidor.length;

  if (!total) return null;
  return (
    <div data-aviso-serie data-aviso-serie-leva={daLeva.length ? "" : undefined} className="mt-1.5 text-xs text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        {daLeva.length
          ? "Este nº de série já foi cadastrado nesta leva. Confira se não fotografou a mesma etiqueta duas vezes."
          : `Este nº de série já está cadastrado${total > 1 ? ` em ${total} equipamentos` : ""}. Confira se não é a mesma etiqueta.`}
      </p>
      <ul className="mt-1 ml-5 list-disc space-y-0.5">
        {daLeva.map((l) => {
          const servidor = duplicados.find((d) => d.id === l.id);
          return (
            <li key={l.id} data-serie-da-leva>
              <Link href={`/equipamentos/${l.id}`} target="_blank" className="underline hover:text-atencao-texto">{servidor ? `${servidor.descricao}${servidor.fabricanteModelo ? ` · ${servidor.fabricanteModelo}` : ""}` : l.descricao}</Link>
              {servidor?.local ? ` — ${servidor.local}` : ""} (cadastrado agora, nesta leva)
            </li>
          );
        })}
        {doServidor.map((d) => (
          <li key={d.id}>
            <Link href={`/equipamentos/${d.id}`} target="_blank" className="underline hover:text-atencao-texto">
              {d.descricao}{d.fabricanteModelo ? ` · ${d.fabricanteModelo}` : ""}
            </Link>
            {d.local ? ` — ${d.local}` : ""}{!d.ativo ? " (inativo)" : ""}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-atencao-texto">Apenas um aviso: é possível salvar assim mesmo.</p>
    </div>
  );
}
