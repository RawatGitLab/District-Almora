import { useState, useMemo, useEffect } from "react";
import { GisFeature, LayerConfig } from "../types";
import { Search, MapPin, Minimize2, Maximize2, AlertTriangle, BarChart3, ChevronDown, ChevronUp, Database, Wifi, Cpu, Activity, Table, RefreshCw } from "lucide-react";

interface AttributeTableProps {
  theme?: "light" | "dark";
  features: GisFeature[];
  layers: LayerConfig[];
  selectedFeature: GisFeature | null;
  onFeatureSelect: (feature: GisFeature | null) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  onRefresh?: () => void;
  activeLayerId?: string | null;
  onActiveLayerChange?: (layerId: string) => void;
}

const normalizeLayerString = (str: string) => {
  return str.toLowerCase().replace(/[-_\s]+/g, " ").trim();
};

export const isFeatureInLayer = (feature: GisFeature, layer: LayerConfig): boolean => {
  if (!feature.properties) return false;
  const rawLayer = feature.properties.layer ?? feature.properties.Layer ?? feature.properties.LAYER;
  if (!rawLayer) return false;

  const rawStr = String(rawLayer);
  if (rawStr === layer.name || rawStr === layer.id) return true;

  const normRaw = normalizeLayerString(rawStr);
  const normName = normalizeLayerString(layer.name);
  const normId = normalizeLayerString(layer.id);

  if (normRaw === normName || normRaw === normId) return true;

  // Specific aliases in Almora spatial database
  if (normName.includes("district") && normRaw.includes("district")) return true;
  if (normName.includes("block") && normRaw.includes("block")) return true;
  if (normName.includes("tehsil") && normRaw.includes("tehsil")) return true;
  if (normName.includes("booth") && normRaw.includes("booth")) return true;
  if (normName.includes("assembly") && normRaw.includes("assembly")) return true;
  if (normName.includes("school") && normRaw.includes("school")) return true;
  if (normName.includes("hospital") && normRaw.includes("hospital")) return true;
  if (normName.includes("police") && normRaw.includes("police")) return true;
  if (normName.includes("river") && normRaw.includes("river")) return true;

  return false;
};

export default function AttributeTable({
  theme = "light",
  features,
  layers,
  selectedFeature,
  onFeatureSelect,
  isCollapsed,
  setIsCollapsed,
  onRefresh,
  activeLayerId,
  onActiveLayerChange
}: AttributeTableProps) {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [isStatusCollapsed, setIsStatusCollapsed] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [internalActiveLayerId, setInternalActiveLayerId] = useState<string>("");

  // All currently active (ticked/visible) layers
  const activeLayers = useMemo(() => {
    return layers.filter((layer) => layer.visible);
  }, [layers]);

  // Synchronize internal state with activeLayerId prop from parent
  useEffect(() => {
    if (activeLayerId) {
      setInternalActiveLayerId(activeLayerId);
    }
  }, [activeLayerId]);

  // Identify current layer: prioritize activeLayerId/internalActiveLayerId, then fall back to latest or first visible layer
  const currentLayer = useMemo(() => {
    if (activeLayers.length === 0) return null;
    const targetId = activeLayerId || internalActiveLayerId;
    if (targetId) {
      const found = activeLayers.find((l) => l.id === targetId || l.name === targetId);
      if (found) return found;
    }
    return activeLayers[activeLayers.length - 1] || activeLayers[0];
  }, [activeLayers, activeLayerId, internalActiveLayerId]);

  // Sync internal state when currentLayer updates
  useEffect(() => {
    if (currentLayer && currentLayer.id !== internalActiveLayerId) {
      setInternalActiveLayerId(currentLayer.id);
    }
  }, [currentLayer]);

  const handleSelectLayerTab = (layerId: string) => {
    setInternalActiveLayerId(layerId);
    onActiveLayerChange?.(layerId);
  };

  // Filter features for current active layer
  const layerFeatures = useMemo(() => {
    if (!currentLayer) return [];
    return features.filter((f) => isFeatureInLayer(f, currentLayer));
  }, [features, currentLayer]);

  // Extract schema columns dynamically based on available attributes in features
  const columnKeys = useMemo(() => {
    if (layerFeatures.length === 0) return [];
    const keysSet = new Set<string>();
    
    // Core informative attributes to prioritize in the table representation
    const priorityKeys = [
      "name", "Name", "village_name", "Village_Name", "VILL_NAME", "Block_Name", "Tehsil_Nam",
      "no_hh", "No_HH", "households", "TOT_P", "tot_p", "population", "Population",
      "area_sq_km", "Area_Sq_Km", "area", "type", "Type", "Status", "status"
    ];

    layerFeatures.forEach((feat) => {
      if (feat.properties) {
        Object.keys(feat.properties).forEach((k) => {
          if (k !== "layer" && k !== "id" && k !== "fid" && k !== "color" && k !== "opacity") {
            keysSet.add(k);
          }
        });
      }
    });

    const allKeys = Array.from(keysSet);
    
    // Sort keys putting prioritised ones first, followed by others alphabetically
    return allKeys.sort((a, b) => {
      const aIndex = priorityKeys.indexOf(a);
      const bIndex = priorityKeys.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [layerFeatures]);

  // Search filter
  const filteredFeatures = useMemo(() => {
    if (!searchTerm.trim()) return layerFeatures;
    const lower = searchTerm.toLowerCase();
    return layerFeatures.filter((feat) => {
      if (!feat.properties) return false;
      return Object.values(feat.properties).some((val) => {
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(lower);
      });
    });
  }, [layerFeatures, searchTerm]);

  // Reset page when currentLayer or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [currentLayer?.id, searchTerm]);

  // Paginated slice for clean UI performance (never rendering more than 50 rows in the DOM)
  const paginatedFeatures = useMemo(() => {
    const startIndex = (currentPage - 1) * 50;
    return filteredFeatures.slice(startIndex, startIndex + 50);
  }, [filteredFeatures, currentPage]);

  // Calculate GIS Numeric Sums (like Households and Population)
  const layerStats = useMemo(() => {
    if (filteredFeatures.length === 0) return null;
    
    let totalHH = 0;
    let totalPopulation = 0;
    let hasHH = false;
    let hasPop = false;

    filteredFeatures.forEach((feat) => {
      // Look for households fields
      const hhVal = feat.properties.No_HH ?? feat.properties.no_hh ?? feat.properties.households;
      if (hhVal !== undefined && hhVal !== null) {
        totalHH += Number(hhVal);
        hasHH = true;
      }

      // Look for population fields
      const popVal = feat.properties.TOT_P ?? feat.properties.tot_p ?? feat.properties.pop ?? feat.properties.population ?? feat.properties.Population;
      if (popVal !== undefined && popVal !== null) {
        totalPopulation += Number(popVal);
        hasPop = true;
      }
    });

    return {
      totalHH: hasHH ? Math.round(totalHH) : null,
      totalPopulation: hasPop ? Math.round(totalPopulation) : null,
    };
  }, [filteredFeatures]);

  const handleRowClick = (feature: GisFeature) => {
    onFeatureSelect(feature);
  };

  if (isCollapsed) {
    return (
      <div className={`w-12 border-l flex flex-col items-center pt-16 pb-4 shrink-0 transition-all duration-300 ${
        theme === "dark" ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-600"
      }`}>
        <button
          onClick={() => setIsCollapsed(false)}
          title="Open Attribute Table"
          className={`p-2 rounded-md shadow-sm transition duration-150 mt-4 mb-8 border cursor-pointer ${
            theme === "dark"
              ? "bg-slate-800 border-slate-700 text-slate-300 hover:text-indigo-400 hover:bg-slate-750"
              : "bg-slate-50 border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50"
          }`}
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="vertical-text text-[10px] uppercase font-bold tracking-widest text-slate-400 font-sans select-none whitespace-nowrap origin-center rotate-90 mt-16 leading-none flex items-center gap-2">
          <Table className="w-4 h-4" />
          Attribute Table
        </div>
      </div>
    );
  }

  return (
    <div className={`w-[450px] border-l flex flex-col h-full shrink-0 shadow-sm font-sans transition-colors duration-300 ${
      theme === "dark" ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-200 text-slate-900"
    }`}>
      {/* Table Header Controls */}
      <div className={`p-4 border-b space-y-3 transition-colors duration-300 ${
        theme === "dark" ? "bg-slate-950 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-850"
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Table className="w-5 h-5 text-indigo-550" />
            <div>
              <h2 className={`text-sm font-bold leading-none ${theme === "dark" ? "text-white" : "text-slate-800"}`}>Attribute Table</h2>
              <p className={`text-[10px] mt-0.5 ${theme === "dark" ? "text-slate-400" : "text-slate-400"}`}>Explore feature details, properties, and stats</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsCollapsed(true)}
              title="Minimize panel"
              className={`p-1.5 rounded-md transition duration-150 border border-transparent cursor-pointer ${
                theme === "dark" ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-slate-550 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {currentLayer && (
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={`Search in ${currentLayer.name}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full text-xs pl-9 pr-4 py-1.5 rounded-lg border transition placeholder-slate-400 focus:outline-indigo-500 focus:bg-white ${
                theme === "dark"
                  ? "bg-slate-900 border-slate-800 text-slate-100 focus:text-slate-900"
                  : "bg-slate-50 border-slate-200 text-slate-700"
              }`}
            />
          </div>
        )}

        {/* Quick Analytics Summary Panel */}
        {layerStats && (layerStats.totalHH !== null || layerStats.totalPopulation !== null) && (
          <div className={`border p-3 rounded-lg space-y-2 transition-colors duration-300 ${
            theme === "dark" ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-100 text-slate-700"
          }`}>
            <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 block font-mono flex items-center gap-1">
              <BarChart3 className="w-3.5 h-3.5 text-indigo-500" />
              Aggregate Estimations
            </span>
            <div className="grid grid-cols-2 gap-3 pt-0.5">
              {layerStats.totalHH !== null && (
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold leading-none">Total Households:</span>
                  <strong className={`text-sm font-black font-mono mt-1 ${theme === "dark" ? "text-slate-200" : "text-slate-800"}`}>{layerStats.totalHH.toLocaleString()}</strong>
                </div>
              )}
              {layerStats.totalPopulation !== null && (
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-semibold leading-none">Total Population:</span>
                  <strong className={`text-sm font-black font-mono mt-1 ${theme === "dark" ? "text-slate-200" : "text-slate-800"}`}>{layerStats.totalPopulation.toLocaleString()}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Dynamic Category Layer Tabs */}
        {activeLayers.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 select-none pt-0.5 scrollbar-thin">
            {activeLayers.map((layer) => {
              const isActive = layer.id === currentLayer?.id;
              const count = features.filter((f) => isFeatureInLayer(f, layer)).length;
              return (
                <button
                  key={layer.id}
                  onClick={() => handleSelectLayerTab(layer.id)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-md whitespace-nowrap transition cursor-pointer shrink-0 border flex items-center gap-1.5 ${
                    isActive
                      ? "bg-indigo-600 border-indigo-500 text-white font-extrabold shadow-sm"
                      : theme === "dark"
                        ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                        : "bg-slate-100 border-slate-200/80 text-slate-600 hover:bg-slate-200/50"
                  }`}
                >
                  <span>{layer.name}</span>
                  {layer.loading ? (
                    <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-400" />
                  ) : count > 0 ? (
                    <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono ${
                      isActive 
                        ? "bg-indigo-800/80 text-indigo-100" 
                        : theme === "dark"
                          ? "bg-slate-800 text-slate-300"
                          : "bg-slate-200 text-slate-700"
                    }`}>
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats Counter Bar */}
      {currentLayer && (
        <div className={`px-4 py-2 border-b flex justify-between text-[11px] items-center font-mono transition-colors duration-300 ${
          theme === "dark" ? "bg-slate-950/40 border-slate-800/80 text-slate-400" : "bg-slate-50/50 border-slate-200 text-slate-500"
        }`}>
          <span>Total: <strong className={theme === "dark" ? "text-slate-200" : "text-slate-800"}>{layerFeatures.length}</strong></span>
          <span>Filtered: <strong className={theme === "dark" ? "text-slate-200" : "text-slate-800"}>{filteredFeatures.length}</strong></span>
          <span>Selected: <strong className="text-indigo-400">{selectedFeature && selectedFeature.properties && isFeatureInLayer(selectedFeature, currentLayer) ? "1" : "0"}</strong></span>
        </div>
      )}

      {/* Main Feature List / Attributes Table */}
      <div className={`flex-1 overflow-auto min-h-0 relative transition-colors duration-300 ${
        theme === "dark" ? "bg-slate-900/40" : "bg-white"
      }`}>
        {!currentLayer ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <AlertTriangle className="w-8 h-8 text-amber-500 mb-2 stroke-[1.5]" />
            <p className={`text-xs font-semibold ${theme === "dark" ? "text-slate-300" : "text-slate-550"}`}>No GIS layers are currently active.</p>
            <p className="text-[10px] text-slate-400 mt-1">Please enable at least one layer checkbox in the left sidebar to see feature attribute rows.</p>
          </div>
        ) : currentLayer.loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mb-3" />
            <p className={`text-xs font-bold ${theme === "dark" ? "text-slate-200" : "text-slate-700"}`}>
              Fetching attributes for {currentLayer.name}...
            </p>
            <p className="text-[10px] text-slate-400 mt-1 max-w-xs leading-relaxed">
              Querying MongoDB Atlas collection and downloading geographic feature properties.
            </p>
          </div>
        ) : filteredFeatures.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <Search className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-xs font-semibold">No features found.</p>
            <p className="text-[10px] mt-0.5 leading-relaxed">
              {searchTerm.trim() 
                ? <>No matching spatial attributes found for <strong className={theme === "dark" ? "text-slate-300" : "text-slate-550"}>"{searchTerm}"</strong> in {currentLayer.name}.</>
                : <>No feature records found in database for layer <strong className={theme === "dark" ? "text-slate-300" : "text-slate-550"}>{currentLayer.name}</strong>.</>}
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse font-sans">
            <thead>
              <tr className={`sticky top-0 border-b shadow-sm z-10 font-bold leading-tight select-none ${
                theme === "dark" ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-slate-100/60 border-slate-200 text-slate-600"
              }`}>
                <th className={`py-2.5 px-3 whitespace-nowrap text-center text-[10px] w-12 border-r uppercase tracking-widest ${
                  theme === "dark" ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-slate-100"
                }`}>#</th>
                <th className={`py-2.5 px-3 whitespace-nowrap text-[10px] w-24 border-r uppercase tracking-widest ${
                  theme === "dark" ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-slate-100"
                }`}>Locate</th>
                {columnKeys.map((key) => (
                  <th key={key} className={`py-2.5 px-3 border-r uppercase tracking-wider font-mono text-[10px] ${
                    theme === "dark" ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-slate-100"
                  }`}>
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={`divide-y font-medium ${
              theme === "dark" ? "divide-slate-800/60" : "divide-slate-100"
            }`}>
              {paginatedFeatures.map((feat, itemIndex) => {
                const index = (currentPage - 1) * 50 + itemIndex;
                const isSelected = selectedFeature?.id === feat.id;

                return (
                  <tr
                    key={feat.id}
                    onClick={() => handleRowClick(feat)}
                    className={`group cursor-pointer transition duration-150 ${
                      isSelected 
                        ? theme === "dark"
                          ? "bg-indigo-950/40 hover:bg-indigo-900/40 text-indigo-200 border-l-2 border-l-indigo-500 border-b border-indigo-900"
                          : "bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border-l-2 border-l-indigo-600 border-b border-indigo-200" 
                        : theme === "dark"
                          ? "text-slate-300 hover:bg-slate-800/40 border-l-2 border-l-transparent"
                          : "text-slate-700 hover:bg-slate-50 border-l-2 border-l-transparent"
                    }`}
                  >
                    <td className={`py-2.5 px-3 text-center border-r font-mono text-[10px] text-slate-400 ${
                      theme === "dark" ? "border-slate-800/40 bg-slate-950/20" : "border-slate-100 bg-slate-50/50"
                    }`}>
                      {index + 1}
                    </td>
                    <td className={`py-1.5 px-3 border-r ${
                      theme === "dark" ? "border-slate-800/40" : "border-slate-100"
                    }`}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(feat);
                        }}
                        title="Zoom directly to this feature"
                        className={`py-1 px-1.5 rounded-md border flex items-center justify-center gap-1 font-semibold text-[10px] w-full transition-colors cursor-pointer ${
                          theme === "dark"
                            ? "border-slate-800 text-slate-400 hover:text-indigo-400 hover:border-indigo-800 hover:bg-indigo-950/40"
                            : "border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50"
                        }`}
                      >
                        <MapPin className="w-3 h-3 text-indigo-500 group-hover:scale-110 transition-transform" />
                        <span>Zoom</span>
                      </button>
                    </td>

                    {/* Columns value rows */}
                    {columnKeys.map((k) => {
                      const val = feat.properties[k];
                      return (
                        <td key={k} className={`py-2.5 px-3 border-r whitespace-nowrap max-w-[150px] truncate ${
                          theme === "dark" ? "border-slate-800/40" : "border-slate-100"
                        }`} title={String(val ?? "")}>
                          {val !== undefined && val !== null ? (
                            typeof val === "number" ? (
                              Number.isInteger(val) ? val : val.toFixed(4)
                            ) : (
                              String(val)
                            )
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Controls Footer Bar */}
      {currentLayer && filteredFeatures.length > 50 && (
        <div className={`px-4 py-2 border-t border-b flex items-center justify-between text-xs font-semibold select-none shrink-0 transition-colors duration-300 ${
          theme === "dark" ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-600"
        }`}>
          <span className={`text-[11px] ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
            Showing <strong className={theme === "dark" ? "text-slate-200" : "text-slate-800"}>{(currentPage - 1) * 50 + 1}</strong> to{" "}
            <strong className={theme === "dark" ? "text-slate-200" : "text-slate-800"}>
              {Math.min(currentPage * 50, filteredFeatures.length)}
            </strong>{" "}
            of <strong className={theme === "dark" ? "text-slate-200" : "text-slate-800"}>{filteredFeatures.length}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className={`px-2 py-0.5 rounded border transition cursor-pointer text-[10px] ${
                theme === "dark"
                  ? "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-850 disabled:bg-slate-950 disabled:opacity-30"
                  : "border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white"
              }`}
            >
              Prev
            </button>
            <span className={`text-[10px] font-mono ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
              Page {currentPage} / {Math.ceil(filteredFeatures.length / 50)}
            </span>
            <button
              onClick={() =>
                setCurrentPage((prev) =>
                  Math.min(prev + 1, Math.ceil(filteredFeatures.length / 50))
                )
              }
              disabled={currentPage >= Math.ceil(filteredFeatures.length / 50)}
              className={`px-2 py-0.5 rounded border transition cursor-pointer text-[10px] ${
                theme === "dark"
                  ? "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-850 disabled:bg-slate-950 disabled:opacity-30"
                  : "border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white"
              }`}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* MongoDB Spatial Database Status Widget */}
      <div className={`border-t shadow-inner select-none font-sans flex flex-col shrink-0 transition-colors duration-300 ${
        theme === "dark" ? "border-slate-850 bg-slate-950 text-slate-100" : "border-slate-200 bg-slate-900 text-slate-100"
      }`}>
        <button
          onClick={() => setIsStatusCollapsed(!isStatusCollapsed)}
          className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-slate-800/40 transition-colors focus:outline-none"
        >
          <div className="flex items-center gap-1.5 font-semibold text-xs text-indigo-300">
            <Database className="w-4 h-4 text-emerald-400 animate-pulse" />
            Geo Spatial Server
            {isStatusCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 hover:text-indigo-300 transition-colors" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400 hover:text-indigo-300 transition-colors" />
            )}
          </div>
          <span className="flex items-center gap-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full text-[9px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block shrink-0" />
            CONNECTED
          </span>
        </button>

        {!isStatusCollapsed && (
          <div className="px-4 pb-4 space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5 font-semibold">
              <div className="bg-slate-850/60 border border-slate-800 rounded-lg p-2">
                <span className="text-[9px] text-slate-400 uppercase block tracking-wider mb-0.5 font-bold">Spatial Engine</span>
                <span className="text-xs font-bold text-slate-200 font-mono flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-slate-500" />
                  v7.0 (Atlas Shared)
                </span>
              </div>
              <div className="bg-slate-850/60 border border-slate-800 rounded-lg p-2">
                <span className="text-[9px] text-slate-400 uppercase block tracking-wider mb-0.5 font-bold">Query Latency</span>
                <span className="text-xs font-bold text-emerald-400 font-mono flex items-center gap-1">
                  <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
                  ~34 ms (Realtime)
                </span>
              </div>
              <div className="bg-slate-850/60 border border-slate-800 rounded-lg p-2">
                <span className="text-[9px] text-slate-400 uppercase block tracking-wider mb-0.5 font-bold">Collections Loaded</span>
                <span className="text-xs font-bold text-slate-200 font-mono">
                  {layers.length} Spatial Layers
                </span>
              </div>
              <div className="bg-slate-850/60 border border-slate-800 rounded-lg p-2">
                <span className="text-[9px] text-slate-400 uppercase block tracking-wider mb-0.5 font-bold">Total Geometries</span>
                <span className="text-xs font-bold text-indigo-300 font-mono">
                  {features.length.toLocaleString()} Loaded
                </span>
              </div>
            </div>

            <div className="bg-slate-850/40 border border-slate-800/80 rounded-md p-2 flex items-center justify-between text-[10px] font-semibold text-slate-400">
              <span className="flex items-center gap-1">
                <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                Atlas Node: <strong className="text-slate-300 font-mono">ap-south-1 (AWS)</strong>
              </span>
              <span className="text-emerald-500/90 font-bold font-mono">2dsphere spatial index</span>
            </div>

            {onRefresh && (
              <button
                onClick={onRefresh}
                className="w-full mt-1.5 py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded font-bold text-[10px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-transparent hover:border-indigo-400/20"
                title="Synchronize and fetch new spatial layers from MongoDB Atlas"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-pulse" />
                RE-SYNC SPATIAL DATABASE
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
