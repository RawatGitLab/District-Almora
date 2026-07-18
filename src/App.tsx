import { useEffect, useState, useMemo } from "react";
import { GisFeature, LayerConfig, BaseMap } from "./types";
import Sidebar from "./components/Sidebar";
import MapComponent from "./components/MapComponent";
import AttributeTable from "./components/AttributeTable";
import { 
  Database, 
  Layers, 
  MapPin, 
  Compass, 
  Globe, 
  Eye, 
  VolumeX, 
  Loader2, 
  AlertCircle, 
  Sparkles, 
  Info,
  ServerCrash,
  RefreshCw
} from "lucide-react";

export default function App() {
  const [features, setFeatures] = useState<GisFeature[]>([]);
  const [layers, setLayers] = useState<LayerConfig[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Map & Interaction state
  const [activeBaseMap, setActiveBaseMap] = useState<string>("satellite");
  const [selectedFeature, setSelectedFeature] = useState<GisFeature | null>(null);
  const [hoveredFeature, setHoveredFeature] = useState<GisFeature | null>(null);
  const [isTableCollapsed, setIsTableCollapsed] = useState<boolean>(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(true);
  const [zoomToLayerName, setZoomToLayerName] = useState<string | null>(null);

  // Dynamic Measurement state (Distance & Area)
  const [measureMode, setMeasureMode] = useState<"none" | "distance" | "area">("none");
  const [measurePoints, setMeasurePoints] = useState<{ lat: number; lng: number }[]>([]);

  // Standard Basemaps (free of credentials)
  const baseMaps: BaseMap[] = useMemo(() => [
    {
      id: "osm",
      name: "OpenStreetMap",
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      thumbnail: "",
      desc: "Standard road map style"
    },
    {
      id: "light",
      name: "CartoDB Light",
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      thumbnail: "",
      desc: "Minimalist grayscale background"
    },
    {
      id: "dark",
      name: "CartoDB Dark",
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      thumbnail: "",
      desc: "High-contrast dark canvas"
    },
    {
      id: "satellite",
      name: "Esri Satellite",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      thumbnail: "",
      desc: "Global high-res satellite photos"
    },
    {
      id: "terrain",
      name: "Esri Terrain",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, USGS, NPS',
      thumbnail: "",
      desc: "Topographic outline contouring"
    },
    {
      id: "bhuvan",
      name: "ISRO Bhuvan",
      url: "/api/bhuvan-tiles/{z}/{x}/{y}",
      attribution: 'Tiles &copy; ISRO Bhuvan &mdash; NRSC, Government of India',
      thumbnail: "",
      desc: "Indian National Geospatial Platform"
    }
  ], []);

  // Fetch geographic features from backend Express server (connecting to MongoDB Atlas)
  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch all layer metadata
      const layersRes = await fetch("/api/layers");
      if (!layersRes.ok) {
        throw new Error(`Failed to load layers metadata from server: ${layersRes.status}`);
      }
      const layersData = await layersRes.json();
      if (!layersData.success) {
        throw new Error(layersData.error || "Unknown error loading layers metadata");
      }
      
      const loadedLayers: LayerConfig[] = layersData.layers || [];
      setLayers(loadedLayers);

      // 2. Load features for default visible layers (e.g. District-Boundary, Tehsil-Boundary, Block-Boundary)
      const defaultVisible = loadedLayers.filter(l => l.visible);
      const featuresList: GisFeature[] = [];

      // Fetch them in parallel for speed!
      await Promise.all(
        defaultVisible.map(async (layer) => {
          try {
            const featRes = await fetch(`/api/features?layer=${encodeURIComponent(layer.name)}`);
            if (featRes.ok) {
              const featData = await featRes.json();
              if (featData.success && Array.isArray(featData.features)) {
                featuresList.push(...featData.features);
              }
            }
          } catch (e) {
            console.error(`Error pre-loading default layer features for ${layer.name}:`, e);
          }
        })
      );

      setFeatures(featuresList);
      setLoading(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred while fetching GIS data from Atlas.");
      setLoading(false);
    }
  };

  // Sync / Reload all data manually
  const fetchFeatures = async (force = false) => {
    // If the user triggers database sync, reload the initial state
    fetchInitialData();
  };

  // Fetch a layer's features on demand
  const loadLayerFeatures = async (layerName: string) => {
    try {
      const featRes = await fetch(`/api/features?layer=${encodeURIComponent(layerName)}`);
      if (!featRes.ok) throw new Error(`Status ${featRes.status}`);
      const featData = await featRes.json();
      if (featData.success && Array.isArray(featData.features)) {
        return featData.features;
      }
      return [];
    } catch (err) {
      console.error(`Failed to load layer features for ${layerName}:`, err);
      return [];
    }
  };

  // Handle sidebar interactivity toggles with on-demand loading
  const toggleLayer = async (id: string) => {
    let targetLayer: LayerConfig | undefined;
    
    // Check if we need to load features
    setLayers((prev) => {
      targetLayer = prev.find((l) => l.id === id);
      return prev;
    });

    if (!targetLayer) return;

    const turningOn = !targetLayer.visible;

    if (turningOn && !targetLayer.loaded) {
      // Mark layer as loading in state
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, loading: true } : l))
      );

      // Fetch features from backend
      const newFeatures = await loadLayerFeatures(targetLayer.name);

      // Add new features and mark loaded
      setFeatures((prev) => {
        const filtered = prev.filter(f => f.properties.layer !== targetLayer!.name && f.properties.Layer !== targetLayer!.name);
        return [...filtered, ...newFeatures];
      });

      setLayers((prev) =>
        prev.map((l) =>
          l.id === id ? { ...l, loaded: true, loading: false, visible: true } : l
        )
      );
    } else {
      // If turning off and it had the selected feature, clear selection
      if (!turningOn && selectedFeature) {
        const featLayerName =
          selectedFeature.properties.layer ||
          selectedFeature.properties.Layer ||
          selectedFeature.properties.LAYER;

        if (featLayerName === targetLayer.name) {
          setSelectedFeature(null);
        }
      }

      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
      );
    }
  };

  const updateLayerOpacity = (id: string, opacity: number) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, opacity: opacity } : l))
    );
  };

  const updateLayerColor = (id: string, color: string) => {
    setLayers((prev) => {
      return prev.map((l) => {
        if (l.id === id) {
          return { 
            ...l, 
            color: color, 
            fillColor: color 
          };
        }
        return l;
      });
    });
  };

  const handleResetToExtent = () => {
    setSelectedFeature(null);
    setHoveredFeature(null);
    setMeasureMode("none");
    setMeasurePoints([]);
    setLayers((prev) => prev.map((l) => ({ ...l, visible: l.loaded ? true : false, opacity: l.type === "polygon" && l.name.toLowerCase().includes("tehsil") ? 0.85 : 0.9 })));
  };

  const toggleAllLayers = async (visible: boolean) => {
    if (visible) {
      const unloaded = layers.filter(l => !l.loaded);
      
      if (unloaded.length > 0) {
        // Set all unloaded layers to loading: true, and already loaded layers to visible: true
        setLayers((prev) =>
          prev.map((l) => (!l.loaded ? { ...l, loading: true, visible: true } : { ...l, visible: true }))
        );

        try {
          const newFeaturesList: GisFeature[] = [];

          await Promise.all(
            unloaded.map(async (layer) => {
              try {
                const feats = await loadLayerFeatures(layer.name);
                newFeaturesList.push(...feats);
                // Mark this specific layer as loaded and not loading anymore
                setLayers((prev) =>
                  prev.map((l) =>
                    l.id === layer.id ? { ...l, loaded: true, loading: false, visible: true } : l
                  )
                );
              } catch (err) {
                console.error(`Error loading layer ${layer.name}:`, err);
                // Reset this layer's loading state on error
                setLayers((prev) =>
                  prev.map((l) =>
                    l.id === layer.id ? { ...l, loading: false, visible: false } : l
                  )
                );
              }
            })
          );

          if (newFeaturesList.length > 0) {
            setFeatures((prev) => {
              // Deduplicate if any exist
              const existingLayerNames = new Set(newFeaturesList.map(f => (f.properties.layer || f.properties.Layer || "").toLowerCase()));
              const filtered = prev.filter(f => !existingLayerNames.has((f.properties.layer || f.properties.Layer || "").toLowerCase()));
              return [...filtered, ...newFeaturesList];
            });
          }
        } catch (err) {
          console.error("Error batch loading layers:", err);
        }
      } else {
        // If all are already loaded, simply make them visible
        setLayers((prev) => prev.map((l) => ({ ...l, visible: true })));
      }
    } else {
      setLayers((prev) => prev.map((l) => ({ ...l, visible: false })));
      setSelectedFeature(null);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 overflow-hidden font-sans">
      {/* Visual Navigation Header */}
      <header className="h-14 bg-slate-900 text-slate-100 px-4 flex items-center justify-between border-b border-slate-950 shrink-0 select-none shadow-md">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-1.5 rounded-lg text-white shadow-sm flex items-center justify-center">
            <Compass className="w-5 h-5 text-indigo-100" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold tracking-tight text-white uppercase">Geography For District Planners/Administrators</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 animate-pulse">
                Live Server
              </span>
            </div>
            <h2 className="text-base font-bold tracking-tight text-slate-200">District Almora</h2>
          </div>
        </div>

        {/* Global summary specs */}
        <div className="flex items-center space-x-3 text-xs font-semibold text-slate-300">
          <button
            onClick={() => fetchFeatures(true)}
            disabled={loading}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-800/40 text-white font-extrabold px-3 py-1.5 rounded-lg text-xs shadow-md transition duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
            title="Force reload all GIS layers from live MongoDB Atlas database"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Sync Database</span>
          </button>
          <div className="hidden md:flex items-center gap-1.5 bg-slate-800 px-2.5 py-1.5 rounded-md">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Layers: <strong className="text-white font-mono">{layers.length}</strong></span>
          </div>
          <div className="hidden md:flex items-center gap-1.5 bg-slate-800 px-2.5 py-1.5 rounded-md">
            <Database className="w-3.5 h-3.5 text-pink-400" />
            <span>Entities: <strong className="text-white font-mono">{features.length}</strong></span>
          </div>
        </div>
      </header>

      {/* Main Core GIS Workspace Layout */}
      <main className="flex-1 flex overflow-hidden min-h-0 relative">
        {loading ? (
          <div className="absolute inset-x-0 inset-y-0 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 p-6 select-none font-sans">
            <div className="bg-slate-800 border border-slate-700/80 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm text-center">
              <div className="h-12 w-12 rounded-full bg-indigo-500/10 flex items-center justify-center mb-4">
                <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              </div>
              <h3 className="text-sm font-bold text-slate-100">Synchronizing Spatial Shapefiles Server</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Connecting securely to database. Downloading geographical boundaries, river streams, and villages of <span className="text-indigo-400 font-semibold">Almora</span>...
              </p>
              
              {/* Spinning status indicator */}
              <div className="w-full bg-slate-700 h-1 rounded-full overflow-hidden mt-6">
                <div className="bg-indigo-500 h-full w-2/3 rounded-full animate-pulse" />
              </div>
              <span className="text-[9px] text-slate-500 font-mono mt-2 uppercase tracking-widest">Awaiting MongoDB Live Stream</span>
            </div>
          </div>
        ) : error ? (
          <div className="absolute inset-x-0 inset-y-0 bg-slate-950 flex flex-col items-center justify-center z-[100] p-6 text-center select-none font-sans">
            <div className="bg-slate-900 border border-red-500/20 max-w-md p-8 rounded-2xl shadow-2xl flex flex-col items-center">
              <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4 text-red-500">
                <ServerCrash className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-100">Database Connection Failed</h3>
              <p className="text-xs text-red-400/90 font-mono bg-red-950/20 border border-red-900/35 p-3 rounded-md mt-3 mb-4 text-left leading-relaxed break-words w-full">
                {error}
              </p>
              <p className="text-xs text-slate-400 leading-normal max-w-sm">
                Ensure that your Atlas Cluster allows connection requests, and that your collection contains valid GeoJSON shapefiles.
              </p>
              <button
                onClick={fetchFeatures}
                className="mt-6 font-semibold text-xs bg-indigo-600 font-sans hover:bg-indigo-500 text-white px-5 py-2 rounded-lg shadow-md hover:shadow-indigo-500/10 transition-all duration-150"
              >
                Retry Connection
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Left Sidebar - Layer Configs and Basemaps */}
            <Sidebar
              layers={layers}
              toggleLayer={toggleLayer}
              updateLayerOpacity={updateLayerOpacity}
              updateLayerColor={updateLayerColor}
              activeBaseMap={activeBaseMap}
              setBaseMap={setActiveBaseMap}
              baseMaps={baseMaps}
              onReset={handleResetToExtent}
              totalFeatures={features.length}
              isCollapsed={isSidebarCollapsed}
              setIsCollapsed={setIsSidebarCollapsed}
              onZoomToLayer={setZoomToLayerName}
              toggleAllLayers={toggleAllLayers}
              measureMode={measureMode}
              setMeasureMode={setMeasureMode}
              measurePoints={measurePoints}
              setMeasurePoints={setMeasurePoints}
            />

            {/* Center Map Workboard */}
            <MapComponent
              features={features}
              layers={layers}
              activeBaseMap={activeBaseMap}
              baseMaps={baseMaps}
              selectedFeature={selectedFeature}
              onFeatureSelect={setSelectedFeature}
              hoveredFeature={hoveredFeature}
              setHoveredFeature={setHoveredFeature}
              isTableCollapsed={isTableCollapsed}
              setIsTableCollapsed={setIsTableCollapsed}
              isSidebarCollapsed={isSidebarCollapsed}
              measureMode={measureMode}
              measurePoints={measurePoints}
              setMeasurePoints={setMeasurePoints}
              zoomToLayerName={zoomToLayerName}
              clearZoomToLayer={() => setZoomToLayerName(null)}
              toggleLayer={toggleLayer}
            />

            {/* Right Pane Attribute Table */}
            <AttributeTable
              features={features}
              layers={layers}
              selectedFeature={selectedFeature}
              onFeatureSelect={setSelectedFeature}
              isCollapsed={isTableCollapsed}
              setIsCollapsed={setIsTableCollapsed}
              onRefresh={() => fetchFeatures(true)}
            />
          </>
        )}
      </main>
    </div>
  );
}
