import { SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <SkeletonTable linhas={10} colunas={5} />
    </div>
  );
}
