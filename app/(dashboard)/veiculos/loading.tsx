import { SkeletonHeader, SkeletonCards, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <SkeletonCards quantidade={4} />
      <SkeletonTable linhas={6} colunas={5} />
    </div>
  );
}
