import React from "react";
import { Sun, Moon } from "lucide-react";

interface ThemeToggleProps {
  theme: "light" | "dark";
  onToggle: () => void;
  variant?: "default" | "header";
  className?: string;
}

export default function ThemeToggle({ theme, onToggle, variant = "default", className = "" }: ThemeToggleProps) {
  let buttonStyle = "";
  
  if (variant === "header") {
    buttonStyle = "bg-slate-850 hover:bg-slate-800 active:bg-slate-750 text-slate-300 hover:text-white border border-slate-700/30 shadow-sm";
  } else {
    buttonStyle = theme === "light"
      ? "bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-sm"
      : "bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-800 shadow-sm";
  }

  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-center p-2 rounded-lg transition-all duration-200 cursor-pointer ${buttonStyle} ${className}`}
      title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
    >
      {theme === "light" ? (
        <Moon className="w-4 h-4 text-amber-500 transition-transform hover:scale-110" />
      ) : (
        <Sun className="w-4 h-4 text-amber-400 animate-spin-slow transition-transform hover:scale-110" />
      )}
    </button>
  );
}
