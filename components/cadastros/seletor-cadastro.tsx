"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import { CADASTROS, type DefCadastro, type EntidadeCadastro } from "@/lib/cadastros/registro";
import { opcoesCadastro, type ItemCadastro } from "@/lib/cadastros/opcoes";
import { BotaoEditarNoContexto, CadastroRapidoModal, EdicaoNoContextoModal, usePodeCriar, type CampoRapido, type PermissaoCriar } from "@/components/ui/select-cadastro-rapido";

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
  // Campos booleanos ficam de fora do cadastro rápido (valem o padrão do registro)
  return def.campos.filter((c) => !c.grupo && c.tipo !== "booleano" && c.tipo !== "cadastro").map((c) => ({
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

/** Permissão de editar do registro, no mesmo formato. */
export function permissaoEditarCadastro(def: DefCadastro): PermissaoCriar | undefined {
  return def.permissoes.editar?.map(([modulo, acao]) => ({ modulo, acao }));
}

/** De quem é o cadastro, para o rótulo "Editando o cadastro …": "do cargo", "da categoria de produto". */
export const alvoDoCadastro = (def: DefCadastro) => `d${def.feminino ? "a" : "o"} ${def.singular}`;

/** Os valores atuais do item nos campos do cadastro rápido (como o formulário mostra). */
export function valoresDoItem(def: DefCadastro, item: ItemCadastro): Record<string, string> {
  const registro = item as unknown as Record<string, unknown>;
  return Object.fromEntries(camposRapidos(def).map((c) => {
    const campo = def.campos.find((x) => x.key === c.nome);
    const v = registro[c.nome];
    return [c.nome, v == null ? "" : campo?.formatar ? campo.formatar(String(v)) : String(v)];
  }));
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
 *
 * `editavel` (editar no contexto): quem tem a permissão de editar vê um lápis ao lado do seletor, que
 * abre os campos principais do item escolhido sem sair da tela. É edição de REFERÊNCIA — muda o
 * cadastro em todo lugar, e o painel diz isso ("Editando o cadastro do cargo"). Só para cadastros de
 * formulário simples; os de editor próprio continuam no cadastro completo.
 */
export function SeletorCadastro({
  entidade, valor, onChange, itens: itensProp, placeholder, vazio, className, disabled, id, nome, semCriar, editavel, aoEditar,
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
  /** Lápis para editar o item escolhido sem sair da tela (edição do cadastro-mãe) */
  editavel?: boolean;
  /** Avisa a tela que o item foi editado aqui (para atualizar o que ela guardou dele) */
  aoEditar?: (item: ItemCadastro) => void;
}) {
  const def = CADASTROS[entidade];
  const proprio = useCadastro(entidade, itensProp);
  // Itens criados inline quando a página trouxe a lista pronta (itensProp é imutável aqui)
  const [extras, setExtras] = useState<ItemCadastro[]>([]);
  const [modal, setModal] = useState(false);
  // Itens editados aqui quando a página trouxe a lista pronta (o que foi salvo vale sobre o que veio)
  const [editados, setEditados] = useState<Record<string, ItemCadastro>>({});
  const [editando, setEditando] = useState(false);
  const itens = useMemo(
    () => (itensProp ? [...itensProp, ...extras.filter((e) => !itensProp.some((i) => i.id === e.id))] : proprio.itens).map((i) => editados[i.id] ?? i),
    [itensProp, extras, proprio.itens, editados],
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

  // Editar no contexto: só cadastro de formulário simples, com a permissão de editar e um item escolhido
  const podeEditar = usePodeCriar(permissaoEditarCadastro(def));
  const escolhido = valor ? opcoes.find((o) => o.valor === valor)?.item ?? null : null;
  const comEditar = !!editavel && !def.editorProprio && podeEditar && !!escolhido && !disabled && !carregando;
  const editar = useCallback(async (valores: Record<string, string>, alterados: string[]) => {
    if (!escolhido) return;
    const r = await fetch(`/api/cadastros/${entidade}/${escolhido.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(alterados.map((k) => [k, valores[k]]))),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.id) throw new Error(d?.erro ?? `Não foi possível salvar ${def.feminino ? "a" : "o"} ${def.singular}.`);
    const item = d as ItemCadastro;
    setEditados((s) => ({ ...s, [item.id]: item }));
    aoEditar?.(item);
    return { value: String(item[def.chave] ?? item.id), label: item.nome };
  }, [entidade, def, escolhido, aoEditar]);
  const Titulo = def.singular[0].toUpperCase() + def.singular.slice(1);

  return (
    <div>
      <div className={comEditar ? "flex items-center gap-1.5" : undefined} data-seletor-com-edicao={comEditar || undefined}>
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
      {comEditar && (
        <BotaoEditarNoContexto rotulo={`Editar ${def.feminino ? "a" : "o"} ${def.singular} selecionad${def.feminino ? "a" : "o"}`} onClick={() => setEditando(true)} />
      )}
      </div>
      {comEditar && escolhido && (
        <EdicaoNoContextoModal
          aberto={editando} onFechar={() => setEditando(false)} escopo="referencia" alvo={alvoDoCadastro(def)}
          campos={camposRapidos(def)} valores={editando ? valoresDoItem(def, escolhido) : {}}
          salvar={editar} onSalvo={() => setEditando(false)} linkCadastroCompleto={def.rota}
          mensagemSucesso={`${Titulo} atualizad${def.feminino ? "a" : "o"}.`}
        />
      )}
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
