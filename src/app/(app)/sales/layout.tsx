import { SalesTabs } from "@/components/sales/util";

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl">
      <SalesTabs />
      {children}
    </div>
  );
}
