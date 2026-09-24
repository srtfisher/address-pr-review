export function Kbd({ children }: { children: string }) {
  return (
    <kbd aria-hidden="true" className="ml-1 inline-block min-w-5 rounded border border-current/30 px-1 text-center font-mono text-[11px] leading-4 font-normal opacity-80">
      {children}
    </kbd>
  );
}
