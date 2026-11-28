/**
 * O que, RECUSADO, não trava o resto da atividade — a mesma regra no aparelho (a fila) e no servidor (o lote): a
 * leitura de QR (C13: equipamento de outro cliente) e a MENSAGEM do chat (ex.: a OS não é mais do técnico). Recusadas,
 * elas não podem segurar o checklist, as fotos e a conclusão do serviço, nem as outras mensagens.
 */
export const NAO_TRAVAM: ReadonlySet<string> = new Set(["scan", "comentario"]);
