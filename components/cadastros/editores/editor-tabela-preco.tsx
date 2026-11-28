"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Percent, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { cn, formatarMoeda, LABELS_TIPO_TABELA_PRECO } from "@/lib/utils";
import { calcularValorFinalTabela } from "@/lib/tabela-preco-helpers";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";
import { alternarTodos, escolhidos, estadoDeTodos, filtrarCatalogo, type FiltroTipo } from "@/lib/tabela-preco-selecao";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { Dica } from "@/components/ui/dica";
import { CADASTROS } from "@/lib/cadastros/registro";
import { DesfazerReajuste, ModalReajuste, type LoteResumo } from "@/components/cadastros/editores/reajuste-tabela";

interface CatalogoItem { id: string; nome: string; valorPadrao: number; kind: "SERVICO" | "PRODUTO"; codigo?: string | number | null }
interface ItemEdit {
  /** `dbId`: a linha gravada (o reajuste em massa escolhe por ela); item recém-adicionado não tem */
  _id: string; dbId?: string; catalogoId: string; kind: "SERVICO" | "PRODUTO"; nome: string; valorPadrao: number; inativo: boolean;
  tipoPreco: "VALOR_FIXO" | "DESCONTO_PERCENTUAL"; valorFixo: string; descontoPercent: string;
}

function uid() { return Math.random().toString(36).slice(2); }

/** Os preços dos itens, para saber se a lista mudou desde que carregou (o reajuste exige a tabela salva) */
const assinatura = (itens: ItemEdit[]) => JSON.stringify(itens.map((i) => [i.catalogoId, i.tipoPreco, i.valorFixo, i.descontoPercent]));

/** Itens gravados → edição (o serviço/produto vem junto, mesmo inativo no catálogo). */
function paraEdicao(itens: unknown): ItemEdit[] {
  return (Array.isArray(itens) ? itens : []).map((it: any) => {
    const cat = it.servico ?? it.produto;
    return {
      _id: uid(),
      dbId: it.id,
      catalogoId: it.servicoId ?? it.produtoId ?? "",
      kind: it.servicoId ? "SERVICO" : "PRODUTO",
      nome: cat?.nome ?? "(item removido)",
      valorPadrao: cat?.valorPadrao ? Number(cat.valorPadrao) : 0,
      inativo: cat?.ativo === false,
      tipoPreco: it.tipoPreco,
      valorFixo: it.valorFixo != null ? String(Number(it.valorFixo)) : "",
      descontoPercent: it.descontoPercent != null ? String(Number(it.descontoPercent)) : "",
    };
  });
}

/**
 * Editor de tabela de preços (CadastroPadrao › tabelas-preco): nome, tipo e os itens (adicionados em massa).
 * Grava pela rota genérica; o valor final de cada item é recalculado no servidor. Não há mais "bloquear preço"
 * aqui: o preço que vem da tabela fica SEMPRE travado no orçamento e na OS, e quem pode mudar é decidido pela
 * permissão "Alterar preço de tabela" do perfil (lib/precos/trava-tabela).
 */
export function EditorTabelaPreco({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [erroCatalogo, setErroCatalogo] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState("PERSONALIZADA");
  const [itens, setItens] = useState<ItemEdit[]>([]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [carregando, setCarregando] = useState(false);
  // Só grava os itens depois de carregá-los: salvar com a lista vazia apagaria os preços da tabela
  const [itensOk, setItensOk] = useState(false);

  // Reajuste em massa (lib/precos/reajuste-tabela): só na tabela já criada, para quem edita tabela de preço
  const { pode } = usePermissoes();
  const reqEditar = CADASTROS["tabelas-preco"].permissoes.editar;
  const podeReajustar = !!item && (!reqEditar || reqEditar.some(([m, a]) => pode(m, a)));
  const [carregados, setCarregados] = useState("");
  const [selReajuste, setSelReajuste] = useState<Set<string>>(new Set());
  const [reajustando, setReajustando] = useState(false);
  const [ultimoLote, setUltimoLote] = useState<LoteResumo | null>(null);
  const [recarga, setRecarga] = useState(0);
  const sujo = itensOk && assinatura(itens) !== carregados;

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    setNome(item?.nome ?? ""); setDescricao((item?.descricao as string | null) ?? ""); setTipo(item?.tipo ?? "PERSONALIZADA");
    setItens([]); setItensOk(!item); setSelReajuste(new Set()); setUltimoLote(null); setCarregados(assinatura([])); setRecarga(0);
  }, [aberto, item]);

  // Os itens (a lista não os traz: busca o registro completo) e o último reajuste. `recarga`: depois de reajustar ou
  // desfazer, vêm de novo do servidor (nome, tipo e descrição digitados ficam)
  useEffect(() => {
    if (!aberto || !item) return;
    let cancelado = false;
    setCarregando(true);
    fetch(`/api/cadastros/tabelas-preco/${item.id}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => null); if (cancelado) return; if (r.ok && d) { const lista = paraEdicao(d.itens); setItens(lista); setCarregados(assinatura(lista)); setItensOk(true); } else setErro(d?.erro ?? "Não foi possível carregar os itens da tabela."); })
      .catch(() => { if (!cancelado) setErro("Erro de conexão ao carregar os itens."); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    if (podeReajustar) {
      fetch(`/api/cadastros/tabelas-preco/${item.id}/reajustes`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelado) setUltimoLote(d?.ultimo ?? null); }).catch(() => {});
    }
    return () => { cancelado = true; };
  }, [aberto, item, recarga, podeReajustar]);

  const aposReajuste = () => { setReajustando(false); setRecarga((n) => n + 1); };
  const alternarReajuste = (dbId: string) => setSelReajuste((s) => { const n = new Set(s); if (n.has(dbId)) n.delete(dbId); else n.add(dbId); return n; });
  const idsReajuste = itens.filter((i) => i.dbId && selReajuste.has(i.dbId)).map((i) => i.dbId!);
  const dicaSujo = "Salve as alterações da tabela antes de reajustar ou desfazer: o reajuste vale sobre os preços gravados.";

  useEffect(() => {
    if (!aberto || catalogo.length) return;
    // Catálogo para ADICIONAR itens: só ativos (itens já na tabela trazem os próprios dados, mesmo inativos)
    // Falhou carregar (sessão, servidor, conexão): o seletor diz isso, em vez de "nada para adicionar"
    const lista = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => { setErroCatalogo(true); return []; });
    setErroCatalogo(false);
    Promise.all([
      lista("/api/cadastros/servicos?ativo=sim"),
      lista("/api/cadastros/produtos?ativo=sim"),
    ]).then(([s, p]) => setCatalogo([
      ...(Array.isArray(s) ? s : []).map((x: any) => ({ id: x.id, nome: x.nome, codigo: x.codigo ?? null, valorPadrao: x.valorPadrao ? Number(x.valorPadrao) : 0, kind: "SERVICO" as const })),
      ...(Array.isArray(p) ? p : []).map((x: any) => ({ id: x.id, nome: x.nome, codigo: x.codigo ?? null, valorPadrao: x.valorPadrao ? Number(x.valorPadrao) : 0, kind: "PRODUTO" as const })),
    ]));
  }, [aberto, catalogo.length]);

  /** Adiciona de uma vez os escolhidos (cada um com o preço padrão como valor fixo inicial) */
  function adicionarDoCatalogo(cs: CatalogoItem[]) {
    setItens((p) => {
      const ja = new Set(p.map((i) => i.catalogoId));
      return [...p, ...cs.filter((c) => !ja.has(c.id)).map((c) => ({
        _id: uid(), catalogoId: c.id, kind: c.kind, nome: c.nome, valorPadrao: c.valorPadrao, inativo: false,
        tipoPreco: "VALOR_FIXO" as const, valorFixo: String(c.valorPadrao || ""), descontoPercent: "",
      }))];
    });
  }
  const patch = (id: string, p: Partial<ItemEdit>) => setItens((arr) => arr.map((i) => (i._id === id ? { ...i, ...p } : i)));

  async function salvar() {
    if (!nome.trim()) { setErro("Informe o nome da tabela."); return; }
    if (!itensOk) { setErro("Os itens da tabela não carregaram: feche e abra de novo antes de salvar."); return; }
    setSalvando(true); setErro("");
    const r = await salvarCadastro("tabelas-preco", item?.id ?? null, {
      // precosBloqueados/bloqueado vão sempre falsos: a trava agora é a regra do sistema + a permissão do perfil
      nome: nome.trim(), descricao: descricao.trim() || null, tipo, precosBloqueados: false,
      itens: itens.map((i) => ({
        servicoId: i.kind === "SERVICO" ? i.catalogoId : null,
        produtoId: i.kind === "PRODUTO" ? i.catalogoId : null,
        tipoPreco: i.tipoPreco,
        valorFixo: i.tipoPreco === "VALOR_FIXO" ? i.valorFixo : null,
        descontoPercent: i.tipoPreco === "DESCONTO_PERCENTUAL" ? i.descontoPercent : null,
        bloqueado: false,
      })),
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    onSalvo(r.item);
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar}
      titulo={item ? `Editar ${item.nome}` : "Nova tabela de preços"}
      largura="w-full sm:w-[62vw] sm:min-w-[560px] sm:max-w-[940px]"
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} disabled={carregando} onClick={salvar}><Check className="w-4 h-4" /> {item ? "Salvar" : "Criar"}</Button>
      </>}
    >
      <div className="space-y-4">
        {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">{erro}</div>}
        {item && item.ativo === false && <p className="text-sm bg-atencao-claro border border-atencao/20 text-atencao-texto rounded-lg px-3 py-2">Tabela inativa: os clientes ligados a ela usam a tabela Padrão até ela ser reativada.</p>}

        <FormGrid cols={2}>
          <FormField label="Nome" required><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Contrato, Belma" maxLength={120} /></FormField>
          <FormField label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {Object.entries(LABELS_TIPO_TABELA_PRECO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormField>
        </FormGrid>
        <FormField label="Descrição"><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} /></FormField>

        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <h5 className="text-xs font-bold text-ink-muted uppercase tracking-wider">Itens da tabela</h5>
            {podeReajustar && itensOk && itens.some((i) => i.dbId) && (
              <div className="flex items-center gap-2" data-acoes-reajuste>
                {sujo && <Dica texto={dicaSujo} rotulo="Reajuste" />}
                {ultimoLote && <DesfazerReajuste tabelaId={item!.id} lote={ultimoLote} disabled={sujo} onDesfeito={aposReajuste} />}
                <Button type="button" size="sm" variant="secondary" disabled={sujo} onClick={() => setReajustando(true)} data-reajustar-precos>
                  <Percent className="w-4 h-4" /> {idsReajuste.length ? `Reajustar selecionados (${idsReajuste.length})` : "Reajustar preços"}
                </Button>
              </div>
            )}
          </div>
          <SeletorCatalogo catalogo={catalogo} erroCatalogo={erroCatalogo} jaAdicionados={itens.map((i) => i.catalogoId)} onAdicionar={adicionarDoCatalogo} />

          <div className="space-y-2 mt-3">
            {carregando && <p className="text-sm text-ink-subtle text-center py-4">Carregando itens…</p>}
            {!carregando && itens.length === 0 && <p className="text-sm text-ink-subtle text-center py-4 italic">Nenhum item. Busque um serviço ou produto acima.</p>}
            {itens.map((it) => {
              const valorFinal = calcularValorFinalTabela(it.tipoPreco, it.valorFixo === "" ? 0 : Number(it.valorFixo), it.descontoPercent === "" ? 0 : Number(it.descontoPercent), it.valorPadrao);
              return (
                <div key={it._id} className="border border-surface-border rounded-lg p-3 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      {podeReajustar && it.dbId && (
                        <input type="checkbox" className="w-4 h-4" checked={selReajuste.has(it.dbId)} onChange={() => alternarReajuste(it.dbId!)}
                          aria-label={`Selecionar ${it.nome} para o reajuste`} data-sel-reajuste={it.dbId} />
                      )}
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", it.kind === "SERVICO" ? "bg-primary-50 text-primary-700" : "bg-acento-claro text-acento-hover")}>{it.kind === "SERVICO" ? "Serviço" : "Produto"}</span>
                      <span className="text-sm font-medium text-ink truncate">{it.nome}</span>
                      {it.inativo && <span className="text-[10px] font-semibold bg-atencao-claro text-atencao-texto px-1.5 py-0.5 rounded" title="Inativo no catálogo: o preço continua valendo nesta tabela">inativo</span>}
                      <span className="text-xs text-ink-subtle">(padrão {formatarMoeda(it.valorPadrao)})</span>
                    </div>
                    <button type="button" onClick={() => setItens((a) => a.filter((x) => x._id !== it._id))} className="p-1.5 text-ink-muted hover:text-atrasado" aria-label={`Tirar ${it.nome} da tabela`}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <FormGrid cols={3}>
                    <FormField label="Tipo de preço">
                      <Select value={it.tipoPreco} onChange={(e) => patch(it._id, { tipoPreco: e.target.value as ItemEdit["tipoPreco"] })}>
                        <option value="VALOR_FIXO">Valor fixo</option>
                        <option value="DESCONTO_PERCENTUAL">Desconto percentual</option>
                      </Select>
                    </FormField>
                    {it.tipoPreco === "VALOR_FIXO" ? (
                      <FormField label="Valor (R$)"><Input type="number" min="0" step="0.01" value={it.valorFixo} onChange={(e) => patch(it._id, { valorFixo: e.target.value })} /></FormField>
                    ) : (
                      <FormField label="Desconto (%)"><Input type="number" min="0" max="100" step="0.01" value={it.descontoPercent} onChange={(e) => patch(it._id, { descontoPercent: e.target.value })} /></FormField>
                    )}
                    <FormField label="Valor final">
                      <div className="input-base bg-surface-alt font-semibold text-success-700 flex items-center">{formatarMoeda(valorFinal)}</div>
                    </FormField>
                  </FormGrid>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {podeReajustar && item && (
        <ModalReajuste aberto={reajustando} tabelaId={item.id} itemIds={idsReajuste} onFechar={() => setReajustando(false)} onAplicado={() => { setSelReajuste(new Set()); aposReajuste(); }} />
      )}
    </Drawer>
  );
}

/**
 * Escolher serviços e produtos para a tabela: busca + tipo, uma caixa por linha e "Selecionar todos" do filtro
 * atual; "Adicionar selecionados" põe todos de uma vez (lib/tabela-preco-selecao).
 */
function SeletorCatalogo({ catalogo, erroCatalogo = false, jaAdicionados, onAdicionar }: { catalogo: CatalogoItem[]; erroCatalogo?: boolean; jaAdicionados: string[]; onAdicionar: (cs: CatalogoItem[]) => void }) {
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<FiltroTipo>("TODOS");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const jaNaTabela = useMemo(() => new Set(jaAdicionados), [jaAdicionados]);
  const visiveis = useMemo(() => filtrarCatalogo(catalogo, { q, tipo, jaNaTabela }), [catalogo, q, tipo, jaNaTabela]);
  const todos = estadoDeTodos(sel, visiveis);
  const marcados = escolhidos(catalogo, sel, jaNaTabela);
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  function adicionar() {
    if (!marcados.length) return;
    onAdicionar(marcados);
    setSel(new Set());
  }
  return (
    <div className="border border-surface-border rounded-lg" data-seletor-catalogo>
      <div className="flex flex-col sm:flex-row gap-2 p-2 border-b border-surface-border bg-surface-alt/40">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por nome ou código" aria-label="Filtrar serviços e produtos"
            className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
          />
        </div>
        <Select value={tipo} onChange={(e) => setTipo(e.target.value as FiltroTipo)} aria-label="Tipo" className="sm:w-40" data-filtro-tipo>
          <option value="TODOS">Serviços e produtos</option>
          <option value="SERVICO">Só serviços</option>
          <option value="PRODUTO">Só produtos</option>
        </Select>
      </div>
      <label className="flex items-center gap-2 px-3 min-h-[44px] border-b border-surface-border text-sm font-medium text-ink cursor-pointer">
        <input
          type="checkbox" className="w-4 h-4" data-selecionar-todos disabled={!visiveis.length}
          checked={todos === "todos"} ref={(el) => { if (el) el.indeterminate = todos === "alguns"; }}
          onChange={() => setSel((s) => alternarTodos(s, visiveis))}
        />
        Selecionar todos{q || tipo !== "TODOS" ? " do filtro" : ""} ({visiveis.length})
      </label>
      <ul className="max-h-64 overflow-y-auto divide-y divide-surface-border" data-lista-catalogo>
        {!visiveis.length && (erroCatalogo
          ? <li className="px-3 py-4 text-sm text-atrasado-texto text-center" role="alert" data-erro-catalogo>Não foi possível carregar o catálogo. Feche e abra a tabela de novo.</li>
          : <li className="px-3 py-4 text-sm text-ink-subtle text-center italic">Nada para adicionar com este filtro.</li>)}
        {visiveis.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 px-3 min-h-[44px] cursor-pointer hover:bg-primary-50" data-opcao-catalogo={c.id}>
              <input type="checkbox" className="w-4 h-4" checked={sel.has(c.id)} onChange={() => alternar(c.id)} />
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", c.kind === "SERVICO" ? "bg-primary-50 text-primary-700" : "bg-acento-claro text-acento-hover")}>{c.kind === "SERVICO" ? "Serviço" : "Produto"}</span>
              <span className="text-sm text-ink truncate flex-1">{c.nome}</span>
              <span className="text-xs font-mono text-ink-muted shrink-0">{formatarMoeda(c.valorPadrao)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-surface-border">
        <span className="text-xs text-ink-muted" data-contagem-selecionados>{marcados.length ? `${marcados.length} selecionado${marcados.length > 1 ? "s" : ""}` : "Nenhum selecionado"}</span>
        <Button type="button" size="sm" disabled={!marcados.length} onClick={adicionar} data-adicionar-selecionados>
          <Plus className="w-4 h-4" /> Adicionar selecionados
        </Button>
      </div>
    </div>
  );
}
