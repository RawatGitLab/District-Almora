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

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://varunrawatmailbox2507_db_user:GYVPiF8LG4HIbsSF@cluster0.8xfepsq.mongodb.net/?appName=Cluster0";
const MONGODB_DB = process.env.MONGODB_DB || "Shapefile";
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || "Almora";

let mongoClient: MongoClient | null = null;

async function getMongoClient() {
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

let cachedFeaturesResponse: any = null;
let isFetching = false;
let fetchPromise: Promise<any> | null = null;
let cachedDocCount = 0;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds TTL fallback

async function fetchAndProcessFeatures(force = false) {
  const now = Date.now();
  let dbChanged = false;
  
  try {
    const client = await getMongoClient();
    const db = client.db(MONGODB_DB);
    const collection = db.collection(MONGODB_COLLECTION);
    
    // Quick, lightweight check to count the documents (layers) in the collection
    const currentDocCount = await collection.countDocuments().catch(() => 0);
    if (currentDocCount !== cachedDocCount) {
      dbChanged = true;
      console.log(`[Cache Invalidation] Database document count changed from ${cachedDocCount} to ${currentDocCount}. Forcing refresh.`);
    }
  } catch (err) {
    console.error("Failed database pre-flight count for cache verification:", err);
  }

  if (cachedFeaturesResponse && !force && !dbChanged && (now - lastCacheTime < CACHE_TTL)) {
    return cachedFeaturesResponse;
  }
  
  if (isFetching && fetchPromise) {
    return fetchPromise;
  }
  
  isFetching = true;
  fetchPromise = (async () => {
    try {
      const client = await getMongoClient();
      const db = client.db(MONGODB_DB);
      const collection = db.collection(MONGODB_COLLECTION);
      
      console.log("Fetching GIS features from MongoDB Atlas via cursor to save memory...");
      const cursor = collection.find({});
      
      const features: any[] = [];
      let processedCount = 0;
      let totalDocCount = 0;
      const yieldEventLoop = () => new Promise(resolve => setImmediate(resolve));
      
      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        if (!doc) continue;
        totalDocCount++;
        
        // Determine layer name robustly:
        let layerName = "Unassigned";
        if (Array.isArray(doc.features)) {
          layerName = doc.name || doc.Layer || doc.layer || "Unassigned";
        } else {
          layerName = doc.layer || doc.Layer || doc.properties?.layer || doc.properties?.Layer || doc.name || "Unassigned";
        }

        if (layerName === "Health-Ayurvedic-Centres") {
          continue;
        }
        
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
            
            processedCount++;
            if (processedCount % 500 === 0) {
              await yieldEventLoop();
            }
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
          
          processedCount++;
          if (processedCount % 500 === 0) {
            await yieldEventLoop();
          }
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
          
          processedCount++;
          if (processedCount % 500 === 0) {
            await yieldEventLoop();
          }
        }
      }
      
      console.log(`Successfully processed ${features.length} features. Compressing to Gzip to save memory and network bandwidth...`);
      const jsonString = JSON.stringify({
        success: true,
        count: features.length,
        features
      });
      
      const gzipBuffer = zlib.gzipSync(jsonString);
      
      cachedFeaturesResponse = {
        gzip: gzipBuffer,
        count: features.length
      };
      
      cachedDocCount = totalDocCount;
      lastCacheTime = Date.now();
      
      console.log(`Successfully fetched, cached and compressed ${features.length} features across ${totalDocCount} layers. Gzip size: ${(gzipBuffer.length / (1024 * 1024)).toFixed(2)} MB.`);
      return cachedFeaturesResponse;
    } catch (error) {
      console.error("Error fetching and processing GIS features:", error);
      throw error;
    } finally {
      isFetching = false;
      fetchPromise = null;
    }
  })();
  
  return fetchPromise;
}

// Background pre-fetch on startup to warm up the cache
fetchAndProcessFeatures().catch((err) => {
  console.error("Failed background pre-fetch on startup:", err);
});

// API: Get all features
app.get("/api/features", async (req, res) => {
  try {
    const force = req.query.force === "true";
    const cacheData = await fetchAndProcessFeatures(force);
    
    // Check if client supports Gzip compression
    const acceptEncoding = req.headers["accept-encoding"] || "";
    if (acceptEncoding.includes("gzip")) {
      res.set({
        "Content-Encoding": "gzip",
        "Content-Type": "application/json"
      });
      res.send(cacheData.gzip);
    } else {
      const decompressed = zlib.gunzipSync(cacheData.gzip);
      res.set("Content-Type", "application/json");
      res.send(decompressed);
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || String(error)
    });
  }
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
