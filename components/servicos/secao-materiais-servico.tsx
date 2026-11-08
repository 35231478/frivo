"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Package, Plus, Trash2 } from "lucide-react";
import type { GrupoFormProps } from "@/components/cadastros/cadastro-padrao";
import { SeletorCadastro, useCadastro } from "@/components/cadastros/seletor-cadastro";
import { PilulaComportamento } from "@/components/estoque/categoria-produto";
import { ComportamentoDoProduto, CustoDoMaterial, ResumoCustoMateriais, useCustosProdutos } from "@/components/estoque/composicao";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ItemCadastro } from "@/lib/cadastros/opcoes";
import { comportamentoDoProduto, LABEL_COMPORTAMENTO } from "@/lib/estoque/categoria";
import { expandirComposicao, qtd, type KitDaComposicao, type LinhaComposicao, type ProdutoDaComposicao } from "@/lib/estoque/composicao";
import { formatarQtd } from "@/lib/estoque/regras";

type ProdutoLista = ItemCadastro & ProdutoDaComposicao;
type KitLista = ItemCadastro & KitDaComposicao;
interface LinhaEdit { _id: string; tipo: "produto" | "kit"; id: string; quantidade: string; comportamento: "" | "VENDA_A_PARTE" | "INCLUSO_NO_SERVICO" }
const uid = () => Math.random().toString(36).slice(2);

/** Linhas gravadas (GET /api/cadastros/servicos/[id] › materiais) → edição */
const paraEdicao = (materiais: unknown): LinhaEdit[] =>
  (Array.isArray(materiais) ? materiais : []).map((m: { produtoId?: string | null; kitId?: string | null; quantidade: unknown; comportamento?: string | null }) => ({
    _id: uid(), tipo: m.kitId ? "kit" : "produto", id: m.kitId ?? m.produtoId ?? "", quantidade: String(qtd(m.quantidade)),
    comportamento: m.comportamento === "VENDA_A_PARTE" || m.comportamento === "INCLUSO_NO_SERVICO" ? m.comportamento : "",
  }));
/** Edição → o que vai no corpo (campo `materiais`, como JSON) */
const paraCorpo = (linhas: LinhaEdit[]) => linhas.map((l) => ({
  produtoId: l.tipo === "produto" ? l.id || null : null, kitId: l.tipo === "kit" ? l.id || null : null,
  quantidade: l.quantidade, comportamento: l.tipo === "produto" && l.comportamento ? l.comportamento : null,
}));

/**
 * Seção "Materiais padrão" do cadastro do serviço (E3.2): produtos soltos e/ou kits, com a quantidade padrão.
 * O comportamento de cada material vem da categoria do produto (E3.1); um produto solto aceita um override
 * pontual. O kit entra "vivo" (representado pelos itens atuais dele). Serviço sem linhas = funciona como hoje.
 * Embaixo, a ajuda de precificação: custo somado dos materiais inclusos (só informativo).
 *
 * O formulário genérico só envia o campo se a seção mexer: carregar a composição não conta como mudança.
 */
export function SecaoMateriaisServico({ campos, mudar, item }: GrupoFormProps) {
  const campo = campos[0];
  const [linhas, setLinhas] = useState<LinhaEdit[]>([]);
  const [carregando, setCarregando] = useState(!!item);
  const [erro, setErro] = useState("");
  const produtos = useCadastro<ProdutoLista>("produtos");
  const kits = useCadastro<KitLista>("kits-material");

  useEffect(() => {
    if (!item) return;
    let vivo = true;
    fetch(`/api/cadastros/servicos/${item.id}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => null); if (!vivo) return; if (r.ok && d) setLinhas(paraEdicao(d.materiais)); else setErro(d?.erro ?? "Não foi possível carregar os materiais padrão."); })
      .catch(() => { if (vivo) setErro("Erro de conexão ao carregar os materiais padrão."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [item]);

  const produtoDe = (id: string) => produtos.itens.find((p) => p.id === id) ?? null;
  const kitDe = (id: string) => kits.itens.find((k) => k.id === id) ?? null;
  const atualizar = (novas: LinhaEdit[]) => { setLinhas(novas); mudar(campo.key, JSON.stringify(paraCorpo(novas))); };
  const patch = (id: string, p: Partial<LinhaEdit>) => atualizar(linhas.map((l) => (l._id === id ? { ...l, ...p } : l)));
  const adicionar = (tipo: LinhaEdit["tipo"]) => atualizar([...linhas, { _id: uid(), tipo, id: "", quantidade: "1", comportamento: "" }]);

  // Materiais efetivos (kit aberto nos itens dele) → custo de referência
  const efetivos = useMemo(() => {
    const comp: LinhaComposicao[] = linhas.map((l) => (l.tipo === "produto"
      ? { produtoId: l.id, quantidade: l.quantidade, comportamento: l.comportamento || null, produto: produtoDe(l.id) }
      : { kitId: l.id, quantidade: l.quantidade, kit: kitDe(l.id) }));
    return expandirComposicao(comp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, produtos.itens, kits.itens]);
  const ids = useMemo(() => efetivos.map((m) => m.produtoId), [efetivos]);
  const { custos, carregando: custosCarregando } = useCustosProdutos(ids);
  const travado = carregando || !!erro;

  return (
    <div className="space-y-3" data-secao-materiais data-linhas={linhas.length}>
      {erro && <p role="alert" className="text-sm bg-atrasado-claro border border-atrasado/20 text-atrasado-texto rounded-lg px-3 py-2">{erro} A composição não será alterada ao salvar.</p>}
      {carregando && <p className="text-sm text-ink-subtle">Carregando materiais padrão…</p>}
      {!carregando && !erro && linhas.length === 0 && (
        <p className="text-sm text-ink-subtle italic" data-sem-materiais>Sem materiais padrão: o serviço funciona como sempre. Adicione produtos ou um kit para pré-preencher orçamento/OS.</p>
      )}

      <div className="space-y-2">
        {linhas.map((l) => (l.tipo === "produto" ? (
          <LinhaProduto key={l._id} linha={l} produtos={produtos.itens} produto={produtoDe(l.id)} custos={custos} disabled={travado}
            onChange={(p) => patch(l._id, p)} onRemover={() => atualizar(linhas.filter((x) => x._id !== l._id))} />
        ) : (
          <LinhaKit key={l._id} linha={l} kits={kits.itens} kit={kitDe(l.id)} custos={custos} disabled={travado}
            onChange={(p) => patch(l._id, p)} onRemover={() => atualizar(linhas.filter((x) => x._id !== l._id))} />
        )))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={travado} onClick={() => adicionar("produto")} data-acao="add-material"><Plus className="w-4 h-4" /> Material</Button>
        <Button type="button" variant="outline" size="sm" disabled={travado} onClick={() => adicionar("kit")} data-acao="add-kit"><Plus className="w-4 h-4" /> Kit</Button>
        <Dica rotulo={campo.label} texto={campo.ajuda ?? ""} />
      </div>

      <ResumoCustoMateriais materiais={efetivos} custos={custos} carregando={custosCarregando} />
    </div>
  );
}

function Cartao({ icone, children, onRemover, rotulo, disabled, tipo }: { icone: React.ReactNode; children: React.ReactNode; onRemover: () => void; rotulo: string; disabled?: boolean; tipo: string }) {
  return (
    <div className="border border-surface-border rounded-lg p-3 bg-white" data-linha-material={tipo}>
      <div className="flex items-start gap-2">
        <span className="mt-8 text-ink-subtle shrink-0 hidden sm:block">{icone}</span>
        <div className="flex-1 min-w-0">{children}</div>
        <button type="button" disabled={disabled} onClick={onRemover} className="mt-8 p-1.5 text-ink-muted hover:text-atrasado disabled:opacity-50 shrink-0" aria-label={`Tirar ${rotulo} dos materiais padrão`}><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

function LinhaProduto({ linha, produtos, produto, custos, disabled, onChange, onRemover }: {
  linha: LinhaEdit; produtos: ProdutoLista[]; produto: ProdutoLista | null; custos: ReadonlyMap<string, number>; disabled: boolean;
  onChange: (p: Partial<LinhaEdit>) => void; onRemover: () => void;
}) {
  const daCategoria = LABEL_COMPORTAMENTO[comportamentoDoProduto(produto)];
  return (
    <Cartao icone={<Package className="w-4 h-4" />} onRemover={onRemover} rotulo={produto?.nome ?? "material"} disabled={disabled} tipo="produto">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px_190px] gap-2 items-end">
        <FormField label="Produto" required>
          <SeletorCadastro entidade="produtos" itens={produtos} valor={linha.id} onChange={(v) => onChange({ id: v })} nome="produtoId" disabled={disabled} />
        </FormField>
        <FormField label={`Quantidade${produto?.unidade ? ` (${produto.unidade})` : ""}`} required>
          <Input type="text" inputMode="decimal" value={linha.quantidade} onChange={(e) => onChange({ quantidade: e.target.value })} disabled={disabled} data-quantidade-material />
        </FormField>
        <FormField label="Faturamento" dica="Vem da categoria do produto. Mude aqui só como exceção pontual deste serviço (ex.: uma peça que neste serviço vai inclusa).">
          <Select value={linha.comportamento} onChange={(e) => onChange({ comportamento: e.target.value as LinhaEdit["comportamento"] })} disabled={disabled} name="comportamento">
            <option value="">Pela categoria ({daCategoria})</option>
            <option value="VENDA_A_PARTE">{LABEL_COMPORTAMENTO.VENDA_A_PARTE} (exceção)</option>
            <option value="INCLUSO_NO_SERVICO">{LABEL_COMPORTAMENTO.INCLUSO_NO_SERVICO} (exceção)</option>
          </Select>
        </FormField>
      </div>
      {produto && (
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
          <ComportamentoDoProduto produto={produto} override={linha.comportamento || null} />
          {produto.ativo === false && <span className="text-[10px] font-semibold bg-atencao-claro text-atencao-texto px-1.5 py-0.5 rounded">produto inativo</span>}
          <CustoDoMaterial produtoId={produto.id} quantidade={qtd(linha.quantidade)} custos={custos} />
        </div>
      )}
    </Cartao>
  );
}

function LinhaKit({ linha, kits, kit, custos, disabled, onChange, onRemover }: {
  linha: LinhaEdit; kits: KitLista[]; kit: KitLista | null; custos: ReadonlyMap<string, number>; disabled: boolean;
  onChange: (p: Partial<LinhaEdit>) => void; onRemover: () => void;
}) {
  const vezes = qtd(linha.quantidade);
  return (
    <Cartao icone={<Boxes className="w-4 h-4" />} onRemover={onRemover} rotulo={kit?.nome ?? "kit"} disabled={disabled} tipo="kit">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-2 items-end">
        <FormField label="Kit" required dica="O kit entra representado pelos itens atuais dele (kit vivo): mudou o kit, o serviço reflete. No orçamento/OS vira uma cópia editável.">
          <SeletorCadastro entidade="kits-material" itens={kits} valor={linha.id} onChange={(v) => onChange({ id: v })} nome="kitId" disabled={disabled} semCriar />
        </FormField>
        <FormField label="Quantidade (kits)" required>
          <Input type="text" inputMode="decimal" value={linha.quantidade} onChange={(e) => onChange({ quantidade: e.target.value })} disabled={disabled} data-quantidade-material />
        </FormField>
      </div>
      {kit && (
        <ul className="mt-2 space-y-1 text-xs" data-itens-do-kit>
          {kit.ativo === false && <li className="text-[10px] font-semibold bg-atencao-claro text-atencao-texto px-1.5 py-0.5 rounded inline-block">kit inativo</li>}
          {(kit.itens ?? []).length === 0 && <li className="text-ink-subtle italic">Kit sem itens.</li>}
          {(kit.itens ?? []).map((it) => (
            <li key={it.produtoId} className="flex flex-wrap items-center gap-2 text-ink-muted" data-kit-item={it.produtoId}>
              <span className="text-ink">{it.produto?.nome ?? "(produto removido)"}</span>{" "}
              <span className="tabular-nums">{formatarQtd(qtd(it.quantidade) * vezes)} {it.produto?.unidade || "un"}</span>{" "}
              <PilulaComportamento comportamento={comportamentoDoProduto(it.produto)} />{" "}
              <CustoDoMaterial produtoId={it.produtoId} quantidade={qtd(it.quantidade) * vezes} custos={custos} />
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}
