export default function PlaceholderPage({ title, sprint }: { title: string; sprint: string }) {
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-medium m-0">{title}</h2>
        <p className="text-xs text-ink-400 mt-1">Coming in {sprint}</p>
      </div>
      <div className="bg-cream-100 border border-dashed border-terra-100 rounded-lg px-5 py-10 text-center text-ink-400 text-sm">
        This module is scaffolded but not yet built. Routing and sidebar access are already wired.
      </div>
    </div>
  );
}
