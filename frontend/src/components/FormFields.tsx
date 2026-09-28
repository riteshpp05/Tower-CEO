import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3.5">
      <label className="block text-xs text-ink-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full bg-cream-50 border border-terra-100 rounded-lg px-3 py-2 text-sm text-ink-900 outline-none focus:border-terra-600";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputClass} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} resize-none`} rows={3} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputClass} />;
}

export function SubmitButton({
  loading,
  children,
}: {
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full bg-terra-600 hover:bg-terra-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2.5 mt-2 transition"
    >
      {loading ? "Saving…" : children}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2 text-xs text-red-300 mb-3.5">
      {message}
    </div>
  );
}
