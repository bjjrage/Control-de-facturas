"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-6 py-2 bg-gray-800 text-white rounded text-[13px] hover:bg-gray-700 cursor-pointer"
    >
      Imprimir
    </button>
  );
}
