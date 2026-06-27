import type { ReactNode } from "react";

export default function PagesLayout({ children }: { children: ReactNode }) {
  return (
    <>
    
      {/* Page content */}
      <div
        className="relative flex flex-col h-screen overflow-hidden"
        style={{ zIndex: 1 }}
      >
        {children}
      </div>
    </>
  );
}
