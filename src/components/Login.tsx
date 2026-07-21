import React, { useState } from "react";
import { motion } from "motion/react";
import { Compass, AlertCircle, User, Lock, Eye, EyeOff, Loader2 } from "lucide-react";

interface LoginProps {
  theme: "light" | "dark";
  onLoginSuccess: () => void;
}

export default function Login({ theme, onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please enter both username and password.");
      return;
    }

    setLoading(true);
    setError(null);

    // Simulate login verification
    setTimeout(() => {
      // Read credentials from environmental variables configured via .env or settings
      const meta = import.meta as any;
      const expectedUsername = meta.env?.VITE_GIS_PORTAL_USERNAME;
      const expectedPassword = meta.env?.VITE_GIS_PORTAL_PASSWORD;

      if (!expectedUsername || !expectedPassword) {
        setError("Portal credentials (VITE_GIS_PORTAL_USERNAME / VITE_GIS_PORTAL_PASSWORD) are not configured in the environment variables.");
        setLoading(false);
        return;
      }

      if (username === expectedUsername && password === expectedPassword) {
        localStorage.setItem("gis_portal_token", "almorageoportal-authenticated-token");
        onLoginSuccess();
      } else {
        setError("Invalid username or password.");
      }
      setLoading(false);
    }, 800);
  };

  return (
    <div className="absolute inset-0 z-[1000] bg-slate-950/25 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={`w-full max-w-md border rounded-2xl p-8 shadow-2xl relative overflow-hidden backdrop-blur-md transition-all duration-300 ${
          theme === "dark"
            ? "bg-slate-900/75 border-slate-700/40 text-white"
            : "bg-white/75 border-slate-200/80 text-slate-900"
        }`}
      >
        {/* Decorative background blur circle */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col items-center mb-6 text-center select-none">
          <div className="bg-indigo-500/10 border border-indigo-500/25 p-3 rounded-full mb-3 text-indigo-400">
            <Compass className="w-8 h-8 animate-pulse" />
          </div>
          <h3 className={`text-xl font-bold tracking-tight ${theme === "dark" ? "text-white" : "text-slate-800"}`}>Almora GIS Portal</h3>
          <p className={`text-xs mt-1 max-w-xs ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
            Authorized Access Only. Please sign in to explore interactive district maps & planners.
          </p>
        </div>

        <form onSubmit={handleLoginSubmit} className="space-y-4">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-500 p-3 rounded-lg flex items-start gap-2.5 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="login-username" className={`text-[11px] font-bold uppercase tracking-wider block ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
              Username
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="login-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className={`w-full border focus:ring-1 text-sm pl-10 pr-4 py-2 rounded-lg transition outline-none ${
                  theme === "dark"
                    ? "bg-slate-950/50 border-slate-700/60 focus:border-indigo-500/80 focus:ring-indigo-500/80 text-white placeholder-slate-500"
                    : "bg-white/50 border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 text-slate-900 placeholder-slate-400"
                }`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="login-password" className={`text-[11px] font-bold uppercase tracking-wider block ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className={`w-full border focus:ring-1 text-sm pl-10 pr-10 py-2 rounded-lg transition outline-none ${
                  theme === "dark"
                    ? "bg-slate-950/50 border-slate-700/60 focus:border-indigo-500/80 focus:ring-indigo-500/80 text-white placeholder-slate-500"
                    : "bg-white/50 border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 text-slate-900 placeholder-slate-400"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-400 transition cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-indigo-800/40 text-white font-extrabold py-2.5 px-4 rounded-lg text-sm shadow-lg shadow-indigo-500/15 transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed mt-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying Credentials...</span>
              </>
            ) : (
              <span>Explore Geo Portal</span>
            )}
          </button>
        </form>

        {/* Almora Geoportal Footer */}
        <div className={`mt-6 pt-4 border-t text-center ${
          theme === "dark" ? "border-slate-800/60" : "border-slate-200/80"
        }`}>
          <span className={`text-[9px] font-bold tracking-[0.2em] uppercase ${
            theme === "dark" ? "text-slate-500" : "text-slate-400"
          }`}>
            ALMORA • GEOPORTAL
          </span>
        </div>
      </motion.div>
    </div>
  );
}
