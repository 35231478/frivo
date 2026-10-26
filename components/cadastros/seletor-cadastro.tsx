"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import { CADASTROS, type DefCadastro, type EntidadeCadastro } from "@/lib/cadastros/registro";
import { opcoesCadastro, type ItemCadastro } from "@/lib/cadastros/opcoes";
import { CadastroRapidoModal, usePodeCriar, type CampoRapido, type PermissaoCriar } from "@/components/ui/select-cadastro-rapido";

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

/** Mini-formulário do cadastro rápido a partir do registro: só os campos principais (sem grupo). */
export function camposRapidos(def: DefCadastro): CampoRapido[] {
  return def.campos.filter((c) => !c.grupo).map((c) => ({
    nome: c.key,
    label: c.label,
    obrigatorio: c.obrigatorio,
    placeholder: c.placeholder,
    tipo: c.tipo === "textarea" ? "textarea" : c.tipo === "select" ? "select" : c.tipo === "cor" ? "cor" : "texto",
    opcoes: c.opcoes,
    inputMode: c.tipo === "email" ? "email" : c.tipo === "inteiro" ? "numeric"
      : c.tipo === "moeda" || c.tipo === "numero" ? "decimal" : undefined,
  }));
}

/** Permissão de criar do registro no formato do cadastro rápido (null = qualquer logado). */
export function permissaoCriarCadastro(def: DefCadastro): PermissaoCriar | undefined {
  return def.permissoes.criar?.map(([modulo, acao]) => ({ modulo, acao }));
}

const VALOR_CRIAR = "__criar__";

/**
 * Seletor padrão de um cadastro (cargo, produto, serviço, categoria…): só ativos para nova
 * escolha; o valor atual continua visível mesmo inativo ("(inativo)"). O valor é o que o
 * registro grava (o id; um cadastro com `chave: "nome"` grava o nome).
 *
 * Princípio 1 (cadastro inline): quem tem a permissão de criar vê "+ Novo …" no fim da lista,
 * que abre o cadastro rápido (campos principais do registro) sem sair da tela — ao salvar, o
 * item criado já fica selecionado. `semCriar` desliga (ex.: filtros de busca).
 */
export function SeletorCadastro({
  entidade, valor, onChange, itens: itensProp, placeholder, vazio, className, disabled, id, nome, semCriar,
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
  /** Sem a opção "+ Novo…" (ex.: seletor usado como filtro) */
  semCriar?: boolean;
}) {
  const def = CADASTROS[entidade];
  const proprio = useCadastro(entidade, itensProp);
  // Itens criados inline quando a página trouxe a lista pronta (itensProp é imutável aqui)
  const [extras, setExtras] = useState<ItemCadastro[]>([]);
  const [modal, setModal] = useState(false);
  const itens = useMemo(
    () => (itensProp ? [...itensProp, ...extras.filter((e) => !itensProp.some((i) => i.id === e.id))] : proprio.itens),
    [itensProp, extras, proprio.itens],
  );
  const carregando = !itensProp && proprio.carregando;
  // Carregando: sem opções (senão o valor atual piscaria como "(cadastro removido)" antes da lista chegar)
  const opcoes = useMemo(() => (carregando ? [] : opcoesCadastro(itens, [valor], def.chave, { feminino: def.feminino })), [carregando, itens, valor, def]);
  const textoVazio = vazio ?? placeholder ?? "Selecione…";

  // "+ Novo …": só com a permissão de criar e para cadastros de formulário simples (sem editor próprio)
  const podeCriar = usePodeCriar(permissaoCriarCadastro(def));
  const comCriar = !semCriar && !def.editorProprio && podeCriar;

  const ultimoCriado = useRef<ItemCadastro | null>(null);
  const criar = useCallback(async (valores: Record<string, string>) => {
    const r = await fetch(`/api/cadastros/${entidade}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valores),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.id) throw new Error(d?.erro ?? `Não foi possível criar ${def.feminino ? "a" : "o"} ${def.singular}.`);
    const item = d as ItemCadastro;
    ultimoCriado.current = item;
    if (itensProp) setExtras((s) => [...s, item]);
    else proprio.setItens((s) => [...s, item]);
    return { value: String(item[def.chave] ?? item.id), label: item.nome };
  }, [entidade, def, itensProp, proprio]);

  return (
    <div>
      <Select
        id={id} name={nome} className={className} disabled={disabled || carregando}
        value={valor ?? ""} data-seletor-cadastro={entidade}
        onChange={(e) => {
          if (e.target.value === VALOR_CRIAR) { setModal(true); return; }
          onChange(e.target.value, opcoes.find((o) => o.valor === e.target.value)?.item ?? null);
        }}
      >
        <option value="">{carregando ? "Carregando…" : textoVazio}</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor} data-inativo={o.inativo || undefined}>{o.rotulo}</option>
        ))}
        {comCriar && !carregando && (
          <option value={VALOR_CRIAR} data-criar>＋ {def.feminino ? "Nova" : "Novo"} {def.singular}…</option>
        )}
      </Select>
      {!itensProp && proprio.erro && <p className="text-xs text-atrasado mt-1">{proprio.erro}</p>}
      {comCriar && (
        <CadastroRapidoModal
          aberto={modal} onFechar={() => setModal(false)}
          titulo={`${def.feminino ? "Nova" : "Novo"} ${def.singular}`}
          campos={camposRapidos(def)} criar={criar} linkCadastroCompleto={def.rota}
          onCriado={(o) => {
            setModal(false);
            onChange(o.value, ultimoCriado.current);
          }}
        />
      )}
    </div>
  );
}
