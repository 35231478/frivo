import { ClipboardCheck, ClipboardX, FileWarning, FileX, Wrench } from "lucide-react";
import { cn, formatarData } from "@/lib/utils";

/** Selo de status do veículo (mesmo visual do StatusSelo de equipamentos, + "Em manutenção"). */
export function VeiculoStatusSelo({ status, className }: { status: string; className?: string }) {
  const cfg = status === "INATIVO"
    ? { txt: "Inativo", cls: "text-ink-muted bg-surface-linha", dot: "bg-ink-subtle" }
    : status === "MANUTENCAO"
      ? { txt: "Em manutenção", cls: "text-atencao-texto bg-atencao-claro", dot: "bg-atencao" }
      : { txt: "Ativo", cls: "text-ok-texto bg-ok-claro", dot: "bg-ok" };
  return (
    <span data-status-veiculo={status} className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", cfg.cls, className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />{cfg.txt}
    </span>
  );
}

const base = "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap";

export function DocumentoSelo({ doc }: { doc: { situacao: "vencido" | "vencendo"; nome: string; data: string } }) {
  const vencido = doc.situacao === "vencido";
  const Icone = vencido ? FileX : FileWarning;
  return (
    <span data-aviso="documento" title={`${doc.nome}: ${vencido ? "venceu" : "vence"} em ${formatarData(doc.data)}`}
      className={cn(base, vencido ? "text-atrasado-texto bg-atrasado-claro" : "text-atencao-texto bg-atencao-claro")}>
      <Icone className="w-3 h-3" /> {doc.nome.length > 14 ? "Documento" : doc.nome} {vencido ? "vencido" : formatarData(doc.data)}
    </span>
  );
}

export function RevisaoSelo({ rev }: { rev: { situacao: "vencida" | "proxima"; data: string | null; km: number | null } }) {
  const vencida = rev.situacao === "vencida";
  const quando = rev.km != null ? `${rev.km.toLocaleString("pt-BR")} km` : rev.data ? formatarData(rev.data) : "";
  return (
    <span data-aviso="revisao" title={vencida ? `Revisão vencida (${quando})` : `Revisão em ${quando}`}
      className={cn(base, vencida ? "text-atrasado-texto bg-atrasado-claro" : "text-atencao-texto bg-atencao-claro")}>
      <Wrench className="w-3 h-3" /> {vencida ? "Revisão vencida" : `Revisão ${quando}`}
    </span>
  );
}

/** Checklist de hoje: só aparece quando a empresa usa checklist (há modelo ativo). */
export function ChecklistSelo({ status }: { status: string }) {
  if (status === "nao") {
    return <span data-aviso="checklist" className={cn(base, "text-ink-muted bg-surface-linha")}><ClipboardX className="w-3 h-3" /> Sem checklist hoje</span>;
  }
  if (status === "COM_ALERTAS") {
    return <span data-aviso="checklist" className={cn(base, "text-atencao-texto bg-atencao-claro")}><ClipboardCheck className="w-3 h-3" /> Checklist com alerta</span>;
  }
  return null;
}
