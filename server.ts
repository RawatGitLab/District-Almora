import express from "express";
import path from "path";
import { MongoClient } from "mongodb";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import proj4 from "proj4";
import zlib from "zlib";

dotenv.config();

const UTM_44N = "+proj=utm +zone=44 +ellps=WGS84 +datum=WGS84 +units=m +no_defs";
const WGS_84 = "+proj=longlat +datum=WGS84 +no_defs";

// Pre-compile the coordinate converter to avoid parsing projection strings for every coordinate conversion
const coordinateConverter = proj4(UTM_44N, WGS_84);

// Helper to recursively project coordinates from UTM Zone 44N to WGS84 (lat/lng)
function projectCoordinates(coordinates: any): any {
  if (!Array.isArray(coordinates)) {
    return coordinates;
  }
  
  if ((coordinates.length === 2 || coordinates.length === 3) && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    const x = coordinates[0];
    const y = coordinates[1];
    // Check if coordinates are in UTM range (e.g. > 1000)
    if (Math.abs(x) > 1000 || Math.abs(y) > 1000) {
      try {
        const [lng, lat] = coordinateConverter.forward([x, y]);
        if (isFinite(lng) && isFinite(lat)) {
          return coordinates.length === 3 ? [lng, lat, coordinates[2]] : [lng, lat];
        }
      } catch (e) {
        console.error("Proj4 conversion error for coordinates:", [x, y], e);
      }
    }
    return coordinates;
  }
  
  return coordinates.map(projectCoordinates);
}

const app = express();
const PORT = 3000;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION;

let mongoClient: MongoClient | null = null;

async function getMongoClient() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is required but missing. Please set it in your environment or .env file.");
  }
  if (!MONGODB_DB) {
    throw new Error("MONGODB_DB environment variable is required but missing. Please set it in your environment or .env file.");
  }
  if (!MONGODB_COLLECTION) {
    throw new Error("MONGODB_COLLECTION environment variable is required but missing. Please set it in your environment or .env file.");
  }
  
  if (!mongoClient) {
    try {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      console.log("Connected to MongoDB Atlas successfully.");
    } catch (error) {
      console.error("MongoDB Connection Error:", error);
      throw error;
    }
  }
  return mongoClient;
}

// Enable JSON parser
app.use(express.json());

// API: Debug MongoDB schema
app.get("/api/debug", async (req, res) => {
  try {
    const client = await getMongoClient();
    const db = client.db(MONGODB_DB);
    const collection = db.collection(MONGODB_COLLECTION);
    
    // Get total document count
    const totalCount = await collection.countDocuments();
    
    // Fetch a sample of 5 documents to inspect
    const sample = await collection.find({}).limit(5).toArray();
    
    // Analyze fields and distinct layers/types if present
    const distinctLayers = await collection.distinct("properties.layer").catch(() => []);
    const alternativeLayers = await collection.distinct("properties.Layer").catch(() => []);
    const rawDistinctLayers = await collection.distinct("layer").catch(() => []);
    
    res.json({
      success: true,
      totalCount,
      sample,
      detectedLayers: {
        propertiesLayer: distinctLayers,
        properties_capLayer: alternativeLayers,
        rootLayer: rawDistinctLayers
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || String(error)
    });
  }
});

function determineGeometryType(layerName: string): "point" | "linestring" | "polygon" | "unknown" {
  const lower = layerName.toLowerCase();
  
  // Boundaries & Areas
  if (
    lower.includes("area") || 
    lower.includes("boundary") || 
    lower.includes("district") || 
    lower.includes("block") || 
    lower.includes("tehsil") || 
    lower.includes("tahsil") ||
    lower.includes("kotwali") ||
    lower.includes("thans")
  ) {
    return "polygon";
  }
  
  // Linear features, drainage, roads, rivers
  if (
    lower.includes("road") || 
    lower.includes("canal") || 
    lower.includes("water") || 
    lower.includes("drainage") || 
    lower.includes("linear") || 
    lower.includes("river") || 
    lower.includes("line")
  ) {
    return "linestring";
  }
  
  // Points: school, police, village, hospital, center, barriers, station, building, etc.
  if (
    lower.includes("village") || 
    lower.includes("school") || 
    lower.includes("centre") || 
    lower.includes("center") || 
    lower.includes("hospital") || 
    lower.includes("police") || 
    lower.includes("chauki") || 
    lower.includes("outpost") || 
    lower.includes("thana") || 
    lower.includes("headquater") || 
    lower.includes("barriers") || 
    lower.includes("station") || 
    lower.includes("building")
  ) {
    return "point";
  }
  
  return "polygon"; // Default fallback
}

// Memory cache for processed layer features
const processedFeaturesCache = new Map<string, any[]>();

// API: Get metadata of all layers
app.get("/api/layers", async (req, res) => {
  try {
    const client = await getMongoClient();
    const db = client.db(MONGODB_DB);
    const collection = db.collection(MONGODB_COLLECTION);
    
    console.log("Fetching layers metadata...");
    const layersData = await collection.aggregate([
      {
        $project: {
          name: 1,
          featuresCount: {
            $cond: {
              if: { $isArray: "$features" },
              then: { $size: "$features" },
              else: 1
            }
          }
        }
      }
    ]).toArray();
    
    const layersConfigs = layersData.map((doc, index) => {
      const name = doc.name || "Unnamed Layer";
      const type = determineGeometryType(name);
      
      let color = "#6366f1"; // default indigo
      let fillColor = "#818cf8";
      let weight = 2;
      let opacity = 0.85;
      let fillOpacity = 0.4;

      const lowerName = name.toLowerCase();
      if (lowerName.includes("village")) {
        color = "#ec4899"; // bright pink villages selector
        fillColor = "#f472b6";
        weight = 1.5;
        opacity = 0.95;
      } else if (lowerName.includes("river") || lowerName.includes("canal") || lowerName.includes("water")) {
        color = "#0ea5e9"; // stream sky blue
        fillColor = "#38bdf8";
        weight = 2.5;
        opacity = 1.0;
        fillOpacity = 0.1;
      } else if (lowerName.includes("district") || lowerName.includes("boundary")) {
        color = "#a16207"; // Golden brown outline
        fillColor = "#fbbf24"; // Mustard polygon fill
        weight = 2.5;
        opacity = 0.9;
        fillOpacity = 0.55; // Solid background core
      } else if (lowerName.includes("block")) {
        color = "#c2410c"; // Rust dark
        fillColor = "#fdba74"; // Peach block
        weight = 2.0;
        opacity = 0.8;
        fillOpacity = 0.25;
      } else if (lowerName.includes("tehsil") || lowerName.includes("tahsil")) {
        color = "#15803d"; // Deep forest green
        fillColor = "#86efac"; // Mint tehsil
        weight = 2.0;
        opacity = 0.85;
        fillOpacity = 0.3;
      } else {
        const hue = (index * 137.5) % 360; 
        color = `hsl(${hue}, 70%, 45%)`;
        fillColor = `hsl(${hue}, 70%, 65%)`;
      }

      if (type === "polygon") {
        color = "#ffffff";
        fillColor = "transparent";
        fillOpacity = 0;
      }

      // Default visible layers: keep them minimal so page is clean and boots fast
      const isDefaultVisible = name === "District-Boundary";

      return {
        id: `layer-${index}-${name.replace(/\s+/g, '-')}`,
        name: name,
        visible: isDefaultVisible,
        type: type,
        color: color,
        fillColor: fillColor,
        opacity: opacity,
        fillOpacity: fillOpacity,
        weight: weight,
        itemCount: doc.featuresCount,
        loaded: isDefaultVisible
      };
    });

    // Sort priority: polygons first, then lines, then points
    const sortPriority = (type: string) => {
      if (type === "polygon") return 1;
      if (type === "linestring") return 2;
      if (type === "point") return 3;
      return 4;
    };
    
    layersConfigs.sort((a, b) => sortPriority(a.type) - sortPriority(b.type));

    res.json({
      success: true,
      layers: layersConfigs
    });
  } catch (error: any) {
    console.error("Error fetching layers metadata:", error);
    res.status(500).json({
      success: false,
      error: error.message || String(error)
    });
  }
});

// API: Get features for a specific layer on demand
app.get("/api/features", async (req, res) => {
  try {
    const layerParam = req.query.layer as string;
    
    if (!layerParam) {
      return res.status(400).json({
        success: false,
        error: "Missing required query parameter: layer"
      });
    }

    if (processedFeaturesCache.has(layerParam)) {
      const features = processedFeaturesCache.get(layerParam);
      const jsonString = JSON.stringify({
        success: true,
        count: features?.length || 0,
        features
      });
      
      const gzipBuffer = zlib.gzipSync(jsonString);
      const acceptEncoding = req.headers["accept-encoding"] || "";
      if (acceptEncoding.includes("gzip")) {
        res.set({
          "Content-Encoding": "gzip",
          "Content-Type": "application/json"
        });
        return res.send(gzipBuffer);
      } else {
        res.set("Content-Type", "application/json");
        return res.send(jsonString);
      }
    }

    const client = await getMongoClient();
    const db = client.db(MONGODB_DB);
    const collection = db.collection(MONGODB_COLLECTION);
    
    console.log(`[On Demand Fetch] Loading features for layer: ${layerParam}`);
    const doc = await collection.findOne({ name: layerParam });
    
    if (!doc) {
      return res.json({
        success: true,
        count: 0,
        features: []
      });
    }

    const features: any[] = [];
    const layerName = doc.name || "Unassigned";

    if (Array.isArray(doc.features)) {
      for (let j = 0; j < doc.features.length; j++) {
        const feat = doc.features[j];
        const projectedGeom = feat.geometry ? {
          ...feat.geometry,
          coordinates: projectCoordinates(feat.geometry.coordinates)
        } : null;
        
        features.push({
          id: feat.id || `${doc._id.toString()}-${j}`,
          type: "Feature",
          geometry: projectedGeom,
          properties: {
            ...feat.properties,
            layer: layerName,
            name: feat.properties?.name || feat.properties?.Name || feat.properties?.village_name || feat.properties?.Village_Name || ""
          }
        });
      }
    } else if (doc.type === "Feature" || (doc.geometry && doc.properties)) {
      const projectedGeom = doc.geometry ? {
        ...doc.geometry,
        coordinates: projectCoordinates(doc.geometry.coordinates)
      } : null;

      features.push({
        id: doc._id.toString(),
        type: "Feature",
        geometry: projectedGeom,
        properties: {
          ...doc.properties,
          layer: layerName,
          name: doc.properties?.name || doc.properties?.Name || doc.properties?.village_name || doc.properties?.Village_Name || ""
        }
      });
    } else {
      const geometry = doc.geometry || (doc.coordinates ? { type: doc.geom_type || "Point", coordinates: doc.coordinates } : null);
      if (geometry) {
        const projectedGeom = {
          ...geometry,
          coordinates: projectCoordinates(geometry.coordinates)
        };

        features.push({
          id: doc._id.toString(),
          type: "Feature",
          geometry: projectedGeom,
          properties: {
            ...doc,
            layer: layerName,
            name: doc.name || doc.Name || doc.village_name || doc.Village_Name || ""
          }
        });
      }
    }

    processedFeaturesCache.set(layerParam, features);

    const jsonString = JSON.stringify({
      success: true,
      count: features.length,
      features
    });

    const gzipBuffer = zlib.gzipSync(jsonString);
    const acceptEncoding = req.headers["accept-encoding"] || "";
    if (acceptEncoding.includes("gzip")) {
      res.set({
        "Content-Encoding": "gzip",
        "Content-Type": "application/json"
      });
      res.send(gzipBuffer);
    } else {
      res.set("Content-Type", "application/json");
      res.send(jsonString);
    }
  } catch (error: any) {
    console.error(`Error loading features for layer ${req.query.layer}:`, error);
    res.status(500).json({
      success: false,
      error: error.message || String(error)
    });
  }
});

// Warm up default layers in memory cache on startup
async function warmupCache() {
  try {
    console.log("Starting background layer cache warmup...");
    const client = await getMongoClient();
    const db = client.db(MONGODB_DB);
    const collection = db.collection(MONGODB_COLLECTION);
    
    const defaultLayers = ["District-Boundary", "Tehsil-Boundary", "Block-Boundary"];
    for (const name of defaultLayers) {
      console.log(`[Cache Warmup] Warming up ${name}...`);
      const doc = await collection.findOne({ name });
      if (doc) {
        const features: any[] = [];
        const layerName = doc.name || "Unassigned";

        if (Array.isArray(doc.features)) {
          for (let j = 0; j < doc.features.length; j++) {
            const feat = doc.features[j];
            const projectedGeom = feat.geometry ? {
              ...feat.geometry,
              coordinates: projectCoordinates(feat.geometry.coordinates)
            } : null;
            
            features.push({
              id: feat.id || `${doc._id.toString()}-${j}`,
              type: "Feature",
              geometry: projectedGeom,
              properties: {
                ...feat.properties,
                layer: layerName,
                name: feat.properties?.name || feat.properties?.Name || feat.properties?.village_name || feat.properties?.Village_Name || ""
              }
            });
          }
        }
        processedFeaturesCache.set(name, features);
        console.log(`[Cache Warmup] Warmup done for ${name}. Loaded ${features.length} features.`);
      }
    }
    console.log("Background layer cache warmup complete!");
  } catch (err) {
    console.error("Background layer cache warmup failed:", err);
  }
}

// Trigger cache warmup in background without blocking server startup
warmupCache().catch((err) => {
  console.error("Background warmup failed:", err);
});

// API: Proxy Bhuvan tiles to bypass mixed content (HTTP over HTTPS) or self-signed cert blocks
app.get("/api/bhuvan-tiles/:z/:x/:y", async (req, res) => {
  const { z, x, y } = req.params;
  
  // Use http to bypass SSL issues, since we fetch on the server and return securely to the client
  const bhuvanUrl = `http://bhuvan-vec1.nrsc.gov.in/bhuvan/gts/vector/${z}/${x}/${y}.png`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout for quick failure/fallback

    const response = await fetch(bhuvanUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "http://bhuvan.nrsc.gov.in/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
      return res.send(buffer);
    }
    
    // If Bhuvan tile server is down, fallback to OpenStreetMap
    console.warn(`Bhuvan tile server returned status ${response.status}. Falling back to standard OSM tile.`);
    const fallbackUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const fallbackResponse = await fetch(fallbackUrl);
    if (fallbackResponse.ok) {
      const fallbackArray = await fallbackResponse.arrayBuffer();
      res.set("Content-Type", "image/png");
      return res.send(Buffer.from(fallbackArray));
    }
    res.status(502).send("Tile service unavailable");
  } catch (error) {
    // Graceful fallback to OpenStreetMap on connection error, timeout, or lookup failure
    try {
      const fallbackUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      const fallbackResponse = await fetch(fallbackUrl);
      if (fallbackResponse.ok) {
        const fallbackArray = await fallbackResponse.arrayBuffer();
        res.set("Content-Type", "image/png");
        return res.send(Buffer.from(fallbackArray));
      }
    } catch (e) {
      // Ignore
    }
    res.status(502).send("Error fetching tile");
  }
});

async function startServer() {
  // Vite dev server middleware integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server starting on http://0.0.0.0:${PORT} debug ready at /api/debug`);
  });
}

startServer();
