import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
}

export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  emptyMessage,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-cream-100 border border-dashed border-terra-100 rounded-lg px-5 py-10 text-center text-ink-400 text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-cream-100 border border-cream-200 rounded-lg">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-cream-200">
            {columns.map((c) => (
              <th
                key={c.header}
                className="px-3.5 py-2.5 text-left text-ink-400 font-mono font-normal text-[11px] uppercase tracking-wide"
                style={{ width: c.width }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-cream-200/60 ${
                onRowClick ? "cursor-pointer hover:bg-cream-200/40" : ""
              }`}
            >
              {columns.map((c) => (
                <td key={c.header} className="px-3.5 py-2.5 text-ink-700">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
