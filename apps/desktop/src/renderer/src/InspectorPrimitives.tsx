export function InspectorSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="inspector-section">
      <header>
        <span>{title}</span>
        {action}
      </header>
      {children}
    </section>
  );
}

export function DataSection({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="data-section">
      <header>
        <span>{title}</span>
        {count !== undefined && <em>{count}</em>}
        {action}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function ArtifactOptions() {
  return (
    <>
      <option value="text">Text</option>
      <option value="json">JSON</option>
      <option value="filesystem-reference">File ref</option>
    </>
  );
}

export function EmptyLine({ text }: { text: string }) {
  return <div className="empty-line">{text}</div>;
}
