import type { ReactNode } from "react";

export default function FormDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative w-[420px] max-w-full h-full bg-cream-100 border-l border-terra-100 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-medium text-ink-900 m-0">{title}</h3>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 bg-transparent border-none text-lg leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
