"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, MapPin, Plus, Search, Wrench, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CadastroRapidoModal, usePodeCriar, type OpcaoCadastro } from "@/components/ui/select-cadastro-rapido";
import { EQUIPAMENTO } from "@/components/cadastro-rapido/definicoes";
import { cn } from "@/lib/utils";
import {
  alternarTodos, detalheEquipamento, filtrarEquipamentos, locaisComEquipamento, rotuloEquipamento, type EquipamentoResumo,
} from "@/lib/os/vincular-equipamentos";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Gaveta "Vincular equipamento" da Nova OS: lista os equipamentos DO CLIENTE (de todos os locais
 * dele), com filtro pelo local, busca, marcação por item e "selecionar todos". Confirmar devolve os
 * escolhidos — a OS os vincula à 1ª atividade (o mesmo vínculo da execução por equipamento).
 * No celular ocupa a tela toda (o Drawer já é w-full abaixo de `sm`).
 */
export function GavetaEquipamentos({ aberto, onFechar, clienteId, unidadeId, unidades, selecionados, onConfirmar }: {
  aberto: boolean;
  onFechar: () => void;
  clienteId: string;
  /** Endereço escolhido no formulário: a gaveta abre filtrada por ele (dá para ver todos). */
  unidadeId?: string | null;
  /** Endereços do cliente (para o cadastro rápido escolher onde fica o equipamento novo). */
  unidades: OpcaoCadastro[];
  selecionados: EquipamentoResumo[];
  onConfirmar: (escolhidos: EquipamentoResumo[]) => void;
}) {
  const [lista, setLista] = useState<EquipamentoResumo[] | null>(null);
  const [rascunho, setRascunho] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [local, setLocal] = useState("");
  const [cadastrando, setCadastrando] = useState(false);
  // Os que já vinham escolhidos ao abrir: aparecem primeiro na lista
  const [iniciais, setIniciais] = useState<Set<string>>(new Set());
  const todosRef = useRef<HTMLInputElement>(null);
  const podeCadastrar = usePodeCriar(EQUIPAMENTO.permissao);

  // A cada abertura: parte do que já está escolhido, filtrada pelo endereço do formulário
  useEffect(() => {
    if (!aberto) return;
    setRascunho(new Set(selecionados.map((e) => e.id)));
    setIniciais(new Set(selecionados.map((e) => e.id)));
    setBusca("");
    setLocal(unidadeId ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  useEffect(() => {
    if (!aberto || !clienteId) return;
    let vivo = true;
    setLista(null);
    fetch(`/api/equipamentos?clienteId=${encodeURIComponent(clienteId)}&resumo=1`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (vivo) setLista(Array.isArray(d) ? d : []); })
      .catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [aberto, clienteId]);

  const todos = useMemo(() => lista ?? [], [lista]);
  const locais = useMemo(() => locaisComEquipamento(todos), [todos]);
  const visiveis = useMemo(() => {
    const l = filtrarEquipamentos(todos, { unidadeId: local, busca });
    return [...l.filter((e) => iniciais.has(e.id)), ...l.filter((e) => !iniciais.has(e.id))];
  }, [todos, local, busca, iniciais]);
  const noLocal = useMemo(() => filtrarEquipamentos(todos, { unidadeId: local }), [todos, local]);
  const porId = useMemo(() => new Map([...selecionados, ...todos].map((e) => [e.id, e])), [selecionados, todos]);
  const escolhidos = [...rascunho].map((id) => porId.get(id)).filter((e): e is EquipamentoResumo => !!e);
  // Escolhidos que o filtro/busca atual esconde (os visíveis já aparecem marcados na lista)
  const idsVisiveis = new Set(visiveis.map((e) => e.id));
  const escondidos = escolhidos.filter((e) => !idsVisiveis.has(e.id));

  const marcadosVisiveis = visiveis.filter((e) => rascunho.has(e.id)).length;
  const todosMarcados = visiveis.length > 0 && marcadosVisiveis === visiveis.length;
  useEffect(() => {
    if (todosRef.current) todosRef.current.indeterminate = marcadosVisiveis > 0 && !todosMarcados;
  }, [marcadosVisiveis, todosMarcados]);

  function alternar(id: string) {
    setRascunho((r) => { const n = new Set(r); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const semEndereco = !unidadeId && unidades.length === 0;
  const mostrarFiltroLocal = locais.length > 1 || (!!local && locais.length > 0);
  const nomeLocal = locais.find((l) => l.id === local)?.nome;

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar} titulo="Vincular equipamentos à OS"
      largura="w-full sm:w-[480px] sm:max-w-[92vw]"
      rodape={
        <>
          <span className="mr-auto text-sm text-ink-muted sr-only sm:not-sr-only" data-contador-gaveta aria-live="polite">
            {plural(rascunho.size, "selecionado", "selecionados")}
          </span>
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button
            data-confirmar-equipamentos
            onClick={() => { onConfirmar(escolhidos); onFechar(); }}
            disabled={lista === null || (rascunho.size === 0 && selecionados.length === 0)}
          >
            {rascunho.size ? (
              <>
                <span className="sm:hidden">Vincular ({rascunho.size})</span>
                <span className="hidden sm:inline">Vincular {plural(rascunho.size, "equipamento", "equipamentos")}</span>
              </>
            ) : selecionados.length ? "Tirar todos" : "Vincular"}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-gaveta-equipamentos>
        {lista === null && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted" role="status">
            <Loader2 className="w-5 h-5 animate-spin text-ink-subtle" aria-hidden="true" /> Carregando os equipamentos do cliente…
          </div>
        )}

        {/* Estado vazio: o cliente ainda não tem equipamento */}
        {lista !== null && todos.length === 0 && (
          <div className="text-center rounded-card border border-dashed border-surface-border bg-surface-page px-5 py-8" data-gaveta-vazia>
            <Wrench className="w-8 h-8 mx-auto text-ink-subtle" aria-hidden="true" />
            <p className="mt-3 font-medium text-ink">Este cliente ainda não tem equipamento cadastrado</p>
            {semEndereco ? (
              // Equipamento fica num endereço: sem endereço, o cadastro rápido não teria onde pôr
              <p className="mt-1 text-sm text-ink-muted" data-sem-endereco>
                Ele também não tem endereço: cadastre o endereço no campo <strong>Endereço do cliente</strong> e depois o equipamento —
                ou abra a OS sem equipamento e vincule depois, na execução.
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">
                Cadastre agora e ele já entra selecionado — ou abra a OS sem equipamento e vincule depois, na execução.
              </p>
            )}
            {podeCadastrar && !semEndereco && (
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2">
                <Button onClick={() => setCadastrando(true)} data-cadastrar-equipamento><Plus className="w-4 h-4" /> Cadastrar equipamento</Button>
                <a href={EQUIPAMENTO.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-acento hover:underline">
                  Cadastro completo <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              </div>
            )}
          </div>
        )}

        {lista !== null && todos.length > 0 && (
          <>
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" aria-hidden="true" />
                <Input
                  autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9"
                  aria-label="Buscar equipamento" placeholder="Nome, marca, modelo, BTU/TR, TAG ou local"
                />
              </div>
              {mostrarFiltroLocal && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden="true" />
                  <Select aria-label="Filtrar por local" value={local} onChange={(e) => setLocal(e.target.value)} data-filtro-local>
                    <option value="">Todos os locais ({todos.filter((e) => e.ativo !== false).length})</option>
                    {locais.map((l) => <option key={l.id} value={l.id}>{l.nome} ({l.qtd})</option>)}
                  </Select>
                </div>
              )}
            </div>

            {/* Escolhidos que o filtro/busca esconde: continuam valendo, e dá para tirar daqui */}
            {escondidos.length > 0 && (
              <div data-ja-selecionados>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1.5">
                  {escondidos.length === 1 ? "1 selecionado fora deste filtro" : `${escondidos.length} selecionados fora deste filtro`}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {escondidos.map((e) => (
                    <li key={e.id} className="inline-flex items-center gap-1 max-w-full pl-2.5 pr-1 py-1 rounded-full bg-acento-claro text-acento-hover text-xs">
                      <span className="truncate">{rotuloEquipamento(e)}</span>
                      <button type="button" onClick={() => alternar(e.id)} aria-label={`Tirar ${rotuloEquipamento(e)}`}
                        className="p-0.5 rounded-full hover:bg-white/70"><X className="w-3 h-3" aria-hidden="true" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {visiveis.length > 0 && (
              <label className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-page border border-surface-border text-sm font-medium text-ink cursor-pointer">
                <input
                  ref={todosRef} type="checkbox" className="w-4 h-4 accent-acento" checked={todosMarcados}
                  onChange={() => setRascunho((r) => alternarTodos(r, visiveis.map((e) => e.id)))} data-selecionar-todos
                />
                {todosMarcados ? "Desmarcar todos" : "Selecionar todos"}
                <span className="ml-auto text-xs font-normal text-ink-muted">
                  {busca || local ? `${visiveis.length} ${visiveis.length === 1 ? "visível" : "visíveis"}` : plural(visiveis.length, "equipamento", "equipamentos")}
                </span>
              </label>
            )}

            {visiveis.length === 0 && (
              <div className="text-center py-6 text-sm text-ink-muted" data-gaveta-sem-resultado>
                {busca ? (
                  <>
                    <p>Nenhum equipamento encontrado para “{busca}”{nomeLocal ? ` em ${nomeLocal}` : ""}.</p>
                    <button type="button" onClick={() => setBusca("")} className="mt-2 font-semibold text-acento hover:underline">Limpar busca</button>
                  </>
                ) : (
                  <>
                    <p>Nenhum equipamento em {nomeLocal ?? "este local"}.</p>
                    {noLocal.length === 0 && local && (
                      <button type="button" onClick={() => setLocal("")} className="mt-2 font-semibold text-acento hover:underline" data-ver-todos-locais>
                        Ver os de todos os locais
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <ul className="space-y-1.5" aria-label="Equipamentos do cliente">
              {visiveis.map((e) => {
                const marcado = rascunho.has(e.id);
                return (
                  <li key={e.id}>
                    <label
                      data-opcao-equipamento={e.id}
                      className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
                        marcado ? "border-acento/40 bg-acento-claro/50" : "border-surface-border bg-white hover:border-acento/30")}
                    >
                      <input type="checkbox" className="w-4 h-4 shrink-0 accent-acento" checked={marcado} onChange={() => alternar(e.id)} />
                      <span className="min-w-0">
                        <span className="block text-sm text-ink truncate">{rotuloEquipamento(e)}</span>
                        <span className="block text-xs text-ink-muted truncate">{detalheEquipamento(e, !local)}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {podeCadastrar && (
              <button type="button" onClick={() => setCadastrando(true)} className="inline-flex items-center gap-1 text-sm font-semibold text-acento hover:underline">
                <Plus className="w-4 h-4" aria-hidden="true" /> Cadastrar outro equipamento
              </button>
            )}
          </>
        )}
      </div>

      <CadastroRapidoModal
        aberto={cadastrando} onFechar={() => setCadastrando(false)} titulo="Novo equipamento"
        contexto="para este cliente" campos={EQUIPAMENTO.campos(local || unidadeId ? undefined : unidades)}
        linkCadastroCompleto={EQUIPAMENTO.link}
        criar={async (v) => {
          const novo = await EQUIPAMENTO.criar(local || unidadeId || "", v) as EquipamentoResumo & { unidade?: { id: string; nome: string } | null };
          const unidadeNova = novo.unidade ?? (() => { const u = unidades.find((x) => x.value === (novo.unidadeId ?? v.unidadeId)); return u ? { id: u.value, nome: u.label } : null; })();
          const item: EquipamentoResumo = { ...novo, unidade: unidadeNova, ativo: true };
          setLista((l) => [...(l ?? []), item]);
          setRascunho((r) => new Set(r).add(item.id));
          return { value: item.id, label: rotuloEquipamento(item) };
        }}
        onCriado={() => setCadastrando(false)}
      />
    </Drawer>
  );
}
