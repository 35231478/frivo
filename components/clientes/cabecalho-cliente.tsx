"use client";

import Link from "next/link";
import { Calculator, ChevronDown, ChevronLeft, ClipboardPlus, FileSignature, Pencil, Plus, Send } from "lucide-react";
import { MenuAcoes, ItemMenu } from "@/components/ui/menu-acoes";
import { StatusPill } from "@/components/ui/status-pill";
import { formatarCpfCnpj } from "@/lib/utils";
import type { ItemNovo, SinalCliente } from "@/lib/clientes/cabecalho";

const ICONE_NOVO: Record<ItemNovo["id"], React.ComponentType<{ className?: string }>> = {
  os: ClipboardPlus, orcamento: Calculator, contrato: FileSignature, documentacao: Send,
};

/**
 * Leva H — o cabeçalho da ficha do cliente: voltar, nome, a linha de identificação e só os sinais que importam
 * (lib/clientes/cabecalho). À direita, as ações: na consulta, o botão único "Novo ▾" + Editar + Inativar/Reativar;
 * na edição, Cancelar / Salvar (o formulário passa em `acoes`). Fica preso no topo ao rolar (desktop).
 */
export function CabecalhoCliente({ titulo, subtitulo, voltarHref, voltarRotulo, sinais = [], itensNovo = [], editarHref, inativar, acoes }: {
  titulo: string;
  /** Razão social (se o nome mostrado é o fantasia), CPF/CNPJ e cidade — o que existir */
  subtitulo?: string[];
  voltarHref: string;
  voltarRotulo: string;
  sinais?: SinalCliente[];
  itensNovo?: ItemNovo[];
  editarHref?: string | null;
  inativar?: React.ReactNode;
  acoes?: React.ReactNode;
}) {
  const sub = (subtitulo ?? []).filter(Boolean);
  return (
    <header data-cabecalho-cliente className="md:sticky md:-top-6 z-30 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-5 pb-4 bg-surface-page border-b border-surface-border">
      <div className="max-w-[1600px] mx-auto flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
          <Link href={voltarHref} aria-label={voltarRotulo} title={voltarRotulo} data-voltar-cliente
            className="mt-0.5 p-2.5 -m-1 rounded-lg text-ink-muted hover:text-ink hover:bg-white shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-ink tracking-tight break-words" data-titulo-cliente>{titulo}</h1>
            {sub.length > 0 && <p className="text-sm text-ink-muted mt-0.5 break-words" data-subtitulo-cliente>{sub.join(" · ")}</p>}
            {sinais.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2" data-sinais-cliente>
                {sinais.map((s) => s.href ? (
                  <Link key={s.id} href={s.href} data-sinal={s.id} title={s.titulo} className="hover:brightness-95">
                    <StatusPill tom={s.tom} className="font-semibold">{s.rotulo}</StatusPill>
                  </Link>
                ) : (
                  <span key={s.id} title={s.titulo}><StatusPill tom={s.tom} data-sinal={s.id}>{s.rotulo}</StatusPill></span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:justify-end" data-acoes-cliente>
          {acoes}
          {itensNovo.length > 0 && (
            <MenuAcoes rotulo="Novo" largura="w-72" dadosGatilho={{ "data-menu-novo": "" }}
              classeGatilho="btn-primary min-h-[44px]"
              gatilho={<><Plus className="w-4 h-4" aria-hidden /> Novo <ChevronDown className="w-4 h-4" aria-hidden /></>}>
              {() => itensNovo.map((i) => (
                <ItemMenu key={i.id} id={`novo-${i.id}`} icone={ICONE_NOVO[i.id]} href={i.href} className="min-h-[44px]">{i.rotulo}</ItemMenu>
              ))}
            </MenuAcoes>
          )}
          {editarHref && (
            <Link href={editarHref} data-editar-cliente className="btn-secondary min-h-[44px]">
              <Pencil className="w-4 h-4" aria-hidden /> Editar
            </Link>
          )}
          {inativar}
        </div>
      </div>
    </header>
  );
}

/** Razão social (quando o título é o fantasia), CPF/CNPJ formatado e cidade/UF — só o que existe */
export function subtituloDoCliente(c: { nome: string; nomeFantasia?: string | null; cpfCnpj?: string | null; cidade?: string | null; estado?: string | null }): string[] {
  const fantasia = c.nomeFantasia?.trim();
  return [
    fantasia && fantasia !== c.nome ? c.nome : "",
    c.cpfCnpj ? formatarCpfCnpj(c.cpfCnpj) : "",
    [c.cidade?.trim(), c.estado?.trim()].filter(Boolean).join("/"),
  ].filter(Boolean);
}
