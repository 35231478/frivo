"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { CADASTROS, type EntidadeCadastro } from "@/lib/cadastros/registro";
import { opcoesCadastro, type ItemCadastro } from "@/lib/cadastros/opcoes";

/**
 * Lista completa de um cadastro (ativos e inativos), para os seletores decidirem o que mostrar.
 * `iniciais`: quando a página já trouxe a lista do servidor, não busca de novo.
 */
export function useCadastro<T extends ItemCadastro = ItemCadastro>(entidade: EntidadeCadastro, iniciais?: T[]) {
  const [itens, setItens] = useState<T[]>(iniciais ?? []);
  const [carregando, setCarregando] = useState(!iniciais);
  const [erro, setErro] = useState("");
  const recarregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const r = await fetch(`/api/cadastros/${entidade}?ativo=todos`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(d)) { setErro(d?.erro ?? `Não foi possível carregar ${CADASTROS[entidade].plural}.`); return; }
      setItens(d as T[]);
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }, [entidade]);
  useEffect(() => { if (!iniciais) void recarregar(); }, [iniciais, recarregar]);
  return { itens, setItens, carregando, erro, recarregar };
}

/**
 * Seletor padrão de um cadastro (cargo, produto, serviço, categoria…): só ativos para nova
 * escolha; o valor atual continua visível mesmo inativo ("(inativo)"). O valor é o que o
 * registro grava (id, ou o nome no caso da categoria financeira).
 */
export function SeletorCadastro({
  entidade, valor, onChange, itens: itensProp, placeholder, vazio, className, disabled, id, nome,
}: {
  entidade: EntidadeCadastro;
  valor: string | null | undefined;
  onChange: (valor: string, item: ItemCadastro | null) => void;
  /** Lista já carregada (ativos e inativos); sem ela, o seletor busca sozinho */
  itens?: ItemCadastro[];
  /** Primeira opção vazia ("Selecione…"); `vazio` = texto da opção "nenhum" (ex.: "Sem categoria") */
  placeholder?: string;
  vazio?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  nome?: string;
}) {
  const def = CADASTROS[entidade];
  const proprio = useCadastro(entidade, itensProp);
  const itens = itensProp ?? proprio.itens;
  const opcoes = useMemo(() => opcoesCadastro(itens, [valor], def.chave, { feminino: def.feminino }), [itens, valor, def]);
  const textoVazio = vazio ?? placeholder ?? "Selecione…";

  return (
    <div>
      <Select
        id={id} name={nome} className={className} disabled={disabled || (!itensProp && proprio.carregando)}
        value={valor ?? ""} data-seletor-cadastro={entidade}
        onChange={(e) => onChange(e.target.value, opcoes.find((o) => o.valor === e.target.value)?.item ?? null)}
      >
        <option value="">{!itensProp && proprio.carregando ? "Carregando…" : textoVazio}</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor} data-inativo={o.inativo || undefined}>{o.rotulo}</option>
        ))}
      </Select>
      {!itensProp && proprio.erro && <p className="text-xs text-red-600 mt-1">{proprio.erro}</p>}
    </div>
  );
}
